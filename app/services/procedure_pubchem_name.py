"""PubChem name-to-CAS resolver for procedure inventory search."""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any, Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.cas_utils import normalize_cas, validate_cas_format

logger = logging.getLogger(__name__)

PUBCHEM_BASE_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
CAS_CANDIDATE_PATTERN = re.compile(r"(?<!\d)\d{2,7}-\d{2}-\d(?!\d)")
RETRY_STATUS_CODES = {429, 500, 502, 503, 504}
PUBCHEM_CID_BATCH_SIZE = 50


class PubChemNameResolution(BaseModel):
    name: str
    cas_number: str | None = None
    cas_numbers: list[str] = Field(default_factory=list)
    cid: int | None = None
    pubchem_name: str | None = None
    status: Literal["resolved", "not_found", "ambiguous", "error"]
    reason: str | None = None


class PubChemNameResolver:
    def __init__(self, client: httpx.Client) -> None:
        self.client = client
        self._last_request_ts = 0.0
        self._rate_lock = threading.Lock()

    def resolve(self, name: str) -> PubChemNameResolution:
        try:
            return self._resolve(name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("procedure_pubchem_resolve_failed name=%s error=%s", name, exc)
            return PubChemNameResolution(name=name, status="error", reason="PubChem 查询失败")

    def _resolve(self, name: str) -> PubChemNameResolution:
        cids = self._load_name_cids(name)
        if not cids:
            return PubChemNameResolution(name=name, status="not_found", reason="PubChem 未找到候选")

        cas_to_cids = self._load_cids_cas_identifiers(cids)
        if not cas_to_cids:
            cas_to_cids = self._load_cids_cas_synonyms(cids)
        cas_numbers = list(cas_to_cids)
        if len(cas_numbers) != 1:
            reason = "PubChem 未确认 CAS" if not cas_numbers else "PubChem 返回多个 CAS"
            return PubChemNameResolution(
                name=name,
                cas_numbers=cas_numbers,
                cid=cids[0],
                status="ambiguous",
                reason=reason,
            )
        cas_number = cas_numbers[0]
        return PubChemNameResolution(
            name=name,
            cas_number=cas_number,
            cas_numbers=[cas_number],
            cid=cas_to_cids[cas_number][0],
            status="resolved",
        )

    def _get_json(self, path: str) -> dict[str, Any]:
        attempts = settings.chem_pubchem_max_retries + 1
        for attempt in range(attempts):
            try:
                self._rate_limit()
                response = self.client.get(f"{PUBCHEM_BASE_URL}{path}")
                if response.status_code == 404:
                    return {}
                if response.status_code in RETRY_STATUS_CODES and attempt < attempts - 1:
                    self._wait_before_retry(attempt)
                    continue
                response.raise_for_status()
                payload = response.json()
                return payload if isinstance(payload, dict) else {}
            except httpx.TimeoutException:
                if attempt >= attempts - 1:
                    raise
                self._wait_before_retry(attempt)
        raise RuntimeError("PubChem retry loop exhausted")

    def _rate_limit(self) -> None:
        with self._rate_lock:
            min_interval = 1.0 / settings.chem_pubchem_rate_limit_per_second
            wait_seconds = min_interval - (time.monotonic() - self._last_request_ts)
            if wait_seconds > 0:
                time.sleep(wait_seconds)
            self._last_request_ts = time.monotonic()

    @staticmethod
    def _wait_before_retry(attempt: int) -> None:
        time.sleep(min(2 ** attempt, 5))

    def _load_name_cids(self, name: str) -> list[int]:
        payload = self._get_json(f"/compound/name/{quote(name, safe='')}/cids/JSON")
        cids = payload.get("IdentifierList", {}).get("CID", [])
        return unique_ints(cids)

    def _load_cids_cas_identifiers(self, cids: list[int]) -> dict[str, list[int]]:
        cas_to_cids: dict[str, list[int]] = {}
        for cid_batch in chunk_ints(cids, PUBCHEM_CID_BATCH_SIZE):
            cid_list = ",".join(str(cid) for cid in cid_batch)
            path = f"/compound/cid/{cid_list}/identifiers/JSON?identifier_type=CAS"
            rows = self._get_json(path).get("InformationList", {}).get("Information", [])
            for row in rows:
                cid = parse_cid(row.get("CID"))
                identifiers = row.get("Identifiers", [])
                if cid is None or not isinstance(identifiers, list):
                    continue
                values = [
                    item.get("Identifier")
                    for item in identifiers
                    if isinstance(item, dict) and item.get("Type") == "CAS"
                ]
                add_cid_cas_values(cas_to_cids, cid, values)
        return cas_to_cids

    def _load_cids_cas_synonyms(self, cids: list[int]) -> dict[str, list[int]]:
        cas_to_cids: dict[str, list[int]] = {}
        for cid_batch in chunk_ints(cids, PUBCHEM_CID_BATCH_SIZE):
            cid_list = ",".join(str(cid) for cid in cid_batch)
            rows = self._get_json(f"/compound/cid/{cid_list}/synonyms/JSON")
            rows = rows.get("InformationList", {}).get("Information", [])
            for row in rows:
                cid = parse_cid(row.get("CID"))
                synonyms = row.get("Synonym", [])
                if cid is not None and isinstance(synonyms, list):
                    add_cid_cas_values(cas_to_cids, cid, synonyms)
        return cas_to_cids


def parse_cid(value: Any) -> int | None:
    if isinstance(value, int | str) and str(value).isdigit():
        return int(value)
    return None


def unique_ints(values: list[Any]) -> list[int]:
    result: list[int] = []
    seen: set[int] = set()
    for value in values:
        parsed = parse_cid(value)
        if parsed is not None and parsed not in seen:
            result.append(parsed)
            seen.add(parsed)
    return result


def chunk_ints(values: list[int], size: int) -> list[list[int]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def add_cid_cas_values(cas_to_cids: dict[str, list[int]], cid: int, values: list[Any]) -> None:
    for cas_number in extract_valid_cas_numbers(values):
        cas_cids = cas_to_cids.setdefault(cas_number, [])
        if cid not in cas_cids:
            cas_cids.append(cid)


def extract_valid_cas_numbers(values: list[Any]) -> list[str]:
    cas_numbers: list[str] = []
    seen: set[str] = set()
    for value in values:
        for raw_cas in CAS_CANDIDATE_PATTERN.findall(str(value)):
            cas = normalize_cas(raw_cas)
            is_valid, _ = validate_cas_format(cas)
            if is_valid and cas not in seen:
                cas_numbers.append(cas)
                seen.add(cas)
    return cas_numbers
