"""SSE connection manager.

Design goals:
1) Keep in-process client queues for low-latency push.
2) Use Redis PubSub for cross-process fan-out.
3) Mark event identity and sequence so frontend can do reliability checks.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
import json
import logging
import secrets
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Optional

from app.core.constants import (
    SSE_CLIENT_ID_TOKEN_HEX_LENGTH,
    SSE_CLIENT_QUEUE_MAXSIZE,
    SSE_HEARTBEAT_SECONDS,
    SSE_ORIGIN_TOKEN_HEX_LENGTH,
    SSE_REDIS_GET_MESSAGE_TIMEOUT_SECONDS,
    SSE_REDIS_LISTENER_ERROR_RETRY_SECONDS,
    SSE_REDIS_SUBSCRIBE_RETRY_SECONDS,
    SSE_SLOW_CLIENT_QUEUE_FULL_STREAK_LIMIT,
)
from app.services.sse_redis import redis_pubsub

logger = logging.getLogger(__name__)


@dataclass
class SSEClient:
    """One logical browser subscriber."""

    client_id: str
    rooms: set[str] = field(default_factory=set)
    queue: asyncio.Queue[str] = field(default_factory=lambda: asyncio.Queue(maxsize=SSE_CLIENT_QUEUE_MAXSIZE))
    last_seq_by_room: dict[str, int] = field(default_factory=dict)
    queue_full_streak: int = 0
    dropped_events: int = 0


@dataclass
class SSERoom:
    """Local in-memory room state."""

    name: str
    clients: set[str] = field(default_factory=set)
    fallback_seq: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class SSEManager:
    """SSE manager singleton for local fan-out + Redis bridge."""

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
        self._origin = secrets.token_hex(SSE_ORIGIN_TOKEN_HEX_LENGTH)
        self._slow_client_disconnects = 0
        self._initialized = True

    @staticmethod
    def new_client_id() -> str:
        """Generate a high-entropy client id for one SSE connection."""
        return secrets.token_hex(SSE_CLIENT_ID_TOKEN_HEX_LENGTH)

    async def get_room(self, room: str) -> SSERoom:
        async with self._manager_lock:
            if room not in self._rooms:
                self._rooms[room] = SSERoom(name=room)
            return self._rooms[room]

    async def subscribe(self, client_id: str, rooms: list[str], last_seq: int = 0) -> SSEClient:
        """Subscribe client to multiple rooms.

        last_seq is accepted for integration compatibility. Current implementation
        stores it per room and leaves replay to future extension.
        """
        normalized_rooms = sorted({room.strip() for room in rooms if room.strip()})
        if not normalized_rooms:
            normalized_rooms = ["inventory"]

        client = SSEClient(client_id=client_id, rooms=set(normalized_rooms))
        for room in normalized_rooms:
            client.last_seq_by_room[room] = last_seq

        async with self._manager_lock:
            self._clients[client_id] = client

        for room in normalized_rooms:
            local_room = await self.get_room(room)
            async with local_room.lock:
                local_room.clients.add(client_id)

        return client

    async def unsubscribe(self, client: SSEClient) -> None:
        """Detach client from all rooms and remove queue holder."""
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
        """Prefer Redis INCR for global room sequence; fallback to local counter."""
        redis_seq = await asyncio.to_thread(redis_pubsub.next_sequence, room)
        if redis_seq is not None:
            return redis_seq

        local_room = await self.get_room(room)
        async with local_room.lock:
            local_room.fallback_seq += 1
            return local_room.fallback_seq

    async def broadcast(self, room: str, event_type: str, data: dict[str, Any]) -> int:
        """Broadcast one event.

        Returns local delivered count. Redis publish count is logged only.
        """
        seq = await self._next_seq(room)
        event = {
            "room": room,
            "seq": seq,
            "event": event_type,
            "data": data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "origin": self._origin,
        }

        local_delivered = await self._push_local(room, event_type, event)
        redis_count = await asyncio.to_thread(redis_pubsub.publish, f"sse:{room}", event)
        logger.debug(
            "SSE broadcast room=%s event=%s seq=%s local=%s redis=%s",
            room,
            event_type,
            seq,
            local_delivered,
            redis_count,
        )
        return local_delivered

    async def _push_local(self, room: str, event_type: str, full_event: dict[str, Any]) -> int:
        """Push pre-encoded message to all local subscribers of one room."""
        local_room = await self.get_room(room)
        payload = json.dumps(full_event, ensure_ascii=False)
        sse_message = f"event: {event_type}\ndata: {payload}\n\n"

        async with local_room.lock:
            client_ids = list(local_room.clients)

        delivered = 0
        for client_id in client_ids:
            client = self._clients.get(client_id)
            if client is None:
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
        """Disconnect clients that stay persistently back-pressured."""
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

    async def start_listener(self) -> None:
        """Start a single background Redis listener task."""
        async with self._manager_lock:
            if self._listener_task and not self._listener_task.done():
                return
            self._listener_task = asyncio.create_task(
                self._listener_loop(),
                name="sse-redis-listener",
            )

    async def stop_listener(self) -> None:
        """Stop Redis listener task on application shutdown."""
        async with self._manager_lock:
            task = self._listener_task
            self._listener_task = None

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

        return room, event_type, event

    @staticmethod
    def _pubsub_reader_worker(
        pubsub: Any,
        loop: asyncio.AbstractEventLoop,
        message_queue: asyncio.Queue[dict[str, Any]],
        stop_event: threading.Event,
    ) -> None:
        """Read PubSub messages in one dedicated thread and forward to asyncio queue."""
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
        """Bridge Redis pubsub events into local client queues."""
        while True:
            pubsub = None
            try:
                pubsub = await asyncio.to_thread(redis_pubsub.subscribe_patterns, "sse:*")
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
        """Yield SSE chunks for a client until disconnect/cancel."""
        try:
            while True:
                # Stop stream quickly when client is removed (e.g., slow client governance).
                if self._clients.get(client.client_id) is not client:
                    break

                try:
                    message = await asyncio.wait_for(client.queue.get(), timeout=heartbeat_seconds)
                    yield message
                except asyncio.TimeoutError:
                    if self._clients.get(client.client_id) is not client:
                        break
                    yield ": heartbeat\n\n"
        except (GeneratorExit, asyncio.CancelledError):
            pass
        finally:
            await self.unsubscribe(client)


sse_manager = SSEManager()
