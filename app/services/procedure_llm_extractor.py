"""LLM reagent extraction for pasted experimental procedures."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlmodel import Session, select

from app.core.config import (
    LLM_RESPONSE_FORMAT_JSON_OBJECT,
    LLM_RESPONSE_FORMAT_JSON_SCHEMA,
    LLM_RESPONSE_FORMAT_TEXT,
    settings,
)
from app.models.chemical_name_map import ChemicalNameMap
from app.services.procedure_inventory_models import ProcedureLLMExtraction, ProcedureLLMReagent

logger = logging.getLogger(__name__)
COMMON_NAME_JOINER = "; "
PROCEDURE_REAGENT_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["is_experimental_procedure", "rejection_reason", "reagents"],
    "properties": {
        "is_experimental_procedure": {"type": "boolean"},
        "rejection_reason": {"type": ["string", "null"]},
        "reagents": {
            "type": "array",
            "maxItems": 50,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "name",
                    "pubchem_query_name",
                    "should_query_pubchem",
                    "evidence",
                    "confidence",
                ],
                "properties": {
                    "name": {"type": "string", "minLength": 1, "maxLength": 200},
                    "pubchem_query_name": {"type": ["string", "null"], "maxLength": 200},
                    "should_query_pubchem": {"type": "boolean"},
                    "evidence": {"type": ["string", "null"], "maxLength": 300},
                    "confidence": {
                        "type": "string",
                        "enum": ["high", "medium", "low"],
                    },
                },
            },
        },
    },
}
COMMON_REAGENT_NAMES = (
    "water", "h2o", "brine", "ice", "silica", "silica gel",
    "celite", "thf", "tetrahydrofuran", "ether", "diethyl ether", "et2o", "pentane",
    "hexane", "hexanes", "petroleum ether", "dcm", "dichloromethane", "chloroform", "methanol",
    "meoh", "ethanol", "etoh", "acetonitrile", "mecn", "ethyl acetate", "etoac",
    "acetone", "dmf", "dmso", "toluene", "benzene", "1,4-dioxane", "dioxane",
    "nh4cl", "ammonium chloride", "nacl", "sodium chloride", "na2so4",
    "sodium sulfate", "mgso4", "magnesium sulfate", "caco3", "calcium carbonate",
    "nahco3", "sodium bicarbonate", "na2co3", "sodium carbonate", "na2s2o3",
    "sodium thiosulfate", "hcl", "hydrochloric acid", "naoh", "sodium hydroxide",
    "koh", "potassium hydroxide",
)
GENERIC_REAGENT_NAMES = (
    "alkyl bromide", "alkyl halide", "aryl bromide", "aryl iodide", "aryl chloride",
    "aryl halide", "substrate", "product", "corresponding compound", "target compound",
    "starting material", "crude residue", "residue", "organic phase", "aqueous phase",
    "alkyl", "alkenyl", "alkynyl", "aryl", "heteroaryl", "halo", "halogen", "halide",
)


def load_common_names(db: Session) -> list[str]:
    rows = db.exec(select(ChemicalNameMap)).all()
    names: list[str] = list(COMMON_REAGENT_NAMES)
    for row in rows:
        names.extend(
            value for value in (
                row.name, row.english_name, row.alias_1, row.alias_2, row.alias_3
            ) if value
        )
    return dedupe_text(names)


def extract_reagents_with_llm(text: str, common_names: list[str]) -> ProcedureLLMExtraction:
    payload = _build_llm_payload(text, common_names)
    headers = {"Authorization": f"Bearer {settings.llm_api_key}", "Content-Type": "application/json"}
    url = f"{settings.llm_api_base_url.rstrip('/')}/chat/completions"
    retry_count = settings.llm_parse_retry_count
    for attempt in range(retry_count + 1):
        response_payload = _post_llm_request(url, headers, payload)
        try:
            return _parse_llm_response(response_payload)
        except HTTPException as exc:
            if attempt >= retry_count or not _is_retryable_parse_error(exc):
                raise
            logger.warning(
                "procedure_llm_parse_retry attempt=%s max_retries=%s detail=%s",
                attempt + 1,
                retry_count,
                exc.detail,
            )
    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="LLM 响应不是有效 JSON")


def _post_llm_request(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            response_payload = response.json()
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="LLM 请求超时") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="LLM 请求失败") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="LLM 响应格式错误") from exc
    return response_payload


def _is_retryable_parse_error(exc: HTTPException) -> bool:
    return exc.status_code == status.HTTP_502_BAD_GATEWAY


def filter_extracted_reagents(
    reagents: list[ProcedureLLMReagent],
    common_names: list[str],
) -> list[ProcedureLLMReagent]:
    common_set = {normalize_name_for_compare(name) for name in common_names}
    seen: set[str] = set()
    result: list[ProcedureLLMReagent] = []
    for reagent in reagents:
        normalized_name = normalize_name_for_compare(reagent.name)
        normalized_query = normalize_name_for_compare(reagent.pubchem_query_name or reagent.name)
        if (
            not normalized_name
            or is_llm_marked_generic(reagent)
            or normalized_name in common_set
            or normalized_query in common_set
            or is_generic_reagent_name(normalized_name)
            or is_generic_reagent_name(normalized_query)
            or normalized_query in seen
        ):
            continue
        seen.add(normalized_query)
        result.append(reagent)
    return result[:50]


def is_common_reagent_name(name: str, common_names: list[str]) -> bool:
    return normalize_name_for_compare(name) in {
        normalize_name_for_compare(common_name) for common_name in common_names
    }


def is_llm_marked_generic(reagent: ProcedureLLMReagent) -> bool:
    return not reagent.should_query_pubchem and reagent.pubchem_query_name is None


def dedupe_text(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        stripped = value.strip()
        key = normalize_name_for_compare(stripped)
        if stripped and key not in seen:
            result.append(stripped)
            seen.add(key)
    return result


def normalize_name_for_compare(value: str) -> str:
    return re.sub(r"[\s_\-·.,;:()（）\[\]【】]+", "", value.strip().lower())


def is_generic_reagent_name(normalized_name: str) -> bool:
    return normalized_name in GENERIC_REAGENT_NAME_SET


GENERIC_REAGENT_NAME_SET = frozenset(
    normalize_name_for_compare(name) for name in GENERIC_REAGENT_NAMES
)


def _build_llm_payload(text: str, common_names: list[str]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "temperature": settings.llm_temperature,
        "max_completion_tokens": settings.llm_max_completion_tokens,
        "response_format": _build_llm_response_format(),
        "messages": [
            {"role": "system", "content": _build_system_prompt(common_names)},
            {"role": "user", "content": text},
        ],
    }
    thinking_type = settings.llm_thinking_type.strip()
    if thinking_type:
        payload["thinking"] = {"type": thinking_type}
    return payload


def _build_llm_response_format() -> dict[str, Any]:
    response_format = settings.llm_response_format
    if response_format == LLM_RESPONSE_FORMAT_JSON_SCHEMA:
        return {
            "type": LLM_RESPONSE_FORMAT_JSON_SCHEMA,
            "json_schema": {
                "name": "procedure_reagent_extraction",
                "strict": True,
                "schema": PROCEDURE_REAGENT_RESPONSE_SCHEMA,
            },
        }
    if response_format == LLM_RESPONSE_FORMAT_JSON_OBJECT:
        return {"type": LLM_RESPONSE_FORMAT_JSON_OBJECT}
    if response_format == LLM_RESPONSE_FORMAT_TEXT:
        return {"type": LLM_RESPONSE_FORMAT_TEXT}
    raise HTTPException(status_code=500, detail="LLM 响应格式配置错误")


def _build_system_prompt(common_names: list[str]) -> str:
    common_context = COMMON_NAME_JOINER.join(common_names)
    return f"""You are a chemistry procedure reagent extraction engine.

Task:
1. Decide whether the user's text is a chemistry experimental procedure, reaction operation, or synthesis procedure.
2. If the text is completely unrelated to experimental procedures, return is_experimental_procedure=false and a short rejection_reason.
3. If it is relevant, extract explicit chemical reagent names from the text for analysis.

Must include:
- Specific substrates, strong reaction reagents, catalysts, ligands, oxidants, reductants, and organometallic reagents.
- Common solvents, extraction solvents, drying agents, quench reagents, washing solutions, chromatography materials, ordinary inorganic salts, and water when they are explicitly named in the text.
- chemical_name_map common names and their semantic equivalents, English names, abbreviations, or aliases when they are explicitly named in the text.

Extraction rules:
- Keep name as the display name from the text. If an abbreviation or alias has an unambiguous
  common PubChem lookup name, set pubchem_query_name to that canonical lookup name.
- If no unambiguous canonical lookup name is known, set pubchem_query_name to the same value as name.
- Do not output CAS numbers. Output names only.
- Output at most 50 names, preserving first appearance order in the text.
- Ignore parenthetical solvent/concentration descriptions and keep only the true reagent name when applicable.
- Do not output concentration, equivalent, volume, mass, temperature, time, or solvent descriptors as separate names.
- Do not output adjectives or solution-state descriptors as reagent names, such as aqueous, aq., sat. aq., saturated aqueous, anhydrous, dry, crude, combined organic phases, or filtrate.
- Generic classes or placeholders, such as alkyl, alkenyl, alkynyl, aryl, heteroaryl, halo, halogen, halide, alkyl bromide, aryl halide, substrate, product, corresponding compound, or target compound, may be included only if they are explicitly present; keep them as generic text and set should_query_pubchem=false.

JSON output rules:
- Return exactly one JSON object.
- Return valid JSON only, without markdown fences, comments, or explanation text.
- Use exactly these top-level keys: is_experimental_procedure, rejection_reason, reagents.
- Do not use alternative keys such as reagent_names, chemicals, compounds, or items.
- Each reagents item must use exactly these keys: name, pubchem_query_name, should_query_pubchem, evidence, confidence.
- Set rejection_reason to null when is_experimental_procedure is true.
- Set evidence to a short source phrase or null.
- Set should_query_pubchem=true only for specific substances that can reasonably resolve to a unique PubChem compound/CAS.
- Set should_query_pubchem=false for common reagents/solvents/salts and for generic classes/placeholders.
- For generic classes/placeholders, set pubchem_query_name=null because they must not be queried in PubChem.

Common-name exclusion context:
{common_context}

Example JSON object:
{{
  "is_experimental_procedure": true,
  "rejection_reason": null,
  "reagents": [
    {{
      "name": "triethylamine",
      "pubchem_query_name": "triethylamine",
      "should_query_pubchem": true,
      "evidence": "triethylamine was added",
      "confidence": "high"
    }}
  ]
}}

Return data according to the provided JSON schema.
"""


def _parse_llm_response(payload: dict[str, Any]) -> ProcedureLLMExtraction:
    choices = payload.get("choices")
    choice = choices[0] if isinstance(choices, list) and choices else {}
    if not isinstance(choice, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="LLM 响应格式错误")
    if choice.get("finish_reason") == "length":
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="LLM 响应被截断")
    content = choice.get("message", {}).get("content")
    if not isinstance(content, str):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="LLM 响应格式错误")
    try:
        raw_payload = json.loads(_extract_json_object(content))
        return ProcedureLLMExtraction.model_validate(_normalize_llm_response_payload(raw_payload))
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="LLM 响应不是有效 JSON") from exc


def _extract_json_object(content: str) -> str:
    stripped = content.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        return stripped
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("missing json object")
    return stripped[start:end + 1]


def _normalize_llm_response_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("llm response root must be object")
    normalized = dict(payload)
    normalized.setdefault("rejection_reason", None)
    reagents = normalized.get("reagents")
    if not isinstance(reagents, list) and isinstance(normalized.get("reagent_names"), list):
        reagents = normalized["reagent_names"]
    normalized["reagents"] = [_normalize_llm_reagent(item) for item in reagents or []]
    return normalized


def _normalize_llm_reagent(item: Any) -> dict[str, Any]:
    if isinstance(item, str):
        return {
            "name": item,
            "pubchem_query_name": item,
            "should_query_pubchem": True,
            "evidence": None,
            "confidence": "medium",
        }
    if not isinstance(item, dict):
        raise ValueError("llm reagent item must be object or string")
    normalized = dict(item)
    name = normalized.get("name") or normalized.get("chemical_name") or normalized.get("reagent_name")
    normalized["name"] = name
    normalized.setdefault("pubchem_query_name", name)
    normalized.setdefault("should_query_pubchem", True)
    normalized.setdefault("evidence", None)
    normalized["confidence"] = _normalize_confidence(normalized.get("confidence"))
    return normalized


def _normalize_confidence(value: Any) -> str:
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized if normalized in {"high", "medium", "low"} else "medium"
    if isinstance(value, int | float):
        if value >= 0.8:
            return "high"
        if value >= 0.5:
            return "medium"
        return "low"
    return "medium"
