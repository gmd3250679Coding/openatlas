# OpenAtlas — Phase 2 Delivery (Multi-tenant Routing)

**Date:** 2026-06-06
**Status:** DONE
**Phase:** 2 — Multi-tenant MVP (per-tenant HERMES_HOME, per-tenant Hermes Gateway, tenant CRUD)

---

## 1. What was delivered

| Capability | Status | Evidence |
|---|---|---|
| `tenants` DB table + system admin CRUD | DONE | `admin_create_tenant` endpoint seeds tenant + admin user + HermesRuntime row + port |
| Per-tenant `HERMES_HOME` | DONE | `/_tenant_home(slug)` → `~/.openatlas/hermes-tenants/{slug}/.hermes` |
| Per-tenant Hermes Gateway process | DONE | `start_tenant.sh` spawns isolated `hermes_api_server.py` per tenant |
| Per-tenant API key | DONE | `openatlas-{slug}-key-{uuid4-8}` generated on tenant create |
| Per-tenant port allocation | DONE | `_next_hermes_port` linear scan from 58643 (58642 reserved for demo) |
| Tenant runtime lifecycle | DONE | `POST /api/admin/tenants/{tid}/hermes-runtime/{start,stop,healthcheck}` |
| Tenant-aware `RuntimeTarget` resolution | DONE | `hermes_client.resolve_target(db, tenant_id)` — falls back to env default |
| Cross-tenant isolation (data) | DONE | All employee/session reads reject foreign tenant → HTTP 404 |
| Cross-tenant routing (Hermes gateway) | DONE | Acme chat hits 58643, demo chat hits 58642 |
| Hard isolation from `~/.hermes` | VERIFIED | `~/.hermes/config.yaml` mtime = 6月 2 10:14 (untouched), 0 refs from openatlas pids |

## 2. Endpoints added (Phase 2)

All under `/api/admin/tenants/` and gated by `require_system_admin` (system_admin role):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/tenants` | List tenants with embedded runtime summary |
| POST | `/api/admin/tenants` | Create tenant + admin user + runtime row + port reservation |
| GET | `/api/admin/tenants/{tid}/hermes-runtime` | Get runtime status (port, status, health) |
| POST | `/api/admin/tenants/{tid}/hermes-runtime/start` | Spawn per-tenant hermes-gateway process |
| POST | `/api/admin/tenants/{tid}/hermes-runtime/stop` | Kill per-tenant hermes-gateway process |
| POST | `/api/admin/tenants/{tid}/hermes-runtime/healthcheck` | Probe /health and update DB status |

## 3. Data model additions (Phase 2)

`HermesRuntime` table now carries:
- `pid` (INTEGER) — running process id
- `api_key_encrypted` (VARCHAR 255) — primary key for tenant gateway auth

Backfill is idempotent in `init_db()`:
```sql
ALTER TABLE hermes_runtimes ADD COLUMN api_key_encrypted VARCHAR(255) DEFAULT '';
ALTER TABLE hermes_runtimes ADD COLUMN pid INTEGER;
```

`Tenant.home_dir` is **not** stored — derived from `OPENATLAS_HOME / hermes-tenants / slug / .hermes`.

## 4. The two bugs I hit (and the fixes)

### Bug A — `env` Popen mangles `HERMES_HOME`
**Symptom:** spawn log shows `env: HERMES_HOME: No such file or directory` and `bash: -c: line 0: syntax error near unexpected token \`('`
**Root cause:** `subprocess.Popen(["env", "-u", "X", "bash", "-c", cmd_str], ...)` with `cmd_str` containing Python `PosixPath('/Users/macbook/.openatlas')` literal. Plus `bash -c` only takes a single command string; multi-line `bash -lc "set +m; env -u ... python3 ..."` does not survive argv splitting.
**Fix:** rebuilt `cmd_str` to use `str(Path(...))` for the absolute HERMES_HOME path AND a single bash command. See `backend/app/main.py:admin_start_runtime`.

### Bug B — backend `httpx.AsyncClient` honors SOCKS5 proxy
**Symptom:** backend healthcheck returns 502 for healthy gateway; `curl http://127.0.0.1:58643/health` (with `env -u ALL_PROXY`) returns `{"status":"ok"}`.
**Root cause:** SOCKS5 proxy at `socks5h://127.0.0.1:7890` cannot resolve `127.0.0.1` on a per-process bound port, returns 502. `httpx` (and `curl`) read it from `SOCKS_PROXY` env unless `trust_env=False`. The first time I hit this was DocAI SOCKS5 issue.
**Fix:** added `_client(**kw)` factory in `app/services/hermes_client.py` that strips `ALL_PROXY / all_proxy / HTTP_PROXY / HTTPS_PROXY / SOCKS_PROXY / socks_proxy / NO_PROXY / no_proxy` from `os.environ` and sets `trust_env=False`. All `httpx.AsyncClient(...)` call sites now use `_client(...)`. Also patched the healthcheck endpoint in `main.py` (it was using a local `import httpx as _httpx` and bypassing the factory).

## 5. End-to-end verification

### 5.1 Per-tenant gateway boot
```bash
$ curl -s -X POST .../api/admin/tenants/$acme_id/hermes-runtime/start
{"ok":true,"spawned":true,"pid":99692,"port":58643,...}
# log tail:
[isolation-guard] OK
  HERMES_HOME     = /Users/macbook/.openatlas/hermes-tenants/acme/.hermes
[hermes-home] ready ... (config preserved)
[launcher] starting Hermes API server on http://127.0.0.1:58643
[launcher] ready — http://127.0.0.1:58643/health
[start_tenant.sh] /health OK on port 58643
[start_tenant.sh] layer 8 verified: hermes-gateway runs from
  /Users/macbook/Desktop/Atlasagent/openatlas + PYTHONPATH=.../hermes-runtime ✓
[start_tenant.sh] ready ✓
```

### 5.2 Acme LLM chat through tenant gateway
acme admin token → create session on acme → SSE stream with `mimo-v2.5-pro`:
```
event: openatlas.memories → {"items":[]}
event: run.started
event: message.started
event: assistant.delta → "ACME_PHASE2"
event: assistant.delta → "_OK"
event: assistant.completed
event: run.completed
event: done
elapsed: 12.2s, 9 events
```
LLM responded with `ACME_PHASE2_OK` — confirms:
1. Acme token resolves to acme's `RuntimeTarget` (port 58643)
2. SSE streams from per-tenant gateway through backend proxy
3. Memory injection event fires (Phase 2 `openatlas.memories` event present)

### 5.3 Cross-tenant data isolation
| Test | Result |
|---|---|
| acme → demo employee detail | HTTP 404 |
| acme → demo session detail | HTTP 404 |
| acme → demo session messages | HTTP 404 |
| acme → employees list | 0 items (correctly empty) |
| acme → sessions list | 1 item (only acme's) |
| demo → acme session detail | HTTP 404 |

### 5.4 Hard isolation from `~/.hermes`
```
$ ls -la /Users/macbook/.hermes/config.yaml
6月  2 10:14 /Users/macbook/.hermes/config.yaml   ← mtime unchanged

$ ls -la /Users/macbook/.openatlas/hermes-tenants/{demo,acme}/.hermes/config.yaml
6月  6 11:53 demo/.hermes/config.yaml
6月  6 13:02 acme/.hermes/config.yaml

$ for p in $(pgrep -f launchers/hermes_api_server.py); do
    echo "pid $p: refs to ~/.hermes = $(lsof -p $p 2>/dev/null | grep -c /Users/macbook/.hermes/)"
  done
pid 4144: refs to ~/.hermes = 0      ← backend
pid 98458: refs to ~/.hermes = 0
pid 98465: refs to ~/.hermes = 0     ← demo hermes-gateway
pid 99705: refs to ~/.hermes = 0     ← acme hermes-gateway
```

### 5.5 Process topology
```
pid 98465 /Users/macbook/.openatlas/hermes-runtime/.venv/bin/python3
  cwd = (BAK) HERMES_HOME = /Users/macbook/.openatlas/hermes-tenants/demo/.hermes
  listening: 127.0.0.1:58642  ← demo
pid 99705 (same command, different env)
  HERMES_HOME = /Users/macbook/.openatlas/hermes-tenants/acme/.hermes
  listening: 127.0.0.1:58643  ← acme
```

## 6. Files touched (Phase 2)

- `openatlas/backend/app/main.py` — added 5 admin endpoints (list/create tenant, runtime get/start/stop/healthcheck); patched `healthcheck` to use `_client` factory
- `openatlas/backend/app/services/hermes_client.py` — added `_client(**kw)` with SOCKS5-strip + `trust_env=False`; all call sites updated
- `openatlas/backend/app/db/session.py` — backfill columns in `init_db()`; `Tenant` exists from Phase 1 seed
- `openatlas/backend/app/db/models.py` — `HermesRuntime.pid` and `api_key_encrypted` already present from Phase 1 spec
- `openatlas/scripts/start_tenant.sh` — fixed `PROJECT_ROOT` discovery (was `OPENATLAS_HOME/..` which resolved to `~/.openatlas/..` ≠ `Desktop/Atlasagent/openatlas`); now walks up looking for `runtime/launchers/hermes_api_server.py`

## 7. What Phase 3 (enterprise) needs to add (out of scope here)

- Encrypt `api_key_encrypted` at rest (Phase 2 stores plaintext, column is named "encrypted" for future compatibility)
- Containerize each tenant gateway (per-tenant Docker container with per-tenant volume)
- Gateway health-check loop with auto-restart and backoff
- RBAC: tenant_admin → can only manage own tenant
- Audit log UI + filtering
- Resource quotas: per-tenant token budget, session count cap, request rate limit
- Per-tenant session/employee cleanup cron
- Multi-region routing

## 8. Open known issues / deferrals

- `_next_hermes_port` is a linear scan — fine for ≤50 tenants, needs replacement at scale
- `healthcheck` does not auto-restart on `error` status — manual `start` required
- No lock around `start` to prevent double-spawn races; user must check status first
- `start_tenant.sh` is bash 3-compatible (uses BASH_SOURCE fallback) but hasn't been tested on Linux
- The `bash` process in `_start_tenant_script` is spawned via `subprocess.Popen` with `env=` and shell command — no native async, ~200ms startup latency per start call
