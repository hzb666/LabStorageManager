"""ASGI app for serving the LabStorageManager MCP server over Streamable HTTP."""

from __future__ import annotations

import contextlib

from starlette.applications import Starlette
from starlette.routing import Mount

from lsm_mcp.server import mcp


@contextlib.asynccontextmanager
async def lifespan(_: Starlette):
    async with mcp.session_manager.run():
        yield


app = Starlette(routes=[Mount("/", app=mcp.streamable_http_app())], lifespan=lifespan)
