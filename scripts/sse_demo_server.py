"""Standalone SSE demo server.

Purpose:
- Demonstrate the newly added SSE manager/router without editing app/main.py.
- Provide a safe publish endpoint for local testing.

Run:
    .venv\\Scripts\\python.exe scripts/sse_demo_server.py

Then open stream:
    curl -N "http://127.0.0.1:8010/api/events?rooms=inventory"

Publish one event:
    curl -X POST "http://127.0.0.1:8010/api/sse-demo/publish" \
         -H "Content-Type: application/json" \
         -d "{\"room\":\"inventory\",\"event\":\"inventory.updated\",\"data\":{\"action\":\"update\",\"item_id\":1,\"item\":{\"id\":1,\"name\":\"Demo\"}}}"
"""

from __future__ import annotations

from typing import Any

import uvicorn
from fastapi import APIRouter, FastAPI
from pydantic import BaseModel, Field

from app.api import events
from app.core.auth import get_current_user
from app.models.user import User, UserRole
from app.services.sse_manager import sse_manager


class DemoPublishRequest(BaseModel):
    """Payload to publish one SSE event."""

    room: str = Field(default="inventory", min_length=1)
    event: str = Field(default="inventory.updated", min_length=1)
    data: dict[str, Any] = Field(default_factory=dict)


def _demo_user() -> User:
    """Return a fake authenticated user for local demo only."""
    return User(
        id=999999,
        username="sse_demo",
        full_name="SSE Demo User",
        role=UserRole.ADMIN,
        is_active=True,
        password_hash="demo_not_used",
    )


demo_router = APIRouter(prefix="/api/sse-demo", tags=["SSE Demo"])


@demo_router.get("/health")
def demo_health() -> dict[str, str]:
    """Simple health endpoint for test script readiness checks."""
    return {"status": "ok"}


@demo_router.post("/publish")
async def demo_publish(payload: DemoPublishRequest) -> dict[str, Any]:
    """Publish an SSE event to target room."""
    delivered = await sse_manager.broadcast(
        room=payload.room,
        event_type=payload.event,
        data=payload.data,
    )
    return {
        "ok": True,
        "room": payload.room,
        "event": payload.event,
        "delivered_local": delivered,
    }


def create_demo_app() -> FastAPI:
    """Create isolated demo app with auth dependency override."""
    app = FastAPI(title="LabStorage SSE Demo", version="1.0")

    # demo 环境覆盖鉴权依赖，便于快速测试 /api/events。
    app.dependency_overrides[get_current_user] = _demo_user

    app.include_router(events.router, prefix="/api")
    app.include_router(demo_router)
    return app


app = create_demo_app()


if __name__ == "__main__":
    uvicorn.run("scripts.sse_demo_server:app", host="127.0.0.1", port=8010, reload=False)
