import json

import httpx
import pytest
from fastapi import HTTPException

from app.core.api_errors import API_ERROR_CODE_HEADER, ApiErrorCode
from app.core.config import Settings
from app.services import procedure_llm_extractor
from app.services.llm_usage_logger import parse_llm_token_usage
from app.services.procedure_inventory_analysis import (
    build_analysis_items,
    build_skipped_analysis_items,
)
from app.services.procedure_inventory_models import (
    ProcedureLLMExtraction,
    ProcedureLLMReagent,
    ProcedureResolvedReagent,
    ProcedureUnresolvedReagent,
)


def test_build_llm_payload_uses_json_object_response_format(monkeypatch) -> None:
    monkeypatch.setattr(procedure_llm_extractor.settings, "llm_model", "mimo-v2.5-pro")
    monkeypatch.setattr(procedure_llm_extractor.settings, "llm_temperature", 0.0, raising=False)
    monkeypatch.setattr(
        procedure_llm_extractor.settings,
        "llm_response_format",
        "json_object",
        raising=False,
    )
    monkeypatch.setattr(
        procedure_llm_extractor.settings,
        "llm_max_completion_tokens",
        10_240,
        raising=False,
    )
    monkeypatch.setattr(
        procedure_llm_extractor.settings,
        "llm_thinking_type",
        "disabled",
        raising=False,
    )

    payload = procedure_llm_extractor._build_llm_payload('Add sodium chloride.')

    assert payload["model"] == "mimo-v2.5-pro"
    assert payload["temperature"] == 0.0
    assert payload["max_completion_tokens"] == 10_240
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["thinking"] == {"type": "disabled"}


def test_build_llm_payload_can_use_json_schema_response_format(monkeypatch) -> None:
    monkeypatch.setattr(procedure_llm_extractor.settings, "llm_model", "gpt-5")
    monkeypatch.setattr(
        procedure_llm_extractor.settings,
        "llm_response_format",
        "json_schema",
        raising=False,
    )
    monkeypatch.setattr(procedure_llm_extractor.settings, "llm_thinking_type", "", raising=False)

    payload = procedure_llm_extractor._build_llm_payload('Add sodium chloride.')

    assert payload["response_format"]["type"] == "json_schema"
    assert payload["response_format"]["json_schema"]["strict"] is True
    assert payload["response_format"]["json_schema"]["schema"] is (
        procedure_llm_extractor.PROCEDURE_REAGENT_RESPONSE_SCHEMA
    )
    assert "thinking" not in payload


def test_compact_prompt_template_matches_schema_without_a_hardcoded_or_database_name_list():
    prompt = procedure_llm_extractor._build_system_prompt()
    template = next(line for line in prompt.splitlines() if line.startswith('{"is_experimental_procedure"'))
    example = json.loads(template)
    fields = procedure_llm_extractor.PROCEDURE_REAGENT_RESPONSE_SCHEMA
    assert set(example) == set(fields["required"])
    assert set(example["reagents"][0]) == set(fields["properties"]["reagents"]["items"]["required"])
    assert list(example['reagents'][0]).index('pubchem_query_name') < list(example['reagents'][0]).index('is_mixture')
    assert len(example['reagents'][0]) == 5
    parsed = procedure_llm_extractor._parse_llm_response({'choices': [{'message': {'content': template}}]})
    assert parsed.reagents[0].is_specific is True
    assert parsed.reagents[0].equivalent is None
    assert parsed.reagents[1].is_specific is True
    assert parsed.reagents[1].is_mixture is True
    assert parsed.reagents[1].pubchem_query_name is not None
    assert '常用分类和库存判断由后端负责' in prompt
    assert 'should_query_pubchem' not in fields['properties']['reagents']['items']['properties']
    assert len(prompt) < 4000


def test_settings_parse_llm_runtime_environment(monkeypatch) -> None:
    monkeypatch.setenv("LLM_RESPONSE_FORMAT", "json_object")
    monkeypatch.setenv("LLM_TEMPERATURE", "0.2")
    monkeypatch.setenv("LLM_MAX_COMPLETION_TOKENS", "10240")
    monkeypatch.setenv("LLM_THINKING_TYPE", "disabled")
    monkeypatch.setenv("LLM_PARSE_RETRY_COUNT", "1")

    settings = Settings(_env_file=None)

    assert settings.llm_response_format == "json_object"
    assert settings.llm_temperature == 0.2
    assert settings.llm_max_completion_tokens == 10_240
    assert settings.llm_thinking_type == "disabled"
    assert settings.llm_parse_retry_count == 1


def test_settings_default_llm_max_completion_tokens_is_50000(monkeypatch) -> None:
    monkeypatch.delenv("LLM_MAX_COMPLETION_TOKENS", raising=False)

    settings = Settings(_env_file=None)

    assert settings.llm_max_completion_tokens == 50_000


def test_parse_llm_response_rejects_truncated_completion() -> None:
    with pytest.raises(HTTPException) as exc_info:
        procedure_llm_extractor._parse_llm_response(
            {
                "choices": [
                    {
                        "finish_reason": "length",
                        "message": {
                            "content": (
                                '{"is_experimental_procedure": true, '
                                '"rejection_reason": null, "reagents": []}'
                            ),
                        },
                    }
                ]
            }
        )

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "LLM response was truncated"
    assert exc_info.value.headers == {
        API_ERROR_CODE_HEADER: ApiErrorCode.LLM_RESPONSE_TRUNCATED,
    }


def test_extract_reagents_with_llm_retries_after_invalid_json(monkeypatch) -> None:
    request = httpx.Request("POST", "https://mimo.example/v1/chat/completions")
    responses = [
        httpx.Response(
            200,
            json={
                "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
                "choices": [{"finish_reason": "stop", "message": {"content": "not json"}}],
            },
            request=request,
        ),
        httpx.Response(
            200,
            json={
                "usage": {"input_tokens": 11, "output_tokens": 3, "total_tokens": 14},
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": (
                                '{"is_experimental_procedure": true, '
                                '"rejection_reason": null, '
                                '"reagents": [{"name": "sodium chloride", '
                                '"chinese_name": null, "pubchem_query_name": "sodium chloride", '
                                '"is_mixture": false, "equivalent": null}]}'
                            )
                        },
                    }
                ]
            },
            request=request,
        ),
    ]
    posted_payloads: list[dict] = []
    recorded_attempts: list[tuple[int, int | None, int | None]] = []

    class FakeClient:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def post(self, _url, *, headers, json):
            posted_payloads.append(json)
            return responses.pop(0)

    monkeypatch.setattr(procedure_llm_extractor.httpx, "Client", FakeClient)
    monkeypatch.setattr(procedure_llm_extractor.settings, "llm_api_base_url", "https://mimo.example/v1")
    monkeypatch.setattr(procedure_llm_extractor.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(procedure_llm_extractor.settings, "llm_model", "mimo-v2.5-pro")
    monkeypatch.setattr(procedure_llm_extractor.settings, "llm_parse_retry_count", 1, raising=False)
    monkeypatch.setattr(
        procedure_llm_extractor.settings,
        "llm_response_format",
        "json_object",
        raising=False,
    )

    def record_usage(payload: dict, attempt: int) -> None:
        usage = parse_llm_token_usage(payload)
        recorded_attempts.append((attempt, usage.input_tokens, usage.output_tokens))

    result = procedure_llm_extractor.extract_reagents_with_llm('Add sodium chloride.', record_usage=record_usage)

    assert len(posted_payloads) == 2
    assert [(1, 10, 2), (2, 11, 3)] == recorded_attempts
    assert result.reagents[0].name == "sodium chloride"


def test_parse_llm_token_usage_preserves_zero_counts() -> None:
    usage = parse_llm_token_usage(
        {"usage": {"input_tokens": 0, "output_tokens": 3, "total_tokens": 3}}
    )

    assert 0 == usage.input_tokens
    assert 3 == usage.output_tokens
    assert 3 == usage.total_tokens


def test_llm_extracts_semantic_equivalent_in_the_same_request(monkeypatch):
    text = 'Triethylamine was added. The amount of this base was one and a half equivalents.'
    evidence = 'The amount of this base was one and a half equivalents.'
    posted = []
    def respond(_url, _headers, payload):
        posted.append(payload)
        return {"choices": [{"message": {"content": json.dumps({
            "is_experimental_procedure": True,
            "reagents": [{
                "name": "triethylamine", "chinese_name": "三乙胺", "pubchem_query_name": "triethylamine", "is_mixture": False,
                "equivalent": {"value": 1.5, "evidence": evidence, "confidence": "high"},
            }],
        })}}]}
    monkeypatch.setattr(procedure_llm_extractor, "_post_llm_request", respond)
    result = procedure_llm_extractor.extract_reagents_with_llm(text)
    assert len(posted) == 1
    assert result.reagents[0].equivalent == 1.5
    assert result.reagents[0].equivalent_evidence == evidence
    assert '按语义和指代关联' in posted[0]["messages"][0]["content"]
    fields = procedure_llm_extractor.PROCEDURE_REAGENT_RESPONSE_SCHEMA["properties"]["reagents"]["items"]
    assert fields['properties']['equivalent']['required'] == ['value', 'evidence', 'confidence']


@pytest.mark.parametrize("value", [None, -1, 0, True, float("nan"), float("inf"), "2 eq", "1-2", [2]])
def test_bad_llm_equivalent_does_not_discard_the_reagent(value):
    reagent = ProcedureLLMReagent(
        name="triethylamine", equivalent=value,
        equivalent_evidence="triethylamine (2 eq)", equivalent_confidence="high",
    )
    assert reagent.name == "triethylamine"
    assert reagent.equivalent is None
    assert reagent.equivalent_evidence is None


@pytest.mark.parametrize(("confidence", "evidence"), [
    ("medium", "triethylamine (2 eq)"), ("low", "triethylamine (2 eq)"),
    ("high", None), ("high", "   "),
])
def test_uncertain_or_unsupported_llm_equivalent_remains_blank(confidence, evidence):
    reagent = ProcedureLLMReagent(
        name="triethylamine", equivalent=2,
        equivalent_evidence=evidence, equivalent_confidence=confidence,
    )
    assert reagent.equivalent is None
    assert reagent.equivalent_evidence is None


def test_nonexistent_llm_quotation_is_not_used(monkeypatch):
    monkeypatch.setattr(procedure_llm_extractor, "_post_llm_request", lambda *_: {
        "choices": [{"message": {"content": json.dumps({
            "is_experimental_procedure": True,
            "reagents": [{
                "name": "triethylamine", "chinese_name": None, "pubchem_query_name": "triethylamine", "is_mixture": False,
                "equivalent": {"value": 2, "evidence": "triethylamine (2 eq)", "confidence": "high"},
            }],
        })}}],
    })
    result = procedure_llm_extractor.extract_reagents_with_llm('Add triethylamine (1 mL).')
    assert result.reagents[0].equivalent is None


def test_llm_equivalent_survives_resolved_unresolved_common_and_generic_analysis():
    evidence = 'triethylamine (1.5 eq)'
    reagent = ProcedureLLMReagent(
        name="triethylamine", equivalent=1.5, equivalent_evidence=evidence,
        equivalent_confidence="high",
    )
    resolved = ProcedureResolvedReagent(name="triethylamine", cas_number="121-44-8")
    unresolved = ProcedureUnresolvedReagent(name="triethylamine", reason="not found")
    for resolved_items, unresolved_items, common_cas, expected_status in [
        ([resolved], [], set(), 'resolved'), ([], [unresolved], set(), 'unresolved'),
        ([resolved], [], {'121-44-8'}, 'common'),
    ]:
        item = build_analysis_items([reagent], resolved_items, unresolved_items, common_cas)[0]
        assert item.status == expected_status
        assert item.equivalent == 1.5
        assert item.equivalent_evidence == evidence
    generic = reagent.model_copy(update={"name": "substrate", "is_specific": False, "pubchem_query_name": None})
    item = build_skipped_analysis_items([generic])[0]
    assert item.status == "generic"
    assert item.equivalent == 1.5


def test_duplicate_llm_aliases_with_conflicting_equivalents_are_cleared():
    result = ProcedureLLMExtraction.model_validate({
        "is_experimental_procedure": True,
        "reagents": [{
            "name": name, "pubchem_query_name": "triethylamine", "equivalent": value,
            "equivalent_evidence": f"{name} ({value} eq)", "equivalent_confidence": "high",
        } for name, value in [("Et3N", 1), ("triethylamine", 2)]],
    })
    assert all(reagent.equivalent is None for reagent in result.reagents)


def test_old_llm_response_stays_compatible_without_defaulting_to_one_equivalent():
    reagent = ProcedureLLMReagent(name="triethylamine")
    assert reagent.equivalent is None
    assert reagent.equivalent_evidence is None


def test_numbered_and_generic_materials_are_retained_without_searching_or_merging():
    labels = ["compound 3", "compound 4", "intermediate A", "3-a", "3a", "3A", "substrate"]
    extraction = ProcedureLLMExtraction(
        is_experimental_procedure=True,
        reagents=[ProcedureLLMReagent(
            name=name, chinese_name="未确定物料", is_specific=False,
            pubchem_query_name="compound",
            equivalent=index + 1, equivalent_evidence=f"{name} ({index + 1} eq)",
            equivalent_confidence="high",
        ) for index, name in enumerate(labels)],
    )
    assert procedure_llm_extractor.filter_extracted_reagents(extraction.reagents) == []
    for items in [
        build_skipped_analysis_items(extraction.reagents),
        build_analysis_items(extraction.reagents, [], []),
    ]:
        assert [item.name for item in items] == labels
        assert all(item.status == "generic" and item.pubchem_query_name is None for item in items)
        assert [item.equivalent for item in items] == list(range(1, len(labels) + 1))


def test_llm_schema_and_prompt_require_numbered_and_generic_materials():
    fields = procedure_llm_extractor.PROCEDURE_REAGENT_RESPONSE_SCHEMA["properties"]["reagents"]["items"]
    assert 'is_specific' not in fields['properties']
    assert fields['properties']['pubchem_query_name']['type'] == ['string', 'null']
    prompt = procedure_llm_extractor._build_system_prompt()
    assert '泛指及编号项独立保留' in prompt
    assert '按实验室惯例选标准主体成分或主溶质' in prompt


def test_every_specific_identity_is_eligible_even_for_common_material_names():
    known = ProcedureLLMReagent(name='substrate', pubchem_query_name='a known specific identity')
    common = ProcedureLLMReagent(name='EtOH', pubchem_query_name='ethanol')
    generic = ProcedureLLMReagent(name='1a', is_specific=False)
    mixture = ProcedureLLMReagent(name='unknown mixture', is_specific=False, is_mixture=True)
    assert procedure_llm_extractor.filter_extracted_reagents([known, common, generic, mixture]) == [known, common]
    assert [item.name for item in build_skipped_analysis_items([known, common, generic, mixture])] == ['1a', 'unknown mixture']
    prompt = procedure_llm_extractor._build_system_prompt()
    assert '先用化学常识解释原名' in prompt
    assert 'brine' not in prompt
    assert '把缩写、俗称和习惯命名的材料展开' in prompt


def test_solution_and_pure_component_equivalents_are_independent():
    result = ProcedureLLMExtraction(is_experimental_procedure=True, reagents=[
        ProcedureLLMReagent(
            name=name, pubchem_query_name='a defined component', is_mixture=mixture,
            equivalent=value, equivalent_evidence=f'{name} ({value} eq)', equivalent_confidence='high',
        ) for name, mixture, value in [('a solution', True, 1), ('a defined component', False, 2)]
    ])
    assert [item.equivalent for item in result.reagents] == [1, 2]


@pytest.mark.parametrize('reagents', [['ethanol'], [{'chemical_name': 'ethanol'}], [{
    'name': 'ethanol', 'chinese_name': None, 'pubchem_query_name': 'ethanol', 'is_mixture': False,
    'equivalent': None, 'confidence': .9,
}]])
def test_nonstandard_llm_fields_are_rejected_instead_of_guessed(reagents):
    with pytest.raises(HTTPException) as error:
        procedure_llm_extractor._parse_llm_response({'choices': [{'message': {'content': json.dumps({
            'is_experimental_procedure': True, 'reagents': reagents,
        })}}]})
    assert error.value.headers[API_ERROR_CODE_HEADER] == ApiErrorCode.LLM_INVALID_JSON


def test_name_normalization_keeps_structural_punctuation_and_the_output_count_is_validated():
    reagents = [ProcedureLLMReagent(name=name) for name in ['identity-a', 'identity a']]
    assert procedure_llm_extractor.filter_extracted_reagents(reagents) == reagents
    with pytest.raises(ValueError):
        ProcedureLLMExtraction(is_experimental_procedure=True, reagents=reagents * 26)


@pytest.mark.parametrize('value', ['1.5', True, -1, 0, float('nan')])
def test_compact_output_keeps_materials_when_equivalent_values_are_invalid(value):
    result = procedure_llm_extractor._parse_llm_response({'choices': [{'message': {'content': json.dumps({
        'is_experimental_procedure': True, 'reagents': [{
            'name': 'a solution', 'chinese_name': None, 'pubchem_query_name': 'a known component', 'is_mixture': True,
            'equivalent': {'value': value, 'evidence': 'a solution (1.5 eq)', 'confidence': 'high'},
        }, {
            'name': 'unknown code', 'chinese_name': None, 'pubchem_query_name': None, 'is_mixture': False, 'equivalent': None,
        }],
    })}}]})
    assert result.reagents[0].is_specific is True
    assert result.reagents[0].is_mixture is True
    assert result.reagents[0].equivalent is None
    assert result.reagents[1].is_specific is False
