import pytest
from fastapi import HTTPException
import httpx

from app.core.api_errors import API_ERROR_CODE_HEADER, ApiErrorCode
from app.core.config import Settings
from app.services import procedure_llm_extractor
from app.services.llm_usage_logger import parse_llm_token_usage


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

    payload = procedure_llm_extractor._build_llm_payload("Add sodium chloride.", [])

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

    payload = procedure_llm_extractor._build_llm_payload("Add sodium chloride.", [])

    assert payload["response_format"]["type"] == "json_schema"
    assert payload["response_format"]["json_schema"]["strict"] is True
    assert payload["response_format"]["json_schema"]["schema"] is (
        procedure_llm_extractor.PROCEDURE_REAGENT_RESPONSE_SCHEMA
    )
    assert "thinking" not in payload


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
                                '"pubchem_query_name": "sodium chloride", '
                                '"should_query_pubchem": true, '
                                '"evidence": "sodium chloride was added", '
                                '"confidence": "high"}]}'
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

    result = procedure_llm_extractor.extract_reagents_with_llm(
        "Add sodium chloride.",
        [],
        record_usage=record_usage,
    )

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
