import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from typing import Any

from app.core.config import settings

LOCAL_AUTH_ID_PREFIX = "local:"
PBKDF2_ITERATIONS = 200_000
ACCESS_TOKEN_TTL_SECONDS = 3600
REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600


def is_local_auth_id(auth_id: str | None) -> bool:
    return bool(auth_id and auth_id.startswith(LOCAL_AUTH_ID_PREFIX))


def new_local_auth_id() -> str:
    return f"{LOCAL_AUTH_ID_PREFIX}{uuid.uuid4()}"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return "$".join(
        [
            "pbkdf2_sha256",
            str(PBKDF2_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(digest).decode("ascii"),
        ]
    )


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False

    try:
        algorithm, iterations_str, salt_b64, digest_b64 = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_str)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False

    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected)


def issue_access_token(auth_id: str) -> str:
    return _issue_token(auth_id, "access", ACCESS_TOKEN_TTL_SECONDS)


def issue_refresh_token(auth_id: str) -> str:
    return _issue_token(auth_id, "refresh", REFRESH_TOKEN_TTL_SECONDS)


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload_b64, signature_b64 = token.split(".", 1)
    except ValueError as exc:
        raise ValueError("Malformed token") from exc

    expected_signature = hmac.new(
        settings.local_auth_secret.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    actual_signature = _b64url_decode(signature_b64)
    if not hmac.compare_digest(expected_signature, actual_signature):
        raise ValueError("Invalid token signature")

    payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    if payload.get("typ") != expected_type:
        raise ValueError("Invalid token type")
    if int(payload.get("exp", 0)) < int(time.time()):
        raise ValueError("Token expired")
    if not isinstance(payload.get("sub"), str) or not payload["sub"]:
        raise ValueError("Invalid token subject")
    return payload


def _issue_token(auth_id: str, token_type: str, ttl_seconds: int) -> str:
    now = int(time.time())
    payload = {
        "sub": auth_id,
        "typ": token_type,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_json)
    signature = hmac.new(
        settings.local_auth_secret.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{payload_b64}.{_b64url_encode(signature)}"


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))
