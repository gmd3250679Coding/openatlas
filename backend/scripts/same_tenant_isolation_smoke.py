"""Same-tenant user isolation smoke test for OpenAtlas.

Creates two ordinary users in the default demo tenant. User A creates private
resources, then User B attempts to read or mutate them. This catches IDOR bugs
that cross-tenant tests cannot see.

Environment:
  OPENATLAS_API_BASE=http://127.0.0.1:58003/api
  OPENATLAS_ISOLATION_PASSWORD=openatlas
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any


API_BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58003/api").rstrip("/")
PASSWORD = os.environ.get("OPENATLAS_ISOLATION_PASSWORD", "openatlas")


class SmokeError(RuntimeError):
    pass


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


def request(method: str, path: str, body: Any | None = None, token: str | None = None, timeout: int = 30) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{API_BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        raise SmokeError(f"{method} {path} -> HTTP {exc.code}: {raw[:400]}") from exc


def status(method: str, path: str, body: Any | None = None, token: str | None = None, timeout: int = 30) -> tuple[int, str]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{API_BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def upload_text(name: str, text: str, token: str, *, session_id: str | None = None) -> dict[str, Any]:
    boundary = "----OpenAtlasSameTenant" + uuid.uuid4().hex
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'
        "Content-Type: text/plain; charset=utf-8\r\n\r\n"
        f"{text}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    suffix = f"?session_id={urllib.parse.quote(session_id)}" if session_id else ""
    req = urllib.request.Request(
        f"{API_BASE}/files/upload{suffix}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def expect_status(name: str, method: str, path: str, expected: set[int], token: str | None = None, body: Any | None = None) -> Check:
    code, raw = status(method, path, body=body, token=token)
    if code not in expected:
        raise SmokeError(f"{name}: expected {sorted(expected)}, got {code}: {raw[:260]}")
    return Check(name, True, f"HTTP {code}")


def record(checks: list[Check], name: str, fn) -> None:
    try:
        result = fn()
        if isinstance(result, Check):
            checks.append(result)
        else:
            checks.append(Check(name, True, str(result or "")))
    except Exception as exc:  # noqa: BLE001 - this is a smoke report.
        checks.append(Check(name, False, str(exc)))


def register_user(label: str) -> tuple[str, dict[str, Any]]:
    email = f"same-tenant-{label}-{uuid.uuid4().hex[:8]}@demo.openatlas"
    out = request("POST", "/auth/register", {"email": email, "password": PASSWORD})
    token = out["access_token"]
    return token, {"email": email, "user": out.get("user") or {}}


def main() -> int:
    checks: list[Check] = []
    state: dict[str, Any] = {}

    record(checks, "unauthenticated endpoints are guarded", lambda: [
        expect_status("unauth employees", "GET", "/employees", {401}),
        expect_status("unauth sessions", "GET", "/sessions", {401}),
        expect_status("unauth files", "GET", "/files", {401}),
        expect_status("fake token me", "GET", "/auth/me", {401}, token="not-a-real-token"),
    ])

    def provision_users():
        token_a, meta_a = register_user("a")
        token_b, meta_b = register_user("b")
        state.update({"token_a": token_a, "token_b": token_b, "meta_a": meta_a, "meta_b": meta_b})
        if meta_a["user"].get("is_admin") or meta_b["user"].get("is_admin"):
            raise SmokeError("registered ordinary users should not be admin")
        return f"{meta_a['email']} / {meta_b['email']}"

    record(checks, "register two ordinary users in same tenant", provision_users)
    token_a = state.get("token_a")
    token_b = state.get("token_b")
    if not token_a or not token_b:
        print_report(checks)
        return 1

    marker = uuid.uuid4().hex[:8]

    def create_private_employee():
        emp = request(
            "POST",
            "/employees",
            {
                "display_name": f"Private A {marker}",
                "description": "Same-tenant isolation employee owned by user A.",
                "avatar": "A",
                "system_prompt": "You are private to user A.",
                "toolsets": ["file"],
            },
            token=token_a,
        )
        state["employee_a"] = emp
        return emp["id"]

    record(checks, "user A creates private employee", create_private_employee)
    employee_a = state.get("employee_a")

    if employee_a:
        record(checks, "user B cannot read A employee", lambda: expect_status("read A employee", "GET", f"/employees/{employee_a['id']}", {403, 404}, token=token_b))
        record(checks, "user B cannot patch A employee", lambda: expect_status("patch A employee", "PATCH", f"/employees/{employee_a['id']}", {403, 404}, token=token_b, body={"display_name": "hijack"}))
        record(checks, "user B cannot create session with A employee", lambda: expect_status("session with A employee", "POST", "/sessions", {403, 404}, token=token_b, body={"employee_id": employee_a["id"], "title": "bad"}))

    def create_session_file_memory():
        sid = request("POST", "/sessions", {"employee_id": employee_a["id"], "title": f"A private session {marker}"}, token=token_a)["id"]
        file_meta = upload_text(f"a-private-{marker}.txt", f"secret marker {marker}", token_a, session_id=sid)
        memory = request(
            "POST",
            "/memories",
            {
                "scope": "user",
                "title": f"A private memory {marker}",
                "content": f"Only user A should see marker {marker}.",
                "priority": 60,
                "tags": ["same-tenant-isolation"],
            },
            token=token_a,
        )
        state.update({"session_a": {"id": sid}, "file_a": file_meta, "memory_a": memory})
        return f"session={sid} file={file_meta.get('id')} memory={memory.get('id')}"

    if employee_a:
        record(checks, "user A creates private session, file, memory", create_session_file_memory)

    session_a = state.get("session_a")
    file_a = state.get("file_a")
    memory_a = state.get("memory_a")

    if session_a:
        for label, method, path, body in [
            ("B cannot read A session", "GET", f"/sessions/{session_a['id']}", None),
            ("B cannot read A messages", "GET", f"/sessions/{session_a['id']}/messages", None),
            ("B cannot read A context", "GET", f"/sessions/{session_a['id']}/context", None),
            ("B cannot read A replay", "GET", f"/sessions/{session_a['id']}/replay", None),
            ("B cannot read A canvas", "GET", f"/sessions/{session_a['id']}/canvas-state", None),
            ("B cannot patch A session", "PATCH", f"/sessions/{session_a['id']}", {"title": "hijack"}),
            ("B cannot fork A session", "POST", f"/sessions/{session_a['id']}/fork", {"title": "bad fork"}),
            ("B cannot resume A session", "POST", f"/sessions/{session_a['id']}/resume", {"message": "continue"}),
            ("B cannot recover A session", "POST", f"/sessions/{session_a['id']}/recover", None),
            ("B cannot delete A session", "DELETE", f"/sessions/{session_a['id']}", None),
        ]:
            record(checks, label, lambda m=method, p=path, b=body, n=label: expect_status(n, m, p, {403, 404}, token=token_b, body=b))

        def session_list_hidden():
            items = request("GET", "/sessions", token=token_b).get("items") or []
            if any(item.get("id") == session_a["id"] or marker in str(item.get("title", "")) for item in items):
                raise SmokeError("B session list leaks A session")
            return f"B sees {len(items)} sessions, not A"

        record(checks, "B session list excludes A session", session_list_hidden)

    if file_a:
        for label, method, path in [
            ("B cannot read A file metadata", "GET", f"/files/{file_a['id']}"),
            ("B cannot preview A file", "GET", f"/files/{file_a['id']}/preview"),
            ("B cannot download A file", "GET", f"/files/{file_a['id']}/download"),
            ("B cannot delete A file", "DELETE", f"/files/{file_a['id']}"),
        ]:
            record(checks, label, lambda m=method, p=path, n=label: expect_status(n, m, p, {403, 404}, token=token_b))

    if memory_a:
        record(checks, "B cannot read A memory", lambda: expect_status("read A memory", "GET", f"/memories/{memory_a['id']}", {403, 404}, token=token_b))
        record(checks, "B cannot patch A memory", lambda: expect_status("patch A memory", "PATCH", f"/memories/{memory_a['id']}", {403, 404}, token=token_b, body={"title": "hijack"}))

        def memory_list_hidden():
            items = request("GET", "/memories", token=token_b).get("items") or []
            if any(item.get("id") == memory_a["id"] or marker in str(item.get("content", "")) for item in items):
                raise SmokeError("B memory list leaks A memory")
            return f"B sees {len(items)} memories, not A"

        record(checks, "B memory list excludes A memory", memory_list_hidden)

        def effective_memory_injection_is_scoped():
            a_items = request("GET", f"/memories/effective?employee_id={employee_a['id']}", token=token_a).get("items") or []
            a_text = json.dumps(a_items, ensure_ascii=False)
            if marker not in a_text:
                raise SmokeError("A effective memories do not include A private memory")
            if "用户画像" not in a_text and "user_profile" not in a_text:
                raise SmokeError("A effective memories missing runtime user profile")
            b_items = request("GET", "/memories/effective", token=token_b).get("items") or []
            b_text = json.dumps(b_items, ensure_ascii=False)
            if marker in b_text:
                raise SmokeError("B effective memories leak A private marker")
            return f"A effective={len(a_items)} / B effective={len(b_items)}"

        record(checks, "effective memory injection is scoped per user", effective_memory_injection_is_scoped)

    print_report(checks)
    return 0 if all(check.ok for check in checks) else 1


def print_report(checks: list[Check]) -> None:
    print(json.dumps(
        {
            "api_base": API_BASE,
            "ok": all(check.ok for check in checks),
            "checks": [check.__dict__ for check in checks],
        },
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    sys.exit(main())
