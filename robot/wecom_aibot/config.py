"""Settings for the Enterprise WeChat intelligent robot."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class WecomAibotSettings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=("robot/.env", ".env"),
        env_prefix="WECOM_AIBOT_",
        extra="ignore",
    )

    mode: Literal["websocket", "webhook"] = "websocket"
    bot_id: str = ""
    secret: str = ""
    token: str = ""
    encoding_aes_key: str = ""
    receive_id: str = ""
    ws_url: str = "wss://openws.work.weixin.qq.com"
    state_db: Path = Path("robot/wecom_aibot_state.db")
    search_limit: int = Field(default=5, ge=1, le=10)
    low_stock_threshold: float = Field(default=0.2, ge=0, le=1)
    callback_max_body_bytes: int = Field(default=1_048_576, ge=1024)
    welcome_text: str = "你好，我是实验室库存助手。可以问我库存、位置、低库存和借用状态。"

    @field_validator(
        "bot_id",
        "secret",
        "token",
        "encoding_aes_key",
        "receive_id",
        "ws_url",
        "welcome_text",
        mode="before",
    )
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    def require_webhook(self) -> None:
        missing = [
            name
            for name, value in (
                ("WECOM_AIBOT_TOKEN", self.token),
                ("WECOM_AIBOT_ENCODING_AES_KEY", self.encoding_aes_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError("Missing webhook settings: " + ", ".join(missing))

    def require_websocket(self) -> None:
        missing = [
            name
            for name, value in (
                ("WECOM_AIBOT_BOT_ID", self.bot_id),
                ("WECOM_AIBOT_SECRET", self.secret),
            )
            if not value
        ]
        if missing:
            raise RuntimeError("Missing websocket settings: " + ", ".join(missing))


@lru_cache
def get_settings() -> WecomAibotSettings:
    return WecomAibotSettings()

