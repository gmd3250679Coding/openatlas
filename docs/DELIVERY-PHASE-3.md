# OpenAtlas — Phase 3 Delivery (Enterprise Hardening)

**Date:** 2026-06-06
**Status:** DONE
**Phase:** 3 — Enterprise (encryption, RBAC, auto-restart, resource limits, tenant lifecycle)

---

## 1. What was delivered

| Capability | Status | Evidence |
|---|---|---|
| API key encryption at rest | DONE | `app/core/encryption.py` Fernet, key file mode 0600, plaintext migration on startup |
| RBAC enforcement (tenant_admin scoped to own tenant) | DONE | `require_tenant_or_system_admin` dep on 4 runtime endpoints |
| Gateway auto-restart | DONE | `app/services/supervisor.py` background task + `/api/admin/supervisor` |
| Gateway process reconciliation | DONE | Supervisor reconciles DB pid via `lsof` when external process is listening |
| Resource limits (per-tenant) | DONE | `Tenant.max_sessions` / `max_employees` enforced on create |
| Tenant PATCH (name/plan/limits) | DONE | `PATCH /api/admin/tenants/{tid}` |
| Tenant DELETE (cascade) | DONE | `DELETE /api/admin/tenants/{tid}` with cascade + home dir cleanup |

## 2. Endpoints added (Phase 3)

| Method | Path | Role required |
|---|---|---|
| GET | `/api/admin/supervisor` | system_admin |
| PATCH | `/api/admin/tenants/{tid}` | system_admin |
| DELETE | `/api/admin/tenants/{tid}` | system_admin (demo protected) |

Plus the **runtime endpoints** (`GET / POST /api/admin/tenants/{tid}/hermes-runtime/{start,stop,healthcheck}`) — changed from `system_admin` only to `tenant_or_system_admin`. A `tenant_admin` can now manage their own runtime.

## 3. Encryption at rest (Phase 3.1)

**Threat model:** SQLite DB at `~/.openatlas/backend-data/openatlas.db` is a single file. Anyone with read access to the host can `sqlite3 openatlas.db "SELECT api_key_encrypted FROM hermes_runtimes"` and replay the keys.

**Solution:** Fernet (AES128-CBC + HMAC-SHA256). The symmetric key is generated on first import and stored at `~/.openatlas/backend-data/secrets.key` with mode `0600`. The key is local to the OpenAtlas home; for multi-host deployment Phase 4 will swap to KMS or Vault.

**Format on disk:**
```
fernet:v1:gAAAAA...   ← encrypted
openatlas-...         ← legacy plaintext (migrated on startup)
```

**Migration on startup:** `_startup()` in `app/main.py` runs `migrate_plaintext_keys(db)` which:
- Scans all `HermesRuntime` rows
- Re-encrypts any value that doesn't start with `fernet:v1:`
- Commits the migration once

**Verified:** `sqlite3 ... "SELECT substr(api_key_encrypted,1,40) FROM hermes_runtimes"` returns `fernet:v1:gAAAAA...` for all rows. `secrets.key` exists, mode `0o600`. Demo gateway still auths (decrypt → bearer works). Acme gateway still auths. New tenant creates get encrypted keys.

## 4. RBAC (Phase 3.2)

**Roles** (defined in `app/db/models.py:UserRole`):
- `system_admin` — sees/manages all tenants
- `tenant_admin` — can only manage own tenant
- `user` — read-only on own tenant (cannot create employees)

**New dep** `require_tenant_or_system_admin(tid, p)`:
- If `system_admin`: allows access to any tenant; swaps `p.tenant` to the path tenant so downstream code uses the right HERMES_HOME.
- If `tenant_admin` AND `p.tenant.id == tid`: allows.
- Otherwise: HTTP 403.

**Endpoints converted** from `require_system_admin` → `require_tenant_or_system_admin`:
- `GET /api/admin/tenants/{tid}/hermes-runtime`
- `POST /api/admin/tenants/{tid}/hermes-runtime/start`
- `POST /api/admin/tenants/{tid}/hermes-runtime/stop`
- `POST /api/admin/tenants/{tid}/hermes-runtime/healthcheck`

**Verified** (6/6 cases): acme admin can read/start/stop/healthcheck own runtime, blocked from demo runtime (403). Demo admin (system_admin) can read any tenant runtime. Acme admin cannot PATCH or DELETE tenants (system_admin only).

## 5. Gateway auto-restart (Phase 3.3)

**Module:** `app/services/supervisor.py`

**Loop:**
- Every `POLL_SECONDS=15s`, scan `HermesRuntime` rows
- For each runtime, classify into 3 cases:

**Case 1 — happy path:** DB pid alive AND port has listener. Update status to `running` if needed. No spawn.

**Case 2 — orphan reconciliation:** DB pid dead but some other process (e.g. start.sh) is listening on the port and responding. Read actual pid via `lsof -nP -iTCP:{port} -sTCP:LISTEN -Fp`, update DB pid + status. No spawn.

**Case 3 — respawn:** DB pid dead AND port is not listening. Shell out `start_tenant.sh` (same env-construction as the HTTP /start endpoint), capture new pid, wait up to 10s for `kill -0` + port-accept, mark status `running` if healthy else increment `consecutive_failures`.

**Backoff:** `[5, 15, 30, 60, 60, 60, 60, 60, 60, 60]` seconds per consecutive failure. After 6 restarts in 1 hour, status → `crashed` and supervisor stops trying.

**Tunables** (`app/services/supervisor.py`):
```python
POLL_SECONDS = 15
BACKOFF = [5, 15, 30, 60, 60, 60, 60, 60, 60, 60]
_MAX_RESTART_PER_HOUR = 6
```

**Verified end-to-end:**
- Started backend with DB showing pid=98465 (start.sh's bash wrapper) and pid=19047 (acme bash wrapper). Both pids still alive. Supervisor's first tick: Case 1 fired (kill -0 + health OK), no spawn, status `running`. ✓
- Killed acme pid 19047. After 22s, port 58643 dead → supervisor spawned pid 28665 → health check OK → status `running`. `restarts_last_hour: 1`. ✓
- Supervisor endpoint `/api/admin/supervisor` reports per-runtime `last_attempt_at`, `consecutive_failures`, `restarts_last_hour` for UI.

**SOCKS5 caveat:** supervisor runs INSIDE the backend process, which inherits SOCKS5 env. We can't use httpx for the supervisor's liveness probe (SOCKS5 would fail to connect to loopback). Solution: supervisor uses raw `socket.create_connection((host, port), timeout=2)` instead. This is a TCP-level "is the port accepting" check — sufficient for liveness, not a full `/health` response. Phase 4 may add a thread+asyncio probe for the actual HTTP health response.

## 6. Resource limits (Phase 3.4)

**New columns on `tenants`:**
- `max_sessions INTEGER NULL` — None = unlimited
- `max_employees INTEGER NULL` — None = unlimited

Backfilled via idempotent `ALTER TABLE` in `init_db()`.

**Enforcement:**
- `POST /api/employees` checks `DigitalEmployee` count vs `tenant.max_employees` → 429 if at cap
- `POST /api/sessions` checks `SessionRecord` count vs `tenant.max_sessions` → 429 if at cap

**PATCH semantics:** `PATCH /api/admin/tenants/{tid}` uses `body.model_fields_set` to distinguish "field absent" (no change) from "field is null" (clear). Sending `{"max_sessions": null}` clears the limit.

**Verified** (6/6 cases): set max_sessions=2 → first 2 creates OK, 3rd 429 with detail. PATCH to null clears. Set max_employees=1 → 1st OK, 2nd 429. PATCH to other tenant as tenant_admin → 403.

## 7. Tenant lifecycle (Phase 3.5)

**`DELETE /api/admin/tenants/{tid}`** (system_admin only):
1. Refuse if `slug == 'demo'` (the system tenant is protected)
2. Kill any running gateway process for the tenant (`os.kill(pid, 9)`)
3. Cascade-delete referencing rows: `users`, `hermes_runtimes`, `digital_employees`, `sessions`, `audit_logs`, `skill_packages` (where `owner_tenant_id=tid`), `memory_entries`, `memory_bindings`, `skill_bindings`
4. Audit BEFORE deleting the tenant row itself (audit has FK to tenant)
5. Delete the tenant row
6. Remove `~/.openatlas/hermes-tenants/{slug}/` directory from disk (best effort)

**`PATCH /api/admin/tenants/{tid}`** (system_admin only):
- Updates `name`, `plan`, `max_sessions`, `max_employees`
- Audited as `tenant.update`
- Uses `model_fields_set` for explicit-null semantics

**Verified**: tenant_admin PATCH/DELETE → 403; system_admin DELETE demo → 400 "cannot delete the demo tenant".

## 8. Files added / changed (Phase 3)

| File | Change |
|---|---|
| `app/core/encryption.py` | NEW — Fernet, key file, `encrypt`/`decrypt`/`migrate_plaintext_keys` |
| `app/services/supervisor.py` | NEW — auto-restart background task |
| `app/main.py` | Startup hook (migration + supervisor), 3 new endpoints (PATCH/DELETE/supervisor), encryption wired into 4 read sites, RBAC dep + 4 endpoint conversions, 2 resource limit checks, `os` import |
| `app/db/models.py` | `Tenant.max_sessions`, `max_employees` columns |
| `app/db/session.py` | Backfill `ALTER TABLE tenants` for both new columns |
| `app/services/hermes_client.py` | `resolve_target` decrypts API key |

## 9. Open issues / deferrals

- `_next_hermes_port` is still a linear scan (Phase 2 TODO, deferred)
- Resource limit enforcement doesn't include Tokens/cost yet (no token counter)
- `_pid_alive` exists in both `main.py` and `supervisor.py` (could DRY into a util)
- Supervisor's "health" probe is socket-only — doesn't verify the HTTP layer. If a TCP server is listening but `/health` returns 500, supervisor won't notice until process actually dies. Phase 4: add thread+asyncio probe with proper /health check
- No rate-limit on `/chat/stream` (resource limit is cap, not QPS)
- API keys are encrypted at rest but the secrets.key is local — Phase 4 will move to Vault

## 10. Recommended Phase 4 (out of scope)

- Containerize per-tenant gateway (Docker SDK)
- Vault integration for API keys
- Per-tenant rate limit (token bucket in Redis)
- Audit log UI with filtering
- Global skill market full CRUD UI (Phase 3.1 only built the data layer)
- Global Memory / Policy / SOP UI
- Gateway metrics export (Prometheus)
