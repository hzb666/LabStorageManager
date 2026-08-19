"""Reusable helpers for inventory CAS structure and name backfill."""
from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session

from app.models.compound_structure import CompoundStructureCache, CompoundStructureStatus
from app.services.cas_utils import is_valid_cas
from app.services.chemical_info import query_chinese_name, query_english_name
from app.services.structure_cache_repo import (
    StructureNameCacheWrite,
    get_distinct_inventory_cas_numbers,
    get_structure_cache,
    upsert_structure_cache_names,
)

DEFAULT_RETRY_STATUSES = {
    CompoundStructureStatus.PENDING,
    CompoundStructureStatus.ERROR,
}


@dataclass(frozen=True)
class StructureBackfillTargetOptions:
    """Selection options for inventory CAS backfill targets."""

    limit: int | None
    only_status: set[CompoundStructureStatus] | None
    force: bool
    skip_manual: bool
    names_only: bool
    include_names: bool
    force_names: bool
    skip_chinese: bool


def parse_status_filter(raw_value: str | None) -> set[CompoundStructureStatus] | None:
    if not raw_value:
        return None
    statuses: set[CompoundStructureStatus] = set()
    for item in raw_value.split(","):
        value = item.strip()
        if value:
            statuses.add(CompoundStructureStatus(value))
    return statuses


def should_skip_cache_row(
    existing: CompoundStructureCache | None,
    *,
    force: bool,
    only_status: set[CompoundStructureStatus] | None,
    skip_manual: bool,
) -> bool:
    if existing is None:
        return False
    if skip_manual and existing.manually_verified:
        return True
    if only_status is not None and existing.status not in only_status:
        return True
    if force:
        return False
    if existing.status == CompoundStructureStatus.RESOLVED:
        return True
    return only_status is None and existing.status not in DEFAULT_RETRY_STATUSES


def should_backfill_names(
    existing: CompoundStructureCache | None,
    *,
    include_names: bool,
    force_names: bool,
    skip_manual: bool,
    skip_chinese: bool,
) -> bool:
    if not include_names:
        return False
    if existing and existing.manually_verified and skip_manual and force_names:
        return False
    if existing is None or force_names:
        return True
    if not existing.english_name and not existing.name_error_message:
        return True
    return not skip_chinese and not existing.chinese_name and not existing.name_error_message


def should_resolve_structure(
    existing: CompoundStructureCache | None,
    *,
    names_only: bool,
    force: bool,
    only_status: set[CompoundStructureStatus] | None,
    skip_manual: bool,
) -> bool:
    if names_only:
        return False
    return not should_skip_cache_row(
        existing,
        force=force,
        only_status=only_status,
        skip_manual=skip_manual,
    )


def select_backfill_targets(
    db: Session,
    *,
    options: StructureBackfillTargetOptions,
) -> list[str]:
    selected: list[str] = []
    for cas_number in get_distinct_inventory_cas_numbers(db):
        existing = get_structure_cache(db, cas_number)
        resolve_structure = should_resolve_structure(
            existing,
            names_only=options.names_only,
            force=options.force,
            only_status=options.only_status,
            skip_manual=options.skip_manual,
        )
        resolve_names = should_backfill_names(
            existing,
            include_names=options.include_names,
            force_names=options.force_names,
            skip_manual=options.skip_manual,
            skip_chinese=options.skip_chinese,
        )
        if not resolve_structure and not resolve_names:
            continue
        selected.append(cas_number)
        if options.limit is not None and len(selected) >= options.limit:
            break
    return selected


def resolve_missing_names(
    db: Session,
    cas_number: str,
    *,
    skip_chinese: bool,
    skip_manual: bool,
    force_names: bool,
) -> str:
    if not is_valid_cas(cas_number):
        return "skipped-invalid-cas"

    cache = get_structure_cache(db, cas_number)
    if not should_backfill_names(
        cache,
        include_names=True,
        force_names=force_names,
        skip_manual=skip_manual,
        skip_chinese=skip_chinese,
    ):
        return "skipped-cached"

    english_name = cache.english_name if cache else None
    warning_message = None
    if force_names or not english_name:
        english_name, warning_message = query_english_name(cas_number)

    chinese_name = cache.chinese_name if cache else None
    needs_chinese = not skip_chinese and (force_names or not chinese_name)
    if not skip_chinese and (force_names or not chinese_name):
        chinese_name = query_chinese_name(cas_number)

    if needs_chinese and not chinese_name and not warning_message:
        warning_message = "Chinese name not found"

    if not english_name and not chinese_name and not warning_message:
        return "not-found"

    upsert_structure_cache_names(
        db,
        StructureNameCacheWrite(
            cas_number=cas_number,
            english_name=english_name,
            chinese_name=chinese_name,
            chinese_name_is_translated=bool(cache and cache.chinese_name_is_translated),
            name_error_message=warning_message,
        ),
    )
    return "written"
