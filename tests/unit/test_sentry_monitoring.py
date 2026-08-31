from app.core import sentry_monitoring
from app.core.config import Settings


def test_settings_parse_sentry_environment(monkeypatch) -> None:
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "production")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.05")
    monkeypatch.setenv("SENTRY_SEND_DEFAULT_PII", "true")

    settings = Settings(_env_file=None)

    assert settings.sentry_dsn == "https://public@example.ingest.sentry.io/1"
    assert settings.sentry_environment == "production"
    assert settings.sentry_traces_sample_rate == 0.05
    assert settings.sentry_send_default_pii is True


def test_init_sentry_skips_when_dsn_empty(monkeypatch) -> None:
    calls: list[dict] = []
    monkeypatch.setattr(sentry_monitoring.settings, "sentry_dsn", "")
    monkeypatch.setattr(sentry_monitoring.sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    assert sentry_monitoring.init_sentry() is False
    assert calls == []


def test_init_sentry_configures_fastapi_integrations(monkeypatch) -> None:
    calls: list[dict] = []
    monkeypatch.setattr(sentry_monitoring.settings, "sentry_dsn", "https://dsn.example/1")
    monkeypatch.setattr(sentry_monitoring.settings, "sentry_environment", "production")
    monkeypatch.setattr(sentry_monitoring.settings, "app_name", "Lab Storage Manager")
    monkeypatch.setattr(sentry_monitoring.settings, "app_version", "0.5.0")
    monkeypatch.setattr(sentry_monitoring.settings, "sentry_traces_sample_rate", 0.05)
    monkeypatch.setattr(sentry_monitoring.settings, "sentry_send_default_pii", False)
    monkeypatch.setattr(sentry_monitoring.sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    assert sentry_monitoring.init_sentry() is True

    init_kwargs = calls[0]
    assert init_kwargs["dsn"] == "https://dsn.example/1"
    assert init_kwargs["environment"] == "production"
    assert init_kwargs["release"] == "Lab Storage Manager@0.5.0"
    assert init_kwargs["traces_sample_rate"] == 0.05
    assert init_kwargs["send_default_pii"] is False
    assert {type(item).__name__ for item in init_kwargs["integrations"]} == {
        "StarletteIntegration",
        "FastApiIntegration",
    }
