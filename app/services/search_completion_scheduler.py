from __future__ import annotations

import logging
import threading
import time

from sqlmodel import Session

from app.database import engine
from app.core.config import settings
from app.search_completion_db import (
    TARGET_ENDPOINTS,
    init_search_completion_db,
    mark_entity_completion_index_stale,
)
from app.services.search_completion_entity_index import rebuild_completion_entity_index_if_stale
from app.services.search_completion_lock import completion_rebuild_lock

logger = logging.getLogger(__name__)
POLL_SECONDS = 5.0
MAX_RETRY_SECONDS = 60.0


class CompletionScheduler:
    def __init__(self) -> None:
        self._stop = threading.Event()
        self._mutex = threading.Lock()
        self._pending: set[str] = set()
        self._retry_at: dict[str, float] = {}
        self._failures: dict[str, int] = {}
        self._thread: threading.Thread | None = None
        self._initialized = False

    def invalidate(self, endpoint: str) -> None:
        if endpoint not in TARGET_ENDPOINTS:
            raise ValueError(f"Unsupported search completion endpoint: {endpoint}")
        with self._mutex:
            self._pending.add(endpoint)

    def start(self) -> None:
        if settings.inventory_read_only:
            return
        with self._mutex:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop.clear()
            self._initialized = False
            self._retry_at.clear()
            self._failures.clear()
            self._thread = threading.Thread(
                target=self._run, name="search-completion-rebuilder", daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=5)

    def run_once(self) -> None:
        if settings.inventory_read_only:
            return
        if not self._initialized:
            with completion_rebuild_lock() as acquired:
                if not acquired:
                    return
                init_search_completion_db()
                mark_entity_completion_index_stale()
                self._initialized = True
        for endpoint in TARGET_ENDPOINTS:
            if self._stop.is_set():
                return
            if time.monotonic() < self._retry_at.get(endpoint, 0):
                continue
            with self._mutex:
                invalidated = endpoint in self._pending
                self._pending.discard(endpoint)
            try:
                if invalidated:
                    mark_entity_completion_index_stale(endpoint)
                with Session(engine) as db:
                    rebuild_completion_entity_index_if_stale(db, endpoint)
                self._failures.pop(endpoint, None)
                self._retry_at.pop(endpoint, None)
            except Exception:
                if invalidated:
                    self.invalidate(endpoint)
                failures = min(self._failures.get(endpoint, 0) + 1, 5)
                self._failures[endpoint] = failures
                delay = min(POLL_SECONDS * 2 ** (failures - 1), MAX_RETRY_SECONDS)
                self._retry_at[endpoint] = time.monotonic() + delay
                logger.warning(
                    "Completion rebuild failed endpoint=%s retry_in=%ss", endpoint, delay,
                    exc_info=True,
                )

    def _run(self) -> None:
        delay = POLL_SECONDS
        while not self._stop.is_set():
            try:
                self.run_once()
                delay = POLL_SECONDS
            except Exception:
                logger.warning("Completion initialization failed; retrying in %ss", delay, exc_info=True)
                if self._stop.wait(delay):
                    return
                delay = min(delay * 2, MAX_RETRY_SECONDS)
                continue
            self._stop.wait(POLL_SECONDS)


completion_scheduler = CompletionScheduler()
