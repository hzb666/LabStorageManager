"""LLM intent planner for the WeCom LabStorageManager robot."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from math import isfinite
from typing import Any, Literal

import requests

from lsm_mcp.help_catalog import TOOL_CATALOG

logger = logging.getLogger(__name__)

ACTION_CALL_TOOL = "call_tool"
ACTION_FINAL = "final"
ACTION_HELP = "help"
ACTION_REPLY = "reply"
ACTION_START_BORROW = "start_borrow"
ACTION_START_RETURN = "start_return"
UNSUPPORTED_MCP_REPLY = (
    "这个操作暂不支持通过企业微信机器人执行。"
    "当前机器人只开放查询、绑定、借用和归还；"
    "其他操作请到 LabStorageManager 网页端处理。"
)
READ_ONLY_TOOLS = {
    "lab_storage_manager_help",
    "inventory_search_by_name",
    "inventory_get_by_cas",
    "inventory_get_by_id",
    "inventory_list_low_stock",
    "inventory_my_borrows",
    "inventory_pending_stockin",
    "reagent_orders_search_by_name",
    "reagent_orders_search_by_cas",
    "reagent_orders_get_cas_overview",
    "reagent_orders_get_by_id",
    "reagent_orders_my",
    "consumable_orders_search_by_name",
    "consumable_orders_get_by_id",
    "consumable_orders_my",
    "common_shelf_search_by_alias",
    "common_shelf_search_by_cas",
    "common_shelf_locations",
    "chemical_name_map_search",
    "chemical_name_map_search_by_cas",
}
ALLOWED_TOOLS = READ_ONLY_TOOLS
NAME_SEARCH_TOOLS = {
    "inventory_search_by_name",
    "reagent_orders_search_by_name",
    "consumable_orders_search_by_name",
}
WRITE_START_ACTIONS = {ACTION_START_BORROW, ACTION_START_RETURN}
REQUIRED_ARGUMENTS = {
    "lab_storage_manager_help": (),
    "inventory_search_by_name": ("keyword",),
    "inventory_get_by_cas": ("cas_number",),
    "inventory_get_by_id": ("inventory_id",),
    "inventory_list_low_stock": (),
    "inventory_my_borrows": (),
    "inventory_pending_stockin": (),
    "reagent_orders_search_by_name": ("keyword",),
    "reagent_orders_search_by_cas": ("cas_number",),
    "reagent_orders_get_cas_overview": ("cas_number",),
    "reagent_orders_get_by_id": ("order_id",),
    "reagent_orders_my": (),
    "consumable_orders_search_by_name": ("keyword",),
    "consumable_orders_get_by_id": ("order_id",),
    "consumable_orders_my": (),
    "common_shelf_search_by_alias": ("keyword",),
    "common_shelf_search_by_cas": ("cas_number",),
    "common_shelf_locations": ("group_key",),
    "chemical_name_map_search": ("keyword",),
    "chemical_name_map_search_by_cas": ("cas_number",),
}
OPTIONAL_ARGUMENTS = {
    "lab_storage_manager_help": ("topic",),
    "inventory_search_by_name": ("limit", "exact"),
    "inventory_list_low_stock": ("limit",),
    "reagent_orders_search_by_name": ("limit", "exact"),
    "reagent_orders_search_by_cas": ("limit",),
    "consumable_orders_search_by_name": ("limit", "exact"),
    "common_shelf_search_by_alias": ("limit",),
    "common_shelf_search_by_cas": ("limit",),
    "chemical_name_map_search": ("limit",),
    "chemical_name_map_search_by_cas": ("limit",),
}
FORBIDDEN_REPLY_TERMS = (
    "internal_code",
    "internal code",
    "内部编码",
    "内部码",
    "token",
    "令牌",
    "密钥",
    "secret",
    "api key",
    "apikey",
    "密码",
    "authorization",
    "cookie",
    "stderr",
    "stdout",
    "traceback",
    "stacktrace",
    "stack trace",
    "堆栈",
    "异常详情",
    "接口错误详情",
    "原始错误",
    "完整错误",
    "用户id",
    "用户 id",
    "数据库id",
    "数据库 id",
    "user_id",
    "userid",
    "open_id",
    "openid",
    "external_userid",
    "open_kfid",
    "corp_id",
    "bot_id",
    "msgid",
    "chatid",
    "aibotid",
    "request_id",
    "response headers",
    "borrower_id",
    "temporary_keeper_id",
    "last_borrower_id",
    "created_by_id",
    "applicant_id",
    "requester_id",
    "config_path",
    "base_url",
    "api_url",
    ".env",
    "access_token",
    "refresh_token",
    "encodingaeskey",
    "encoding_aes_key",
    "aes key",
    "msg_signature",
    "nonce",
    "ciphertext",
    "sqlite",
    "sqlalchemy",
    "operationalerror",
    "integrityerror",
    "valueerror",
    "httpexception",
)
INTERNAL_REPLY_FIELD_PATTERN = re.compile(
    r"(?i)(^|[\s,，。；;:：\"'`({\[])"
    r"([a-z][a-z0-9]*_id|[a-z0-9_]*(?:token|secret|password|credential|session)"
    r"|[a-z0-9_]*(?:pinyin|initials|normalized|signature|nonce|cipher|encrypt|headers)"
    r"|id|userid|openid|open_kfid|external_userid|msgid|chatid|aibotid|corp_id|bot_id)"
    r"(?=$|[\s,，。；;:：=}\"'`\])])"
)
SENSITIVE_REPLY_PATTERN = re.compile(
    r"(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{20,}\.)",
    re.IGNORECASE,
)
IMPLEMENTATION_REPLY_PATTERN = re.compile(
    r"(?i)(^|[\s,，。；;:：\"'`({\[])"
    r"(?:mcp|api|facts?|tool[_\s-]?call|function[_\s-]?call|prompt|system[_\s-]?prompt|template)"
    r"(?=$|[\s,，。；;:：=}\"'`\])])|工具调用|安全过滤|提示词|系统提示|安全\s*facts?|回复模板"
)
CONTEXT_INPUT_LIMIT = 5


@dataclass(frozen=True)
class LSMToolPlan:
    action: str
    tool_name: str = ""
    arguments: dict[str, Any] | None = None
    title: str = "查询结果"
    empty_text: str = "没有查到匹配记录。"
    reply: str = ""


@dataclass(frozen=True)
class LSMReadToolStep:
    action: str
    tool_name: str = ""
    arguments: dict[str, Any] | None = None
    final_reply: str = ""


@dataclass(frozen=True)
class LSMIntentPlanner:
    api_key: str
    model: str
    api_url: str
    api_style: Literal["responses", "chat_completions"]
    timeout_seconds: float
    max_output_tokens: int
    search_limit: int

    async def _request_output_text(
        self,
        *,
        payload: dict[str, Any],
        timeout_event: str,
        failure_event: str,
    ) -> str | None:
        try:
            data = await asyncio.to_thread(
                _post_llm_api,
                self.api_url,
                self.api_key,
                self.timeout_seconds,
                payload,
            )
        except requests.Timeout:
            logger.warning(timeout_event)
            return None
        except requests.RequestException as exc:
            logger.warning("%s type=%s", failure_event, type(exc).__name__)
            return None
        return _extract_output_text(data)

    async def plan(
        self,
        user_text: str,
        *,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> LSMToolPlan | None:
        payload = _build_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            conversation_context=conversation_context,
            search_limit=self.search_limit,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_llm_plan_timeout",
            failure_event="wecom_aibot_llm_plan_failed",
        )
        return _parse_plan(output_text) if output_text else None

    async def detect_context_reset(
        self,
        *,
        user_text: str,
        conversation_context: list[dict[str, str]],
    ) -> dict[str, bool] | None:
        if not conversation_context:
            return None
        payload = _build_context_reset_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            conversation_context=conversation_context,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_context_reset_timeout",
            failure_event="wecom_aibot_context_reset_failed",
        )
        return _parse_context_reset(output_text) if output_text else None

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
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_common_shelf_decision_timeout",
            failure_event="wecom_aibot_common_shelf_decision_failed",
        )
        return _parse_common_shelf_decision(output_text) if output_text else None

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
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_cas_resolution_timeout",
            failure_event="wecom_aibot_cas_resolution_failed",
        )
        return _parse_cas_resolution(output_text, candidates) if output_text else None

    async def resolve_cas_from_knowledge(
        self,
        *,
        user_text: str,
        query: str,
    ) -> str | None:
        payload = _build_cas_knowledge_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            query=query,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_cas_knowledge_timeout",
            failure_event="wecom_aibot_cas_knowledge_failed",
        )
        return _parse_cas_knowledge_resolution(output_text) if output_text else None

    async def should_try_cas_resolution(
        self,
        *,
        user_text: str,
        query: str,
    ) -> bool | None:
        payload = _build_cas_resolution_decision_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            query=query,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_cas_resolution_decision_timeout",
            failure_event="wecom_aibot_cas_resolution_decision_failed",
        )
        return _parse_cas_resolution_decision(output_text) if output_text else None

    async def plan_read_step(
        self,
        user_text: str,
        *,
        tool_specs: list[dict[str, Any]],
        observations: list[dict[str, Any]],
        conversation_context: list[dict[str, str]] | None = None,
    ) -> LSMReadToolStep | None:
        payload = _build_read_step_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            tool_specs=tool_specs,
            observations=observations,
            conversation_context=conversation_context,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_read_tool_loop_timeout",
            failure_event="wecom_aibot_read_tool_loop_failed",
        )
        return _parse_read_tool_step(output_text) if output_text else None

    async def filter_inventory_name_candidates(
        self,
        *,
        user_text: str,
        search_keyword: str,
        candidates: list[dict[str, Any]],
    ) -> list[int] | None:
        if not candidates:
            return []
        payload = _build_inventory_name_filter_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            search_keyword=search_keyword,
            candidates=candidates,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_inventory_name_filter_timeout",
            failure_event="wecom_aibot_inventory_name_filter_failed",
        )
        return _parse_inventory_name_filter_selection(output_text, len(candidates)) if output_text else None

    async def parse_return_request(
        self,
        *,
        user_text: str,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> dict[str, Any] | None:
        payload = _build_return_request_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            conversation_context=conversation_context,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_return_request_timeout",
            failure_event="wecom_aibot_return_request_failed",
        )
        return _parse_return_request_resolution(output_text) if output_text else None

    async def resolve_return_quantity(
        self,
        *,
        user_text: str,
        raw_arguments: dict[str, Any],
        inventory_text: str,
        current_remaining: float | None,
        initial_quantity: float | None,
        target_unit: str,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> dict[str, Any] | None:
        payload = _build_return_quantity_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            raw_arguments=raw_arguments,
            inventory_text=inventory_text,
            current_remaining=current_remaining,
            initial_quantity=initial_quantity,
            target_unit=target_unit,
            conversation_context=conversation_context,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_return_quantity_timeout",
            failure_event="wecom_aibot_return_quantity_failed",
        )
        return _parse_return_quantity_resolution(output_text) if output_text else None

    async def polish_reply(
        self,
        *,
        user_text: str,
        facts_text: str,
        conversation_context: list[dict[str, str]] | None = None,
    ) -> str | None:
        if not facts_text.strip():
            return None
        payload = _build_reply_polish_payload(
            model=self.model,
            api_style=self.api_style,
            user_text=user_text,
            facts_text=facts_text,
            conversation_context=conversation_context,
            max_output_tokens=self.max_output_tokens,
        )
        output_text = await self._request_output_text(
            payload=payload,
            timeout_event="wecom_aibot_reply_polish_timeout",
            failure_event="wecom_aibot_reply_polish_failed",
        )
        if output_text is None:
            return None
        reply = output_text.strip()
        return reply if is_safe_llm_reply(reply) else None


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
    conversation_context: list[dict[str, str]] | None,
    search_limit: int,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _instructions(search_limit)
    user_content = _contextual_user_content(user_text, conversation_context)
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


def _build_context_reset_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    conversation_context: list[dict[str, str]],
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _context_reset_instructions()
    user_content = json.dumps(
        {
            "current_user_text": user_text,
            "conversation_context": _compact_conversation_context(conversation_context),
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


def _build_cas_knowledge_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    query: str,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _cas_knowledge_instructions()
    user_content = json.dumps(
        {"user_text": user_text, "query": query},
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


def _build_cas_resolution_decision_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    query: str,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _cas_resolution_decision_instructions()
    user_content = json.dumps(
        {"user_text": user_text, "query": query},
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


def _build_reply_polish_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    facts_text: str,
    conversation_context: list[dict[str, str]] | None,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _reply_polish_instructions()
    user_content = json.dumps(
        {
            "user_text": user_text,
            "conversation_context": _compact_conversation_context(conversation_context),
            "facts": facts_text[:3500],
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
            "temperature": 0.3,
            "stream": False,
        }
    return {
        "model": model,
        "instructions": instructions,
        "input": [{"role": "user", "content": user_content}],
        "max_output_tokens": max_output_tokens,
        "store": False,
    }


def _build_read_step_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    tool_specs: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    conversation_context: list[dict[str, str]] | None,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _read_step_instructions()
    user_content = json.dumps(
        {
            "current_user_text": user_text,
            "conversation_context": _compact_conversation_context(conversation_context),
            "available_tools": tool_specs,
            "observations": observations,
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


def _build_inventory_name_filter_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    search_keyword: str,
    candidates: list[dict[str, Any]],
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _inventory_name_filter_instructions()
    user_content = json.dumps(
        {
            "user_text": user_text,
            "search_keyword": search_keyword,
            "candidates": candidates[:100],
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


def _build_return_quantity_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    raw_arguments: dict[str, Any],
    inventory_text: str,
    current_remaining: float | None,
    initial_quantity: float | None,
    target_unit: str,
    conversation_context: list[dict[str, str]] | None,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _return_quantity_instructions()
    user_content = json.dumps(
        {
            "user_text": user_text,
            "conversation_context": _compact_conversation_context(conversation_context),
            "raw_arguments": raw_arguments,
            "inventory": {
                "display": inventory_text,
                "current_remaining": current_remaining,
                "initial_quantity": initial_quantity,
                "target_unit": target_unit,
            },
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


def _build_return_request_payload(
    *,
    model: str,
    api_style: Literal["responses", "chat_completions"],
    user_text: str,
    conversation_context: list[dict[str, str]] | None,
    max_output_tokens: int,
) -> dict[str, Any]:
    instructions = _return_request_instructions()
    user_content = json.dumps(
        {
            "user_text": user_text,
            "conversation_context": _compact_conversation_context(conversation_context),
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


def _contextual_user_content(
    user_text: str,
    conversation_context: list[dict[str, str]] | None,
) -> str:
    context = _compact_conversation_context(conversation_context)
    if not context:
        return user_text
    return json.dumps(
        {
            "current_user_text": user_text,
            "conversation_context": context,
        },
        ensure_ascii=False,
    )


def _compact_conversation_context(
    conversation_context: list[dict[str, str]] | None,
) -> list[dict[str, Any]]:
    if not isinstance(conversation_context, list):
        return []
    source = conversation_context[-CONTEXT_INPUT_LIMIT:]
    total = len(source)
    compact: list[dict[str, Any]] = []
    for index, item in enumerate(source, 1):
        if not isinstance(item, dict):
            continue
        user_text = item.get("user")
        assistant_text = item.get("assistant")
        if isinstance(user_text, str) and isinstance(assistant_text, str):
            user_text = user_text.strip()
            assistant_text = assistant_text.strip()
            if user_text and assistant_text:
                compact.append(
                    {
                        "recency_weight": index / total if total else 1,
                        "user": user_text[:800],
                        "assistant": assistant_text[:1200],
                    }
                )
    return compact


def _instructions(search_limit: int) -> str:
    tools = ", ".join(sorted(ALLOWED_TOOLS))
    return (
        "你是 LabStorageManager 企业微信机器人意图规划器。"
        "只输出 JSON object，不输出 Markdown。"
        "你的职责是做入口分流，不要替后续只读查询规划固定搜索路线。"
        "current_user_text 优先；conversation_context 只用于明确指代、省略或连续追问。"
        "不要把上下文当作事实来源，也不要直接回答库存、订单、借用或常用货架事实。"
        "只读查询请选择最接近的只读工具；后续系统会让只读 planner 自主多步查询。"
        "明确要领取、借用或实际使用库存时返回 start_borrow；"
        "明确要归还、登记消耗量或登记剩余量时返回 start_return。"
        "start_borrow/start_return 只进入候选展示和人工确认，不能直接写入。"
        "不能执行入库、下单、更新、删除或其他写操作。"
        "不要要求或暴露 token、密码、密钥、内部 ID、内部编码、原始错误或 MCP/API 细节。"
        "如果请求超出工具能力，用 reply 简短说明暂不支持；不要编造工具名。"
        f"允许工具：{tools}。"
        "输出格式之一："
        '{"action":"call_tool","tool_name":"工具名","arguments":{},"title":"中文标题",'
        '"empty_text":"没有查到匹配记录。"}；'
        '{"action":"start_borrow","arguments":{"keyword":"库存名称或CAS"}}；'
        '{"action":"start_return","arguments":{"keyword":"库存名称或CAS",'
        '"quantity_mode":"used或remaining","quantity_value":20,"quantity_unit":"毫升"}}；'
        '{"action":"help"}；'
        '{"action":"reply","reply":"简短中文回复"}。'
        "库存名称搜索会由系统拉取较多候选，最终回复再截断展示。"
        f"其他列表查询 limit 默认 {search_limit}。"
    )


def _context_reset_instructions() -> str:
    return (
        "你只负责判断用户这条消息是否明确要求清空或不再参考短期上下文。"
        "只输出 JSON object，不输出 Markdown。"
        "只有用户明确表达开始新对话、清空上下文、忘掉上文、不要参考前面内容时，"
        "reset 才为 true。"
        "普通换话题、查询另一个物品、纠正查询条件、否定上一个结果，都不算 reset。"
        "如果这条消息除了重置上下文之外还包含新的有效请求，continue_current_request 为 true；"
        "如果只是要求开始新对话/清空上下文，continue_current_request 为 false。"
        '输出格式：{"reset":true,"continue_current_request":false} 或 '
        '{"reset":false,"continue_current_request":true}。'
    )


def _common_shelf_decision_instructions() -> str:
    return (
        "你只判断空库存结果后是否值得补查常用/公共货架。"
        "只输出 JSON object，不输出 Markdown。"
        "如果查询词可能是实验室常备、共用、别名/简称或公共架物品，返回 true。"
        "明显不是货架物品、是账号/帮助/写操作/订单个人记录等场景，返回 false。"
        '输出格式：{"try_common_shelf":true} 或 {"try_common_shelf":false}。'
    )


def _cas_resolution_instructions() -> str:
    return (
        "你只从搜索结果候选中选择最匹配用户查询词的 CAS。"
        "只输出 JSON object，不输出 Markdown。"
        "只能选择候选结果明确支持的 CAS；不确定或候选不足时返回空字符串。"
        '输出格式：{"cas_number":"64-17-5"} 或 {"cas_number":""}。'
    )


def _cas_knowledge_instructions() -> str:
    return (
        "你只用非常确定的通用化学知识判断查询词是否有明确 CAS。"
        "只输出 JSON object，不输出 Markdown。"
        "非常确定才返回 CAS；有歧义、不确定或不是化学品时返回空字符串。"
        "不要解释，不要猜测。"
        '输出格式：{"cas_number":"64-17-5"} 或 {"cas_number":""}。'
    )


def _cas_resolution_decision_instructions() -> str:
    return (
        "你只判断空库存结果后是否值得继续为查询词寻找 CAS。"
        "只输出 JSON object，不输出 Markdown。"
        "如果查询词可能是化学品、试剂、材料、别名、英文名、商品名或缩写，返回 true。"
        "明显是系统命令、账号/帮助、写操作、普通闲聊或非化学问题时返回 false。"
        "不需要给 CAS，也不要解释。"
        '输出格式：{"try_cas_resolution":true} 或 {"try_cas_resolution":false}。'
    )


def _read_step_instructions() -> str:
    return (
        "你是 LabStorageManager 企业微信机器人只读查询规划器。"
        "只输出 JSON object，不输出 Markdown。"
        "根据 available_tools 自主规划下一步只读工具；也可以在信息足够时 final。"
        "available_tools 是工具名、用途和入参的唯一依据；不要编造工具或参数。"
        "observations 是已执行工具的安全结果；最终回复只能依据 observations。"
        "不得编造库存、位置、数量、订单状态、借用人或常用货架信息。"
        "不要要求或输出 user_token、密码、密钥、内部 ID、内部编码、原始错误、MCP/API 细节。"
        "登录、绑定、借用、归还和所有写操作不属于这个循环；遇到这些意图就 final。"
        "复杂查询可以自行拆解、召回候选并基于名称/英文名/别名筛选。"
        "chemical_name_map 只服务常用/公共货架路径，不是普通库存的通用 CAS 解析库。"
        "需要 CAS 时优先使用已查到的事实；没有事实时不要臆造。"
        "如果还需要查工具，输出："
        '{"action":"call_tool","tool_name":"工具名","arguments":{...}}。'
        "如果已经能回答或应停止，输出："
        '{"action":"final","final_reply":"简短中文回复"}。'
    )


def _inventory_name_filter_instructions() -> str:
    return (
        "你只从库存名称搜索候选中选择可能符合用户原始问题的记录。"
        "只输出 JSON object，不输出 Markdown。"
        "只能依据候选里的名称、英文名和别名判断，不要用库存数量或臆测补事实。"
        "选择最多 10 个，按相关性排序；没有可能符合的候选则返回空数组。"
        '输出格式：{"selected_indices":[1,3]}，索引来自候选的 index 字段。'
    )


def _return_quantity_instructions() -> str:
    return (
        "你只负责理解用户归还库存时表达的是用量还是归还后剩余量，并换算到库存单位。"
        "只输出 JSON object，不输出 Markdown，不执行归还。"
        "conversation_context 只用于理解用户说的“这个/上面那个”等指代；"
        "只有当前归还表达和上下文有明确对象关联时才使用上下文，"
        "换成新的库存或新任务时必须忽略无关上下文。"
        "最终计算必须以 user_text、raw_arguments 和 inventory 为准。"
        "target_unit 是库存规格单位，最终必须换算成 target_unit。"
        "如果用户没有写单位，按 target_unit 理解。"
        "只允许直接单位换算：L 和 mL；kg、g、mg；以及完全相同的计数单位。"
        "不能做密度、滴数、瓶数、浓度或开放容器估算；不确定或单位不兼容时返回 ok=false。"
        "mode 只能是 used 或 remaining；used 表示消耗/用量，remaining 表示归还后剩余/归还量。"
        '成功格式：{"ok":true,"mode":"used","source_value":0.02,'
        '"source_unit":"L","converted_value":20,"target_unit":"mL"}。'
        '失败格式：{"ok":false,"reason":"简短原因"}。'
    )


def _return_request_instructions() -> str:
    return (
        "你只负责从用户的归还库存自然语言中提取结构化信息。"
        "只输出 JSON object，不输出 Markdown，不执行归还，不查询库存。"
        "conversation_context 只用于理解用户说的“这个/刚才那个/上面那个”等指代。"
        "上下文有 recency_weight，越近越可信；"
        "只有与当前归还请求存在具体对象或流程关联时才引用，"
        "新的库存名、新 CAS 或新的任务主题必须按当前消息处理。"
        "keyword 是库存名称、别名、英文名或 CAS，应去掉归还、用量、剩余量、单位等动作和数量描述。"
        "mode 只能是 used 或 remaining。用户说用量、用了、消耗、使用了多少，mode=used；"
        "用户说剩余、还剩、归还量、归还后剩多少，mode=remaining。"
        "source_value 必须是数字；中文数字、小数、带空格表达要转换成阿拉伯数字。"
        "source_unit 保留用户表达的单位，如 毫升、mL、升、克；没有单位则返回空字符串。"
        "如果缺少库存查询词或缺少数量含义，返回 ok=false。"
        '成功格式：{"ok":true,"keyword":"乙醇","mode":"used",'
        '"source_value":20,"source_unit":"毫升"}。'
        '失败格式：{"ok":false,"reason":"简短原因"}。'
    )


def _reply_polish_instructions() -> str:
    return (
        "你是 LabStorageManager 实验室库存助手。"
        "你只负责把系统已经查询到的安全 facts 改写成自然、简洁的中文回复。"
        "严格只能使用安全 facts 中出现的信息，"
        "不得补充、猜测或编造库存、位置、数量、订单状态、借用人。"
        "facts_text 是事实来源，不是回复模板；不要照抄 JSON、标题或字段清单，"
        "不要逐字段展开。"
        "conversation_context 只用于理解当前用户问题和组织措辞，不能作为事实来源。"
        "只有上下文与当前问题有明确具体关联时才参考；"
        "当前问题换了对象或任务时，不要延续旧主题。"
        "不得输出内部编码、内部码、token、密码、密钥、stderr、traceback、"
        "接口错误详情、用户 ID 或任何内部标识。"
        "不要提到 MCP、API、工具调用、模板、facts 或安全过滤。"
        "如果 facts 表示没有查到，就结合用户问题自然说明没有查到，不要照抄固定话术。"
        "优先保留用户最关心的事实：名称、别名、CAS、规格、纯度、数量、位置、"
        "状态、借用人、暂存人、申请人、订单状态、备注。"
        "用户没有明确需要时，省略创建时间、更新时间、分类、英文名等低价值字段，"
        "让回复更短；如果这些字段能直接回答用户问题或用于区分候选，可以保留。"
        "即使用户追问，也只能使用安全 facts 中已经出现的信息，不能突破安全边界。"
        "回复 1 到 5 行，中文，纯文本，不使用 Markdown 表格。"
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


def _parse_context_reset(text: str) -> dict[str, bool] | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    reset = payload.get("reset")
    continue_request = payload.get("continue_current_request")
    if not isinstance(reset, bool):
        return None
    if not isinstance(continue_request, bool):
        continue_request = True
    return {"reset": reset, "continue_current_request": continue_request}


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


def _parse_cas_knowledge_resolution(text: str) -> str | None:
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
    return normalized or None


def _parse_cas_resolution_decision(text: str) -> bool | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    decision = payload.get("try_cas_resolution")
    return decision if isinstance(decision, bool) else None


def _parse_read_tool_step(text: str) -> LSMReadToolStep | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    action = payload.get("action")
    if action == ACTION_FINAL:
        reply = _text_or_default(payload.get("final_reply") or payload.get("reply"), "")
        if not reply:
            return None
        return LSMReadToolStep(
            action=ACTION_FINAL,
            final_reply=reply if is_safe_llm_reply(reply) else UNSUPPORTED_MCP_REPLY,
        )
    if action != ACTION_CALL_TOOL:
        return None
    tool_name = payload.get("tool_name")
    arguments = payload.get("arguments")
    if tool_name not in READ_ONLY_TOOLS or not isinstance(arguments, dict):
        return None
    normalized_arguments = _normalize_tool_arguments(tool_name, arguments)
    if normalized_arguments is None:
        return None
    return LSMReadToolStep(
        action=ACTION_CALL_TOOL,
        tool_name=tool_name,
        arguments=normalized_arguments,
    )


def _parse_inventory_name_filter_selection(text: str, candidate_count: int) -> list[int] | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    indices = payload.get("selected_indices")
    if not isinstance(indices, list):
        return None
    result: list[int] = []
    seen: set[int] = set()
    for item in indices:
        if isinstance(item, bool):
            continue
        if isinstance(item, str) and item.strip().isdigit():
            item = int(item.strip())
        if not isinstance(item, int):
            continue
        if item < 1 or item > candidate_count or item in seen:
            continue
        result.append(item)
        seen.add(item)
        if len(result) >= 10:
            break
    return result


def _parse_return_quantity_resolution(text: str) -> dict[str, Any] | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("ok") is False:
        return {"ok": False, "reason": _text_or_default(payload.get("reason"), "")}
    if payload.get("ok") is not True:
        return None
    mode = payload.get("mode")
    if mode not in {"used", "remaining"}:
        return None
    source_value = _finite_number(payload.get("source_value"))
    converted_value = _finite_number(payload.get("converted_value"))
    if source_value is None or converted_value is None:
        return None
    return {
        "ok": True,
        "mode": mode,
        "source_value": source_value,
        "source_unit": _text_or_default(payload.get("source_unit"), ""),
        "converted_value": converted_value,
        "target_unit": _text_or_default(payload.get("target_unit"), ""),
    }


def _parse_return_request_resolution(text: str) -> dict[str, Any] | None:
    raw = _extract_json_object_text(text)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return None
    keyword = _text_or_default(payload.get("keyword"), "")
    mode = payload.get("mode")
    source_value = _finite_number(payload.get("source_value"))
    if not keyword or mode not in {"used", "remaining"} or source_value is None:
        return None
    return {
        "keyword": keyword,
        "quantity_mode": mode,
        "quantity_value": source_value,
        "quantity_unit": _text_or_default(payload.get("source_unit"), ""),
    }


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
        reply = payload["reply"].strip()
        if not is_safe_llm_reply(reply):
            return LSMToolPlan(action=ACTION_REPLY, reply=UNSUPPORTED_MCP_REPLY)
        return LSMToolPlan(action=ACTION_REPLY, reply=reply)
    if action in WRITE_START_ACTIONS:
        arguments = payload.get("arguments")
        if not isinstance(arguments, dict):
            arguments = {}
        normalized_arguments = _normalize_write_start_arguments(action, arguments)
        if normalized_arguments is None:
            return None
        return LSMToolPlan(action=action, arguments=normalized_arguments)
    if action != ACTION_CALL_TOOL:
        return None

    tool_name = payload.get("tool_name")
    arguments = payload.get("arguments")
    if tool_name not in ALLOWED_TOOLS:
        return LSMToolPlan(action=ACTION_REPLY, reply=UNSUPPORTED_MCP_REPLY)
    if not isinstance(arguments, dict):
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


def _normalize_write_start_arguments(action: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
    normalized = dict(arguments)
    _move_first_available(normalized, "keyword", "input", "query", "name", "text", "cas_number")

    if action == ACTION_START_BORROW:
        keyword = _normalized_text(normalized.get("keyword"))
        return {"keyword": keyword} if keyword else None

    result: dict[str, Any] = {}
    keyword = _normalized_text(normalized.get("keyword"))
    if keyword:
        result["keyword"] = keyword

    mode = _normalized_text(normalized.get("quantity_mode") or normalized.get("mode"))
    value = _finite_number(
        normalized.get("quantity_value", normalized.get("source_value", normalized.get("value")))
    )
    if mode not in {"used", "remaining"}:
        if _finite_number(normalized.get("used_quantity")) is not None:
            mode = "used"
            value = _finite_number(normalized.get("used_quantity"))
        elif _finite_number(normalized.get("remaining_quantity")) is not None:
            mode = "remaining"
            value = _finite_number(normalized.get("remaining_quantity"))

    if mode in {"used", "remaining"} and value is not None:
        result["quantity_mode"] = mode
        result["quantity_value"] = value
        unit = normalized.get("quantity_unit") or normalized.get("source_unit") or normalized.get("unit")
        result["quantity_unit"] = _normalized_text(unit)
    return result


def _normalize_tool_arguments(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
    normalized = dict(arguments)
    required = REQUIRED_ARGUMENTS.get(tool_name, ())
    allowed_keys = set(required) | set(OPTIONAL_ARGUMENTS.get(tool_name, ()))

    if "keyword" in allowed_keys:
        _move_first_available(normalized, "keyword", "input", "query", "name", "text")
    if "cas_number" in allowed_keys:
        _move_first_available(normalized, "cas_number", "cas", "casNumber", "CAS")
    if "inventory_id" in allowed_keys:
        _move_first_available(normalized, "inventory_id", "id", "inventoryId")
    if "order_id" in allowed_keys:
        _move_first_available(normalized, "order_id", "id", "orderId")
    if "group_key" in allowed_keys:
        _move_first_available(normalized, "group_key", "groupKey")
    if tool_name in NAME_SEARCH_TOOLS:
        _normalize_optional_bool(normalized, "exact")
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


def _normalized_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _normalize_optional_bool(arguments: dict[str, Any], key: str) -> None:
    if key not in arguments:
        return
    value = arguments[key]
    if isinstance(value, bool):
        return
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "y", "on"}:
            arguments[key] = True
            return
        if normalized in {"0", "false", "no", "n", "off"}:
            arguments[key] = False
            return
    arguments.pop(key, None)


def _text_or_default(value: Any, default: str) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else default


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.strip()
        if not re.fullmatch(r"-?\d+(?:\.\d+)?", value):
            return None
    if not isinstance(value, (int, float, str)):
        return None
    number = float(value)
    return number if isfinite(number) else None


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


def is_safe_llm_reply(reply: str) -> bool:
    if not reply or len(reply) > 1800:
        return False
    lowered = reply.casefold()
    if any(word.casefold() in lowered for word in FORBIDDEN_REPLY_TERMS):
        return False
    if INTERNAL_REPLY_FIELD_PATTERN.search(reply):
        return False
    if IMPLEMENTATION_REPLY_PATTERN.search(reply):
        return False
    return not SENSITIVE_REPLY_PATTERN.search(reply)


def build_read_tool_specs() -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for item in TOOL_CATALOG:
        name = item.get("name")
        if name not in READ_ONLY_TOOLS:
            continue
        specs.append(
            {
                "name": name,
                "arguments": {
                    "required": list(REQUIRED_ARGUMENTS.get(str(name), ())),
                    "optional": list(OPTIONAL_ARGUMENTS.get(str(name), ())),
                },
                "description": item.get("description") or item.get("robot") or "",
                "write": False,
            }
        )
    return specs
