"""Persist non-sensitive LLM token usage for accounting and audit."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session

from app.models.llm_usage_log import LLMUsageLog

logger = logging.getLogger(__name__)

PROCEDURE_INVENTORY_FEATURE = "procedure_inventory_search"
OPENAI_COMPATIBLE_PROVIDER = "openai_compatible"


@dataclass(frozen=True)
class LLMTokenUsage:
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None


def _read_token_count(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _prefer_token_count(primary: int | None, fallback: int | None) -> int | None:
    return primary if primary is not None else fallback


def parse_llm_token_usage(payload: dict[str, Any]) -> LLMTokenUsage:
    """Parse both Chat Completions and Responses-style usage field names."""

    raw_usage = payload.get("usage")
    usage = raw_usage if isinstance(raw_usage, dict) else {}
    input_tokens = _read_token_count(usage.get("input_tokens"))
    output_tokens = _read_token_count(usage.get("output_tokens"))
    return LLMTokenUsage(
        input_tokens=_prefer_token_count(
            input_tokens,
            _read_token_count(usage.get("prompt_tokens")),
        ),
        output_tokens=_prefer_token_count(
            output_tokens,
            _read_token_count(usage.get("completion_tokens")),
        ),
        total_tokens=_read_token_count(usage.get("total_tokens")),
    )


def record_procedure_llm_usage(
    db: Session,
    *,
    user_id: int,
    model: str,
    attempt: int,
    response_payload: dict[str, Any],
) -> None:
    """Commit one provider response so parse retries are accounted separately."""

    usage = parse_llm_token_usage(response_payload)
    db.add(
        LLMUsageLog(
            user_id=user_id,
            feature=PROCEDURE_INVENTORY_FEATURE,
            provider=OPENAI_COMPATIBLE_PROVIDER,
            model=model,
            attempt=attempt,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            total_tokens=usage.total_tokens,
        )
    )
    db.commit()
    if usage.input_tokens is None or usage.output_tokens is None:
        logger.warning(
            "llm_usage_missing_tokens user_id=%s feature=%s model=%s attempt=%s",
            user_id,
            PROCEDURE_INVENTORY_FEATURE,
            model,
            attempt,
        )
