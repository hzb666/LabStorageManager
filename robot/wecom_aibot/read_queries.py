"""Read-only query orchestration for the WeCom robot."""

from __future__ import annotations

import re
from typing import Any

from robot.wecom_aibot.common_shelf_decider import (
    common_shelf_category_from_name_map,
    has_name_map_records,
)
from robot.wecom_aibot.formatters import build_safe_facts, format_safe_facts, format_tool_result
from robot.wecom_aibot.intent_utils import (
    COMMON_SHELF_KEYWORDS,
    CONSUMABLE_ORDER_KEYWORDS,
    LOW_STOCK_KEYWORDS,
    MY_BORROW_KEYWORDS,
    MY_CONSUMABLE_ORDER_KEYWORDS,
    MY_PENDING_STOCKIN_KEYWORDS,
    MY_REAGENT_ORDER_KEYWORDS,
    REAGENT_ORDER_KEYWORDS,
    extract_cas,
    extract_query,
    has_any,
    help_text,
)
from robot.wecom_aibot.llm_planner import (
    ACTION_CALL_TOOL,
    ACTION_HELP,
    ACTION_REPLY,
    ACTION_START_BORROW,
    ACTION_START_RETURN,
    LSMIntentPlanner,
    LSMToolPlan,
    UNSUPPORTED_MCP_REPLY,
    is_safe_llm_reply,
)
from robot.wecom_aibot.mcp_client import LSMMcpClient
from robot.wecom_aibot.minimax_web_search import MiniMaxWebSearchClient

CAS_CANDIDATE_PATTERN = re.compile(r"\b\d{2,7}-\d{2}-\d\b")
GENERAL_WEB_SEARCH_KEYWORDS = (
    "联网",
    "网络",
    "互联网",
    "搜索",
    "搜一下",
    "最新",
    "新闻",
    "资料",
    "文献",
    "论文",
    "网页",
)
CAS_RESOLUTION_WEB_SEARCH_KEYWORDS = (
    "cas",
    "cas号",
    "cas 号",
    "确定cas",
    "确定 cas",
    "查cas",
    "查 cas",
    "搜cas",
    "搜 cas",
)
SPECIALTY_CAS_HINT_KEYWORDS = (
    "配体",
    "催化剂",
    "催化",
    "ligand",
    "catalyst",
    "phosphine",
    "phosphane",
    "膦",
    "钯",
    "铑",
    "钌",
    "铱",
    "镍",
    "铜",
    "铂",
    "金",
    "银",
)
CHEMICAL_ABBREVIATION_MAX_LENGTH = 48
CHEMICAL_ABBREVIATION_SYMBOLS = frozenset("()[]+-/.")
SHORT_ENGLISH_CHEMICAL_TOKEN_MIN_LENGTH = 3
SHORT_ENGLISH_CHEMICAL_TOKEN_MAX_LENGTH = 8


async def answer_with_llm_plan(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    user_token: str,
    plan: LSMToolPlan | None = None,
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    if plan is None and llm_planner is None:
        return ""
    if plan is None:
        plan = await llm_planner.plan(text, conversation_context=conversation_context)
    if plan is None:
        return ""
    if plan.action == ACTION_HELP:
        return help_text()
    if plan.action == ACTION_REPLY:
        reply = plan.reply or help_text()
        return reply if is_safe_llm_reply(reply) else UNSUPPORTED_MCP_REPLY
    if plan.action in {ACTION_START_BORROW, ACTION_START_RETURN}:
        return ""
    if plan.action != ACTION_CALL_TOOL or plan.arguments is None:
        return ""
    if plan.tool_name == "web_search":
        return "联网搜索只用于辅助识别化学名称或别名对应的 CAS（系统内部），不能干别的。"
    result = await mcp_client.call_tool(plan.tool_name, _with_user_token(plan.arguments, user_token))
    fallback = await _maybe_llm_plan_common_shelf_fallback(
        mcp_client=mcp_client,
        llm_planner=llm_planner,
        web_search_client=web_search_client,
        search_limit=search_limit,
        text=text,
        user_token=user_token,
        tool_name=plan.tool_name,
        arguments=plan.arguments,
        inventory_result=result,
    )
    if fallback:
        return await _maybe_polish_reply(
            llm_planner,
            text,
            fallback,
            conversation_context=conversation_context,
        )
    return await _format_query_result(
        result,
        title=plan.title,
        empty_text=plan.empty_text,
        llm_planner=llm_planner,
        user_text=text,
        conversation_context=conversation_context,
    )


async def answer_read_query(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    user_token: str,
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    cas_number = extract_cas(text)
    if has_any(text, MY_BORROW_KEYWORDS):
        return await _call(
            mcp_client,
            "inventory_my_borrows",
            {},
            "我的借用",
            user_token,
            llm_planner=llm_planner,
            user_text=text,
            conversation_context=conversation_context,
        )
    if has_any(text, MY_PENDING_STOCKIN_KEYWORDS):
        return await _call(
            mcp_client,
            "inventory_pending_stockin",
            {},
            "我的暂存/待补全入库",
            user_token,
            llm_planner=llm_planner,
            user_text=text,
            conversation_context=conversation_context,
        )
    if has_any(text, MY_REAGENT_ORDER_KEYWORDS):
        return await _call(
            mcp_client,
            "reagent_orders_my",
            {},
            "我的试剂订单",
            user_token,
            llm_planner=llm_planner,
            user_text=text,
            conversation_context=conversation_context,
        )
    if has_any(text, MY_CONSUMABLE_ORDER_KEYWORDS):
        return await _call(
            mcp_client,
            "consumable_orders_my",
            {},
            "我的耗材订单",
            user_token,
            llm_planner=llm_planner,
            user_text=text,
            conversation_context=conversation_context,
        )
    if has_any(text, LOW_STOCK_KEYWORDS):
        return await _call(
            mcp_client,
            "inventory_list_low_stock",
            {"limit": search_limit},
            "低库存记录",
            user_token,
            llm_planner=llm_planner,
            user_text=text,
            conversation_context=conversation_context,
        )
    if has_any(text, REAGENT_ORDER_KEYWORDS):
        return await _answer_reagent_order(
            mcp_client,
            llm_planner,
            search_limit,
            text,
            cas_number,
            user_token,
            conversation_context=conversation_context,
        )
    if has_any(text, CONSUMABLE_ORDER_KEYWORDS):
        return await _answer_consumable_order(
            mcp_client,
            llm_planner,
            search_limit,
            text,
            user_token,
            conversation_context=conversation_context,
        )
    if has_any(text, COMMON_SHELF_KEYWORDS):
        return await _answer_common_shelf(
            mcp_client,
            llm_planner,
            search_limit,
            text,
            cas_number,
            user_token,
            conversation_context=conversation_context,
        )
    if cas_number:
        return await _answer_inventory_by_cas(
            mcp_client,
            llm_planner,
            None,
            search_limit,
            text,
            cas_number,
            user_token,
            conversation_context=conversation_context,
        )
    keyword = extract_query(text)
    return await _answer_inventory_by_name(
        mcp_client,
        llm_planner,
        web_search_client,
        search_limit,
        text,
        keyword,
        user_token,
        conversation_context=conversation_context,
    )


async def _answer_reagent_order(
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    search_limit: int,
    text: str,
    cas_number: str,
    user_token: str,
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    if cas_number:
        return await _call(
            mcp_client,
            "reagent_orders_get_cas_overview",
            {"cas_number": cas_number},
            "试剂 CAS 概览",
            user_token,
            llm_planner=llm_planner,
            user_text=text,
            conversation_context=conversation_context,
        )
    keyword = extract_query(text)
    return await _call(
        mcp_client,
        "reagent_orders_search_by_name",
        {"keyword": keyword, "limit": search_limit},
        f"“{keyword}”试剂订单查询结果",
        user_token,
        llm_planner=llm_planner,
        user_text=text,
        conversation_context=conversation_context,
    )


async def _answer_consumable_order(
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    search_limit: int,
    text: str,
    user_token: str,
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    keyword = extract_query(text)
    return await _call(
        mcp_client,
        "consumable_orders_search_by_name",
        {"keyword": keyword, "limit": search_limit},
        f"“{keyword}”耗材订单查询结果",
        user_token,
        llm_planner=llm_planner,
        user_text=text,
        conversation_context=conversation_context,
    )


async def _answer_common_shelf(
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    search_limit: int,
    text: str,
    cas_number: str,
    user_token: str,
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    if cas_number:
        return await _call(
            mcp_client,
            "common_shelf_search_by_cas",
            {"cas_number": cas_number, "limit": search_limit},
            "常用货架 CAS 查询结果",
            user_token,
            llm_planner=llm_planner,
            user_text=text,
            conversation_context=conversation_context,
        )
    keyword = extract_query(text)
    return await _call(
        mcp_client,
        "common_shelf_search_by_alias",
        {"keyword": keyword, "limit": search_limit},
        f"“{keyword}”常用货架查询结果",
        user_token,
        llm_planner=llm_planner,
        user_text=text,
        conversation_context=conversation_context,
    )


async def _answer_inventory_by_cas(
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    cas_number: str,
    user_token: str,
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    result = await _raw_call(
        mcp_client,
        "inventory_get_by_cas",
        {"cas_number": cas_number},
        user_token,
    )
    fallback = await _maybe_common_shelf_fallback(
        mcp_client=mcp_client,
        llm_planner=llm_planner,
        web_search_client=web_search_client,
        search_limit=search_limit,
        text=text,
        query=cas_number,
        cas_number=cas_number,
        user_token=user_token,
        inventory_result=result,
    )
    if fallback:
        return await _maybe_polish_reply(
            llm_planner,
            text,
            fallback,
            conversation_context=conversation_context,
        )
    return await _format_query_result(
        result,
        title="库存 CAS 查询结果",
        empty_text="没有查到匹配记录。",
        llm_planner=llm_planner,
        user_text=text,
        conversation_context=conversation_context,
    )


async def _answer_inventory_by_name(
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    keyword: str,
    user_token: str,
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    result = await _raw_call(
        mcp_client,
        "inventory_search_by_name",
        {"keyword": keyword, "limit": search_limit},
        user_token,
    )
    fallback = await _maybe_common_shelf_fallback(
        mcp_client=mcp_client,
        llm_planner=llm_planner,
        web_search_client=web_search_client,
        search_limit=search_limit,
        text=text,
        query=keyword,
        cas_number="",
        user_token=user_token,
        inventory_result=result,
    )
    if fallback:
        return await _maybe_polish_reply(
            llm_planner,
            text,
            fallback,
            conversation_context=conversation_context,
        )
    return await _format_query_result(
        result,
        title=f"“{keyword}”库存查询结果",
        empty_text="没有查到匹配记录。",
        llm_planner=llm_planner,
        user_text=text,
        conversation_context=conversation_context,
    )


async def _maybe_llm_plan_common_shelf_fallback(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    user_token: str,
    tool_name: str,
    arguments: dict[str, Any],
    inventory_result: dict[str, Any],
) -> str:
    if tool_name == "inventory_get_by_cas":
        cas_number = str(arguments.get("cas_number") or "").strip()
        query = cas_number
    elif tool_name == "inventory_search_by_name":
        query = str(arguments.get("keyword") or "").strip()
        cas_number = ""
    else:
        return ""
    if not query:
        return ""
    return await _maybe_common_shelf_fallback(
        mcp_client=mcp_client,
        llm_planner=llm_planner,
        web_search_client=web_search_client,
        search_limit=search_limit,
        text=text,
        query=query,
        cas_number=cas_number,
        user_token=user_token,
        inventory_result=inventory_result,
    )


async def _maybe_common_shelf_fallback(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    query: str,
    cas_number: str,
    user_token: str,
    inventory_result: dict[str, Any],
) -> str:
    if not _is_empty_success_result(inventory_result):
        return ""
    name_map_result = await _search_chemical_name_map(
        mcp_client,
        query=query,
        cas_number=cas_number,
        user_token=user_token,
    )
    cas_resolution_allowed: bool | None = None
    if _should_try_by_master_data(name_map_result):
        return await _answer_common_shelf_fallback(
            mcp_client,
            search_limit,
            query,
            cas_number,
            user_token,
            llm_planner=llm_planner,
            user_text=text,
        )
    if has_name_map_records(name_map_result):
        resolved_cas = _first_valid_cas_from_name_map(name_map_result)
        if resolved_cas and not cas_number:
            return await _answer_with_resolved_cas(
                mcp_client=mcp_client,
                llm_planner=llm_planner,
                search_limit=search_limit,
                user_text=text,
                query=query,
                resolved_cas=resolved_cas,
                user_token=user_token,
                source_text="CAS 主数据识别 CAS",
            )
        cas_resolution_allowed = await _should_continue_cas_resolution(llm_planner, text, query)
        if not cas_resolution_allowed:
            return ""
    if not cas_number:
        cas_fallback = await _try_resolve_cas_with_knowledge(
            mcp_client=mcp_client,
            llm_planner=llm_planner,
            search_limit=search_limit,
            text=text,
            query=query,
            user_token=user_token,
        )
        if cas_fallback:
            return cas_fallback
        cas_fallback = await _try_resolve_cas_with_web_search(
            mcp_client=mcp_client,
            llm_planner=llm_planner,
            web_search_client=web_search_client,
            search_limit=search_limit,
            text=text,
            query=query,
            user_token=user_token,
            cas_resolution_allowed=cas_resolution_allowed,
        )
        if cas_fallback:
            return cas_fallback
    should_try = await _ask_llm_for_common_shelf(llm_planner, text, query, cas_number)
    if should_try is True:
        return await _answer_common_shelf_fallback(
            mcp_client,
            search_limit,
            query,
            cas_number,
            user_token,
            llm_planner=llm_planner,
            user_text=text,
        )
    return ""


async def _try_resolve_cas_with_knowledge(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    search_limit: int,
    text: str,
    query: str,
    user_token: str,
) -> str:
    resolver = getattr(llm_planner, "resolve_cas_from_knowledge", None)
    if resolver is None or not query.strip():
        return ""
    resolved_cas = _normalize_valid_cas(
        await resolver(
            user_text=text,
            query=query,
        )
    )
    if not resolved_cas:
        return ""
    return await _answer_with_resolved_cas(
        mcp_client=mcp_client,
        llm_planner=llm_planner,
        search_limit=search_limit,
        user_text=text,
        query=query,
        resolved_cas=resolved_cas,
        user_token=user_token,
        source_text="通用知识识别 CAS",
    )


async def _try_resolve_cas_with_web_search(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    query: str,
    user_token: str,
    cas_resolution_allowed: bool | None = None,
) -> str:
    if web_search_client is None or not _can_resolve_cas_with_web_search(text, query):
        return ""
    if cas_resolution_allowed is None:
        cas_resolution_allowed = await _should_continue_cas_resolution(llm_planner, text, query)
    if not cas_resolution_allowed:
        return ""
    search_result = await web_search_client.web_search(_cas_web_search_query(text, query))
    summary = _web_search_summary(search_result)
    candidates = _extract_valid_cas_numbers(summary)
    if not candidates:
        return ""
    resolved_cas = await _choose_cas_candidate(llm_planner, text, query, candidates, summary)
    if not resolved_cas:
        return ""
    return await _answer_with_resolved_cas(
        mcp_client=mcp_client,
        llm_planner=llm_planner,
        search_limit=search_limit,
        user_text=text,
        query=query,
        resolved_cas=resolved_cas,
        user_token=user_token,
        source_text="网络搜索仅用于辅助识别 CAS",
    )


async def _answer_with_resolved_cas(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    search_limit: int,
    user_text: str,
    query: str,
    resolved_cas: str,
    user_token: str,
    source_text: str,
) -> str:
    inventory_result = await _raw_call(
        mcp_client,
        "inventory_get_by_cas",
        {"cas_number": resolved_cas},
        user_token,
    )
    if not _is_empty_success_result(inventory_result):
        inventory_text = format_tool_result(
            inventory_result,
            title=f"CAS {resolved_cas} 库存查询结果",
            empty_text="没有查到匹配记录。",
        )
        reply = _resolved_cas_prefix(query, resolved_cas, source_text) + inventory_text
        return await _maybe_polish_reply(llm_planner, user_text, reply)

    name_map_result = await _search_chemical_name_map(
        mcp_client,
        query=resolved_cas,
        cas_number=resolved_cas,
        user_token=user_token,
    )
    if _should_try_by_master_data(name_map_result):
        shelf_text = await _answer_common_shelf_fallback(
            mcp_client,
            search_limit,
            resolved_cas,
            resolved_cas,
            user_token,
            llm_planner=llm_planner,
            user_text=user_text,
        )
        reply = _resolved_cas_prefix(query, resolved_cas, source_text) + shelf_text
        return await _maybe_polish_reply(llm_planner, user_text, reply)
    reply = (
        _resolved_cas_prefix(query, resolved_cas, source_text)
        + "库存和常用货架都没有查到匹配记录。"
    )
    return await _maybe_polish_reply(llm_planner, user_text, reply)


async def _choose_cas_candidate(
    llm_planner: LSMIntentPlanner | None,
    text: str,
    query: str,
    candidates: list[str],
    summary: str,
) -> str:
    if len(candidates) == 1:
        return candidates[0]
    if llm_planner is None:
        return ""
    resolved = await llm_planner.resolve_cas_from_search(
        user_text=text,
        query=query,
        candidates=candidates,
        search_summary=summary,
    )
    return resolved or ""


def _web_search_summary(result: dict[str, Any]) -> str:
    payload = result.get("payload")
    data = payload.get("data") if isinstance(payload, dict) else None
    return _compact_text(data)


def _compact_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        parts: list[str] = []
        for key in ("title", "snippet", "text", "link", "organic", "items", "results", "data"):
            if key in value:
                parts.append(_compact_text(value[key]))
        return "\n".join(part for part in parts if part)
    if isinstance(value, list):
        return "\n".join(_compact_text(item) for item in value[:8])
    return ""


def _extract_valid_cas_numbers(text: str) -> list[str]:
    seen: set[str] = set()
    candidates: list[str] = []
    for match in CAS_CANDIDATE_PATTERN.finditer(text):
        cas_number = match.group(0)
        if cas_number in seen or not _valid_cas_check_digit(cas_number):
            continue
        seen.add(cas_number)
        candidates.append(cas_number)
    return candidates[:8]


def _valid_cas_check_digit(cas_number: str) -> bool:
    compact = cas_number.replace("-", "")
    check_digit = int(compact[-1])
    sequence = compact[:-1][::-1]
    total = sum((index + 1) * int(digit) for index, digit in enumerate(sequence))
    return total % 10 == check_digit


def _normalize_valid_cas(cas_number: str | None) -> str:
    if not isinstance(cas_number, str):
        return ""
    normalized = cas_number.strip()
    if not CAS_CANDIDATE_PATTERN.fullmatch(normalized):
        return ""
    return normalized if _valid_cas_check_digit(normalized) else ""


def _first_valid_cas_from_name_map(result: dict[str, Any]) -> str:
    payload = result.get("payload")
    data = payload.get("data") if isinstance(payload, dict) else result.get("data", result)
    return _first_valid_cas_in_value(data)


def _first_valid_cas_in_value(value: Any, *, depth: int = 0) -> str:
    if depth > 5:
        return ""
    if isinstance(value, str):
        return _normalize_valid_cas(value)
    if isinstance(value, list):
        for item in value:
            cas_number = _first_valid_cas_in_value(item, depth=depth + 1)
            if cas_number:
                return cas_number
        return ""
    if not isinstance(value, dict):
        return ""

    for key in ("cas_number", "cas", "casNumber", "CAS"):
        cas_number = _first_valid_cas_in_value(value.get(key), depth=depth + 1)
        if cas_number:
            return cas_number
    for item in value.values():
        cas_number = _first_valid_cas_in_value(item, depth=depth + 1)
        if cas_number:
            return cas_number
    return ""


def _resolved_cas_prefix(query: str, cas_number: str, source_text: str) -> str:
    return (
        f"名称/别名“{query}”没有直接查到库存；"
        f"{source_text}，识别为 {cas_number}，已回到系统数据查询。\n"
    )


def _can_resolve_cas_with_web_search(text: str, query: str) -> bool:
    if not query.strip():
        return False
    if _has_explicit_cas_resolution_intent(text):
        return True
    return not has_any(text, GENERAL_WEB_SEARCH_KEYWORDS)


def _has_explicit_cas_resolution_intent(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", text).casefold()
    return any(keyword in normalized for keyword in CAS_RESOLUTION_WEB_SEARCH_KEYWORDS)


def _cas_web_search_query(text: str, query: str) -> str:
    if _should_prioritize_cas_resolution(text, query) or _has_short_english_chemical_token(query):
        return f"{query} CAS号 CAS number 配体 催化剂 ligand catalyst"
    return f"{query} CAS号 化学品"


def _should_prioritize_cas_resolution(text: str, query: str) -> bool:
    haystack = f"{text} {query}".casefold()
    if any(keyword.casefold() in haystack for keyword in SPECIALTY_CAS_HINT_KEYWORDS):
        return True
    return _looks_like_chemical_abbreviation(query)


async def _should_continue_cas_resolution(
    llm_planner: LSMIntentPlanner | None,
    text: str,
    query: str,
) -> bool:
    if _should_prioritize_cas_resolution(text, query):
        return True
    resolver = getattr(llm_planner, "should_try_cas_resolution", None)
    if resolver is None:
        return False
    return await resolver(user_text=text, query=query) is True


def _looks_like_chemical_abbreviation(query: str) -> bool:
    compact = re.sub(r"\s+", "", query.strip())
    if not 2 <= len(compact) <= CHEMICAL_ABBREVIATION_MAX_LENGTH:
        return False
    if CAS_CANDIDATE_PATTERN.fullmatch(compact):
        return False

    ascii_letters = [char for char in compact if char.isascii() and char.isalpha()]
    if not ascii_letters:
        return False
    uppercase_count = sum(1 for char in ascii_letters if char.isupper())
    if uppercase_count >= 2:
        return True
    if any(char.isdigit() or char in CHEMICAL_ABBREVIATION_SYMBOLS for char in compact):
        return True
    return False


def _has_short_english_chemical_token(query: str) -> bool:
    for token in re.findall(r"\b[A-Za-z]+\b", query):
        if SHORT_ENGLISH_CHEMICAL_TOKEN_MIN_LENGTH <= len(token) <= SHORT_ENGLISH_CHEMICAL_TOKEN_MAX_LENGTH:
            return True
    return False


async def _search_chemical_name_map(
    mcp_client: LSMMcpClient,
    *,
    query: str,
    cas_number: str,
    user_token: str,
) -> dict[str, Any]:
    if cas_number:
        return await _raw_call(
            mcp_client,
            "chemical_name_map_search_by_cas",
            {"cas_number": cas_number, "limit": 5},
            user_token,
        )
    return await _raw_call(
        mcp_client,
        "chemical_name_map_search",
        {"keyword": query, "limit": 5},
        user_token,
    )


async def _answer_common_shelf_fallback(
    mcp_client: LSMMcpClient,
    search_limit: int,
    query: str,
    cas_number: str,
    user_token: str,
    *,
    llm_planner: LSMIntentPlanner | None = None,
    user_text: str = "",
) -> str:
    if cas_number:
        result = await _raw_call(
            mcp_client,
            "common_shelf_search_by_cas",
            {"cas_number": cas_number, "limit": search_limit},
            user_token,
        )
        title = "常用货架 CAS 查询结果"
    else:
        result = await _raw_call(
            mcp_client,
            "common_shelf_search_by_alias",
            {"keyword": query, "limit": search_limit},
            user_token,
        )
        title = f"“{query}”常用货架查询结果"
    shelf_text = format_tool_result(result, title=title, empty_text="常用货架也没有查到匹配记录。")
    reply = "库存没有查到匹配记录，已继续查询常用货架。\n" + shelf_text
    return await _maybe_polish_reply(llm_planner, user_text, reply)


def _should_try_by_master_data(name_map_result: dict[str, Any]) -> bool:
    return bool(common_shelf_category_from_name_map(name_map_result))


async def _ask_llm_for_common_shelf(
    llm_planner: LSMIntentPlanner | None,
    text: str,
    query: str,
    cas_number: str,
) -> bool | None:
    if llm_planner is None:
        return None
    return await llm_planner.should_try_common_shelf(
        user_text=text,
        query=query,
        cas_number=cas_number,
    )


async def _call(
    mcp_client: LSMMcpClient,
    tool_name: str,
    arguments: dict,
    title: str,
    user_token: str,
    *,
    llm_planner: LSMIntentPlanner | None = None,
    user_text: str = "",
    empty_text: str = "没有查到匹配记录。",
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    result = await _raw_call(mcp_client, tool_name, arguments, user_token)
    return await _format_query_result(
        result,
        title=title,
        empty_text=empty_text,
        llm_planner=llm_planner,
        user_text=user_text,
        conversation_context=conversation_context,
    )


async def _format_query_result(
    result: dict[str, Any],
    *,
    title: str,
    empty_text: str,
    llm_planner: LSMIntentPlanner | None,
    user_text: str,
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    template_reply = format_tool_result(result, title=title, empty_text=empty_text)
    safe_facts = format_safe_facts(build_safe_facts(result, title=title, empty_text=empty_text))
    return await _maybe_polish_reply(
        llm_planner,
        user_text,
        template_reply,
        facts_text=safe_facts,
        conversation_context=conversation_context,
    )


async def _maybe_polish_reply(
    llm_planner: LSMIntentPlanner | None,
    user_text: str,
    template_reply: str,
    *,
    facts_text: str = "",
    conversation_context: list[dict[str, str]] | None = None,
) -> str:
    polisher = getattr(llm_planner, "polish_reply", None)
    if polisher is None:
        return template_reply
    polished = await polisher(
        user_text=user_text,
        facts_text=facts_text or template_reply,
        conversation_context=conversation_context,
    )
    if not isinstance(polished, str) or not is_safe_llm_reply(polished):
        return template_reply
    return polished or template_reply


async def _raw_call(
    mcp_client: LSMMcpClient,
    tool_name: str,
    arguments: dict,
    user_token: str,
) -> dict[str, Any]:
    return await mcp_client.call_tool(tool_name, _with_user_token(arguments, user_token))


def _with_user_token(arguments: dict, user_token: str) -> dict:
    return {**arguments, "user_token": user_token}


def _is_empty_success_result(result: dict[str, Any]) -> bool:
    payload = result.get("payload")
    if result.get("ok") is not True or not isinstance(payload, dict) or payload.get("ok") is not True:
        return False
    data = payload.get("data")
    if isinstance(data, list):
        return not data
    if not isinstance(data, dict):
        return False
    if data.get("exists_in_inventory") is False:
        return True
    for key in ("items", "records", "results", "data", "inventories", "groups"):
        value = data.get(key)
        if isinstance(value, list):
            return not value
    total = data.get("total")
    return isinstance(total, int) and total == 0
