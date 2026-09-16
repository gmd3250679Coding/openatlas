"""InsightLab backend settings.

Always absolute paths. Never $HOME dependent. Reads OPENATLAS_HOME/HERMES_HOME
from env (set by start.sh).
"""
from __future__ import annotations

import os
from pathlib import Path


def _default_openatlas_home() -> Path:
    return (Path.home() / ".openatlas").resolve()


def _abs_openatlas_home() -> Path:
    """Refuse to fall back to a relative path. The launcher guarantees this is set."""
    val = os.environ.get("OPENATLAS_HOME", "")
    if not val or not Path(val).is_absolute():
        # Dev fallback for local runs outside start.sh. Production should set OPENATLAS_HOME.
        return _default_openatlas_home()
    return Path(val).resolve()


def _env_int(name: str, default: int, *, minimum: int = 0) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


OPENATLAS_HOME = _abs_openatlas_home()
OPENATLAS_PROJECT_ROOT = Path(
    os.environ.get("OPENATLAS_PROJECT_ROOT", Path(__file__).resolve().parents[3])
).resolve()
TENANT_HOME = OPENATLAS_HOME / "hermes-tenants" / os.environ.get("OPENATLAS_TENANT", "demo")
HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(TENANT_HOME / ".hermes"))).resolve()
# Phase 2: path to the InsightLab-owned hermes-agent source tree (NEVER ~/.hermes/hermes-agent)
OPENATLAS_HERMES_AGENT_ROOT = Path(
    os.environ.get(
        "OPENATLAS_HERMES_AGENT_ROOT",
        str(OPENATLAS_PROJECT_ROOT / "runtime" / "hermes"),
    )
).resolve()

DATA_DIR = OPENATLAS_HOME / "backend-data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
SQLITE_PATH = DATA_DIR / "openatlas.db"

# Tenant runtime config (MVP — single demo tenant, future: per-tenant table)
TENANT_HERMES_BASE_URL = os.environ.get("HERMES_BASE_URL", "http://127.0.0.1:58642")
TENANT_HERMES_API_KEY = os.environ.get("API_SERVER_KEY", "openatlas-demo-dev-key")

# Auth
SECRET_KEY = os.environ.get("OPENATLAS_SECRET", "dev-secret-do-not-use-in-prod-7c2f8a4b")
JWT_ALG = "HS256"
JWT_TTL_HOURS = 24

# Defaults for the demo tenant (seeded on first run)
DEFAULT_TENANT_SLUG = "demo"
DEFAULT_TENANT_NAME = "Demo Tenant"
DEFAULT_ADMIN_EMAIL = "admin@demo.openatlas"
DEFAULT_ADMIN_PASSWORD = "openatlas"

# CORS. Same-origin nginx deployments do not need CORS, but preview/dev often do.
_cors_env = os.environ.get("OPENATLAS_CORS_ORIGINS", "")
CORS_ORIGINS = [s.strip() for s in _cors_env.split(",") if s.strip()] or [
    "http://localhost:3381",
    "http://127.0.0.1:3381",
    "http://localhost:58003",
    "http://127.0.0.1:58003",
]

# Runtime stability / quota governance. These are soft guards in front of the
# tenant Hermes runtime so one user cannot accidentally saturate the gateway.
OPENATLAS_MAX_ACTIVE_RUNS_PER_TENANT = _env_int("OPENATLAS_MAX_ACTIVE_RUNS_PER_TENANT", 6)
OPENATLAS_MAX_ACTIVE_RUNS_PER_USER = _env_int("OPENATLAS_MAX_ACTIVE_RUNS_PER_USER", 2)
OPENATLAS_QUOTA_RETRY_AFTER_SECONDS = _env_int("OPENATLAS_QUOTA_RETRY_AFTER_SECONDS", 90, minimum=15)
