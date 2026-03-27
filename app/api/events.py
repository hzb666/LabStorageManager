"""SSE events endpoint.

Integration notes:
- Include router in main app with prefix /api.
- Frontend should connect to /api/events?rooms=inventory,common_shelf.
"""

from __future__ import annotations

from datetime import timedelta
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.core.constants import SSERoom
from app.core.request_utils import get_client_ip
from app.core.auth import is_token_session_active
from app.core.time_utils import get_utc_now
from app.models.user import User
from app.models.user_session import UserSession
from app.api.deps import get_current_session
from app.services.sse_manager import sse_manager

router = APIRouter(tags=["Events"])
SSE_SESSION_REVALIDATE_SECONDS = 15

ALLOWED_SSE_ROOMS = {
    SSERoom.INVENTORY,
    SSERoom.COMMON_SHELF,
    SSERoom.REAGENT_ORDERS,
    SSERoom.CONSUMABLE_ORDERS,
    SSERoom.DASHBOARD,
}


def _parse_and_validate_rooms(rooms_param: str) -> list[str]:
    requested = [room.strip() for room in rooms_param.split(",") if room.strip()]
    if not requested:
        requested = [SSERoom.INVENTORY]

    normalized = sorted(set(requested))
    invalid = [room for room in normalized if room not in ALLOWED_SSE_ROOMS]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid SSE rooms: {', '.join(invalid)}",
        )

    return normalized


def _filter_rooms_by_user_access(current_user: User, rooms: list[str]) -> list[str]:
    """Enforce SSE room auth parity with normal read access.

    Current project policy: all authenticated users can subscribe to all defined rooms.
    Keep this function as an explicit auth hook for future role-based tightening.
    """
    _ = current_user
    return rooms


@router.get("/events")
async def sse_events(
    request: Request,
    current: Annotated[tuple[User, UserSession], Depends(get_current_session)],
) -> StreamingResponse:
    """Server-Sent Events stream for authenticated users."""
    current_user, current_session = current
    client_ip = get_client_ip(request)
    rooms_param = request.query_params.get("rooms", SSERoom.INVENTORY)
    requested_rooms = _parse_and_validate_rooms(rooms_param)
    rooms = _filter_rooms_by_user_access(current_user, requested_rooms)

    if not rooms:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No SSE rooms are accessible for current user",
        )

    # Replay is intentionally not implemented in this project.
    # Reconnect strategy is full refresh on stale, so server starts with seq 0.
    last_seq = 0

    client_id = sse_manager.new_client_id()
    client = await sse_manager.subscribe(
        client_id=client_id,
        rooms=rooms,
        last_seq=last_seq,
        user_id=current_user.id,
        session_id=current_session.id,
        token_hash=current_session.token_hash,
    )
    await sse_manager.start_listener()

    async def event_generator():
        connected_payload = {
            "client_id": client_id,
            "rooms": rooms,
            "last_seq": last_seq,
        }
        yield f"event: connected\ndata: {json.dumps(connected_payload, ensure_ascii=False)}\n\n"
        # 建连后周期复检，防止“建连时有效，后续被踢后仍长期收流”。
        next_revalidate_at = get_utc_now() + timedelta(seconds=SSE_SESSION_REVALIDATE_SECONDS)

        async for message in sse_manager.stream(client):
            if await request.is_disconnected():
                break

            now_utc = get_utc_now()
            if now_utc >= next_revalidate_at:
                if not is_token_session_active(current_session.token_hash, client_ip=client_ip):
                    sse_manager.notify_session_revoked(
                        token_hash=current_session.token_hash,
                        reason="session_revalidation_failed",
                    )
                    yield sse_manager.build_auth_invalid_message("session_revalidation_failed")
                    break
                next_revalidate_at = now_utc + timedelta(seconds=SSE_SESSION_REVALIDATE_SECONDS)

            yield message

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
