"""Safe subprocess wrapper around the LabStorageManager CLI."""

from __future__ import annotations

import json
import logging
import os
import re
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
CLI_TOKEN_ENV = "LSM_CLI_TOKEN"
MAX_SAFE_ERROR_TEXT_LENGTH = 120
SAFE_ERROR_CODE_PATTERN = re.compile(r"^[A-Z0-9_:-]{1,80}$")
CHILD_PROCESS_ENV_ALLOWLIST = (
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
)
SENSITIVE_VALUE_PATTERN = re.compile(
    r"(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{20,}\.)",
    re.IGNORECASE,
)
OUTPUT_ERROR_MESSAGES = {
    "CLI_TIMEOUT": "lsm_cli timed out",
    "EMPTY_STDOUT": "lsm_cli returned empty stdout",
    "INVALID_JSON_STDOUT": "lsm_cli stdout is not valid JSON",
    "INVALID_JSON_SHAPE": "lsm_cli stdout JSON must be an object",
}
STATUS_CODE_BY_EXIT_CODE = {
    2: 401,
    3: 403,
    4: 404,
    5: 429,
    7: 400,
    8: 400,
    9: 503,
}
ERROR_CATEGORY_BY_EXIT_CODE = {
    2: "auth",
    3: "permission",
    4: "not_found",
    5: "rate_limit",
    7: "validation",
    8: "validation",
    9: "network",
}
PUBLIC_MESSAGE_BY_CATEGORY = {
    "auth": "认证失败或登录已过期",
    "permission": "当前账号没有权限执行该操作",
    "not_found": "没有找到对应记录",
    "rate_limit": "请求太频繁，请稍后再试",
    "validation": "参数不完整或格式不正确",
    "network": "后端服务暂时不可达",
    "server": "后端服务异常",
    "unknown": "系统异常",
}
LLM_HINT_BY_CATEGORY = {
    "auth": "请提示用户重新绑定或重新登录后再试。",
    "permission": "请说明当前账号没有权限，避免继续重试同一操作。",
    "not_found": "请提示用户确认名称、CAS、编号或记录 ID 是否正确。",
    "rate_limit": "请提示用户稍后重试，不要立即重复调用。",
    "validation": "请根据 fields 修正参数；如果缺少必要字段，请向用户追问。",
    "network": "后端暂时不可达，可以稍后重试。",
    "server": "后端发生异常，请保留 request_id 并提示稍后重试。",
    "unknown": "错误原因不明确，请避免猜测内部细节，向用户给出安全失败提示。",
}
RETRYABLE_CATEGORIES = {"network", "server", "rate_limit"}
VALIDATION_LOCATION_PREFIXES = {"body", "query", "path", "header", "cookie"}

logger = logging.getLogger(__name__)

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

    extra_env = {CLI_TOKEN_ENV: resolved_token} if resolved_token else None
    return _run_command(command, timeout_seconds=timeout_seconds, extra_env=extra_env)


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
            env=_build_subprocess_env(extra_env),
        )
    except subprocess.TimeoutExpired as exc:
        _log_cli_output_error(
            "CLI_TIMEOUT",
            exit_code=9,
            stdout=_safe_text(exc.stdout),
            stderr=_safe_text(exc.stderr),
        )
        return _error_result(
            exit_code=9,
            code="CLI_TIMEOUT",
            message=OUTPUT_ERROR_MESSAGES["CLI_TIMEOUT"],
            detail={"timeout_seconds": timeout_seconds},
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


def _build_subprocess_env(extra_env: dict[str, str] | None = None) -> dict[str, str]:
    env = {
        name: value
        for name in CHILD_PROCESS_ENV_ALLOWLIST
        if (value := os.getenv(name))
    }
    safe_home = str(Path(tempfile.gettempdir()) / "lsm-mcp-cli-home")
    env.update(
        {
            "APPDATA": safe_home,
            "HOME": safe_home,
            "PYTHONIOENCODING": "utf-8",
            "PYTHONPATH": str(REPO_ROOT),
        }
    )
    env.update({key: str(value) for key, value in (extra_env or {}).items()})
    return env


def _parse_process_output(*, exit_code: int, stdout: str, stderr: str) -> dict[str, Any]:
    if not stdout:
        _log_cli_output_error("EMPTY_STDOUT", exit_code=exit_code, stdout=stdout, stderr=stderr)
        return _error_result(
            exit_code=exit_code,
            code="EMPTY_STDOUT",
            message=OUTPUT_ERROR_MESSAGES["EMPTY_STDOUT"],
        )

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        _log_cli_output_error(
            "INVALID_JSON_STDOUT",
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
        )
        return _error_result(
            exit_code=exit_code,
            code="INVALID_JSON_STDOUT",
            message=OUTPUT_ERROR_MESSAGES["INVALID_JSON_STDOUT"],
        )

    if not isinstance(payload, dict):
        _log_cli_output_error(
            "INVALID_JSON_SHAPE",
            exit_code=exit_code,
            stdout=stdout,
            stderr=stderr,
        )
        return _error_result(
            exit_code=exit_code,
            code="INVALID_JSON_SHAPE",
            message=OUTPUT_ERROR_MESSAGES["INVALID_JSON_SHAPE"],
        )

    is_success = exit_code == 0 and payload.get("ok") is True
    return {
        "ok": is_success,
        "exit_code": exit_code,
        "payload": payload if is_success else _build_safe_cli_payload(payload, exit_code=exit_code),
        "stderr": "",
    }


def _build_safe_cli_payload(payload: dict[str, Any], *, exit_code: int) -> dict[str, Any]:
    raw_error = payload.get("error")
    error = raw_error if isinstance(raw_error, dict) else {}
    code = _safe_error_code(error.get("code")) or "CLI_ERROR"
    detail = error.get("detail")
    status_code = _extract_status_code(detail) or STATUS_CODE_BY_EXIT_CODE.get(exit_code)
    fields = _extract_safe_validation_fields(detail)
    category = _resolve_error_category(
        exit_code=exit_code,
        code=code,
        status_code=status_code,
        has_fields=bool(fields),
    )

    safe_error: dict[str, Any] = {
        "code": code,
        "message": PUBLIC_MESSAGE_BY_CATEGORY[category],
        "category": category,
        "retryable": category in RETRYABLE_CATEGORIES,
        "llm_hint": LLM_HINT_BY_CATEGORY[category],
    }
    if status_code is not None:
        safe_error["status_code"] = status_code
    if fields:
        safe_error["fields"] = fields
    request_id = _extract_request_id(detail)
    if request_id:
        safe_error["request_id"] = request_id
    return {"ok": False, "error": safe_error}


def _safe_error_code(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    if SAFE_ERROR_CODE_PATTERN.fullmatch(normalized):
        return normalized
    return None


def _resolve_error_category(
    *,
    exit_code: int,
    code: str,
    status_code: int | None,
    has_fields: bool,
) -> str:
    if has_fields:
        return "validation"
    if exit_code in ERROR_CATEGORY_BY_EXIT_CODE:
        return ERROR_CATEGORY_BY_EXIT_CODE[exit_code]
    if status_code in {400, 409, 422}:
        return "validation"
    if status_code == 401:
        return "auth"
    if status_code == 403:
        return "permission"
    if status_code == 404:
        return "not_found"
    if status_code == 429:
        return "rate_limit"
    if status_code is not None and status_code >= 500:
        return "server"
    if code in {"NETWORK_ERROR", "CLI_TIMEOUT", "EMPTY_STDOUT", "INVALID_JSON_STDOUT"}:
        return "network"
    return "unknown"


def _extract_status_code(value: Any) -> int | None:
    if isinstance(value, dict):
        raw_status = value.get("status_code")
        if isinstance(raw_status, int) and 100 <= raw_status <= 599:
            return raw_status
        for key in ("response", "payload", "error", "detail"):
            status_code = _extract_status_code(value.get(key))
            if status_code is not None:
                return status_code
    return None


def _extract_request_id(value: Any) -> str | None:
    if isinstance(value, dict):
        for key in ("request_id", "X-Request-ID", "x-request-id"):
            request_id = _safe_short_text(value.get(key))
            if request_id:
                return request_id
        for key in ("response", "payload", "error", "detail"):
            request_id = _extract_request_id(value.get(key))
            if request_id:
                return request_id
    return None


def _extract_safe_validation_fields(value: Any) -> list[dict[str, str]]:
    issues = _find_validation_issues(value)
    if not issues:
        return []
    fields: list[dict[str, str]] = []
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        field_name = _validation_field_name(issue.get("loc"))
        reason = _safe_short_text(issue.get("type")) or "invalid"
        item = {"name": field_name or "unknown", "reason": reason}
        message = _safe_short_text(issue.get("msg"))
        if message:
            item["message"] = message
        fields.append(item)
    return fields


def _find_validation_issues(value: Any) -> list[Any] | None:
    if isinstance(value, list):
        return value if any(isinstance(item, dict) and "loc" in item for item in value) else None
    if isinstance(value, dict):
        for key in ("detail", "response", "payload", "error"):
            issues = _find_validation_issues(value.get(key))
            if issues is not None:
                return issues
    return None


def _validation_field_name(value: Any) -> str | None:
    if not isinstance(value, (list, tuple)):
        return _safe_short_text(value)
    for part in reversed(value):
        text = _safe_short_text(part)
        if text and text not in VALIDATION_LOCATION_PREFIXES:
            return text
    return None


def _safe_short_text(value: Any) -> str | None:
    if not isinstance(value, (str, int)):
        return None
    text = " ".join(str(value).strip().split())
    if not text:
        return None
    text = SENSITIVE_VALUE_PATTERN.sub("[redacted]", text)
    if len(text) > MAX_SAFE_ERROR_TEXT_LENGTH:
        return f"{text[:MAX_SAFE_ERROR_TEXT_LENGTH - 3]}..."
    return text


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


def _log_cli_output_error(code: str, *, exit_code: int, stdout: str, stderr: str) -> None:
    logger.warning(
        "lsm_cli_output_error code=%s exit_code=%s stdout_chars=%s stderr_chars=%s",
        code,
        exit_code,
        len(stdout),
        len(stderr),
    )


def _safe_text(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        return value
    return ""
