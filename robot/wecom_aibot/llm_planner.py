"""LLM intent planner for the WeCom LabStorageManager robot."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any, Literal

import requests

logger = logging.getLogger(__name__)

ACTION_CALL_TOOL = "call_tool"
ACTION_HELP = "help"
ACTION_REPLY = "reply"
ALLOWED_TOOLS = {
    "lab_storage_manager_help",
    "inventory_search_by_name",
    "inventory_get_by_cas",
    "inventory_list_low_stock",
    "reagent_orders_search_by_name",
    "reagent_orders_search_by_cas",
    "reagent_orders_get_cas_overview",
    "consumable_orders_search_by_name",
    "common_shelf_search_by_alias",
    "common_shelf_search_by_cas",
}
REQUIRED_ARGUMENTS = {
    "lab_storage_manager_help": (),
    "inventory_search_by_name": ("keyword",),
    "inventory_get_by_cas": ("cas_number",),
    "inventory_list_low_stock": (),
    "reagent_orders_search_by_name": ("keyword",),
    "reagent_orders_search_by_cas": ("cas_number",),
    "reagent_orders_get_cas_overview": ("cas_number",),
    "consumable_orders_search_by_name": ("keyword",),
    "common_shelf_search_by_alias": ("keyword",),
    "common_shelf_search_by_cas": ("cas_number",),
}
OPTIONAL_ARGUMENTS = {
    "lab_storage_manager_help": ("topic",),
    "inventory_search_by_name": ("limit",),
    "inventory_list_low_stock": ("limit",),
    "reagent_orders_search_by_name": ("limit",),
    "reagent_orders_search_by_cas": ("limit",),
    "consumable_orders_search_by_name": ("limit",),
    "common_shelf_search_by_alias": ("limit",),
    "common_shelf_search_by_cas": ("limit",),
}


@dataclass(frozen=True)
class LSMToolPlan:
    action: str
    tool_name: str = ""
    arguments: dict[str, Any] | None = None
    title: str = "查询结果"
    empty_text: str = "没有查到匹配记录。"
    reply: str = ""


@dataclass(frozen=True)
class LSMIntentPlanner:
    api_key: str
    model: str
    api_url: str
    api_style: Literal["responses", "chat_completions"]
    timeout_seconds: float
    max_output_tokens: int
    search_limit: int

    async def plan(self, user_text: str) -> LSMToolPlan | None:
        payload = _build_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            search_limit=self.search_limit,
            max_output_tokens=self.max_output_tokens,
        )
        try:
            data = await asyncio.to_thread(
                _post_llm_api,
                self.api_url,
                self.api_key,
                self.timeout_seconds,
                payload,
            )
        except requests.Timeout:
            logger.warning("wecom_aibot_llm_plan_timeout")
            return None
        except requests.RequestException as exc:
            logger.warning("wecom_aibot_llm_plan_failed type=%s", type(exc).__name__)
            return None
        return _parse_plan(_extract_output_text(data))

    async def should_try_common_shelf(
        self,
        *,
        user_text: str,
        query: str,
        cas_number: str = "",
    ) -> bool | None:
        payload = _build_common_shelf_decision_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            query=query,
            cas_number=cas_number,
            max_output_tokens=min(self.max_output_tokens, 160),
        )
        try:
            data = await asyncio.to_thread(
                _post_llm_api,
                self.api_url,
                self.api_key,
                self.timeout_seconds,
                payload,
            )
        except requests.Timeout:
            logger.warning("wecom_aibot_common_shelf_decision_timeout")
            return None
        except requests.RequestException as exc:
            logger.warning("wecom_aibot_common_shelf_decision_failed type=%s", type(exc).__name__)
            return None
        return _parse_common_shelf_decision(_extract_output_text(data))

    async def resolve_cas_from_search(
        self,
        *,
        user_text: str,
        query: str,
        candidates: list[str],
        search_summary: str,
    ) -> str | None:
        if not candidates:
            return None
        payload = _build_cas_resolution_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            query=query,
            candidates=candidates,
            search_summary=search_summary,
            max_output_tokens=min(self.max_output_tokens, 240),
        )
        try:
            data = await asyncio.to_thread(
                _post_llm_api,
                self.api_url,
                self.api_key,
                self.timeout_seconds,
                payload,
            )
        except requests.Timeout:
            logger.warning("wecom_aibot_cas_resolution_timeout")
            return None
        except requests.RequestException as exc:
            logger.warning("wecom_aibot_cas_resolution_failed type=%s", type(exc).__name__)
            return None
        return _parse_cas_resolution(_extract_output_text(data), candidates)


def build_llm_planner(settings: Any) -> LSMIntentPlanner | None:
    if not settings.llm_api_key.strip():
        return None
    api_style, api_url = _resolve_llm_api_endpoint(settings)
    return LSMIntentPlanner(
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        api_url=api_url,
        api_style=api_style,
        timeout_seconds=settings.llm_timeout_seconds,
        max_output_tokens=settings.llm_max_output_tokens,
        search_limit=settings.search_limit,
    )


def _build_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    search_limit: int,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _instructions(search_limit)
    if api_style == "chat_completions":
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": user_text},
            ],
            "max_tokens": max_output_tokens,
            "temperature": 0,
            "stream": False,
        }
    return {
        "model": model,
        "instructions": instructions,
        "input": [{"role": "user", "content": user_text}],
        "max_output_tokens": max_output_tokens,
        "store": False,
    }


def _build_common_shelf_decision_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    query: str,
    cas_number: str,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _common_shelf_decision_instructions()
    user_content = json.dumps(
        {"user_text": user_text, "query": query, "cas_number": cas_number},
        ensure_ascii=False,
    )
    if api_style == "chat_completions":
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": user_content},
            ],
            "max_tokens": max_output_tokens,
            "temperature": 0,
            "stream": False,
        }
    return {
        "model": model,
        "instructions": instructions,
        "input": [
            {
                "role": "user",
                "content": user_content,
            }
        ],
        "max_output_tokens": max_output_tokens,
        "store": False,
    }


def _build_cas_resolution_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    query: str,
    candidates: list[str],
    search_summary: str,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _cas_resolution_instructions()
    user_content = json.dumps(
        {
            "user_text": user_text,
            "query": query,
            "candidate_cas_numbers": candidates[:8],
            "search_summary": search_summary[:3000],
        },
        ensure_ascii=False,
    )
    if api_style == "chat_completions":
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": user_content},
            ],
            "max_tokens": max_output_tokens,
            "temperature": 0,
            "stream": False,
        }
    return {
        "model": model,
        "instructions": instructions,
        "input": [{"role": "user", "content": user_content}],
        "max_output_tokens": max_output_tokens,
        "store": False,
    }


def _instructions(search_limit: int) -> str:
    tools = ", ".join(sorted(ALLOWED_TOOLS))
    return (
        "你是 LabStorageManager 企业微信机器人意图规划器。"
        "只输出 JSON object，不输出 Markdown。"
        "你只能选择只读查询工具，不能执行借用、归还、入库、下单、更新或删除。"
        "不要使用或暴露内部编码，用户通常不知道内部码。"
        "用户问库存、还有吗、在哪里时，必须优先选择 inventory_search_by_name "
        "或 inventory_get_by_cas，不要用主数据工具替代库存查询。"
        "不要规划联网搜索；外部搜索只允许由系统内部用于化学名称或别名解析 CAS。"
        f"允许工具：{tools}。"
        "输出格式之一："
        '{"action":"call_tool","tool_name":"工具名","arguments":{},"title":"中文标题",'
        '"empty_text":"没有查到匹配记录。"}；'
        '{"action":"help"}；'
        '{"action":"reply","reply":"简短中文回复"}。'
        f"列表查询 limit 默认 {search_limit}，最大 10。"
    )


def _common_shelf_decision_instructions() -> str:
    return (
        "你判断一个实验室查询词是否值得在常用货架中继续查询。"
        "只输出 JSON object，不输出 Markdown。"
        "常用货架通常只包含基础酸、碱、盐和常用溶剂。"
        "例如乙醇、甲醇、乙腈、丙酮、二氯甲烷、盐酸、硫酸、氢氧化钠、"
        "氯化钠、碳酸钠等返回 true。"
        "很专门的试剂、催化剂、配体、抑制剂、标准品、内标、树脂、"
        "商品名、牌号名或用途特别窄的材料通常返回 false。"
        '输出格式：{"try_common_shelf":true} 或 {"try_common_shelf":false}。'
    )


def _cas_resolution_instructions() -> str:
    return (
        "你只负责判断搜索结果里的候选 CAS 哪一个对应用户给出的化学名称或别名。"
        "只输出 JSON object，不输出 Markdown。"
        "如果候选 CAS 明确对应查询词，返回该 CAS；如果不确定，返回空字符串。"
        "不要臆造候选列表之外的 CAS。"
        '输出格式：{"cas_number":"64-17-5"} 或 {"cas_number":""}。'
    )


def _resolve_llm_api_endpoint(
    settings: Any,
) -> tuple[Literal["responses", "chat_completions"], str]:
    base_url = str(getattr(settings, "llm_base_url", "") or "").strip().rstrip("/")
    if base_url:
        return "chat_completions", f"{base_url}/chat/completions"
    return "responses", settings.llm_responses_url


def _post_llm_api(
    url: str,
    api_key: str,
    timeout_seconds: float,
    payload: dict[str, Any],
) -> dict[str, Any]:
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    return response.json()


def _parse_plan(text: str) -> LSMToolPlan | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    return _validate_plan(payload)


def _parse_common_shelf_decision(text: str) -> bool | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    decision = payload.get("try_common_shelf")
    return decision if isinstance(decision, bool) else None


def _parse_cas_resolution(text: str, candidates: list[str]) -> str | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    cas_number = payload.get("cas_number")
    if not isinstance(cas_number, str):
        return None
    normalized = cas_number.strip()
    return normalized if normalized in set(candidates) else None


def _extract_json_object_text(text: str) -> str:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`").removeprefix("json").strip()
    if "</think>" in raw:
        raw = raw.split("</think>", 1)[1].strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end < start:
        return ""
    return raw[start : end + 1]


def _validate_plan(payload: dict[str, Any]) -> LSMToolPlan | None:
    action = payload.get("action")
    if action == ACTION_HELP:
        return LSMToolPlan(action=ACTION_HELP)
    if action == ACTION_REPLY and isinstance(payload.get("reply"), str):
        return LSMToolPlan(action=ACTION_REPLY, reply=payload["reply"].strip())
    if action != ACTION_CALL_TOOL:
        return None

    tool_name = payload.get("tool_name")
    arguments = payload.get("arguments")
    if tool_name not in ALLOWED_TOOLS or not isinstance(arguments, dict):
        return None
    normalized_arguments = _normalize_tool_arguments(tool_name, arguments)
    if normalized_arguments is None:
        return None
    return LSMToolPlan(
        action=ACTION_CALL_TOOL,
        tool_name=tool_name,
        arguments=normalized_arguments,
        title=_text_or_default(payload.get("title"), "查询结果"),
        empty_text=_text_or_default(payload.get("empty_text"), "没有查到匹配记录。"),
    )


def _normalize_tool_arguments(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
    normalized = dict(arguments)
    required = REQUIRED_ARGUMENTS.get(tool_name, ())
    allowed_keys = set(required) | set(OPTIONAL_ARGUMENTS.get(tool_name, ()))

    if "keyword" in allowed_keys:
        _move_first_available(normalized, "keyword", "input", "query", "name", "text")
    if "cas_number" in allowed_keys:
        _move_first_available(normalized, "cas_number", "cas", "casNumber", "CAS")
    if any(not _is_non_empty_argument(normalized.get(key)) for key in required):
        return None
    return {key: normalized[key] for key in allowed_keys if key in normalized}


def _move_first_available(arguments: dict[str, Any], target: str, *aliases: str) -> None:
    if _is_non_empty_argument(arguments.get(target)):
        return
    for alias in aliases:
        if _is_non_empty_argument(arguments.get(alias)):
            arguments[target] = arguments[alias]
            return


def _is_non_empty_argument(value: Any) -> bool:
    return not (value is None or (isinstance(value, str) and not value.strip()))


def _text_or_default(value: Any, default: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else default


def _extract_output_text(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        first_choice = choices[0]
        if isinstance(first_choice, dict):
            message = first_choice.get("message")
            if isinstance(message, dict) and isinstance(message.get("content"), str):
                return message["content"]

    output_text = data.get("output_text")
    if isinstance(output_text, str):
        return output_text

    chunks: list[str] = []
    for item in data.get("output", []):
        if isinstance(item, dict):
            chunks.extend(_extract_content_texts(item.get("content", [])))
    return "".join(chunks)


def _extract_content_texts(content: Any) -> list[str]:
    if not isinstance(content, list):
        return []
    return [item["text"] for item in content if isinstance(item, dict) and isinstance(item.get("text"), str)]
