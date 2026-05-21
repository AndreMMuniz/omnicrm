"""HMAC-SHA256 deterministic hashing for searchable PII fields.

AES-256-GCM (used by EncryptedString) is non-deterministic — the same
plaintext produces a different ciphertext every call due to random nonce.
This makes WHERE email = encrypt(value) impossible.

Solution: store a parallel hash column (email_hash, phone_hash) computed
with HMAC-SHA256 so we can do indexed lookups without exposing plaintext.

Key is loaded from DATABASE_HMAC_KEY env var (separate from DATABASE_ENCRYPTION_KEY).
Dev mode (no key): falls back to plain SHA-256 — never use in production.
"""

import hashlib
import hmac
import os

_HMAC_KEY: bytes | None = None
_raw = os.getenv("DATABASE_HMAC_KEY", "")
if _raw:
    _HMAC_KEY = _raw.encode("utf-8")


def hash_identifier(value: str | None) -> str | None:
    """Return a 64-char hex digest suitable for a lookup index column.

    Always normalises to lowercase + strip before hashing so that
    hash_identifier("Maria@EMPRESA.com") == hash_identifier("maria@empresa.com").
    Returns None for None / empty string.
    """
    if not value:
        return None
    normalised = value.strip().lower()
    if _HMAC_KEY:
        return hmac.new(_HMAC_KEY, normalised.encode("utf-8"), hashlib.sha256).hexdigest()
    # Dev fallback — deterministic but keyless; log a warning once.
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()
