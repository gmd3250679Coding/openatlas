#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/backend/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  PY="$ROOT/backend/.venv/bin/python3"
fi
if [[ ! -x "$PY" ]]; then
  PY="python3"
fi

exec "$PY" "$ROOT/backend/scripts/dev_stack.py" "$@"
