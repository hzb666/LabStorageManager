from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import requests

from lsm_cli.config import DEFAULT_BASE_URL, load_config

CLI_TOKEN_ENV = "LSM_CLI_TOKEN"


class CLIRequestError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.payload = payload


class CLILocalInputError(Exception):
    pass


class CLINetworkError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def parse_key_value_pairs(pairs: list[str] | None) -> dict[str, Any]:
    params: dict[str, Any] = {}
    for pair in pairs or []:
        if "=" not in pair:
            raise CLILocalInputError(f"Invalid key=value pair: {pair}")
        key, value = pair.split("=", 1)
        params[key] = value
    return params


def load_json_payload(
    inline_json: str | None,
    file_path: str | None,
    *,
    required: bool = False,
) -> dict[str, Any] | None:
    # CLI 只允许一个 payload 来源，避免 inline JSON 和文件内容互相覆盖。
    if inline_json and file_path:
        raise CLILocalInputError("Use either --data-json or --data-file, not both")
    if not inline_json and not file_path:
        if required:
            raise CLILocalInputError("This command requires a JSON object payload")
        return None

    if inline_json:
        payload = json.loads(inline_json)
    else:
        try:
            payload = json.loads(Path(file_path).read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise
        except (OSError, UnicodeDecodeError) as exc:
            raise CLILocalInputError(
                f"Unable to read JSON payload file `{file_path}`: {exc}"
            ) from exc

    if not isinstance(payload, dict):
        raise CLILocalInputError("JSON payload must be an object")
    return payload


class APIClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = 5.0,
        use_env_token: bool = True,
    ) -> None:
        config = load_config()
        # `--token` 和 `--base-url` 应能覆盖本地配置，方便 agent 在单次调用里切换目标。
        resolved_base_url = base_url or str(config.get("base_url") or DEFAULT_BASE_URL)
        self.base_url = resolved_base_url.rstrip("/")
        self.timeout = timeout
        env_token = get_env_token() if use_env_token else ""
        config_token = config.get("access_token")
        self.token = token or env_token or config_token
        self.token_source = _resolve_token_source(
            argument_token=token,
            env_token=env_token,
            config_token=config_token,
        )
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "LabStorageManager CLI",
            }
        )
        if self.token:
            self.session.headers["Authorization"] = f"Bearer {self.token}"

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.base_url}/{path.lstrip('/')}"
        try:
            response = self.session.request(
                method=method.upper(),
                url=url,
                params=params,
                json=json_body,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise CLINetworkError(str(exc)) from exc

        try:
            # 统一把非 JSON 响应折叠成 detail，避免上层错误输出分叉成多种格式。
            payload = response.json()
        except ValueError:
            payload = {"detail": response.text or response.reason}

        if response.ok:
            return payload

        detail = payload.get("detail") if isinstance(payload, dict) else payload
        raise CLIRequestError(
            str(detail or f"HTTP {response.status_code}"),
            status_code=response.status_code,
            payload=payload,
        )


def get_env_token() -> str:
    return os.getenv(CLI_TOKEN_ENV, "").strip()


def _resolve_token_source(
    *,
    argument_token: str | None,
    env_token: str,
    config_token: Any,
) -> str:
    if argument_token:
        return "argument"
    if env_token:
        return "environment"
    if config_token:
        return "config"
    return "none"
