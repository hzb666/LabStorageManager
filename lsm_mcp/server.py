"""FastMCP server exposing fixed LabStorageManager CLI read tools."""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from lsm_mcp.cli_runner import login_lsm_cli, run_lsm_cli
from lsm_mcp.help_catalog import build_help_result

MAX_LIMIT = 100
DEFAULT_LIMIT = 50

mcp = FastMCP("LabStorageManager", stateless_http=True, json_response=True)


@mcp.tool()
def auth_login(username: str, password: str) -> dict[str, Any]:
    """登录 LabStorageManager，用于企业微信用户绑定。"""
    return login_lsm_cli(username, password)


@mcp.tool()
def lab_storage_manager_help(topic: str = "", user_token: str = "") -> dict[str, Any]:
    """列出 MCP 工具、对应 CLI 命令和机器人使用边界。"""
    _ = user_token
    return build_help_result(topic)


@mcp.tool()
def inventory_search_by_name(
    keyword: str,
    user_token: str,
    limit: int = DEFAULT_LIMIT,
    exact: bool = False,
) -> dict[str, Any]:
    """按名称搜索库存；exact=True 时使用名称精确匹配。"""
    return _run_user_cli(
        _with_exact_flag(
            ["inventory", "name", keyword, "--page-size", str(_clamp_limit(limit))],
            exact,
        ),
        user_token,
    )


@mcp.tool()
def inventory_get_by_id(inventory_id: int, user_token: str) -> dict[str, Any]:
    """按库存 ID 查看库存详情。"""
    return _run_user_cli(["inventory", "get", str(inventory_id)], user_token)


@mcp.tool()
def inventory_get_by_cas(cas_number: str, user_token: str) -> dict[str, Any]:
    """按 CAS 号查询库存概览。"""
    return _run_user_cli(["inventory", "cas", cas_number], user_token)


@mcp.tool()
def inventory_list_low_stock(user_token: str, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    """查询低库存库存列表。"""
    return _run_user_cli(
        [
            "inventory",
            "list",
            "--param",
            "status_filter=run_short",
            "--page-size",
            str(_clamp_limit(limit)),
        ],
        user_token,
    )


@mcp.tool()
def inventory_my_borrows(user_token: str) -> dict[str, Any]:
    """查询绑定用户自己的借用中库存。"""
    return _run_user_cli(["inventory", "my-borrows"], user_token)


@mcp.tool()
def inventory_pending_stockin(user_token: str) -> dict[str, Any]:
    """查询绑定用户自己的待补全入库项。"""
    return _run_user_cli(["inventory", "pending-stockin"], user_token)


@mcp.tool()
def inventory_borrow(inventory_id: int, user_token: str) -> dict[str, Any]:
    """借用库存；调用前必须完成用户绑定和二次确认。"""
    return _run_user_cli(["inventory", "borrow", str(inventory_id)], user_token)


@mcp.tool()
def inventory_return(
    inventory_id: int,
    user_token: str,
    used_quantity: float | None = None,
    remaining_quantity: float | None = None,
) -> dict[str, Any]:
    """归还库存；调用前必须完成用户绑定和二次确认。"""
    args = ["inventory", "return", str(inventory_id)]
    if used_quantity is not None:
        args.extend(["--used-quantity", str(used_quantity)])
    if remaining_quantity is not None:
        args.extend(["--remaining-quantity", str(remaining_quantity)])
    return _run_user_cli(args, user_token)


@mcp.tool()
def reagent_orders_search_by_name(
    keyword: str,
    user_token: str,
    limit: int = DEFAULT_LIMIT,
    exact: bool = False,
) -> dict[str, Any]:
    """按名称搜索试剂订单；exact=True 时使用名称精确匹配。"""
    return _run_user_cli(
        _with_exact_flag(
            ["reagent-orders", "name", keyword, "--page-size", str(_clamp_limit(limit))],
            exact,
        ),
        user_token,
    )


@mcp.tool()
def reagent_orders_search_by_cas(
    cas_number: str,
    user_token: str,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """按 CAS 号搜索试剂订单。"""
    return _run_user_cli(
        ["reagent-orders", "cas", cas_number, "--page-size", str(_clamp_limit(limit))],
        user_token,
    )


@mcp.tool()
def reagent_orders_get_by_id(order_id: int, user_token: str) -> dict[str, Any]:
    """查看单条试剂订单。"""
    return _run_user_cli(["reagent-orders", "get", str(order_id)], user_token)


@mcp.tool()
def reagent_orders_get_cas_overview(cas_number: str, user_token: str) -> dict[str, Any]:
    """查看试剂 CAS 订购与库存概览。"""
    return _run_user_cli(["reagent-orders", "cas-overview", cas_number], user_token)


@mcp.tool()
def reagent_orders_my(user_token: str) -> dict[str, Any]:
    """查询绑定用户自己的试剂订单。"""
    return _run_user_cli(["reagent-orders", "my"], user_token)


@mcp.tool()
def consumable_orders_search_by_name(
    keyword: str,
    user_token: str,
    limit: int = DEFAULT_LIMIT,
    exact: bool = False,
) -> dict[str, Any]:
    """按名称搜索耗材订单；exact=True 时使用名称精确匹配。"""
    return _run_user_cli(
        _with_exact_flag(
            ["consumable-orders", "name", keyword, "--page-size", str(_clamp_limit(limit))],
            exact,
        ),
        user_token,
    )


@mcp.tool()
def consumable_orders_get_by_id(order_id: int, user_token: str) -> dict[str, Any]:
    """查看单条耗材订单。"""
    return _run_user_cli(["consumable-orders", "get", str(order_id)], user_token)


@mcp.tool()
def consumable_orders_my(user_token: str) -> dict[str, Any]:
    """查询绑定用户自己的耗材订单。"""
    return _run_user_cli(["consumable-orders", "my"], user_token)


@mcp.tool()
def common_shelf_search_by_alias(
    keyword: str,
    user_token: str,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """按别名搜索常用货架分组。"""
    return _run_user_cli(
        ["common-shelf", "alias", keyword, "--page-size", str(_clamp_limit(limit))],
        user_token,
    )


@mcp.tool()
def common_shelf_search_by_cas(
    cas_number: str,
    user_token: str,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """按 CAS 号搜索常用货架分组。"""
    return _run_user_cli(
        ["common-shelf", "cas", cas_number, "--page-size", str(_clamp_limit(limit))],
        user_token,
    )


@mcp.tool()
def common_shelf_locations(group_key: str, user_token: str) -> dict[str, Any]:
    """查看常用货架分组的位置统计。"""
    return _run_user_cli(["common-shelf", "locations", group_key], user_token)


@mcp.tool()
def chemical_name_map_search(
    keyword: str,
    user_token: str,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """按名称、英文名、别名或 CAS 查询 CAS 主数据。"""
    return _run_user_cli(
        ["chemical-name-map", "search", keyword, "--page-size", str(_clamp_limit(limit))],
        user_token,
    )


@mcp.tool()
def chemical_name_map_search_by_cas(
    cas_number: str,
    user_token: str,
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """按 CAS 号查询 CAS 主数据。"""
    return _run_user_cli(
        ["chemical-name-map", "cas", cas_number, "--page-size", str(_clamp_limit(limit))],
        user_token,
    )


def _run_user_cli(args: list[str], user_token: str) -> dict[str, Any]:
    return run_lsm_cli(args, token=user_token, use_service_token=False)


def _with_exact_flag(args: list[str], exact: bool) -> list[str]:
    if exact:
        args.append("--exact")
    return args


def _clamp_limit(limit: int) -> int:
    return max(1, min(int(limit), MAX_LIMIT))


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
