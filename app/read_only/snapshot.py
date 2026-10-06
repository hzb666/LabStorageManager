from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import closing
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.engine import make_url

from app.core.config import settings

PROJECT_ROOT = Path(__file__).resolve().parents[2]
REQUIRED_TABLES = frozenset({"inventory", "users"})


@dataclass(frozen=True, slots=True)
class SnapshotMetadata:
    snapshot_id: str
    created_at: str
    source_path: str
    snapshot_path: str
    size_bytes: int
    sha256: str
    inventory_count: int
    user_count: int


def resolve_main_database_path() -> Path:
    url = make_url(settings.database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        raise RuntimeError("Snapshot creation requires a file-backed SQLite DATABASE_URL")
    path = Path(url.database)
    return (path if path.is_absolute() else PROJECT_ROOT / path).resolve()


def resolve_snapshot_path(path_value: str | None = None) -> Path:
    path = Path(path_value or settings.read_only_snapshot_path)
    return (path if path.is_absolute() else PROJECT_ROOT / path).resolve()


def metadata_path(snapshot_path: Path) -> Path:
    return snapshot_path.with_suffix(f"{snapshot_path.suffix}.json")


def _database_uri(path: Path, *, immutable: bool = False) -> str:
    query = "mode=ro"
    if immutable:
        query += "&immutable=1"
    return f"{path.as_uri()}?{query}"


def _validate_database(connection: sqlite3.Connection) -> tuple[int, int]:
    result = connection.execute("PRAGMA quick_check").fetchone()
    if not result or result[0] != "ok":
        detail = result[0] if result else "no result"
        raise RuntimeError(f"Snapshot integrity check failed: {detail}")
    tables = {
        str(row[0])
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    missing = REQUIRED_TABLES - tables
    if missing:
        raise RuntimeError(f"Snapshot is missing required tables: {', '.join(sorted(missing))}")
    inventory_count = int(connection.execute("SELECT COUNT(*) FROM inventory").fetchone()[0])
    user_count = int(connection.execute("SELECT COUNT(*) FROM users").fetchone()[0])
    return inventory_count, user_count


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_snapshot(
    *,
    source_path: Path | None = None,
    snapshot_path: Path | None = None,
) -> SnapshotMetadata:
    source = (source_path or resolve_main_database_path()).resolve()
    target = (snapshot_path or resolve_snapshot_path()).resolve()
    if source == target:
        raise ValueError("Snapshot target must differ from the main database")
    if not source.is_file():
        raise FileNotFoundError(f"Main database not found: {source}")

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    temporary_metadata = metadata_path(target).with_name(
        f".{metadata_path(target).name}.{uuid.uuid4().hex}.tmp"
    )
    try:
        with closing(sqlite3.connect(
            _database_uri(source), uri=True, timeout=10,
        )) as source_connection:
            with closing(sqlite3.connect(str(temporary), timeout=10)) as target_connection:
                source_connection.backup(target_connection)
                target_connection.execute("PRAGMA journal_mode=DELETE")
                target_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                inventory_count, user_count = _validate_database(target_connection)
                target_connection.commit()

        created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        metadata = SnapshotMetadata(
            snapshot_id=uuid.uuid4().hex,
            created_at=created_at,
            source_path=str(source),
            snapshot_path=str(target),
            size_bytes=temporary.stat().st_size,
            sha256=_sha256(temporary),
            inventory_count=inventory_count,
            user_count=user_count,
        )
        temporary_metadata.write_text(
            json.dumps(asdict(metadata), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temporary, target)
        os.replace(temporary_metadata, metadata_path(target))
        return metadata
    finally:
        temporary.unlink(missing_ok=True)
        temporary_metadata.unlink(missing_ok=True)


def load_snapshot_metadata(snapshot_path: Path | None = None) -> SnapshotMetadata:
    target = (snapshot_path or resolve_snapshot_path()).resolve()
    raw = json.loads(metadata_path(target).read_text(encoding="utf-8"))
    metadata = SnapshotMetadata(**raw)
    if Path(metadata.snapshot_path).resolve() != target:
        raise RuntimeError("Snapshot metadata path does not match configured snapshot")
    return metadata


def verify_snapshot(snapshot_path: Path | None = None) -> SnapshotMetadata:
    target = (snapshot_path or resolve_snapshot_path()).resolve()
    if not target.is_file():
        raise FileNotFoundError(f"Read-only snapshot not found: {target}")
    metadata = load_snapshot_metadata(target)
    if target.stat().st_size != metadata.size_bytes or _sha256(target) != metadata.sha256:
        raise RuntimeError("Snapshot file does not match its metadata")
    with closing(sqlite3.connect(
        _database_uri(target, immutable=True), uri=True, timeout=5,
    )) as connection:
        inventory_count, user_count = _validate_database(connection)
    if inventory_count != metadata.inventory_count or user_count != metadata.user_count:
        raise RuntimeError("Snapshot row counts do not match its metadata")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or verify the inventory read-only snapshot"
    )
    parser.add_argument("action", choices=("create", "verify"))
    parser.add_argument("--source", type=Path)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    target = arguments.output.resolve() if arguments.output else None
    if arguments.action == "create":
        result = create_snapshot(
            source_path=arguments.source.resolve() if arguments.source else None,
            snapshot_path=target,
        )
    else:
        result = verify_snapshot(target)
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
