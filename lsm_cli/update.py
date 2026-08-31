from __future__ import annotations

import hashlib
import platform
import re
import shutil
import zipfile
from itertools import zip_longest
from pathlib import Path, PurePosixPath
from typing import Any

import requests

from lsm_cli.client import CLILocalInputError, CLINetworkError, CLIRequestError

LATEST_RELEASE_URL = "https://github.com/hzb666/LabStorageManager/releases/latest"
DOWNLOAD_USER_AGENT = "LabStorageManager CLI updater"
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
