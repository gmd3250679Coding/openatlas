#!/bin/bash
# OpenAtlas backend launcher
unset ALL_PROXY all_proxy HTTP_PROXY HTTPS_PROXY http_proxy https_proxy SOCKS_PROXY socks_proxy
export OPENATLAS_HOME=/Users/macbook/.openatlas
export OPENATLAS_TENANT=demo
export HERMES_BASE_URL=http://127.0.0.1:58642
export HERMES_API_KEY=openatlas-demo-dev-key
export HERMES_API_KEY=openatlas-demo-dev-key
export OPENATLAS_HERMES_AGENT_ROOT=/Users/macbook/.openatlas/hermes-runtime
cd /Users/macbook/Desktop/Atlasagent/openatlas/backend
exec ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 58003 --log-level warning
