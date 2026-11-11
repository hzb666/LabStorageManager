from __future__ import annotations

import asyncio
import json
from time import monotonic
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from rdkit import Chem
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.api import procedure_inventory_search
from app.core.auth import get_current_user
from app.database import get_db
from app.models.chemical_name_map import ChemicalNameMap
from app.models.compound_structure import CompoundStructureCache, CompoundStructureStatus
from app.models.inventory import Inventory
from app.models.user import User
from app.services import procedure_inventory_search as procedure_search
from app.services import procedure_llm_extractor, procedure_report
from app.services.molecular_formula import calculate_molar_mass
from app.services.procedure_inventory_analysis import build_analysis_items
from app.services.procedure_inventory_models import (
    ProcedureInventoryExtractionResult,
    ProcedureLLMExtraction,
    ProcedureLLMReagent,
    ProcedureResolvedReagent,
)


@pytest.fixture(autouse=True)
def clear_report_molecular_cache():
    procedure_report._molecular_data_cache.clear()
    yield
    procedure_report._molecular_data_cache.clear()


@pytest.mark.parametrize(("formula", "expected"), [
    ("H2O", 18.015), ("C2H6O", 46.069), ("NaCl", 58.443),
    ("CuSO4·5H2O", 249.684), ("Fe2(SO4)3", 399.879),
    ("K4[Fe(CN)6]", 368.345), ("C₆H₁₂O₆", 180.156), ("D2O", 20.027),
])
def test_molar_mass_includes_groups_and_hydration(formula, expected):
    assert calculate_molar_mass(formula) == pytest.approx(expected, abs=0.02)


@pytest.mark.parametrize("formula", [
    None, "", "unknown", "(CH2)n", "Fe3+", "[13C]H4", "H0", "Xx2O", "(OH",
    "OH)", "Mg(OH]2", "CuSO4..H2O", "CH4 garbage", "C" * 201,
])
def test_molar_mass_never_returns_partial_or_ambiguous_values(formula):
    assert calculate_molar_mass(formula) is None


@pytest.fixture
def report_db(monkeypatch):
    monkeypatch.setattr(procedure_report.settings, "chem_resolver_pubchem_enabled", False)
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()


def test_report_loads_all_matching_bottles_and_keeps_zero_remaining(report_db):
    for index in range(205):
        report_db.add(Inventory(
            internal_code=f"report-{index}", cas_number="64-17-5", name="乙醇",
            brand="Sigma", storage_location="A1", category=None,
            initial_quantity=500, remaining_quantity=0 if index == 0 else 100, unit="ml",
        ))
    report_db.add(Inventory(
        internal_code="unrelated", cas_number="67-64-1", name="丙酮", category=None,
        brand=None, storage_location=None,
    ))
    report_db.add(CompoundStructureCache(
        cas_number="64-17-5", status=CompoundStructureStatus.RESOLVED, molecular_formula="C2H6O",
        molecular_weight=999,  # The report must calculate, not trust stale stored mass.
    ))
    report_db.commit()

    result = procedure_report.build_procedure_report(report_db, ["64-17-5", "7732-18-5"])

    assert len(result.inventory_groups[0].items) == 205
    assert any(item["remaining_quantity"] == 0 for item in result.inventory_groups[0].items)
    assert result.inventory_groups[1].items == []
    assert result.compounds[0].molecular_weight == pytest.approx(46.069)
    assert result.compounds[1].molecular_weight is None


def test_report_prefers_manual_structure_over_old_formula_and_does_not_write(report_db):
    cache = CompoundStructureCache(
        cas_number="67-64-1", status=CompoundStructureStatus.RESOLVED,
        manually_verified=True, molecular_formula="H2O",
        molblock=Chem.MolToMolBlock(Chem.MolFromSmiles("CC(=O)C")),
    )
    report_db.add(cache)
    report_db.commit()
    result = procedure_report.build_procedure_report(report_db, ["67-64-1"])
    assert result.compounds[0].molecular_formula == "C3H6O"
    assert result.compounds[0].molecular_weight == pytest.approx(58.08, abs=0.01)
    assert not report_db.dirty
    assert cache.molecular_formula == "H2O"


def test_common_reagent_mass_uses_unique_local_name_mapping_without_changing_inventory_query(report_db):
    report_db.add(ChemicalNameMap(cas_number="64-17-5", name="乙醇", english_name="ethanol"))
    report_db.add(CompoundStructureCache(
        cas_number="64-17-5", status=CompoundStructureStatus.RESOLVED, molecular_formula="C2H6O",
    ))
    report_db.commit()
    result = procedure_report.build_procedure_report(report_db, [], ["ethanol"])
    assert result.inventory_groups == []
    assert result.compounds[0].cas_number == "64-17-5"
    assert result.compounds[0].query_name == "ethanol"
    assert result.compounds[0].molecular_weight == pytest.approx(46.069)


def test_common_reagent_name_without_local_cas_can_still_get_formula(report_db, monkeypatch):
    monkeypatch.setattr(procedure_report.settings, "chem_resolver_pubchem_enabled", True)
    monkeypatch.setattr(procedure_report, "_fetch_pubchem_properties", AsyncMock(return_value=procedure_report.MolecularData("C2H6O", 46.07)))
    result = procedure_report.build_procedure_report(report_db, [], ["ethanol"])
    assert result.compounds[0].cas_number == ""
    assert result.compounds[0].query_name == "ethanol"
    assert result.compounds[0].molecular_weight == pytest.approx(46.07)


@pytest.mark.parametrize(("formulas", "expected"), [
    (["C2H6O", "C2H6O"], "C2H6O"), (["C2H6O", "H2O"], None), ([], None),
])
def test_pubchem_formula_does_not_choose_between_different_compositions(formulas, expected):
    data = procedure_report._molecular_data_from_payload({
        "PropertyTable": {"Properties": [{"MolecularFormula": value} for value in formulas]},
    })
    assert data.formula == expected


def test_formula_lookup_failure_still_produces_printable_inventory(report_db, monkeypatch):
    monkeypatch.setattr(procedure_report.settings, "chem_resolver_pubchem_enabled", True)

    def unavailable(_self, _cas):
        raise httpx.ReadTimeout("offline")

    monkeypatch.setattr(procedure_report, "_fetch_pubchem_properties", AsyncMock(side_effect=unavailable))
    result = procedure_report.build_procedure_report(report_db, ["64-17-5"])
    assert len(result.inventory_groups) == 1
    assert result.compounds[0].molecular_weight is None


async def test_report_deadline_keeps_completed_formulas_and_cancels_unfinished_requests(monkeypatch):
    cancelled = []

    async def fetch(_client, identifier):
        if identifier == "fast":
            return procedure_report.MolecularData("C2H6O", 46.07)
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(identifier)

    monkeypatch.setattr(procedure_report, "REPORT_LOOKUP_BUDGET_SECONDS", .3)
    monkeypatch.setattr(procedure_report.settings, "chem_pubchem_rate_limit_per_second", 5)
    monkeypatch.setattr(procedure_report, "_fetch_pubchem_properties", fetch)
    monkeypatch.setattr(procedure_report, "get_ssl_context", lambda: None)
    monkeypatch.setattr(procedure_report.httpx, "AsyncClient", lambda **_: AsyncMock())
    started = monotonic()
    formulas = await procedure_report._fetch_pubchem_data(["fast", "slow", "queued"])
    assert formulas == {"fast": procedure_report.MolecularData("C2H6O", 46.07)}
    assert cancelled == ["slow"]
    assert monotonic() - started < 1.5


def test_report_api_checks_permissions_and_cas_without_requiring_llm(report_db, monkeypatch):
    monkeypatch.setattr(procedure_report.settings, "llm_enabled", False)
    monkeypatch.setattr(procedure_inventory_search, "_enforce_procedure_rate_limit", lambda **_: None)
    app = FastAPI()
    app.include_router(procedure_inventory_search.router)
    user = User(id=1, username="test", password_hash="unused", role="user")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: report_db
    with TestClient(app) as client:
        response = client.post("/procedure-inventory-search/report", json={
            "cas_numbers": ["64-17-5", "64-17-5"],
        })
        assert response.status_code == 200
        assert len(response.json()["compounds"]) == 1
        assert client.post("/procedure-inventory-search/report", json={
            "cas_numbers": ["not-a-cas"],
        }).status_code == 422
        user.role = "public"
        assert client.post("/procedure-inventory-search/report", json={
            "cas_numbers": [],
        }).status_code == 403


def test_local_names_formulas_structures_and_mass_skip_pubchem(report_db, monkeypatch):
    monkeypatch.setattr(procedure_report.settings, "chem_resolver_pubchem_enabled", True)
    calls = []
    monkeypatch.setattr(procedure_report, "_fetch_pubchem_properties", AsyncMock(side_effect=lambda _, name: calls.append(name)))
    report_db.add(ChemicalNameMap(cas_number="64-17-5", name="乙醇", english_name="ethanol"))
    report_db.add(CompoundStructureCache(
        cas_number="64-17-5", status=CompoundStructureStatus.RESOLVED,
        smiles_canonical="CCO", chinese_name="旧名称",
    ))
    report_db.add(CompoundStructureCache(
        cas_number="67-64-1", status=CompoundStructureStatus.RESOLVED,
        english_name="acetone", chinese_name="丙酮", molecular_weight=58.08,
    ))
    report_db.commit()
    result = procedure_report.build_procedure_report(report_db, ["64-17-5"], ["ethanol", "acetone"])
    assert calls == []
    assert result.compounds[0].chinese_name == "乙醇"
    assert result.compounds[1].molecular_weight == pytest.approx(46.069)
    assert result.compounds[2].chinese_name == "丙酮"
    assert result.compounds[2].molecular_weight == pytest.approx(58.08)
    assert not report_db.dirty


def test_multiple_local_name_matches_with_shared_mass_do_not_query_the_name(report_db, monkeypatch):
    monkeypatch.setattr(procedure_report.settings, "chem_resolver_pubchem_enabled", True)
    calls = []
    monkeypatch.setattr(procedure_report, "_fetch_pubchem_properties", AsyncMock(side_effect=lambda _, name: calls.append(name)))
    for cas, name in [("64-17-5", "候选甲"), ("67-64-1", "候选乙")]:
        report_db.add(ChemicalNameMap(cas_number=cas, name=name, alias_1="shared alias"))
        report_db.add(CompoundStructureCache(
            cas_number=cas, status=CompoundStructureStatus.RESOLVED, molecular_formula="C2H6O",
        ))
    report_db.commit()
    result = procedure_report.build_procedure_report(report_db, [], ["shared alias"])
    assert calls == []
    compound = result.compounds[0]
    assert set(compound.cas_numbers) == {"64-17-5", "67-64-1"}
    assert compound.cas_number == ""
    assert compound.molecular_weight == pytest.approx(46.069)
    assert compound.molecular_formula == "C2H6O"


def test_resolution_checks_local_cache_before_pubchem_and_preserves_chinese_display(report_db, monkeypatch):
    monkeypatch.setattr(procedure_search, "_ensure_llm_ready", lambda: None)
    def unexpected(_candidates):
        pytest.fail("An exact local name match must not query PubChem")
    monkeypatch.setattr(procedure_search, "_resolve_candidates_with_pubchem", unexpected)
    report_db.add(CompoundStructureCache(
        cas_number="121-44-8", status=CompoundStructureStatus.RESOLVED,
        english_name="triethylamine", chinese_name="三乙胺",
    ))
    report_db.commit()
    reagent = ProcedureLLMReagent(name="Et3N", chinese_name="三乙胺", pubchem_query_name="triethylamine")
    result = procedure_search.resolve_procedure_inventory(
        report_db, extraction=ProcedureInventoryExtractionResult(reagents=[reagent]), user_id=1,
    )
    assert result.cas_query == "121-44-8"
    assert result.analysis_items[0].chinese_name == "三乙胺"
    assert result.resolved[0].reason == "本地名称匹配"
    common = build_analysis_items([ProcedureLLMReagent(name='ethanol', chinese_name='乙醇')], [
        ProcedureResolvedReagent(name='ethanol', cas_number='64-17-5'),
    ], [], {'64-17-5'})
    assert common[0].chinese_name == "乙醇"


def test_llm_equivalents_survive_extract_resolve_api_roundtrip(report_db, monkeypatch):
    monkeypatch.setattr(procedure_search, "_ensure_llm_ready", lambda: None)
    monkeypatch.setattr(procedure_search, "record_procedure_llm_usage", lambda *_, **__: None)
    monkeypatch.setattr(procedure_inventory_search, "_enforce_procedure_rate_limit", lambda **_: None)
    report_db.add(CompoundStructureCache(
        cas_number="121-44-8", status=CompoundStructureStatus.RESOLVED,
        english_name="triethylamine", chinese_name="三乙胺",
    ))
    report_db.add(ChemicalNameMap(cas_number='64-17-5', name='乙醇', english_name='ethanol'))
    report_db.commit()
    text = "Triethylamine (1.5 equiv.) was added to ethanol (0.5 eq, 5 mL)."
    calls = []
    def respond(*_args):
        calls.append(True)
        return {"choices": [{"message": {"content": json.dumps({
            "is_experimental_procedure": True,
            "reagents": [{
                "name": name, "chinese_name": None, "pubchem_query_name": name, "is_mixture": False,
                "equivalent": {"value": value, "evidence": evidence, "confidence": "high"},
            } for name, value, evidence in [
                ("Triethylamine", 1.5, "Triethylamine (1.5 equiv.)"),
                ("ethanol", 0.5, "ethanol (0.5 eq, 5 mL)"),
            ]],
        })}}]}
    monkeypatch.setattr(procedure_llm_extractor, "_post_llm_request", respond)
    app = FastAPI()
    app.include_router(procedure_inventory_search.router)
    user = User(id=1, username="test", password_hash="unused", role="user")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: report_db
    with TestClient(app) as client:
        extracted = client.post("/procedure-inventory-search/extract", json={"text": text})
        assert extracted.status_code == 200
        payload = {key: extracted.json()[key] for key in ("rejected", "message", "formatted_text", "reagents")}
        assert payload["reagents"][0]["equivalent"] == 1.5
        assert payload["reagents"][0]["equivalent_confidence"] == "high"
        resolved = client.post("/procedure-inventory-search/resolve", json=payload)
        assert resolved.status_code == 200
        items = {item["name"]: item for item in resolved.json()["analysis_items"]}
        assert items["Triethylamine"]["equivalent"] == 1.5
        assert items["ethanol"]["equivalent"] == 0.5
        assert items["ethanol"]["status"] == "common"
        assert resolved.json()["cas_query"] == "121-44-8"
        payload["reagents"][0]["equivalent_evidence"] = "invented quotation"
        invalid = client.post("/procedure-inventory-search/resolve", json=payload)
        assert invalid.status_code == 200
        assert invalid.json()["analysis_items"][0]["equivalent"] is None
    assert len(calls) == 1


def test_numbered_materials_survive_resolve_without_inventory_or_pubchem_queries(report_db, monkeypatch):
    monkeypatch.setattr(procedure_search, "_ensure_llm_ready", lambda: None)
    def unexpected(*_args, **_kwargs):
        pytest.fail("Non-specific materials must stay in the report without chemical lookup")
    monkeypatch.setattr(procedure_search, "_resolve_candidates_with_pubchem", unexpected)
    monkeypatch.setattr(procedure_search, "local_name_cas_numbers", unexpected)
    names = ["compound 3", "compound 4", "3a", "3-a", "3A", "底物"]
    text = "; ".join(f"{name} (1.5 eq)" for name in names)
    reagents = [ProcedureLLMReagent(
        name=name, is_specific=False, equivalent=1.5,
        equivalent_evidence=f"{name} (1.5 eq)", equivalent_confidence="high",
    ) for name in names]
    result = procedure_search.resolve_procedure_inventory(
        report_db, extraction=ProcedureInventoryExtractionResult(formatted_text=text, reagents=reagents), user_id=1,
    )
    assert result.cas_query == ""
    assert result.resolved == []
    assert [item.name for item in result.analysis_items] == names
    assert all(item.status == "generic" and item.equivalent == 1.5 for item in result.analysis_items)


def test_common_reagent_uses_original_chinese_name_before_network_canonical_name(report_db, monkeypatch):
    monkeypatch.setattr(procedure_report.settings, "chem_resolver_pubchem_enabled", True)
    calls = []
    monkeypatch.setattr(procedure_report, "_fetch_pubchem_properties", AsyncMock(side_effect=lambda _, name: calls.append(name)))
    report_db.add(ChemicalNameMap(cas_number="64-17-5", name="乙醇"))
    report_db.add(CompoundStructureCache(
        cas_number="64-17-5", status=CompoundStructureStatus.RESOLVED, molecular_formula="C2H6O",
    ))
    report_db.commit()
    result = procedure_report.build_procedure_report(
        report_db, [], ["ethanol"], {"ethanol": ["乙醇"]},
    )
    assert calls == []
    assert result.compounds[0].cas_number == "64-17-5"
    assert result.compounds[0].chinese_name == "乙醇"
    assert result.compounds[0].molecular_weight == pytest.approx(46.069)


def test_merged_aliases_resolve_locally_and_each_cas_mass_is_calculated_once(report_db, monkeypatch):
    report_db.add(ChemicalNameMap(cas_number='64-17-5', name='乙醇'))
    report_db.add(CompoundStructureCache(
        cas_number='64-17-5', status=CompoundStructureStatus.RESOLVED, molecular_formula='C2H6O',
    ))
    report_db.commit()
    calls = []
    def calculate(formula):
        calls.append(formula)
        return calculate_molar_mass(formula)
    monkeypatch.setattr(procedure_report, 'calculate_molar_mass', calculate)
    payload = procedure_report.ProcedureReportRequest(
        cas_numbers=['64-17-5'], names=['ethanol'],
        name_aliases={'ethanol': ['乙醇', 'EtOH', 'alcohol']},
    )
    data = procedure_report.build_procedure_report(report_db, payload.cas_numbers, payload.names, payload.name_aliases)
    assert [item.molecular_weight for item in data.compounds] == pytest.approx([46.069, 46.069])
    assert calls == ['C2H6O']
    with pytest.raises(ValueError, match='Too many reagent aliases'):
        procedure_report.ProcedureReportRequest(name_aliases={'ethanol': [f'alias{i}' for i in range(101)]})


def test_local_cas_identity_is_resolved_before_common_public_classification(report_db, monkeypatch):
    monkeypatch.setattr(procedure_search, '_ensure_llm_ready', lambda: None)
    def unexpected(_):
        pytest.fail('A local name match must not require an external query')
    monkeypatch.setattr(procedure_search, '_resolve_candidates_with_pubchem', unexpected)
    report_db.add(ChemicalNameMap(cas_number='121-44-8', name='三乙胺', english_name='triethylamine'))
    report_db.commit()
    extraction = ProcedureInventoryExtractionResult(reagents=[ProcedureLLMReagent(
        name='Et3N', pubchem_query_name='triethylamine', is_specific=True,
    )])
    result = procedure_search.resolve_procedure_inventory(report_db, extraction=extraction, user_id=1)
    assert result.analysis_items[0].status == 'common'
    assert result.analysis_items[0].cas_number == '121-44-8'
    assert result.resolved[0].query_name == 'triethylamine'
    assert result.cas_query == ''


def test_extraction_does_not_insert_materials_or_reorder_llm_results(report_db, monkeypatch):
    monkeypatch.setattr(procedure_search, '_ensure_llm_ready', lambda: None)
    reagents = [ProcedureLLMReagent(name='1a', is_specific=False), ProcedureLLMReagent(name='triethylamine')]
    monkeypatch.setattr(procedure_search, 'extract_reagents_with_llm', lambda *_, **__: ProcedureLLMExtraction(
        is_experimental_procedure=True, reagents=reagents,
    ))
    report_db.add(ChemicalNameMap(cas_number='64-17-5', name='ethanol'))
    report_db.commit()
    result = procedure_search.extract_procedure_inventory(
        report_db, text='Triethylamine was added to 1a in ethanol and water.', user_id=1,
    )
    assert [item.name for item in result.reagents] == ['1a', 'triethylamine']


@pytest.mark.parametrize(('common_cas', 'expected_query', 'expected_status'), [
    ([], '64-17-5&&67-64-1', 'resolved'),
    (['64-17-5'], '67-64-1', 'resolved'),
    (['64-17-5', '67-64-1'], '', 'common'),
])
def test_pubchem_cas_candidates_are_individually_checked_against_common_public_data(
    report_db, monkeypatch, common_cas, expected_query, expected_status,
):
    monkeypatch.setattr(procedure_search, '_ensure_llm_ready', lambda: None)
    # The names deliberately differ: exclusion is based on returned CAS, not text.
    for cas in common_cas:
        report_db.add(ChemicalNameMap(cas_number=cas, name=f'公用物料 {cas}'))
    report_db.commit()
    queries = []
    def resolve(candidates):
        queries.extend(item.pubchem_query_name for item in candidates)
        return [ProcedureResolvedReagent(
            name='EtOH', query_name='ethanol', cas_number='64-17-5',
            cas_numbers=['64-17-5', '67-64-1'],
        )], []
    monkeypatch.setattr(procedure_search, '_resolve_candidates_with_pubchem', resolve)
    result = procedure_search.resolve_procedure_inventory(
        report_db, extraction=ProcedureInventoryExtractionResult(reagents=[
            ProcedureLLMReagent(name='EtOH', pubchem_query_name='ethanol'),
            ProcedureLLMReagent(name='brine', is_specific=False),
        ]), user_id=1,
    )
    assert queries == ['ethanol']
    assert result.cas_query == expected_query
    assert [item.status for item in result.analysis_items] == [expected_status, 'generic']
    assert result.analysis_items[0].cas_numbers == ['64-17-5', '67-64-1']
    if common_cas:
        assert '未查询普通库存' in result.analysis_items[0].reason


def test_reliable_chinese_name_can_match_local_cas_when_english_alias_is_missing(report_db, monkeypatch):
    monkeypatch.setattr(procedure_search, '_ensure_llm_ready', lambda: None)
    def unexpected(_):
        pytest.fail('A reliable Chinese name should match locally before querying PubChem')
    monkeypatch.setattr(procedure_search, '_resolve_candidates_with_pubchem', unexpected)
    report_db.add(ChemicalNameMap(cas_number='64-17-5', name='乙醇'))
    report_db.commit()
    result = procedure_search.resolve_procedure_inventory(
        report_db, extraction=ProcedureInventoryExtractionResult(reagents=[
            ProcedureLLMReagent(name='EtOH', chinese_name='乙醇', pubchem_query_name='ethanol'),
        ]), user_id=1,
    )
    assert result.analysis_items[0].cas_number == '64-17-5'
    assert result.analysis_items[0].status == 'common'
    assert result.cas_query == ''


def test_confirmed_default_salt_in_common_public_does_not_query_its_registry_aliases(report_db, monkeypatch):
    monkeypatch.setattr(procedure_search, '_ensure_llm_ready', lambda: None)
    report_db.add(ChemicalNameMap(cas_number='7647-14-5', name='氯化钠'))
    report_db.commit()
    monkeypatch.setattr(procedure_search, '_resolve_candidates_with_pubchem', lambda _: ([ProcedureResolvedReagent(
        name='brine', query_name='sodium chloride', cas_number='7647-14-5',
        cas_numbers=['7647-14-5', '14762-51-7'], pubchem_cid=5234,
    )], []))
    result = procedure_search.resolve_procedure_inventory(
        report_db, extraction=ProcedureInventoryExtractionResult(reagents=[
            ProcedureLLMReagent(name='brine', pubchem_query_name='sodium chloride', is_mixture=True),
        ]), user_id=1,
    )
    assert result.cas_query == ''
    assert result.analysis_items[0].status == 'common'
    assert result.analysis_items[0].cas_numbers == ['7647-14-5']


@pytest.mark.parametrize(('material_name', 'component_name', 'component_cas'), [
    ('brine', 'sodium chloride', '7647-14-5'),
    ('aqueous ammonium chloride', 'ammonium chloride', '12125-02-9'),
])
def test_llm_defined_solution_component_is_queried_without_losing_material_identity(
    report_db, monkeypatch, material_name, component_name, component_cas,
):
    monkeypatch.setattr(procedure_search, '_ensure_llm_ready', lambda: None)
    report_db.add(ChemicalNameMap(cas_number=component_cas, name=component_name))
    report_db.commit()
    def unexpected(_):
        pytest.fail('The LLM-provided component name must resolve locally without a material-name rule')
    monkeypatch.setattr(procedure_search, '_resolve_candidates_with_pubchem', unexpected)
    result = procedure_search.resolve_procedure_inventory(
        report_db, extraction=ProcedureInventoryExtractionResult(reagents=[
            ProcedureLLMReagent(name=material_name, pubchem_query_name=component_name, is_mixture=True),
        ]), user_id=1,
    )
    assert result.cas_query == ''
    item = result.analysis_items[0]
    assert item.name == material_name
    assert item.is_mixture is True
    assert item.cas_number == component_cas
    assert item.status == 'common'
    assert 'CAS 属于成分' in item.reason


def test_report_excludes_common_public_cas_from_inventory_but_keeps_molecular_data(report_db, monkeypatch):
    report_db.add(ChemicalNameMap(cas_number='64-17-5', name='乙醇'))
    for index, cas in enumerate(['64-17-5', '67-64-1']):
        report_db.add(Inventory(internal_code=f'common-filter-{index}', cas_number=cas, name='试剂'))
    report_db.add(CompoundStructureCache(
        cas_number='64-17-5', status=CompoundStructureStatus.RESOLVED, molecular_formula='C2H6O',
    ))
    report_db.commit()
    load = procedure_report.load_inventory_groups
    queries = []
    def inventory_groups(db, cas_numbers, resolved):
        queries.extend(cas_numbers)
        return load(db, cas_numbers, resolved)
    monkeypatch.setattr(procedure_report, 'load_inventory_groups', inventory_groups)
    result = procedure_report.build_procedure_report(report_db, ['64-17-5', '67-64-1'])
    assert queries == ['67-64-1']
    assert [group.cas_number for group in result.inventory_groups] == ['67-64-1']
    assert len(result.inventory_groups[0].items) == 1
    assert result.compounds[0].cas_number == '64-17-5'
    assert result.compounds[0].chinese_name == '乙醇'
    assert result.compounds[0].molecular_weight == pytest.approx(46.069)


async def test_pubchem_fetches_formula_and_weight_together_without_deriving_isotope_mass():
    def respond(request):
        assert request.url.path.endswith('/property/MolecularFormula,MolecularWeight/JSON')
        return httpx.Response(200, json={"PropertyTable": {"Properties": [{
            "MolecularFormula": "C2H6O", "MolecularWeight": "52.11",
        }]}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        data = await procedure_report._fetch_pubchem_properties(client, 'ethanol-d6')
    assert data == procedure_report.MolecularData('C2H6O', 52.11)


@pytest.mark.parametrize('rows', [
    [], [None], [{"MolecularFormula": "C2H6O"}, {"MolecularFormula": "H2O"}],
    [{"MolecularWeight": "NaN"}], [{"MolecularWeight": "Infinity"}],
    [{"MolecularWeight": True}], [{"MolecularWeight": -1}],
    [{"MolecularWeight": 46.07}, {"MolecularWeight": 18.02}],
    [{"MolecularWeight": 46.07}, {}],
])
def test_pubchem_properties_do_not_guess_between_invalid_or_different_candidates(rows):
    assert procedure_report._molecular_data_from_payload({
        'PropertyTable': {'Properties': rows},
    }) == procedure_report.MolecularData()


def test_molecular_cache_reuses_results_but_keeps_inventory_and_manual_data_fresh(report_db, monkeypatch):
    monkeypatch.setattr(procedure_report.settings, 'chem_resolver_pubchem_enabled', True)
    fetch = AsyncMock(return_value={'64-17-5': procedure_report.MolecularData('C2H6O', 46.07)})
    monkeypatch.setattr(procedure_report, '_fetch_pubchem_data', fetch)
    first = procedure_report.build_procedure_report(report_db, ['64-17-5'])
    assert first.compounds[0].molecular_weight == 46.07
    report_db.add(Inventory(
        internal_code='fresh', cas_number='64-17-5', name='乙醇', category=None,
        remaining_quantity=123, unit='mL', brand=None, storage_location='A2',
    ))
    report_db.commit()
    second = procedure_report.build_procedure_report(report_db, ['64-17-5'])
    assert second.inventory_groups[0].items[0]['remaining_quantity'] == 123
    assert second.compounds[0].molecular_weight == 46.07
    assert fetch.await_count == 1
    report_db.add(CompoundStructureCache(
        cas_number='64-17-5', status=CompoundStructureStatus.RESOLVED, manually_verified=True,
        smiles_canonical='CC(=O)C',
    ))
    report_db.commit()
    third = procedure_report.build_procedure_report(report_db, ['64-17-5'])
    assert third.compounds[0].molecular_formula == 'C3H6O'
    assert third.compounds[0].molecular_weight == pytest.approx(58.08, abs=.01)
    assert fetch.await_count == 1
    assert not report_db.dirty


def test_unavailable_data_expires_soon_and_cache_has_a_size_limit(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(procedure_report, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(procedure_report, 'REPORT_DATA_CACHE_SIZE', 2)
    fetch = AsyncMock(return_value={})
    monkeypatch.setattr(procedure_report, '_fetch_pubchem_data', fetch)
    procedure_report._load_pubchem_data(['offline'])
    procedure_report._load_pubchem_data(['offline'])
    assert fetch.await_count == 1
    clock[0] += procedure_report.REPORT_UNAVAILABLE_CACHE_TTL + 1
    fetch.return_value = {'offline': procedure_report.MolecularData('H2O', 18.015)}
    assert procedure_report._load_pubchem_data(['offline'])['offline'].weight == 18.015
    assert fetch.await_count == 2
    procedure_report._load_pubchem_data(['other', 'third'])
    assert len(procedure_report._molecular_data_cache) == 2
    assert 'offline' not in procedure_report._molecular_data_cache
