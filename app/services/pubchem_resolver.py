"""PubChem PUG-REST resolver for CAS structure cache backfill."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any
from urllib.parse import quote

import httpx

from app.models.compound_structure import CompoundStructureSource, CompoundStructureStatus
from app.services.cas_utils import is_valid_cas, normalize_cas
from app.services.structure_cache_repo import StructureCacheWrite
from app.services.structure_normalizer import normalize_structure_from_pubchem

logger = logging.getLogger(__name__)
PUBCHEM_BASE_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PUBCHEM_RETRY_STATUSES = {429, 500, 502, 503, 504}
PUBCHEM_PROPERTIES = (
    "SMILES,ConnectivitySMILES,CanonicalSMILES,IsomericSMILES,"
    "InChIKey,MolecularFormula,MolecularWeight"
)


@dataclass(frozen=True)
class ResolvedStructure:
    cas_number: str
    status: CompoundStructureStatus
    source: CompoundStructureSource | None = None
    source_id: str | None = None
    source_url: str | None = None
    smiles_canonical: str | None = None
    smiles_isomeric: str | None = None
    molblock: str | None = None
    inchikey: str | None = None
    molecular_formula: str | None = None
    molecular_weight: float | None = None
    confidence: int = 0
    candidate_count: int = 0
    candidates: list[dict[str, Any]] | None = None
    error_message: str | None = None

    def to_cache_write(self) -> StructureCacheWrite:
        return StructureCacheWrite(**asdict(self))


class PubChemResolver:
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        min_interval_seconds: float,
        max_retries: int,
    ) -> None:
        self.client = client
        self.min_interval_seconds = min_interval_seconds
        self.max_retries = max_retries
        self._last_request_ts = 0.0
        self._rate_lock = asyncio.Lock()

    async def resolve_cas(self, cas_number: str) -> ResolvedStructure:
        cas = normalize_cas(cas_number)
        if not is_valid_cas(cas):
            return ResolvedStructure(
                cas_number=cas or cas_number,
                status=CompoundStructureStatus.INVALID_CAS,
                error_message="Invalid CAS checksum or format",
            )
        try:
            return await self._resolve_valid_cas(cas)
        except Exception as exc:  # noqa: BLE001
            logger.warning("PubChem CAS resolve failed for %s: %s", cas, exc)
            return ResolvedStructure(
                cas_number=cas,
                status=CompoundStructureStatus.ERROR,
                error_message=_format_error(exc),
            )

    async def _resolve_valid_cas(self, cas: str) -> ResolvedStructure:
        cids = await self._load_candidate_cids(cas)
        if not cids:
            return ResolvedStructure(cas_number=cas, status=CompoundStructureStatus.NOT_FOUND)

        exact_cids, candidates = await self._confirm_cas_synonyms(cas, cids[:20])
        if not exact_cids:
            return _ambiguous_result(
                cas,
                candidate_count=len(cids),
                candidates=candidates,
                confidence=30,
                message="CID candidates found, but none had exact CAS synonym confirmation",
            )
        if len(exact_cids) > 1:
            return _ambiguous_result(
                cas,
                candidate_count=len(exact_cids),
                candidates=candidates,
                confidence=50,
                message="Multiple PubChem CIDs have exact CAS synonym confirmation",
            )
        return await self._resolve_single_cid(cas, exact_cids[0], candidates)

    async def _rate_limit(self) -> None:
        async with self._rate_lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            wait_seconds = self.min_interval_seconds - (now - self._last_request_ts)
            if wait_seconds > 0:
                await asyncio.sleep(wait_seconds)
            self._last_request_ts = loop.time()

    async def _get(self, path: str) -> httpx.Response:
        retry_delay = 0.5
        for attempt in range(self.max_retries + 1):
            await self._rate_limit()
            try:
                response = await self.client.get(f"{PUBCHEM_BASE_URL}{path}")
                if response.status_code not in PUBCHEM_RETRY_STATUSES:
                    return response
                if attempt >= self.max_retries:
                    return response
            except (httpx.TimeoutException, httpx.TransportError):
                if attempt >= self.max_retries:
                    raise
            await asyncio.sleep(retry_delay)
            retry_delay *= 2
        raise RuntimeError("PubChem retry loop exhausted")

    async def _get_json(self, path: str) -> dict[str, Any]:
        response = await self._get(path)
        if response.status_code == 404:
            return {"_not_found": True}
        response.raise_for_status()
        return response.json()

    async def _get_text(self, path: str) -> str | None:
        response = await self._get(path)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.text

    async def _load_candidate_cids(self, cas: str) -> list[int]:
        payload = await self._get_json(f"/compound/name/{quote(cas, safe='')}/cids/JSON")
        if payload.get("_not_found"):
            return []
        cids = payload.get("IdentifierList", {}).get("CID", [])
        return [int(cid) for cid in cids if isinstance(cid, int | str) and str(cid).isdigit()]

    async def _confirm_cas_synonyms(
        self,
        cas: str,
        cids: list[int],
    ) -> tuple[list[int], list[dict[str, Any]]]:
        exact_cids: list[int] = []
        candidates: list[dict[str, Any]] = []
        for cid in cids:
            payload = await self._get_json(f"/compound/cid/{cid}/synonyms/JSON")
            synonyms = _extract_synonyms(payload)
            has_exact_cas = any(str(synonym).strip() == cas for synonym in synonyms)
            candidates.append({"cid": cid, "has_exact_cas_synonym": has_exact_cas})
            if has_exact_cas:
                exact_cids.append(cid)
        return exact_cids, candidates

    async def _resolve_single_cid(
        self,
        cas: str,
        cid: int,
        candidates: list[dict[str, Any]],
    ) -> ResolvedStructure:
        row = await self._load_property_row(cid)
        normalized = normalize_structure_from_pubchem(
            canonical_smiles=_read_canonical_smiles(row),
            isomeric_smiles=_read_isomeric_smiles(row),
            inchikey=_optional_text(row, "InChIKey"),
            sdf=await self._get_text(f"/compound/cid/{cid}/SDF?record_type=2d"),
        )
        if normalized.status != CompoundStructureStatus.RESOLVED:
            return ResolvedStructure(
                cas_number=cas,
                status=normalized.status,
                source=CompoundStructureSource.PUBCHEM,
                source_id=str(cid),
                candidate_count=1,
                candidates=candidates,
                error_message=normalized.error_message,
            )
        return _resolved_result(cas, cid, row, candidates, normalized)

    async def _load_property_row(self, cid: int) -> Mapping[str, Any]:
        payload = await self._get_json(f"/compound/cid/{cid}/property/{PUBCHEM_PROPERTIES}/JSON")
        rows = payload.get("PropertyTable", {}).get("Properties", [])
        if not rows:
            raise RuntimeError(f"PubChem CID {cid} returned no property row")
        return rows[0]


def create_pubchem_client(*, timeout_seconds: float, user_agent: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_seconds),
        headers={"User-Agent": user_agent, "Accept": "application/json,text/plain,*/*"},
    )


def _extract_synonyms(payload: Mapping[str, Any]) -> list[str]:
    rows = payload.get("InformationList", {}).get("Information", [])
    if not rows:
        return []
    synonyms = rows[0].get("Synonym", [])
    return [str(synonym) for synonym in synonyms]


def _optional_text(row: Mapping[str, Any], key: str) -> str | None:
    value = row.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_float(row: Mapping[str, Any], key: str) -> float | None:
    value = row.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _read_canonical_smiles(row: Mapping[str, Any]) -> str | None:
    return _optional_text(row, "ConnectivitySMILES") or _optional_text(row, "CanonicalSMILES")


def _read_isomeric_smiles(row: Mapping[str, Any]) -> str | None:
    return _optional_text(row, "SMILES") or _optional_text(row, "IsomericSMILES")


def _format_error(exc: Exception) -> str:
    return f"{exc.__class__.__name__}: {message}" if (message := str(exc).strip()) else exc.__class__.__name__


def _ambiguous_result(
    cas: str,
    *,
    candidate_count: int,
    candidates: list[dict[str, Any]],
    confidence: int,
    message: str,
) -> ResolvedStructure:
    return ResolvedStructure(
        cas_number=cas,
        status=CompoundStructureStatus.AMBIGUOUS,
        candidate_count=candidate_count,
        candidates=candidates,
        confidence=confidence,
        error_message=message,
    )


def _resolved_result(
    cas: str,
    cid: int,
    row: Mapping[str, Any],
    candidates: list[dict[str, Any]],
    normalized,
) -> ResolvedStructure:
    return ResolvedStructure(
        cas_number=cas,
        status=CompoundStructureStatus.RESOLVED,
        source=CompoundStructureSource.PUBCHEM,
        source_id=str(cid),
        source_url=f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
        smiles_canonical=normalized.smiles_canonical,
        smiles_isomeric=normalized.smiles_isomeric,
        molblock=normalized.molblock,
        inchikey=normalized.inchikey or _optional_text(row, "InChIKey"),
        molecular_formula=_optional_text(row, "MolecularFormula"),
        molecular_weight=_optional_float(row, "MolecularWeight"),
        confidence=100,
        candidate_count=1,
        candidates=candidates,
    )
