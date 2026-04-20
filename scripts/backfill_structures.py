"""Backfill compound structure cache from inventory CAS numbers."""
# ruff: noqa: E402
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from sqlmodel import Session

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.database import engine
from app.models.compound_structure import CompoundStructureCache, CompoundStructureStatus
from app.services.pubchem_resolver import PubChemResolver, create_pubchem_client
from app.services.structure_cache_repo import (
    count_structure_cache_by_status,
    get_distinct_inventory_cas_numbers,
    get_structure_cache,
    upsert_structure_cache,
    upsert_structure_cache_error,
)

DEFAULT_RETRY_STATUSES = {
    CompoundStructureStatus.PENDING,
    CompoundStructureStatus.ERROR,
    CompoundStructureStatus.NOT_FOUND,
}


def parse_status_filter(raw_value: str | None) -> set[CompoundStructureStatus] | None:
    if not raw_value:
        return None
    statuses: set[CompoundStructureStatus] = set()
    for item in raw_value.split(","):
        value = item.strip()
        if not value:
            continue
        statuses.add(CompoundStructureStatus(value))
    return statuses


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="List CAS values without resolving")
    parser.add_argument("--limit", type=int, default=None, help="Maximum CAS values to process")
    parser.add_argument(
        "--only-status",
        default=None,
        help="Comma-separated existing statuses to process, e.g. pending,error",
    )
    parser.add_argument("--force", action="store_true", help="Resolve even when a cache row exists")
    parser.add_argument(
        "--rate-limit",
        type=float,
        default=settings.chem_pubchem_rate_limit_per_second,
        help="PubChem requests per second",
    )
    parser.add_argument(
        "--skip-manual",
        dest="skip_manual",
        action="store_true",
        default=True,
        help="Do not overwrite manually verified rows (default)",
    )
    parser.add_argument(
        "--overwrite-manual",
        dest="skip_manual",
        action="store_false",
        help="Allow overwriting manually verified rows",
    )
    return parser


def ensure_structure_cache_table() -> None:
    CompoundStructureCache.__table__.create(engine, checkfirst=True)


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


def select_backfill_targets(
    db: Session,
    *,
    limit: int | None,
    only_status: set[CompoundStructureStatus] | None,
    force: bool,
    skip_manual: bool,
) -> list[str]:
    selected: list[str] = []
    for cas_number in get_distinct_inventory_cas_numbers(db):
        existing = get_structure_cache(db, cas_number)
        if should_skip_cache_row(
            existing,
            force=force,
            only_status=only_status,
            skip_manual=skip_manual,
        ):
            continue
        selected.append(cas_number)
        if limit is not None and len(selected) >= limit:
            break
    return selected


def print_status_counts(db: Session) -> None:
    print("status counts:")
    for row in count_structure_cache_by_status(db):
        print(f"  {row.status.value}: {row.count}")


async def resolve_targets(args: argparse.Namespace, targets: list[str]) -> None:
    min_interval = 1 / args.rate_limit
    async with create_pubchem_client(
        timeout_seconds=settings.chem_pubchem_timeout_seconds,
        user_agent=settings.chem_pubchem_user_agent,
    ) as client:
        resolver = PubChemResolver(
            client,
            min_interval_seconds=min_interval,
            max_retries=settings.chem_pubchem_max_retries,
        )
        with Session(engine) as db:
            for index, cas_number in enumerate(targets, start=1):
                try:
                    result = await resolver.resolve_cas(cas_number)
                    upsert_structure_cache(db, result.to_cache_write(), skip_manual=args.skip_manual)
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    upsert_structure_cache_error(db, cas_number, str(exc))
                db.commit()
                print(f"[{index}/{len(targets)}] {cas_number}")
            print_status_counts(db)


async def run_backfill(args: argparse.Namespace) -> None:
    if not settings.chem_resolver_pubchem_enabled and not args.dry_run:
        raise RuntimeError("PubChem resolver is disabled by CHEM_RESOLVER_PUBCHEM_ENABLED")
    ensure_structure_cache_table()
    only_status = parse_status_filter(args.only_status)
    with Session(engine) as db:
        targets = select_backfill_targets(
            db,
            limit=args.limit,
            only_status=only_status,
            force=args.force,
            skip_manual=args.skip_manual,
        )
        if args.dry_run:
            for cas_number in targets:
                print(f"would resolve {cas_number}")
            print(f"dry-run total: {len(targets)}")
            return
    await resolve_targets(args, targets)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.rate_limit <= 0 or args.rate_limit > 5:
        parser.error("--rate-limit must be > 0 and <= 5")
    asyncio.run(run_backfill(args))


if __name__ == "__main__":
    main()
