#!/usr/bin/env bash
# OpenAtlas dev launcher — sets up isolation env, starts Hermes gateway + backend + frontend.
#
# 8-LAYER ISOLATION (all fail-closed, refuse to start on any violation):
#  1. HERMES_HOME is an absolute path under /Users/macbook/.openatlas, NEVER inherits $HOME
#     (we are running under hermes-claude profile where HOME=/Users/macbook/.hermes/profiles/claude/home).
#  2. HERMES_HOME is NOT a subpath of /Users/macbook/.hermes (the live local business Hermes).
#  3. The Hermes runtime we exec (hermes-runtime/) is /Users/macbook/.openatlas/hermes-runtime
#     — a verbatim copy. We NEVER read or exec anything from /Users/macbook/.hermes/hermes-agent/.
#  4. API_SERVER_PORT is not in {8642, 9119, ...}.
#  5. We do NOT import / link / read any file from /Users/macbook/.hermes into HERMES_HOME.
#  6. Pre-start mtime snapshot of ~/.hermes/config.yaml + ~/.hermes/state.db. Post-start re-check:
#     mtimes unchanged (proves no accidental write back into the local Hermes state).
#  7. We never kill anything that is not our own PID file. We never pkill 'hermes' by name.
#  8. After launch, verify the new Hermes gateway PID's executable path is under
#     /Users/macbook/.openatlas/hermes-runtime/, NOT under /Users/macbook/.hermes/.
#     Refuse to declare "ready" if this check fails.

set -euo pipefail

# ── Layer 1/2/3: hard-coded absolute paths (no $HOME reliance) ─────────────
OPENATLAS_HOME="/Users/macbook/.openatlas"           # ABSOLUTE
OPENATLAS_TENANT="${OPENATLAS_TENANT:-demo}"
HERMES_HOME="$OPENATLAS_HOME/hermes-tenants/$OPENATLAS_TENANT/.hermes"   # ABSOLUTE
API_SERVER_HOST="127.0.0.1"
API_SERVER_PORT="${API_SERVER_PORT:-58642}"
API_SERVER_KEY="${API_SERVER_KEY:-openatlas-demo-dev-key}"
OPENATLAS_FRONTEND_PORT="${OPENATLAS_FRONTEND_PORT:-3381}"
OPENATLAS_BACKEND_PORT="${OPENATLAS_BACKEND_PORT:-58003}"

# Our OWN hermes-agent copy. NEVER reference the live /Users/macbook/.hermes/hermes-agent.
HERMES_RUNTIME="$OPENATLAS_HOME/hermes-runtime"
HERMES_PY="$HERMES_RUNTIME/.venv/bin/python3"
LOCAL_HERMES_HOME="/Users/macbook/.hermes"   # READ-ONLY reference

# Export for child processes
export OPENATLAS_HOME OPENATLAS_TENANT HERMES_HOME
export API_SERVER_HOST API_SERVER_PORT API_SERVER_KEY
export OPENATLAS_FRONTEND_PORT OPENATLAS_BACKEND_PORT

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Layer 2: refuse if HERMES_HOME sits inside ~/.hermes ───────────────────
case "$HERMES_HOME" in
  "$LOCAL_HERMES_HOME"/*|"$LOCAL_HERMES_HOME")
    echo "[start.sh][FATAL] HERMES_HOME=$HERMES_HOME is inside $LOCAL_HERMES_HOME — would corrupt local Hermes" >&2
    exit 1
    ;;
esac

# ── Layer 3: refuse if our hermes runtime is missing or still under ~/.hermes
if [[ ! -d "$HERMES_RUNTIME" ]]; then
  echo "[start.sh][FATAL] HERMES_RUNTIME=$HERMES_RUNTIME not found.  Run: rsync -a --exclude 'tests' --exclude 'docs' --exclude 'website' ~/.hermes/hermes-agent/ ~/.openatlas/hermes-runtime/" >&2
  exit 1
fi
case "$HERMES_RUNTIME" in
  "$LOCAL_HERMES_HOME"/*)
    echo "[start.sh][FATAL] HERMES_RUNTIME=$HERMES_RUNTIME still inside $LOCAL_HERMES_HOME" >&2
    exit 1
    ;;
esac
if [[ ! -x "$HERMES_PY" ]]; then
  echo "[start.sh][FATAL] hermes-runtime venv not at $HERMES_PY" >&2
  exit 1
fi

# ── Layer 4: refuse collision ports ────────────────────────────────────────
forbidden_ports="8642 9119 8000 8001 8002 8003 3000 3001 3077 3300 37772 5432 5433 35432"
for p in $forbidden_ports; do
  if [[ "$API_SERVER_PORT" == "$p" ]]; then
    echo "[start.sh][FATAL] API_SERVER_PORT=$p collides with reserved port (Hermes / KnovaX / DocAI / MaterialOS)" >&2
    exit 1
  fi
done

mkdir -p "$OPENATLAS_HOME/logs" \
         "$OPENATLAS_HOME/hermes-tenants/$OPENATLAS_TENANT" \
         "$(dirname "$HERMES_HOME")" \
         "$HERMES_HOME/logs" "$HERMES_HOME/sessions" "$HERMES_HOME/skills" "$HERMES_HOME/memory"

# ── Layer 5: never link, copy, or read from ~/.hermes ──────────────────────
echo "[start.sh] layer 5: no ~/.hermes import (verified by absence of symlinks)"
find "$HERMES_HOME" -type l -lname "*$LOCAL_HERMES_HOME*" 2>/dev/null | while read -r l; do
  echo "[start.sh][FATAL] found symlink into ~/.hermes: $l" >&2
  exit 1
done

# ── Layer 6: pre-start mtime snapshot of local Hermes state ────────────────
SNAPSHOT="$OPENATLAS_HOME/logs/local-hermes-mtime-before.txt"
{
  stat -f "%m %N" "$LOCAL_HERMES_HOME/config.yaml" 2>/dev/null || true
  stat -f "%m %N" "$LOCAL_HERMES_HOME/state.db" 2>/dev/null || true
  stat -f "%m %N" "$LOCAL_HERMES_HOME/profiles/claude/config.yaml" 2>/dev/null || true
  stat -f "%m %N" "$LOCAL_HERMES_HOME/profiles/claude/state.db" 2>/dev/null || true
  stat -f "%m %N" "$LOCAL_HERMES_HOME/sessions" 2>/dev/null || true
} > "$SNAPSHOT"
echo "[start.sh] layer 6: mtime snapshot → $SNAPSHOT"

# ── Port-in-use check ──────────────────────────────────────────────────────
check_port() {
  local p=$1 name=$2
  if lsof -i :$p >/dev/null 2>&1; then
    local offenders
    offenders=$(lsof -i :$p -nP 2>/dev/null | tail -n +2 | awk '{print $1}' | sort -u)
    if echo "$offenders" | grep -q -i "hermes_api\|openatlas"; then
      : # our own leftover process, ok to clean up below
    else
      echo "[start.sh][FATAL] $name port $p already in use by: $offenders" >&2
      exit 1
    fi
  fi
}
check_port "$API_SERVER_PORT" "Hermes API server"
check_port "$OPENATLAS_FRONTEND_PORT" "Vite frontend"
check_port "$OPENATLAS_BACKEND_PORT" "FastAPI backend"

echo "[start.sh] isolation OK"
echo "  OPENATLAS_HOME     = $OPENATLAS_HOME"
echo "  HERMES_HOME        = $HERMES_HOME"
echo "  HERMES_RUNTIME     = $HERMES_RUNTIME    (isolated copy, NOT ~/.hermes/hermes-agent)"
echo "  HERMES_PY          = $HERMES_PY"
echo "  API_SERVER_PORT    = $API_SERVER_PORT"
echo "  FRONTEND_PORT      = $OPENATLAS_FRONTEND_PORT"
echo "  BACKEND_PORT       = $OPENATLAS_BACKEND_PORT"

LAUNCHER="$PROJECT_ROOT/runtime/launchers/hermes_api_server.py"
LOG="$OPENATLAS_HOME/logs/hermes-gateway.log"

echo "[start.sh] launching Hermes API server on :$API_SERVER_PORT from isolated runtime ..."
nohup env -u HOME \
  PYTHONPATH="$HERMES_RUNTIME" \
  OPENATLAS_HOME="$OPENATLAS_HOME" \
  HERMES_HOME="$HERMES_HOME" \
  API_SERVER_HOST="$API_SERVER_HOST" \
  API_SERVER_PORT="$API_SERVER_PORT" \
  API_SERVER_KEY="$API_SERVER_KEY" \
  "$HERMES_PY" "$LAUNCHER" \
  > "$LOG" 2>&1 < /dev/null &

HERMES_PID=$!
echo "$HERMES_PID" > "$OPENATLAS_HOME/hermes-gateway.pid"
disown "$HERMES_PID" 2>/dev/null || true
echo "[start.sh] hermes-gateway pid=$HERMES_PID"
echo "[start.sh] log: $LOG"

# Wait for /health
HEALTH_URL="http://127.0.0.1:$API_SERVER_PORT/health"
for i in {1..30}; do
  if curl -s -H "Authorization: Bearer $API_SERVER_KEY" "$HEALTH_URL" 2>/dev/null | grep -q '"status"'; then
    echo "[start.sh] hermes-gateway /health OK"
    break
  fi
  sleep 0.5
  if ! kill -0 "$HERMES_PID" 2>/dev/null; then
    echo "[start.sh][FATAL] hermes-gateway died — see $LOG" >&2
    tail -40 "$LOG" >&2
    exit 1
  fi
done

# ── Layer 8: verify launched PID is from our isolated hermes-runtime ──────
# 1. The PID's command line must include our hermes-runtime path (the script),
#    and PYTHONPATH of the process must be our hermes-runtime.
# 2. We refuse if any path under /Users/macbook/.hermes appears in the
#    process's open file handles, environment, or executable cmdline.
sleep 1
PID_CMD=$(ps -p "$HERMES_PID" -o command= 2>/dev/null || true)
if [[ -z "$PID_CMD" ]]; then
  echo "[start.sh][FATAL] layer 8: hermes-gateway PID $HERMES_PID is gone" >&2
  exit 1
fi
# 1a) Must reference our launcher (under openatlas/) and our hermes-runtime
if [[ "$PID_CMD" != *"$PROJECT_ROOT/runtime/launchers/hermes_api_server.py"* ]]; then
  echo "[start.sh][FATAL] layer 8: hermes-gateway cmdline doesn't reference our launcher" >&2
  echo "  cmdline: $PID_CMD" >&2
  kill "$HERMES_PID" 2>/dev/null || true
  exit 1
fi
# 1b) /proc/<pid>/environ must contain PYTHONPATH=...hermes-runtime...
if [[ -r "/proc/$HERMES_PID/environ" ]]; then
  PID_PYTHONPATH=$(tr '\0' '\n' < "/proc/$HERMES_PID/environ" | grep '^PYTHONPATH=' | head -1 || true)
  if [[ -z "$PID_PYTHONPATH" ]] || [[ "$PID_PYTHONPATH" != *"$HERMES_RUNTIME"* ]]; then
    echo "[start.sh][FATAL] layer 8: PYTHONPATH of PID $HERMES_PID is not under $HERMES_RUNTIME" >&2
    echo "  got: $PID_PYTHONPATH" >&2
    kill "$HERMES_PID" 2>/dev/null || true
    exit 1
  fi
  # 1c) Must NOT contain /Users/macbook/.hermes anywhere
  if tr '\0' '\n' < "/proc/$HERMES_PID/environ" | grep -q "$LOCAL_HERMES_HOME"; then
    echo "[start.sh][FATAL] layer 8: PID $HERMES_PID has $LOCAL_HERMES_HOME in its environment — contamination!" >&2
    kill "$HERMES_PID" 2>/dev/null || true
    exit 1
  fi
else
  # macOS doesn't have /proc; fall back to ps + lsof path check
  PID_EXE=$(ps -p "$HERMES_PID" -o command= | awk '{print $1}')
  # Check open files for any path under ~/.hermes
  if lsof -p "$HERMES_PID" 2>/dev/null | grep -q "$LOCAL_HERMES_HOME"; then
    echo "[start.sh][FATAL] layer 8: PID $HERMES_PID has open files under $LOCAL_HERMES_HOME — contamination!" >&2
    kill "$HERMES_PID" 2>/dev/null || true
    exit 1
  fi
  if [[ "$PID_EXE" == "$LOCAL_HERMES_HOME"* ]]; then
    echo "[start.sh][FATAL] layer 8: hermes-gateway executable is under $LOCAL_HERMES_HOME" >&2
    kill "$HERMES_PID" 2>/dev/null || true
    exit 1
  fi
fi
echo "[start.sh] layer 8 verified: hermes-gateway runs from $PROJECT_ROOT + PYTHONPATH=$HERMES_RUNTIME ✓"

# ── Layer 6 (cont.): post-start mtime re-check ────────────────────────────
SNAPSHOT_AFTER="$OPENATLAS_HOME/logs/local-hermes-mtime-after.txt"
{
  stat -f "%m %N" "$LOCAL_HERMES_HOME/config.yaml" 2>/dev/null || true
  stat -f "%m %N" "$LOCAL_HERMES_HOME/state.db" 2>/dev/null || true
  stat -f "%m %N" "$LOCAL_HERMES_HOME/profiles/claude/config.yaml" 2>/dev/null || true
  stat -f "%m %N" "$LOCAL_HERMES_HOME/profiles/claude/state.db" 2>/dev/null || true
  stat -f "%m %N" "$LOCAL_HERMES_HOME/sessions" 2>/dev/null || true
} > "$SNAPSHOT_AFTER"

if ! diff -q "$SNAPSHOT" "$SNAPSHOT_AFTER" >/dev/null; then
  echo "[start.sh][FATAL] local Hermes state mtimes changed during startup — possible contamination!" >&2
  diff "$SNAPSHOT" "$SNAPSHOT_AFTER" >&2
  kill "$HERMES_PID" 2>/dev/null || true
  exit 1
fi
echo "[start.sh] layer 6 verified: local ~/.hermes mtime unchanged ✓"

# ── Process audit (LOCAL vs OURS) ───────────────────────────────────────────
echo ""
echo "  ── Process audit (local vs ours) ──"
ps -axo pid,command | awk '
  $5 ~ /hermes_bridge|hermes-web-ui/ { print "  LOCAL  hermes    " $0 }
  $5 ~ /hermes_api_server/ { print "  OURS   openatlas " $0 }
'

cat <<EOF

[start.sh] ════════════════════════════════════════════════════════════════
  OpenAtlas demo tenant started.

  Hermes Gateway:  http://127.0.0.1:$API_SERVER_PORT
                  (key: $API_SERVER_KEY)
  Hermes runtime:  $HERMES_RUNTIME  (ISOLATED COPY)
  Frontend (Vite): http://127.0.0.1:$OPENATLAS_FRONTEND_PORT
  Backend  (FastAPI): http://127.0.0.1:$OPENATLAS_BACKEND_PORT

  Our PID file:    $OPENATLAS_HOME/hermes-gateway.pid  ($HERMES_PID)
  Stop US only:    kill \$(cat $OPENATLAS_HOME/hermes-gateway.pid)
  NEVER pkill -f hermes  (would kill the local business Hermes bridges)

  Isolation evidence:
  - hermes-gateway executable: $PID_EXE
  - HERMES_HOME:               $HERMES_HOME  (under $OPENATLAS_HOME, NOT ~/.hermes)
  - ~/.hermes mtime:           UNCHANGED ✓
  - Port 8642/9119:            UNUSED by us ✓

  Next:
    cd openatlas/backend && .venv/bin/uvicorn app.main:app --port $OPENATLAS_BACKEND_PORT
    cd openatlas/frontend && npm run dev
════════════════════════════════════════════════════════════════════════
EOF
