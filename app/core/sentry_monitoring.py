"""Sentry runtime initialization."""
from __future__ import annotations

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from app.core.config import settings


def init_sentry() -> bool:
    """Initialize Sentry once when a backend DSN is configured."""
    dsn = settings.sentry_dsn.strip()
    if not dsn:
        return False

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.sentry_environment.strip() or settings.env,
        release=f"{settings.app_name}@{settings.app_version}",
        send_default_pii=settings.sentry_send_default_pii,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
    )
    return True
