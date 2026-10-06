from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import zipfile
from datetime import UTC, datetime, timedelta
from itertools import zip_longest
from pathlib import Path, PurePosixPath
from typing import Any

import requests

from lsm_cli.client import CLILocalInputError, CLINetworkError, CLIRequestError
from lsm_cli.config import get_config_path

LATEST_RELEASE_URL = "https://github.com/hzb666/LabStorageManager/releases/latest"
DOWNLOAD_USER_AGENT = "LabStorageManager CLI updater"
DEFAULT_UPDATE_CHECK_INTERVAL_HOURS = 7 * 24
FAILED_UPDATE_CHECK_RETRY_HOURS = 24
SEMVER_PATTERN = re.compile(
    r"^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
SUPPORTED_ASSETS = {
    ("windows", "amd64"): "lsm-windows-x64.exe",
    ("windows", "x86_64"): "lsm-windows-x64.exe",
    ("darwin", "arm64"): "lsm-macos-arm64",
    ("darwin", "aarch64"): "lsm-macos-arm64",
}


def get_update_check_state_path() -> Path:
    return get_config_path().with_name("update-check.json")


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _format_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _load_update_check_state() -> dict[str, Any]:
    path = get_update_check_state_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _save_update_check_state(payload: dict[str, Any]) -> None:
    path = get_update_check_state_path()
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(path)
    except OSError:
        temporary.unlink(missing_ok=True)


def get_deferred_update_check(
    *, current_version: str, now: datetime | None = None
) -> dict[str, Any] | None:
    state = _load_update_check_state()
    current_time = now or _utc_now()
    next_check_at = _parse_timestamp(state.get("next_check_at"))
    if next_check_at is None or current_time >= next_check_at:
        return None

    latest_value = state.get("latest_version")
    latest_version: str | None = None
    if latest_value:
        try:
            latest_version = normalize_release_version(latest_value)
        except CLILocalInputError:
            latest_version = None
    return {
        "current_version": current_version,
        "latest_version": latest_version,
        "update_available": (
            is_newer_release(current=current_version, latest=latest_version)
            if latest_version
            else None
        ),
        "release_url": state.get("release_url"),
        "update_command": "lsm update",
        "check_performed": False,
        "checked_at": state.get("checked_at"),
        "next_check_at": _format_timestamp(next_check_at),
    }


def begin_scheduled_update_check(
    *, now: datetime | None = None, retry_hours: float = FAILED_UPDATE_CHECK_RETRY_HOURS
) -> None:
    current_time = now or _utc_now()
    state = _load_update_check_state()
    state.update({
        "last_attempt_at": _format_timestamp(current_time),
        "next_check_at": _format_timestamp(current_time + timedelta(hours=retry_hours)),
    })
    _save_update_check_state(state)


def record_successful_update_check(
    *,
    latest_version: str,
    release_url: str,
    interval_hours: float = DEFAULT_UPDATE_CHECK_INTERVAL_HOURS,
    now: datetime | None = None,
) -> dict[str, str]:
    current_time = now or _utc_now()
    checked_at = _format_timestamp(current_time)
    next_check_at = _format_timestamp(current_time + timedelta(hours=interval_hours))
    _save_update_check_state({
        "last_attempt_at": checked_at,
        "checked_at": checked_at,
        "next_check_at": next_check_at,
        "latest_version": latest_version,
        "release_url": release_url,
    })
    return {"checked_at": checked_at, "next_check_at": next_check_at}


def fetch_latest_release(*, timeout: float) -> dict[str, Any]:
    try:
        response = requests.head(
            LATEST_RELEASE_URL,
            allow_redirects=True,
            headers={"User-Agent": "LabStorageManager CLI update-check"},
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise CLINetworkError(str(exc)) from exc
    if not response.ok:
        raise CLIRequestError(
            f"GitHub Releases HTTP {response.status_code}",
            payload={"release_url": LATEST_RELEASE_URL},
        )
    release_url = response.url.rstrip("/")
    tag_name = release_url.rsplit("/", 1)[-1]
    normalize_release_version(tag_name)
    return {"tag_name": tag_name, "html_url": release_url}


def normalize_release_version(value: object) -> str:
    raw_value = str(value or "").strip()
    if SEMVER_PATTERN.fullmatch(raw_value) is None:
        raise CLILocalInputError(f"Invalid release version: {raw_value or '<empty>'}")
    return raw_value.removeprefix("v")


def is_newer_release(*, current: str, latest: str) -> bool:
    current_core, current_prerelease = _parse_version(current)
    latest_core, latest_prerelease = _parse_version(latest)
    if latest_core != current_core:
        return latest_core > current_core
    return _compare_prerelease(latest_prerelease, current_prerelease) > 0


def _parse_version(value: str) -> tuple[tuple[int, int, int], tuple[str, ...] | None]:
    normalized = normalize_release_version(value)
    match = SEMVER_PATTERN.fullmatch(normalized)
    if match is None:
        raise CLILocalInputError(f"Invalid release version: {value}")
    prerelease = tuple(match.group(4).split(".")) if match.group(4) else None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3))), prerelease


def _compare_prerelease(
    left: tuple[str, ...] | None,
    right: tuple[str, ...] | None,
) -> int:
    if left is None:
        return 0 if right is None else 1
    if right is None:
        return -1
    for left_part, right_part in zip_longest(left, right):
        if left_part is None:
            return -1
        if right_part is None:
            return 1
        if left_part == right_part:
            continue
        left_numeric = left_part.isdigit()
        right_numeric = right_part.isdigit()
        if left_numeric and right_numeric:
            return 1 if int(left_part) > int(right_part) else -1
        if left_numeric != right_numeric:
            return -1 if left_numeric else 1
        return 1 if left_part > right_part else -1
    return 0


def select_release_asset() -> str:
    key = (platform.system().casefold(), platform.machine().casefold())
    asset_name = SUPPORTED_ASSETS.get(key)
    if asset_name is None:
        raise CLILocalInputError(
            f"No precompiled CLI update for {platform.system()} {platform.machine()}"
        )
    return asset_name


def download_file(url: str, target: Path, timeout: float) -> None:
    try:
        with requests.get(
            url,
            headers={"User-Agent": DOWNLOAD_USER_AGENT},
            stream=True,
            timeout=timeout,
        ) as response:
            if not response.ok:
                raise CLIRequestError(
                    f"GitHub download HTTP {response.status_code}",
                    payload={"download_url": url},
                )
            with target.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        output.write(chunk)
    except requests.RequestException as exc:
        raise CLINetworkError(str(exc)) from exc


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_release_checksum(
    *, asset_name: str, actual_sha256: str, checksums_text: str
) -> str:
    matches: list[str] = []
    for raw_line in checksums_text.splitlines():
        parts = raw_line.strip().split(maxsplit=1)
        if len(parts) != 2:
            continue
        checksum, recorded_path = parts
        recorded_name = PurePosixPath(recorded_path.lstrip("* ").replace("\\", "/")).name
        if recorded_name == asset_name:
            matches.append(checksum.casefold())
    if len(matches) != 1:
        raise CLILocalInputError(
            f"SHA256SUMS.txt must contain exactly one entry for {asset_name}"
        )
    normalized_actual = actual_sha256.casefold()
    if matches[0] != normalized_actual:
        raise CLILocalInputError(f"SHA-256 verification failed for {asset_name}")
    return normalized_actual


def extract_release_skill(archive_path: Path, destination: Path) -> Path:
    with zipfile.ZipFile(archive_path) as archive:
        markers = [
            PurePosixPath(info.filename)
            for info in archive.infolist()
            if PurePosixPath(info.filename).parts[-3:]
            == ("skills", "lab-storage-manager-cli", "SKILL.md")
        ]
        if len(markers) != 1:
            raise CLILocalInputError(
                "Release archive must contain exactly one CLI Skill directory"
            )
        skill_root = markers[0].parent
        destination.mkdir(parents=True)
        for info in archive.infolist():
            member = PurePosixPath(info.filename)
            if not member.is_relative_to(skill_root):
                continue
            relative_path = member.relative_to(skill_root)
            if not relative_path.parts or any(
                part in {"", ".", ".."} for part in relative_path.parts
            ):
                continue
            output_path = destination.joinpath(*relative_path.parts)
            if info.is_dir():
                output_path.mkdir(parents=True, exist_ok=True)
                continue
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, output_path.open("wb") as output:
                shutil.copyfileobj(source, output)
    if not (destination / "SKILL.md").is_file():
        raise CLILocalInputError("Release archive is missing the CLI Skill")
    return destination


def install_latest_release(**kwargs: Any) -> dict[str, Any]:
    from lsm_cli.update_install import install_latest_release as install

    return install(**kwargs)


def install_skill_tree(*, source: Path, target: Path) -> bool:
    from lsm_cli.update_install import install_skill_tree as install

    return install(source=source, target=target)
