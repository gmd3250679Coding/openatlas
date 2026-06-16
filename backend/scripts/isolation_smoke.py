"""OpenAtlas tenant-isolation quality gate.

Creates/uses demo-tenant-a and demo-tenant-b, provisions tenant-local
employees, skills, memories, files, sessions, and verifies cross-tenant access
is rejected. It can start tenant Hermes gateways long enough to prove session
creation, then stops them by default.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58003/api").rstrip("/")
SYSTEM_EMAIL = os.environ.get("OPENATLAS_SYSTEM_EMAIL", "admin@demo.openatlas")
SYSTEM_PASSWORD = os.environ.get("OPENATLAS_SYSTEM_PASSWORD", "openatlas")
TENANT_PASSWORD = os.environ.get("OPENATLAS_ISOLATION_PASSWORD", "openatlas")
STOP_RUNTIMES = os.environ.get("OPENATLAS_ISOLATION_STOP_RUNTIMES", "1") != "0"

urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))


class GateError(RuntimeError):
    pass


def request(method: str, path: str, body: object | None = None, token: str | None = None, timeout: int = 25):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise GateError(f"{method} {path} -> HTTP {exc.code}: {detail[:500]}") from exc


def request_status(method: str, path: str, body: object | None = None, token: str | None = None, timeout: int = 25) -> tuple[int, str]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="ignore")


def upload_text(name: str, text: str, token: str, *, session_id: str | None = None) -> dict:
    boundary = "----OpenAtlasSmoke" + uuid.uuid4().hex
    parts = [
        f"--{boundary}\r\n",
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n',
        "Content-Type: text/plain; charset=utf-8\r\n\r\n",
        text,
        "\r\n",
        f"--{boundary}--\r\n",
    ]
    payload = "".join(parts).encode("utf-8")
    suffix = f"?session_id={urllib.parse.quote(session_id)}" if session_id else ""
    req = urllib.request.Request(
        BASE + "/files/upload" + suffix,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(payload)),
        },
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def login(email: str, password: str) -> tuple[str, dict]:
    out = request("POST", "/auth/login", {"email": email, "password": password})
    return out["access_token"], out


def ensure_tenant(system_token: str, slug: str) -> dict:
    email = f"admin@{slug}.openatlas"
    try:
        created = request("POST", "/admin/tenants", {
            "slug": slug,
            "name": slug,
            "admin_email": email,
            "admin_password": TENANT_PASSWORD,
            "plan": "isolation-smoke",
        }, token=system_token)
        return {"tenant": {"id": created["id"], "slug": slug}, "email": email, "created": True, "runtime": created.get("runtime")}
    except GateError as exc:
        if "HTTP 409" not in str(exc):
            raise
    tenants = request("GET", "/admin/tenants", token=system_token)["items"]
    hit = next((t for t in tenants if t["slug"] == slug), None)
    if not hit:
        raise GateError(f"tenant {slug} exists check failed")
    return {"tenant": hit, "email": email, "created": False}


def wait_runtime(system_token: str, tenant_id: str) -> dict:
    start = request("POST", f"/admin/tenants/{tenant_id}/hermes-runtime/start", token=system_token)
    last = {}
    for _ in range(20):
        last = request("POST", f"/admin/tenants/{tenant_id}/hermes-runtime/healthcheck", token=system_token)
        if last.get("running"):
            return {"start": start, "health": last}
        time.sleep(1)
    raise GateError(f"runtime for tenant {tenant_id} did not become healthy: {last}")


def stop_runtime(system_token: str, tenant_id: str) -> dict:
    return request("POST", f"/admin/tenants/{tenant_id}/hermes-runtime/stop", token=system_token)


def provision(slug: str, tenant_id: str, token: str) -> dict:
    suffix = uuid.uuid4().hex[:6]
    emp = request("POST", "/employees", {
        "display_name": f"{slug} Employee {suffix}",
        "avatar": slug[-1:].upper(),
        "description": f"Isolation employee for {slug}",
        "system_prompt": f"You belong only to tenant {slug}.",
        "toolsets": ["hermes-cli"],
    }, token=token)
    skill = request("POST", "/skill-market", {
        "name": f"{slug} Skill {suffix}",
        "slug": f"{slug}-skill-{suffix}",
        "description": f"Tenant-local smoke skill for {slug}",
        "category": "isolation",
        "version": "1.0.0",
        "scope": "user",
        "visibility": "private",
        "mutable": True,
    }, token=token)
    binding = request("POST", f"/skill-market/{skill['id']}/bind", {
        "skill_id": skill["id"],
        "target_type": "employee",
        "target_id": emp["id"],
        "binding_mode": "copied",
    }, token=token)
    memory = request("POST", "/memories", {
        "scope": "user",
        "title": f"{slug} Memory {suffix}",
        "content": f"This memory must only be visible in {slug}.",
        "tags": ["isolation", slug],
        "priority": 70,
    }, token=token)
    session = request("POST", "/sessions", {
        "employee_id": emp["id"],
        "title": f"{slug} Isolation Session {suffix}",
    }, token=token, timeout=45)
    file_meta = upload_text(
        f"{slug}-isolation.txt",
        f"File content belongs only to {slug}. marker={suffix}",
        token,
        session_id=session["id"],
    )
    return {
        "tenant_id": tenant_id,
        "slug": slug,
        "employee": emp,
        "skill": skill,
        "binding": binding,
        "memory": memory,
        "session": session,
        "file": file_meta,
    }


def assert_denied(label: str, status: int, allowed: set[int] = frozenset({403, 404})) -> dict:
    if status not in allowed:
        raise GateError(f"{label}: expected {sorted(allowed)}, got {status}")
    return {"label": label, "status": status, "ok": True}


def run() -> dict:
    checks: list[dict] = []
    system_token, system_login = login(SYSTEM_EMAIL, SYSTEM_PASSWORD)
    checks.append({"label": "system login", "ok": True, "tenant": system_login["tenant"]})

    tenants = [ensure_tenant(system_token, "demo-tenant-a"), ensure_tenant(system_token, "demo-tenant-b")]
    checks.append({"label": "ensure tenants", "ok": True, "items": tenants})

    runtime_results = []
    for item in tenants:
        runtime_results.append(wait_runtime(system_token, item["tenant"]["id"]))
    checks.append({"label": "tenant runtimes healthy", "ok": True, "items": runtime_results})

    runtime_meta = [
        request("GET", f"/admin/tenants/{item['tenant']['id']}/hermes-runtime", token=system_token)
        for item in tenants
    ]
    homes = [r["runtime"]["hermes_home"] for r in runtime_meta if r.get("runtime")]
    if len(set(homes)) != 2 or not all(slug in home for slug, home in zip(["demo-tenant-a", "demo-tenant-b"], homes)):
        raise GateError(f"Hermes homes are not isolated: {homes}")
    checks.append({"label": "hermes homes isolated", "ok": True, "homes": homes})

    tokens = []
    for item in tenants:
        token, login_out = login(item["email"], TENANT_PASSWORD)
        tokens.append(token)
        checks.append({"label": f"{item['tenant']['slug']} login", "ok": True, "tenant": login_out["tenant"]})

    a = provision("demo-tenant-a", tenants[0]["tenant"]["id"], tokens[0])
    b = provision("demo-tenant-b", tenants[1]["tenant"]["id"], tokens[1])
    checks.append({"label": "provision tenant resources", "ok": True, "a": summarize(a), "b": summarize(b)})

    denied = []
    for label, token, other in [
        ("b cannot read a employee", tokens[1], a),
        ("a cannot read b employee", tokens[0], b),
    ]:
        status, _ = request_status("GET", f"/employees/{other['employee']['id']}", token=token)
        denied.append(assert_denied(label, status))
    for label, token, other in [
        ("b cannot read a session", tokens[1], a),
        ("a cannot read b session", tokens[0], b),
    ]:
        status, _ = request_status("GET", f"/sessions/{other['session']['id']}", token=token)
        denied.append(assert_denied(label, status))
    for label, token, other in [
        ("b cannot read a file", tokens[1], a),
        ("a cannot read b file", tokens[0], b),
    ]:
        status, _ = request_status("GET", f"/files/{other['file']['id']}", token=token)
        denied.append(assert_denied(label, status))
    for label, token, other in [
        ("b cannot read a skill", tokens[1], a),
        ("a cannot read b skill", tokens[0], b),
        ("b cannot read a memory", tokens[1], a),
        ("a cannot read b memory", tokens[0], b),
    ]:
        path = f"/skill-market/{other['skill']['id']}" if "skill" in label else f"/memories/{other['memory']['id']}"
        status, _ = request_status("GET", path, token=token)
        denied.append(assert_denied(label, status))
    checks.append({"label": "cross-tenant API denied", "ok": True, "items": denied})

    if STOP_RUNTIMES:
        stopped = [stop_runtime(system_token, item["tenant"]["id"]) for item in tenants]
        checks.append({"label": "tenant runtimes stopped", "ok": True, "items": stopped})

    return {"ok": True, "base": BASE, "stop_runtimes": STOP_RUNTIMES, "checks": checks}


def summarize(item: dict) -> dict:
    return {
        "slug": item["slug"],
        "employee_id": item["employee"]["id"],
        "skill_id": item["skill"]["id"],
        "memory_id": item["memory"]["id"],
        "session_id": item["session"]["id"],
        "file_id": item["file"]["id"],
    }


if __name__ == "__main__":
    try:
        result = run()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "base": BASE, "error": str(exc)}, ensure_ascii=False, indent=2))
        sys.exit(1)
