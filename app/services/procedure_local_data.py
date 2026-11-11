"""Exact local reagent identifiers shared by procedure lookup and reports."""
from __future__ import annotations

import re

from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.models.chemical_name_map import ChemicalNameMap
from app.models.compound_structure import CompoundStructureCache
from app.models.inventory import Inventory
from app.services.cas_utils import is_valid_cas


def chinese_name(*values: str | None) -> str | None:
    return next((value.strip() for value in values
                 if value and re.search(r"[\u3400-\u9fff]", value)), None)


def local_name_cas_numbers(db: Session, names: list[str]) -> dict[str, list[str]]:
    keys = {name.strip().lower() for name in names if name.strip()}
    matches: dict[str, list[str]] = {key: [] for key in keys}
    if not keys:
        return {}
    sources = (
        (ChemicalNameMap, ("name", "english_name", "alias_1", "alias_2", "alias_3")),
        (CompoundStructureCache, ("chinese_name", "english_name")),
        (Inventory, ("name",)),
    )
    for model, fields in sources:
        rows = db.exec(select(model).where(or_(
            *(func.lower(func.trim(getattr(model, field))).in_(keys) for field in fields)
        ))).all()
        for row in rows:
            cas = (row.cas_number or "").strip()
            if not is_valid_cas(cas):
                continue
            for field in fields:
                key = (getattr(row, field) or "").strip().lower()
                if key in matches and cas not in matches[key]:
                    matches[key].append(cas)
    return {name: matches.get(name.strip().lower(), []) for name in names}


def local_chinese_names(db: Session, cas_numbers: list[str]) -> dict[str, str]:
    names: dict[str, str] = {}
    if not cas_numbers:
        return names
    for model, fields in (
        (ChemicalNameMap, ("name", "alias_1", "alias_2", "alias_3")),
        (CompoundStructureCache, ("chinese_name",)),
        (Inventory, ("name",)),
    ):
        rows = db.exec(select(model).where(model.cas_number.in_(cas_numbers))).all()
        for row in rows:
            name = chinese_name(*(getattr(row, field) for field in fields))
            if name:
                names.setdefault(row.cas_number, name)
    return names
