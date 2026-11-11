from __future__ import annotations

import httpx
import pytest

from app.services.cas_utils import validate_cas_format
from app.services.procedure_cas_defaults import INORGANIC_CAS_BY_CID, prioritize_default_cas
from app.services.procedure_inventory_search import _resolved_reagent
from app.services.procedure_pubchem_name import PubChemNameResolver


def test_default_registry_has_valid_distinct_cas_numbers():
    assert len(INORGANIC_CAS_BY_CID) == len(set(INORGANIC_CAS_BY_CID.values()))
    assert all(validate_cas_format(cas)[0] for cas in INORGANIC_CAS_BY_CID.values())


@pytest.mark.parametrize(('cid', 'expected'), [(5234, '7647-14-5'), (24436, '7757-82-6')])
def test_confirmed_identity_can_supply_the_preferred_cas_even_if_missing_from_identifiers(cid, expected):
    assert prioritize_default_cas([], cid=cid) == [expected]


def test_local_candidates_keep_alternates_and_do_not_guess_between_distinct_salts():
    assert prioritize_default_cas(['13759-07-4', '7757-82-6', '13759-07-4']) == ['7757-82-6', '13759-07-4']
    assert prioritize_default_cas(['13759-07-4']) == ['13759-07-4']
    assert prioritize_default_cas(['7757-82-6', '7647-14-5']) == ['7757-82-6', '7647-14-5']
    assert prioritize_default_cas([]) == []


def test_explicit_hydrate_identity_is_not_replaced_by_the_anhydrous_default():
    candidates = ['7727-73-3', '7757-82-6']
    assert prioritize_default_cas(candidates, cid=62649) == candidates


def resolver_for(monkeypatch, cids, identifiers):
    monkeypatch.setattr(PubChemNameResolver, '_rate_limit', lambda _: None)
    def respond(request):
        if request.url.path.endswith('/cids/JSON'):
            return httpx.Response(200, json={'IdentifierList': {'CID': cids}})
        return httpx.Response(200, json={'InformationList': {'Information': [
            {'CID': cid, 'Identifiers': [{'Type': 'CAS', 'Identifier': cas} for cas in values]}
            for cid, values in identifiers.items()
        ]}})
    return PubChemNameResolver(httpx.Client(transport=httpx.MockTransport(respond)))


def test_pubchem_default_is_applied_before_candidate_limit_and_preserves_alternate_matches(monkeypatch):
    alternatives = ['13759-07-4', '15124-09-1', '68081-98-1', '68140-10-3', '68412-82-8']
    resolver = resolver_for(monkeypatch, [24436], {24436: [*alternatives, '7757-82-6']})
    try:
        resolution = resolver.resolve('sodium sulfate')
    finally:
        resolver.client.close()
    assert resolution.cas_numbers == ['7757-82-6', *alternatives]
    reagent = _resolved_reagent('Na2SO4', 'sodium sulfate', resolution)
    assert reagent.cas_number == '7757-82-6'
    assert len(reagent.cas_numbers) == 5
    assert reagent.cas_numbers[1:] == alternatives[:4]


def test_multiple_pubchem_identities_do_not_get_a_single_identity_default(monkeypatch):
    resolver = resolver_for(monkeypatch, [24436, 62649], {
        62649: ['7727-73-3'], 24436: ['13759-07-4'],
    })
    try:
        resolution = resolver.resolve('ambiguous sulfate preparation')
    finally:
        resolver.client.close()
    assert resolution.cas_numbers == ['7727-73-3', '13759-07-4']


def test_hydrate_pubchem_resolution_keeps_its_own_cas_first(monkeypatch):
    resolver = resolver_for(monkeypatch, [62649], {62649: ['7727-73-3', '7757-82-6']})
    try:
        resolution = resolver.resolve('sodium sulfate decahydrate')
    finally:
        resolver.client.close()
    assert resolution.cas_numbers == ['7727-73-3', '7757-82-6']
