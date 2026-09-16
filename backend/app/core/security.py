"""Password hashing + JWT issue/verify."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from jose import jwt, JWTError
from passlib.context import CryptContext

from app.core.config import JWT_ALG, JWT_TTL_HOURS, SECRET_KEY

_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd.verify(plain, hashed)
    except Exception:
        return False


def issue_token(*, user_id: str, tenant_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALG)


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALG])
    except JWTError:
        return None
