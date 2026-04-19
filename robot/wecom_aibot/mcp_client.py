"""MCP client used by the WeCom robot orchestrator."""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Any

from mcp import ClientSession, types
from mcp.client.streamable_http import streamable_http_client


class LSMMcpClient:
    """Small Streamable HTTP MCP client.

    The first slice opens a short-lived MCP session per call. That keeps failure handling simple
    and avoids sharing session state across duplicated WeCom callbacks.
    """

    def __init__(self, url: str, *, read_timeout_seconds: float = 15.0) -> None:
        self.url = url
        self.read_timeout_seconds = read_timeout_seconds

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        async with streamable_http_client(self.url) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(
                    name,
                    arguments=arguments,
                    read_timeout_seconds=timedelta(seconds=self.read_timeout_seconds),
                )
        return _decode_call_tool_result(result)


def _decode_call_tool_result(result: types.CallToolResult) -> dict[str, Any]:
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        return structured

    for item in result.content:
        if isinstance(item, types.TextContent):
            parsed = _parse_json_object(item.text)
            if parsed is not None:
                return parsed
            return {"ok": not result.isError, "text": item.text}

    return {
        "ok": False,
        "exit_code": 1,
        "error": {"code": "EMPTY_MCP_RESULT", "message": "MCP tool returned no text content"},
    }


def _parse_json_object(text: str) -> dict[str, Any] | None:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None
