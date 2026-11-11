from __future__ import annotations

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import redis
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import ValidationError

from app.core import auth
from app.core import redis as cache
from app.core.config import Settings
from app.services import rate_limit, sse_manager, sse_redis


@pytest.fixture
def redis_state(monkeypatch):
    clock = SimpleNamespace(now=1000.0)
    monkeypatch.setattr(cache, "monotonic", lambda: clock.now)
    monkeypatch.setattr(cache, "_redis_client", None)
    monkeypatch.setattr(cache, "_retry_at", 0.0)
    monkeypatch.setattr(cache, "_state_lock", threading.Lock())
    monkeypatch.setattr(cache, "_probe_lock", threading.Lock())
    return clock


def install_client(monkeypatch, **methods):
    client = SimpleNamespace(connection_pool=Mock(), **methods)
    monkeypatch.setattr(cache, "_redis_client", client)
    return client


def test_connection_failure_cools_down_then_recovers_without_command_retries(redis_state, monkeypatch):
    pools = [Mock(), Mock()]
    clients = [Mock(), Mock()]
    clients[0].ping.side_effect = redis.ConnectionError("offline")
    pool_factory = Mock(side_effect=pools)
    client_factory = Mock(side_effect=clients)
    monkeypatch.setattr(cache.redis, "ConnectionPool", pool_factory)
    monkeypatch.setattr(cache.redis, "Redis", client_factory)
    monkeypatch.setattr(cache.settings, "redis_socket_connect_timeout", 0.17)
    monkeypatch.setattr(cache.settings, "redis_socket_timeout", 0.23)

    assert cache.get_redis() is None
    options = pool_factory.call_args.kwargs
    assert options["socket_connect_timeout"] == 0.17
    assert options["socket_timeout"] == 0.23
    assert options["retry"].get_retries() == 0
    pools[0].disconnect.assert_called_once()
    for _ in range(10):
        assert cache.get_redis() is None
    redis_state.now += 59
    assert cache.get_redis() is None
    assert client_factory.call_count == 1
    redis_state.now += 2
    assert cache.get_redis() is clients[1]
    assert cache.get_redis() is clients[1]
    assert client_factory.call_count == 2
    clients[1].ping.assert_called_once()


def test_concurrent_requests_do_not_wait_for_the_single_recovery_probe(redis_state, monkeypatch):
    entered, release = threading.Event(), threading.Event()

    def ping():
        entered.set()
        assert release.wait(3)

    client = Mock(ping=Mock(side_effect=ping))
    factory = Mock(return_value=client)
    monkeypatch.setattr(cache.redis, "ConnectionPool", Mock())
    monkeypatch.setattr(cache.redis, "Redis", factory)
    with ThreadPoolExecutor(max_workers=8) as executor:
        leader = executor.submit(cache.get_redis)
        try:
            assert entered.wait(2)
            followers = [executor.submit(cache.get_redis) for _ in range(6)]
            assert all(future.result(timeout=1) is None for future in followers)
            assert factory.call_count == 1
        finally:
            release.set()
        assert leader.result(timeout=2) is client


def test_failed_pool_cleanup_does_not_break_fallback_or_leave_probe_locked(redis_state, monkeypatch):
    pool = Mock()
    pool.disconnect.side_effect = redis.ConnectionError("close failed")
    client = Mock()
    client.ping.side_effect = redis.TimeoutError("offline")
    monkeypatch.setattr(cache.redis, "ConnectionPool", Mock(return_value=pool))
    monkeypatch.setattr(cache.redis, "Redis", Mock(return_value=client))
    assert cache.get_redis() is None
    assert not cache._probe_lock.locked()
    assert cache.get_redis() is None


def test_session_failure_opens_shared_circuit_and_redacts_token(redis_state, monkeypatch, caplog):
    client = install_client(monkeypatch, exists=Mock(side_effect=redis.TimeoutError("offline")))
    assert cache.is_session_revoked("secret-token-hash") is False
    assert cache.get_redis() is None
    assert "secret-token-hash" not in caplog.text
    assert client.exists.call_count == 1
    assert cache.is_session_revoked("another-token") is False
    assert client.exists.call_count == 1


@pytest.mark.parametrize('exists,expected', [(0, False), (1, True)])
def test_session_revocation_reads_only_the_marker(redis_state, monkeypatch, exists, expected):
    client = install_client(monkeypatch, exists=Mock(return_value=exists))
    assert cache.is_session_revoked('test-token') is expected
    client.exists.assert_called_once_with(cache.revoked_session_key('test-token'))


@pytest.mark.parametrize("operation", ["publish", "sequence", "subscribe"])
def test_sse_failure_opens_circuit_for_following_operations(redis_state, monkeypatch, operation):
    offline = redis.ConnectionError("offline")
    pubsub = Mock()
    pubsub.psubscribe.side_effect = offline
    client = install_client(
        monkeypatch,
        publish=Mock(side_effect=offline), incr=Mock(side_effect=offline),
        pubsub=Mock(return_value=pubsub),
    )
    operations = {
        "publish": lambda: sse_redis.redis_pubsub.publish("test", {"id": 1}),
        "sequence": lambda: sse_redis.redis_pubsub.next_sequence("inventory"),
        "subscribe": lambda: sse_redis.redis_pubsub.subscribe_patterns("test:*"),
    }
    assert operations[operation]() in (None, 0)
    assert cache.get_redis() is None
    calls = client.publish.call_count
    assert sse_redis.redis_pubsub.publish("test", {}) == 0
    assert client.publish.call_count == calls
    if operation == "subscribe":
        pubsub.close.assert_called_once()


def test_rate_limit_failure_uses_local_limit_and_prevents_repeated_network_calls(redis_state, monkeypatch):
    client = install_client(monkeypatch, incr=Mock(side_effect=redis.TimeoutError("offline")))
    monkeypatch.setattr(rate_limit, "_fallback_store", {})
    monkeypatch.setattr(rate_limit, "_fallback_windows", {})
    for _ in range(3):
        rate_limit.enforce_rate_limit("test", "1", 3, 60)
    with pytest.raises(HTTPException) as error:
        rate_limit.enforce_rate_limit("test", "1", 3, 60)
    assert error.value.status_code == 429
    client.incr.assert_called_once()


def test_late_error_from_old_pool_does_not_disable_recovered_client(redis_state, monkeypatch):
    current = install_client(monkeypatch)
    old = SimpleNamespace(connection_pool=Mock())
    cache.handle_redis_error(redis.ConnectionError("late failure"), "old command", source=old)
    assert cache.get_redis() is current
    current.connection_pool.disconnect.assert_not_called()


def test_subscriber_read_failure_opens_circuit_for_its_pool(redis_state, monkeypatch):
    client = install_client(monkeypatch)
    pubsub = SimpleNamespace(
        connection_pool=client.connection_pool,
        get_message=Mock(side_effect=redis.ConnectionError("lost subscription")),
    )
    sse_manager.SSEManager._pubsub_reader_worker(pubsub, Mock(), Mock(), threading.Event())
    assert cache.get_redis() is None
    pubsub.get_message.assert_called_once()


@pytest.mark.parametrize("field", ["redis_socket_connect_timeout", "redis_socket_timeout"])
@pytest.mark.parametrize("value", [0, -1, 31])
def test_invalid_timeout_configuration_is_rejected(field, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


async def test_business_response_is_sent_before_notification_finishes(monkeypatch):
    application = FastAPI()
    manager = sse_manager.sse_manager
    entered, release = asyncio.Event(), asyncio.Event()
    events = []
    captured = []
    actor = {"id": "original-client"}

    async def notification(*args, **kwargs):
        captured.append((args, kwargs))
        entered.set()
        await release.wait()

    monkeypatch.setattr(manager, "broadcast", notification)
    monkeypatch.setattr(sse_manager, "get_current_sse_client_id", lambda: actor["id"])

    @application.post("/save")
    async def save(background_tasks: BackgroundTasks):
        data = {"item": {"id": 1}}
        manager.schedule_broadcast(background_tasks, "inventory", "updated", data)
        data["item"]["id"] = 2
        actor["id"] = "later-client"
        return {"saved": True}

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(event):
        events.append(event)

    request = asyncio.create_task(application({
        "type": "http", "asgi": {"version": "3.0"}, "method": "POST", "path": "/save",
        "query_string": b"", "headers": [], "scheme": "http",
    }, receive, send))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        assert not request.done()
        assert any(event["type"] == "http.response.body" and not event.get("more_body") for event in events)
        assert events[0]["status"] == 200
        assert captured[0][0][2] == {"item": {"id": 1}}
        assert captured[0][1]["actor_client_id"] == "original-client"
    finally:
        release.set()
        await request


async def test_activity_failure_does_not_skip_following_notifications(monkeypatch):
    def unavailable(*_):
        raise RuntimeError("database is locked")

    events = []
    async def broadcast(*args, **_):
        events.append(args)

    monkeypatch.setattr(auth, "_update_user_activity", unavailable)
    monkeypatch.setattr(sse_manager.sse_manager, "broadcast", broadcast)
    tasks = BackgroundTasks()
    tasks.add_task(auth._update_user_activity_task, "token", "127.0.0.1")
    sse_manager.sse_manager.schedule_broadcast(tasks, "inventory", "inventory.updated", {"id": 1})
    await tasks()
    assert len(events) == 1


async def test_redis_local_and_recovered_sequences_have_distinct_sources(monkeypatch):
    manager = sse_manager.sse_manager
    monkeypatch.setattr(manager, "_rooms", {})
    monkeypatch.setattr(sse_manager.redis_pubsub, "next_sequence", Mock(side_effect=[500, None, None, 501]))
    redis_seq, redis_source = await manager._next_seq("inventory")
    local_seq, local_source = await manager._next_seq("inventory")
    next_local_seq, next_local_source = await manager._next_seq("inventory")
    recovered_seq, recovered_source = await manager._next_seq("inventory")
    assert (redis_seq, local_seq, next_local_seq, recovered_seq) == (500, 1, 2, 501)
    assert redis_source == recovered_source
    assert local_source == next_local_source != redis_source


def test_recovered_subscription_requires_fresh_snapshot_without_clearing_auth_notice(monkeypatch):
    manager = sse_manager.sse_manager
    active = sse_manager.SSEClient(client_id="active")
    active.queue.put_nowait("old business event")
    revoked = sse_manager.SSEClient(client_id="revoked", revoked=True)
    revoked.queue.put_nowait("auth.invalid")
    monkeypatch.setattr(manager, "_clients", {"active": active, "revoked": revoked})
    manager._mark_local_clients_stale()
    assert active.queue.qsize() == 1
    assert active.queue.get_nowait().startswith("event: stale\n")
    assert revoked.queue.get_nowait() == "auth.invalid"
