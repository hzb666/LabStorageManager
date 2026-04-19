"""Self-tests for WeCom robot read-query orchestration."""

from __future__ import annotations

import asyncio
import unittest
from typing import Any

from robot.wecom_aibot.llm_planner import ACTION_CALL_TOOL, LSMToolPlan
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
    ) -> bool | None:
        self.calls.append({"user_text": user_text, "query": query, "cas_number": cas_number})
        return self.decision


class FakePlanPlanner:
    def __init__(self, plan: LSMToolPlan) -> None:
        self.plan_result = plan

    async def plan(self, user_text: str) -> LSMToolPlan:
        return self.plan_result


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


class WecomReadQuerySelfTest(unittest.TestCase):
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

    def test_empty_inventory_does_not_fallback_for_master_data_other(self) -> None:
        planner = FakeCommonShelfPlanner(decision=True)
        mcp = FakeMcpClient(
            {
                "inventory_search_by_name": _empty_inventory(),
                "chemical_name_map_search": _name_map("other"),
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

        self.assertEqual("没有查到匹配记录。", reply)
        self.assertEqual([], planner.calls)
        self.assertNotIn("common_shelf_search_by_alias", [name for name, _ in mcp.calls])

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

        reply = asyncio.run(
            answer_read_query(
                mcp_client=mcp,
                llm_planner=None,
                web_search_client=web,
                search_limit=5,
                text="查询酒精库存",
                user_token="token",
            )
        )

        self.assertIn("识别为 64-17-5", reply)
        self.assertIn("乙醇", reply)
        self.assertEqual(["酒精 CAS号 化学品"], web.calls)
        self.assertIn(
            ("inventory_get_by_cas", {"cas_number": "64-17-5", "user_token": "token"}),
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
