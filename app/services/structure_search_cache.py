"""Short-lived cache for structure search result sets."""
from __future__ import annotations

import secrets
import time
from collections.abc import Mapping
from dataclasses import dataclass
from threading import RLock
from types import MappingProxyType

from app.services.cas_utils import normalize_cas
from app.services.structure_index import StructureSearchHit

DEFAULT_STRUCTURE_SEARCH_CACHE_TTL_SECONDS = 12 * 60 * 60
DEFAULT_STRUCTURE_SEARCH_CACHE_MAX_ENTRIES = 128


@dataclass(frozen=True)
class StructureSearchCacheEntry:
    search_id: str
    cas_numbers: tuple[str, ...]
    smiles_by_cas: Mapping[str, str]
    total: int
    index_version: int
    expires_at: float


_cache_lock = RLock()
_cache_entries: dict[str, StructureSearchCacheEntry] = {}


def put_structure_search_results(
    hits: list[StructureSearchHit],
    *,
    index_version: int,
    ttl_seconds: int = DEFAULT_STRUCTURE_SEARCH_CACHE_TTL_SECONDS,
    max_entries: int = DEFAULT_STRUCTURE_SEARCH_CACHE_MAX_ENTRIES,
) -> StructureSearchCacheEntry:
    """Store ordered structure hits and return a lookup token."""
    now = time.monotonic()
    search_id = secrets.token_urlsafe(18)
    cas_numbers: list[str] = []
    smiles_by_cas: dict[str, str] = {}
    seen: set[str] = set()

    for hit in hits:
        normalized = normalize_cas(hit.cas_number)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        cas_numbers.append(normalized)
        if hit.smiles_canonical:
            smiles_by_cas[normalized] = hit.smiles_canonical

    entry = StructureSearchCacheEntry(
        search_id=search_id,
        cas_numbers=tuple(cas_numbers),
        smiles_by_cas=MappingProxyType(smiles_by_cas),
        total=len(cas_numbers),
        index_version=index_version,
        expires_at=now + ttl_seconds,
    )
    with _cache_lock:
        _purge_expired_locked(now)
        _cache_entries[search_id] = entry
        _trim_cache_locked(max_entries=max_entries)
    return entry


def get_structure_search_cache_entry(
    search_id: str | None,
    *,
    index_version: int | None = None,
) -> StructureSearchCacheEntry | None:
    """Return an unexpired cached search result set by token."""
    if not search_id:
        return None
    now = time.monotonic()
    with _cache_lock:
        entry = _cache_entries.get(search_id)
        if entry is None:
            return None
        if entry.expires_at <= now:
            _cache_entries.pop(search_id, None)
            return None
        if index_version is not None and entry.index_version != index_version:
            _cache_entries.pop(search_id, None)
            return None
        return entry


def clear_structure_search_cache() -> None:
    """Clear all cached structure search results."""
    with _cache_lock:
        _cache_entries.clear()


def _purge_expired_locked(now: float) -> None:
    expired_ids = [
        search_id
        for search_id, entry in _cache_entries.items()
        if entry.expires_at <= now
    ]
    for search_id in expired_ids:
        _cache_entries.pop(search_id, None)


def _trim_cache_locked(*, max_entries: int) -> None:
    while len(_cache_entries) > max_entries:
        oldest_id = min(_cache_entries, key=lambda key: _cache_entries[key].expires_at)
        _cache_entries.pop(oldest_id, None)
