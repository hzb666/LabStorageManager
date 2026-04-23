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
    RETURN_KEYWORDS,
    ActorContext,
    binding_status_text,
    build_actor,
    confirm_text,
    extract_candidate_selection,
    expires_at,
    extract_inventory_candidates,
    extract_return_quantity,
    extract_write_query,
    filter_candidates,
    help_text,
    is_help_request,
    is_borrow_intent,
    is_return_intent,
    is_unbind_request,
    need_bind_text,
    payload_data,
    result_ok,
    state_expired,
)
from robot.wecom_aibot.llm_planner import (
    ACTION_START_BORROW,
    ACTION_START_RETURN,
    LSMIntentPlanner,
    LSMToolPlan,
)
from robot.wecom_aibot.mcp_client import LSMMcpClient
from robot.wecom_aibot.minimax_web_search import MiniMaxWebSearchClient
from robot.wecom_aibot.read_queries import answer_read_query, answer_with_llm_plan
from robot.wecom_aibot.return_quantity import normalize_unit, resolve_return_quantity_arguments

CONTEXT_RESET_REPLY = "已开始新对话，我不会再参考前面的临时上下文。"
BINDING_EXPIRED_REPLY = "绑定已过期，请重新绑定。"
AUTH_FAILURE_EXIT_CODE = 2


class BindingExpiredError(Exception):
    """Raised when a bound user's stored LSM token is no longer accepted."""


class BindingAwareMcpClient:
    """Wrap MCP calls and turn user-token auth failures into a binding reset."""

    def __init__(self, mcp_client: LSMMcpClient, on_auth_failure: Any) -> None:
        self.mcp_client = mcp_client
        self.on_auth_failure = on_auth_failure

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = await self.mcp_client.call_tool(name, arguments)
        if _is_auth_failure_result(result):
            self.on_auth_failure()
            raise BindingExpiredError
        return result


@dataclass(frozen=True)
class LSMRobotOrchestrator:
    mcp_client: LSMMcpClient
    conversation_store: WecomConversationStore | None = None
    llm_planner: LSMIntentPlanner | None = None
    web_search_client: MiniMaxWebSearchClient | None = None
    search_limit: int = 5

    async def answer(
        self,
        *,
        text: str,
        payload: dict[str, Any],
        remember_context: bool = True,
    ) -> str:
        normalized = text.strip()
        actor = build_actor(payload)
        binding_reply = await self._handle_binding_command(actor, normalized)
        if binding_reply:
            if remember_context:
                self._append_context_turn(actor.chat_key, normalized, binding_reply)
            return binding_reply

        conversation_context = self._get_context(actor.chat_key)
        reset_decision = await self._detect_context_reset(normalized, conversation_context)
        if reset_decision.get("reset") is True:
            self._delete_state(actor.chat_key)
            self._delete_context(actor.chat_key)
            conversation_context = []
            if reset_decision.get("continue_current_request") is False:
                return CONTEXT_RESET_REPLY

        try:
            reply = await self._answer_current(
                actor=actor,
                normalized=normalized,
                conversation_context=conversation_context,
            )
        except BindingExpiredError:
            reply = BINDING_EXPIRED_REPLY
        if remember_context:
            self._append_context_turn(actor.chat_key, normalized, reply)
        return reply

    def remember_context_turn(self, *, text: str, payload: dict[str, Any], reply: str) -> None:
        normalized = text.strip()
        actor = build_actor(payload)
        self._append_context_turn(actor.chat_key, normalized, reply)

    async def _answer_current(
        self,
        *,
        actor: ActorContext,
        normalized: str,
        conversation_context: list[dict[str, str]],
    ) -> str:
        state_reply = await self._handle_state(actor, normalized)
        if state_reply:
            return state_reply
        binding_reply = await self._handle_binding_command(actor, normalized)
        if binding_reply:
            return binding_reply
        if not normalized or is_help_request(normalized):
            return help_text()
        binding = self._get_binding(actor.userid)
        if not binding:
            return need_bind_text()
        bound_mcp_client = self._bound_mcp_client(actor)

        plan = await self._plan_intent(normalized, conversation_context)
        plan_reply = await self._answer_planned_intent(
            actor,
            normalized,
            binding["access_token"],
            plan,
            conversation_context,
            bound_mcp_client,
        )
        if plan_reply:
            return plan_reply

        if is_borrow_intent(normalized):
            return await self._start_borrow(
                actor,
                normalized,
                binding["access_token"],
                mcp_client=bound_mcp_client,
            )
        if is_return_intent(normalized):
            return await self._start_return(
                actor,
                normalized,
                user_token=binding["access_token"],
                mcp_client=bound_mcp_client,
                conversation_context=conversation_context,
            )
        return await answer_read_query(
            mcp_client=bound_mcp_client,
            llm_planner=self.llm_planner,
            web_search_client=self.web_search_client,
            search_limit=self.search_limit,
            text=normalized,
            user_token=binding["access_token"],
            conversation_context=conversation_context,
        )

    async def _detect_context_reset(
        self,
        text: str,
        conversation_context: list[dict[str, str]],
    ) -> dict[str, bool]:
        detector = getattr(self.llm_planner, "detect_context_reset", None)
        if detector is None or not text or not conversation_context:
            return {}
        result = await detector(user_text=text, conversation_context=conversation_context)
        return result if isinstance(result, dict) else {}

    async def _plan_intent(
        self,
        text: str,
        conversation_context: list[dict[str, str]],
    ) -> LSMToolPlan | None:
        planner = getattr(self.llm_planner, "plan", None)
        if planner is None:
            return None
        plan = await planner(text, conversation_context=conversation_context)
        return plan if isinstance(plan, LSMToolPlan) else None

    async def _answer_planned_intent(
        self,
        actor: ActorContext,
        text: str,
        user_token: str,
        plan: LSMToolPlan | None,
        conversation_context: list[dict[str, str]],
        mcp_client: LSMMcpClient,
    ) -> str:
        if plan is None:
            return ""
        if plan.action == ACTION_START_BORROW:
            return await self._start_borrow(
                actor,
                text,
                user_token,
                plan.arguments,
                mcp_client=mcp_client,
            )
        if plan.action == ACTION_START_RETURN:
            return await self._start_return(
                actor,
                text,
                plan.arguments,
                user_token=user_token,
                mcp_client=mcp_client,
                conversation_context=conversation_context,
            )
        return await answer_with_llm_plan(
            mcp_client=mcp_client,
            llm_planner=self.llm_planner,
            web_search_client=self.web_search_client,
            search_limit=self.search_limit,
            text=text,
            user_token=user_token,
            plan=plan,
            conversation_context=conversation_context,
        )

    async def _handle_binding_command(self, actor: ActorContext, text: str) -> str:
        if text in {"绑定状态", "我的绑定"}:
            return binding_status_text(self._get_binding(actor.userid))
        if is_unbind_request(text):
            if not self._get_binding(actor.userid):
                return "当前没有绑定 LabStorageManager 账号。"
            self._save_unbind_confirm_state(actor.chat_key)
            return "确认解除当前 LabStorageManager 账号绑定？请回复“确认”解除，或回复“取消”放弃。"
        match = BIND_PATTERN.match(text)
        if not match:
            return ""
        if actor.is_group:
            return "绑定涉及密码，请私聊机器人发送：绑定 用户名 密码。"
        return await self._bind_user(actor, match.group(1), match.group(2).strip())

    async def _bind_user(self, actor: ActorContext, username: str, password: str) -> str:
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
        self._save_binding(actor.userid, username=username, access_token=token, user=user)
        self._delete_state(actor.chat_key)
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
        if state.get("type") == "await_unbind_confirm":
            return self._handle_unbind_confirmation(actor, text)
        if state.get("type") == "await_confirm":
            return await self._handle_confirmation(actor, state, text)
        self._delete_state(actor.chat_key)
        return ""

    async def _handle_selection(self, actor: ActorContext, state: dict[str, Any], text: str) -> str:
        selection = extract_candidate_selection(text)
        if selection is None:
            return "请回复候选序号，或回复“取消”。"
        candidates = state.get("candidates")
        index = selection - 1
        if not isinstance(candidates, list) or index < 0 or index >= len(candidates):
            return "序号不在候选范围内，请重新选择。"
        candidate = candidates[index]
        if state["action"] == "inventory_return":
            return await self._prepare_return_single_candidate(
                actor.chat_key,
                state.get("arguments", {}),
                candidate,
                str(state.get("user_text") or ""),
                _state_conversation_context(state),
            )
        args = {**state.get("arguments", {}), "inventory_id": candidate["inventory_id"]}
        self._save_confirm_state(actor.chat_key, state["action"], args, candidate["display"])
        return confirm_text(state["action"], candidate["display"], args)

    def _handle_unbind_confirmation(self, actor: ActorContext, text: str) -> str:
        if text.lower() not in CONFIRM_WORDS:
            return "请回复“确认”解除绑定，或回复“取消”放弃。"
        self._delete_state(actor.chat_key)
        self._delete_binding(actor.userid)
        return "已解除企业微信和 LabStorageManager 账号绑定。"

    async def _handle_confirmation(self, actor: ActorContext, state: dict[str, Any], text: str) -> str:
        if text.lower() not in CONFIRM_WORDS:
            return "请回复“确认”执行，或回复“取消”放弃。"
        self._delete_state(actor.chat_key)
        binding = self._get_binding(actor.userid)
        if not binding:
            return need_bind_text()
        return await self._execute_write(
            state["action"],
            state.get("arguments", {}),
            binding["access_token"],
            mcp_client=self._bound_mcp_client(actor),
        )

    async def _start_borrow(
        self,
        actor: ActorContext,
        text: str,
        user_token: str,
        planned_arguments: dict[str, Any] | None = None,
        mcp_client: LSMMcpClient | None = None,
    ) -> str:
        keyword = _planned_keyword(planned_arguments) or extract_write_query(text, ("借用", "帮我借"))
        if not keyword:
            return "请说明要借用的库存名称或 CAS，例如：借用乙醇。"
        call_client = mcp_client or self.mcp_client
        result = await call_client.call_tool(
            "inventory_search_by_name",
            {"keyword": keyword, "limit": self.search_limit, "user_token": user_token},
        )
        return self._prepare_candidates(actor.chat_key, "inventory_borrow", {}, result, "借用")

    async def _start_return(
        self,
        actor: ActorContext,
        text: str,
        planned_arguments: dict[str, Any] | None = None,
        *,
        user_token: str | None = None,
        mcp_client: LSMMcpClient | None = None,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> str:
        if user_token is None:
            binding = self._get_binding(actor.userid)
            if not binding:
                return need_bind_text()
            user_token = binding["access_token"]
        parsed_request = await self._complete_return_request(
            text,
            planned_arguments,
            conversation_context,
        )
        quantity_args = _return_quantity_args(parsed_request) or extract_return_quantity(text)
        if not quantity_args:
            return "归还需要说明用量或剩余量，例如：归还乙醇 用量20。"
        call_client = mcp_client or self.mcp_client
        result = await call_client.call_tool("inventory_my_borrows", {"user_token": user_token})
        keyword = _planned_keyword(parsed_request) or extract_write_query(text, RETURN_KEYWORDS)
        candidates = filter_candidates(extract_inventory_candidates(result), keyword)
        return await self._prepare_return_candidates_from_list(
            actor.chat_key,
            quantity_args,
            candidates,
            text,
            conversation_context=conversation_context,
        )

    async def _parse_return_request_with_llm(
        self,
        text: str,
        conversation_context: list[dict[str, str]] | None,
    ) -> dict[str, Any]:
        parser = getattr(self.llm_planner, "parse_return_request", None)
        if parser is None:
            return {}
        parsed = await parser(user_text=text, conversation_context=conversation_context)
        return parsed if isinstance(parsed, dict) else {}

    async def _complete_return_request(
        self,
        text: str,
        planned_arguments: dict[str, Any] | None,
        conversation_context: list[dict[str, str]] | None,
    ) -> dict[str, Any]:
        if not planned_arguments:
            return await self._parse_return_request_with_llm(text, conversation_context)
        if _planned_keyword(planned_arguments) and _return_quantity_args(planned_arguments):
            return planned_arguments
        parsed = await self._parse_return_request_with_llm(text, conversation_context)
        if not parsed:
            return planned_arguments
        merged = dict(parsed)
        keyword = _planned_keyword(planned_arguments)
        if keyword:
            merged["keyword"] = keyword
        planned_quantity = _return_quantity_args(planned_arguments)
        if planned_quantity:
            merged.update(planned_quantity)
        return merged

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
        candidates = extract_inventory_candidates(result, borrowable_only=action == "inventory_borrow")
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

    async def _prepare_return_candidates_from_list(
        self,
        chat_key: str,
        arguments: dict[str, Any],
        candidates: list[dict[str, Any]],
        user_text: str,
        *,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> str:
        if not candidates:
            return "没有找到可归还的匹配库存。"
        if len(candidates) == 1:
            return await self._prepare_return_single_candidate(
                chat_key,
                arguments,
                candidates[0],
                user_text,
                conversation_context,
            )
        self._save_select_state(
            chat_key,
            "inventory_return",
            arguments,
            candidates,
            user_text=user_text,
            conversation_context=conversation_context,
        )
        lines = ["找到多个可归还的库存，请回复序号："]
        lines.extend(f"{idx}. {item['display']}" for idx, item in enumerate(candidates, 1))
        lines.append("回复“取消”放弃。")
        return "\n".join(lines)

    async def _prepare_return_single_candidate(
        self,
        chat_key: str,
        arguments: dict[str, Any],
        candidate: dict[str, Any],
        user_text: str,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> str:
        try:
            return_args = await self._resolve_return_arguments(
                arguments,
                candidate,
                user_text,
                conversation_context,
            )
        except ValueError as exc:
            return str(exc)
        args = {**return_args, "inventory_id": candidate["inventory_id"]}
        self._save_confirm_state(chat_key, "inventory_return", args, candidate["display"])
        return confirm_text("inventory_return", candidate["display"], args)

    async def _resolve_return_arguments(
        self,
        arguments: dict[str, Any],
        candidate: dict[str, Any],
        user_text: str,
        conversation_context: list[dict[str, str]] | None,
    ) -> dict[str, Any]:
        llm_result = await self._resolve_return_quantity_with_llm(
            arguments,
            candidate,
            user_text,
            conversation_context,
        )
        return resolve_return_quantity_arguments(arguments, candidate, llm_result=llm_result)

    async def _resolve_return_quantity_with_llm(
        self,
        arguments: dict[str, Any],
        candidate: dict[str, Any],
        user_text: str,
        conversation_context: list[dict[str, str]] | None,
    ) -> dict[str, Any] | None:
        resolver = getattr(self.llm_planner, "resolve_return_quantity", None)
        if resolver is None:
            return None
        return await resolver(
            user_text=user_text,
            raw_arguments=arguments,
            inventory_text=str(candidate.get("display") or ""),
            current_remaining=_optional_float(candidate.get("remaining_quantity")),
            initial_quantity=_optional_float(candidate.get("initial_quantity")),
            target_unit=normalize_unit(candidate.get("unit")),
            conversation_context=conversation_context,
        )

    async def _execute_write(
        self,
        action: str,
        args: dict[str, Any],
        user_token: str,
        *,
        mcp_client: LSMMcpClient | None = None,
    ) -> str:
        tool_name = "inventory_borrow" if action == "inventory_borrow" else "inventory_return"
        tool_args = _write_tool_args(action, args, user_token)
        call_client = mcp_client or self.mcp_client
        result = await call_client.call_tool(tool_name, tool_args)
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

    def _expire_binding(self, actor: ActorContext) -> None:
        self._delete_binding(actor.userid)
        self._delete_state(actor.chat_key)

    def _bound_mcp_client(self, actor: ActorContext) -> BindingAwareMcpClient:
        return BindingAwareMcpClient(self.mcp_client, lambda: self._expire_binding(actor))

    def _get_state(self, chat_key: str) -> dict[str, Any] | None:
        return self.conversation_store.get_state(chat_key) if self.conversation_store else None

    def _save_select_state(
        self,
        chat_key: str,
        action: str,
        args: dict[str, Any],
        candidates: list[dict[str, Any]],
        *,
        user_text: str = "",
        conversation_context: list[dict[str, str]] | None = None,
    ) -> None:
        self._save_state(
            chat_key,
            {
                "type": "await_select",
                "action": action,
                "arguments": args,
                "candidates": candidates,
                "user_text": user_text,
                "conversation_context": conversation_context or [],
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

    def _save_unbind_confirm_state(self, chat_key: str) -> None:
        self._save_state(
            chat_key,
            {
                "type": "await_unbind_confirm",
                "expires_at": expires_at(),
            },
        )

    def _save_state(self, chat_key: str, state: dict[str, Any]) -> None:
        if self.conversation_store:
            self.conversation_store.save_state(chat_key, state)

    def _delete_state(self, chat_key: str) -> None:
        if self.conversation_store:
            self.conversation_store.delete_state(chat_key)

    def _get_context(self, chat_key: str) -> list[dict[str, str]]:
        return self.conversation_store.get_context(chat_key) if self.conversation_store else []

    def _append_context_turn(self, chat_key: str, user_text: str, assistant_text: str) -> None:
        if not self.conversation_store or not _should_remember_context(user_text, assistant_text):
            return
        self.conversation_store.append_context_turn(
            chat_key,
            user_text=user_text,
            assistant_text=assistant_text,
        )

    def _delete_context(self, chat_key: str) -> None:
        if self.conversation_store:
            self.conversation_store.delete_context(chat_key)


def _write_tool_args(action: str, args: dict[str, Any], user_token: str) -> dict[str, Any]:
    tool_args = {"inventory_id": args["inventory_id"], "user_token": user_token}
    if action == "inventory_return":
        tool_args["remaining_quantity"] = args["remaining_quantity"]
    return tool_args


def _return_quantity_args(parsed_request: dict[str, Any]) -> dict[str, Any]:
    mode = parsed_request.get("quantity_mode")
    value = parsed_request.get("quantity_value")
    if (
        mode not in {"used", "remaining"}
        or isinstance(value, bool)
        or not isinstance(value, (int, float))
    ):
        return {}
    return {
        "quantity_mode": mode,
        "quantity_value": float(value),
        "quantity_unit": str(parsed_request.get("quantity_unit") or "").strip(),
    }


def _planned_keyword(planned_arguments: dict[str, Any] | None) -> str:
    if not isinstance(planned_arguments, dict):
        return ""
    keyword = planned_arguments.get("keyword")
    return keyword.strip() if isinstance(keyword, str) else ""


def _should_remember_context(user_text: str, assistant_text: str) -> bool:
    if not user_text.strip() or not assistant_text.strip():
        return False
    if BIND_PATTERN.match(user_text):
        return False
    return user_text not in {"绑定状态", "我的绑定"} and not is_unbind_request(user_text)


def _state_conversation_context(state: dict[str, Any]) -> list[dict[str, str]]:
    value = state.get("conversation_context")
    if not isinstance(value, list):
        return []
    context: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        user_text = item.get("user")
        assistant_text = item.get("assistant")
        if isinstance(user_text, str) and isinstance(assistant_text, str):
            context.append({"user": user_text, "assistant": assistant_text})
    return context


def _optional_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _is_auth_failure_result(result: dict[str, Any]) -> bool:
    if result.get("ok") is True:
        return False
    if result.get("exit_code") == AUTH_FAILURE_EXIT_CODE:
        return True
    error = result.get("error")
    if isinstance(error, dict) and _looks_like_auth_error_code(error.get("code")):
        return True
    payload = result.get("payload")
    if isinstance(payload, dict):
        payload_error = payload.get("error")
        if isinstance(payload_error, dict) and _looks_like_auth_error_code(payload_error.get("code")):
            return True
    return False


def _looks_like_auth_error_code(code: Any) -> bool:
    if not isinstance(code, str):
        return False
    normalized = code.strip().upper()
    return normalized.startswith("AUTH_") or normalized in {
        "UNAUTHORIZED",
        "INVALID_TOKEN",
        "SESSION_EXPIRED",
        "SESSION_REVOKED",
    }
