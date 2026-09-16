"""
Hermes API Server Launcher for OpenAtlas.

Starts the Hermes api_server platform adapter in isolation, on a dedicated
HERMES_HOME, port, and API key.  Refuses to start if any of the isolation
guards fail.

Usage:
    python runtime/launchers/hermes_api_server.py

Required env (set by start.sh/systemd):
    OPENATLAS_HOME       e.g. /var/lib/openatlas
    HERMES_HOME          e.g. /var/lib/openatlas/hermes-tenants/demo/.hermes
    API_SERVER_HOST      127.0.0.1
    API_SERVER_PORT      58642
    API_SERVER_KEY       openatlas-demo-dev-key
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import os
import re
import sys
import time
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


def _tencent_model_catalog() -> dict:
    catalog_path = Path(__file__).resolve().parents[1] / "config" / "tencent-models.json"
    payload = json.loads(catalog_path.read_text(encoding="utf-8"))
    if not isinstance(payload.get("models"), list) or not payload["models"]:
        raise RuntimeError(f"Tencent model catalog is empty: {catalog_path}")
    return payload


def _openatlas_config_text() -> str:
    catalog = _tencent_model_catalog()
    model = os.environ.get("OPENATLAS_DEFAULT_MODEL", str(catalog["defaultModel"]))
    provider = os.environ.get("OPENATLAS_DEFAULT_PROVIDER", str(catalog["providerId"]))
    provider_name = str(catalog["vendor"])
    provider_base_url = (
        os.environ.get("TOKENHUB_BASE_URL")
        or os.environ.get("OPENATLAS_DEFAULT_PROVIDER_BASE_URL")
        or str(catalog["baseUrl"])
    )
    provider_key_env = os.environ.get(
        "OPENATLAS_DEFAULT_PROVIDER_KEY_ENV",
        str(catalog["apiKeyEnv"]),
    )
    fallback_model = os.environ.get("OPENATLAS_FALLBACK_MODEL", str(catalog["fallbackModel"]))
    model_rows = "\n".join(
        f"      {json.dumps(str(item['id']))}: {{}}" for item in catalog["models"]
    )
    return f"""# InsightLab-managed tenant Hermes config v2
model:
  default: {json.dumps(model)}
  provider: {json.dumps(provider)}
  base_url: {json.dumps(provider_base_url)}
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
providers:
  {json.dumps(provider)}:
    name: {json.dumps(provider_name, ensure_ascii=False)}
    api: {json.dumps(provider_base_url)}
    key_env: {json.dumps(provider_key_env)}
    transport: openai_chat
    default_model: {json.dumps(model)}
    discover_models: false
    models:
{model_rows}
fallback_providers:
  - provider: {json.dumps(provider)}
    model: {json.dumps(fallback_model)}
    base_url: {json.dumps(provider_base_url)}
    key_env: {json.dumps(provider_key_env)}
"""


def _config_needs_openatlas_migration(text: str) -> bool:
    """Detect old or incomplete tenant config that Hermes cannot route.

    Earlier InsightLab releases wrote a legacy Hermes shape like
    `model: mimo-v2.5-pro` plus `providers.custom`. Newer Hermes expects a
    provider-aware model block and named/fallback providers. Preserving
    the legacy file makes `/models` look healthy while chat fails with
    "No inference provider configured", so we migrate only that stale shape.
    """
    if not text.strip():
        return True
    has_model_block = bool(re.search(r"(?m)^model:\s*$", text))
    has_provider_field = bool(re.search(r"(?m)^\s+provider:\s*", text))
    has_default_field = bool(re.search(r"(?m)^\s+default:\s*", text))
    has_named_providers = bool(re.search(r"(?m)^providers:\s*$", text))
    has_custom_providers = bool(re.search(r"(?m)^custom_providers:\s*$", text))
    has_fallback_providers = bool(re.search(r"(?m)^fallback_providers:\s*$", text))
    has_legacy_custom = bool(re.search(r"(?m)^providers:\s*$", text) and re.search(r"(?m)^\s+custom:\s*$", text))
    has_legacy_fallbacks = bool(re.search(r"(?m)^fallbacks:\s*$", text))
    has_scalar_model = bool(re.search(r"(?m)^model:\s*\S+", text))
    managed_config = text.startswith("# OpenAtlas tenant Hermes config") or text.startswith(
        "# InsightLab-managed tenant Hermes config"
    )
    catalog = _tencent_model_catalog()
    expected_provider = os.environ.get("OPENATLAS_DEFAULT_PROVIDER", str(catalog["providerId"]))
    expected_model = os.environ.get("OPENATLAS_DEFAULT_MODEL", str(catalog["defaultModel"]))
    managed_config_is_current = (
        "# InsightLab-managed tenant Hermes config v2" in text
        and f"provider: {json.dumps(expected_provider)}" in text
        and f"default: {json.dumps(expected_model)}" in text
        and all(json.dumps(str(item["id"])) + ":" in text for item in catalog["models"])
    )
    return (
        has_scalar_model
        or has_legacy_custom
        or has_legacy_fallbacks
        or (managed_config and not managed_config_is_current)
        or not (
            has_model_block
            and has_provider_field
            and has_default_field
            and (has_named_providers or has_custom_providers)
            and has_fallback_providers
        )
    )


def setup_hermes_home() -> None:
    """Create or migrate a HERMES_HOME scaffold for the isolated tenant.

    Existing config is preserved when it is already provider-aware. Legacy
    OpenAtlas tenant config is backed up and rewritten so Hermes can route
    model calls.
    """
    hermes_home = Path(os.environ["HERMES_HOME"])
    hermes_home.mkdir(parents=True, exist_ok=True)
    (hermes_home / "logs").mkdir(exist_ok=True)
    (hermes_home / "sessions").mkdir(exist_ok=True)
    (hermes_home / "skills").mkdir(exist_ok=True)
    (hermes_home / "memory").mkdir(exist_ok=True)
    config_path = hermes_home / "config.yaml"
    if not config_path.exists():
        config_path.write_text(_openatlas_config_text())
        config_state = "created"
    else:
        current = config_path.read_text(errors="replace")
        if _config_needs_openatlas_migration(current):
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
            backup_path = hermes_home / f"config.yaml.bak-{stamp}"
            config_path.replace(backup_path)
            config_path.write_text(_openatlas_config_text())
            config_state = f"migrated legacy config; backup={backup_path.name}"
        else:
            config_state = "preserved"
    project_env = Path(__file__).resolve().parents[2] / ".env"
    provider_key_env = str(_tencent_model_catalog()["apiKeyEnv"])
    if not os.environ.get(provider_key_env, "").strip():
        print(
            f"[hermes-home] WARNING: {provider_key_env} is empty; "
            f"set it in {project_env} before making model calls",
            file=sys.stderr,
        )
    print(f"[hermes-home] ready {hermes_home} (config {config_state})")


def _isolated_hermes_agent_root() -> str:
    """Return the path to the OpenAtlas-owned hermes-agent source tree.

    Hard rule: OpenAtlas must NOT import from ~/.hermes/hermes-agent/.
    Prefer the source bundled in this OpenAtlas checkout. Legacy data-root
    paths remain as fallbacks for older deployments.
    """
    explicit = os.environ.get("OPENATLAS_HERMES_AGENT_ROOT")
    if explicit and (Path(explicit) / "gateway" / "platforms" / "api_server.py").is_file():
        return explicit
    openatlas_home = os.environ.get("OPENATLAS_HOME", "")
    candidates = [
        Path(__file__).resolve().parents[1] / "hermes",
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
    from aiohttp import web

    class InsightLabAPIServerAdapter(APIServerAdapter):
        async def _handle_models(self, request):
            """Advertise the configured Tencent Cloud Token Plan catalog."""
            auth_err = self._check_auth(request)
            if auth_err:
                return auth_err
            catalog = _tencent_model_catalog()
            created = int(time.time())
            vendor = str(catalog["vendor"])
            provider = str(catalog["providerId"])
            default_model = str(catalog["defaultModel"])
            return web.json_response({
                "object": "list",
                "provider": {
                    "id": provider,
                    "name": vendor,
                    "base_url": str(catalog["baseUrl"]),
                    "api_key_env": str(catalog["apiKeyEnv"]),
                    "default_model": default_model,
                },
                "data": [
                    {
                        "id": str(item["id"]),
                        "name": str(item["name"]),
                        "object": "model",
                        "created": created,
                        "owned_by": vendor,
                        "provider": provider,
                        "root": str(item["id"]),
                        "parent": None,
                        "permission": [],
                        "is_default": str(item["id"]) == default_model,
                    }
                    for item in catalog["models"]
                ],
            })

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
            "model_name": str(_tencent_model_catalog()["defaultModel"]),
        },
    )
    adapter = InsightLabAPIServerAdapter(cfg)
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
