"""Backfill compound structure cache from inventory CAS numbers."""
# ruff: noqa: E402
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from collections import Counter
from pathlib import Path

from sqlmodel import Session

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.database import engine
from app.db_bootstrap.schema_upgrades import ensure_sqlite_compound_structure_cache_name_columns
from app.models.compound_structure import CompoundStructureCache
from app.services.pubchem_resolver import PubChemResolver, create_pubchem_client
from app.services.structure_backfill import (
    StructureBackfillTargetOptions,
    parse_status_filter,
    resolve_missing_names,
    select_backfill_targets,
    should_resolve_structure,
)
from app.services.structure_cache_repo import (
    StructureNameCacheWrite,
    count_structure_cache_by_status,
    get_structure_cache,
    upsert_structure_cache,
    upsert_structure_cache_error,
    upsert_structure_cache_names,
)

DEFAULT_DRY_RUN_PREVIEW_LIMIT = 30


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Preview CAS values without resolving")
    parser.add_argument("--limit", type=int, default=None, help="Maximum CAS values to process")
    parser.add_argument(
        "--preview-limit",
        type=int,
        default=DEFAULT_DRY_RUN_PREVIEW_LIMIT,
        help="Maximum CAS values to print in dry-run preview",
    )
    parser.add_argument(
        "--print-targets",
        action="store_true",
        help="Print every dry-run target instead of the preview",
    )
    parser.add_argument(
        "--only-status",
        default=None,
        help="Comma-separated existing statuses to process, e.g. pending,error",
    )
    parser.add_argument("--force", action="store_true", help="Resolve even when a cache row exists")
    parser.add_argument(
        "--names-only",
        action="store_true",
        help="Backfill missing names without resolving structures",
    )
    parser.add_argument(
        "--include-names",
        action="store_true",
        help="Also backfill English and Chinese names into compound_structure_cache",
    )
    parser.add_argument(
        "--force-names",
        action="store_true",
        help="Query and write names even when cached names already exist",
    )
    parser.add_argument(
        "--skip-chinese",
        action="store_true",
        help="Only backfill English names; do not query Chinese name sources",
    )
    parser.add_argument(
        "--name-delay",
        type=float,
        default=1.0,
        help="Seconds to sleep after external name lookup for one CAS",
    )
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
    with engine.begin() as connection:
        ensure_sqlite_compound_structure_cache_name_columns(connection)


def print_status_counts(db: Session) -> None:
    print("status counts:")
    for row in count_structure_cache_by_status(db):
        print(f"  {row.status.value}: {row.count}")


def print_dry_run_targets(args: argparse.Namespace, targets: list[str]) -> None:
    if args.print_targets:
        for cas_number in targets:
            print(f"would resolve {cas_number}")
    else:
        preview_limit = max(args.preview_limit, 0)
        preview = targets[:preview_limit]
        for cas_number in preview:
            print(f"would process {cas_number}")
        remaining = len(targets) - len(preview)
        if remaining > 0:
            print(f"... and {remaining} more; use --print-targets to list all")
    print(f"dry-run total: {len(targets)}")


def write_name_backfill_error(db: Session, cas_number: str, error_message: str) -> None:
    upsert_structure_cache_names(
        db,
        StructureNameCacheWrite(
            cas_number=cas_number,
            name_error_message=error_message,
        ),
    )


async def resolve_one_target(
    db: Session,
    resolver: PubChemResolver,
    args: argparse.Namespace,
    only_status,
    cas_number: str,
) -> tuple[str, str]:
    structure_state = "skipped"
    name_state = "skipped"
    existing = get_structure_cache(db, cas_number)
    if should_resolve_structure(
        existing,
        names_only=args.names_only,
        force=args.force,
        only_status=only_status,
        skip_manual=args.skip_manual,
    ):
        try:
            result = await resolver.resolve_cas(cas_number)
            upsert_structure_cache(
                db,
                result.to_cache_write(),
                skip_manual=args.skip_manual,
            )
            structure_state = result.status.value
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            upsert_structure_cache_error(db, cas_number, str(exc))
            return "error", "skipped-error"
    if args.include_names:
        try:
            with db.begin_nested():
                name_state = resolve_missing_names(
                    db,
                    cas_number,
                    skip_chinese=args.skip_chinese,
                    skip_manual=args.skip_manual,
                    force_names=args.force_names,
                )
        except Exception as exc:  # noqa: BLE001
            write_name_backfill_error(db, cas_number, str(exc))
            name_state = "error"
        if not name_state.startswith("skipped") and args.name_delay > 0:
            time.sleep(args.name_delay)
    return structure_state, name_state


async def resolve_targets(args: argparse.Namespace, targets: list[str]) -> None:
    min_interval = 1 / args.rate_limit
    only_status = parse_status_filter(args.only_status)
    stats: Counter[str] = Counter()
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
                    structure_state, name_state = await resolve_one_target(
                        db,
                        resolver,
                        args,
                        only_status,
                        cas_number,
                    )
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    upsert_structure_cache_error(db, cas_number, str(exc))
                    structure_state = "error"
                    name_state = "skipped-error"
                db.commit()
                stats[f"structure:{structure_state}"] += 1
                stats[f"names:{name_state}"] += 1
                print(
                    f"[{index}/{len(targets)}] {cas_number} "
                    f"structure={structure_state} names={name_state}"
                )
            if stats:
                print("batch summary:")
                for key, count in sorted(stats.items()):
                    print(f"  {key}: {count}")
            print_status_counts(db)


async def run_backfill(args: argparse.Namespace) -> None:
    if not settings.chem_resolver_pubchem_enabled and not args.dry_run and not args.names_only:
        raise RuntimeError("PubChem resolver is disabled by CHEM_RESOLVER_PUBCHEM_ENABLED")
    if args.names_only:
        args.include_names = True
    ensure_structure_cache_table()
    only_status = parse_status_filter(args.only_status)
    with Session(engine) as db:
        targets = select_backfill_targets(
            db,
            options=StructureBackfillTargetOptions(
                limit=args.limit,
                only_status=only_status,
                force=args.force,
                skip_manual=args.skip_manual,
                names_only=args.names_only,
                include_names=args.include_names,
                force_names=args.force_names,
                skip_chinese=args.skip_chinese,
            ),
        )
        if args.dry_run:
            print_dry_run_targets(args, targets)
            return
    await resolve_targets(args, targets)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.rate_limit <= 0 or args.rate_limit > 5:
        parser.error("--rate-limit must be > 0 and <= 5")
    if args.name_delay < 0:
        parser.error("--name-delay must be >= 0")
    if args.names_only and args.only_status:
        parser.error("--names-only cannot be combined with --only-status")
    asyncio.run(run_backfill(args))


if __name__ == "__main__":
    main()
