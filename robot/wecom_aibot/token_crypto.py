"""Encrypt and decrypt persisted LabStorageManager access tokens."""

from __future__ import annotations

import base64
import binascii
import hashlib
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

TOKEN_CIPHER_PREFIX = "v1:"
TOKEN_NONCE_BYTES = 12
MIN_ENCRYPTED_TOKEN_BYTES = TOKEN_NONCE_BYTES + 16


class TokenCryptoError(ValueError):
    """Raised when a robot binding token cannot be encrypted or decrypted."""


class TokenCipher:
    """Small AES-GCM wrapper for robot binding tokens."""

    def __init__(self, secret: str) -> None:
        clean_secret = secret.strip()
        if not clean_secret:
            raise TokenCryptoError("Token encryption key is empty")
        self._key = hashlib.sha256(clean_secret.encode("utf-8")).digest()

    def encrypt(self, token: str) -> str:
        clean_token = token.strip()
        if not clean_token:
            raise TokenCryptoError("Access token is empty")
        nonce = secrets.token_bytes(TOKEN_NONCE_BYTES)
        ciphertext = AESGCM(self._key).encrypt(nonce, clean_token.encode("utf-8"), None)
        return TOKEN_CIPHER_PREFIX + _encode_token_bytes(nonce + ciphertext)

    def decrypt(self, value: str) -> str:
        if not is_encrypted_token(value):
            return value
        raw_value = _decode_token_bytes(value[len(TOKEN_CIPHER_PREFIX) :])
        if len(raw_value) < MIN_ENCRYPTED_TOKEN_BYTES:
            raise TokenCryptoError("Encrypted token payload is too short")
        nonce = raw_value[:TOKEN_NONCE_BYTES]
        ciphertext = raw_value[TOKEN_NONCE_BYTES:]
        try:
            plaintext = AESGCM(self._key).decrypt(nonce, ciphertext, None)
        except InvalidTag as exc:
            raise TokenCryptoError("Encrypted token authentication failed") from exc
        try:
            return plaintext.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise TokenCryptoError("Encrypted token is not UTF-8") from exc


def is_encrypted_token(value: str) -> bool:
    return value.startswith(TOKEN_CIPHER_PREFIX)


def _encode_token_bytes(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode_token_bytes(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode((value + padding).encode("ascii"))
    except (binascii.Error, ValueError, UnicodeEncodeError) as exc:
        raise TokenCryptoError("Encrypted token payload is invalid base64") from exc
