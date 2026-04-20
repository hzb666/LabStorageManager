"""Self-tests for WeCom robot read-query orchestration."""

from __future__ import annotations

import asyncio
import unittest
from typing import Any

from robot.wecom_aibot.llm_planner import (
    ACTION_CALL_TOOL,
    ACTION_REPLY,
    ACTION_START_BORROW,
    ACTION_START_RETURN,
    LSMToolPlan,
    _cas_resolution_decision_instructions,
    _compact_conversation_context,
    _instructions,
    _parse_name_search_broaden_queries,
    _parse_plan,
    is_safe_llm_reply,
)
from robot.wecom_aibot.read_queries import answer_read_query, answer_with_llm_plan


class FakeMcpClient:
    def __init__(self, responses: dict[str, dict[str, Any]]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, arguments))
        return self.responses.get(name, _ok_data({"items": [], "total": 0}))


class FakeCommonShelfPlanner:
    def __init__(self, decision: bool | None) -> None:
        self.decision = decision
        self.calls: list[dict[str, str]] = []

    async def should_try_common_shelf(
        self,
        *,
        user_text: str,
        query: str,
        cas_number: str = "",
        **_: Any,
    ) -> bool | None:
        self.calls.append({"user_text": user_text, "query": query, "cas_number": cas_number})
        return self.decision


class FakeKnowledgePlanner(FakeCommonShelfPlanner):
    def __init__(self, cas_number: str | None) -> None:
        super().__init__(decision=None)
        self.cas_number = cas_number
        self.knowledge_calls: list[dict[str, str]] = []

    async def resolve_cas_from_knowledge(self, *, user_text: str, query: str, **_: Any) -> str | None:
        self.knowledge_calls.append({"user_text": user_text, "query": query})
        return self.cas_number


class FakeCasResolutionDecisionPlanner(FakeCommonShelfPlanner):
    def __init__(self, decision: bool | None) -> None:
        super().__init__(decision=None)
        self.cas_resolution_decision = decision
        self.cas_decision_calls: list[dict[str, str]] = []

    async def should_try_cas_resolution(
        self,
        *,
        user_text: str,
        query: str,
        **_: Any,
    ) -> bool | None:
        self.cas_decision_calls.append({"user_text": user_text, "query": query})
        return self.cas_resolution_decision


class FakePlanPlanner:
    def __init__(self, plan: LSMToolPlan) -> None:
        self.plan_result = plan

    async def plan(self, user_text: str, **_: Any) -> LSMToolPlan:
        return self.plan_result


class FakePolishPlanner:
    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.calls: list[dict[str, str]] = []

    async def polish_reply(self, *, user_text: str, facts_text: str, **_: Any) -> str:
        self.calls.append({"user_text": user_text, "facts_text": facts_text})
        return self.reply


class FakeBroadenPlanner:
    def __init__(self, queries: list[str], reply: str) -> None:
        self.queries = queries
        self.reply = reply
        self.broaden_calls: list[dict[str, str]] = []
        self.polish_calls: list[dict[str, str]] = []

    async def broaden_name_search_queries(self, *, user_text: str, failed_query: str) -> list[str]:
        self.broaden_calls.append({"user_text": user_text, "failed_query": failed_query})
        return self.queries

    async def polish_reply(self, *, user_text: str, facts_text: str, **_: Any) -> str:
        self.polish_calls.append({"user_text": user_text, "facts_text": facts_text})
        return self.reply


class KeywordInventoryMcpClient(FakeMcpClient):
    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, arguments))
        if name == "inventory_search_by_name":
            keyword = arguments.get("keyword")
            if keyword == "对位取代苯胺":
                return _empty_inventory()
            if keyword == "苯胺":
                return _aniline_inventory()
        return self.responses.get(name, _ok_data({"items": [], "total": 0}))


class FakeWebSearchClient:
    def __init__(self, response_text: str = "MiniMax API 文档。") -> None:
        self.calls: list[str] = []
        self.response_text = response_text

    async def web_search(self, query: str) -> dict[str, Any]:
        self.calls.append(query)
        return _ok_data(
            {
                "organic": [
                    {
                        "title": "搜索结果",
                        "link": "https://platform.minimaxi.com",
                        "snippet": self.response_text,
                    }
                ],
                "related_searches": [],
            }
        )


def _ok_data(data: dict[str, Any]) -> dict[str, Any]:
    return {"ok": True, "exit_code": 0, "payload": {"ok": True, "data": data}}


def _empty_inventory() -> dict[str, Any]:
    return _ok_data({"items": [], "total": 0, "skip": 0, "limit": 5})


def _inventory_item() -> dict[str, Any]:
    return _ok_data(
        {
            "items": [
                {
                    "id": 12,
                    "name": "乙醇",
                    "english_name": "Ethanol",
                    "alias": "酒精",
                    "cas_number": "64-17-5",
                    "purity": "AR",
                    "specification": "500ml",
                    "remaining_quantity": 300,
                    "unit": "ml",
                    "storage_location": "A-01",
                    "internal_code": "LSM-SECRET-001",
                }
            ],
            "total": 1,
        }
    )


def _aniline_inventory() -> dict[str, Any]:
    return _ok_data(
        {
            "items": [
                {
                    "id": 51,
                    "name": "4-溴苯胺",
                    "english_name": "4-Bromoaniline",
                    "cas_number": "106-40-1",
                    "remaining_quantity": 25,
                    "unit": "g",
                    "storage_location": "B-01",
                },
                {
                    "id": 52,
                    "name": "2-氯苯胺",
                    "english_name": "2-Chloroaniline",
                    "cas_number": "95-51-2",
                    "remaining_quantity": 10,
                    "unit": "g",
                    "storage_location": "B-02",
                },
            ],
            "total": 2,
        }
    )


def _empty_cas_inventory() -> dict[str, Any]:
    return _ok_data(
        {
            "cas_number": "64-17-5",
            "exists_in_inventory": False,
            "total_remaining": 0,
            "items": [],
        }
    )


def _name_map(category: str) -> dict[str, Any]:
    return _ok_data(
        {
            "data": [
                {
                    "cas_number": "64-17-5",
                    "name": "乙醇",
                    "english_name": "Ethanol",
                    "category": category,
                }
            ],
            "total": 1,
        }
    )


def _name_map_record(record: dict[str, Any]) -> dict[str, Any]:
    return _ok_data({"data": [record], "total": 1})


def _common_shelf() -> dict[str, Any]:
    return _ok_data(
        {
            "groups": [
                {
                    "group": {
                        "name": "乙醇",
                        "cas_number": "64-17-5",
                        "bottle_count": 2,
                        "storage_location": "A-01",
                    }
                }
            ],
            "total": 1,
        }
    )


def _my_borrows() -> dict[str, Any]:
    return _ok_data(
        {
            "items": [
                {
                    "id": 12,
                    "name": "乙醇",
                    "cas_number": "64-17-5",
                    "remaining_quantity": 300,
                    "unit": "ml",
                    "storage_location": "A-01",
                    "status": "borrowed",
                    "borrower_name": "胡志斌",
                }
            ],
            "total": 1,
        }
    )


def _my_reagent_orders() -> dict[str, Any]:
    return _ok_data(
        {
            "items": [
                {
                    "id": 21,
                    "name": "乙腈",
                    "cas_number": "75-05-8",
                    "specification": "4L",
                    "quantity": 2,
                    "applicant_name": "胡志斌",
                    "status": "pending",
                    "notes": "HPLC",
                }
            ],
            "total": 1,
        }
    )


def _my_consumable_orders() -> dict[str, Any]:
    return _ok_data(
        {
            "items": [
                {
                    "id": 31,
                    "name": "手套",
                    "specification": "M",
                    "quantity": 3,
                    "applicant_name": "胡志斌",
                    "communication": "优先现货",
                }
            ],
            "total": 1,
        }
    )


def _pending_stockin() -> dict[str, Any]:
    return _ok_data(
        {
            "items": [
                {
                    "id": 41,
                    "name": "乙醇",
                    "cas_number": "64-17-5",
                    "temporary_keeper_name": "胡志斌",
                    "storage_location": "暂存架",
                    "notes": "待补位置",
                    "internal_code": "LSM-SECRET-001",
                }
            ],
            "total": 1,
        }
    )


class WecomReadQuerySelfTest(unittest.TestCase):
    def test_planner_instructions_do_not_force_inventory_search_for_stock_words(self) -> None:
        instructions = _instructions(5)

        self.assertNotIn("必须优先选择 inventory_search_by_name", instructions)
        self.assertNotIn("通常选择 start_borrow", instructions)
        self.assertNotIn("只有查询词明显是实验室非常常用", instructions)
        self.assertIn("不要被单个关键词固定到某个工具", instructions)
        self.assertIn("不等同于 exact=true", instructions)

    def test_cas_resolution_prompt_encourages_ligand_catalyst_web_fallback(self) -> None:
        instructions = _cas_resolution_decision_instructions()

        self.assertIn("配体、催化剂", instructions)
        self.assertIn("更应返回 true", instructions)
        self.assertIn("受限联网搜索只找 CAS", instructions)

    def test_inventory_empty_query_uses_llm_broadened_keyword(self) -> None:
        mcp = KeywordInventoryMcpClient({})
        planner = FakeBroadenPlanner(
            queries=["苯胺"],
            reply="没有直接查到“对位取代苯胺”；按“苯胺”查到 4-溴苯胺，位置 B-01。",
        )

        reply = asyncio.run(
            answer_with_llm_plan(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=None,
                search_limit=5,
                text="查一下对位取代苯胺还有吗",
                user_token="token",
                plan=LSMToolPlan(
                    action=ACTION_CALL_TOOL,
                    tool_name="inventory_search_by_name",
                    arguments={"keyword": "对位取代苯胺", "limit": 5},
                    title="库存查询结果",
                ),
            )
        )

        self.assertIn("4-溴苯胺", reply)
        self.assertEqual(
            [{"user_text": "查一下对位取代苯胺还有吗", "failed_query": "对位取代苯胺"}],
            planner.broaden_calls,
        )
        self.assertIn(
            ("inventory_search_by_name", {"keyword": "对位取代苯胺", "limit": 5, "user_token": "token"}),
            mcp.calls,
        )
        self.assertIn(
            ("inventory_search_by_name", {"keyword": "苯胺", "limit": 5, "user_token": "token"}),
            mcp.calls,
        )
        self.assertIn("4-溴苯胺", planner.polish_calls[0]["facts_text"])

    def test_parse_name_search_broaden_queries_filters_original_and_duplicates(self) -> None:
        queries = _parse_name_search_broaden_queries(
            '{"queries":["对位取代苯胺","苯胺","苯胺","aniline",4]}',
            "对位取代苯胺",
        )

        self.assertEqual(["苯胺", "aniline"], queries)

    def test_empty_inventory_uses_master_data_before_common_shelf(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _name_map("solvent"),
                "common_shelf_search_by_alias": _common_shelf(),
            }
        )

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=None,
                search_limit=5,
                text="查询乙醇库存",
                user_token="token",
            )
        )

        self.assertIn("库存没有查到匹配记录", reply)
        self.assertIn("常用货架", reply)
        self.assertIn(("common_shelf_search_by_alias", {"keyword": "乙醇", "limit": 5, "user_token": "token"}), mcp.calls)

    def test_contains_inventory_name_query_keeps_default_mcp_call(self) -> None:
        mcp = FakeMcpClient({"inventory_search_by_name": _inventory_item()})

        asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=None,
                search_limit=5,
                text="查询乙醇库存",
                user_token="token",
            )
        )

        self.assertIn(
            ("inventory_search_by_name", {"keyword": "乙醇", "limit": 5, "user_token": "token"}),
            mcp.calls,
        )

    def test_my_borrows_query_calls_dashboard_tool(self) -> None:
        mcp = FakeMcpClient({"inventory_my_borrows": _my_borrows()})

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=None,
                search_limit=5,
                text="我借了哪些",
                user_token="token",
            )
        )

        self.assertIn("我的借用", reply)
        self.assertIn("乙醇", reply)
        self.assertIn(("inventory_my_borrows", {"user_token": "token"}), mcp.calls)

    def test_my_reagent_orders_query_calls_dashboard_tool(self) -> None:
        mcp = FakeMcpClient({"reagent_orders_my": _my_reagent_orders()})

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=None,
                search_limit=5,
                text="我的试剂订单",
                user_token="token",
            )
        )

        self.assertIn("我的试剂订单", reply)
        self.assertIn("乙腈", reply)
        self.assertIn(("reagent_orders_my", {"user_token": "token"}), mcp.calls)
        self.assertNotIn("reagent_orders_search_by_name", [name for name, _ in mcp.calls])

    def test_my_consumable_orders_query_calls_dashboard_tool(self) -> None:
        mcp = FakeMcpClient({"consumable_orders_my": _my_consumable_orders()})

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=None,
                search_limit=5,
                text="我的耗材订单",
                user_token="token",
            )
        )

        self.assertIn("我的耗材订单", reply)
        self.assertIn("手套", reply)
        self.assertIn(("consumable_orders_my", {"user_token": "token"}), mcp.calls)
        self.assertNotIn("consumable_orders_search_by_name", [name for name, _ in mcp.calls])

    def test_my_pending_stockin_query_calls_dashboard_tool(self) -> None:
        mcp = FakeMcpClient({"inventory_pending_stockin": _pending_stockin()})

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=None,
                search_limit=5,
                text="我的暂存",
                user_token="token",
            )
        )

        self.assertIn("待补全入库", reply)
        self.assertIn("暂存人 胡志斌", reply)
        self.assertNotIn("LSM-SECRET-001", reply)
        self.assertIn(("inventory_pending_stockin", {"user_token": "token"}), mcp.calls)

    def test_read_query_can_use_llm_polished_reply(self) -> None:
        mcp = FakeMcpClient({"inventory_search_by_name": _inventory_item()})
        planner = FakePolishPlanner("乙醇还有 300ml，在 A-01。CAS 是 64-17-5。")

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=None,
                search_limit=5,
                text="乙醇在哪里",
                user_token="token",
            )
        )

        self.assertEqual("乙醇还有 300ml，在 A-01。CAS 是 64-17-5。", reply)
        self.assertEqual("乙醇在哪里", planner.calls[0]["user_text"])
        self.assertIn("库存查询结果", planner.calls[0]["facts_text"])
        self.assertIn("乙醇", planner.calls[0]["facts_text"])
        self.assertIn("英文名 Ethanol", planner.calls[0]["facts_text"])
        self.assertIn("别名 酒精", planner.calls[0]["facts_text"])
        self.assertIn("纯度 AR", planner.calls[0]["facts_text"])
        self.assertNotIn("LSM-SECRET-001", planner.calls[0]["facts_text"])

    def test_read_query_rejects_unsafe_llm_polished_reply(self) -> None:
        mcp = FakeMcpClient({"inventory_search_by_name": _inventory_item()})
        planner = FakePolishPlanner("内部编码是 LSM-SECRET-001，token 是 abc。")

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=None,
                search_limit=5,
                text="乙醇在哪里",
                user_token="token",
            )
        )

        self.assertIn("乙醇", reply)
        self.assertIn("CAS 64-17-5", reply)
        self.assertNotIn("LSM-SECRET-001", reply)
        self.assertNotIn("token", reply.lower())

    def test_compacted_conversation_context_has_recency_weights(self) -> None:
        context = [
            {"user": "查询乙醇", "assistant": "乙醇在 A-01"},
            {"user": "查询乙腈", "assistant": "乙腈在 C-02"},
            {"user": "我的借用", "assistant": "你借了乙醇"},
        ]

        compacted = _compact_conversation_context(context)

        self.assertEqual(3, len(compacted))
        self.assertLess(compacted[0]["recency_weight"], compacted[-1]["recency_weight"])
        self.assertEqual("查询乙醇", compacted[0]["user"])

    def test_llm_plan_can_mark_exact_name_search(self) -> None:
        mcp = FakeMcpClient({"inventory_search_by_name": _inventory_item()})
        planner = FakePlanPlanner(
            LSMToolPlan(
                action=ACTION_CALL_TOOL,
                tool_name="inventory_search_by_name",
                arguments={"keyword": "乙醇", "limit": 5, "exact": True},
                title="库存精确查询结果",
            )
        )

        reply = asyncio.run(
            answer_with_llm_plan(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=None,
                search_limit=5,
                text="精确查询乙醇库存",
                user_token="token",
            )
        )

        self.assertIn("乙醇", reply)
        self.assertIn(
            (
                "inventory_search_by_name",
                {"keyword": "乙醇", "limit": 5, "exact": True, "user_token": "token"},
            ),
            mcp.calls,
        )

    def test_llm_plan_parser_accepts_exact_for_name_search_only(self) -> None:
        plan = _parse_plan(
            """
            {"action":"call_tool","tool_name":"inventory_search_by_name",
            "arguments":{"query":"乙醇","limit":5,"exact":"true"}}
            """
        )
        common_shelf_plan = _parse_plan(
            """
            {"action":"call_tool","tool_name":"common_shelf_search_by_alias",
            "arguments":{"query":"乙醇","limit":5,"exact":true}}
            """
        )

        self.assertEqual({"keyword": "乙醇", "limit": 5, "exact": True}, plan.arguments)
        self.assertEqual({"keyword": "乙醇", "limit": 5}, common_shelf_plan.arguments)

    def test_llm_plan_parser_accepts_my_dashboard_tools(self) -> None:
        plan = _parse_plan(
            """
            {"action":"call_tool","tool_name":"inventory_my_borrows",
            "arguments":{"limit":5},"title":"我的借用"}
            """
        )
        reagent_plan = _parse_plan(
            """
            {"action":"call_tool","tool_name":"reagent_orders_my",
            "arguments":{},"title":"我的试剂订单"}
            """
        )
        consumable_plan = _parse_plan(
            """
            {"action":"call_tool","tool_name":"consumable_orders_my",
            "arguments":{},"title":"我的耗材订单"}
            """
        )
        pending_plan = _parse_plan(
            """
            {"action":"call_tool","tool_name":"inventory_pending_stockin",
            "arguments":{},"title":"我的暂存"}
            """
        )

        self.assertEqual("inventory_my_borrows", plan.tool_name)
        self.assertEqual({}, plan.arguments)
        self.assertEqual("reagent_orders_my", reagent_plan.tool_name)
        self.assertEqual("consumable_orders_my", consumable_plan.tool_name)
        self.assertEqual("inventory_pending_stockin", pending_plan.tool_name)

    def test_llm_plan_parser_accepts_write_start_actions(self) -> None:
        borrow_plan = _parse_plan(
            """
            {"action":"start_borrow","arguments":{"query":"酒精"}}
            """
        )
        return_plan = _parse_plan(
            """
            {"action":"start_return","arguments":{"name":"酒精","mode":"used",
            "source_value":"20","source_unit":"毫升"}}
            """
        )

        self.assertEqual(ACTION_START_BORROW, borrow_plan.action)
        self.assertEqual({"keyword": "酒精"}, borrow_plan.arguments)
        self.assertEqual(ACTION_START_RETURN, return_plan.action)
        self.assertEqual(
            {
                "keyword": "酒精",
                "quantity_mode": "used",
                "quantity_value": 20.0,
                "quantity_unit": "毫升",
            },
            return_plan.arguments,
        )

    def test_llm_plan_parser_replies_for_unsupported_tool(self) -> None:
        plan = _parse_plan(
            """
            {"action":"call_tool","tool_name":"inventory_delete",
            "arguments":{"keyword":"乙醇"}}
            """
        )

        self.assertEqual(ACTION_REPLY, plan.action)
        self.assertIn("暂不支持", plan.reply)

    def test_llm_plan_parser_rejects_unsafe_direct_reply(self) -> None:
        plan = _parse_plan(
            """
            {"action":"reply","reply":"用户 ID 是 22，token 是 abc"}
            """
        )

        self.assertEqual(ACTION_REPLY, plan.action)
        self.assertIn("暂不支持", plan.reply)
        self.assertNotIn("token", plan.reply.lower())

    def test_llm_reply_safety_rejects_api_internal_field_families(self) -> None:
        unsafe_replies = [
            "external_userid=oabc",
            "request_id 是 req-1",
            "full_name_pinyin: huzhibin",
            "name_normalized=ethanol",
            "stderr 里显示 ValueError",
            "Authorization: Bearer abcdefghijklmnop",
            "我通过 MCP 工具调用查到了这个结果",
            "根据 safe facts 回复",
            "这是回复模板里的内容",
        ]

        for reply in unsafe_replies:
            with self.subTest(reply=reply):
                self.assertFalse(is_safe_llm_reply(reply))

        self.assertTrue(is_safe_llm_reply("mCPBA 没有查到库存。"))
        self.assertTrue(is_safe_llm_reply("DAPI 没有查到库存。"))

    def test_llm_plan_runtime_rejects_unsafe_direct_reply(self) -> None:
        mcp = FakeMcpClient({})
        planner = FakePlanPlanner(LSMToolPlan(action=ACTION_REPLY, reply="内部码是 SECRET"))

        reply = asyncio.run(
            answer_with_llm_plan(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=None,
                search_limit=5,
                text="显示内部码",
                user_token="token",
            )
        )

        self.assertIn("暂不支持", reply)
        self.assertNotIn("SECRET", reply)

    def test_empty_cas_inventory_uses_master_data_before_common_shelf(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_get_by_cas": _empty_cas_inventory(),
                "chemical_name_map_search_by_cas": _name_map("solvent"),
                "common_shelf_search_by_cas": _common_shelf(),
            }
        )

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=None,
                search_limit=5,
                text="64-17-5 在哪里",
                user_token="token",
            )
        )

        self.assertIn("库存没有查到匹配记录", reply)
        self.assertIn("常用货架", reply)
        self.assertIn(
            ("common_shelf_search_by_cas", {"cas_number": "64-17-5", "limit": 5, "user_token": "token"}),
            mcp.calls,
        )

    def test_empty_inventory_asks_llm_when_master_data_misses(self) -> None:
        planner = FakeCommonShelfPlanner(decision=True)
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _ok_data({"data": [], "total": 0}),
                "common_shelf_search_by_alias": _common_shelf(),
            }
        )

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=None,
                search_limit=5,
                text="查询某个常用溶剂库存",
                user_token="token",
            )
        )

        self.assertIn("常用货架", reply)
        self.assertEqual([{"user_text": "查询某个常用溶剂库存", "query": "某个常用溶剂", "cas_number": ""}], planner.calls)

    def test_empty_inventory_uses_non_common_master_data_cas_without_shelf(self) -> None:
        planner = FakeCommonShelfPlanner(decision=True)
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _name_map("other"),
                "inventory_get_by_cas": _ok_data(
                    {
                        "cas_number": "64-17-5",
                        "exists_in_inventory": False,
                        "items": [],
                        "total": 0,
                    }
                ),
            }
        )

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=None,
                search_limit=5,
                text="查询专用试剂库存",
                user_token="token",
            )
        )

        self.assertIn("识别为 64-17-5", reply)
        self.assertIn("库存和常用货架都没有查到匹配记录", reply)
        self.assertEqual([], planner.calls)
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "64-17-5", "user_token": "token"}),
            mcp.calls,
        )
        self.assertNotIn("common_shelf_search_by_alias", [name for name, _ in mcp.calls])

    def test_ligand_abbreviation_uses_master_data_cas_before_giving_up(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _name_map_record(
                    {
                        "cas_number": "76189-55-4",
                        "name": "BINAP",
                        "category": "ligand",
                    }
                ),
                "inventory_get_by_cas": _ok_data(
                    {
                        "cas_number": "76189-55-4",
                        "exists_in_inventory": True,
                        "items": [{"name": "BINAP", "cas_number": "76189-55-4"}],
                        "total": 1,
                    }
                ),
            }
        )
        web = FakeWebSearchClient("BINAP CAS 76189-55-4。")

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=web,
                search_limit=5,
                text="查询 BINAP 库存",
                user_token="token",
            )
        )

        self.assertIn("CAS 主数据识别 CAS", reply)
        self.assertIn("识别为 76189-55-4", reply)
        self.assertIn("BINAP", reply)
        self.assertEqual([], web.calls)
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "76189-55-4", "user_token": "token"}),
            mcp.calls,
        )

    def test_ligand_abbreviation_can_use_restricted_web_search_with_name_map_record(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _name_map_record(
                    {
                        "name": "XPhos",
                        "category": "ligand",
                    }
                ),
                "inventory_get_by_cas": _ok_data(
                    {
                        "cas_number": "564483-18-7",
                        "exists_in_inventory": True,
                        "items": [{"name": "XPhos", "cas_number": "564483-18-7"}],
                        "total": 1,
                    }
                ),
            }
        )
        web = FakeWebSearchClient("XPhos ligand CAS number 564483-18-7。")

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=web,
                search_limit=5,
                text="查询 XPhos 配体库存",
                user_token="token",
            )
        )

        self.assertIn("网络搜索仅用于辅助识别 CAS", reply)
        self.assertIn("识别为 564483-18-7", reply)
        self.assertIn("XPhos", reply)
        self.assertEqual(
            [
                "XPhos 配体 CAS号 CAS number chemical name alias synonym "
                "化学品 别名 英文名 ligand catalyst 配体 催化剂 金属配合物"
            ],
            web.calls,
        )
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "564483-18-7", "user_token": "token"}),
            mcp.calls,
        )

    def test_short_english_token_can_use_restricted_web_search_with_name_map_record(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _name_map_record(
                    {
                        "name": "dppf",
                        "category": "ligand",
                    }
                ),
                "inventory_get_by_cas": _ok_data(
                    {
                        "cas_number": "12150-46-8",
                        "exists_in_inventory": True,
                        "items": [{"name": "dppf", "cas_number": "12150-46-8"}],
                        "total": 1,
                    }
                ),
            }
        )
        web = FakeWebSearchClient("dppf ligand CAS number 12150-46-8。")
        planner = FakeCasResolutionDecisionPlanner(True)

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=web,
                search_limit=5,
                text="查询 dppf 库存",
                user_token="token",
            )
        )

        self.assertIn("网络搜索仅用于辅助识别 CAS", reply)
        self.assertIn("识别为 12150-46-8", reply)
        self.assertIn("dppf", reply)
        self.assertEqual(
            ["dppf CAS号 CAS number chemical name alias synonym 化学品 别名 英文名"],
            web.calls,
        )
        self.assertEqual([{"user_text": "查询 dppf 库存", "query": "dppf"}], planner.cas_decision_calls)
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "12150-46-8", "user_token": "token"}),
            mcp.calls,
        )

    def test_llm_can_reject_short_english_token_cas_resolution(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _name_map_record(
                    {
                        "name": "help",
                        "category": "other",
                    }
                ),
            }
        )
        web = FakeWebSearchClient("help CAS number 123-45-6。")
        planner = FakeCasResolutionDecisionPlanner(False)

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=web,
                search_limit=5,
                text="查询 help 库存",
                user_token="token",
            )
        )

        self.assertEqual("没有查到匹配记录。", reply)
        self.assertEqual([], web.calls)
        self.assertEqual([{"user_text": "查询 help 库存", "query": "help"}], planner.cas_decision_calls)
        self.assertNotIn("inventory_get_by_cas", [name for name, _ in mcp.calls])

    def test_direct_web_search_plan_is_blocked(self) -> None:
        mcp = FakeMcpClient({})
        web = FakeWebSearchClient()
        planner = FakePlanPlanner(
            LSMToolPlan(
                action=ACTION_CALL_TOOL,
                tool_name="web_search",
                arguments={"query": "MiniMax 最新文档"},
                title="联网搜索结果",
            )
        )

        reply = asyncio.run(
            answer_with_llm_plan(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=web,
                search_limit=5,
                text="联网搜索 MiniMax 最新文档",
                user_token="token",
            )
        )

        self.assertIn("只用于辅助识别", reply)
        self.assertEqual([], web.calls)
        self.assertEqual([], mcp.calls)

    def test_empty_inventory_can_resolve_cas_with_restricted_web_search(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _ok_data({"data": [], "total": 0}),
                "inventory_get_by_cas": _ok_data(
                    {
                        "cas_number": "64-17-5",
                        "exists_in_inventory": True,
                        "items": [{"id": 12, "name": "乙醇", "cas_number": "64-17-5"}],
                    }
                ),
            }
        )
        web = FakeWebSearchClient("酒精又称乙醇，CAS 64-17-5。")
        planner = FakeCasResolutionDecisionPlanner(True)

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=web,
                search_limit=5,
                text="查询酒精库存",
                user_token="token",
            )
        )

        self.assertIn("识别为 64-17-5", reply)
        self.assertIn("乙醇", reply)
        self.assertEqual(
            ["酒精 CAS号 CAS number chemical name alias synonym 化学品 别名 英文名"],
            web.calls,
        )
        self.assertEqual([{"user_text": "查询酒精库存", "query": "酒精"}], planner.cas_decision_calls)
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "64-17-5", "user_token": "token"}),
            mcp.calls,
        )

    def test_empty_inventory_can_resolve_cas_with_llm_knowledge_before_web_search(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _ok_data({"data": [], "total": 0}),
                "inventory_get_by_cas": _ok_data(
                    {
                        "cas_number": "64-17-5",
                        "exists_in_inventory": True,
                        "items": [{"id": 12, "name": "乙醇", "cas_number": "64-17-5"}],
                    }
                ),
            }
        )
        planner = FakeKnowledgePlanner("64-17-5")
        web = FakeWebSearchClient("酒精又称乙醇，CAS 64-17-5。")

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=web,
                search_limit=5,
                text="查询酒精库存",
                user_token="token",
            )
        )

        self.assertIn("通用知识识别 CAS", reply)
        self.assertIn("识别为 64-17-5", reply)
        self.assertEqual([{"user_text": "查询酒精库存", "query": "酒精"}], planner.knowledge_calls)
        self.assertEqual([], web.calls)
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "64-17-5", "user_token": "token"}),
            mcp.calls,
        )

    def test_explicit_cas_web_search_phrase_can_use_restricted_web_search(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _ok_data({"data": [], "total": 0}),
                "inventory_get_by_cas": _inventory_item(),
            }
        )
        planner = FakeCasResolutionDecisionPlanner(True)
        web = FakeWebSearchClient("dppf ligand CAS number 12150-46-8。")

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=web,
                search_limit=5,
                text="联网搜一下 dppf 的 CAS",
                user_token="token",
            )
        )

        self.assertIn("网络搜索仅用于辅助识别 CAS", reply)
        self.assertEqual(1, len(web.calls))
        self.assertIn("CAS号", web.calls[0])
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "12150-46-8", "user_token": "token"}),
            mcp.calls,
        )

    def test_general_search_words_can_still_use_cas_web_fallback_when_llm_allows(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _ok_data({"data": [], "total": 0}),
                "inventory_get_by_cas": _ok_data(
                    {
                        "cas_number": "12150-46-8",
                        "exists_in_inventory": True,
                        "items": [{"name": "dppf", "cas_number": "12150-46-8"}],
                        "total": 1,
                    }
                ),
            }
        )
        planner = FakeCasResolutionDecisionPlanner(True)
        web = FakeWebSearchClient("dppf ligand CAS number 12150-46-8。")

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=planner,
                web_search_client=web,
                search_limit=5,
                text="搜一下 dppf 库存",
                user_token="token",
            )
        )

        self.assertIn("网络搜索仅用于辅助识别 CAS", reply)
        self.assertEqual(1, len(web.calls))
        self.assertIn("CAS号", web.calls[0])
        self.assertEqual([{"user_text": "搜一下 dppf 库存", "query": "搜一下 dppf"}], planner.cas_decision_calls)
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "12150-46-8", "user_token": "token"}),
            mcp.calls,
        )

    def test_generic_web_search_text_never_calls_web_search(self) -> None:
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _ok_data({"data": [], "total": 0}),
            }
        )
        web = FakeWebSearchClient("OpenAI 最新新闻。")

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=web,
                search_limit=5,
                text="联网搜索 OpenAI 最新新闻",
                user_token="token",
            )
        )

        self.assertEqual("没有查到匹配记录。", reply)
        self.assertEqual([], web.calls)


if __name__ == "__main__":
    unittest.main()
