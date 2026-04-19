"""Settings for the WeChat customer service entry."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class WechatKfSettings(BaseSettings):
    """Runtime configuration for WeChat customer service callbacks."""

    model_config = SettingsConfigDict(
        env_file=("robot/.env", ".env"),
        env_prefix="WECHAT_KF_",
        extra="ignore",
        populate_by_name=True,
    )

    corp_id: str = ""
    secret: str = ""
    token: str = ""
    encoding_aes_key: str = ""
    receive_id: str = ""
    open_kfid: str = ""
    api_base_url: str = "https://qyapi.weixin.qq.com"
    state_db: Path = Field(
        default=Path("robot/wecom_aibot_state.db"),
        validation_alias=AliasChoices("WECHAT_KF_STATE_DB", "WECOM_AIBOT_STATE_DB"),
    )
    bind_base_url: str = ""
    bind_token_ttl_minutes: int = Field(default=10, ge=1, le=120)
    callback_max_body_bytes: int = Field(default=1_048_576, ge=1024)
    sync_limit: int = Field(default=100, ge=1, le=1000)
    sync_max_pages: int = Field(default=5, ge=1, le=20)

    @field_validator(
        "corp_id",
        "secret",
        "token",
        "encoding_aes_key",
        "receive_id",
        "open_kfid",
        "api_base_url",
        "bind_base_url",
        mode="before",
    )
    @classmethod
    def strip_text(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip()
            return text.rstrip("/") if text.startswith("http") else text
        return value

    @property
    def callback_receive_id(self) -> str:
        return self.receive_id or self.corp_id

    def require_webhook(self) -> None:
        missing = [
            name
            for name, value in (
                ("WECHAT_KF_CORP_ID", self.corp_id),
                ("WECHAT_KF_TOKEN", self.token),
                ("WECHAT_KF_ENCODING_AES_KEY", self.encoding_aes_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError("Missing WeChat KF webhook settings: " + ", ".join(missing))

    def require_api(self) -> None:
        missing = [
            name
            for name, value in (
                ("WECHAT_KF_CORP_ID", self.corp_id),
                ("WECHAT_KF_SECRET", self.secret),
            )
            if not value
        ]
        if missing:
            raise RuntimeError("Missing WeChat KF API settings: " + ", ".join(missing))


@lru_cache
def get_settings() -> WechatKfSettings:
    return WechatKfSettings()
