"""Calculate molar masses from definite molecular formulae using RDKit atomic weights."""
from __future__ import annotations

import re

from rdkit import Chem

_TABLE = Chem.GetPeriodicTable()
_WEIGHTS = {_TABLE.GetElementSymbol(n): _TABLE.GetAtomicWeight(n) for n in range(1, 119)}
_WEIGHTS["D"] = _TABLE.GetMassForIsotope("H", 2)
_WEIGHTS["T"] = _TABLE.GetMassForIsotope("H", 3)
_TOKEN = re.compile(r"[A-Z][a-z]?|[0-9]+|[()\[\]]")
_SUBSCRIPTS = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")


def calculate_molar_mass(formula: str | None) -> float | None:
    """Support element counts, nested groups and hydrates; never partially parse a formula.

    Charged, variable-composition and isotope-labelled formulae are left unconfirmed
    rather than interpreting a charge or isotope number as an atom count.
    """
    if not formula or len(formula) > 200:
        return None
    normalized = re.sub(r"\s+", "", formula.translate(_SUBSCRIPTS)).replace("·", ".")
    try:
        mass = sum(_component_mass(part) for part in normalized.split("."))
    except ValueError:
        return None
    return round(mass, 4) if 0 < mass < 1_000_000 else None


def _count(tokens: list[str], index: int) -> tuple[int, int]:
    if index < len(tokens) and tokens[index].isdigit():
        count = int(tokens[index])
        if not 0 < count <= 100_000:
            raise ValueError("Invalid count")
        return count, index + 1
    return 1, index


def _component_mass(component: str) -> float:
    tokens = _TOKEN.findall(component)
    if not tokens or "".join(tokens) != component:
        raise ValueError("Unsupported formula")
    multiplier, index = _count(tokens, 0)
    mass, end = _group_mass(tokens, index)
    if end != len(tokens):
        raise ValueError("Unexpected closing group")
    return multiplier * mass


def _group_mass(tokens: list[str], index: int, closing: str = "", depth: int = 0) -> tuple[float, int]:
    if depth > 10:
        raise ValueError("Formula too deeply nested")
    mass = 0.0
    terms = 0
    while index < len(tokens) and tokens[index] not in {")", "]"}:
        token = tokens[index]
        index += 1
        if token in {"(", "["}:
            weight, index = _group_mass(tokens, index, ")" if token == "(" else "]", depth + 1)
        elif token in _WEIGHTS:
            weight = _WEIGHTS[token]
        else:
            raise ValueError("Unknown element or isotope label")
        count, index = _count(tokens, index)
        mass += weight * count
        terms += 1
    if not terms:
        raise ValueError("Empty group")
    if closing:
        if index >= len(tokens) or tokens[index] != closing:
            raise ValueError("Unclosed group")
        index += 1
    return mass, index
