# OpenAtlas Tencent CVM Deployment

This deploys OpenAtlas as:

- nginx static frontend on `80/443`
- FastAPI backend on `127.0.0.1:58003`
- per-tenant Hermes Gateway processes on `127.0.0.1:58642+`
- data under `/var/lib/openatlas`
- release code under `/opt/openatlas/releases/<timestamp>` with `/opt/openatlas/current` symlink

## Prerequisites

Server:

- Ubuntu 22.04+ recommended
- SSH access with sudo
- Python 3.11+
- nginx
- enough disk for Hermes runtime source and tenant workspaces
- AIPPT PPTX visual QA uses LibreOffice and CJK fonts. The deploy script
  installs them by default; set `INSTALL_OFFICE_QA_DEPS=0` only when you
  intentionally want to skip PPTX->PDF visual verification on a minimal server.

Local:

- Node/npm for frontend build
- rsync
- access to local isolated Hermes runtime at `~/.openatlas/hermes-runtime`

## Deploy

```bash
cd /path/to/openatlas
REMOTE=ubuntu@your-cvm-public-ip bash deploy/deploy_tencent.sh
```

Optional:

```bash
DOMAIN=atlas.example.com REMOTE=ubuntu@your-cvm-public-ip bash deploy/deploy_tencent.sh
```

Skip the Office/PPTX visual QA dependencies on a very small server:

```bash
INSTALL_OFFICE_QA_DEPS=0 REMOTE=ubuntu@your-cvm-public-ip bash deploy/deploy_tencent.sh
```

After the first deploy, edit `/etc/openatlas/openatlas.env` on the server and
set real values for:

- `OPENATLAS_SECRET`
- `API_SERVER_KEY`
- `OPENATLAS_DEFAULT_PROVIDER`
- `OPENATLAS_DEFAULT_PROVIDER_BASE_URL`
- `OPENATLAS_DEFAULT_PROVIDER_API_KEY`
- `OPENATLAS_FALLBACK_PROVIDER`
- `OPENATLAS_FALLBACK_PROVIDER_BASE_URL`
- `OPENATLAS_FALLBACK_PROVIDER_API_KEY`
- `OPENATLAS_MAX_ACTIVE_RUNS_PER_TENANT`
- `OPENATLAS_MAX_ACTIVE_RUNS_PER_USER`

Then restart:

```bash
sudo systemctl restart openatlas-backend
```

## Verify

```bash
curl -fsS http://127.0.0.1:58003/api/health
sudo systemctl status openatlas-backend --no-pager
sudo journalctl -u openatlas-backend -n 100 --no-pager
```

AIPPT cloud quality gate:

```bash
REMOTE=ubuntu@your-cvm-public-ip bash deploy/aippt_cloud_quality_gate.sh
```

This verifies the deployed release, AIPPT chain discipline, 33-template PPTX
gallery coverage, 8 realistic golden prompt decks, editable PPTX package
checks, and PPTX->PDF visual QA. Use `REQUIRE_PDF_VISUAL=0` only when
LibreOffice is intentionally unavailable.

Browser:

- `http://<server-ip>/`
- login: `demo@demo.openatlas / openatlas`

## Rollback

List releases:

```bash
ls -lt /opt/openatlas/releases
```

Point `current` back to an older release and restart:

```bash
sudo ln -sfn /opt/openatlas/releases/<timestamp> /opt/openatlas/current
sudo systemctl restart openatlas-backend
```
