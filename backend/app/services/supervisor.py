"""Phase 3.3 — Gateway supervisor.

Background asyncio task that polls the `hermes_runtimes` table every
`POLL_SECONDS` seconds and re-spawns any tenant gateway whose process
has died (PID in DB but `kill -0` returns nonzero).

Backoff:
  - At most `_MAX_RESTART_PER_HOUR` restarts per (runtime_id, hour).
  - After that we mark the runtime as `crashed` and stop trying.
  - Sleep between failed attempts grows: 5s, 15s, 30s, 60s, then 60s.

Idempotency:
  - We do NOT spawn if PID file in `~/.openatlas/hermes-tenants/{slug}/.hermes/openatlas-gateway.pid` already references a live process.
  - We do NOT spawn if status is `stopped` (operator explicitly stopped it).

Triggered at app startup by `_startup()` in `app.main`.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

log = logging.getLogger("openatlas.supervisor")

POLL_SECONDS = 15
BACKOFF = [5, 15, 30, 60, 60, 60, 60, 60, 60, 60]  # seconds per consecutive failure
_MAX_RESTART_PER_HOUR = 6

# in-memory state (per-process) — would be Redis in production
_last_attempt: dict[str, float] = {}  # runtime_id -> last attempt time
_consecutive_failures: dict[str, int] = defaultdict(int)
_recent_restarts: dict[str, deque[float]] = defaultdict(deque)  # runtime_id -> times in last hour

_task: asyncio.Task | None = None
_shutdown = False


def _is_pid_alive(pid: int | None) -> bool:
    from app.services.process_utils import is_pid_alive
    return is_pid_alive(pid)


def _is_health_ok(base_url: str, api_key: str) -> bool:
    """Probe an authenticated endpoint so stale gateways with old keys fail."""
    import urllib.error
    import urllib.request

    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return 200 <= resp.status < 500
    except urllib.error.HTTPError:
        return False
    except Exception:
        return False


def _pid_file_for(hermes_home: str) -> Path:
    return Path(hermes_home) / "openatlas-gateway.pid"


def _lsof_pid(port: int) -> int | None:
    """Return the PID listening on `port` (TCP, IPv4), or None."""
    import subprocess
    try:
        out = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-F", "p"],
            capture_output=True, text=True, timeout=3,
        )
        for line in out.stdout.splitlines():
            if line.startswith("p"):
                try:
                    return int(line[1:])
                except ValueError:
                    return None
    except Exception:
        pass
    return None


def _too_many_restarts(runtime_id: str) -> bool:
    now = time.time()
    q = _recent_restarts[runtime_id]
    # drop entries older than 1h
    while q and (now - q[0]) > 3600:
        q.popleft()
    return len(q) >= _MAX_RESTART_PER_HOUR


def _record_restart(runtime_id: str) -> None:
    _recent_restarts[runtime_id].append(time.time())


async def _maybe_respawn(runtime) -> bool:
    """Try to respawn a dead runtime. Returns True if a restart was attempted."""
    from app.db.session import SessionLocal
    from app.core.encryption import decrypt
    # don't restart stopped/crashed/manual runtimes
    status = runtime.status.value if hasattr(runtime.status, "value") else runtime.status
    if status in ("stopped", "crashed"):
        return False
    api_key_plain = decrypt(runtime.api_key_encrypted)
    # Case 1: DB pid is alive AND health responds — happy path.
    if _is_pid_alive(runtime.pid) and _is_health_ok(runtime.gateway_base_url, api_key_plain):
        if status != "running":
            with SessionLocal() as db:
                row = db.get(type(runtime), runtime.id)
                if row:
                    row.status = "running"
                    db.commit()
        return False
    # Case 2: DB pid is wrong/dead, but something is listening on the port
    # AND health responds — someone (start.sh, sibling supervisor) is running
    # it. Reconcile DB pid by reading lsof instead of spawning a duplicate.
    import socket
    from urllib.parse import urlparse
    p = urlparse(runtime.gateway_base_url)
    try:
        with socket.create_connection((p.hostname, p.port), timeout=2):
            if _is_health_ok(runtime.gateway_base_url, api_key_plain):
                # port is open and healthy — figure out who owns it via lsof
                actual_pid = _lsof_pid(p.port)
                if actual_pid and actual_pid != runtime.pid:
                    log.info("[supervisor] reconciling runtime %s pid %s → %s (managed externally)",
                             runtime.id, runtime.pid, actual_pid)
                    with SessionLocal() as db:
                        row = db.get(type(runtime), runtime.id)
                        if row:
                            row.pid = actual_pid
                            row.status = "running"
                            db.commit()
                return False
            actual_pid = _lsof_pid(p.port)
            if actual_pid:
                from app.services.process_utils import terminate_pid
                log.warning("[supervisor] terminating stale runtime %s pid=%s on port=%s (auth check failed)",
                            runtime.id, actual_pid, p.port)
                terminate_pid(actual_pid, grace=5.0)
                _pid_file_for(runtime.hermes_home_path).unlink(missing_ok=True)
    except Exception:
        pass
    # Case 3: pid is dead AND nothing on the port. Respawn.
    # backoff: not yet time?
    last = _last_attempt.get(runtime.id, 0)
    wait = BACKOFF[min(_consecutive_failures[runtime.id], len(BACKOFF) - 1)]
    if (time.time() - last) < wait:
        return False
    # too many restarts in last hour
    if _too_many_restarts(runtime.id):
        if status != "crashed":
            log.warning("[supervisor] runtime %s hit restart limit; marking crashed", runtime.id)
            runtime.status = "crashed"
            from app.db.session import SessionLocal
            with SessionLocal() as db:
                db.merge(runtime)
                db.commit()
        return False
    # actually restart — reuse the same code path as the start endpoint,
    # but we don't go through the HTTP layer. We shell out the same way.
    _last_attempt[runtime.id] = time.time()
    log.info("[supervisor] restarting dead runtime %s on port %d", runtime.id, runtime.port)
    _record_restart(runtime.id)
    try:
        new_pid = await _spawn_gateway(runtime)
        # Post-spawn verification: wait up to 10s for the new pid to come up.
        ok = False
        for _ in range(10):
            await asyncio.sleep(1)
            if _is_pid_alive(new_pid) and _is_health_ok(
                runtime.gateway_base_url, api_key_plain,
            ):
                ok = True
                break
        if ok:
            _consecutive_failures[runtime.id] = 0
            from app.db.session import SessionLocal
            with SessionLocal() as db:
                row = db.get(type(runtime), runtime.id)
                if row:
                    row.status = "running"
                    row.health_checked_at = datetime.utcnow()
                    db.commit()
            return True
        else:
            log.error("[supervisor] respawn pid=%d for %s did not pass health check", new_pid, runtime.id)
            _consecutive_failures[runtime.id] += 1
            return False
    except Exception:
        _consecutive_failures[runtime.id] += 1
        log.exception("[supervisor] restart failed for %s (failure #%d)",
                      runtime.id, _consecutive_failures[runtime.id])
        return False


async def _spawn_gateway(runtime) -> None:
    """Shell out to start_tenant.sh just like the HTTP /start endpoint does."""
    from app.db.models import Tenant
    from app.db.session import SessionLocal
    from app.core.config import OPENATLAS_HOME, OPENATLAS_HERMES_AGENT_ROOT
    from app.core.encryption import decrypt
    from pathlib import Path as _P
    import subprocess

    with SessionLocal() as db:
        tenant = db.get(Tenant, runtime.tenant_id)
        if not tenant:
            return
        slug = tenant.slug
        api_key_plain = decrypt(runtime.api_key_encrypted)
        script = _P(OPENATLAS_HOME).parent / "Desktop" / "Atlasagent" / "openatlas" / "scripts" / "start_tenant.sh"
        log_path = OPENATLAS_HOME / "logs" / f"hermes-tenant-{slug}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_str = (
            f"HERMES_HOME={runtime.hermes_home_path} "
            f"API_SERVER_HOST=127.0.0.1 "
            f"API_SERVER_PORT={runtime.port} "
            f"API_SERVER_KEY={api_key_plain} "
            f"OPENATLAS_HOME={str(OPENATLAS_HOME)} "
            f"OPENATLAS_HERMES_AGENT_ROOT={str(OPENATLAS_HERMES_AGENT_ROOT)} "
            f"OPENATLAS_TENANT={slug} "
            f"bash {script} {runtime.hermes_home_path}"
        )
        env_args = [
            "env", "-u", "ALL_PROXY", "-u", "all_proxy",
            "-u", "HTTP_PROXY", "-u", "HTTPS_PROXY",
            "-u", "http_proxy", "-u", "https_proxy",
            "-u", "SOCKS_PROXY", "-u", "socks_proxy",
            "bash", "-c", cmd_str,
        ]
        fh = open(log_path, "ab")
        proc = subprocess.Popen(
            env_args, stdout=fh, stderr=fh, stdin=subprocess.DEVNULL,
            start_new_session=True, close_fds=True,
        )
        # update DB with new pid + status
        runtime.pid = proc.pid
        runtime.status = "starting"
        db.merge(runtime)
        db.commit()
        log.info("[supervisor] spawned pid=%d for tenant=%s port=%d",
                 proc.pid, slug, runtime.port)
        return proc.pid


async def _loop() -> None:
    log.info("[supervisor] started; poll=%ds, max_restarts_per_hour=%d",
             POLL_SECONDS, _MAX_RESTART_PER_HOUR)
    while not _shutdown:
        try:
            from app.db.models import HermesRuntime
            from app.db.session import SessionLocal
            with SessionLocal() as db:
                rows = db.query(HermesRuntime).all()
                for r in rows:
                    await _maybe_respawn(r)
        except Exception:
            log.exception("[supervisor] tick failed")
        await asyncio.sleep(POLL_SECONDS)


def start_supervisor() -> None:
    global _task
    if _task and not _task.done():
        return
    _task = asyncio.create_task(_loop())


def stop_supervisor() -> None:
    global _shutdown
    _shutdown = True
    if _task:
        _task.cancel()
