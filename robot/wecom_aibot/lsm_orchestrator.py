"""WeCom robot orchestration through LLM-planned MCP tools and confirmed writes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from robot.wecom_aibot.conversation_store import WecomConversationStore
from robot.wecom_aibot.formatters import format_tool_result
from robot.wecom_aibot.intent_utils import (
    BIND_PATTERN,
    CANCEL_WORDS,
    CONFIRM_WORDS,
    HELP_KEYWORDS,
    RETURN_KEYWORDS,
    ActorContext,
    binding_status_text,
    build_actor,
    confirm_text,
    expires_at,
    extract_inventory_candidates,
    extract_return_quantity,
    extract_write_query,
    filter_candidates,
    has_any,
    help_text,
    is_borrow_intent,
    is_return_intent,
    need_bind_text,
    payload_data,
    result_ok,
    state_expired,
)
from robot.wecom_aibot.llm_planner import LSMIntentPlanner
from robot.wecom_aibot.mcp_client import LSMMcpClient
from robot.wecom_aibot.minimax_web_search import MiniMaxWebSearchClient
from robot.wecom_aibot.read_queries import answer_read_query, answer_with_llm_plan


@dataclass(frozen=True)
class LSMRobotOrchestrator:
    mcp_client: LSMMcpClient
    conversation_store: WecomConversationStore | None = None
    llm_planner: LSMIntentPlanner | None = None
    web_search_client: MiniMaxWebSearchClient | None = None
    search_limit: int = 5

    async def answer(self, *, text: str, payload: dict[str, Any]) -> str:
        normalized = text.strip()
        actor = build_actor(payload)
        state_reply = await self._handle_state(actor, normalized)
        if state_reply:
            return state_reply
        binding_reply = await self._handle_binding_command(actor, normalized)
        if binding_reply:
            return binding_reply
        if not normalized or has_any(normalized, HELP_KEYWORDS):
            return help_text()
        binding = self._get_binding(actor.userid)
        if not binding:
            return need_bind_text()
        if is_borrow_intent(normalized):
            return await self._start_borrow(actor, normalized, binding["access_token"])
        if is_return_intent(normalized):
            return await self._start_return(actor, normalized)
        llm_answer = await answer_with_llm_plan(
            mcp_client=self.mcp_client,
            llm_planner=self.llm_planner,
            web_search_client=self.web_search_client,
            search_limit=self.search_limit,
            text=normalized,
            user_token=binding["access_token"],
        )
        return llm_answer or await answer_read_query(
            mcp_client=self.mcp_client,
            llm_planner=self.llm_planner,
            web_search_client=self.web_search_client,
            search_limit=self.search_limit,
            text=normalized,
            user_token=binding["access_token"],
        )

    async def _handle_binding_command(self, actor: ActorContext, text: str) -> str:
        if text in {"绑定状态", "我的绑定"}:
            return binding_status_text(self._get_binding(actor.userid))
        if text in {"解绑", "取消绑定"}:
            self._delete_binding(actor.userid)
            return "已解除企业微信和 LabStorageManager 账号绑定。"
        match = BIND_PATTERN.match(text)
        if not match:
            return ""
        if actor.is_group:
            return "绑定涉及密码，请私聊机器人发送：绑定 用户名 密码。"
        return await self._bind_user(actor.userid, match.group(1), match.group(2).strip())

    async def _bind_user(self, userid: str, username: str, password: str) -> str:
        result = await self.mcp_client.call_tool(
            "auth_login",
            {"username": username, "password": password},
        )
        if not result_ok(result):
            return format_tool_result(result, title="绑定结果", empty_text="绑定失败。")
        data = payload_data(result)
        token = data.get("access_token") if isinstance(data, dict) else None
        if not isinstance(token, str) or not token:
            return "绑定失败：登录结果没有返回可用 token。"
        user = data.get("user") if isinstance(data.get("user"), dict) else {}
        self._save_binding(userid, username=username, access_token=token, user=user)
        display_name = user.get("full_name") or user.get("username") or username
        return f"绑定成功：{display_name}。现在可以查询、借用和归还库存。"

    async def _handle_state(self, actor: ActorContext, text: str) -> str:
        state = self._get_state(actor.chat_key)
        if not state:
            return ""
        if state_expired(state):
            self._delete_state(actor.chat_key)
            return "这个操作确认已过期，请重新发起。"
        if text.lower() in CANCEL_WORDS:
            self._delete_state(actor.chat_key)
            return "已取消。"
        if state.get("type") == "await_select":
            return await self._handle_selection(actor, state, text)
        if state.get("type") == "await_confirm":
            return await self._handle_confirmation(actor, state, text)
        self._delete_state(actor.chat_key)
        return ""

    async def _handle_selection(self, actor: ActorContext, state: dict[str, Any], text: str) -> str:
        if not text.isdigit():
            return "请回复候选序号，或回复“取消”。"
        candidates = state.get("candidates")
        index = int(text) - 1
        if not isinstance(candidates, list) or index < 0 or index >= len(candidates):
            return "序号不在候选范围内，请重新选择。"
        candidate = candidates[index]
        args = {**state.get("arguments", {}), "inventory_id": candidate["inventory_id"]}
        self._save_confirm_state(actor.chat_key, state["action"], args, candidate["display"])
        return confirm_text(state["action"], candidate["display"], args)

    async def _handle_confirmation(self, actor: ActorContext, state: dict[str, Any], text: str) -> str:
        if text.lower() not in CONFIRM_WORDS:
            return "请回复“确认”执行，或回复“取消”放弃。"
        self._delete_state(actor.chat_key)
        binding = self._get_binding(actor.userid)
        if not binding:
            return need_bind_text()
        return await self._execute_write(state["action"], state.get("arguments", {}), binding["access_token"])

    async def _start_borrow(self, actor: ActorContext, text: str, user_token: str) -> str:
        keyword = extract_write_query(text, ("借用", "帮我借"))
        if not keyword:
            return "请说明要借用的库存名称或 CAS，例如：借用乙醇。"
        result = await self.mcp_client.call_tool(
            "inventory_search_by_name",
            {"keyword": keyword, "limit": self.search_limit, "user_token": user_token},
        )
        return self._prepare_candidates(actor.chat_key, "inventory_borrow", {}, result, "借用")

    async def _start_return(self, actor: ActorContext, text: str) -> str:
        binding = self._get_binding(actor.userid)
        if not binding:
            return need_bind_text()
        quantity_args = extract_return_quantity(text)
        if not quantity_args:
            return "归还需要说明用量或剩余量，例如：归还乙醇 用量20。"
        result = await self.mcp_client.call_tool("inventory_my_borrows", {"user_token": binding["access_token"]})
        keyword = extract_write_query(text, RETURN_KEYWORDS)
        candidates = filter_candidates(extract_inventory_candidates(result), keyword)
        return self._prepare_candidates_from_list(
            actor.chat_key,
            "inventory_return",
            quantity_args,
            candidates,
            "归还",
        )

    def _prepare_candidates(
        self,
        chat_key: str,
        action: str,
        arguments: dict[str, Any],
        result: dict[str, Any],
        label: str,
    ) -> str:
        if not result_ok(result):
            return format_tool_result(result, title=f"{label}候选", empty_text="没有查到匹配记录。")
        candidates = extract_inventory_candidates(result)
        return self._prepare_candidates_from_list(chat_key, action, arguments, candidates, label)

    def _prepare_candidates_from_list(
        self,
        chat_key: str,
        action: str,
        arguments: dict[str, Any],
        candidates: list[dict[str, Any]],
        label: str,
    ) -> str:
        if not candidates:
            return f"没有找到可{label}的匹配库存。"
        if len(candidates) == 1:
            return self._prepare_single_candidate(chat_key, action, arguments, candidates[0])
        self._save_select_state(chat_key, action, arguments, candidates)
        lines = [f"找到多个可{label}的库存，请回复序号："]
        lines.extend(f"{idx}. {item['display']}" for idx, item in enumerate(candidates, 1))
        lines.append("回复“取消”放弃。")
        return "\n".join(lines)

    def _prepare_single_candidate(
        self,
        chat_key: str,
        action: str,
        arguments: dict[str, Any],
        candidate: dict[str, Any],
    ) -> str:
        args = {**arguments, "inventory_id": candidate["inventory_id"]}
        self._save_confirm_state(chat_key, action, args, candidate["display"])
        return confirm_text(action, candidate["display"], args)

    async def _execute_write(self, action: str, args: dict[str, Any], user_token: str) -> str:
        tool_args = {**args, "user_token": user_token}
        tool_name = "inventory_borrow" if action == "inventory_borrow" else "inventory_return"
        result = await self.mcp_client.call_tool(tool_name, tool_args)
        if result_ok(result):
            return "借用成功。" if action == "inventory_borrow" else "归还成功。"
        return format_tool_result(result, title="操作结果", empty_text="操作失败。")

    def _get_binding(self, userid: str) -> dict[str, Any] | None:
        return self.conversation_store.get_binding(userid) if self.conversation_store else None

    def _save_binding(self, userid: str, *, username: str, access_token: str, user: dict[str, Any]) -> None:
        if self.conversation_store:
            self.conversation_store.save_binding(
                wecom_userid=userid,
                username=username,
                access_token=access_token,
                user=user,
            )

    def _delete_binding(self, userid: str) -> None:
        if self.conversation_store:
            self.conversation_store.delete_binding(userid)

    def _get_state(self, chat_key: str) -> dict[str, Any] | None:
        return self.conversation_store.get_state(chat_key) if self.conversation_store else None

    def _save_select_state(
        self,
        chat_key: str,
        action: str,
        args: dict[str, Any],
        candidates: list[dict[str, Any]],
    ) -> None:
        self._save_state(
            chat_key,
            {
                "type": "await_select",
                "action": action,
                "arguments": args,
                "candidates": candidates,
                "expires_at": expires_at(),
            },
        )

    def _save_confirm_state(self, chat_key: str, action: str, args: dict[str, Any], display: str) -> None:
        self._save_state(
            chat_key,
            {
                "type": "await_confirm",
                "action": action,
                "arguments": args,
                "display": display,
                "expires_at": expires_at(),
            },
        )

    def _save_state(self, chat_key: str, state: dict[str, Any]) -> None:
        if self.conversation_store:
            self.conversation_store.save_state(chat_key, state)

    def _delete_state(self, chat_key: str) -> None:
        if self.conversation_store:
            self.conversation_store.delete_state(chat_key)
