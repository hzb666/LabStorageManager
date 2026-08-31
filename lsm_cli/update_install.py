from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

from lsm_cli.client import CLILocalInputError
from lsm_cli.update import (
    download_file,
    extract_release_skill,
    fetch_latest_release,
    is_newer_release,
    normalize_release_version,
    select_release_asset,
    sha256_file,
    verify_release_checksum,
)

REPOSITORY_URL = "https://github.com/hzb666/LabStorageManager"


@dataclass
class StagedReplacement:
    target: Path
    staged: Path
    backup: Path
    env_preserved: bool = False
    installed: bool = False
    backup_created: bool = False


def install_latest_release(
    *, current_version: str, skill_host: str, timeout: float
) -> dict[str, Any]:
    _validate_update_runtime(timeout)
    release = fetch_latest_release(timeout=timeout)
    release_tag = str(release.get("tag_name") or "").strip()
    latest_version = normalize_release_version(release_tag)
    update_available = is_newer_release(current=current_version, latest=latest_version)
    if latest_version != current_version and not update_available:
        raise CLILocalInputError(
            f"Installed CLI {current_version} is newer than latest release {latest_version}"
        )

    asset_name = select_release_asset()
    executable_path = Path(sys.executable).resolve()
    skill_targets = _resolve_skill_targets(skill_host)
    encoded_tag = quote(release_tag, safe="")
    release_download_url = f"{REPOSITORY_URL}/releases/download/{encoded_tag}"
    archive_url = f"{REPOSITORY_URL}/archive/refs/tags/{encoded_tag}.zip"

    with tempfile.TemporaryDirectory(prefix="lsm-update-") as temp_dir:
        download_dir = Path(temp_dir)
        asset_path = download_dir / asset_name
        checksums_path = download_dir / "SHA256SUMS.txt"
        archive_path = download_dir / "source.zip"
        download_file(f"{release_download_url}/{asset_name}", asset_path, timeout)
        download_file(f"{release_download_url}/SHA256SUMS.txt", checksums_path, timeout)
        if skill_targets:
            download_file(archive_url, archive_path, timeout)
        verified_sha256 = verify_release_checksum(
            asset_name=asset_name,
            actual_sha256=sha256_file(asset_path),
            checksums_text=checksums_path.read_text(encoding="utf-8"),
        )
        replacements = _stage_release_replacements(
            asset_path=asset_path,
            executable_path=executable_path,
            expected_sha256=verified_sha256,
            archive_path=archive_path,
            download_dir=download_dir,
            skill_targets=skill_targets,
        )
        cli_status = _install_replacements(replacements, executable_path)

    skill_replacements = [item for item in replacements if item.target != executable_path]
    return {
        "current_version": current_version,
        "latest_version": latest_version,
        "update_available": update_available,
        "release_tag": release_tag,
        "asset_name": asset_name,
        "sha256": verified_sha256,
        "cli_path": str(executable_path),
        "cli_status": cli_status,
        "skill_paths": [str(item.target) for item in skill_replacements],
        "skill_env_preserved": [
            str(item.target) for item in skill_replacements if item.env_preserved
        ],
        "agent_restart_required": bool(skill_replacements),
    }


def _validate_update_runtime(timeout: float) -> None:
    if timeout <= 0:
        raise CLILocalInputError("Update timeout must be greater than zero")
    if not getattr(sys, "frozen", False):
        raise CLILocalInputError(
            "`lsm update` is only supported by the precompiled release CLI; "
            "source or pip installations must use their package manager"
        )


def _stage_release_replacements(
    *,
    asset_path: Path,
    executable_path: Path,
    expected_sha256: str,
    archive_path: Path,
    download_dir: Path,
    skill_targets: list[Path],
) -> list[StagedReplacement]:
    replacements: list[StagedReplacement] = []
    try:
        if not executable_path.is_file() or sha256_file(executable_path) != expected_sha256:
            replacements.append(_stage_executable(asset_path, executable_path))
        if skill_targets:
            skill_source = extract_release_skill(archive_path, download_dir / "skill")
            replacements.extend(_stage_skill_tree(skill_source, target) for target in skill_targets)
        return replacements
    except Exception:
        _cleanup_staged_replacements(replacements)
        raise


def _stage_executable(source: Path, target: Path) -> StagedReplacement:
    suffix = uuid.uuid4().hex
    staged = target.with_name(f".{target.name}.new-{suffix}")
    shutil.copy2(source, staged)
    if platform.system() != "Windows":
        staged.chmod(0o755)
    return StagedReplacement(
        target=target,
        staged=staged,
        backup=target.with_name(f".{target.name}.backup-{suffix}"),
    )


def _stage_skill_tree(source: Path, target: Path) -> StagedReplacement:
    if not (source / "SKILL.md").is_file():
        raise CLILocalInputError("Release archive is missing the CLI Skill")
    target.parent.mkdir(parents=True, exist_ok=True)
    suffix = uuid.uuid4().hex
    staged = target.parent / f".{target.name}.install-{suffix}"
    backup = target.parent / f".{target.name}.backup-{suffix}"
    preserved_env = (target / ".env").read_bytes() if (target / ".env").is_file() else None
    shutil.copytree(source, staged)
    if preserved_env is not None:
        (staged / ".env").write_bytes(preserved_env)
    return StagedReplacement(target, staged, backup, preserved_env is not None)


def install_skill_tree(*, source: Path, target: Path) -> bool:
    replacement = _stage_skill_tree(source, target)
    _apply_replacements([replacement])
    return replacement.env_preserved


def _install_replacements(
    replacements: list[StagedReplacement], executable_path: Path
) -> str:
    executable_replaced = any(item.target == executable_path for item in replacements)
    if not replacements:
        return "current"
    if platform.system() == "Windows" and executable_replaced:
        _schedule_windows_replacements(replacements, executable_path)
        return "scheduled"
    _apply_replacements(replacements, executable_path if executable_replaced else None)
    return "updated" if executable_replaced else "current"


def _apply_replacements(
    replacements: list[StagedReplacement], executable_path: Path | None = None
) -> None:
    try:
        for item in replacements:
            if item.target.exists():
                item.target.replace(item.backup)
                item.backup_created = True
            item.staged.replace(item.target)
            item.installed = True
        if executable_path is not None:
            verification = subprocess.run(
                [str(executable_path), "--help"],
                check=False,
                capture_output=True,
                timeout=30,
            )
            if verification.returncode != 0:
                raise CLILocalInputError("Updated CLI failed its --help verification")
    except Exception:
        _rollback_replacements(replacements)
        raise
    else:
        for item in replacements:
            _remove_path(item.backup)
    finally:
        _cleanup_staged_replacements(replacements)


def _rollback_replacements(replacements: list[StagedReplacement]) -> None:
    for item in reversed(replacements):
        if item.installed:
            _remove_path(item.target)
        if item.backup_created and item.backup.exists():
            item.backup.replace(item.target)


def _remove_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def _cleanup_staged_replacements(replacements: list[StagedReplacement]) -> None:
    for item in replacements:
        _remove_path(item.staged)


def _schedule_windows_replacements(
    replacements: list[StagedReplacement], executable_path: Path
) -> None:
    suffix = uuid.uuid4().hex
    plan_path = executable_path.with_name(f".lsm-update-{suffix}.json")
    script_path = executable_path.with_name(f".lsm-update-{suffix}.ps1")
    plan = [
        {"target": str(item.target), "staged": str(item.staged), "backup": str(item.backup)}
        for item in replacements
    ]
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    script_path.write_text(_WINDOWS_UPDATE_SCRIPT, encoding="utf-8")
    try:
        subprocess.Popen(
            [
                "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", str(script_path), str(os.getpid()), str(plan_path),
                str(executable_path),
            ],
            close_fds=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        _cleanup_staged_replacements(replacements)
        plan_path.unlink(missing_ok=True)
        script_path.unlink(missing_ok=True)
        raise


def _resolve_skill_targets(skill_host: str) -> list[Path]:
    home = Path.home()
    codex_targets = [
        home / ".agents" / "skills" / "lab-storage-manager-cli",
        home / ".codex" / "skills" / "lab-storage-manager-cli",
    ]
    claude_target = home / ".claude" / "skills" / "lab-storage-manager-cli"
    if skill_host == "none":
        return []
    if skill_host == "codex":
        existing = [target for target in codex_targets if target.exists()]
        return existing or codex_targets[:1]
    if skill_host == "claude":
        return [claude_target]
    if skill_host == "both":
        existing = [target for target in codex_targets if target.exists()]
        return [*(existing or codex_targets[:1]), claude_target]
    if skill_host != "auto":
        raise CLILocalInputError(f"Unknown Skill host: {skill_host}")
    detected = [target for target in (*codex_targets, claude_target) if target.exists()]
    if not detected:
        raise CLILocalInputError(
            "Could not detect an installed Agent Skill; use --skill-host codex, "
            "claude, both, or none"
        )
    return detected


_WINDOWS_UPDATE_SCRIPT = r'''param([int]$ParentPid,[string]$PlanPath,[string]$ExecutablePath)
$ErrorActionPreference = 'Stop'
$Applied = @()
$Plan = @()
$ExitCode = 0
Wait-Process -Id $ParentPid -ErrorAction SilentlyContinue
try {
  $Plan = @(Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json)
  foreach ($Item in $Plan) {
    $State = [pscustomobject]@{ Item = $Item; BackupCreated = $false; Installed = $false }
    $Applied += $State
    if (Test-Path -LiteralPath $Item.target) {
      Move-Item -LiteralPath $Item.target -Destination $Item.backup
      $State.BackupCreated = $true
    }
    Move-Item -LiteralPath $Item.staged -Destination $Item.target
    $State.Installed = $true
  }
  & $ExecutablePath --help *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Updated CLI failed its --help verification' }
} catch {
  [array]::Reverse($Applied)
  foreach ($State in $Applied) {
    try {
      if ($State.Installed -and (Test-Path -LiteralPath $State.Item.target)) {
        Remove-Item -LiteralPath $State.Item.target -Recurse -Force
      }
      if ($State.BackupCreated -and (Test-Path -LiteralPath $State.Item.backup)) {
        Move-Item -LiteralPath $State.Item.backup -Destination $State.Item.target
      }
    } catch {
      # Continue restoring the remaining targets even if one rollback step fails.
    }
  }
  $ExitCode = 1
} finally {
  if ($ExitCode -eq 0) {
    foreach ($State in $Applied) {
      if ($State.BackupCreated) {
        Remove-Item -LiteralPath $State.Item.backup -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
  foreach ($Item in $Plan) {
    if (Test-Path -LiteralPath $Item.staged) {
      Remove-Item -LiteralPath $Item.staged -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $PlanPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
}
exit $ExitCode
'''
