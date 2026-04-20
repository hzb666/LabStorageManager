"""In-memory RDKit substructure index backed by compound_structure_cache."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from threading import RLock

from rdkit import Chem
from rdkit.Chem import rdSubstructLibrary
from sqlmodel import Session, select

from app.models.compound_structure import (
    CompoundStructureCache,
    CompoundStructureSource,
    CompoundStructureStatus,
)


@dataclass(frozen=True)
class StructureIndexRecord:
    cas_number: str
    smiles_canonical: str
    inchikey: str | None
    source: CompoundStructureSource | None


@dataclass(frozen=True)
class StructureSearchHit:
    cas_number: str
    smiles_canonical: str
    inchikey: str | None
    source: CompoundStructureSource | None


@dataclass(frozen=True)
class StructureIndexSnapshot:
    version: int
    dirty: bool
    molecule_count: int


class StructureQueryFormat(str, Enum):
    SMARTS = "smarts"
    MOLBLOCK = "molblock"
    SMILES = "smiles"


class SubstructureIndex:
    """Thread-safe process-local substructure index."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._library: rdSubstructLibrary.SubstructLibrary | None = None
        self._records: list[StructureIndexRecord] = []
        self._version = 0
        self._dirty = True

    def mark_dirty(self) -> None:
        with self._lock:
            self._dirty = True

    def status(self) -> StructureIndexSnapshot:
        with self._lock:
            return StructureIndexSnapshot(
                version=self._version,
                dirty=self._dirty,
                molecule_count=len(self._records),
            )

    def rebuild(self, db: Session) -> StructureIndexSnapshot:
        records = _load_resolved_records(db)
        library, indexed_records = _build_library(records)
        with self._lock:
            self._library = library
            self._records = indexed_records
            self._version += 1
            self._dirty = False
            return self.status()

    def search(
        self,
        *,
        query: str,
        query_format: str,
        limit: int,
        use_chirality: bool,
        allowed_cas_numbers: set[str] | None = None,
    ) -> list[StructureSearchHit]:
        query_mol = _parse_query_molecule(query=query, query_format=query_format)
        with self._lock:
            if self._library is None or not self._records:
                raise RuntimeError("Structure index is empty; rebuild after cache backfill")
            params = Chem.SubstructMatchParameters()
            params.useChirality = use_chirality
            max_results = -1 if allowed_cas_numbers is not None else limit
            match_indices = self._library.GetMatches(query_mol, params, -1, max_results)
            return _select_limited_hits(
                records=self._records,
                match_indices=match_indices,
                limit=limit,
                allowed_cas_numbers=allowed_cas_numbers,
            )


def _load_resolved_records(db: Session) -> list[StructureIndexRecord]:
    rows = db.exec(
        select(CompoundStructureCache)
        .where(CompoundStructureCache.status == CompoundStructureStatus.RESOLVED)
        .where(CompoundStructureCache.smiles_canonical.is_not(None))
        .order_by(CompoundStructureCache.cas_number)
    ).all()
    return [
        StructureIndexRecord(
            cas_number=row.cas_number,
            smiles_canonical=str(row.smiles_canonical),
            inchikey=row.inchikey,
            source=row.source,
        )
        for row in rows
        if row.smiles_canonical
    ]


def _build_library(
    records: list[StructureIndexRecord],
) -> tuple[rdSubstructLibrary.SubstructLibrary, list[StructureIndexRecord]]:
    mol_holder = rdSubstructLibrary.CachedSmilesMolHolder()
    pattern_holder = rdSubstructLibrary.PatternHolder()
    indexed_records: list[StructureIndexRecord] = []
    for record in records:
        mol = Chem.MolFromSmiles(record.smiles_canonical)
        if mol is None:
            continue
        mol_index = mol_holder.AddSmiles(record.smiles_canonical)
        fingerprint_index = pattern_holder.AddFingerprint(pattern_holder.MakeFingerprint(mol))
        if mol_index != fingerprint_index:
            raise RuntimeError("RDKit SubstructLibrary holder indexes diverged")
        indexed_records.append(record)
    return rdSubstructLibrary.SubstructLibrary(mol_holder, pattern_holder), indexed_records


def _parse_query_molecule(*, query: str, query_format: str):
    if query_format == StructureQueryFormat.SMARTS:
        mol = Chem.MolFromSmarts(query)
    elif query_format == StructureQueryFormat.SMILES:
        mol = Chem.MolFromSmiles(query)
    elif query_format == StructureQueryFormat.MOLBLOCK:
        mol = Chem.MolFromMolBlock(query, sanitize=True, removeHs=False)
    else:
        raise ValueError("Unsupported structure query format")
    if mol is None:
        raise ValueError("Invalid structure query")
    return mol


def _select_limited_hits(
    *,
    records: list[StructureIndexRecord],
    match_indices,
    limit: int,
    allowed_cas_numbers: set[str] | None,
) -> list[StructureSearchHit]:
    hits: list[StructureSearchHit] = []
    for index in match_indices:
        record = records[index]
        if allowed_cas_numbers is not None and record.cas_number not in allowed_cas_numbers:
            continue
        hits.append(_record_to_hit(record))
        if len(hits) >= limit:
            break
    return hits


def _record_to_hit(record: StructureIndexRecord) -> StructureSearchHit:
    return StructureSearchHit(
        cas_number=record.cas_number,
        smiles_canonical=record.smiles_canonical,
        inchikey=record.inchikey,
        source=record.source,
    )


structure_index = SubstructureIndex()
