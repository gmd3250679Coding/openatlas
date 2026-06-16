"""OpenAtlas API quality gate.

Checks: health, auth, capabilities, models, employees, sessions, chat stream,
skill market, collaboration template create/use, Hermes command coverage, and
tenant-safe runtime diagnostics.
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
import zipfile
from io import BytesIO


BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58003/api").rstrip("/")
EMAIL = os.environ.get("OPENATLAS_EMAIL", "admin@demo.openatlas")
PASSWORD = os.environ.get("OPENATLAS_PASSWORD", "openatlas")
STRICT_MODEL = os.environ.get("OPENATLAS_SMOKE_STRICT_MODEL", "0") == "1"

urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))


class SmokeError(RuntimeError):
    pass


def request(method: str, path: str, body: object | None = None, token: str | None = None, timeout: int = 20):
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
        raise SmokeError(f"{method} {path} -> HTTP {exc.code}: {detail[:500]}") from exc


def expect(label: str, fn):
    started = time.time()
    try:
        data = fn()
        return {"label": label, "ok": True, "ms": int((time.time() - started) * 1000), "data": data}
    except Exception as exc:  # noqa: BLE001
        return {"label": label, "ok": False, "ms": int((time.time() - started) * 1000), "error": str(exc)}


def expect_http_error(method: str, path: str, status: int, token: str | None = None, body: object | None = None) -> dict:
    started = time.time()
    try:
        request(method, path, body, token=token)
    except SmokeError as exc:
        text = str(exc)
        if f"HTTP {status}" in text:
            return {"label": f"{method} {path} expects {status}", "ok": True, "ms": int((time.time() - started) * 1000), "error": text[:240]}
        return {"label": f"{method} {path} expects {status}", "ok": False, "ms": int((time.time() - started) * 1000), "error": text}
    return {"label": f"{method} {path} expects {status}", "ok": False, "ms": int((time.time() - started) * 1000), "error": "request unexpectedly succeeded"}


def parse_sse(resp):
    buf = ""
    for raw in resp:
        buf += raw.decode("utf-8", errors="ignore")
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            name = "message"
            data = ""
            for line in block.splitlines():
                if line.startswith("event:"):
                    name = line.split(":", 1)[1].strip()
                elif line.startswith("data:"):
                    data += line.split(":", 1)[1].strip()
            payload = None
            if data:
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    payload = data
            yield {"event": name, "data": payload}


def chat_stream(token: str, sid: str, message: str, *, attachment_ids: list[str] | None = None):
    body = {"message": message, "attachment_ids": attachment_ids or []}
    req = urllib.request.Request(
        BASE + f"/sessions/{sid}/chat/stream",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    events = []
    text = ""
    files = []
    speakers = []
    with urllib.request.urlopen(req, timeout=90) as resp:
        for ev in parse_sse(resp):
            events.append(ev["event"])
            data = ev["data"] or {}
            if ev["event"] == "openatlas.files" and isinstance(data, dict):
                files = data.get("items") or []
            if ev["event"] == "agent_join" and isinstance(data, dict):
                speakers.append(data.get("speaker_employee_id"))
            if ev["event"] == "assistant.delta" and isinstance(data, dict):
                text += str(data.get("delta") or data.get("content") or "")
            if ev["event"] == "error" and STRICT_MODEL:
                raise SmokeError(f"stream error event: {data}")
            if ev["event"] == "done":
                break
            if len(events) > 120:
                break
    required = {"openatlas.files", "agent_join"}
    missing = required - set(events)
    if missing:
        raise SmokeError(f"stream missing events: {sorted(missing)}; got={events[:20]}")
    if STRICT_MODEL and not text.strip():
        raise SmokeError("stream completed without assistant text")
    return {"events": events[:30], "assistant_chars": len(text), "files": files, "speakers": speakers, "strict_model": STRICT_MODEL}


def upload_text(token: str, name: str, text: str, *, session_id: str | None = None, content_type: str = "text/markdown") -> dict:
    return upload_bytes(
        token,
        name,
        text.encode("utf-8"),
        session_id=session_id,
        content_type=content_type + "; charset=utf-8",
    )


def upload_bytes(token: str, name: str, data: bytes, *, session_id: str | None = None, content_type: str = "application/octet-stream") -> dict:
    boundary = "----OpenAtlasApiSmoke" + uuid.uuid4().hex
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")
    payload = head + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    suffix = f"?session_id={urllib.parse.quote(session_id)}" if session_id else ""
    req = urllib.request.Request(
        BASE + "/files/upload" + suffix,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(payload)),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def build_minimal_pptx(text: str) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>""")
        zf.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>""")
        zf.writestr("ppt/presentation.xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>""")
        zf.writestr("ppt/_rels/presentation.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>""")
        safe_text = (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        zf.writestr("ppt/slides/slide1.xml", f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{safe_text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>""")
    return buf.getvalue()


def ensure_employee(token: str) -> dict:
    employees = request("GET", "/employees", token=token)["items"]
    if employees:
        return employees[0]
    suffix = uuid.uuid4().hex[:6]
    return request("POST", "/employees", {
        "display_name": f"Smoke Employee {suffix}",
        "avatar": "S",
        "description": "Smoke-test employee",
        "system_prompt": "You are a concise OpenAtlas smoke-test employee.",
        "toolsets": ["hermes-cli"],
    }, token=token)


def run() -> dict:
    report: list[dict] = []
    report.append(expect("health", lambda: request("GET", "/health")))
    login = expect("login", lambda: request("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD}))
    report.append(login)
    if not login["ok"]:
        return {"ok": False, "base": BASE, "checks": report}
    token = login["data"]["access_token"]

    report.append(expect("me", lambda: request("GET", "/auth/me", token=token)))
    report.append(expect("capabilities", lambda: request("GET", "/capabilities", token=token)))
    report.append(expect("models", lambda: request("GET", "/models", token=token)))
    report.append(expect("runtime health", lambda: request("GET", "/runtime/health", token=token)))
    report.append(expect("skill market", lambda: {"count": len(request("GET", "/skill-market", token=token)["items"])}))

    def hermes_command_coverage():
        caps = request("GET", "/capabilities", token=token)
        features = caps.get("features", {})
        endpoints = caps.get("endpoints", {})
        required_features = ["run_stop", "session_fork", "skills_api"]
        missing_features = [name for name in required_features if not features.get(name)]
        if missing_features:
            raise SmokeError(f"Hermes capabilities missing {missing_features}: {features}")
        if not endpoints.get("toolsets"):
            raise SmokeError(f"Hermes capabilities missing toolsets endpoint: {endpoints}")
        toolsets = request("GET", "/toolsets/governance", token=token)
        if not toolsets.get("toolsets"):
            raise SmokeError(f"toolset governance returned no toolsets: {toolsets}")
        diagnostics = request("GET", "/runtime/diagnostics", token=token)
        if not diagnostics.get("checks"):
            raise SmokeError(f"runtime diagnostics missing checks: {diagnostics}")
        logs = request("GET", "/runtime/logs?kind=agent&tail=20", token=token)
        prompt_size = request("POST", "/runtime/ops/prompt-size", {}, token=token, timeout=90)
        logs_list = request("POST", "/runtime/ops/logs-list", {}, token=token, timeout=60)
        skill_check = request("POST", "/hermes-skills/hub/check", {}, token=token, timeout=120)
        taps = request("GET", "/hermes-skills/hub/taps", token=token, timeout=60)
        stop_404 = expect_http_error("POST", "/hermes-runs/openatlas-smoke-missing-run/stop", 404, token=token, body={})
        if not stop_404["ok"]:
            raise SmokeError(stop_404["error"])
        return {
            "capabilities": {name: features.get(name) for name in required_features},
            "toolsets_endpoint": endpoints.get("toolsets", {}).get("path"),
            "toolsets": len(toolsets.get("toolsets", [])),
            "diagnostics_ok": diagnostics.get("all_ok"),
            "logs_ok": logs.get("ok"),
            "prompt_size_ok": prompt_size.get("ok"),
            "logs_list_ok": logs_list.get("ok"),
            "skill_check_ok": skill_check.get("ok"),
            "taps_ok": taps.get("ok"),
            "stop_route": "404 as expected",
        }

    report.append(expect("hermes command coverage", hermes_command_coverage))

    emp_result = expect("ensure employee", lambda: ensure_employee(token))
    report.append(emp_result)
    if not emp_result["ok"]:
        return {"ok": False, "base": BASE, "checks": report}
    emp = emp_result["data"]
    emp_id = emp["id"]

    def employee_toolset_boundary():
        current = request("GET", f"/employees/{emp_id}", token=token)
        original = current.get("toolsets") or []
        toolsets = request("GET", "/toolsets/governance", token=token).get("toolsets") or []
        valid = [item.get("name") for item in toolsets if item.get("name")]
        if not valid:
            raise SmokeError("no Hermes toolsets available for boundary check")
        invalid = expect_http_error(
            "PATCH",
            f"/employees/{emp_id}/toolsets",
            400,
            token=token,
            body={"toolsets": ["openatlas-smoke-nonexistent-toolset"]},
        )
        if not invalid["ok"]:
            raise SmokeError(f"unknown toolset was not rejected: {invalid}")
        patched = request("PATCH", f"/employees/{emp_id}/toolsets", {"toolsets": [valid[0]]}, token=token)
        if patched.get("toolsets") != [valid[0]]:
            raise SmokeError(f"valid toolset was not persisted: {patched}")
        request("PATCH", f"/employees/{emp_id}/toolsets", {"toolsets": original}, token=token)
        return {"valid_toolset": valid[0], "restored": original}

    report.append(expect("employee toolset boundary", employee_toolset_boundary))

    def session_and_stream():
        sid = request("POST", "/sessions", {
            "employee_id": emp_id,
            "title": "API Smoke " + uuid.uuid4().hex[:6],
        }, token=token)["id"]
        uploaded = upload_text(
            token,
            "openatlas-api-smoke.md",
            "# OPENATLAS_FILE_SMOKE\n\n这段 Markdown 必须进入文件上下文。",
            session_id=sid,
        )
        if uploaded.get("extracted_chars", 0) <= 0:
            raise SmokeError(f"uploaded markdown was not extracted: {uploaded}")
        stream_result = chat_stream(token, sid, "请用一句话回复: OPENATLAS_API_SMOKE_OK，并说明是否收到 OPENATLAS_FILE_SMOKE", attachment_ids=[uploaded["id"]])
        if not stream_result["files"] or stream_result["files"][0].get("extracted_chars", 0) <= 0:
            raise SmokeError(f"stream did not report injected file metadata: {stream_result['files']}")
        detail = request("GET", f"/sessions/{sid}", token=token)
        if not detail.get("health") or "score" not in detail["health"]:
            raise SmokeError(f"session detail missing health snapshot: {detail}")
        health = request("GET", f"/sessions/{sid}/health", token=token)
        if not health.get("health") or "recommended_actions" not in health["health"]:
            raise SmokeError(f"session health endpoint missing actionable payload: {health}")
        recovered = request("POST", f"/sessions/{sid}/recover", {}, token=token)
        if not recovered.get("health") or "score" not in recovered["health"]:
            raise SmokeError(f"session recover missing health payload: {recovered}")
        runs = request("GET", f"/sessions/{sid}/runs", token=token)
        if not runs.get("items"):
            raise SmokeError(f"session runs missing after chat stream: {runs}")
        replay = request("GET", f"/sessions/{sid}/replay", token=token)
        if not replay.get("workflow_run") or not replay.get("runs"):
            raise SmokeError(f"session replay missing workflow/run evidence: {replay}")
        messages = request("GET", f"/sessions/{sid}/messages", token=token)
        listed = request("GET", f"/files?session_id={sid}", token=token)
        file_detail = request("GET", f"/files/{uploaded['id']}", token=token)
        request("DELETE", f"/files/{uploaded['id']}", token=token)
        pptx_uploaded = upload_bytes(
            token,
            "openatlas-api-smoke.pptx",
            build_minimal_pptx("OPENATLAS_PPTX_SMOKE"),
            session_id=sid,
            content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        if pptx_uploaded.get("extracted_chars", 0) <= 0:
            raise SmokeError(f"uploaded pptx was not extracted: {pptx_uploaded}")
        pptx_detail = request("GET", f"/files/{pptx_uploaded['id']}", token=token)
        if "OPENATLAS_PPTX_SMOKE" not in str(pptx_detail.get("content_preview") or pptx_detail.get("summary") or pptx_detail):
            raise SmokeError(f"pptx detail missing extracted marker: {pptx_detail}")
        request("DELETE", f"/files/{pptx_uploaded['id']}", token=token)
        request("DELETE", f"/sessions/{sid}", token=token)
        return {
            "session_id": sid,
            "stream": stream_result,
            "message_count": len(messages["items"]),
            "health_score": recovered["health"].get("score"),
            "runs": {"count": len(runs.get("items", [])), "latest": runs.get("items", [None])[0]},
            "replay": {
                "workflow_status": (replay.get("workflow_run") or {}).get("status"),
                "node_count": len((replay.get("workflow_run") or {}).get("nodes") or []),
                "event_count": len(replay.get("events") or []),
            },
            "summary": detail.get("summary", {}),
            "file": {"listed": len(listed.get("items", [])), "summary": file_detail.get("summary"), "snippets": file_detail.get("snippets", [])[:1]},
            "pptx": {"extracted_chars": pptx_uploaded.get("extracted_chars"), "summary": pptx_detail.get("summary")},
        }

    report.append(expect("session + chat stream", session_and_stream))

    def session_fork_smoke():
        sid = request("POST", "/sessions", {
            "employee_id": emp_id,
            "title": "Fork Smoke " + uuid.uuid4().hex[:6],
        }, token=token)["id"]
        forked = request("POST", f"/sessions/{sid}/fork", {
            "title": "Fork Smoke Branch " + uuid.uuid4().hex[:6],
        }, token=token)
        detail = request("GET", f"/sessions/{forked['id']}", token=token)
        request("DELETE", f"/sessions/{sid}", token=token)
        request("DELETE", f"/sessions/{forked['id']}", token=token)
        if not detail.get("hermes_session_id"):
            raise SmokeError(f"forked session missing Hermes id: {detail}")
        return {
            "source_session_id": sid,
            "forked_session_id": forked["id"],
            "forked_hermes_session_id": detail["hermes_session_id"],
            "message_count": detail.get("message_count"),
        }

    report.append(expect("session fork", session_fork_smoke))

    def skill_bind_dashboard_audit():
        suffix = uuid.uuid4().hex[:6]
        skill = request("POST", "/skill-market", {
            "name": f"API Smoke Skill {suffix}",
            "slug": f"api-smoke-skill-{suffix}",
            "description": "Created by api_smoke.py",
            "category": "smoke",
            "version": "1.0.0",
            "scope": "user",
            "visibility": "private",
            "mutable": True,
        }, token=token)
        binding = request("POST", f"/skill-market/{skill['id']}/bind", {
            "skill_id": skill["id"],
            "target_type": "employee",
            "target_id": emp_id,
            "binding_mode": "copied",
        }, token=token)
        market = request("GET", f"/skill-market/{skill['id']}", token=token)
        if market.get("binding_count", 0) < 1:
            raise SmokeError(f"skill binding_count did not update: {market}")
        tenant_dashboard = request("GET", "/dashboard/tenant", token=token)
        for key in ("token_usage", "files", "failure_rate", "skill_usage", "gateway", "maturity"):
            if key not in tenant_dashboard:
                raise SmokeError(f"dashboard missing {key}: {tenant_dashboard}")
        if "score" not in tenant_dashboard.get("maturity", {}):
            raise SmokeError(f"dashboard maturity missing score: {tenant_dashboard.get('maturity')}")
        audit_rows = request("GET", f"/audit?resource_id={skill['id']}&limit=10", token=token)
        if not any(row.get("resource_id") == skill["id"] for row in audit_rows):
            raise SmokeError(f"audit resource_id trace missing for skill {skill['id']}: {audit_rows}")
        disabled = request("POST", f"/skill-market/{skill['id']}/disable", {}, token=token)
        return {"skill_id": skill["id"], "binding_id": binding["id"], "disabled": disabled.get("status"), "dashboard_keys": sorted(tenant_dashboard.keys())}

    report.append(expect("skill binding + dashboard + audit", skill_bind_dashboard_audit))

    def job_scheduler_metadata():
        job = request("POST", "/jobs", {
            "name": "API Smoke Scheduled Job " + uuid.uuid4().hex[:6],
            "description": "Created by api_smoke.py",
            "schedule_kind": "interval",
            "schedule_expr": "30m",
            "employee_id": emp_id,
            "prompt": "请用一句话回复 OPENATLAS_JOB_SMOKE",
        }, token=token)
        if not job.get("next_run_at"):
            raise SmokeError(f"created job missing next_run_at: {job}")
        paused = request("POST", f"/jobs/{job['id']}/pause", {}, token=token)
        if paused.get("status") != "paused":
            raise SmokeError(f"pause failed: {paused}")
        resumed = request("POST", f"/jobs/{job['id']}/resume", {}, token=token)
        if resumed.get("status") != "active" or not resumed.get("next_run_at"):
            raise SmokeError(f"resume failed to restore schedule: {resumed}")
        request("DELETE", f"/jobs/{job['id']}", token=token)
        return {"job_id": job["id"], "next_run_at": resumed.get("next_run_at")}

    report.append(expect("job scheduler metadata", job_scheduler_metadata))

    def stale_session_maintenance_route():
        dry = request("POST", "/sessions/maintenance/stale?dry_run=true&limit=5", {}, token=token)
        if "stale" not in dry or "items" not in dry:
            raise SmokeError(f"stale maintenance route missing payload: {dry}")
        return {"stale": dry.get("stale"), "scanned": dry.get("scanned"), "dry_run": dry.get("dry_run")}

    report.append(expect("stale session maintenance", stale_session_maintenance_route))

    def template_create_use():
        sid = request("POST", "/sessions", {
            "employee_id": emp_id,
            "title": "Template Smoke Source " + uuid.uuid4().hex[:6],
        }, token=token)["id"]
        canvas = {
            "version": 1,
            "nodes": [
                {"id": "user", "type": "agent", "position": {"x": 0, "y": 0}, "data": {"role": "user", "label": "用户"}},
                {"id": f"employee-{emp_id}", "type": "agent", "position": {"x": 260, "y": 0}, "data": {"role": "employee", "label": emp["display_name"], "employeeId": emp_id, "outputType": "markdown"}},
            ],
            "edges": [{"id": "e-user-employee", "source": "user", "target": f"employee-{emp_id}", "mode": "relay"}],
        }
        request("PATCH", f"/sessions/{sid}/canvas-state", canvas, token=token)
        tpl = request("POST", f"/sessions/{sid}/save-template", {
            "name": "API Smoke Template " + uuid.uuid4().hex[:6],
            "description": "Created by api_smoke.py",
            "category": "smoke",
            "visibility": "private",
        }, token=token)
        used = request("POST", f"/collaboration-templates/{tpl['id']}/sessions", {
            "title": "API Smoke From Template " + uuid.uuid4().hex[:6],
        }, token=token)
        if used.get("reusable_template_id") != tpl["id"]:
            raise SmokeError("template session did not retain reusable_template_id")
        request("DELETE", f"/sessions/{sid}", token=token)
        request("DELETE", f"/sessions/{used['id']}", token=token)
        request("DELETE", f"/collaboration-templates/{tpl['id']}", token=token)
        return {"template_id": tpl["id"], "new_session_id": used["id"], "plan": tpl.get("collaboration_plan")}

    report.append(expect("template create/use", template_create_use))
    ok = all(item["ok"] for item in report)
    return {"ok": ok, "base": BASE, "strict_model": STRICT_MODEL, "checks": report}


if __name__ == "__main__":
    result = run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result["ok"] else 1)
