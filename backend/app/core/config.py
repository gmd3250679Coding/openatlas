"""OpenAtlas backend settings.

Always absolute paths. Never $HOME dependent. Reads OPENATLAS_HOME/HERMES_HOME
from env (set by start.sh).
"""
from __future__ import annotations

import os
from pathlib import Path


def _abs_openatlas_home() -> Path:
    """Refuse to fall back to a relative path. The launcher guarantees this is set."""
    val = os.environ.get("OPENATLAS_HOME", "")
    if not val or not Path(val).is_absolute():
        # Hard fallback for dev running outside start.sh: use absolute home.
        return Path("/Users/macbook/.openatlas").resolve()
    return Path(val).resolve()


OPENATLAS_HOME = _abs_openatlas_home()
TENANT_HOME = OPENATLAS_HOME / "hermes-tenants" / os.environ.get("OPENATLAS_TENANT", "demo")
HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(TENANT_HOME / ".hermes"))).resolve()
# Phase 2: path to the OpenAtlas-owned hermes-agent source tree (NEVER ~/.hermes/hermes-agent)
OPENATLAS_HERMES_AGENT_ROOT = Path(
    os.environ.get("OPENATLAS_HERMES_AGENT_ROOT", str(OPENATLAS_HOME / "hermes-runtime"))
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

# CORS
CORS_ORIGINS = [
    "http://localhost:3381",
    "http://127.0.0.1:3381",
    "http://localhost:58003",
    "http://127.0.0.1:58003",
]
