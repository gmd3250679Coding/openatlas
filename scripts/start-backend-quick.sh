#!/usr/bin/env bash
# OpenAtlas backend launcher.
set -euo pipefail

unset ALL_PROXY all_proxy HTTP_PROXY HTTPS_PROXY http_proxy https_proxy SOCKS_PROXY socks_proxy

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${OPENATLAS_HOME:=${HOME:?HOME is required}/.openatlas}"
: "${OPENATLAS_TENANT:=demo}"
: "${HERMES_BASE_URL:=http://127.0.0.1:58642}"
: "${HERMES_API_KEY:=openatlas-demo-dev-key}"
: "${OPENATLAS_HERMES_AGENT_ROOT:=$OPENATLAS_HOME/hermes-runtime}"
: "${OPENATLAS_BACKEND_PORT:=58003}"
export OPENATLAS_HOME OPENATLAS_TENANT HERMES_BASE_URL HERMES_API_KEY OPENATLAS_HERMES_AGENT_ROOT

cd "$PROJECT_ROOT/backend"
exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$OPENATLAS_BACKEND_PORT" --log-level warning
