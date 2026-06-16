"""Hermes gateway client (httpx-based) — Phase 2 tenant-aware factory.

All chat/session/capability traffic to Hermes goes through here. Every public
function takes a RuntimeTarget (base_url + api_key) so the OpenAtlas backend
can route per tenant.

Phase 1 hardcoded TENANT_HERMES_BASE_URL is preserved as a fallback when no
explicit runtime is registered (single-tenant dev mode).
"""
from __future__ import annotations

import os
from typing import Any, AsyncIterator
import json

import httpx

from app.core.config import TENANT_HERMES_BASE_URL, TENANT_HERMES_API_KEY
from app.core.encryption import decrypt


def _strip_proxy_env() -> None:
    """Remove ALL_PROXY / socks_proxy / etc. so httpx never routes loopback
    tenant gateways through the user's SOCKS5 (SOCKS5 cannot resolve 127.0.0.1
    on the host's bound ports and returns 502)."""
    for k in (
        "ALL_PROXY", "all_proxy",
        "HTTP_PROXY", "http_proxy",
        "HTTPS_PROXY", "https_proxy",
        "SOCKS_PROXY", "socks_proxy",
        "NO_PROXY", "no_proxy",
    ):
        os.environ.pop(k, None)


def _client(**kw) -> httpx.AsyncClient:
    """AsyncClient with trust_env=False — never honors system proxy env."""
    _strip_proxy_env()
    kw.setdefault("trust_env", False)
    return httpx.AsyncClient(**kw)


class RuntimeTarget:
    """Where to send a given request — base URL + API key.

    The backend resolves one of these per request by looking up
    HermesRuntime(tenant_id) in the database. If none exists we fall back
    to the env-var default (single-tenant demo).
    """

    __slots__ = ("base_url", "api_key", "tenant_id", "runtime_id")

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        tenant_id: str | None = None,
        runtime_id: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.tenant_id = tenant_id
        self.runtime_id = runtime_id

    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def __repr__(self) -> str:
        b = self.base_url
        return f"RuntimeTarget({b}, tenant={self.tenant_id!r})"


def default_target() -> RuntimeTarget:
    """Return the env-var fallback target (single-tenant demo)."""
    return RuntimeTarget(
        base_url=TENANT_HERMES_BASE_URL, api_key=TENANT_HERMES_API_KEY
    )


async def resolve_target(db, tenant_id: str) -> RuntimeTarget:
    """Look up the HermesRuntime row for tenant_id, or fall back to default.

    If a row exists with status='running', use it. Otherwise fall back to
    TENANT_HERMES_BASE_URL so the API still works in dev (no runtime started).
    """
    from app.db.models import HermesRuntime, RuntimeStatus  # local import to avoid cycle

    row = (
        db.query(HermesRuntime)
        .filter(HermesRuntime.tenant_id == tenant_id)
        .order_by(HermesRuntime.created_at.desc())
        .first()
    )
    if row and row.status in (RuntimeStatus.running.value, "running") and row.gateway_base_url:
        return RuntimeTarget(
            base_url=row.gateway_base_url,
            api_key=decrypt(row.api_key_encrypted),  # Phase 3.1: stored encrypted
            tenant_id=tenant_id,
            runtime_id=row.id,
        )
    return default_target()


# ── Capability / read endpoints ──────────────────────────────────────────────

async def get_health(t: RuntimeTarget) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(f"{t.base_url}/health", headers=t.headers())
        r.raise_for_status()
        return r.json()


async def get_capabilities(t: RuntimeTarget) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(f"{t.base_url}/v1/capabilities", headers=t.headers())
        r.raise_for_status()
        return r.json()


async def get_models(t: RuntimeTarget) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(f"{t.base_url}/v1/models", headers=t.headers())
        r.raise_for_status()
        return r.json()


async def list_skills(t: RuntimeTarget) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(f"{t.base_url}/v1/skills", headers=t.headers())
        r.raise_for_status()
        return r.json()


async def list_toolsets(t: RuntimeTarget) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(f"{t.base_url}/v1/toolsets", headers=t.headers())
        r.raise_for_status()
        return r.json()


# ── Session endpoints ────────────────────────────────────────────────────────

async def list_sessions(t: RuntimeTarget, *, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(
            f"{t.base_url}/api/sessions",
            params={"limit": limit, "offset": offset},
            headers=t.headers(),
        )
        r.raise_for_status()
        return r.json()


async def create_session(t: RuntimeTarget, *, title: str = "") -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.post(
            f"{t.base_url}/api/sessions",
            json={"title": title},
            headers=t.headers(),
        )
        r.raise_for_status()
        return r.json()


async def get_session(t: RuntimeTarget, session_id: str) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(f"{t.base_url}/api/sessions/{session_id}", headers=t.headers())
        r.raise_for_status()
        return r.json()


async def get_session_messages(t: RuntimeTarget, session_id: str) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(
            f"{t.base_url}/api/sessions/{session_id}/messages", headers=t.headers()
        )
        r.raise_for_status()
        return r.json()


async def fork_session(
    t: RuntimeTarget,
    session_id: str,
    *,
    title: str = "",
    fork_id: str | None = None,
) -> dict[str, Any]:
    """Create a Hermes-side branch that carries the source transcript forward."""
    payload: dict[str, Any] = {}
    if title:
        payload["title"] = title
    if fork_id:
        payload["id"] = fork_id
    async with _client(timeout=20) as c:
        r = await c.post(
            f"{t.base_url}/api/sessions/{session_id}/fork",
            json=payload,
            headers=t.headers(),
        )
        r.raise_for_status()
        return r.json()


async def list_jobs(t: RuntimeTarget) -> dict[str, Any]:
    async with _client(timeout=10) as c:
        r = await c.get(f"{t.base_url}/api/jobs", headers=t.headers())
        r.raise_for_status()
        return r.json()


# ── SSE chat stream (Phase 2 keeps the same parser as Phase 1) ──────────────

async def stream_chat(
    t: RuntimeTarget,
    session_id: str,
    *,
    message: str,
    model: str = "hermes-agent",
    system_message: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield SSE events from Hermes /api/sessions/{id}/chat/stream as parsed dicts.

    Each event is: {"event": <name or None>, "data": <dict|str>}.
    """
    url = f"{t.base_url}/api/sessions/{session_id}/chat/stream"
    payload = {"message": message, "model": model}
    if system_message:
        payload["system_message"] = system_message
    async with _client(timeout=None) as c:
        async with c.stream(
            "POST", url, json=payload, headers=t.headers()
        ) as resp:
            resp.raise_for_status()
            event_name: str | None = None
            data_buf: list[str] = []
            async for line in resp.aiter_lines():
                if line == "":
                    if data_buf or event_name:
                        raw = "\n".join(data_buf)
                        try:
                            data_obj: Any = json.loads(raw) if raw else {}
                        except json.JSONDecodeError:
                            data_obj = {"raw": raw}
                        yield {"event": event_name, "data": data_obj}
                    event_name = None
                    data_buf = []
                    continue
                if line.startswith("event:"):
                    event_name = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data_buf.append(line[len("data:"):].strip())
                else:
                    continue


# ── Run events API (preferred when Hermes exposes approval/reasoning) ────────

async def supports_run_events(t: RuntimeTarget) -> bool:
    """Return True when the tenant Hermes runtime exposes /v1/runs events."""
    try:
        caps = await get_capabilities(t)
    except Exception:
        return False
    features = caps.get("features") if isinstance(caps, dict) else {}
    return bool(
        isinstance(features, dict)
        and features.get("run_submission")
        and features.get("run_events_sse")
        and features.get("run_approval_response")
    )


async def create_run(
    t: RuntimeTarget,
    *,
    message: str,
    session_id: str,
    system_message: str | None = None,
    model: str = "hermes-agent",
    reasoning_effort: str | None = None,
) -> dict[str, Any]:
    """Start a Hermes run and return its run_id/status payload.

    The session_id is sent both as the run session_id and X-Hermes-Session-Key,
    so Hermes approval queues, memory scope, and continuity stay tied to the
    tenant-local session instead of a transient request id.
    """
    headers = {**t.headers(), "X-Hermes-Session-Key": session_id}
    payload: dict[str, Any] = {
        "input": message,
        "model": model,
        "session_id": session_id,
    }
    if system_message:
        payload["instructions"] = system_message
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    async with _client(timeout=20) as c:
        r = await c.post(f"{t.base_url}/v1/runs", json=payload, headers=headers)
        r.raise_for_status()
        return r.json()


async def stream_run_events(
    t: RuntimeTarget,
    run_id: str,
) -> AsyncIterator[dict[str, Any]]:
    """Yield structured events from Hermes /v1/runs/{run_id}/events.

    Hermes emits data-only SSE blocks whose JSON body contains an "event" key.
    This normalizes them into the same {"event", "data"} shape as stream_chat.
    """
    async with _client(timeout=None) as c:
        async with c.stream(
            "GET",
            f"{t.base_url}/v1/runs/{run_id}/events",
            headers=t.headers(),
        ) as resp:
            resp.raise_for_status()
            data_buf: list[str] = []
            event_name: str | None = None
            async for line in resp.aiter_lines():
                if line == "":
                    if data_buf:
                        raw = "\n".join(data_buf)
                        try:
                            data_obj: Any = json.loads(raw)
                        except json.JSONDecodeError:
                            data_obj = {"raw": raw}
                        ev_name = data_obj.get("event") if isinstance(data_obj, dict) else None
                        yield {"event": event_name or ev_name or "message", "data": data_obj}
                    data_buf = []
                    event_name = None
                    continue
                if line.startswith("data:"):
                    data_buf.append(line[len("data:"):].strip())
                elif line.startswith("event:"):
                    event_name = line[len("event:"):].strip()
                else:
                    continue


async def respond_run_approval(
    t: RuntimeTarget,
    run_id: str,
    *,
    choice: str,
    resolve_all: bool = False,
    approval_id: str | None = None,
) -> dict[str, Any]:
    """Resolve a pending Hermes run approval."""
    payload = {"choice": choice, "resolve_all": resolve_all}
    if approval_id:
        payload["approval_id"] = approval_id
    async with _client(timeout=20) as c:
        r = await c.post(
            f"{t.base_url}/v1/runs/{run_id}/approval",
            json=payload,
            headers=t.headers(),
        )
        r.raise_for_status()
        return r.json()


async def stop_run(t: RuntimeTarget, run_id: str) -> dict[str, Any]:
    """Ask Hermes to interrupt an active run instead of only closing the UI stream."""
    async with _client(timeout=20) as c:
        r = await c.post(
            f"{t.base_url}/v1/runs/{run_id}/stop",
            json={},
            headers=t.headers(),
        )
        r.raise_for_status()
        return r.json()
