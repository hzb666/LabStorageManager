"""Safe subprocess wrapper around the LabStorageManager CLI."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "http://127.0.0.1:8000/api"
DEFAULT_CLI_TIMEOUT_SECONDS = 5.0
PROCESS_TIMEOUT_GRACE_SECONDS = 2.0
STDOUT_PREVIEW_CHARS = 2000

load_dotenv(REPO_ROOT / ".env", override=False)
load_dotenv(REPO_ROOT / "robot" / ".env", override=False)


def run_lsm_cli(
    args: list[str],
    *,
    token: str | None = None,
    use_service_token: bool = True,
) -> dict[str, Any]:
    """Run `python -m lsm_cli` with a fixed argument vector and parse JSON stdout."""
    base_url = _read_text_env("LSM_MCP_BASE_URL", DEFAULT_BASE_URL)
    timeout_seconds = _read_float_env("LSM_MCP_CLI_TIMEOUT", DEFAULT_CLI_TIMEOUT_SECONDS)
    resolved_token = token or (os.getenv("LSM_MCP_SERVICE_TOKEN", "") if use_service_token else "")
    command = _build_command(args, base_url=base_url, timeout_seconds=timeout_seconds)
    if resolved_token:
        command.extend(["--token", resolved_token])

    return _run_command(command, timeout_seconds=timeout_seconds)


def login_lsm_cli(username: str, password: str) -> dict[str, Any]:
    """Login through the CLI and return the temporary token without touching global CLI state."""
    base_url = _read_text_env("LSM_MCP_BASE_URL", DEFAULT_BASE_URL)
    timeout_seconds = _read_float_env("LSM_MCP_CLI_TIMEOUT", DEFAULT_CLI_TIMEOUT_SECONDS)
    with tempfile.TemporaryDirectory(prefix="lsm-mcp-bind-") as temp_dir:
        command = _build_command(
            ["auth", "login", "--username", username, "--password-stdin"],
            base_url=base_url,
            timeout_seconds=timeout_seconds,
        )
        result = _run_command(
            command,
            timeout_seconds=timeout_seconds,
            input_text=f"{password}\n",
            extra_env={"APPDATA": temp_dir, "HOME": temp_dir},
        )
        if result.get("ok") is not True:
            return result
        return _attach_login_token(result, temp_dir)


def _run_command(
    command: list[str],
    *,
    timeout_seconds: float,
    input_text: str | None = None,
    extra_env: dict[str, str] | None = None,
) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            command,
            cwd=REPO_ROOT,
            input=input_text,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout_seconds + PROCESS_TIMEOUT_GRACE_SECONDS,
            shell=False,
            env={**os.environ, "PYTHONIOENCODING": "utf-8", **(extra_env or {})},
        )
    except subprocess.TimeoutExpired as exc:
        return _error_result(
            exit_code=9,
            code="CLI_TIMEOUT",
            message="lsm_cli timed out",
            detail={"timeout_seconds": timeout_seconds, "stderr": _safe_text(exc.stderr)},
        )

    return _parse_process_output(
        exit_code=proc.returncode,
        stdout=proc.stdout.strip(),
        stderr=proc.stderr.strip(),
    )


def _attach_login_token(result: dict[str, Any], temp_dir: str) -> dict[str, Any]:
    payload = result.get("payload")
    data = payload.get("data") if isinstance(payload, dict) else None
    config_path = data.get("config_path") if isinstance(data, dict) else None
    if not isinstance(config_path, str):
        return _error_result(exit_code=1, code="TOKEN_NOT_FOUND", message="CLI login token missing")

    resolved_path = Path(config_path).resolve()
    temp_root = Path(temp_dir).resolve()
    if not resolved_path.is_relative_to(temp_root):
        return _error_result(exit_code=1, code="UNSAFE_CONFIG_PATH", message="Unsafe CLI config path")

    try:
        config = json.loads(resolved_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return _error_result(
            exit_code=1,
            code="TOKEN_NOT_FOUND",
            message="Unable to read CLI login token",
            detail={"reason": type(exc).__name__},
        )
    access_token = config.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        return _error_result(exit_code=1, code="TOKEN_NOT_FOUND", message="CLI login token missing")

    safe_data = {
        "access_token": access_token,
        "token_type": config.get("token_type", "bearer"),
        "user": config.get("user") if isinstance(config.get("user"), dict) else data.get("user"),
    }
    return {"ok": True, "exit_code": 0, "payload": {"ok": True, "data": safe_data}, "stderr": ""}


def _build_command(args: list[str], *, base_url: str, timeout_seconds: float) -> list[str]:
    clean_args = [str(arg) for arg in args]
    return [
        sys.executable,
        "-m",
        "lsm_cli",
        *clean_args,
        "--base-url",
        base_url,
        "--timeout",
        str(timeout_seconds),
    ]


def _parse_process_output(*, exit_code: int, stdout: str, stderr: str) -> dict[str, Any]:
    if not stdout:
        return _error_result(
            exit_code=exit_code,
            code="EMPTY_STDOUT",
            message="lsm_cli returned empty stdout",
            detail={"stderr": stderr},
        )

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return _error_result(
            exit_code=exit_code,
            code="INVALID_JSON_STDOUT",
            message="lsm_cli stdout is not valid JSON",
            detail={"stdout": stdout[:STDOUT_PREVIEW_CHARS], "stderr": stderr},
        )

    if not isinstance(payload, dict):
        return _error_result(
            exit_code=exit_code,
            code="INVALID_JSON_SHAPE",
            message="lsm_cli stdout JSON must be an object",
            detail={"stdout": payload},
        )

    return {
        "ok": exit_code == 0 and payload.get("ok") is True,
        "exit_code": exit_code,
        "payload": payload,
        "stderr": stderr,
    }


def _error_result(
    *,
    exit_code: int,
    code: str,
    message: str,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if detail:
        error["detail"] = detail
    return {"ok": False, "exit_code": exit_code, "error": error}


def _read_text_env(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value or default


def _read_float_env(name: str, default: float) -> float:
    raw_value = os.getenv(name, "").strip()
    if not raw_value:
        return default
    try:
        value = float(raw_value)
    except ValueError:
        return default
    return value if value > 0 else default


def _safe_text(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        return value
    return ""
