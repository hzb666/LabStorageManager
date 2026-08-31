"""Return quantity parsing and unit conversion for WeCom robot confirmations."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Any

from app.services.spec_utils import UNIT_CANONICAL

UNIT_ALIASES = {
    "毫升": "mL",
    "升": "L",
    "克": "g",
    "毫克": "mg",
    "千克": "kg",
    "公斤": "kg",
}
for _raw_unit, _canonical_unit in UNIT_CANONICAL.items():
    UNIT_ALIASES[_raw_unit.casefold()] = _canonical_unit
    UNIT_ALIASES[_canonical_unit.casefold()] = _canonical_unit

UNIT_FACTORS = {
    "mL": ("volume", 1.0),
    "L": ("volume", 1000.0),
    "mg": ("mass", 0.001),
    "g": ("mass", 1.0),
    "kg": ("mass", 1000.0),
}


@dataclass(frozen=True)
class ReturnQuantityInput:
    mode: str
    value: float
    unit: str
    llm_converted_value: float | None = None


def resolve_return_quantity_arguments(
    arguments: dict[str, Any],
    candidate: dict[str, Any],
    *,
    llm_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    target_unit = normalize_unit(candidate.get("unit"))
    current_remaining = _read_float(candidate.get("remaining_quantity"))
    initial_quantity = _read_float(candidate.get("initial_quantity"))
    quantity_input = _read_llm_input(arguments, llm_result, target_unit)
    if quantity_input is None:
        quantity_input = _read_argument_input(arguments)

    source_unit = quantity_input.unit or target_unit
    converted_quantity = _convert_quantity(quantity_input.value, source_unit, target_unit)
    if quantity_input.llm_converted_value is not None:
        converted_quantity = _validated_llm_quantity(
            quantity_input.llm_converted_value,
            converted_quantity,
        )

    remaining_quantity = _remaining_quantity(
        mode=quantity_input.mode,
        converted_quantity=converted_quantity,
        current_remaining=current_remaining,
    )
    _validate_remaining_quantity(remaining_quantity, initial_quantity)
    return {
        "remaining_quantity": _clean_number(remaining_quantity),
        "quantity_summary": _summary_text(
            quantity_input,
            converted_quantity,
            remaining_quantity,
            target_unit,
        ),
    }


def normalize_unit(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return UNIT_ALIASES.get(raw.casefold(), raw)


def _read_argument_input(arguments: dict[str, Any]) -> ReturnQuantityInput:
    mode = str(arguments.get("quantity_mode") or "").strip()
    value = _read_float(arguments.get("quantity_value"))
    if mode in {"used", "remaining"} and value is not None:
        return ReturnQuantityInput(mode=mode, value=value, unit=normalize_unit(arguments.get("quantity_unit")))
    if _read_float(arguments.get("used_quantity")) is not None:
        return ReturnQuantityInput(mode="used", value=float(arguments["used_quantity"]), unit="")
    if _read_float(arguments.get("remaining_quantity")) is not None:
        return ReturnQuantityInput(
            mode="remaining",
            value=float(arguments["remaining_quantity"]),
            unit="",
        )
    raise ValueError("归还需要说明用量、剩余量或归还量，例如：归还乙醇 用量20mL。")


def _read_llm_input(
    arguments: dict[str, Any],
    llm_result: dict[str, Any] | None,
    target_unit: str,
) -> ReturnQuantityInput | None:
    if not isinstance(llm_result, dict) or llm_result.get("ok") is not True:
        return None
    mode = str(llm_result.get("mode") or "").strip()
    raw_mode = str(arguments.get("quantity_mode") or "").strip()
    value = _read_float(llm_result.get("source_value"))
    if mode not in {"used", "remaining"} or value is None or (raw_mode and raw_mode != mode):
        return None
    llm_target_unit = normalize_unit(llm_result.get("target_unit"))
    if target_unit and llm_target_unit and llm_target_unit != target_unit:
        return None
    return ReturnQuantityInput(
        mode=mode,
        value=value,
        unit=normalize_unit(llm_result.get("source_unit")),
        llm_converted_value=_read_float(llm_result.get("converted_value")),
    )


def _convert_quantity(value: float, source_unit: str, target_unit: str) -> float:
    if value < 0 or not isfinite(value):
        raise ValueError("归还数量必须是非负数字。")
    if not source_unit and not target_unit:
        return value
    if not target_unit:
        raise ValueError("这条库存没有单位，无法进行单位换算，请到网页端补全单位后再归还。")
    if not source_unit:
        source_unit = target_unit
    if source_unit == target_unit:
        return value
    source_dimension, source_factor = _unit_factor(source_unit, target_unit)
    target_dimension, target_factor = _unit_factor(target_unit, target_unit)
    if source_dimension != target_dimension:
        raise ValueError(f"这条库存单位是 {target_unit}，不能用 {source_unit} 表示归还数量。")
    return value * source_factor / target_factor


def _unit_factor(unit: str, target_unit: str) -> tuple[str, float]:
    if unit in UNIT_FACTORS:
        return UNIT_FACTORS[unit]
    if unit in UNIT_CANONICAL.values():
        return (unit, 1.0)
    raise ValueError(f"不支持“{unit}”这个单位，请按库存单位 {target_unit} 输入。")


def _remaining_quantity(
    *,
    mode: str,
    converted_quantity: float,
    current_remaining: float | None,
) -> float:
    if mode == "remaining":
        return converted_quantity
    if current_remaining is None:
        raise ValueError("无法读取当前剩余量，不能根据用量计算归还后的剩余量。")
    if converted_quantity > current_remaining:
        raise ValueError(
            f"用量 {_format_quantity(converted_quantity, '')} 大于当前剩余量 "
            f"{_format_quantity(current_remaining, '')}。"
        )
    return current_remaining - converted_quantity


def _validate_remaining_quantity(remaining_quantity: float, initial_quantity: float | None) -> None:
    if remaining_quantity < 0 or not isfinite(remaining_quantity):
        raise ValueError("归还后的剩余量必须大于或等于 0。")
    if initial_quantity is not None and remaining_quantity > initial_quantity:
        raise ValueError(
            f"归还后的剩余量 {_format_quantity(remaining_quantity, '')} "
            f"不能超过初始量 {_format_quantity(initial_quantity, '')}。"
        )


def _validated_llm_quantity(llm_value: float, expected_value: float) -> float:
    if llm_value < 0 or not isfinite(llm_value):
        return expected_value
    tolerance = max(1e-9, abs(expected_value) * 1e-6)
    return llm_value if abs(llm_value - expected_value) <= tolerance else expected_value


def _summary_text(
    quantity_input: ReturnQuantityInput,
    converted_quantity: float,
    remaining_quantity: float,
    target_unit: str,
) -> str:
    source_text = _format_quantity(quantity_input.value, quantity_input.unit or target_unit)
    converted_text = _format_quantity(converted_quantity, target_unit)
    remaining_text = _format_quantity(remaining_quantity, target_unit)
    converted_note = "" if source_text == converted_text else f"（已换算为 {converted_text}）"
    if quantity_input.mode == "used":
        return f"用量 {source_text}{converted_note}，归还后剩余 {remaining_text}"
    return f"归还后剩余 {source_text}{converted_note}"


def _format_quantity(value: float, unit: str) -> str:
    return f"{_clean_number(value):g}{unit}"


def _clean_number(value: float) -> float:
    cleaned = round(float(value), 10)
    return 0.0 if cleaned == -0.0 else cleaned


def _read_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) else None
