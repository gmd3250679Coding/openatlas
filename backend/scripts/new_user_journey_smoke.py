"""New-user journey regression for OpenAtlas.

Checks a freshly registered ordinary user can:
- register/login with default user permissions
- see built-in employees without admin-only mutation
- create a personal employee but cannot dismiss employees
- open sessions and receive SSE events
- run a small group relay and observe speaker events

Environment:
  OPENATLAS_API_BASE=http://127.0.0.1:58003/api
  OPENATLAS_NEW_USER_MAX_EMPLOYEES=11
  OPENATLAS_NEW_USER_STRICT_MODEL=0
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


API_BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58003/api").rstrip("/")
MAX_EMPLOYEES = int(os.environ.get("OPENATLAS_NEW_USER_MAX_EMPLOYEES", "11"))
STRICT_MODEL = os.environ.get("OPENATLAS_NEW_USER_STRICT_MODEL", "0") == "1"
STREAM_TIMEOUT = float(os.environ.get("OPENATLAS_NEW_USER_STREAM_TIMEOUT", "90"))


class SmokeError(RuntimeError):
    pass


@dataclass
class Step:
    name: str
    ok: bool
    detail: str = ""


def request(method: str, path: str, body: Any | None = None, token: str | None = None) -> Any:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = Request(f"{API_BASE}{path}", data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SmokeError(f"{method} {path} -> HTTP {exc.code}: {detail[:500]}") from exc


def expect_http(method: str, path: str, status: int, token: str | None = None, body: Any | None = None) -> str:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = Request(
        f"{API_BASE}{path}",
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        method=method,
        headers=headers,
    )
    try:
        with urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", "replace")
            if resp.status != status:
                raise SmokeError(f"{method} {path} expected {status}, got {resp.status}: {raw[:300]}")
            return raw
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        if exc.code != status:
            raise SmokeError(f"{method} {path} expected {status}, got {exc.code}: {raw[:300]}") from exc
        return raw


def stream_chat(token: str, session_id: str, message: str, **extra: Any) -> dict[str, Any]:
    payload = {"message": message, **{k: v for k, v in extra.items() if v}}
    req = Request(
        f"{API_BASE}/sessions/{session_id}/chat/stream",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Accept": "text/event-stream",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    events: list[str] = []
    speakers: list[str] = []
    text_parts: list[str] = []
    started = time.time()
    with urlopen(req, timeout=STREAM_TIMEOUT) as resp:
        block: list[str] = []
        for raw in resp:
            if time.time() - started > STREAM_TIMEOUT:
                raise SmokeError("stream exceeded timeout")
            line = raw.decode("utf-8", "replace").rstrip("\n")
            if line:
                block.append(line)
                continue
            ev_name = "message"
            data_lines: list[str] = []
            for item in block:
                if item.startswith("event:"):
                    ev_name = item[6:].strip()
                elif item.startswith("data:"):
                    data_lines.append(item[5:].strip())
            block = []
            if not data_lines:
                continue
            data_raw = "\n".join(data_lines)
            try:
                data = json.loads(data_raw)
            except Exception:
                data = {"content": data_raw}
            events.append(ev_name or str(data.get("event_type") or "message"))
            speaker = data.get("speaker_employee_id") or data.get("agent_id") or data.get("speaker_name")
            if speaker and str(speaker) not in speakers:
                speakers.append(str(speaker))
            for key in ("content", "delta", "text"):
                value = data.get(key)
                if isinstance(value, str) and value:
                    text_parts.append(value)
            if data.get("done") or ev_name in ("done", "completed"):
                break
    return {"events": events, "speakers": speakers, "text": "".join(text_parts)}


def session_assistant_text(token: str, session_id: str, attempts: int = 8, delay: float = 2.0) -> str:
    """Return assistant text persisted for a session.

    Some long-running streams emit task/context events first and persist the final
    assistant message after the HTTP stream closes. The smoke test should verify
    the user-visible result, not only the first SSE payload shape.
    """
    for idx in range(attempts):
        data = request("GET", f"/sessions/{session_id}/messages", token=token)
        items = data.get("items") if isinstance(data, dict) else data
        parts = [
            str(item.get("content") or "")
            for item in (items or [])
            if item.get("role") == "assistant" and str(item.get("content") or "").strip()
        ]
        if parts:
            return "\n".join(parts)
        if idx < attempts - 1:
            time.sleep(delay)
    return ""


def record(report: list[Step], name: str, fn):
    try:
        detail = fn()
        report.append(Step(name, True, str(detail or "")))
    except Exception as exc:  # noqa: BLE001 - smoke reports failures as data.
        report.append(Step(name, False, str(exc)))


def main() -> int:
    suffix = uuid.uuid4().hex[:8]
    email = f"journey-{suffix}@demo.openatlas"
    password = "openatlas"
    report: list[Step] = []
    state: dict[str, Any] = {"email": email}

    def register_user():
        out = request("POST", "/auth/register", {"email": email, "password": password})
        state["token"] = out["access_token"]
        user = out.get("user") or {}
        if user.get("is_admin"):
            raise SmokeError(f"new user unexpectedly admin: {user}")
        return user.get("email") or email

    record(report, "register ordinary user", register_user)
    token = state.get("token")
    if not token:
        print_report(report)
        return 1

    def permission_shape():
        me = request("GET", "/auth/me", token=token)
        user = me.get("user") or me
        if user.get("is_admin"):
            raise SmokeError("ordinary user has admin flag")
        return f"role={user.get('role')}"

    record(report, "ordinary permission shape", permission_shape)

    def employee_visibility():
        employees = request("GET", "/employees", token=token).get("items") or []
        if len(employees) < min(5, MAX_EMPLOYEES):
            raise SmokeError(f"too few visible employees: {len(employees)}")
        state["employees"] = employees
        return f"{len(employees)} visible"

    record(report, "built-in employee visibility", employee_visibility)

    employees = state.get("employees") or []
    if employees:
        first_id = employees[0]["id"]
        record(
            report,
            "ordinary user cannot dismiss built-in employee",
            lambda: expect_http("DELETE", f"/employees/{first_id}", 403, token=token)[:120],
        )

    def create_personal_employee():
        emp = request(
            "POST",
            "/employees",
            {
                "display_name": f"Journey Employee {suffix}",
                "description": "Created by new_user_journey_smoke.py",
                "avatar": "J",
                "system_prompt": "You are a concise regression-test employee.",
                "toolsets": ["file"],
            },
            token=token,
        )
        state["personal_employee"] = emp
        return emp.get("display_name")

    record(report, "ordinary user can recruit personal employee", create_personal_employee)
    personal = state.get("personal_employee")
    if personal:
        record(
            report,
            "ordinary user still cannot dismiss personal employee",
            lambda: expect_http("DELETE", f"/employees/{personal['id']}", 403, token=token)[:120],
        )

    def smoke_each_employee():
        visible = state.get("employees") or []
        targets = visible[:MAX_EMPLOYEES]
        if not targets:
            raise SmokeError("no employees to test")
        results = []
        for emp in targets:
            sid = request("POST", "/sessions", {"employee_id": emp["id"], "title": f"Journey {emp['display_name']}"}, token=token)["id"]
            out = stream_chat(token, sid, f"请用一句话说明你是 {emp['display_name']}；如果不需要工具，可以直接回答。")
            text = out["text"].strip() or session_assistant_text(token, sid).strip()
            if STRICT_MODEL and not out["text"].strip():
                if not text:
                    raise SmokeError(f"{emp['display_name']} returned no model text; events={out['events'][:8]}")
            results.append(f"{emp['display_name']}:{len(out['events'])}ev")
        return ", ".join(results)

    record(report, "try visible employee chats", smoke_each_employee)

    def group_relay():
        visible = state.get("employees") or []
        if len(visible) < 2:
            return "skipped: fewer than 2 employees"
        primary, relay = visible[0], visible[1]
        sid = request(
            "POST",
            "/sessions",
            {"employee_id": primary["id"], "participant_ids": [relay["id"]], "title": f"Journey Group {suffix}"},
            token=token,
        )["id"]
        out = stream_chat(token, sid, "请两位员工各用一句话接力说明自己的职责。", relay_employee_ids=[relay["id"]])
        if len(out["speakers"]) < 2 and not any("agent_join" in ev for ev in out["events"]):
            raise SmokeError(f"group relay missing speaker evidence: {out}")
        return f"events={len(out['events'])}, speakers={len(out['speakers'])}"

    record(report, "group relay speaker evidence", group_relay)
    print_report(report)
    return 0 if all(step.ok for step in report) else 1


def print_report(report: list[Step]) -> None:
    print(json.dumps({
        "api_base": API_BASE,
        "max_employees": MAX_EMPLOYEES,
        "strict_model": STRICT_MODEL,
        "steps": [step.__dict__ for step in report],
        "ok": all(step.ok for step in report),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.exit(main())
