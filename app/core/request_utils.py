"""
Request-related helpers.
"""

import ipaddress
import uuid
from contextvars import ContextVar, Token

from fastapi import Request

from app.core.config import settings

_current_sse_client_id: ContextVar[str | None] = ContextVar("current_sse_client_id", default=None)


def _normalize_ip_candidate(raw_value: str) -> str:
    value = raw_value.strip()
    if not value:
        return ""

    # 处理 Forwarded/X-Forwarded-For 常见格式: for=1.2.3.4
    if value.lower().startswith("for="):
        value = value[4:].strip().strip('"')

    # 处理 [IPv6]:port
    if value.startswith("[") and "]" in value:
        value = value[1:value.index("]")]
        return value.strip()

    # 处理 IPv4:port
    if value.count(":") == 1 and "." in value:
        host, _, _port = value.partition(":")
        return host.strip()

    return value


def _is_valid_ip(ip_str: str) -> bool:
    try:
        ipaddress.ip_address(ip_str)
        return True
    except ValueError:
        return False


def get_client_ip(request: Request) -> str:
    """
    Resolve client IP address with optional trusted proxy support.
    """
    if settings.trust_proxy_headers:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # 信任代理时优先使用 X-Forwarded-For 的首个地址（原始客户端地址）
            for part in forwarded_for.split(","):
                candidate = _normalize_ip_candidate(part)
                if _is_valid_ip(candidate):
                    return candidate

        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            candidate = _normalize_ip_candidate(real_ip)
            if _is_valid_ip(candidate):
                return candidate

    client_host = request.client.host if request.client else "unknown"
    normalized_host = _normalize_ip_candidate(client_host)
    if _is_valid_ip(normalized_host):
        return normalized_host
    return client_host


def get_request_id(request: Request) -> str:
    """Return request id from state/header or generate fallback value."""
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        return str(request_id)

    header_request_id = request.headers.get("X-Request-ID")
    if header_request_id:
        return header_request_id.strip()

    return str(uuid.uuid4())


def get_sse_client_id(request: Request) -> str | None:
    """Read current tab SSE client id from request headers when provided."""
    client_id = request.headers.get("X-SSE-Client-Id", "").strip()
    return client_id or None


def set_current_sse_client_id(client_id: str | None) -> Token[str | None]:
    """Bind current request's SSE client id into context for downstream broadcasts."""
    return _current_sse_client_id.set(client_id)


def reset_current_sse_client_id(token: Token[str | None]) -> None:
    """Clear request-scoped SSE client id context."""
    _current_sse_client_id.reset(token)


def get_current_sse_client_id() -> str | None:
    """Return request-scoped SSE client id for the active mutation request."""
    return _current_sse_client_id.get()
