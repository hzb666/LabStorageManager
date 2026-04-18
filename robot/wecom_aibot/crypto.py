"""Enterprise WeChat callback encryption helpers."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import struct
import time
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

AES_KEY_LENGTH = 32
ENCODING_AES_KEY_LENGTH = 43
PKCS7_BLOCK_SIZE = 32


class WecomCryptoError(ValueError):
    """Base class for callback crypto failures."""


class InvalidWecomSignatureError(WecomCryptoError):
    """Raised when msg_signature does not match the encrypted body."""


class InvalidEncodingAesKeyError(WecomCryptoError):
    """Raised when EncodingAESKey is malformed."""


class InvalidCipherTextError(WecomCryptoError):
    """Raised when callback ciphertext cannot be decrypted or parsed."""


def generate_signature(token: str, timestamp: str, nonce: str, encrypted: str) -> str:
    pieces = sorted([token, timestamp, nonce, encrypted])
    return hashlib.sha1("".join(pieces).encode("utf-8")).hexdigest()


def verify_signature(token: str, signature: str, timestamp: str, nonce: str, encrypted: str) -> None:
    expected = generate_signature(token, timestamp, nonce, encrypted)
    if not hmac.compare_digest(expected, signature):
        raise InvalidWecomSignatureError("invalid msg_signature")


def _decode_aes_key(encoding_aes_key: str) -> bytes:
    if len(encoding_aes_key) != ENCODING_AES_KEY_LENGTH:
        raise InvalidEncodingAesKeyError("EncodingAESKey must be 43 characters")
    try:
        key = base64.b64decode(encoding_aes_key + "=", validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidEncodingAesKeyError("invalid EncodingAESKey base64") from exc
    if len(key) != AES_KEY_LENGTH:
        raise InvalidEncodingAesKeyError("decoded EncodingAESKey must be 32 bytes")
    return key


def _pad(data: bytes) -> bytes:
    amount = PKCS7_BLOCK_SIZE - (len(data) % PKCS7_BLOCK_SIZE)
    if amount == 0:
        amount = PKCS7_BLOCK_SIZE
    return data + bytes([amount]) * amount


def _unpad(data: bytes) -> bytes:
    if not data:
        raise InvalidCipherTextError("empty plaintext")
    amount = data[-1]
    if amount < 1 or amount > PKCS7_BLOCK_SIZE:
        raise InvalidCipherTextError("invalid padding")
    if data[-amount:] != bytes([amount]) * amount:
        raise InvalidCipherTextError("invalid padding bytes")
    return data[:-amount]


def _aes_encrypt(key: bytes, plaintext: bytes) -> bytes:
    encryptor = Cipher(algorithms.AES(key), modes.CBC(key[:16])).encryptor()
    return encryptor.update(_pad(plaintext)) + encryptor.finalize()


def _aes_decrypt(key: bytes, ciphertext: bytes) -> bytes:
    decryptor = Cipher(algorithms.AES(key), modes.CBC(key[:16])).decryptor()
    return _unpad(decryptor.update(ciphertext) + decryptor.finalize())


@dataclass(frozen=True)
class WecomAesCipher:
    token: str
    encoding_aes_key: str
    receive_id: str = ""

    @property
    def key(self) -> bytes:
        return _decode_aes_key(self.encoding_aes_key)

    def verify_url(self, signature: str, timestamp: str, nonce: str, echostr: str) -> str:
        verify_signature(self.token, signature, timestamp, nonce, echostr)
        return self.decrypt_plaintext(echostr)

    def decrypt_callback(
        self,
        encrypted: str,
        *,
        signature: str,
        timestamp: str,
        nonce: str,
    ) -> dict[str, Any]:
        verify_signature(self.token, signature, timestamp, nonce, encrypted)
        plaintext = self.decrypt_plaintext(encrypted)
        try:
            payload = json.loads(plaintext)
        except json.JSONDecodeError as exc:
            raise InvalidCipherTextError("decrypted callback is not JSON") from exc
        if not isinstance(payload, dict):
            raise InvalidCipherTextError("decrypted callback must be a JSON object")
        return payload

    def decrypt_plaintext(self, encrypted: str) -> str:
        try:
            ciphertext = base64.b64decode(encrypted)
        except (binascii.Error, ValueError) as exc:
            raise InvalidCipherTextError("ciphertext is not base64") from exc
        plain = _aes_decrypt(self.key, ciphertext)
        if len(plain) < 20:
            raise InvalidCipherTextError("plaintext is too short")
        msg_len = struct.unpack("!I", plain[16:20])[0]
        msg_start = 20
        msg_end = msg_start + msg_len
        message = plain[msg_start:msg_end]
        receive_id = plain[msg_end:].decode("utf-8")
        if receive_id != self.receive_id:
            raise InvalidCipherTextError("receive_id mismatch")
        return message.decode("utf-8")

    def encrypt_payload(
        self,
        payload: dict[str, Any],
        *,
        timestamp: str | None = None,
        nonce: str | None = None,
    ) -> dict[str, Any]:
        timestamp = timestamp or str(int(time.time()))
        nonce = nonce or secrets.token_hex(8)
        message = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        plaintext = secrets.token_bytes(16) + struct.pack("!I", len(message))
        plaintext += message + self.receive_id.encode("utf-8")
        encrypted = base64.b64encode(_aes_encrypt(self.key, plaintext)).decode("ascii")
        return {
            "encrypt": encrypted,
            "msgsignature": generate_signature(self.token, timestamp, nonce, encrypted),
            "timestamp": timestamp,
            "nonce": nonce,
        }

