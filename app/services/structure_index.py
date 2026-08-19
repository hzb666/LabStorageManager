"""Revisioned RDKit index with immutable base snapshots and a small delta."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import os
import re
import tempfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from threading import RLock, Semaphore
from types import MappingProxyType

from rdkit import Chem, DataStructs, rdBase
from rdkit.Chem import rdSubstructLibrary
from sqlalchemy import text
from sqlmodel import Session, select

from app.core.config import settings
from app.models.compound_structure import (
    CompoundStructureCache,
    CompoundStructureSource,
    CompoundStructureStatus,
)
from app.models.structure_index import (
    StructureIndexChange,
    StructureIndexChangeOperation,
    StructureIndexMeta,
)
from app.services.rdkit_smiles import mol_from_smiles_quiet_h_removal

logger = logging.getLogger(__name__)
INDEX_SNAPSHOT_SCHEMA_VERSION = 3
DEFAULT_SNAPSHOT_PATH = (
    Path(__file__).resolve().parents[2] / ".cache" / "structure-index.snapshot.json"
)
_INDEX_EVENT_BATCH_SIZE = 512


@dataclass(frozen=True)
class StructureIndexRecord:
    cas_number: str
    smiles_canonical: str
    smiles_isomeric: str | None
    exact_smiles_canonical: str
    exact_smiles_isomeric: str | None
    inchikey: str | None
    source: CompoundStructureSource | None
    mol: object
    fingerprint: object
    atom_count: int


@dataclass(frozen=True)
class StructureSearchHit:
    cas_number: str
    smiles_canonical: str
    inchikey: str | None
    source: CompoundStructureSource | None
    similarity: float
    matched_atom_ratio: float
    atom_count_delta: int


@dataclass(frozen=True)
class StructureIndexSnapshot:
    version: int
    dirty: bool
    molecule_count: int
    db_revision: int = 0
    applied_revision: int = 0
    revision_lag: int = 0
    base_count: int = 0
    delta_count: int = 0
    tombstone_count: int = 0
    last_compaction_duration_ms: float | None = None
    snapshot_loaded: bool = False


@dataclass(frozen=True)
class _IndexState:
    generation_id: str
    base_revision: int
    base_library: rdSubstructLibrary.SubstructLibrary
    base_records: tuple[StructureIndexRecord, ...]
    delta_revision: int
    delta_library: rdSubstructLibrary.SubstructLibrary
    delta_records_by_cas: Mapping[str, StructureIndexRecord]
    suppressed_cas: frozenset[str]

    @property
    def applied_revision(self) -> int:
        return self.delta_revision


@dataclass(frozen=True)
class _IndexMetaSnapshot:
    generation_id: str
    current_revision: int


class StructureIndexUnavailableError(RuntimeError):
    """Raised when revision completeness cannot be proven."""


class StructureIndexRevisionChangedError(RuntimeError):
    """Raised when search state no longer matches its revision barrier."""


class StructureQueryFormat(str, Enum):
    SMARTS = "smarts"
    MOLBLOCK = "molblock"
    SMILES = "smiles"


class StructureSearchMode(str, Enum):
    SUBSTRUCTURE = "substructure"
    EXACT = "exact"


_DUMMY_ATOM_SMARTS_PATTERN = re.compile(r"\[#0(?P<atom_map>:\d+)?\]")


class SubstructureIndex:
    """Thread-safe immutable base plus incremental delta index."""

    def __init__(self, *, snapshot_path: str | Path | None = None) -> None:
        self._lock = RLock()
        self._sync_lock = RLock()
        self._state: _IndexState | None = None
        self._last_db_revision = 0
        self._notified_dirty = True
        resolved_snapshot_path = Path(snapshot_path or DEFAULT_SNAPSHOT_PATH)
        if not resolved_snapshot_path.is_absolute():
            resolved_snapshot_path = Path(__file__).resolve().parents[2] / resolved_snapshot_path
        self._snapshot_path = resolved_snapshot_path
        self._snapshot_loaded = False
        self._last_compaction_duration_ms: float | None = None
        self._change_notifier: Callable[[], None] | None = None
        self._search_semaphore = Semaphore(settings.chem_structure_search_concurrency)

    def notify_change(self) -> None:
        """Wake background maintenance; request paths only apply bounded deltas."""
        with self._lock:
            self._notified_dirty = True
            notifier = self._change_notifier
        if notifier is not None:
            notifier()

    def set_change_notifier(self, notifier: Callable[[], None] | None) -> None:
        with self._lock:
            self._change_notifier = notifier

    def is_initialized(self) -> bool:
        with self._lock:
            return self._state is not None

    def status(self, db: Session | None = None) -> StructureIndexSnapshot:
        db_revision = _get_index_meta(db).current_revision if db is not None else None
        with self._lock:
            if db_revision is not None:
                self._last_db_revision = db_revision
            return self._snapshot_locked(db_revision=db_revision)

    def rebuild(self, db: Session) -> StructureIndexSnapshot:
        """Explicit full rebuild used by admin operations, never ordinary search."""
        return self.compact(db)

    def compact(
        self,
        db: Session,
        *,
        on_base_captured: Callable[[], None] | None = None,
    ) -> StructureIndexSnapshot:
        """Build and publish a full base, then replay changes committed during the build."""
        with self._sync_lock, Session(db.get_bind()) as compaction_db:
            return self._compact(
                compaction_db,
                on_base_captured=on_base_captured,
            )

    def _compact(
        self,
        db: Session,
        *,
        on_base_captured: Callable[[], None] | None,
    ) -> StructureIndexSnapshot:
        from time import perf_counter

        started = perf_counter()
        base_meta = _get_index_meta(db)
        base_revision = base_meta.current_revision
        base_records = _load_resolved_records(db)
        db.rollback()
        if on_base_captured is not None:
            on_base_captured()
        base_library, indexed_records = _build_library(base_records)
        base_state = _IndexState(
            generation_id=base_meta.generation_id,
            base_revision=base_revision,
            base_library=base_library,
            base_records=tuple(indexed_records),
            delta_revision=base_revision,
            delta_library=_empty_library(),
            delta_records_by_cas=MappingProxyType({}),
            suppressed_cas=frozenset(),
        )
        self._write_snapshot(base_state)

        target_meta = _get_index_meta(db)
        if target_meta.generation_id != base_meta.generation_id:
            raise StructureIndexUnavailableError(
                "Structure index database generation changed during compaction"
            )
        target_revision = target_meta.current_revision
        published_state = self._apply_events(
            db,
            state=base_state,
            target_revision=target_revision,
        )
        with self._lock:
            self._state = published_state
            self._last_db_revision = target_revision
            self._notified_dirty = False
            self._snapshot_loaded = False
            self._last_compaction_duration_ms = (perf_counter() - started) * 1000
            snapshot = self._snapshot_locked(db_revision=target_revision)

        db.exec(
            text(
                """
                UPDATE structure_index_meta
                SET last_compacted_revision = :revision, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1 AND generation_id = :generation_id
                """
            ),
            params={
                "revision": base_revision,
                "generation_id": base_meta.generation_id,
            },
        )
        db.exec(
            text("DELETE FROM structure_index_change WHERE revision <= :revision"),
            params={"revision": base_revision},
        )
        db.commit()
        return snapshot

    def load_snapshot(self, db: Session) -> bool:
        """Load a persistent base only when it belongs to the active database."""
        with self._sync_lock:
            return self._load_snapshot(db)

    def _load_snapshot(
        self,
        db: Session,
    ) -> bool:
        try:
            state = self._read_snapshot()
            meta = _get_index_meta(db)
            if (
                state.generation_id != meta.generation_id
                or state.base_revision > meta.current_revision
            ):
                return False
        except FileNotFoundError:
            return False
        except (
            OSError,
            RuntimeError,
            ValueError,
            TypeError,
        ):
            logger.warning("structure_index_snapshot outcome=rejected path=%s", self._snapshot_path)
            return False
        with self._lock:
            self._state = state
            self._last_db_revision = state.applied_revision
            self._notified_dirty = False
            self._snapshot_loaded = True
        return True

    @staticmethod
    def replay_requires_compaction(snapshot: StructureIndexSnapshot) -> bool:
        return snapshot.revision_lag >= _incremental_event_threshold(snapshot.base_count)

    def ensure_current(self, db: Session) -> StructureIndexSnapshot:
        """Revision barrier: replay every event committed at the captured DB revision."""
        with self._sync_lock:
            return self._ensure_current(db, allow_snapshot_recovery=True)

    def _ensure_current(
        self,
        db: Session,
        *,
        allow_snapshot_recovery: bool,
    ) -> StructureIndexSnapshot:
        meta = _get_index_meta(db)
        target_revision = meta.current_revision
        with self._lock:
            state = self._state
        if state is None or state.generation_id != meta.generation_id:
            if allow_snapshot_recovery and self._load_snapshot(db):
                return self._ensure_current(db, allow_snapshot_recovery=False)
            raise StructureIndexUnavailableError(
                "Structure index has no valid base for this database; "
                "background compaction is required"
            )
        if state.applied_revision > target_revision:
            raise StructureIndexUnavailableError("Structure index revision is ahead of the database")
        if state.applied_revision == target_revision:
            with self._lock:
                self._last_db_revision = target_revision
                self._notified_dirty = False
                return self._snapshot_locked(db_revision=target_revision)
        if target_revision - state.applied_revision >= _incremental_event_threshold(
            len(state.base_records)
        ):
            self.notify_change()
            raise StructureIndexUnavailableError(
                "Structure index revision lag requires background compaction"
            )

        try:
            new_state = self._apply_events(
                db,
                state=state,
                target_revision=target_revision,
            )
        except StructureIndexUnavailableError:
            old_revision = state.applied_revision
            if allow_snapshot_recovery and self._load_snapshot(db):
                with self._lock:
                    recovered = self._state
                if recovered is not None and recovered.applied_revision > old_revision:
                    return self._ensure_current(db, allow_snapshot_recovery=False)
            raise
        with self._lock:
            self._state = new_state
            self._last_db_revision = target_revision
            self._notified_dirty = False
            return self._snapshot_locked(db_revision=target_revision)

    def _apply_events(
        self,
        db: Session,
        *,
        state: _IndexState,
        target_revision: int,
    ) -> _IndexState:
        if target_revision == state.applied_revision:
            return state
        latest_by_cas = _load_latest_changes(
            db,
            start_revision=state.applied_revision + 1,
            target_revision=target_revision,
        )
        delta_records = dict(state.delta_records_by_cas)
        suppressed = set(state.suppressed_cas)
        for cas_number, event in latest_by_cas.items():
            suppressed.add(cas_number)
            if _change_is_indexable(event):
                delta_records[cas_number] = _record_from_change(event)
            else:
                delta_records.pop(cas_number, None)
        delta_library, indexed_delta = _build_library(
            [delta_records[cas] for cas in sorted(delta_records)]
        )
        return _IndexState(
            generation_id=state.generation_id,
            base_revision=state.base_revision,
            base_library=state.base_library,
            base_records=state.base_records,
            delta_revision=target_revision,
            delta_library=delta_library,
            delta_records_by_cas=MappingProxyType(
                {record.cas_number: record for record in indexed_delta}
            ),
            suppressed_cas=frozenset(suppressed),
        )

    def _snapshot_locked(self, *, db_revision: int | None) -> StructureIndexSnapshot:
        state = self._state
        applied_revision = state.applied_revision if state is not None else 0
        current_revision = (
            self._last_db_revision if db_revision is None else db_revision
        )
        if state is None:
            base_count = delta_count = tombstone_count = molecule_count = 0
        else:
            base_count = len(state.base_records)
            delta_count = len(state.delta_records_by_cas)
            tombstone_count = len(state.suppressed_cas - set(state.delta_records_by_cas))
            molecule_count = (
                sum(
                    record.cas_number not in state.suppressed_cas
                    for record in state.base_records
                )
                + delta_count
            )
        lag = max(0, current_revision - applied_revision)
        return StructureIndexSnapshot(
            version=applied_revision,
            dirty=self._notified_dirty or lag > 0 or state is None,
            molecule_count=molecule_count,
            db_revision=current_revision,
            applied_revision=applied_revision,
            revision_lag=lag,
            base_count=base_count,
            delta_count=delta_count,
            tombstone_count=tombstone_count,
            last_compaction_duration_ms=self._last_compaction_duration_ms,
            snapshot_loaded=self._snapshot_loaded,
        )

    def search(
        self,
        *,
        query: str,
        query_format: str,
        limit: int,
        allowed_cas_numbers: set[str] | None = None,
        expected_revision: int | None = None,
    ) -> list[StructureSearchHit]:
        query_mol = _parse_query_molecule(query=query, query_format=query_format)
        use_chirality = _query_has_stereochemistry(query_mol)
        query_fp = Chem.PatternFingerprint(query_mol)
        with self._search_semaphore:
            with self._lock:
                state = self._require_searchable_state_locked(expected_revision)
            base_hits = _collect_library_hits(
                library=state.base_library,
                records=state.base_records,
                query_mol=query_mol,
                query_fp=query_fp,
                use_chirality=use_chirality,
                allowed_cas_numbers=allowed_cas_numbers,
                suppressed_cas=state.suppressed_cas,
            )
            delta_records = tuple(state.delta_records_by_cas.values())
            delta_hits = _collect_library_hits(
                library=state.delta_library,
                records=delta_records,
                query_mol=query_mol,
                query_fp=query_fp,
                use_chirality=use_chirality,
                allowed_cas_numbers=allowed_cas_numbers,
                suppressed_cas=frozenset(),
            )
            return _sort_and_limit_hits(base_hits + delta_hits, limit=limit)

    def exact_search(
        self,
        *,
        query: str,
        query_format: str,
        limit: int,
        allowed_cas_numbers: set[str] | None = None,
        expected_revision: int | None = None,
    ) -> list[StructureSearchHit]:
        if query_format == StructureQueryFormat.SMARTS:
            query_mol, r_atom_indices = _parse_simple_r_exact_query(query=query)
            use_chirality = _query_has_stereochemistry(query_mol)
            query_fp = Chem.PatternFingerprint(query_mol)
            with self._search_semaphore:
                with self._lock:
                    state = self._require_searchable_state_locked(expected_revision)
                    records = _current_records(state)
                return _select_exact_r_group_hits(
                    records=records,
                    query_mol=query_mol,
                    query_fp=query_fp,
                    r_atom_indices=r_atom_indices,
                    limit=limit,
                    use_chirality=use_chirality,
                    allowed_cas_numbers=allowed_cas_numbers,
                )

        query_mol = _parse_exact_query_molecule(query=query, query_format=query_format)
        use_chirality = _query_has_stereochemistry(query_mol)
        query_smiles = _canonical_query_smiles(query_mol, use_chirality=use_chirality)
        with self._search_semaphore:
            with self._lock:
                state = self._require_searchable_state_locked(expected_revision)
                records = _current_records(state)
            return _select_exact_hits(
                records=records,
                query_smiles=query_smiles,
                limit=limit,
                use_chirality=use_chirality,
                allowed_cas_numbers=allowed_cas_numbers,
                query_atom_count=query_mol.GetNumAtoms(),
            )

    def _require_searchable_state_locked(
        self,
        expected_revision: int | None,
    ) -> _IndexState:
        state = self._state
        if state is None:
            raise RuntimeError("Structure index is unavailable")
        if expected_revision is not None and state.applied_revision != expected_revision:
            raise StructureIndexRevisionChangedError(
                f"Expected structure index revision {expected_revision}, "
                f"found {state.applied_revision}"
            )
        if not state.base_records and not state.delta_records_by_cas:
            raise RuntimeError("Structure index is empty; backfill or resolve cache entries")
        return state

    def _write_snapshot(self, state: _IndexState) -> None:
        payload = _snapshot_payload(state)
        checksum = _snapshot_checksum(payload)
        document = {**payload, "checksum": checksum}
        self._snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{self._snapshot_path.name}.",
            suffix=".tmp",
            dir=self._snapshot_path.parent,
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(document, handle, ensure_ascii=False, separators=(",", ":"))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_name, self._snapshot_path)
            _fsync_parent_directory(self._snapshot_path)
        except Exception:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
            raise

    def _read_snapshot(self) -> _IndexState:
        document = json.loads(self._snapshot_path.read_text(encoding="utf-8"))
        if not isinstance(document, dict):
            raise ValueError("Structure index snapshot must be an object")  # noqa: TRY004
        checksum = document.pop("checksum", None)
        if not isinstance(checksum, str) or checksum != _snapshot_checksum(document):
            raise ValueError("Structure index snapshot checksum mismatch")
        if document.get("index_schema_version") != INDEX_SNAPSHOT_SCHEMA_VERSION:
            raise ValueError("Structure index snapshot schema mismatch")
        if document.get("rdkit_version") != rdBase.rdkitVersion:
            raise ValueError("Structure index snapshot RDKit version mismatch")

        raw_records = document.get("records")
        encoded_library = document.get("serialized_library")
        base_revision = document.get("base_revision")
        generation_id = document.get("generation_id")
        if (
            not isinstance(raw_records, list)
            or not isinstance(encoded_library, str)
            or not isinstance(base_revision, int)
            or not isinstance(generation_id, str)
            or not generation_id
        ):
            raise ValueError("Structure index snapshot fields are invalid")
        library = rdSubstructLibrary.SubstructLibrary()
        library.InitFromStream(
            io.BytesIO(base64.b64decode(encoded_library, validate=True))
        )
        if len(library) != len(raw_records) or document.get("molecule_count") != len(raw_records):
            raise ValueError("Structure index snapshot record count mismatch")
        fingerprint_holder = library.GetFpHolder()
        if fingerprint_holder is None:
            raise ValueError("Structure index snapshot fingerprint holder is missing")
        records = tuple(
            _record_from_snapshot(
                item,
                mol=library.GetMol(index),
                fingerprint=fingerprint_holder.GetFingerprint(index),
            )
            for index, item in enumerate(raw_records)
        )
        cas_numbers = [record.cas_number for record in records]
        if len(cas_numbers) != len(set(cas_numbers)):
            raise ValueError("Structure index snapshot contains duplicate CAS records")
        return _IndexState(
            generation_id=generation_id,
            base_revision=base_revision,
            base_library=library,
            base_records=records,
            delta_revision=base_revision,
            delta_library=_empty_library(),
            delta_records_by_cas=MappingProxyType({}),
            suppressed_cas=frozenset(),
        )


def _load_resolved_records(db: Session) -> list[StructureIndexRecord]:
    rows = db.exec(
        select(CompoundStructureCache)
        .where(CompoundStructureCache.status == CompoundStructureStatus.RESOLVED)
        .where(CompoundStructureCache.smiles_canonical.is_not(None))
        .order_by(CompoundStructureCache.cas_number)
    ).all()
    records: list[StructureIndexRecord] = []
    for row in rows:
        if not row.smiles_canonical:
            continue
        records.append(
            _build_record(
                cas_number=row.cas_number,
                smiles_canonical=str(row.smiles_canonical),
                smiles_isomeric=row.smiles_isomeric,
                inchikey=row.inchikey,
                source=row.source,
            )
        )
    return records


def _get_index_meta(db: Session) -> _IndexMetaSnapshot:
    meta = db.get(StructureIndexMeta, 1)
    if meta is None:
        raise StructureIndexUnavailableError("Structure index metadata is missing")
    if not meta.generation_id:
        raise StructureIndexUnavailableError("Structure index database generation is missing")
    return _IndexMetaSnapshot(
        generation_id=meta.generation_id,
        current_revision=int(meta.current_revision),
    )


def _load_latest_changes(
    db: Session,
    *,
    start_revision: int,
    target_revision: int,
) -> dict[str, StructureIndexChange]:
    latest_by_cas: dict[str, StructureIndexChange] = {}
    next_revision = start_revision
    while next_revision <= target_revision:
        events = db.exec(
            select(StructureIndexChange)
            .where(StructureIndexChange.revision >= next_revision)
            .where(StructureIndexChange.revision <= target_revision)
            .order_by(StructureIndexChange.revision)
            .limit(_INDEX_EVENT_BATCH_SIZE)
        ).all()
        if not events:
            raise _revision_gap_error(next_revision, target_revision, None)
        for event in events:
            if event.revision != next_revision:
                raise _revision_gap_error(
                    next_revision,
                    target_revision,
                    event.revision,
                )
            latest_by_cas[event.cas_number] = event
            next_revision += 1
    return latest_by_cas


def _revision_gap_error(
    expected_revision: int,
    target_revision: int,
    actual_revision: int | None,
) -> StructureIndexUnavailableError:
    return StructureIndexUnavailableError(
        "Structure index revision gap: "
        f"expected {expected_revision} through {target_revision}, "
        f"received {actual_revision}"
    )


def _incremental_event_threshold(base_count: int) -> int:
    return max(
        settings.chem_structure_index_compaction_min_delta,
        int(base_count * settings.chem_structure_index_compaction_ratio),
    )


def _change_is_indexable(event: StructureIndexChange) -> bool:
    return (
        event.operation == StructureIndexChangeOperation.ADD_OR_UPDATE
        and event.status == CompoundStructureStatus.RESOLVED
        and bool(event.smiles_canonical)
    )


def _record_from_change(event: StructureIndexChange) -> StructureIndexRecord:
    if not event.smiles_canonical:
        raise StructureIndexUnavailableError(
            f"Resolved structure event {event.revision} has no canonical SMILES"
        )
    return _build_record(
        cas_number=event.cas_number,
        smiles_canonical=event.smiles_canonical,
        smiles_isomeric=event.smiles_isomeric,
        inchikey=event.inchikey,
        source=event.source,
    )


def _build_record(
    *,
    cas_number: str,
    smiles_canonical: str,
    smiles_isomeric: str | None,
    inchikey: str | None,
    source: CompoundStructureSource | None,
) -> StructureIndexRecord:
    mol = mol_from_smiles_quiet_h_removal(smiles_canonical)
    if mol is None:
        raise StructureIndexUnavailableError(f"Unable to parse indexed structure for {cas_number}")
    return _build_record_from_mol(
        cas_number=cas_number,
        smiles_canonical=smiles_canonical,
        smiles_isomeric=smiles_isomeric,
        inchikey=inchikey,
        source=source,
        mol=mol,
        exact_smiles_isomeric=_canonical_smiles_from_smiles(
            smiles_isomeric or smiles_canonical,
            use_chirality=True,
        ),
    )


def _build_record_from_mol(
    *,
    cas_number: str,
    smiles_canonical: str,
    smiles_isomeric: str | None,
    inchikey: str | None,
    source: CompoundStructureSource | None,
    mol,
    exact_smiles_isomeric: str | None,
    expected_exact_smiles_canonical: str | None = None,
    fingerprint=None,
) -> StructureIndexRecord:
    if mol is None:
        raise ValueError(f"Structure index snapshot molecule is missing for {cas_number}")
    exact_canonical = Chem.MolToSmiles(mol, canonical=True, isomericSmiles=False) or None
    if not exact_canonical:
        raise StructureIndexUnavailableError(
            f"Unable to canonicalize indexed structure for {cas_number}"
        )
    if (
        expected_exact_smiles_canonical is not None
        and exact_canonical != expected_exact_smiles_canonical
    ):
        raise ValueError(
            f"Structure index snapshot record/library mismatch for {cas_number}"
        )
    return StructureIndexRecord(
        cas_number=cas_number,
        smiles_canonical=smiles_canonical,
        smiles_isomeric=smiles_isomeric,
        exact_smiles_canonical=exact_canonical,
        exact_smiles_isomeric=exact_smiles_isomeric,
        inchikey=inchikey,
        source=source,
        mol=mol,
        fingerprint=fingerprint if fingerprint is not None else Chem.PatternFingerprint(mol),
        atom_count=mol.GetNumAtoms(),
    )


def _build_library(
    records: list[StructureIndexRecord],
) -> tuple[rdSubstructLibrary.SubstructLibrary, list[StructureIndexRecord]]:
    mol_holder = rdSubstructLibrary.CachedMolHolder()
    pattern_holder = rdSubstructLibrary.PatternHolder()
    indexed_records: list[StructureIndexRecord] = []
    for record in records:
        mol_index = mol_holder.AddMol(record.mol)
        fingerprint_index = pattern_holder.AddFingerprint(pattern_holder.MakeFingerprint(record.mol))
        if mol_index != fingerprint_index:
            raise RuntimeError("RDKit SubstructLibrary holder indexes diverged")
        indexed_records.append(record)
    return rdSubstructLibrary.SubstructLibrary(mol_holder, pattern_holder), indexed_records


def _empty_library() -> rdSubstructLibrary.SubstructLibrary:
    return _build_library([])[0]


def _current_records(state: _IndexState) -> list[StructureIndexRecord]:
    records = [
        record
        for record in state.base_records
        if record.cas_number not in state.suppressed_cas
    ]
    records.extend(state.delta_records_by_cas.values())
    return records


def _snapshot_payload(state: _IndexState) -> dict[str, object]:
    return {
        "index_schema_version": INDEX_SNAPSHOT_SCHEMA_VERSION,
        "rdkit_version": rdBase.rdkitVersion,
        "generation_id": state.generation_id,
        "base_revision": state.base_revision,
        "molecule_count": len(state.base_records),
        "created_at": datetime.now(UTC).isoformat(),
        "records": [_snapshot_record(record) for record in state.base_records],
        "serialized_library": base64.b64encode(state.base_library.Serialize()).decode("ascii"),
    }


def _snapshot_record(record: StructureIndexRecord) -> dict[str, object]:
    return {
        "cas_number": record.cas_number,
        "smiles_canonical": record.smiles_canonical,
        "smiles_isomeric": record.smiles_isomeric,
        "exact_smiles_canonical": record.exact_smiles_canonical,
        "exact_smiles_isomeric": record.exact_smiles_isomeric,
        "inchikey": record.inchikey,
        "source": record.source.value if record.source is not None else None,
    }


def _record_from_snapshot(value: object, *, mol, fingerprint) -> StructureIndexRecord:
    if not isinstance(value, dict):
        raise ValueError("Structure index snapshot record must be an object")  # noqa: TRY004
    cas_number = value.get("cas_number")
    smiles_canonical = value.get("smiles_canonical")
    exact_smiles_canonical = value.get("exact_smiles_canonical")
    if (
        not isinstance(cas_number, str)
        or not isinstance(smiles_canonical, str)
        or not isinstance(exact_smiles_canonical, str)
    ):
        raise ValueError("Structure index snapshot record fields are invalid")  # noqa: TRY004
    raw_source = value.get("source")
    source = CompoundStructureSource(raw_source) if isinstance(raw_source, str) else None
    exact_smiles_isomeric = value.get("exact_smiles_isomeric")
    if exact_smiles_isomeric is not None and not isinstance(exact_smiles_isomeric, str):
        raise ValueError("Structure index snapshot isomeric metadata is invalid")
    return _build_record_from_mol(
        cas_number=cas_number,
        smiles_canonical=smiles_canonical,
        smiles_isomeric=(
            value["smiles_isomeric"] if isinstance(value.get("smiles_isomeric"), str) else None
        ),
        inchikey=value["inchikey"] if isinstance(value.get("inchikey"), str) else None,
        source=source,
        mol=mol,
        exact_smiles_isomeric=exact_smiles_isomeric,
        expected_exact_smiles_canonical=exact_smiles_canonical,
        fingerprint=fingerprint,
    )


def _snapshot_checksum(payload: Mapping[str, object]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _fsync_parent_directory(path: Path) -> None:
    """Persist the atomic directory entry before covered revisions are pruned."""
    if os.name == "nt" or not hasattr(os, "O_DIRECTORY"):
        return
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _parse_query_molecule(*, query: str, query_format: str):
    if query_format == StructureQueryFormat.SMARTS:
        mol = Chem.MolFromSmarts(_normalize_wildcard_smarts(query))
    elif query_format == StructureQueryFormat.SMILES:
        mol = mol_from_smiles_quiet_h_removal(query)
    elif query_format == StructureQueryFormat.MOLBLOCK:
        mol = Chem.MolFromMolBlock(query, sanitize=True, removeHs=False)
    else:
        raise ValueError("Unsupported structure query format")
    if mol is None:
        raise ValueError("Invalid structure query")
    return mol


def _normalize_wildcard_smarts(query: str) -> str:
    # Ketcher 将 R/dummy atom 导出为 [#0]；RDKit 解析前需改成任意原子通配符。
    return _DUMMY_ATOM_SMARTS_PATTERN.sub(lambda match: f"[*{match.group('atom_map') or ''}]", query)


def _normalize_exact_r_group_smarts(query: str) -> str:
    wildcard_query = _normalize_wildcard_smarts(query)
    query_mol = Chem.MolFromSmarts(wildcard_query)
    if query_mol is None:
        return wildcard_query
    normalized_smiles = Chem.MolToSmiles(query_mol, canonical=True)
    normalized_mol = mol_from_smiles_quiet_h_removal(normalized_smiles)
    if normalized_mol is None:
        return wildcard_query
    return _normalize_wildcard_smarts(Chem.MolToSmarts(normalized_mol))


def _query_has_stereochemistry(mol) -> bool:
    Chem.AssignStereochemistry(mol, cleanIt=False, force=True)
    return any(_atom_has_chirality(atom) for atom in mol.GetAtoms()) or any(
        _bond_has_stereochemistry(bond) for bond in mol.GetBonds()
    )


def _atom_has_chirality(atom) -> bool:
    return atom.GetChiralTag() != Chem.ChiralType.CHI_UNSPECIFIED


def _bond_has_stereochemistry(bond) -> bool:
    return (
        bond.GetStereo() != Chem.BondStereo.STEREONONE
        or bond.GetBondDir() not in (Chem.BondDir.NONE, Chem.BondDir.UNKNOWN)
    )


def _parse_exact_query_molecule(*, query: str, query_format: str):
    if query_format == StructureQueryFormat.SMARTS:
        raise ValueError("Exact structure search requires SMILES or MolBlock")
    return _parse_query_molecule(query=query, query_format=query_format)


def _parse_simple_r_exact_query(*, query: str):
    query_mol = _parse_query_molecule(
        query=_normalize_exact_r_group_smarts(query),
        query_format=StructureQueryFormat.SMARTS,
    )
    r_atom_indices = _simple_r_query_atom_indices(query_mol)
    if not r_atom_indices:
        raise ValueError("Exact R-group search requires at least one wildcard atom")
    return query_mol, r_atom_indices


def _simple_r_query_atom_indices(mol) -> set[int]:
    return {atom.GetIdx() for atom in mol.GetAtoms() if atom.GetAtomicNum() == 0}


def _canonical_query_smiles(mol, *, use_chirality: bool) -> str:
    smiles = Chem.MolToSmiles(mol, canonical=True, isomericSmiles=use_chirality)
    if not smiles:
        raise ValueError("Invalid structure query")
    return smiles


def _canonical_smiles_from_smiles(smiles: str | None, *, use_chirality: bool) -> str | None:
    if not smiles:
        return None
    mol = mol_from_smiles_quiet_h_removal(smiles)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=use_chirality) or None


def _collect_library_hits(
    *,
    library: rdSubstructLibrary.SubstructLibrary,
    records: tuple[StructureIndexRecord, ...],
    query_mol,
    query_fp,
    use_chirality: bool,
    allowed_cas_numbers: set[str] | None,
    suppressed_cas: frozenset[str],
) -> list[StructureSearchHit]:
    if not records:
        return []
    params = Chem.SubstructMatchParameters()
    params.useChirality = use_chirality
    match_indices = library.GetMatches(query_mol, params, -1, -1)
    hits: list[StructureSearchHit] = []
    for index in match_indices:
        record = records[index]
        if record.cas_number in suppressed_cas:
            continue
        if allowed_cas_numbers is not None and record.cas_number not in allowed_cas_numbers:
            continue
        score = _calculate_substructure_score_for_record(query_mol, query_fp, record)
        hits.append(_record_to_hit(record, **score))
    return hits


def _sort_and_limit_hits(
    hits: list[StructureSearchHit],
    *,
    limit: int,
) -> list[StructureSearchHit]:
    deduplicated = {hit.cas_number: hit for hit in hits}
    ordered_hits = list(deduplicated.values())
    ordered_hits.sort(key=lambda hit: (
        -hit.matched_atom_ratio,
        hit.atom_count_delta,
        -hit.similarity,
        hit.cas_number,
    ))
    return ordered_hits[:limit]


def _select_exact_hits(
    *,
    records: list[StructureIndexRecord],
    query_smiles: str,
    limit: int,
    use_chirality: bool,
    allowed_cas_numbers: set[str] | None,
    query_atom_count: int,
) -> list[StructureSearchHit]:
    hits: list[StructureSearchHit] = []
    for record in records:
        if allowed_cas_numbers is not None and record.cas_number not in allowed_cas_numbers:
            continue
        target_smiles = _exact_record_smiles(record, use_chirality=use_chirality)
        if target_smiles != query_smiles:
            continue
        hits.append(_record_to_hit(
            record,
            similarity=1.0,
            matched_atom_ratio=1.0,
            atom_count_delta=abs(record.atom_count - query_atom_count),
        ))
    hits.sort(key=lambda hit: hit.cas_number)
    return hits[:limit]


def _select_exact_r_group_hits(
    *,
    records: list[StructureIndexRecord],
    query_mol,
    query_fp,
    r_atom_indices: set[int],
    limit: int,
    use_chirality: bool,
    allowed_cas_numbers: set[str] | None,
) -> list[StructureSearchHit]:
    hits: list[StructureSearchHit] = []
    for record in records:
        if allowed_cas_numbers is not None and record.cas_number not in allowed_cas_numbers:
            continue
        matches = _get_substructure_matches(record.mol, query_mol, use_chirality=use_chirality)
        if not any(_is_exact_r_group_match(record.mol, query_mol, match, r_atom_indices) for match in matches):
            continue
        hits.append(_record_to_hit(
            record,
            **_calculate_substructure_score_for_record(query_mol, query_fp, record),
        ))
    hits.sort(key=lambda hit: (
        -hit.matched_atom_ratio,
        hit.atom_count_delta,
        -hit.similarity,
        hit.cas_number,
    ))
    return hits[:limit]


def _get_substructure_matches(target_mol, query_mol, *, use_chirality: bool):
    params = Chem.SubstructMatchParameters()
    params.useChirality = use_chirality
    return target_mol.GetSubstructMatches(query_mol, params)


def _is_exact_r_group_match(
    target_mol,
    query_mol,
    match: tuple[int, ...],
    r_atom_indices: set[int],
) -> bool:
    matched_target_indices = set(match)
    r_target_indices = {match[query_idx] for query_idx in r_atom_indices}
    if _has_extra_neighbors_on_fixed_atoms(target_mol, query_mol, match, r_atom_indices):
        return False
    allowed_extra_atoms = _collect_r_group_extra_atoms(target_mol, matched_target_indices, r_target_indices)
    return all(
        atom.GetIdx() in matched_target_indices or atom.GetIdx() in allowed_extra_atoms
        for atom in target_mol.GetAtoms()
    )


def _has_extra_neighbors_on_fixed_atoms(
    target_mol,
    query_mol,
    match: tuple[int, ...],
    r_atom_indices: set[int],
) -> bool:
    query_by_target = {target_idx: query_idx for query_idx, target_idx in enumerate(match)}
    for target_idx, query_idx in query_by_target.items():
        if query_idx in r_atom_indices:
            continue
        query_atom = query_mol.GetAtomWithIdx(query_idx)
        expected_neighbors = {match[neighbor.GetIdx()] for neighbor in query_atom.GetNeighbors()}
        atom = target_mol.GetAtomWithIdx(target_idx)
        if any(neighbor.GetIdx() not in expected_neighbors for neighbor in atom.GetNeighbors()):
            return True
    return False


def _collect_r_group_extra_atoms(
    target_mol,
    matched_target_indices: set[int],
    r_target_indices: set[int],
) -> set[int]:
    allowed_extra_atoms: set[int] = set()
    stack = [
        neighbor.GetIdx()
        for r_target_idx in r_target_indices
        for neighbor in target_mol.GetAtomWithIdx(r_target_idx).GetNeighbors()
        if neighbor.GetIdx() not in matched_target_indices
    ]
    while stack:
        atom_idx = stack.pop()
        if atom_idx in allowed_extra_atoms:
            continue
        allowed_extra_atoms.add(atom_idx)
        stack.extend(
            neighbor.GetIdx()
            for neighbor in target_mol.GetAtomWithIdx(atom_idx).GetNeighbors()
            if neighbor.GetIdx() not in matched_target_indices
        )
    return allowed_extra_atoms


def _exact_record_smiles(record: StructureIndexRecord, *, use_chirality: bool) -> str:
    if use_chirality and record.exact_smiles_isomeric:
        return record.exact_smiles_isomeric
    return record.exact_smiles_canonical


def _calculate_substructure_score_for_record(
    query_mol,
    query_fp,
    record: StructureIndexRecord,
) -> dict[str, float | int]:
    match = record.mol.GetSubstructMatch(query_mol)
    target_atom_count = max(1, record.atom_count)
    query_atom_count = query_mol.GetNumAtoms()
    return {
        "similarity": round(float(DataStructs.TanimotoSimilarity(query_fp, record.fingerprint)), 4),
        "matched_atom_ratio": round(len(match) / target_atom_count, 4),
        "atom_count_delta": abs(target_atom_count - query_atom_count),
    }


def _record_to_hit(
    record: StructureIndexRecord,
    *,
    similarity: float,
    matched_atom_ratio: float,
    atom_count_delta: int,
) -> StructureSearchHit:
    return StructureSearchHit(
        cas_number=record.cas_number,
        smiles_canonical=record.smiles_canonical,
        inchikey=record.inchikey,
        source=record.source,
        similarity=similarity,
        matched_atom_ratio=matched_atom_ratio,
        atom_count_delta=atom_count_delta,
    )


structure_index = SubstructureIndex(snapshot_path=settings.chem_structure_index_snapshot_path)
