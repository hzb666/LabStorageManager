"""Wechat callback signature verification."""

from hashlib import sha1
from hmac import compare_digest


def verify_wechat_signature(
    *,
    token: str,
    signature: str | None,
    timestamp: str | None,
    nonce: str | None,
) -> bool:
    """Verify the Wechat public account callback signature."""

    if not token or not signature or not timestamp or not nonce:
        return False

    payload = "".join(sorted([token, timestamp, nonce])).encode("utf-8")
    expected = sha1(payload).hexdigest()
    return compare_digest(expected, signature)
