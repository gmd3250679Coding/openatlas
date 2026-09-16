#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${REMOTE:-}" ]]; then
  echo "Usage: REMOTE=ubuntu@your-cvm-public-ip [SSH_OPTS='-p 22 -i ~/.ssh/id_ed25519'] [INSTALL_OFFICE_QA_DEPS=1] bash deploy/deploy_tencent.sh" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_ROOT="${APP_ROOT:-/opt/openatlas}"
DATA_ROOT="${DATA_ROOT:-/var/lib/openatlas}"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d%H%M%S)}"
REMOTE_RELEASE="$APP_ROOT/releases/$RELEASE_ID"
HERMES_RUNTIME_SRC="${HERMES_RUNTIME_SRC:-$HOME/.openatlas/hermes-runtime}"
ENABLE_HTTPS="${ENABLE_HTTPS:-0}"
INSTALL_OFFICE_QA_DEPS="${INSTALL_OFFICE_QA_DEPS:-1}"
SSH_OPTS="${SSH_OPTS:-}"
SSH_ARGS=()
RSYNC_RSH="ssh"
if [[ -n "$SSH_OPTS" ]]; then
  read -r -a SSH_ARGS <<< "$SSH_OPTS"
  RSYNC_RSH="ssh $SSH_OPTS"
fi
REMOTE_HOST="${REMOTE#*@}"

log() { printf '[openatlas-deploy] %s\n' "$*"; }

log "project root: $PROJECT_ROOT"
log "remote: $REMOTE"
log "release: $REMOTE_RELEASE"

if [[ ! -d "$PROJECT_ROOT/frontend" || ! -d "$PROJECT_ROOT/backend" ]]; then
  echo "Not an OpenAtlas project root: $PROJECT_ROOT" >&2
  exit 1
fi

log "building frontend"
cd "$PROJECT_ROOT/frontend"
npm ci
npm run build

cd "$PROJECT_ROOT"

log "creating remote directories"
ssh ${SSH_ARGS[@]+"${SSH_ARGS[@]}"} "$REMOTE" "sudo mkdir -p '$APP_ROOT/releases' '$DATA_ROOT' /etc/openatlas && sudo chown -R \"\$USER\":\"\$USER\" '$APP_ROOT/releases' '$DATA_ROOT'"

log "syncing OpenAtlas release"
rsync -az --delete -e "$RSYNC_RSH" \
  --exclude '.git/' \
  --exclude '.DS_Store' \
  --exclude 'backend/.venv/' \
  --exclude 'backend/__pycache__/' \
  --exclude 'backend/.local/' \
  --exclude 'frontend/node_modules/' \
  --exclude 'frontend/.vite/' \
  --exclude 'outputs/' \
  --exclude 'logs/' \
  "$PROJECT_ROOT/" "$REMOTE:$REMOTE_RELEASE/"

if [[ -d "$HERMES_RUNTIME_SRC" ]]; then
log "syncing isolated Hermes runtime source"
  ssh ${SSH_ARGS[@]+"${SSH_ARGS[@]}"} "$REMOTE" "mkdir -p '$DATA_ROOT/hermes-runtime'"
  rsync -az --delete -e "$RSYNC_RSH" \
    --exclude '.git/' \
    --exclude '.venv/' \
    --exclude 'node_modules/' \
    --exclude '__pycache__/' \
    --exclude '.mypy_cache/' \
    --exclude '.pytest_cache/' \
    "$HERMES_RUNTIME_SRC/" "$REMOTE:$DATA_ROOT/hermes-runtime/"
else
  log "warning: Hermes runtime source not found at $HERMES_RUNTIME_SRC"
fi

log "installing server-side dependencies and services"
ssh ${SSH_ARGS[@]+"${SSH_ARGS[@]}"} "$REMOTE" "bash -s" -- "$REMOTE_RELEASE" "$APP_ROOT" "$DATA_ROOT" "${DOMAIN:-_}" "$ENABLE_HTTPS" "$INSTALL_OFFICE_QA_DEPS" <<'REMOTE_SCRIPT'
set -euo pipefail

RELEASE="$1"
APP_ROOT="$2"
DATA_ROOT="$3"
DOMAIN="$4"
ENABLE_HTTPS_VALUE="${5:-0}"
INSTALL_OFFICE_QA_DEPS_VALUE="${6:-1}"

sudo useradd --system --home "$DATA_ROOT" --shell /usr/sbin/nologin openatlas 2>/dev/null || true
sudo mkdir -p "$DATA_ROOT" "$APP_ROOT/releases" /etc/openatlas
sudo chown -R "$USER":"$USER" "$DATA_ROOT"
sudo chown -R "$USER":"$USER" "$RELEASE"
find "$RELEASE" -type d -exec chmod 755 {} +
find "$RELEASE" -type f -exec chmod 644 {} +
find "$RELEASE/deploy" -type f -name "*.sh" -exec chmod 755 {} + 2>/dev/null || true

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y python3 python3-venv python3-pip nginx rsync curl
  if [[ "$INSTALL_OFFICE_QA_DEPS_VALUE" == "1" ]]; then
    sudo apt-get install -y \
      libreoffice-impress \
      libreoffice-writer \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
      fontconfig
    sudo fc-cache -f >/dev/null 2>&1 || true
  fi
  if ! command -v python3.12 >/dev/null 2>&1 && ! command -v python3.11 >/dev/null 2>&1; then
    sudo apt-get install -y python3.12 python3.12-venv 2>/dev/null \
      || sudo apt-get install -y python3.11 python3.11-venv 2>/dev/null \
      || true
  fi
fi

PYTHON_BIN=""
if command -v python3.12 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3.12)"
elif command -v python3.11 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3.11)"
elif python3 - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PY
then
  PYTHON_BIN="$(command -v python3)"
fi
if [[ -z "$PYTHON_BIN" ]]; then
  echo "Python 3.11+ is required for Hermes/OpenAtlas. Install python3.11/python3.12 first." >&2
  exit 1
fi

"$PYTHON_BIN" -m venv "$RELEASE/backend/.venv"
"$RELEASE/backend/.venv/bin/pip" install --upgrade pip
"$RELEASE/backend/.venv/bin/pip" install -r "$RELEASE/backend/requirements.txt"

if [[ -d "$DATA_ROOT/hermes-runtime" ]]; then
  "$PYTHON_BIN" -m venv "$DATA_ROOT/hermes-runtime/.venv"
  "$DATA_ROOT/hermes-runtime/.venv/bin/pip" install --upgrade pip
  "$DATA_ROOT/hermes-runtime/.venv/bin/pip" install -e "$DATA_ROOT/hermes-runtime"
  # Hermes may lazily enable optional provider extras during first runtime use.
  # Preinstall the lightweight Bedrock dependency so user chat requests are not
  # blocked by an in-band `pip install boto3` inside the Gateway process.
  "$DATA_ROOT/hermes-runtime/.venv/bin/pip" install "boto3==1.42.89"
  "$DATA_ROOT/hermes-runtime/.venv/bin/pip" install "aiohttp==3.13.3"
  # Common document/office runtime dependencies used by Hermes Skills and
  # generated deliverables. Keep these preinstalled on the tenant runtime so
  # Word/Excel/PDF/PPT tasks do not try to pip-install packages during chat.
  "$DATA_ROOT/hermes-runtime/.venv/bin/pip" install \
    "python-docx==1.2.0" \
    "openpyxl==3.1.5" \
    "python-pptx==1.0.2" \
    "reportlab==4.2.5" \
    "pypdf==5.1.0" \
    "pdfplumber==0.11.5" \
    "beautifulsoup4==4.12.3" \
    "xlsxwriter==3.2.0" \
    "mammoth==1.8.0"
  # Optional A-share data skill runtime dependencies. Install mootdx without its
  # older httpx/tenacity pins so the Hermes runtime keeps its own dependency set.
  "$DATA_ROOT/hermes-runtime/.venv/bin/pip" install "pandas==2.2.3" "stockstats==0.6.5" "py-mini-racer==0.6.0" "tdxpy==0.2.7" "prettytable==3.17.0"
  "$DATA_ROOT/hermes-runtime/.venv/bin/pip" install --no-deps "mootdx==0.11.7"
fi

if [[ ! -f /etc/openatlas/openatlas.env ]]; then
  sudo cp "$RELEASE/deploy/openatlas.env.example" /etc/openatlas/openatlas.env
  SECRET="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))')"
  GATEWAY_KEY="$(openssl rand -hex 24 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(24))')"
  sudo sed -i "s|^OPENATLAS_SECRET=.*|OPENATLAS_SECRET=$SECRET|" /etc/openatlas/openatlas.env
  sudo sed -i "s|^API_SERVER_KEY=.*|API_SERVER_KEY=$GATEWAY_KEY|" /etc/openatlas/openatlas.env
fi
sudo chmod 600 /etc/openatlas/openatlas.env

sudo cp "$RELEASE/deploy/systemd/openatlas-backend.service" /etc/systemd/system/openatlas-backend.service
sudo cp "$RELEASE/deploy/nginx/openatlas.conf" /etc/nginx/sites-available/openatlas.conf
sudo sed -i "s|server_name _;|server_name $DOMAIN;|" /etc/nginx/sites-available/openatlas.conf
if [[ "$ENABLE_HTTPS_VALUE" == "1" && "$DOMAIN" != "_" ]] \
  && sudo test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" \
  && sudo test -f "/etc/letsencrypt/live/$DOMAIN/privkey.pem"; then
  SSL_OPTIONS=""
  SSL_DHPARAM=""
  if [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
    SSL_OPTIONS="include /etc/letsencrypt/options-ssl-nginx.conf;"
  fi
  if [[ -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
    SSL_DHPARAM="ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  fi
  sudo tee /etc/nginx/sites-available/openatlas.conf >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    $SSL_OPTIONS
    $SSL_DHPARAM

    client_max_body_size 100m;

    root /opt/openatlas/current/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:58003/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1800s;
        proxy_send_timeout 1800s;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
fi
sudo ln -sfn /etc/nginx/sites-available/openatlas.conf /etc/nginx/sites-enabled/openatlas.conf
sudo rm -f /etc/nginx/sites-enabled/default
if [[ "$DOMAIN" != "_" ]]; then
  for SITE in "$DOMAIN" "www.$DOMAIN"; do
    if [[ -e "/etc/nginx/sites-enabled/$SITE" ]] \
      && [[ "$(readlink -f "/etc/nginx/sites-enabled/$SITE")" != "/etc/nginx/sites-available/openatlas.conf" ]]; then
      sudo rm -f "/etc/nginx/sites-enabled/$SITE"
    fi
  done
fi

sudo ln -sfn "$RELEASE" "$APP_ROOT/current"
sudo chown -R openatlas:openatlas "$RELEASE" "$DATA_ROOT"

sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable openatlas-backend
sudo systemctl restart openatlas-backend
sudo systemctl reload nginx

for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:58003/api/health >/dev/null 2>&1; then
    exit 0
  fi
  sleep 2
done

sudo systemctl status openatlas-backend --no-pager -l || true
sudo journalctl -u openatlas-backend -n 120 --no-pager || true
curl -fsS http://127.0.0.1:58003/api/health >/dev/null
REMOTE_SCRIPT

log "deployed"
if [[ -n "${DOMAIN:-}" && "${DOMAIN:-_}" != "_" ]]; then
  log "open http://$DOMAIN/"
else
  log "open http://$REMOTE_HOST/"
fi
