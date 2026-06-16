"""
Hermes API Server Launcher for OpenAtlas.

Starts the Hermes api_server platform adapter in isolation, on a dedicated
HERMES_HOME, port, and API key.  Refuses to start if any of the isolation
guards fail.

Usage:
    python runtime/launchers/hermes_api_server.py

Required env (set by start.sh):
    OPENATLAS_HOME       e.g. /Users/macbook/.openatlas
    HERMES_HOME          e.g. /Users/macbook/.openatlas/hermes-tenants/demo/.hermes
    API_SERVER_HOST      127.0.0.1
    API_SERVER_PORT      58642
    API_SERVER_KEY       openatlas-demo-dev-key
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path


def isolation_guard() -> None:
    """Refuse to start if isolation invariants are violated."""
    hermes_home = os.environ.get("HERMES_HOME", "")
    openatlas_home = os.environ.get("OPENATLAS_HOME", "")
    default_hermes = str(Path.home() / ".hermes")

    errors: list[str] = []
    if not hermes_home:
        errors.append("HERMES_HOME is not set")
    elif not hermes_home.startswith(openatlas_home):
        errors.append(
            f"HERMES_HOME ({hermes_home}) must be under OPENATLAS_HOME ({openatlas_home})"
        )
    elif hermes_home.startswith(default_hermes):
        errors.append(
            f"HERMES_HOME ({hermes_home}) overlaps with default ~/.hermes — aborting"
        )

    if not os.environ.get("API_SERVER_KEY"):
        errors.append("API_SERVER_KEY is not set")

    port = os.environ.get("API_SERVER_PORT", "")
    if port in ("8642", "9119"):
        errors.append(f"API_SERVER_PORT={port} collides with default Hermes port — refusing")

    if errors:
        for e in errors:
            print(f"[isolation-guard] FAIL: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"[isolation-guard] OK")
    print(f"  HERMES_HOME       = {hermes_home}")
    print(f"  OPENATLAS_HOME    = {openatlas_home}")
    print(f"  API_SERVER_HOST   = {os.environ.get('API_SERVER_HOST')}")
    print(f"  API_SERVER_PORT   = {port}")
    print(f"  API_SERVER_KEY    = {os.environ['API_SERVER_KEY'][:8]}***")


def setup_hermes_home() -> None:
    """Create a fresh HERMES_HOME scaffold if missing (no defaults cloned from ~/.hermes).

    Idempotent: existing config.yaml/.env are preserved. To change model/provider
    edit them directly — start.sh will not clobber them on re-launch.
    """
    hermes_home = Path(os.environ["HERMES_HOME"])
    hermes_home.mkdir(parents=True, exist_ok=True)
    (hermes_home / "logs").mkdir(exist_ok=True)
    (hermes_home / "sessions").mkdir(exist_ok=True)
    (hermes_home / "skills").mkdir(exist_ok=True)
    (hermes_home / "memory").mkdir(exist_ok=True)
    if not (hermes_home / "config.yaml").exists():
        (hermes_home / "config.yaml").write_text(
            """# OpenAtlas Demo Tenant — Hermes config
model:
  default: mimo-v2.5-pro
  provider: custom:token-plan-cn.xiaomimimo.com
toolsets:
  - hermes-cli
agent:
  max_turns: 30
  verbose: false
  reasoning_effort: medium
terminal:
  backend: local
  cwd: .
  timeout: 60
custom_providers:
  - name: token-plan-cn.xiaomimimo.com
    base_url: https://token-plan-cn.xiaomimimo.com/v1
    api_key: tp-ccxrgk6riixm5ephks2bd3aihayxd0csb41ayx6hez6g3rv4
    model: mimo-v2.5-pro
"""
        )
    if not (hermes_home / ".env").exists():
        (hermes_home / ".env").write_text(
            f"""# OpenAtlas demo tenant env
API_SERVER_HOST={os.environ.get('API_SERVER_HOST', '127.0.0.1')}
API_SERVER_PORT={os.environ.get('API_SERVER_PORT', '58642')}
API_SERVER_KEY={os.environ.get('API_SERVER_KEY', '')}
HERMES_AGENT_NAME=openatlas-demo
"""
        )
    print(f"[hermes-home] ready {hermes_home} (config preserved)")


def _isolated_hermes_agent_root() -> str:
    """Return the path to the OpenAtlas-owned hermes-agent source tree.

    Hard rule: OpenAtlas must NOT import from ~/.hermes/hermes-agent/.
    Falls back to OPENATLAS_RUNTIME/hermes-runtime/ if .openatlas/hermes-agent
    doesn't exist (legacy path).
    """
    explicit = os.environ.get("OPENATLAS_HERMES_AGENT_ROOT")
    if explicit and Path(explicit).is_dir():
        return explicit
    openatlas_home = os.environ.get("OPENATLAS_HOME", "")
    candidates = [
        Path(openatlas_home) / "hermes-agent",
        Path(openatlas_home) / "hermes-runtime",
    ]
    for c in candidates:
        if c.is_dir() and (c / "gateway" / "platforms" / "api_server.py").exists():
            return str(c)
    raise SystemExit(
        f"[isolation-guard] FAIL: no isolated hermes-agent source under "
        f"OPENATLAS_HOME={openatlas_home}. Expected {candidates}. Aborting "
        f"to avoid importing from ~/.hermes/hermes-agent."
    )


async def main_async() -> None:
    isolation_guard()
    setup_hermes_home()

    hermes_agent_root = _isolated_hermes_agent_root()
    if hermes_agent_root not in sys.path:
        sys.path.insert(0, hermes_agent_root)
    os.environ["PYTHONPATH"] = hermes_agent_root + os.pathsep + os.environ.get("PYTHONPATH", "")

    from gateway.platforms.api_server import APIServerAdapter
    from gateway.config import PlatformConfig

    host = os.environ["API_SERVER_HOST"]
    port = int(os.environ["API_SERVER_PORT"])
    key = os.environ["API_SERVER_KEY"]

    cfg = PlatformConfig(
        enabled=True,
        extra={
            "host": host,
            "port": port,
            "key": key,
            "cors_origins": "*",
        },
    )
    adapter = APIServerAdapter(cfg)
    print(f"[launcher] starting Hermes API server on http://{host}:{port}")
    ok = await adapter.connect()
    if not ok:
        print("[launcher] FAILED to start", file=sys.stderr)
        sys.exit(2)
    print(f"[launcher] ready — http://{host}:{port}/health")
    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        print("[launcher] shutting down")
        await adapter.disconnect()


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
