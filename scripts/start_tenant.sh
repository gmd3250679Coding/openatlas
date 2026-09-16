#!/usr/bin/env bash
# OpenAtlas per-tenant Hermes gateway launcher.
#
# Spawned by OpenAtlas Backend's /api/admin/tenants/{id}/hermes-runtime/start.
# All isolation guards from start.sh are reused (same 8-layer check).
#
# Usage: start_tenant.sh <hermes_home>
# Env (set by caller): OPENATLAS_HOME, OPENATLAS_HERMES_AGENT_ROOT,
#                      API_SERVER_HOST, API_SERVER_PORT, API_SERVER_KEY
#                      OPENATLAS_TENANT
set -euo pipefail

HERMES_HOME="${1:-}"
if [[ -z "$HERMES_HOME" ]]; then
  echo "[start_tenant.sh][FATAL] usage: start_tenant.sh <hermes_home>" >&2
  exit 1
fi

# ── All env vars are injected by the backend caller; we just guard. ─────
: "${OPENATLAS_HOME:=${HOME:-/tmp}/.openatlas}"
: "${API_SERVER_HOST:=127.0.0.1}"
: "${API_SERVER_PORT:?API_SERVER_PORT not set}"
: "${API_SERVER_KEY:?API_SERVER_KEY not set}"

LOCAL_HERMES_HOME="${HOME:-/tmp}/.hermes"
# Project root is the parent of the scripts/ dir, NOT of OPENATLAS_HOME.
# We locate it by finding a directory that contains runtime/launchers/hermes_api_server.py.
PROJECT_ROOT=""
_candidate="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
if [[ -f "$_candidate/runtime/launchers/hermes_api_server.py" ]]; then
  PROJECT_ROOT="$_candidate"
fi
if [[ -z "$PROJECT_ROOT" ]]; then
  # Fallback: walk up from OPENATLAS_HOME until we find runtime/launchers/
  _d="$(dirname "$OPENATLAS_HOME")"
  for _ in 1 2 3 4; do
    if [[ -f "$_d/openatlas/runtime/launchers/hermes_api_server.py" ]]; then
      PROJECT_ROOT="$_d/openatlas"
      break
    fi
    _d="$(dirname "$_d")"
  done
fi
if [[ -z "$PROJECT_ROOT" ]]; then
  echo "[start_tenant.sh][FATAL] cannot locate project root (no runtime/launchers/hermes_api_server.py found)" >&2
  exit 1
fi

# Use the project-level delivery configuration for provider credentials. The
# tenant home contains runtime state only and must not be the key source.
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi
: "${OPENATLAS_HERMES_AGENT_ROOT:=$PROJECT_ROOT/runtime/hermes}"
HERMES_RUNTIME="$OPENATLAS_HERMES_AGENT_ROOT"
HERMES_PY="$HERMES_RUNTIME/.venv/bin/python3"
LAUNCHER="$PROJECT_ROOT/runtime/launchers/hermes_api_server.py"

# Resolve to absolute
case "$HERMES_HOME" in
  /*) ;;
  *) HERMES_HOME="$OPENATLAS_HOME/$HERMES_HOME" ;;
esac

# ── Layer 1/2/3: HERMES_HOME must be under OPENATLAS_HOME, NOT ~/.hermes ──
case "$HERMES_HOME" in
  "$OPENATLAS_HOME"/*) ;;
  *) echo "[start_tenant.sh][FATAL] HERMES_HOME=$HERMES_HOME is NOT under OPENATLAS_HOME=$OPENATLAS_HOME" >&2; exit 1 ;;
esac
case "$HERMES_HOME" in
  "$LOCAL_HERMES_HOME"/*|"$LOCAL_HERMES_HOME")
    echo "[start_tenant.sh][FATAL] HERMES_HOME overlaps ~/.hermes" >&2; exit 1 ;;
esac
case "$HERMES_RUNTIME" in
  "$LOCAL_HERMES_HOME"/*)
    echo "[start_tenant.sh][FATAL] HERMES_RUNTIME=$HERMES_RUNTIME still inside ~/.hermes" >&2; exit 1 ;;
esac
if [[ ! -d "$HERMES_RUNTIME" ]]; then
  echo "[start_tenant.sh][FATAL] hermes-runtime not found at $HERMES_RUNTIME" >&2; exit 1
fi
if [[ ! -x "$HERMES_PY" ]]; then
  echo "[start_tenant.sh][FATAL] Hermes environment not found at $HERMES_PY" >&2
  echo "Run: bash $PROJECT_ROOT/scripts/setup-hermes-runtime.sh" >&2
  exit 1
fi

# ── Layer 4: refuse collision ports ───────────────────────────────────────
for p in 8642 9119; do
  if [[ "$API_SERVER_PORT" == "$p" ]]; then
    echo "[start_tenant.sh][FATAL] API_SERVER_PORT=$p collides with reserved Hermes ports" >&2
    exit 1
  fi
done

mkdir -p "$HERMES_HOME/logs" "$HERMES_HOME/sessions" "$HERMES_HOME/skills" "$HERMES_HOME/memory" \
         "$OPENATLAS_HOME/logs"

# ── Layer 5: no symlinks into ~/.hermes ────────────────────────────────────
find "$HERMES_HOME" -type l -lname "*$LOCAL_HERMES_HOME*" 2>/dev/null | while read -r l; do
  echo "[start_tenant.sh][FATAL] found symlink into ~/.hermes: $l" >&2
  exit 1
done

# ── Port-in-use check (own leftovers allowed, others fatal) ───────────────
if lsof -i :"$API_SERVER_PORT" >/dev/null 2>&1; then
  offenders=$(lsof -i :"$API_SERVER_PORT" -nP 2>/dev/null | tail -n +2 | awk '{print $1}' | sort -u)
  if echo "$offenders" | grep -q -i "hermes_api\|openatlas"; then
    :
  else
    echo "[start_tenant.sh][FATAL] port $API_SERVER_PORT in use by: $offenders" >&2
    exit 1
  fi
fi

TENANT_SLUG="$(basename "$(dirname "$HERMES_HOME")")"
LOG="$OPENATLAS_HOME/logs/hermes-tenant-$TENANT_SLUG.log"
PID_FILE="$HERMES_HOME/openatlas-gateway.pid"

echo "[start_tenant.sh] tenant=$TENANT_SLUG"
echo "  HERMES_HOME      = $HERMES_HOME"
echo "  HERMES_RUNTIME   = $HERMES_RUNTIME"
echo "  API_SERVER_PORT  = $API_SERVER_PORT"

# ── Spawn (setsid-detached on macOS via nohup + redirect, no setsid) ─────
nohup env \
  -u HOME \
  -u ALL_PROXY -u all_proxy \
  -u HTTP_PROXY -u http_proxy \
  -u HTTPS_PROXY -u https_proxy \
  -u SOCKS_PROXY -u socks_proxy \
  PYTHONPATH="$HERMES_RUNTIME" \
  OPENATLAS_HOME="$OPENATLAS_HOME" \
  OPENATLAS_HERMES_AGENT_ROOT="$HERMES_RUNTIME" \
  HERMES_HOME="$HERMES_HOME" \
  API_SERVER_HOST="$API_SERVER_HOST" \
  API_SERVER_PORT="$API_SERVER_PORT" \
  API_SERVER_KEY="$API_SERVER_KEY" \
  OPENATLAS_TENANT="$TENANT_SLUG" \
  "$HERMES_PY" "$LAUNCHER" \
  > "$LOG" 2>&1 < /dev/null &

HERMES_PID=$!
echo "$HERMES_PID" > "$PID_FILE"
disown "$HERMES_PID" 2>/dev/null || true
echo "[start_tenant.sh] pid=$HERMES_PID  log=$LOG  pid_file=$PID_FILE"

# ── Wait for /health ──────────────────────────────────────────────────────
HEALTH_URL="http://127.0.0.1:$API_SERVER_PORT/health"
READY=0
for i in {1..30}; do
  if curl -s -H "Authorization: Bearer $API_SERVER_KEY" "$HEALTH_URL" 2>/dev/null | grep -q '"status"'; then
    echo "[start_tenant.sh] /health OK on port $API_SERVER_PORT"
    READY=1
    break
  fi
  sleep 0.5
  if ! kill -0 "$HERMES_PID" 2>/dev/null; then
    echo "[start_tenant.sh][FATAL] hermes-gateway died for tenant $TENANT_SLUG — see $LOG" >&2
    tail -40 "$LOG" >&2
    exit 1
  fi
done
if [[ $READY -ne 1 ]]; then
  echo "[start_tenant.sh][FATAL] /health did not return ok for tenant $TENANT_SLUG within 15s" >&2
  tail -40 "$LOG" >&2
  kill "$HERMES_PID" 2>/dev/null || true
  exit 1
fi

# ── Layer 8: verify PID's exec path is under our isolated runtime ────────
sleep 1
PID_CMD=$(ps -p "$HERMES_PID" -o command= 2>/dev/null || true)
if [[ -z "$PID_CMD" ]]; then
  echo "[start_tenant.sh][FATAL] hermes-gateway PID $HERMES_PID is gone" >&2
  exit 1
fi
if [[ "$PID_CMD" != *"$LAUNCHER"* ]]; then
  echo "[start_tenant.sh][FATAL] layer 8: hermes-gateway cmdline doesn't reference our launcher" >&2
  echo "  cmdline: $PID_CMD" >&2
  kill "$HERMES_PID" 2>/dev/null || true
  exit 1
fi
# macOS fallback: check open files for any ~/.hermes reference
if lsof -p "$HERMES_PID" 2>/dev/null | grep -q "$LOCAL_HERMES_HOME"; then
  echo "[start_tenant.sh][FATAL] layer 8: PID $HERMES_PID has open files under $LOCAL_HERMES_HOME — contamination!" >&2
  kill "$HERMES_PID" 2>/dev/null || true
  exit 1
fi
echo "[start_tenant.sh] layer 8 verified: hermes-gateway runs from $PROJECT_ROOT + PYTHONPATH=$HERMES_RUNTIME ✓"
echo "[start_tenant.sh] ready ✓"
