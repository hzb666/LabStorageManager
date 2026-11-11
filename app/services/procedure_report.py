"""Read-only inventory snapshot and molecular data for a printable procedure report."""
from __future__ import annotations

import asyncio
import logging
import math
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from threading import Lock
from time import monotonic
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field, field_validator
from rdkit import Chem
from rdkit.Chem.rdMolDescriptors import CalcMolFormula
from sqlmodel import Session, select

from app.core.config import settings
from app.core.http_client import get_ssl_context
from app.core.time_utils import get_utc_now
from app.models.compound_structure import CompoundStructureCache, CompoundStructureStatus
from app.services.cas_utils import is_valid_cas
from app.services.molecular_formula import calculate_molar_mass
from app.services.procedure_inventory_lookup import (
    common_cas_numbers,
    load_inventory_groups,
    unique_cas_order,
)
from app.services.procedure_inventory_models import ProcedureInventoryGroup
from app.services.procedure_local_data import local_chinese_names, local_name_cas_numbers
from app.services.procedure_pubchem_name import PUBCHEM_BASE_URL

logger = logging.getLogger(__name__)
REPORT_LOOKUP_BUDGET_SECONDS = 5.0
REPORT_DATA_CACHE_SIZE = 2048
REPORT_DATA_CACHE_TTL = 24 * 60 * 60
REPORT_UNAVAILABLE_CACHE_TTL = 60


@dataclass(frozen=True)
class MolecularData:
    formula: str | None = None
    weight: float | None = None


_molecular_data_cache: OrderedDict[str, tuple[float, MolecularData]] = OrderedDict()
_molecular_data_lock = Lock()


class ProcedureReportRequest(BaseModel):
    cas_numbers: list[str] = Field(default_factory=list, max_length=250)
    names: list[str] = Field(default_factory=list, max_length=50)
    name_aliases: dict[str, list[str]] = Field(default_factory=dict, max_length=50)

    @field_validator("name_aliases")
    @classmethod
    def validate_name_aliases(cls, values: dict[str, list[str]]) -> dict[str, list[str]]:
        if sum(len(aliases) for aliases in values.values()) > 100:
            raise ValueError("Too many reagent aliases")
        for name, aliases in values.items():
            if not name.strip() or len(name) > 200:
                raise ValueError("Invalid reagent aliases")
            if any(not alias.strip() or len(alias) > 200 for alias in aliases):
                raise ValueError("Invalid reagent alias")
        return values

    @field_validator("names")
    @classmethod
    def validate_names(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or len(value) > 200 for value in values):
            raise ValueError("Invalid reagent name")
        return list(dict.fromkeys(value.strip() for value in values))

    @field_validator("cas_numbers")
    @classmethod
    def validate_cas_numbers(cls, values: list[str]) -> list[str]:
        if any(len(value) > 50 or not is_valid_cas(value.strip()) for value in values):
            raise ValueError("Invalid CAS number")
        return unique_cas_order(values)


class ProcedureReportCompound(BaseModel):
    cas_number: str
    cas_numbers: list[str] = Field(default_factory=list)
    query_name: str | None = None
    chinese_name: str | None = None
    molecular_formula: str | None = None
    molecular_weight: float | None = None


class ProcedureReportData(BaseModel):
    generated_at: datetime
    inventory_groups: list[ProcedureInventoryGroup]
    compounds: list[ProcedureReportCompound]


def build_procedure_report(
    db: Session, cas_numbers: list[str], names: list[str] | None = None,
    name_aliases: dict[str, list[str]] | None = None,
) -> ProcedureReportData:
    generated_at = get_utc_now()
    common_cas = common_cas_numbers(db, cas_numbers)
    groups = load_inventory_groups(db, [cas for cas in cas_numbers if cas not in common_cas], [])
    aliases = name_aliases or {}
    lookup_names = list(dict.fromkeys([
        *(names or []), *(alias for name in (names or []) for alias in aliases.get(name, [])),
    ]))
    local_matches = local_name_cas_numbers(db, lookup_names)
    named_cas = {
        name: list(dict.fromkeys(cas for alias in [name, *aliases.get(name, [])]
                                 for cas in local_matches.get(alias, [])))
        for name in (names or [])
    }
    # A local match, including multiple matches, always takes precedence over a name query.
    named_cas = {name: candidates or [name] for name, candidates in named_cas.items()}
    identifiers = list(dict.fromkeys([
        *cas_numbers, *(cas for candidates in named_cas.values() for cas in candidates),
    ]))
    molecular_data = _cached_molecular_data(db, identifiers)
    chinese_names = local_chinese_names(db, identifiers)
    missing = [identifier for identifier in identifiers if identifier not in molecular_data]
    if missing and settings.chem_resolver_pubchem_enabled:
        molecular_data.update(_load_pubchem_data(missing))
    unknown = MolecularData()
    def compound(candidates: list[str], query_name: str | None = None) -> ProcedureReportCompound:
        data = [molecular_data.get(cas, unknown) for cas in candidates]
        candidate_weights = [item.weight for item in data]
        known_weights = {round(weight, 6) for weight in candidate_weights if weight is not None}
        same_weight = len(known_weights) == 1 and all(w is not None for w in candidate_weights)
        candidate_formulas = {item.formula for item in data}
        candidate_names = list(dict.fromkeys(chinese_names[cas] for cas in candidates
                                             if cas in chinese_names))
        valid_cas = [cas for cas in candidates if is_valid_cas(cas)]
        return ProcedureReportCompound(
            cas_number=valid_cas[0] if len(valid_cas) == 1 else "",
            cas_numbers=valid_cas,
            query_name=query_name,
            chinese_name=" / ".join(candidate_names) or None,
            molecular_formula=next(iter(candidate_formulas)) if len(candidate_formulas) == 1 else None,
            molecular_weight=candidate_weights[0] if same_weight else None,
        )

    return ProcedureReportData(
        generated_at=generated_at,
        inventory_groups=groups,
        compounds=[
            compound([cas])
            for cas in cas_numbers
        ] + [
            compound(candidates, name) for name, candidates in named_cas.items()
        ],
    )


def _cached_molecular_data(
    db: Session, identifiers: list[str],
) -> dict[str, MolecularData]:
    if not identifiers:
        return {}
    rows = db.exec(select(CompoundStructureCache).where(
        CompoundStructureCache.cas_number.in_(identifiers),
        CompoundStructureCache.status == CompoundStructureStatus.RESOLVED,
    )).all()
    data = {}
    for row in rows:
        formula = _cached_formula(row)
        # Manual structures and definite formulae take precedence over old stored mass.
        weight = calculate_molar_mass(formula)
        if not row.manually_verified and not formula and row.molecular_weight is not None:
            weight = row.molecular_weight if 0 < row.molecular_weight < float("inf") else None
        if row.manually_verified or formula or weight is not None:
            data[row.cas_number] = MolecularData(formula, weight)
    return data


def _cached_formula(row: CompoundStructureCache) -> str | None:
    # Manual structures take precedence over an old PubChem formula on the same row.
    if not row.manually_verified and row.molecular_formula:
        return row.molecular_formula
    try:
        mol = Chem.MolFromMolBlock(row.molblock) if row.molblock else None
        if mol is None and (row.smiles_isomeric or row.smiles_canonical):
            mol = Chem.MolFromSmiles(row.smiles_isomeric or row.smiles_canonical)
        return CalcMolFormula(mol, separateIsotopes=True) if mol is not None else None
    except (ValueError, RuntimeError):
        return None


def _load_pubchem_data(identifiers: list[str]) -> dict[str, MolecularData]:
    # Cache only molecular properties. Inventory and manually confirmed structures
    # are still read afresh and always take precedence over this process-local cache.
    results: dict[str, MolecularData] = {}
    with _molecular_data_lock:
        for identifier in identifiers:
            cached = _molecular_data_cache.get(identifier)
            if cached and cached[0] > monotonic():
                results[identifier] = cached[1]
                _molecular_data_cache.move_to_end(identifier)
    missing = [identifier for identifier in identifiers if identifier not in results]
    if not missing:
        return results
    fetched = asyncio.run(_fetch_pubchem_data(missing))
    with _molecular_data_lock:
        for identifier in missing:
            data = fetched.get(identifier, MolecularData())
            ttl = REPORT_DATA_CACHE_TTL if data.formula or data.weight else REPORT_UNAVAILABLE_CACHE_TTL
            _molecular_data_cache[identifier] = (monotonic() + ttl, data)
            _molecular_data_cache.move_to_end(identifier)
            results[identifier] = data
        while len(_molecular_data_cache) > REPORT_DATA_CACHE_SIZE:
            _molecular_data_cache.popitem(last=False)
    return results


async def _fetch_pubchem_properties(client: httpx.AsyncClient, identifier: str) -> MolecularData:
    response = await client.get(
        f"{PUBCHEM_BASE_URL}/compound/name/{quote(identifier, safe='')}"
        "/property/MolecularFormula,MolecularWeight/JSON",
    )
    if response.status_code == 404:
        return MolecularData()
    response.raise_for_status()
    payload = response.json()
    return _molecular_data_from_payload(payload)


def _molecular_data_from_payload(payload: object) -> MolecularData:
    table = payload.get("PropertyTable") if isinstance(payload, dict) else None
    rows = table.get("Properties") if isinstance(table, dict) else None
    if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) for row in rows):
        return MolecularData()
    formulas = [row.get("MolecularFormula") for row in rows]
    formula = None
    if all(isinstance(value, str) and value.strip() for value in formulas):
        unique_formulas = {value.strip() for value in formulas}
        if len(unique_formulas) == 1:
            formula = unique_formulas.pop()
    weights = []
    for row in rows:
        try:
            value = float(row.get("MolecularWeight"))
        except (TypeError, ValueError, OverflowError):
            break
        if isinstance(row.get("MolecularWeight"), bool) or not math.isfinite(value) or value <= 0:
            break
        weights.append(value)
    weight = weights[0] if len(weights) == len(rows) and len(set(weights)) == 1 else None
    # A shared formula is also sufficient when PubChem omits its numeric property.
    return MolecularData(formula, weight if weight is not None else calculate_molar_mass(formula))


async def _fetch_pubchem_data(identifiers: list[str]) -> dict[str, MolecularData]:
    deadline = asyncio.get_running_loop().time() + REPORT_LOOKUP_BUDGET_SECONDS
    results: dict[str, MolecularData] = {}
    headers = {"User-Agent": settings.chem_pubchem_user_agent, "Accept": "application/json"}
    slots, rate_lock = asyncio.Semaphore(4), asyncio.Lock()
    next_request = 0.0
    async with httpx.AsyncClient(
        timeout=min(settings.chem_pubchem_timeout_seconds, REPORT_LOOKUP_BUDGET_SECONDS),
        headers=headers,
        verify=get_ssl_context(),
    ) as client:
        async def load(identifier: str) -> None:
            nonlocal next_request
            try:
                async with slots:
                    async with rate_lock:
                        loop = asyncio.get_running_loop()
                        await asyncio.sleep(max(0, next_request - loop.time()))
                        next_request = loop.time() + 1 / settings.chem_pubchem_rate_limit_per_second
                    results[identifier] = await _fetch_pubchem_properties(client, identifier)
            except (httpx.HTTPError, ValueError, TypeError, AttributeError):
                logger.warning("procedure_report_molecular_data_unavailable identifier=%s", identifier)
                results[identifier] = MolecularData()

        try:
            async with asyncio.timeout_at(deadline):
                await asyncio.gather(*(load(identifier) for identifier in identifiers))
        except TimeoutError:
            logger.info("Procedure report lookup budget exhausted; using available molecular data")
    return results
