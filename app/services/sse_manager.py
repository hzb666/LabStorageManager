# SSE 本地 fan-out 与 Redis 跨进程桥接。

from __future__ import annotations

import asyncio
from collections import deque
from contextlib import suppress
import json
import logging
import secrets
import threading
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Optional

from app.core.constants import (
    SSE_CLIENT_ID_TOKEN_HEX_LENGTH,
    SSE_CLIENT_QUEUE_MAXSIZE,
    SSE_HEARTBEAT_SECONDS,
    SSE_ORIGIN_TOKEN_HEX_LENGTH,
    SSE_REPLAY_BUFFER_MAX_EVENTS,
    SSE_REDIS_GET_MESSAGE_TIMEOUT_SECONDS,
    SSE_REDIS_LISTENER_ERROR_RETRY_SECONDS,
    SSE_REDIS_SUBSCRIBE_RETRY_SECONDS,
    SSE_SLOW_CLIENT_QUEUE_FULL_STREAK_LIMIT,
)
from app.core.request_utils import get_current_sse_client_id
from app.core.redis import redis_key, REDIS_KEY_PREFIX
from app.core.time_utils import get_utc_now, utc_iso_str
from app.services.sse_redis import redis_pubsub

logger = logging.getLogger(__name__)


@dataclass
class SSEClient:
    client_id: str
    rooms: set[str] = field(default_factory=set)
    queue: asyncio.Queue[str] = field(default_factory=lambda: asyncio.Queue(maxsize=SSE_CLIENT_QUEUE_MAXSIZE))
    last_seq_by_room: dict[str, int] = field(default_factory=dict)
    queue_full_streak: int = 0
    dropped_events: int = 0
    user_id: int | None = None
    session_id: int | None = None
    token_hash: str | None = None
    revoked: bool = False
    revoke_reason: str | None = None


@dataclass
class SSERoom:
    name: str
    clients: set[str] = field(default_factory=set)
    fallback_seq: int = 0
    replay_buffer: deque[dict[str, Any]] = field(
        default_factory=lambda: deque(maxlen=SSE_REPLAY_BUFFER_MAX_EVENTS)
    )
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass(frozen=True)
class SSESubscriptionRequest:
    client_id: str
    rooms: list[str]
    last_seq_by_room: dict[str, int] = field(default_factory=dict)
    user_id: int | None = None
    session_id: int | None = None
    token_hash: str | None = None


class SSEManager:
    _instance: Optional["SSEManager"] = None

    def __new__(cls) -> "SSEManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return

        self._clients: dict[str, SSEClient] = {}
        self._rooms: dict[str, SSERoom] = {}
        self._manager_lock = asyncio.Lock()
        self._listener_task: Optional[asyncio.Task[None]] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._origin = secrets.token_hex(SSE_ORIGIN_TOKEN_HEX_LENGTH)
        self._slow_client_disconnects = 0
        self._initialized = True

    @staticmethod
    def new_client_id() -> str:
        return secrets.token_hex(SSE_CLIENT_ID_TOKEN_HEX_LENGTH)

    async def get_room(self, room: str) -> SSERoom:
        async with self._manager_lock:
            if room not in self._rooms:
                self._rooms[room] = SSERoom(name=room)
            return self._rooms[room]

    async def subscribe(self, request: SSESubscriptionRequest) -> SSEClient:
        normalized_rooms = sorted({room.strip() for room in request.rooms if room.strip()})
        if not normalized_rooms:
            normalized_rooms = ["inventory"]

        client = SSEClient(
            client_id=request.client_id,
            rooms=set(normalized_rooms),
            user_id=request.user_id,
            session_id=request.session_id,
            token_hash=request.token_hash,
        )
        for room in normalized_rooms:
            client.last_seq_by_room[room] = max(0, int(request.last_seq_by_room.get(room, 0)))

        async with self._manager_lock:
            self._clients[request.client_id] = client

        for room in normalized_rooms:
            local_room = await self.get_room(room)
            async with local_room.lock:
                local_room.clients.add(request.client_id)

        return client

    async def unsubscribe(self, client: SSEClient) -> None:
        for room in list(client.rooms):
            local_room = await self.get_room(room)
            async with local_room.lock:
                local_room.clients.discard(client.client_id)

            # Reclaim empty rooms to avoid unbounded in-memory room growth.
            async with self._manager_lock:
                current_room = self._rooms.get(room)
                if current_room is not local_room:
                    continue
                async with current_room.lock:
                    if not current_room.clients:
                        self._rooms.pop(room, None)

        async with self._manager_lock:
            self._clients.pop(client.client_id, None)

    async def _next_seq(self, room: str) -> int:
        # Redis 不可用时退回本地序号，至少保证单进程内有序。
        redis_seq = await asyncio.to_thread(redis_pubsub.next_sequence, room)
        if redis_seq is not None:
            return redis_seq

        local_room = await self.get_room(room)
        async with local_room.lock:
            local_room.fallback_seq += 1
            return local_room.fallback_seq

    async def broadcast(
        self,
        room: str,
        event_type: str,
        data: dict[str, Any],
        *,
        actor_client_id: str | None = None,
    ) -> int:
        if actor_client_id is None:
            actor_client_id = get_current_sse_client_id()

        seq = await self._next_seq(room)
        event = {
            "room": room,
            "seq": seq,
            "event": event_type,
            "data": data,
            "timestamp": utc_iso_str(get_utc_now()),
            "origin": self._origin,
            "actor_client_id": actor_client_id,
        }

        local_delivered = await self._push_local(room, event_type, event)
        redis_count = await asyncio.to_thread(redis_pubsub.publish, redis_key(f"sse:{room}"), event)
        logger.debug(
            "SSE broadcast room=%s event=%s seq=%s local=%s redis=%s",
            room,
            event_type,
            seq,
            local_delivered,
            redis_count,
        )
        return local_delivered

    @staticmethod
    def _build_sse_message(event_type: str, full_event: dict[str, Any]) -> str:
        payload = json.dumps(full_event, ensure_ascii=False)
        return f"event: {event_type}\ndata: {payload}\n\n"

    @staticmethod
    def _replay_sort_key(event: dict[str, Any]) -> tuple[str, str, int]:
        return (
            str(event.get("timestamp") or ""),
            str(event.get("room") or ""),
            int(event.get("seq") or 0),
        )

    async def collect_replay_messages(self, client: SSEClient) -> list[str]:
        replay_events: list[dict[str, Any]] = []

        for room in sorted(client.rooms):
            last_seq = client.last_seq_by_room.get(room, 0)
            if last_seq <= 0:
                continue

            local_room = await self.get_room(room)
            async with local_room.lock:
                room_events = list(local_room.replay_buffer)

            replay_events.extend(
                event
                for event in room_events
                if int(event.get("seq") or 0) > last_seq
            )

        replay_events.sort(key=self._replay_sort_key)
        return [
            self._build_sse_message(str(event.get("event") or "message"), event)
            for event in replay_events
        ]

    async def _push_local(self, room: str, event_type: str, full_event: dict[str, Any]) -> int:
        local_room = await self.get_room(room)
        sse_message = self._build_sse_message(event_type, full_event)

        async with local_room.lock:
            local_room.replay_buffer.append(dict(full_event))
            client_ids = list(local_room.clients)

        delivered = 0
        for client_id in client_ids:
            client = self._clients.get(client_id)
            if client is None:
                continue
            if client.revoked:
                # 会话已撤销的连接不再接收业务事件，防止“被踢后仍收流”。
                continue

            try:
                client.queue.put_nowait(sse_message)
                if client.queue_full_streak:
                    client.queue_full_streak = 0
                delivered += 1
            except asyncio.QueueFull:
                # Queue full means client is too slow; drop and eventually disconnect.
                client.dropped_events += 1
                client.queue_full_streak += 1
                logger.warning(
                    "SSE queue full, dropping event for client=%s room=%s streak=%s dropped=%s",
                    client_id,
                    room,
                    client.queue_full_streak,
                    client.dropped_events,
                )

                if client.queue_full_streak >= SSE_SLOW_CLIENT_QUEUE_FULL_STREAK_LIMIT:
                    await self._disconnect_slow_client(client)

        return delivered

    async def _disconnect_slow_client(self, client: SSEClient) -> None:
        # Client may already be disconnected by another coroutine.
        if self._clients.get(client.client_id) is not client:
            return

        self._slow_client_disconnects += 1
        logger.warning(
            "Disconnecting slow SSE client=%s after queue full streak=%s dropped=%s total_disconnects=%s",
            client.client_id,
            client.queue_full_streak,
            client.dropped_events,
            self._slow_client_disconnects,
        )
        await self.unsubscribe(client)

    @staticmethod
    def _map_auth_code(reason: str) -> str:
        if reason in {"user_deactivated"}:
            return "AUTH_USER_DISABLED"
        if reason in {"session_revalidation_failed", "session_expired_cleanup"}:
            return "AUTH_SESSION_EXPIRED"
        return "AUTH_SESSION_REVOKED"

    @classmethod
    def build_auth_invalid_message(cls, reason: str) -> str:
        payload = json.dumps(
            {"reason": reason, "code": cls._map_auth_code(reason)},
            ensure_ascii=False,
        )
        return f"event: auth.invalid\ndata: {payload}\n\n"

    def _mark_client_revoked(self, client: SSEClient, reason: str) -> None:
        if client.revoked:
            return
        client.revoked = True
        client.revoke_reason = reason

        # Drop already-buffered business events so revocation is the next thing the
        # client sees. Otherwise a kicked session can still consume stale messages.
        with suppress(asyncio.QueueEmpty):
            while True:
                client.queue.get_nowait()

        try:
            client.queue.put_nowait(self.build_auth_invalid_message(reason))
        except asyncio.QueueFull:
            with suppress(asyncio.QueueFull):
                client.queue.put_nowait(self.build_auth_invalid_message(reason))

    async def _disconnect_clients_by_token_hash(self, token_hash: str, reason: str) -> None:
        if not token_hash:
            return

        async with self._manager_lock:
            candidates = [client for client in self._clients.values() if client.token_hash == token_hash]

        for client in candidates:
            self._mark_client_revoked(client, reason)

    def notify_session_revoked(self, *, token_hash: str, reason: str = "session_revoked") -> None:
        # 普通 API 已拒绝后，长连接也要尽快表现为失效。
        event = {
            "kind": "session_revoked",
            "token_hash": token_hash,
            "reason": reason,
            "timestamp": utc_iso_str(get_utc_now()),
            "origin": self._origin,
        }
        channel = redis_key("sse:control")
        try:
            redis_pubsub.publish(channel, event)
        except Exception:  # noqa: BLE001
            logger.exception("SSE revoke publish failed reason=%s", reason)

        if self._loop and self._loop.is_running():
            def _schedule_revoke() -> None:
                asyncio.create_task(self._disconnect_clients_by_token_hash(token_hash, reason))

            self._loop.call_soon_threadsafe(_schedule_revoke)

    async def start_listener(self) -> None:
        self._loop = asyncio.get_running_loop()
        async with self._manager_lock:
            if self._listener_task and not self._listener_task.done():
                return
            self._listener_task = asyncio.create_task(
                self._listener_loop(),
                name="sse-redis-listener",
            )

    async def stop_listener(self) -> None:
        async with self._manager_lock:
            task = self._listener_task
            self._listener_task = None
            self._loop = None

        if task is None:
            return

        if not task.done():
            task.cancel()
        await asyncio.wait({task})

    @staticmethod
    def _decode_pubsub_value(raw_value: Any) -> str:
        if isinstance(raw_value, bytes):
            return raw_value.decode("utf-8")
        return str(raw_value)

    def _parse_pubsub_event(self, message: dict[str, Any]) -> Optional[tuple[str, str, dict[str, Any]]]:
        raw_channel = message.get("channel")
        channel = self._decode_pubsub_value(raw_channel)

        # Extract room from channel with prefix: "lsm:sse:room-123" -> "room-123"
        prefix_pattern = f"{REDIS_KEY_PREFIX}:sse:"
        if channel.startswith(prefix_pattern):
            room = channel[len(prefix_pattern):]
        elif ":sse:" in channel:
            room = channel.split(":sse:", 1)[1]
        else:
            room = channel.split(":", 1)[1] if ":" in channel else ""
        raw_data = message.get("data")
        text_data = self._decode_pubsub_value(raw_data)

        try:
            event = json.loads(text_data)
        except json.JSONDecodeError:
            logger.warning("Invalid SSE Redis payload on %s", channel)
            return None

        if not isinstance(event, dict):
            logger.warning("Unexpected SSE Redis payload type on %s: %s", channel, type(event).__name__)
            return None

        if event.get("origin") == self._origin:
            # Already pushed locally by this process.
            return None

        event_type = str(event.get("event") or "message")
        if not room:
            room = str(event.get("room") or "")
        if not room:
            return None
        if room == "control":
            return None

        return room, event_type, event

    def _parse_control_message(self, message: dict[str, Any]) -> Optional[dict[str, Any]]:
        raw_channel = message.get("channel")
        channel = self._decode_pubsub_value(raw_channel)
        if ":sse:control" not in channel and channel != "sse:control":
            return None

        raw_data = message.get("data")
        text_data = self._decode_pubsub_value(raw_data)
        try:
            event = json.loads(text_data)
        except json.JSONDecodeError:
            logger.warning("Invalid SSE control payload on %s", channel)
            return None

        token_hash = event.get("token_hash") if isinstance(event, dict) else None
        if (
            not isinstance(event, dict)
            or event.get("origin") == self._origin
            or event.get("kind") != "session_revoked"
            or not isinstance(token_hash, str)
            or not token_hash
        ):
            return None

        return event

    async def _handle_control_message(self, event: dict[str, Any]) -> None:
        token_hash = str(event.get("token_hash") or "")
        reason = str(event.get("reason") or "session_revoked")
        await self._disconnect_clients_by_token_hash(token_hash, reason)

    @staticmethod
    def _pubsub_reader_worker(
        pubsub: Any,
        loop: asyncio.AbstractEventLoop,
        message_queue: asyncio.Queue[dict[str, Any]],
        stop_event: threading.Event,
    ) -> None:
        # Redis 客户端是阻塞接口，用单独线程读消息再转发给事件循环。
        while not stop_event.is_set():
            try:
                message = pubsub.get_message(
                    True,
                    SSE_REDIS_GET_MESSAGE_TIMEOUT_SECONDS,
                )
            except Exception:
                logger.exception("SSE Redis pubsub read failed")
                break

            if message is None:
                continue

            def enqueue_message(message_item: dict[str, Any] = message) -> None:
                try:
                    message_queue.put_nowait(message_item)
                except asyncio.QueueFull:
                    logger.warning("SSE Redis message queue full; dropping one event")

            loop.call_soon_threadsafe(enqueue_message)

    async def _consume_pubsub(self, pubsub: Any) -> None:
        loop = asyncio.get_running_loop()
        message_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=SSE_CLIENT_QUEUE_MAXSIZE)
        stop_event = threading.Event()
        reader_task = asyncio.create_task(
            asyncio.to_thread(self._pubsub_reader_worker, pubsub, loop, message_queue, stop_event),
            name="sse-redis-reader",
        )

        try:
            while True:
                queue_get_task = asyncio.create_task(message_queue.get(), name="sse-redis-message-get")
                done, _ = await asyncio.wait(
                    {queue_get_task, reader_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )

                if queue_get_task in done:
                    message = queue_get_task.result()
                    control_event = self._parse_control_message(message)
                    if control_event is not None:
                        await self._handle_control_message(control_event)
                        continue
                    parsed = self._parse_pubsub_event(message)
                    if parsed is not None:
                        room, event_type, event = parsed
                        await self._push_local(room, event_type, event)
                else:
                    queue_get_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await queue_get_task

                if reader_task in done:
                    if stop_event.is_set():
                        break
                    worker_error = reader_task.exception()
                    if worker_error is not None:
                        raise RuntimeError("SSE Redis reader worker failed") from worker_error
                    raise RuntimeError("SSE Redis reader worker exited unexpectedly")
        finally:
            stop_event.set()
            redis_pubsub.close_pubsub(pubsub)
            with suppress(Exception):
                await reader_task

    async def _listener_loop(self) -> None:
        while True:
            pubsub = None
            try:
                pubsub = await asyncio.to_thread(redis_pubsub.subscribe_patterns, redis_key("sse:*"))
                if pubsub is None:
                    await asyncio.sleep(SSE_REDIS_SUBSCRIBE_RETRY_SECONDS)
                    continue

                await self._consume_pubsub(pubsub)

            except Exception:
                logger.exception("SSE Redis listener error; retrying")
                await asyncio.sleep(SSE_REDIS_LISTENER_ERROR_RETRY_SECONDS)
            finally:
                redis_pubsub.close_pubsub(pubsub)

    async def stream(
        self,
        client: SSEClient,
        heartbeat_seconds: int = SSE_HEARTBEAT_SECONDS,
    ) -> AsyncGenerator[str, None]:
        try:
            while True:
                # Stop stream quickly when client is removed (e.g., slow client governance).
                if self._clients.get(client.client_id) is not client:
                    break
                if client.revoked and client.queue.empty():
                    break

                try:
                    message = await asyncio.wait_for(client.queue.get(), timeout=heartbeat_seconds)
                    yield message
                    if client.revoked and client.queue.empty():
                        break
                except asyncio.TimeoutError:
                    if self._clients.get(client.client_id) is not client:
                        break
                    if client.revoked:
                        break
                    yield ": heartbeat\n\n"
        except (GeneratorExit, asyncio.CancelledError):
            pass
        finally:
            await self.unsubscribe(client)


sse_manager = SSEManager()
