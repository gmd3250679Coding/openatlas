#!/usr/bin/env bash
# Prepare the project-bundled Hermes runtime without touching ~/.hermes.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_RUNTIME="${OPENATLAS_HERMES_AGENT_ROOT:-$PROJECT_ROOT/runtime/hermes}"
HERMES_PYTHON_VERSION="${HERMES_PYTHON_VERSION:-3.12}"
HERMES_VENV="$HERMES_RUNTIME/.venv"

log() {
  printf '[setup-hermes-runtime] %s\n' "$*"
}

if [[ ! -f "$HERMES_RUNTIME/pyproject.toml" ]] \
  || [[ ! -f "$HERMES_RUNTIME/gateway/platforms/api_server.py" ]]; then
  echo "[setup-hermes-runtime][FATAL] bundled Hermes source is incomplete at $HERMES_RUNTIME" >&2
  echo "Expected pyproject.toml and gateway/platforms/api_server.py." >&2
  exit 1
fi

if command -v uv >/dev/null 2>&1; then
  log "preparing Python $HERMES_PYTHON_VERSION environment at $HERMES_VENV"
  uv sync \
    --project "$HERMES_RUNTIME" \
    --python "$HERMES_PYTHON_VERSION" \
    --frozen
  HERMES_PY="$HERMES_VENV/bin/python"
  # The API Server adapter imports aiohttp at connect time. It is optional in
  # upstream Hermes, but mandatory for the OpenAtlas gateway integration.
  uv pip install --python "$HERMES_PY" "aiohttp==3.13.3"
else
  PYTHON_BIN="${HERMES_PYTHON_BIN:-}"
  if [[ -z "$PYTHON_BIN" ]]; then
    for candidate in python3.12 python3.13 python3.11; do
      if command -v "$candidate" >/dev/null 2>&1; then
        PYTHON_BIN="$(command -v "$candidate")"
        break
      fi
    done
  fi
  if [[ -z "$PYTHON_BIN" ]]; then
    echo "[setup-hermes-runtime][FATAL] uv or Python 3.11-3.13 is required." >&2
    exit 1
  fi
  "$PYTHON_BIN" - <<'PY'
import sys
if not ((3, 11) <= sys.version_info[:2] < (3, 14)):
    raise SystemExit(f"Hermes requires Python 3.11-3.13, got {sys.version.split()[0]}")
PY
  log "preparing environment at $HERMES_VENV with $PYTHON_BIN"
  if [[ ! -x "$HERMES_VENV/bin/python" ]]; then
    "$PYTHON_BIN" -m venv "$HERMES_VENV"
  fi
  HERMES_PY="$HERMES_VENV/bin/python"
  "$HERMES_PY" -m pip install --upgrade pip
  "$HERMES_PY" -m pip install --editable "$HERMES_RUNTIME" "aiohttp==3.13.3"
fi

PYTHONPATH="$HERMES_RUNTIME" "$HERMES_PY" - <<'PY'
import aiohttp
from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter

assert aiohttp
assert PlatformConfig
assert APIServerAdapter
PY

log "ready: $($HERMES_PY --version 2>&1)"
log "runtime: $HERMES_RUNTIME"
