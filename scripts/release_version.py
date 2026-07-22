#!/usr/bin/env python3
"""Synchronize and verify release metadata across the repository."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tomllib
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PRERELEASE_IDENTIFIER = r"(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    rf"(?:-{PRERELEASE_IDENTIFIER}(?:\.{PRERELEASE_IDENTIFIER})*)?"
    r"(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


class VersionError(RuntimeError):
    """Raised when release metadata is invalid or inconsistent."""


@dataclass(frozen=True)
class Replacement:
    path: str
    pattern: re.Pattern[str]


REPLACEMENTS = (
    Replacement("pyproject.toml", re.compile(r'(?m)^(version\s*=\s*")[^"\r\n]+(".*)$')),
    Replacement(
        "lsm_cli/pyproject.toml",
        re.compile(r'(?m)^(version\s*=\s*")[^"\r\n]+(".*)$'),
    ),
    Replacement(
        "app/__init__.py",
        re.compile(r'(?m)^(__version__\s*=\s*")[^"\r\n]+(".*)$'),
    ),
    Replacement(
        "app/core/config.py",
        re.compile(r'(?m)^(\s*app_version:\s*str\s*=\s*")[^"\r\n]+(".*)$'),
    ),
    Replacement(
        "app/core/config.py",
        re.compile(r'(?m)^(\s*default="LabStorageManager/)[^"\r\n]+(",.*)$'),
    ),
    Replacement(
        "app/core/config.py",
        re.compile(
            r'(?m)^(\s*settings\.app_version\s*=\s*settings\.app_version\.strip\(\)\s*or\s*")'
            r'[^"\r\n]+(".*)$'
        ),
    ),
    Replacement(
        "browser-extension/build-config.mjs",
        re.compile(r"(?m)^(\s*version:\s*')[^'\r\n]+(',.*)$"),
    ),
    Replacement(
        "README.md",
        re.compile(r"(?m)^(\|\s*`CACHE_VERSION`\s*\|\s*`)[^`\r\n]+(`\s*\|.*)$"),
    ),
    Replacement(
        "README.md",
        re.compile(
            r"(?m)^(\|\s*`CHEM_PUBCHEM_USER_AGENT`\s*\|\s*`LabStorageManager/)"
            r"[^`\r\n]+(`\s*\|.*)$"
        ),
    ),
)


def _read_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8")


def _extract_one(label: str, pattern: re.Pattern[str], content: str) -> str:
    matches = pattern.findall(content)
    if len(matches) != 1:
        raise VersionError(f"Expected one {label} version, found {len(matches)}")
    match = matches[0]
    return match if isinstance(match, str) else match[0]


def read_versions(root: Path = PROJECT_ROOT) -> dict[str, str]:
    backend = tomllib.loads(_read_text(root / "pyproject.toml"))
    cli = tomllib.loads(_read_text(root / "lsm_cli/pyproject.toml"))
    frontend = json.loads(_read_text(root / "frontend/package.json"))
    frontend_lock = json.loads(_read_text(root / "frontend/package-lock.json"))
    app_init = _read_text(root / "app/__init__.py")
    app_config = _read_text(root / "app/core/config.py")
    extension = _read_text(root / "browser-extension/build-config.mjs")
    return {
        "backend": backend["tool"]["poetry"]["version"],
        "cli": cli["project"]["version"],
        "frontend": frontend["version"],
        "frontend_lock": frontend_lock["version"],
        "frontend_lock_package": frontend_lock["packages"][""]["version"],
        "app": _extract_one("app", re.compile(r'__version__ = "([^"]+)"'), app_init),
        "app_default": _extract_one(
            "app default", re.compile(r'app_version: str = "([^"]+)"'), app_config
        ),
        "app_fallback": _extract_one(
            "app fallback",
            re.compile(r'settings\.app_version = settings\.app_version\.strip\(\) or "([^"]+)"'),
            app_config,
        ),
        "pubchem_user_agent": _extract_one(
            "PubChem user agent", re.compile(r'default="LabStorageManager/([^"]+)"'), app_config
        ),
        "browser_extension": _extract_one(
            "browser extension", re.compile(r"version: '([^']+)'"), extension
        ),
    }


def _validate_version(value: str) -> str:
    if not SEMVER_PATTERN.fullmatch(value):
        raise VersionError(f"Invalid SemVer version: {value}")
    return value


def check_tag(tag: str, root: Path = PROJECT_ROOT) -> None:
    if not tag.startswith("v"):
        raise VersionError(f"Release tag must start with v: {tag}")
    expected = _validate_version(tag[1:])
    versions = read_versions(root)
    mismatches = {name: value for name, value in versions.items() if value != expected}
    if mismatches:
        raise VersionError(f"Tag {tag} does not match package versions: {mismatches}")
    print(f"Release metadata matches {tag}: {versions}")


def _prepare_updates(version: str, root: Path) -> dict[Path, bytes]:
    updates: dict[Path, bytes] = {}
    for replacement in REPLACEMENTS:
        path = root / replacement.path
        source = updates[path] if path in updates else path.read_bytes()
        content = source.decode("utf-8")
        matches = list(replacement.pattern.finditer(content))
        if len(matches) != 1:
            raise VersionError(
                f"Expected one version field in {replacement.path}, found {len(matches)}"
            )
        content = replacement.pattern.sub(
            lambda match: f"{match.group(1)}{version}{match.group(2)}", content, count=1
        )
        updates[path] = content.encode("utf-8")
    return updates


def set_version(version: str, root: Path = PROJECT_ROOT) -> None:
    version = _validate_version(version)
    npm = shutil.which("npm")
    if npm is None:
        raise VersionError("npm is required to update frontend package metadata")
    updates = _prepare_updates(version, root)
    managed_paths = set(updates) | {
        root / "frontend/package.json",
        root / "frontend/package-lock.json",
    }
    originals = {path: path.read_bytes() for path in managed_paths}
    try:
        for path, content in updates.items():
            path.write_bytes(content)
        subprocess.run(
            [
                npm,
                "version",
                version,
                "--allow-same-version",
                "--git-tag-version=false",
                "--ignore-scripts",
            ],
            cwd=root / "frontend",
            check=True,
        )
        mismatches = {
            name: value for name, value in read_versions(root).items() if value != version
        }
        if mismatches:
            raise VersionError(f"Version update left inconsistent metadata: {mismatches}")
    except BaseException:
        for path, content in originals.items():
            path.write_bytes(content)
        raise
    print(f"Updated release metadata to {version}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    set_parser = commands.add_parser("set", help="update all release metadata")
    set_parser.add_argument("version", help="SemVer without the leading v")
    check_parser = commands.add_parser("check", help="verify metadata against a release tag")
    check_parser.add_argument("tag", help="release tag such as v0.6.1")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command == "set":
            set_version(args.version)
        else:
            check_tag(args.tag)
    except (OSError, ValueError, VersionError, subprocess.CalledProcessError) as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
