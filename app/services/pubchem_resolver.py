"""PubChem PUG-REST resolver for CAS structure cache backfill."""
from __future__ import annotations

import asyncio
import logging
from collections import Counter
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from enum import Enum
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
    "InChIKey,MolecularFormula,MolecularWeight,IUPACName"
)
CANDIDATE_DETAIL_LIMIT = 20


class ResolutionOutcomeKind(str, Enum):
    """Stable resolver result classification used by the durable scheduler."""

    RESOLVED = "resolved"
    TERMINAL_AMBIGUOUS = "terminal_ambiguous"
    TERMINAL_NOT_FOUND = "terminal_not_found"
    TERMINAL_INVALID = "terminal_invalid"
    TERMINAL_UNSUPPORTED = "terminal_unsupported"
    RETRYABLE_ERROR = "retryable_error"


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
    english_name: str | None = None
    confidence: int = 0
    candidate_count: int = 0
    candidates: list[dict[str, Any]] | None = None
    error_message: str | None = None

    def to_cache_write(self) -> StructureCacheWrite:
        return StructureCacheWrite(**asdict(self))


@dataclass(frozen=True)
class ResolutionOutcome:
    """Typed single-attempt result without string-based retry decisions."""

    kind: ResolutionOutcomeKind
    result: ResolvedStructure
    error_code: str | None = None
    error_message: str | None = None
    retry_after_seconds: int | None = None

    @property
    def retryable(self) -> bool:
        return self.kind == ResolutionOutcomeKind.RETRYABLE_ERROR


class PubChemRetryableError(RuntimeError):
    """Retryable PubChem HTTP response with optional Retry-After metadata."""

    def __init__(self, status_code: int, retry_after_seconds: int | None) -> None:
        super().__init__(f"PubChem returned retryable HTTP status {status_code}")
        self.status_code = status_code
        self.retry_after_seconds = retry_after_seconds


class StructureNormalizationRetryableError(RuntimeError):
    """Unexpected structure-normalization failure suitable for a later retry."""


class PubChemRequestRateLimiter:
    """Short-lived async request gate reusable across resolver/client batches."""

    def __init__(self, *, min_interval_seconds: float) -> None:
        self.min_interval_seconds = min_interval_seconds
        self._last_request_ts = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            wait_seconds = self.min_interval_seconds - (now - self._last_request_ts)
            if wait_seconds > 0:
                await asyncio.sleep(wait_seconds)
            self._last_request_ts = loop.time()


class PubChemResolver:
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        min_interval_seconds: float,
        max_retries: int,
        rate_limiter: PubChemRequestRateLimiter | None = None,
    ) -> None:
        self.client = client
        self.min_interval_seconds = min_interval_seconds
        self.max_retries = max_retries
        self._rate_limiter = rate_limiter or PubChemRequestRateLimiter(
            min_interval_seconds=min_interval_seconds
        )

    async def resolve_cas(self, cas_number: str) -> ResolvedStructure:
        """Resolve using the configured transport retry count."""
        return (await self.resolve_cas_outcome(cas_number)).result

    async def resolve_cas_outcome(self, cas_number: str) -> ResolutionOutcome:
        """Resolve and classify one full attempt for the durable scheduler."""
        cas = normalize_cas(cas_number)
        if not is_valid_cas(cas):
            return classify_resolution_result(ResolvedStructure(
                cas_number=cas or cas_number,
                status=CompoundStructureStatus.INVALID_CAS,
                error_message="Invalid CAS checksum or format",
            ))
        try:
            return classify_resolution_result(await self._resolve_valid_cas(cas))
        except Exception as exc:  # noqa: BLE001
            logger.warning("PubChem CAS resolve failed for %s: %s", cas, exc)
            result = ResolvedStructure(
                cas_number=cas,
                status=CompoundStructureStatus.ERROR,
                error_message=_format_error(exc),
            )
            error_code, retry_after_seconds = _classify_retryable_exception(exc)
            return ResolutionOutcome(
                kind=ResolutionOutcomeKind.RETRYABLE_ERROR,
                result=result,
                error_code=error_code,
                error_message=result.error_message,
                retry_after_seconds=retry_after_seconds,
            )

    async def resolve_pubchem_cid(self, cas_number: str, cid: int) -> ResolvedStructure:
        cas = normalize_cas(cas_number)
        if not is_valid_cas(cas):
            return ResolvedStructure(
                cas_number=cas or cas_number,
                status=CompoundStructureStatus.INVALID_CAS,
                error_message="Invalid CAS checksum or format",
            )
        try:
            return await self._resolve_single_cid(
                cas,
                cid,
                [{"cid": cid, "selected_manually": True}],
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("PubChem CID resolve failed for %s/%s: %s", cas, cid, exc)
            return ResolvedStructure(cas, CompoundStructureStatus.ERROR, error_message=_format_error(exc))

    async def _resolve_valid_cas(self, cas: str) -> ResolvedStructure:
        cids = await self._load_compound_name_cids(cas)
        if cids:
            return await self._resolve_compound_name_candidates(cas, cids)

        substance_candidates = await self._load_substance_cid_candidates(cas)
        if not substance_candidates:
            return ResolvedStructure(cas_number=cas, status=CompoundStructureStatus.NOT_FOUND)

        substance_cids = [
            candidate["cid"]
            for candidate in substance_candidates
            if isinstance(candidate.get("cid"), int)
        ]
        exact_cids, confirmed_candidates = await self._confirm_cas_synonyms(cas, substance_cids)
        candidates = _merge_candidate_details(substance_candidates, confirmed_candidates)
        candidates = await self._attach_candidate_structure_details(candidates)
        if not exact_cids:
            return _ambiguous_result(
                cas,
                candidate_count=len(substance_cids),
                candidates=candidates,
                confidence=30,
                message="Substance CID candidates found, but none had exact CAS synonym confirmation",
            )
        if len(exact_cids) > 1:
            return _ambiguous_result(
                cas,
                candidate_count=len(exact_cids),
                candidates=candidates,
                confidence=50,
                message="Multiple Substance CIDs have exact CAS synonym confirmation",
            )

        return await self._resolve_single_cid(cas, exact_cids[0], candidates)

    async def _resolve_compound_name_candidates(
        self,
        cas: str,
        cids: list[int],
    ) -> ResolvedStructure:
        exact_cids, candidates = await self._confirm_cas_synonyms(cas, cids)
        candidates = await self._attach_candidate_structure_details(candidates)
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
        await self._rate_limiter.wait()

    async def _get(self, path: str) -> httpx.Response:
        retry_delay = 0.5
        for attempt in range(self.max_retries + 1):
            await self._rate_limit()
            try:
                response = await self.client.get(f"{PUBCHEM_BASE_URL}{path}")
                if response.status_code not in PUBCHEM_RETRY_STATUSES:
                    return response
                if attempt >= self.max_retries:
                    raise PubChemRetryableError(
                        response.status_code,
                        _parse_retry_after_seconds(response.headers.get("Retry-After")),
                    )
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

    async def _load_compound_name_cids(self, cas: str) -> list[int]:
        payload = await self._get_json(f"/compound/name/{quote(cas, safe='')}/cids/JSON")
        if payload.get("_not_found"):
            return []
        cids = payload.get("IdentifierList", {}).get("CID", [])
        return [int(cid) for cid in cids if isinstance(cid, int | str) and str(cid).isdigit()]

    async def _load_substance_cid_candidates(self, cas: str) -> list[dict[str, Any]]:
        payload = await self._get_json(f"/substance/name/{quote(cas, safe='')}/cids/JSON")
        if payload.get("_not_found"):
            return []

        cid_counts: Counter[int] = Counter()
        for row in payload.get("InformationList", {}).get("Information", []):
            if not isinstance(row, dict):
                continue
            for raw_cid in row.get("CID", []):
                if isinstance(raw_cid, int | str) and str(raw_cid).isdigit():
                    cid_counts[int(raw_cid)] += 1

        return [
            {
                "cid": cid,
                "matched_by_substance_name": True,
                "sid_count": count,
            }
            for cid, count in sorted(cid_counts.items(), key=lambda item: (-item[1], item[0]))
        ]

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
        candidates = _merge_candidate_details(candidates, [_candidate_property_details(cid, row)])
        try:
            normalized = normalize_structure_from_pubchem(
                canonical_smiles=_read_canonical_smiles(row),
                isomeric_smiles=_read_isomeric_smiles(row),
                inchikey=_optional_text(row, "InChIKey"),
                sdf=await self._get_text(f"/compound/cid/{cid}/SDF?record_type=2d"),
            )
        except Exception as exc:
            raise StructureNormalizationRetryableError(
                "PubChem structure normalization failed"
            ) from exc
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

    async def _load_candidate_property_rows(self, cids: list[int]) -> dict[int, Mapping[str, Any]]:
        if not cids:
            return {}
        selected_cids = cids[:CANDIDATE_DETAIL_LIMIT]
        cid_list = ",".join(str(cid) for cid in selected_cids)
        payload = await self._get_json(f"/compound/cid/{cid_list}/property/{PUBCHEM_PROPERTIES}/JSON")
        if payload.get("_not_found"):
            return {}
        rows = payload.get("PropertyTable", {}).get("Properties", [])
        result: dict[int, Mapping[str, Any]] = {}
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            raw_cid = row.get("CID")
            if isinstance(raw_cid, int | str) and str(raw_cid).isdigit():
                result[int(raw_cid)] = row
        return result

    async def _attach_candidate_structure_details(
        self,
        candidates: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        cids = [
            cid
            for candidate in candidates
            if isinstance((cid := candidate.get("cid")), int)
        ]
        try:
            property_rows = await self._load_candidate_property_rows(cids)
        except Exception as exc:  # noqa: BLE001
            logger.warning("PubChem candidate detail load failed: %s", exc)
            return candidates
        return [
            _merge_candidate_property(
                candidate,
                property_rows.get(cid) if isinstance((cid := candidate.get("cid")), int) else None,
            )
            for candidate in candidates
        ]


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


def _merge_candidate_details(
    base_candidates: list[dict[str, Any]],
    confirmed_candidates: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_cid = {
        candidate["cid"]: dict(candidate)
        for candidate in base_candidates
        if isinstance(candidate.get("cid"), int)
    }
    for candidate in confirmed_candidates:
        cid = candidate.get("cid")
        if not isinstance(cid, int):
            continue
        merged = by_cid.setdefault(cid, {"cid": cid})
        merged.update(candidate)
    return list(by_cid.values())


def _candidate_property_details(cid: int, row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "cid": cid,
        "smiles_canonical": _read_canonical_smiles(row),
        "smiles_isomeric": _read_isomeric_smiles(row),
        "inchikey": _optional_text(row, "InChIKey"),
        "molecular_formula": _optional_text(row, "MolecularFormula"),
        "molecular_weight": _optional_float(row, "MolecularWeight"),
        "iupac_name": _optional_text(row, "IUPACName"),
    }


def _merge_candidate_property(
    candidate: dict[str, Any],
    row: Mapping[str, Any] | None,
) -> dict[str, Any]:
    if row is None:
        return dict(candidate)
    return {**candidate, **_candidate_property_details(int(candidate["cid"]), row)}


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


def classify_resolution_result(result: ResolvedStructure) -> ResolutionOutcome:
    """Map cache statuses to the stable scheduler disposition enum."""
    kind_by_status = {
        CompoundStructureStatus.RESOLVED: ResolutionOutcomeKind.RESOLVED,
        CompoundStructureStatus.AMBIGUOUS: ResolutionOutcomeKind.TERMINAL_AMBIGUOUS,
        CompoundStructureStatus.NOT_FOUND: ResolutionOutcomeKind.TERMINAL_NOT_FOUND,
        CompoundStructureStatus.INVALID_CAS: ResolutionOutcomeKind.TERMINAL_INVALID,
        CompoundStructureStatus.UNSUPPORTED: ResolutionOutcomeKind.TERMINAL_UNSUPPORTED,
        CompoundStructureStatus.ERROR: ResolutionOutcomeKind.RETRYABLE_ERROR,
    }
    kind = kind_by_status.get(result.status, ResolutionOutcomeKind.RETRYABLE_ERROR)
    return ResolutionOutcome(
        kind=kind,
        result=result,
        error_code="resolver_error" if kind == ResolutionOutcomeKind.RETRYABLE_ERROR else None,
        error_message=result.error_message,
    )


def _classify_retryable_exception(exc: Exception) -> tuple[str, int | None]:
    if isinstance(exc, PubChemRetryableError):
        return f"http_{exc.status_code}", exc.retry_after_seconds
    if isinstance(exc, httpx.TimeoutException):
        return "timeout", None
    if isinstance(exc, httpx.TransportError):
        return "transport_error", None
    if isinstance(exc, StructureNormalizationRetryableError):
        return "structure_normalization_error", None
    return "unexpected_error", None


def _parse_retry_after_seconds(value: str | None) -> int | None:
    if value is None:
        return None
    text = value.strip()
    if text.isdigit():
        return int(text)
    try:
        retry_at = parsedate_to_datetime(text)
    except (TypeError, ValueError, OverflowError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=UTC)
    seconds = int((retry_at - datetime.now(UTC)).total_seconds())
    return max(0, seconds)


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
        english_name=_optional_text(row, "IUPACName"),
        confidence=100,
        candidate_count=1,
        candidates=candidates,
    )
