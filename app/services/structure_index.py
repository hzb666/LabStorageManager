"""In-memory RDKit substructure index backed by compound_structure_cache."""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from threading import RLock, Semaphore

from rdkit import Chem
from rdkit import DataStructs
from rdkit.Chem import rdSubstructLibrary
from sqlmodel import Session, select

from app.core.config import settings
from app.models.compound_structure import (
    CompoundStructureCache,
    CompoundStructureSource,
    CompoundStructureStatus,
)


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


class StructureQueryFormat(str, Enum):
    SMARTS = "smarts"
    MOLBLOCK = "molblock"
    SMILES = "smiles"


class StructureSearchMode(str, Enum):
    SUBSTRUCTURE = "substructure"
    EXACT = "exact"


_DUMMY_ATOM_SMARTS_PATTERN = re.compile(r"\[#0(?P<atom_map>:\d+)?\]")


class SubstructureIndex:
    """Thread-safe process-local substructure index."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._library: rdSubstructLibrary.SubstructLibrary | None = None
        self._records: list[StructureIndexRecord] = []
        self._version = 0
        self._dirty = True
        self._search_semaphore = Semaphore(settings.chem_structure_search_concurrency)

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
        allowed_cas_numbers: set[str] | None = None,
    ) -> list[StructureSearchHit]:
        query_mol = _parse_query_molecule(query=query, query_format=query_format)
        use_chirality = _query_has_stereochemistry(query_mol)
        query_fp = Chem.PatternFingerprint(query_mol)
        with self._search_semaphore:
            with self._lock:
                if self._library is None or not self._records:
                    raise RuntimeError("Structure index is empty; rebuild after cache backfill")
                records = self._records
                params = Chem.SubstructMatchParameters()
                params.useChirality = use_chirality
                match_indices = self._library.GetMatches(query_mol, params, -1, -1)
            return _select_limited_hits(
                records=records,
                match_indices=match_indices,
                limit=limit,
                allowed_cas_numbers=allowed_cas_numbers,
                query_mol=query_mol,
                query_fp=query_fp,
            )

    def exact_search(
        self,
        *,
        query: str,
        query_format: str,
        limit: int,
        allowed_cas_numbers: set[str] | None = None,
    ) -> list[StructureSearchHit]:
        if query_format == StructureQueryFormat.SMARTS:
            query_mol, r_atom_indices = _parse_simple_r_exact_query(query=query)
            use_chirality = _query_has_stereochemistry(query_mol)
            query_fp = Chem.PatternFingerprint(query_mol)
            with self._search_semaphore:
                with self._lock:
                    if self._library is None or not self._records:
                        raise RuntimeError("Structure index is empty; rebuild after cache backfill")
                    records = self._records
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
                if self._library is None or not self._records:
                    raise RuntimeError("Structure index is empty; rebuild after cache backfill")
                records = self._records
            return _select_exact_hits(
                records=records,
                query_smiles=query_smiles,
                limit=limit,
                use_chirality=use_chirality,
                allowed_cas_numbers=allowed_cas_numbers,
                query_atom_count=query_mol.GetNumAtoms(),
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
        raw_canonical = str(row.smiles_canonical)
        mol = Chem.MolFromSmiles(raw_canonical)
        if mol is None:
            continue
        exact_canonical = Chem.MolToSmiles(mol, canonical=True, isomericSmiles=False) or None
        if not exact_canonical:
            continue
        records.append(
            StructureIndexRecord(
                cas_number=row.cas_number,
                smiles_canonical=raw_canonical,
                smiles_isomeric=row.smiles_isomeric,
                exact_smiles_canonical=exact_canonical,
                exact_smiles_isomeric=_canonical_smiles_from_smiles(
                    row.smiles_isomeric or raw_canonical,
                    use_chirality=True,
                ),
                inchikey=row.inchikey,
                source=row.source,
                mol=mol,
                fingerprint=Chem.PatternFingerprint(mol),
                atom_count=mol.GetNumAtoms(),
            )
        )
    return records


def _build_library(
    records: list[StructureIndexRecord],
) -> tuple[rdSubstructLibrary.SubstructLibrary, list[StructureIndexRecord]]:
    mol_holder = rdSubstructLibrary.CachedSmilesMolHolder()
    pattern_holder = rdSubstructLibrary.PatternHolder()
    indexed_records: list[StructureIndexRecord] = []
    for record in records:
        mol_index = mol_holder.AddSmiles(record.smiles_canonical)
        fingerprint_index = pattern_holder.AddFingerprint(pattern_holder.MakeFingerprint(record.mol))
        if mol_index != fingerprint_index:
            raise RuntimeError("RDKit SubstructLibrary holder indexes diverged")
        indexed_records.append(record)
    return rdSubstructLibrary.SubstructLibrary(mol_holder, pattern_holder), indexed_records


def _parse_query_molecule(*, query: str, query_format: str):
    if query_format == StructureQueryFormat.SMARTS:
        mol = Chem.MolFromSmarts(_normalize_wildcard_smarts(query))
    elif query_format == StructureQueryFormat.SMILES:
        mol = Chem.MolFromSmiles(query)
    elif query_format == StructureQueryFormat.MOLBLOCK:
        mol = Chem.MolFromMolBlock(query, sanitize=True, removeHs=False)
    else:
        raise ValueError("Unsupported structure query format")
    if mol is None:
        raise ValueError("Invalid structure query")
    return mol


def _normalize_wildcard_smarts(query: str) -> str:
    # Ketcher exports R/dummy atoms as [#0], but RDKit treats that as atomic number
    # 0 instead of a match-any-atom wildcard. For search semantics, R means any
    # substituent atom, so normalize it before parsing.
    return _DUMMY_ATOM_SMARTS_PATTERN.sub(lambda match: f"[*{match.group('atom_map') or ''}]", query)


def _normalize_exact_r_group_smarts(query: str) -> str:
    wildcard_query = _normalize_wildcard_smarts(query)
    query_mol = Chem.MolFromSmarts(wildcard_query)
    if query_mol is None:
        return wildcard_query
    normalized_smiles = Chem.MolToSmiles(query_mol, canonical=True)
    normalized_mol = Chem.MolFromSmiles(normalized_smiles)
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
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, canonical=True, isomericSmiles=use_chirality) or None


def _select_limited_hits(
    *,
    records: list[StructureIndexRecord],
    match_indices,
    limit: int,
    allowed_cas_numbers: set[str] | None,
    query_mol,
    query_fp,
) -> list[StructureSearchHit]:
    hits: list[StructureSearchHit] = []
    for index in match_indices:
        record = records[index]
        if allowed_cas_numbers is not None and record.cas_number not in allowed_cas_numbers:
            continue
        hits.append(_record_to_hit(record, **_calculate_substructure_score(query_mol, query_fp, record)))
    hits.sort(key=lambda hit: (
        -hit.matched_atom_ratio,
        hit.atom_count_delta,
        -hit.similarity,
        hit.cas_number,
    ))
    if len(hits) > limit:
        return hits[:limit]
    return hits


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
        if len(hits) >= limit:
            break
    return hits


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


def _calculate_substructure_score(query_mol, query_fp, record: StructureIndexRecord) -> dict[str, float | int]:
    return _calculate_substructure_score_for_record(query_mol, query_fp, record)


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


structure_index = SubstructureIndex()
