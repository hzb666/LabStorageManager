"""MiniMax Token Plan MCP web search client."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from mcp import ClientSession, types
from mcp.client.stdio import StdioServerParameters, stdio_client

logger = logging.getLogger(__name__)

MINIMAX_MCP_PACKAGE = "minimax-coding-plan-mcp"
WEB_SEARCH_TOOL = "web_search"


@dataclass(frozen=True)
class MiniMaxWebSearchClient:
    api_key: str
    api_host: str
    command: str = "uvx"
    timeout_seconds: float = 25.0

    async def web_search(self, query: str) -> dict[str, Any]:
        """Run MiniMax MCP web_search and return a CLI-style result."""
        if not query.strip():
            return _error_result("INVALID_QUERY", "Search query is empty")
        if not self.api_key.strip():
            return _error_result("MINIMAX_API_KEY_MISSING", "MiniMax API key is missing")
        try:
            result = await self._call_tool(WEB_SEARCH_TOOL, {"query": query.strip()})
        except Exception as exc:  # noqa: BLE001
            logger.warning("minimax_web_search_failed type=%s", type(exc).__name__)
            return _error_result("MINIMAX_WEB_SEARCH_FAILED", "MiniMax web search failed")
        return _decode_call_tool_result(result)

    async def _call_tool(self, name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        server = StdioServerParameters(
            command=self.command,
            args=[MINIMAX_MCP_PACKAGE, "-y"],
            env={
                **os.environ,
                "MINIMAX_API_KEY": self.api_key,
                "MINIMAX_API_HOST": self.api_host,
            },
        )
        async with stdio_client(server) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                return await session.call_tool(
                    name,
                    arguments=arguments,
                    read_timeout_seconds=timedelta(seconds=self.timeout_seconds),
                )


def build_web_search_client(settings: Any) -> MiniMaxWebSearchClient | None:
    if not settings.web_search_enabled:
        return None
    api_key = settings.minimax_api_key or settings.llm_api_key
    if not api_key.strip():
        return None
    return MiniMaxWebSearchClient(
        api_key=api_key,
        api_host=settings.minimax_api_host,
        command=settings.minimax_mcp_command,
        timeout_seconds=settings.minimax_mcp_timeout_seconds,
    )


def _decode_call_tool_result(result: types.CallToolResult) -> dict[str, Any]:
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        data = _decode_structured_content(structured)
    else:
        data = _decode_text_content(result)
    if result.isError:
        return _error_result("MINIMAX_TOOL_ERROR", "MiniMax MCP tool returned an error")
    return {"ok": True, "exit_code": 0, "payload": {"ok": True, "data": data}, "stderr": ""}


def _decode_structured_content(structured: dict[str, Any]) -> Any:
    text = structured.get("text")
    if isinstance(text, str):
        parsed = _parse_json(text)
        if parsed is not None:
            return parsed
    return structured


def _decode_text_content(result: types.CallToolResult) -> Any:
    for item in result.content:
        if not isinstance(item, types.TextContent):
            continue
        parsed = _parse_json(item.text)
        return parsed if parsed is not None else {"text": item.text}
    return {}


def _parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _error_result(code: str, message: str) -> dict[str, Any]:
    return {"ok": False, "exit_code": 1, "error": {"code": code, "message": message}}
