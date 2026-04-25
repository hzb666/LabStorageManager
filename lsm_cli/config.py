from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "http://127.0.0.1:8000/api"
CONFIG_DIR_NAME = "LabStorageManager"
CONFIG_FILE_NAME = "cli.json"
FALLBACK_FILE_NAME = ".labstoragemanager-cli.json"


def get_config_path() -> Path:
    # Windows 优先放到 APPDATA，缺失时退回用户目录隐藏文件，避免写进仓库工作区。
    appdata = os.getenv("APPDATA")
    if appdata:
        return Path(appdata) / CONFIG_DIR_NAME / CONFIG_FILE_NAME
    return Path.home() / FALLBACK_FILE_NAME


def load_config() -> dict[str, Any]:
    path = get_config_path()
    if not path.exists():
        return {"base_url": DEFAULT_BASE_URL}
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config, dict):
        raise ValueError("CLI config must be a JSON object")
    return config


def save_config(data: dict[str, Any]) -> Path:
    path = get_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def clear_config() -> Path:
    path = get_config_path()
    if path.exists():
        path.unlink()
    return path


def clear_auth_data() -> Path:
    path = get_config_path()
    config = load_config()
    # logout 清理认证数据，服务地址继续沿用上次配置。
    config.pop("access_token", None)
    config.pop("token_type", None)
    config.pop("user", None)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
