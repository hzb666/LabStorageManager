"""Shared TLS verification setup for outbound HTTP clients."""
from functools import lru_cache
from ssl import SSLContext

import httpx


@lru_cache(maxsize=1)
def get_ssl_context() -> SSLContext:
    # Loading the trust store is expensive on Windows. Sharing an immutable
    # context preserves HTTPX's certificate/environment behavior across clients.
    return httpx.create_ssl_context()
