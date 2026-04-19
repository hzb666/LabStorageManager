"""Help catalog shared by the LabStorageManager MCP server and documentation."""

from __future__ import annotations

from typing import Any

TOOL_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "name": "lab_storage_manager_help",
        "cli": "n/a",
        "robot": "工具目录查询",
        "requires_binding": False,
        "write": False,
        "description": "列出 MCP 工具、对应 CLI 命令和机器人使用边界。",
    },
    {
        "name": "auth_login",
        "cli": "auth login --username <username> --password-stdin",
        "robot": "私聊绑定 LabStorageManager 账号",
        "requires_binding": False,
        "write": False,
        "description": "登录并返回用户 token；密码不得在回复中复述。",
    },
    {
        "name": "inventory_search_by_name",
        "cli": "inventory name <keyword>",
        "robot": "查询库存名称、别名、英文名或位置",
        "requires_binding": True,
        "write": False,
        "description": "按名称搜索库存；库存为空时机器人可追加 CAS 主数据和常用货架查询。",
    },
    {
        "name": "inventory_get_by_cas",
        "cli": "inventory cas <cas_number>",
        "robot": "按 CAS 查询库存",
        "requires_binding": True,
        "write": False,
        "description": "按 CAS 查询库存概览；库存为空时机器人可追加常用货架查询。",
    },
    {
        "name": "inventory_get_by_id",
        "cli": "inventory get <inventory_id>",
        "robot": "确认候选详情",
        "requires_binding": True,
        "write": False,
        "description": "按库存 ID 查询详情；用户通常不需要知道内部 ID。",
    },
    {
        "name": "inventory_list_low_stock",
        "cli": "inventory list --param status_filter=run_short",
        "robot": "查询低库存",
        "requires_binding": True,
        "write": False,
        "description": "查询低库存记录。",
    },
    {
        "name": "inventory_my_borrows",
        "cli": "inventory my-borrows",
        "robot": "查询本人借用中库存",
        "requires_binding": True,
        "write": False,
        "description": "只返回绑定用户自己的借用记录。",
    },
    {
        "name": "inventory_borrow",
        "cli": "inventory borrow <inventory_id>",
        "robot": "借用库存",
        "requires_binding": True,
        "write": True,
        "description": "写操作；机器人必须先展示候选并收到确认后才能执行。",
    },
    {
        "name": "inventory_return",
        "cli": "inventory return <inventory_id> --used-quantity/--remaining-quantity",
        "robot": "归还库存",
        "requires_binding": True,
        "write": True,
        "description": "写操作；机器人必须先确认用量或剩余量，再收到确认后执行。",
    },
    {
        "name": "reagent_orders_search_by_name",
        "cli": "reagent-orders name <keyword>",
        "robot": "查询试剂订单",
        "requires_binding": True,
        "write": False,
        "description": "按名称搜索试剂订单。",
    },
    {
        "name": "reagent_orders_search_by_cas",
        "cli": "reagent-orders cas <cas_number>",
        "robot": "按 CAS 查询试剂订单",
        "requires_binding": True,
        "write": False,
        "description": "按 CAS 搜索试剂订单。",
    },
    {
        "name": "reagent_orders_get_cas_overview",
        "cli": "reagent-orders cas-overview <cas_number>",
        "robot": "查询试剂 CAS 概览",
        "requires_binding": True,
        "write": False,
        "description": "查看指定 CAS 的订购与库存概览。",
    },
    {
        "name": "consumable_orders_search_by_name",
        "cli": "consumable-orders name <keyword>",
        "robot": "查询耗材订单",
        "requires_binding": True,
        "write": False,
        "description": "按名称搜索耗材订单。",
    },
    {
        "name": "common_shelf_search_by_alias",
        "cli": "common-shelf alias <keyword>",
        "robot": "查询常用货架",
        "requires_binding": True,
        "write": False,
        "description": "按名称、别名或英文名查询常用货架分组。",
    },
    {
        "name": "common_shelf_search_by_cas",
        "cli": "common-shelf cas <cas_number>",
        "robot": "按 CAS 查询常用货架",
        "requires_binding": True,
        "write": False,
        "description": "按 CAS 查询常用货架分组。",
    },
    {
        "name": "chemical_name_map_search",
        "cli": "chemical-name-map search <keyword>",
        "robot": "库存为空时辅助判断常用货架",
        "requires_binding": True,
        "write": False,
        "description": "查询 CAS 主数据名称、英文名、别名和分类。",
    },
    {
        "name": "chemical_name_map_search_by_cas",
        "cli": "chemical-name-map cas <cas_number>",
        "robot": "CAS 库存为空时辅助判断常用货架",
        "requires_binding": True,
        "write": False,
        "description": "按 CAS 精确查询 CAS 主数据和分类。",
    },
)


def build_help_result(topic: str = "") -> dict[str, Any]:
    """Return a CLI-style MCP result containing the exposed tool catalog."""
    tools = list(_filter_tools(topic))
    data = {
        "items": tools,
        "tools": tools,
        "count": len(tools),
        "notes": [
            "所有业务查询、借用和归还都需要绑定用户 token。",
            "借用和归还是写操作，机器人必须先展示候选并等待用户确认。",
            "内部编码不面向企业微信用户展示。",
        ],
    }
    return {"ok": True, "exit_code": 0, "payload": {"ok": True, "data": data}, "stderr": ""}


def _filter_tools(topic: str) -> tuple[dict[str, Any], ...]:
    normalized = topic.strip().casefold()
    if not normalized:
        return TOOL_CATALOG
    return tuple(item for item in TOOL_CATALOG if _matches_topic(item, normalized))


def _matches_topic(item: dict[str, Any], normalized_topic: str) -> bool:
    haystack = " ".join(
        str(item.get(key) or "")
        for key in ("name", "cli", "robot", "description")
    ).casefold()
    return normalized_topic in haystack
