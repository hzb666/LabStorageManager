"""Read-only query orchestration for the WeCom robot."""

from __future__ import annotations

import re
from typing import Any

from robot.wecom_aibot.common_shelf_decider import (
    common_shelf_category_from_name_map,
    has_name_map_records,
)
from robot.wecom_aibot.formatters import format_tool_result
from robot.wecom_aibot.intent_utils import (
    COMMON_SHELF_KEYWORDS,
    CONSUMABLE_ORDER_KEYWORDS,
    LOW_STOCK_KEYWORDS,
    REAGENT_ORDER_KEYWORDS,
    extract_cas,
    extract_query,
    has_any,
    help_text,
)
from robot.wecom_aibot.llm_planner import ACTION_CALL_TOOL, ACTION_HELP, ACTION_REPLY, LSMIntentPlanner
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


async def answer_with_llm_plan(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    user_token: str,
) -> str:
    if llm_planner is None:
        return ""
    plan = await llm_planner.plan(text)
    if plan is None:
        return ""
    if plan.action == ACTION_HELP:
        return help_text()
    if plan.action == ACTION_REPLY:
        return plan.reply or help_text()
    if plan.action != ACTION_CALL_TOOL or plan.arguments is None:
        return ""
    if plan.tool_name == "web_search":
        return "联网搜索只用于辅助识别化学名称或别名对应的 CAS，不能作为通用搜索回答。"
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
        return fallback
    return format_tool_result(result, title=plan.title, empty_text=plan.empty_text)


async def answer_read_query(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    user_token: str,
) -> str:
    cas_number = extract_cas(text)
    if has_any(text, LOW_STOCK_KEYWORDS):
        return await _call(
            mcp_client,
            "inventory_list_low_stock",
            {"limit": search_limit},
            "低库存记录",
            user_token,
        )
    if has_any(text, REAGENT_ORDER_KEYWORDS):
        return await _answer_reagent_order(mcp_client, search_limit, text, cas_number, user_token)
    if has_any(text, CONSUMABLE_ORDER_KEYWORDS):
        return await _answer_consumable_order(mcp_client, search_limit, text, user_token)
    if has_any(text, COMMON_SHELF_KEYWORDS):
        return await _answer_common_shelf(mcp_client, search_limit, text, cas_number, user_token)
    if cas_number:
        return await _answer_inventory_by_cas(
            mcp_client,
            llm_planner,
            None,
            search_limit,
            text,
            cas_number,
            user_token,
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
    )


async def _answer_reagent_order(
    mcp_client: LSMMcpClient,
    search_limit: int,
    text: str,
    cas_number: str,
    user_token: str,
) -> str:
    if cas_number:
        return await _call(
            mcp_client,
            "reagent_orders_get_cas_overview",
            {"cas_number": cas_number},
            "试剂 CAS 概览",
            user_token,
        )
    keyword = extract_query(text)
    return await _call(
        mcp_client,
        "reagent_orders_search_by_name",
        {"keyword": keyword, "limit": search_limit},
        f"“{keyword}”试剂订单查询结果",
        user_token,
    )


async def _answer_consumable_order(
    mcp_client: LSMMcpClient,
    search_limit: int,
    text: str,
    user_token: str,
) -> str:
    keyword = extract_query(text)
    return await _call(
        mcp_client,
        "consumable_orders_search_by_name",
        {"keyword": keyword, "limit": search_limit},
        f"“{keyword}”耗材订单查询结果",
        user_token,
    )


async def _answer_common_shelf(
    mcp_client: LSMMcpClient,
    search_limit: int,
    text: str,
    cas_number: str,
    user_token: str,
) -> str:
    if cas_number:
        return await _call(
            mcp_client,
            "common_shelf_search_by_cas",
            {"cas_number": cas_number, "limit": search_limit},
            "常用货架 CAS 查询结果",
            user_token,
        )
    keyword = extract_query(text)
    return await _call(
        mcp_client,
        "common_shelf_search_by_alias",
        {"keyword": keyword, "limit": search_limit},
        f"“{keyword}”常用货架查询结果",
        user_token,
    )


async def _answer_inventory_by_cas(
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    cas_number: str,
    user_token: str,
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
        return fallback
    return format_tool_result(result, title="库存 CAS 查询结果", empty_text="没有查到匹配记录。")


async def _answer_inventory_by_name(
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    keyword: str,
    user_token: str,
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
        return fallback
    return format_tool_result(result, title=f"“{keyword}”库存查询结果", empty_text="没有查到匹配记录。")


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
    if _should_try_by_master_data(name_map_result):
        return await _answer_common_shelf_fallback(mcp_client, search_limit, query, cas_number, user_token)
    if has_name_map_records(name_map_result):
        return ""
    if not cas_number:
        cas_fallback = await _try_resolve_cas_with_web_search(
            mcp_client=mcp_client,
            llm_planner=llm_planner,
            web_search_client=web_search_client,
            search_limit=search_limit,
            text=text,
            query=query,
            user_token=user_token,
        )
        if cas_fallback:
            return cas_fallback
    should_try = await _ask_llm_for_common_shelf(llm_planner, text, query, cas_number)
    if should_try is True:
        return await _answer_common_shelf_fallback(mcp_client, search_limit, query, cas_number, user_token)
    return ""


async def _try_resolve_cas_with_web_search(
    *,
    mcp_client: LSMMcpClient,
    llm_planner: LSMIntentPlanner | None,
    web_search_client: MiniMaxWebSearchClient | None,
    search_limit: int,
    text: str,
    query: str,
    user_token: str,
) -> str:
    if web_search_client is None or not _can_resolve_cas_with_web_search(text, query):
        return ""
    search_result = await web_search_client.web_search(f"{query} CAS号 化学品")
    summary = _web_search_summary(search_result)
    candidates = _extract_valid_cas_numbers(summary)
    if not candidates:
        return ""
    resolved_cas = await _choose_cas_candidate(llm_planner, text, query, candidates, summary)
    if not resolved_cas:
        return ""
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
        return _resolved_cas_prefix(query, resolved_cas) + inventory_text

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
        )
        return _resolved_cas_prefix(query, resolved_cas) + shelf_text
    return _resolved_cas_prefix(query, resolved_cas) + "库存和常用货架都没有查到匹配记录。"


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


def _resolved_cas_prefix(query: str, cas_number: str) -> str:
    return (
        f"名称/别名“{query}”没有直接查到库存；"
        f"联网仅用于辅助识别 CAS，识别为 {cas_number}，已回到系统数据查询。\n"
    )


def _can_resolve_cas_with_web_search(text: str, query: str) -> bool:
    if not query.strip():
        return False
    return not has_any(text, GENERAL_WEB_SEARCH_KEYWORDS)


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
    return "库存没有查到匹配记录，已继续查询常用货架。\n" + shelf_text


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
) -> str:
    result = await _raw_call(mcp_client, tool_name, arguments, user_token)
    return format_tool_result(result, title=title, empty_text="没有查到匹配记录。")


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
