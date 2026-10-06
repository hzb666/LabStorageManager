import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import search_completion_db as completion_db
from app.search_completion_db import sqlite3
from app.api import search_completions
from app.core.auth import get_current_user
from app.services import search_completion_entity_index as entity_index
from app.services import search_completion_ranker as ranker
from app.services import search_completion_scheduler as scheduler_module
from app.services.search_completion_lock import completion_rebuild_lock

ENDPOINT = completion_db.INVENTORY_COMPLETION_ENDPOINT


@pytest.fixture
def completion_database(tmp_path, monkeypatch):
    monkeypatch.setattr(completion_db, "COMPLETION_DB_PATH", tmp_path / "search_completion.db")
    monkeypatch.setattr(completion_db, "LEGACY_DB_PATH", tmp_path / "query_logs.db")
    monkeypatch.setattr(search_completions, "_inline_retry_at", 0.0)
    completion_db.init_search_completion_db()
    return completion_db.COMPLETION_DB_PATH


def entity_row(value, entity_id="1", field="name"):
    return (ENDPOINT, field, value, value.casefold(), "inventory", entity_id, None, 1.0)


def index_values():
    with completion_db.completion_read_connection() as connection:
        return [row[0] for row in connection.execute(
            "SELECT value FROM entity_completion_index WHERE endpoint = ? ORDER BY value", (ENDPOINT,),
        )]


def seed_index(value="ethanol"):
    generation = completion_db.get_entity_completion_generation(ENDPOINT)
    assert completion_db.replace_entity_completion_index(ENDPOINT, [entity_row(value)], generation)


def inline_client():
    application = FastAPI()
    application.include_router(search_completions.router)
    application.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    return TestClient(application)


def test_atomic_replacement_readers_never_see_empty_index(completion_database, monkeypatch):
    seed_index()
    completion_db.mark_entity_completion_index_stale(ENDPOINT)
    generation = completion_db.get_entity_completion_generation(ENDPOINT)
    open_connection = completion_db._open_connection
    observed = []

    @contextmanager
    def observing_connection():
        with open_connection() as connection:
            def observe(statement):
                if statement.lstrip().startswith("INSERT INTO entity_completion_index"):
                    observed.append(index_values())
            connection.set_trace_callback(observe)
            yield connection

    monkeypatch.setattr(completion_db, "_open_connection", observing_connection)
    assert completion_db.replace_entity_completion_index(ENDPOINT, [entity_row("ether")], generation)
    assert observed == [["ethanol"]]
    assert index_values() == ["ether"]
    assert not completion_db.is_entity_completion_index_stale(ENDPOINT)


def test_current_database_initialization_is_read_only(completion_database, monkeypatch):
    upgrade = Mock(side_effect=AssertionError("must not migrate again"))
    write = Mock(side_effect=AssertionError("must not open writer"))
    monkeypatch.setattr(completion_db, "_upgrade_search_completion_db", upgrade)
    monkeypatch.setattr(completion_db, "_open_connection", write)
    with closing(sqlite3.connect(str(completion_database))) as competing_writer:
        competing_writer.execute("BEGIN IMMEDIATE")
        assert completion_db.is_search_completion_db_current()
        completion_db.init_search_completion_db()
        competing_writer.rollback()
    upgrade.assert_not_called()
    write.assert_not_called()


def test_old_version_upgrades_without_reimporting_legacy_data(completion_database, monkeypatch):
    with completion_db._open_connection() as connection:
        connection.execute(
            "UPDATE search_completion_meta SET value = 'old' WHERE key = ?",
            (completion_db.ENTITY_INDEX_VERSION_KEY,),
        )
    assert not completion_db.is_search_completion_db_current()
    completion_db.init_search_completion_db()
    assert completion_db.is_search_completion_db_current()
    assert completion_db.is_entity_completion_index_stale(ENDPOINT)


def test_upgrade_double_checks_after_acquiring_writer(completion_database, monkeypatch):
    migrate = Mock(side_effect=AssertionError("must not migrate current database"))
    monkeypatch.setattr(completion_db, "_migrate_legacy_completion_data", migrate)
    completion_db._upgrade_search_completion_db()
    migrate.assert_not_called()


def test_read_only_mode_never_creates_completion_database(tmp_path, monkeypatch):
    monkeypatch.setattr(completion_db.settings, "maintenance_mode", "on")
    database_path = tmp_path / "absent" / "search_completion.db"
    monkeypatch.setattr(completion_db, "COMPLETION_DB_PATH", database_path)
    completion_db.init_search_completion_db()
    assert not database_path.parent.exists()


def test_failed_insert_rolls_back_delete_and_preserves_stale(completion_database):
    seed_index()
    completion_db.mark_entity_completion_index_stale(ENDPOINT)
    generation = completion_db.get_entity_completion_generation(ENDPOINT)
    with completion_db._open_connection() as connection:
        connection.execute(
            "CREATE TRIGGER reject_completion BEFORE INSERT ON entity_completion_index "
            "BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError):
        completion_db.replace_entity_completion_index(ENDPOINT, [entity_row("ether")], generation)
    assert index_values() == ["ethanol"]
    assert completion_db.is_entity_completion_index_stale(ENDPOINT)


@pytest.mark.parametrize("change", ["invalidate", "replace", "delete"])
def test_rebuild_cannot_overwrite_concurrent_changes(completion_database, change):
    seed_index()
    completion_db.mark_entity_completion_index_stale(ENDPOINT)
    generation = completion_db.get_entity_completion_generation(ENDPOINT)
    if change == "invalidate":
        completion_db.mark_entity_completion_index_stale(ENDPOINT)
    elif change == "replace":
        completion_db.replace_entity_completions_for_entity(
            ENDPOINT, "inventory", "1", [entity_row("ethyl acetate")],
        )
    else:
        completion_db.delete_entity_completions_for_entity(ENDPOINT, "inventory", "1")
    current_values = index_values()
    assert not completion_db.replace_entity_completion_index(ENDPOINT, [entity_row("ether")], generation)
    assert index_values() == current_values
    assert completion_db.is_entity_completion_index_stale(ENDPOINT)


def test_concurrent_stale_requests_use_old_index_during_one_rebuild(completion_database, monkeypatch):
    seed_index()
    completion_db.mark_entity_completion_index_stale(ENDPOINT)
    entered = threading.Event()
    finish = threading.Event()
    build_count = []

    def build(*_args):
        build_count.append(1)
        entered.set()
        assert finish.wait(5)
        return [entity_row("ether")], 1

    monkeypatch.setattr(entity_index, "_build_endpoint_rows", build)
    with ThreadPoolExecutor(max_workers=8) as executor:
        rebuilding = executor.submit(entity_index.rebuild_completion_entity_index_if_stale, None, ENDPOINT)
        try:
            assert entered.wait(3)
            contenders = [executor.submit(
                entity_index.rebuild_completion_entity_index_if_stale, None, ENDPOINT,
            ) for _ in range(6)]
            for contender in contenders:
                contender.result(timeout=2)
            with inline_client() as client:
                for _ in range(5):
                    response = client.get("/search-completions/inline", params={"endpoint": ENDPOINT, "q": "et"})
                    assert response.status_code == 200
                    assert response.json()["completion"] == "ethanol"
        finally:
            finish.set()
        rebuilding.result(timeout=3)
    assert len(build_count) == 1
    assert index_values() == ["ether"]


def test_rebuild_lock_excludes_another_process_and_releases(completion_database):
    script = (
        "from pathlib import Path; from app import search_completion_db as db; "
        "from app.services.search_completion_lock import completion_rebuild_lock; "
        "import sys; db.COMPLETION_DB_PATH = Path(sys.argv[1]); "
        "lock = completion_rebuild_lock(); acquired = lock.__enter__(); "
        "print(acquired); lock.__exit__(None, None, None)"
    )
    def child_lock():
        result = subprocess.run(
            [sys.executable, "-c", script, str(completion_database)],
            capture_output=True, text=True, timeout=15, check=True,
        )
        return result.stdout.strip()
    with completion_rebuild_lock() as acquired:
        assert acquired
        assert child_lock() == "False"
    assert child_lock() == "True"


def test_locked_database_returns_empty_200_with_short_wait(completion_database):
    with closing(sqlite3.connect(completion_database)) as writer:
        writer.execute("PRAGMA journal_mode=DELETE")
        writer.execute("BEGIN EXCLUSIVE")
        with inline_client() as client:
            started = time.monotonic()
            response = client.get("/search-completions/inline", params={"endpoint": ENDPOINT, "q": "et"})
            assert time.monotonic() - started < 1.0
            assert response.status_code == 200
            assert response.json()["completion"] is None


def test_completion_failure_is_throttled_without_hiding_programming_errors(completion_database, monkeypatch):
    failing = Mock(side_effect=sqlite3.OperationalError("database is locked"))
    monkeypatch.setattr(search_completions, "get_inline_completion", failing)
    with inline_client() as client:
        for _ in range(5):
            assert client.get("/search-completions/inline", params={"endpoint": ENDPOINT, "q": "et"}).status_code == 200
    assert failing.call_count == 1
    monkeypatch.setattr(search_completions, "_inline_retry_at", 0.0)
    failing.side_effect = ValueError("programming error")
    with inline_client() as client, pytest.raises(ValueError, match="programming error"):
        client.get("/search-completions/inline", params={"endpoint": ENDPOINT, "q": "et"})


def test_ranker_reuses_one_read_connection(completion_database, monkeypatch):
    seed_index()
    open_read = completion_db.completion_read_connection
    connections = []

    @contextmanager
    def counted_read():
        with open_read() as connection:
            connections.append(connection)
            yield connection

    monkeypatch.setattr(ranker, "completion_read_connection", counted_read)
    result = ranker.get_inline_completion(ranker.InlineCompletionRequest(1, ENDPOINT, "all", "et"))
    assert result.completion == "ethanol"
    assert len(connections) == 1
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connections[0].execute("SELECT 1")


def test_raw_log_writer_does_not_lock_completion_database(completion_database):
    with closing(sqlite3.connect(completion_db.LEGACY_DB_PATH)) as writer:
        writer.execute("CREATE TABLE search_logs (query TEXT)")
        writer.execute("BEGIN IMMEDIATE")
        writer.execute("INSERT INTO search_logs VALUES ('held transaction')")
        seed_index()
        assert index_values() == ["ethanol"]


def test_legacy_migration_preserves_preferences_and_memory_once(tmp_path, monkeypatch):
    legacy_path = tmp_path / "query_logs.db"
    monkeypatch.setattr(completion_db, "LEGACY_DB_PATH", legacy_path)
    monkeypatch.setattr(completion_db, "COMPLETION_DB_PATH", tmp_path / "search_completion.db")
    with closing(sqlite3.connect(legacy_path)) as connection:
        connection.executescript(completion_db._COMPLETION_SCHEMA)
        connection.execute("INSERT INTO user_search_preferences (user_id, personalization_enabled) VALUES (7, 0)")
        connection.execute(
            "INSERT INTO search_query_memory "
            "(user_id, endpoint, query, normalized_query, frequency, accept_count) "
            "VALUES (7, ?, 'ethanol', 'ethanol', 9, 3)", (ENDPOINT,),
        )
        connection.commit()
    completion_db.init_search_completion_db()
    assert not completion_db.get_user_preferences(7).personalization_enabled
    memories = completion_db.query_memory_by_prefix(user_id=7, endpoint=ENDPOINT, search_field=None, prefix="et")
    assert [(row.frequency, row.accept_count) for row in memories] == [(9, 3)]
    completion_db.upsert_user_preferences(7, True)
    completion_db.init_search_completion_db()
    assert completion_db.get_user_preferences(7).personalization_enabled
    with closing(sqlite3.connect(legacy_path)) as connection:
        assert connection.execute("SELECT COUNT(*) FROM search_query_memory").fetchone()[0] == 1


def test_scheduler_backs_off_and_retries_failed_invalidation(completion_database, monkeypatch):
    scheduler = scheduler_module.CompletionScheduler()
    scheduler._initialized = True
    scheduler.invalidate(ENDPOINT)
    now = [100.0]
    monkeypatch.setattr(scheduler_module.time, "monotonic", lambda: now[0])
    mark_stale = Mock(side_effect=sqlite3.OperationalError("database is locked"))
    rebuild = Mock()
    monkeypatch.setattr(scheduler_module, "mark_entity_completion_index_stale", mark_stale)
    monkeypatch.setattr(scheduler_module, "rebuild_completion_entity_index_if_stale", rebuild)
    scheduler.run_once()
    scheduler.run_once()
    assert mark_stale.call_count == 1
    assert ENDPOINT in scheduler._pending
    now[0] += 5
    mark_stale.side_effect = None
    scheduler.run_once()
    assert mark_stale.call_count == 2
    assert ENDPOINT not in scheduler._pending
    assert any(call.args[1] == ENDPOINT for call in rebuild.call_args_list)


def test_scheduler_start_does_not_wait_for_database_initialization(monkeypatch, completion_database):
    scheduler = scheduler_module.CompletionScheduler()
    entered = threading.Event()
    finish = threading.Event()

    def initialize():
        entered.set()
        assert finish.wait(5)

    monkeypatch.setattr(scheduler_module, "init_search_completion_db", initialize)
    monkeypatch.setattr(scheduler_module, "rebuild_completion_entity_index_if_stale", Mock())
    try:
        scheduler.start()
        assert entered.wait(2)
        assert scheduler._thread.is_alive()
    finally:
        finish.set()
        scheduler.stop()
    assert not scheduler._thread.is_alive()


@pytest.mark.parametrize("operation", ["replace", "delete", "invalidate"])
def test_request_index_writes_fail_fast_and_recover_in_background(completion_database, monkeypatch, operation):
    seed_index()
    scheduler = scheduler_module.CompletionScheduler()
    scheduler._initialized = True
    monkeypatch.setattr(scheduler_module, "completion_scheduler", scheduler)
    monkeypatch.setattr(entity_index, "_build_endpoint_rows", lambda *_: ([entity_row("ether")], 1))
    operations = {
        "replace": lambda: completion_db.replace_entity_completions_for_entity(
            ENDPOINT, "inventory", "1", [entity_row("ether")],
        ),
        "delete": lambda: completion_db.delete_entity_completions_for_entity(ENDPOINT, "inventory", "1"),
        "invalidate": lambda: completion_db.mark_entity_completion_index_stale(ENDPOINT),
    }
    with closing(sqlite3.connect(completion_database)) as writer:
        writer.execute("BEGIN IMMEDIATE")
        started = time.monotonic()
        entity_index.run_completion_index_update(operations[operation], context="test", endpoint=ENDPOINT)
        assert time.monotonic() - started < 1.0
        assert ENDPOINT in scheduler._pending
        assert index_values() == ["ethanol"]
    scheduler.run_once()
    assert ENDPOINT not in scheduler._pending
    assert index_values() == ["ether"]
    assert not completion_db.is_entity_completion_index_stale(ENDPOINT)


def test_request_write_timeout_is_scoped_and_restored(completion_database):
    def busy_timeout():
        with completion_db._open_connection() as connection:
            return connection.execute("PRAGMA busy_timeout").fetchone()[0]

    with ThreadPoolExecutor(max_workers=1) as executor:
        with pytest.raises(RuntimeError, match="stop"):
            with completion_db.completion_write_timeout(0.1):
                assert busy_timeout() == 100
                assert executor.submit(busy_timeout).result() == 3000
                raise RuntimeError("stop")
    assert busy_timeout() == 3000


@pytest.mark.parametrize("kind", ["inventory", "reagent", "consumable"])
def test_incremental_and_full_rebuild_share_entity_rows(monkeypatch, kind):
    item = SimpleNamespace(
        id=3, name="ETHANOL", cas_number="64-17-5", storage_location="柜A", brand="Brand",
        category="", specification="500mL", communication="备注", applicant_id=7,
        status=SimpleNamespace(value="in_stock" if kind == "inventory" else "pending"),
    )
    db = Mock()
    db.exec.return_value.all.return_value = [item]
    monkeypatch.setattr(entity_index, "batch_get_user_names", lambda *_: {7: "张三"})
    replace_rows = Mock()
    monkeypatch.setattr(entity_index, "replace_entity_completions_for_entity", replace_rows)
    rows, count = getattr(entity_index, f"_build_{kind}_index")(db)
    if kind == "inventory":
        entity_index.sync_inventory_entity_completions(item)
    else:
        getattr(entity_index, f"sync_{kind}_order_entity_completions")(item, db=db)
    assert count == 1
    assert replace_rows.call_args.args[3] == rows
    assert any(row[1:4] == ("name", "ETHANOL", "ethanol") for row in rows)
    assert not any(row[1] == "category" for row in rows)
    if kind != "inventory":
        assert any(row[1:3] == ("applicant", "张三") for row in rows)
        item.applicant_id = None
        getattr(entity_index, f"sync_{kind}_order_entity_completions")(item, applicant_name="李四")
        assert any(row[1:3] == ("applicant", "李四") for row in replace_rows.call_args.args[3])
