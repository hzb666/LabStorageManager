"""Security helpers for WeChat callback verification."""

import hashlib


def verify_wechat_signature(token: str, signature: str, timestamp: str, nonce: str) -> bool:
    values = sorted([token, timestamp, nonce])
    sign = hashlib.sha1("".join(values).encode("utf-8")).hexdigest()
    return sign == signature
