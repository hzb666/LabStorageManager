"""
Request-related helpers.
"""

from fastapi import Request

from app.core.config import settings


def get_client_ip(request: Request) -> str:
    """
    Resolve client IP address with optional trusted proxy support.
    """
    if settings.trust_proxy_headers:
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()

        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            forwarded_chain = [part.strip() for part in forwarded_for.split(",") if part.strip()]
            if forwarded_chain:
                # Prefer the closest trusted proxy-added address instead of a client-supplied first hop.
                return forwarded_chain[-1]

    return request.client.host if request.client else "unknown"
