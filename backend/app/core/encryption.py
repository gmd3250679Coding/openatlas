"""Symmetric encryption for secrets at rest (Phase 3.1).

Uses Fernet (AES128-CBC + HMAC-SHA256). Key is stored at
`$OPENATLAS_HOME/backend-data/secrets.key` with mode 0600. If the key
file is missing we generate one on first import (idempotent — re-using
the same key means existing rows decrypt correctly).

**Plaintext migration** — at app startup, we run `migrate_plaintext_keys()`
which detects rows whose `api_key_encrypted` does NOT start with
`"fernet:v1:"` and re-encrypts them. The plaintext column is also
written back as the encrypted form.

**Security model**
- The key is local-only (one per OPENATLAS_HOME).
- For multi-host / Phase 4 production, replace with KMS or Vault.
- A row whose value already starts with `"fernet:v1:"` is assumed
  already encrypted (skip).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import DATA_DIR

# All encrypted values are prefixed so we can distinguish from plaintext
# (needed for one-shot migration of legacy rows).
_PREFIX = "fernet:v1:"

_KEY_PATH = Path(
    os.environ.get("OPENATLAS_SECRETS_KEY_PATH", str(DATA_DIR / "secrets.key"))
)
_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)


def _load_or_create_key() -> bytes:
    """Return the Fernet key, creating it on first call. Mode 0600."""
    if _KEY_PATH.exists():
        data = _KEY_PATH.read_bytes().strip()
        if data:
            return data
    key = Fernet.generate_key()
    _KEY_PATH.write_bytes(key)
    try:
        os.chmod(_KEY_PATH, 0o600)
    except OSError:
        pass  # non-POSIX filesystem (dev only)
    return key


_FERNET: Optional[Fernet] = None


def _fernet() -> Fernet:
    global _FERNET
    if _FERNET is None:
        _FERNET = Fernet(_load_or_create_key())
    return _FERNET


def encrypt(plaintext: str) -> str:
    """Encrypt a string. Output starts with `fernet:v1:` so we can detect
    already-encrypted rows during migration."""
    if not plaintext:
        return plaintext
    if plaintext.startswith(_PREFIX):
        return plaintext  # idempotent
    token = _fernet().encrypt(plaintext.encode("utf-8"))
    return _PREFIX + token.decode("ascii")


def decrypt(value: str) -> str:
    """Decrypt a string produced by `encrypt()`. If the value does NOT
    have the `fernet:v1:` prefix we assume it's plaintext (legacy
    rows during migration) and return it as-is."""
    if not value:
        return value
    if not value.startswith(_PREFIX):
        return value  # legacy plaintext
    try:
        return _fernet().decrypt(value[len(_PREFIX):].encode("ascii")).decode("utf-8")
    except InvalidToken:
        # Key changed (or row was tampered with) — return as-is so the
        # caller can fail loudly on the real auth call.
        return value


def is_encrypted(value: str) -> bool:
    return bool(value) and value.startswith(_PREFIX)


def migrate_plaintext_keys(db) -> int:
    """Find rows whose api_key_encrypted is plaintext, encrypt them in
    place. Returns the number of rows migrated."""
    from app.db.models import HermesRuntime
    n = 0
    for r in db.query(HermesRuntime).all():
        v = r.api_key_encrypted or ""
        if v and not is_encrypted(v):
            r.api_key_encrypted = encrypt(v)
            n += 1
    if n:
        db.commit()
    return n
