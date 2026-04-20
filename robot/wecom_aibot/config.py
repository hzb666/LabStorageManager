"""Settings for the Enterprise WeChat intelligent robot."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
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
    environment: str = Field(
        default="development",
        validation_alias=AliasChoices("ENV", "APP_ENV", "WECOM_AIBOT_ENV"),
    )
    token_encryption_key: str = Field(
        default="",
        validation_alias=AliasChoices("WECOM_AIBOT_TOKEN_ENCRYPTION_KEY"),
    )
    allow_plaintext_token_storage: bool = Field(
        default=True,
        validation_alias=AliasChoices("WECOM_AIBOT_ALLOW_PLAINTEXT_TOKEN_STORAGE"),
    )
    search_limit: int = Field(default=5, ge=1, le=10)
    low_stock_threshold: float = Field(default=0.2, ge=0, le=1)
    callback_max_body_bytes: int = Field(default=1_048_576, ge=1024)
    welcome_text: str = "你好，我是实验室库存助手。可以问我库存、位置、低库存和借用状态。"
    mcp_url: str = Field(
        default="http://127.0.0.1:8030/mcp",
        validation_alias=AliasChoices("LSM_MCP_URL", "WECOM_AIBOT_MCP_URL"),
    )
    mcp_timeout_seconds: float = Field(
        default=15.0,
        ge=1,
        le=120,
        validation_alias=AliasChoices("LSM_MCP_TIMEOUT_SECONDS", "WECOM_AIBOT_MCP_TIMEOUT_SECONDS"),
    )
    web_search_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("WECOM_AIBOT_WEB_SEARCH_ENABLED"),
    )
    minimax_api_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "WECOM_AIBOT_MINIMAX_API_KEY",
            "MINIMAX_API_KEY",
            "OPENAI_API_KEY",
        ),
    )
    minimax_api_host: str = Field(
        default="https://api.minimaxi.com",
        validation_alias=AliasChoices("WECOM_AIBOT_MINIMAX_API_HOST", "MINIMAX_API_HOST"),
    )
    minimax_mcp_command: str = Field(
        default="uvx",
        validation_alias=AliasChoices("WECOM_AIBOT_MINIMAX_MCP_COMMAND"),
    )
    minimax_mcp_timeout_seconds: float = Field(
        default=25.0,
        ge=3,
        le=120,
        validation_alias=AliasChoices("WECOM_AIBOT_MINIMAX_MCP_TIMEOUT_SECONDS"),
    )
    llm_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("WECOM_AIBOT_LLM_API_KEY", "OPENAI_API_KEY"),
    )
    llm_model: str = Field(
        default="gpt-5",
        validation_alias=AliasChoices("WECOM_AIBOT_LLM_MODEL", "OPENAI_MODEL"),
    )
    llm_base_url: str = Field(
        default="",
        validation_alias=AliasChoices("WECOM_AIBOT_LLM_BASE_URL", "OPENAI_BASE_URL"),
    )
    llm_responses_url: str = Field(
        default="https://api.openai.com/v1/responses",
        validation_alias=AliasChoices("WECOM_AIBOT_LLM_RESPONSES_URL", "OPENAI_RESPONSES_URL"),
    )
    llm_timeout_seconds: float = Field(default=8.0, ge=1, le=60)
    llm_max_output_tokens: int = Field(default=400, ge=64, le=2000)

    @field_validator(
        "bot_id",
        "secret",
        "token",
        "encoding_aes_key",
        "receive_id",
        "ws_url",
        "welcome_text",
        "mcp_url",
        "environment",
        "token_encryption_key",
        "minimax_api_key",
        "minimax_api_host",
        "minimax_mcp_command",
        "llm_api_key",
        "llm_model",
        "llm_base_url",
        "llm_responses_url",
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

    def require_token_storage(self) -> None:
        if not self._is_development_runtime() and not self.token_encryption_key:
            raise RuntimeError(
                "Missing token storage setting: WECOM_AIBOT_TOKEN_ENCRYPTION_KEY"
            )

    def conversation_store_options(self) -> dict[str, str | bool]:
        return {
            "token_encryption_key": self.token_encryption_key,
            "allow_plaintext_tokens": (
                self._is_development_runtime() and self.allow_plaintext_token_storage
            ),
        }

    def _is_development_runtime(self) -> bool:
        return self.environment.lower() in {"", "development", "dev", "local", "test", "testing"}


@lru_cache
def get_settings() -> WecomAibotSettings:
    return WecomAibotSettings()
