"""Business-scenario regression for built-in digital employees.

This is intentionally different from a minimal "can the employee answer"
smoke test. It runs real business prompts with demo-pack files, then checks
whether each employee produced role-appropriate structure, cited inputs, and
registered deliverables.

Usage:
  OPENATLAS_API_BASE=http://127.0.0.1:58003/api \
  python3 backend/scripts/employee_scenario_smoke.py

Useful env:
  OPENATLAS_SCENARIO_LIMIT=3          # run first N scenarios
  OPENATLAS_SCENARIO_IDS=finance-q2-review,legal-contract-risk
  OPENATLAS_SCENARIO_KEEP_SESSIONS=1  # keep all sessions for manual review
  OPENATLAS_SCENARIO_STRICT=1         # exit non-zero on score failures
  OPENATLAS_SCENARIO_AUTO_APPROVE=1   # approve only project-scoped safe compute
"""
from __future__ import annotations

import json
import os
import re
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CONTENT_FILE = ROOT / "demo-pack" / "seeds" / "openatlas-demo-content.json"
MATERIALS_DIR = ROOT / "demo-pack" / "materials"
REPORT_DIR = ROOT / "outputs" / "employee-scenario-smoke"

BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58003/api").rstrip("/")
EMAIL = os.environ.get("OPENATLAS_EMAIL", "admin@demo.openatlas")
PASSWORD = os.environ.get("OPENATLAS_PASSWORD", "openatlas")
LIMIT = int(os.environ.get("OPENATLAS_SCENARIO_LIMIT", "0") or "0")
IDS = {x.strip() for x in os.environ.get("OPENATLAS_SCENARIO_IDS", "").split(",") if x.strip()}
KEEP_SESSIONS = os.environ.get("OPENATLAS_SCENARIO_KEEP_SESSIONS", "0") == "1"
STRICT = os.environ.get("OPENATLAS_SCENARIO_STRICT", "1") == "1"
STREAM_TIMEOUT = int(os.environ.get("OPENATLAS_SCENARIO_STREAM_TIMEOUT", "180"))
RECOVER_WAIT = int(os.environ.get("OPENATLAS_SCENARIO_RECOVER_WAIT", "150"))
AUTO_APPROVE = os.environ.get("OPENATLAS_SCENARIO_AUTO_APPROVE", "0") == "1"
ALLOWED_APPROVAL_ROOTS = [
    Path(p).expanduser().resolve()
    for p in os.environ.get("OPENATLAS_SCENARIO_APPROVAL_ROOTS", str(ROOT)).split(os.pathsep)
    if p.strip()
]

urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))


class ScenarioError(RuntimeError):
    pass


def request(method: str, path: str, body: object | None = None, token: str | None = None, timeout: int = 30) -> Any:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
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
        raise ScenarioError(f"{method} {path} -> HTTP {exc.code}: {detail[:500]}") from exc


def login() -> str:
    out = request("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    return out["access_token"]


def approval_command(payload: dict[str, Any]) -> str:
    for key in ("command", "preview", "description", "label"):
        value = payload.get(key)
        if value:
            return str(value)
    return ""


def is_project_safe_approval(payload: dict[str, Any]) -> tuple[bool, str]:
    """Allow only read-only/small compute approvals scoped to this workspace.

    This is intentionally conservative. A scenario test may fail because a
    command needs human review; it must not mutate the host or another project.
    """
    command = approval_command(payload)
    tool_name = str(payload.get("tool") or payload.get("tool_name") or "").lower()
    lowered = command.lower()
    dangerous_terms = (
        " rm ", "rm -", "sudo", "chmod", "chown", "mkfs", " dd ",
        "shutil.rmtree", "os.remove", "unlink(", "rmdir(", "subprocess",
        "requests.", "urllib.", "socket.", "curl ", "wget ", "scp ", "ssh ",
        "path.home", "~/", "/etc/", "/var/", "/system/", "/library/",
        "/applications/", "/users/macbook/.ssh", "/users/macbook/.aws",
        "/users/macbook/.config",
    )
    padded = f" {lowered} "
    for term in dangerous_terms:
        if term in padded:
            return False, f"dangerous_term:{term.strip()}"

    absolute_paths = sorted(
        set(
            match.rstrip("`'\"),;")
            for match in re.findall(
                r"(?<![\w.-])/(?:Users|tmp|var|etc|opt|Applications|System|Library|Volumes)/[^\s'\"`<>]+",
                command,
            )
        )
    )
    for raw in absolute_paths:
        try:
            path = Path(raw).expanduser().resolve()
        except Exception:
            return False, f"unresolvable_path:{raw}"
        if not any(path == root or root in path.parents for root in ALLOWED_APPROVAL_ROOTS):
            return False, f"path_outside_project:{raw}"

    if not tool_name:
        return False, "missing_tool_name"
    if tool_name not in {"execute_code", "python", "code_execution"}:
        return False, f"tool_not_auto_approved:{tool_name}"
    write_markers = (
        "open(", "path(", "write_text(", "write_bytes(", ".write(",
        "to_csv(", "to_excel(", "to_json(", "mkdir(", "rename(", "replace(",
    )
    if any(marker in lowered for marker in write_markers):
        return False, "possible_file_write"
    return True, "project_safe_compute"


def approve_if_safe(token: str, payload: dict[str, Any]) -> dict:
    safe, reason = is_project_safe_approval(payload)
    run_id = str(payload.get("hermes_run_id") or payload.get("run_id") or "")
    approval_id = payload.get("approval_id")
    if not AUTO_APPROVE:
        return {"approved": False, "reason": "auto_approve_disabled", "safe": safe}
    if not safe:
        return {"approved": False, "reason": reason, "safe": False}
    if not run_id:
        return {"approved": False, "reason": "missing_run_id", "safe": True}
    out = request(
        "POST",
        f"/hermes-runs/{urllib.parse.quote(run_id)}/approval",
        {"choice": "once", "approval_id": approval_id},
        token=token,
        timeout=45,
    )
    return {"approved": True, "reason": reason, "safe": True, "response": out}


def upload_file(token: str, session_id: str, filename: str) -> dict:
    path = MATERIALS_DIR / filename
    if not path.exists() or not path.is_file():
        raise ScenarioError(f"scenario material missing: {filename}")
    data = path.read_bytes()
    boundary = "----OpenAtlasScenario" + uuid.uuid4().hex
    content_type = guess_content_type(path)
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")
    payload = head + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    suffix = f"?session_id={urllib.parse.quote(session_id)}"
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
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode("utf-8"))


def guess_content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".md": "text/markdown; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }.get(suffix, "application/octet-stream")


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
            payload: Any = None
            if data:
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    payload = data
            yield {"event": name, "data": payload}


def chat_stream(token: str, session_id: str, message: str, attachment_ids: list[str]) -> dict:
    body = {"message": message, "attachment_ids": attachment_ids}
    req = urllib.request.Request(
        BASE + f"/sessions/{session_id}/chat/stream",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    text_parts: list[str] = []
    events: list[str] = []
    files: list[dict] = []
    speakers: list[str] = []
    tool_events: list[dict] = []
    last_tool_by_run: dict[str, str] = {}
    handled_approvals: set[str] = set()
    started = time.time()
    with urllib.request.urlopen(req, timeout=STREAM_TIMEOUT) as resp:
        for ev in parse_sse(resp):
            event_name = ev["event"]
            data = ev["data"] or {}
            events.append(event_name)
            if event_name == "openatlas.files" and isinstance(data, dict):
                files = data.get("items") or []
            if event_name == "agent_join" and isinstance(data, dict):
                speakers.append(data.get("speaker_name") or data.get("speaker_employee_id") or "")
            if event_name in {"assistant.delta", "message.delta"} and isinstance(data, dict):
                text_parts.append(str(data.get("delta") or data.get("content") or data.get("text") or ""))
            if (
                event_name.startswith("tool")
                or event_name.startswith("hermes")
                or event_name.startswith("approval")
                or "approval" in event_name
            ):
                if event_name == "tool.started" and isinstance(data, dict):
                    run_key = str(data.get("hermes_run_id") or data.get("run_id") or "")
                    tool_label = str(data.get("tool_name") or data.get("tool") or "")
                    if run_key and tool_label:
                        last_tool_by_run[run_key] = tool_label
                if event_name == "openatlas.approval_required" and isinstance(data, dict):
                    run_key = str(data.get("hermes_run_id") or data.get("run_id") or "")
                    if run_key and not (data.get("tool") or data.get("tool_name")):
                        tool_label = last_tool_by_run.get(run_key)
                        if tool_label:
                            data = {**data, "tool_name": tool_label}
                tool_events.append({"event": event_name, "data": data})
                if event_name == "openatlas.approval_required" and isinstance(data, dict):
                    approval_key = str(data.get("approval_id") or data.get("hermes_run_id") or data.get("run_id") or "")
                    if approval_key and approval_key in handled_approvals:
                        approval_result = {"approved": False, "reason": "already_approved_for_run", "safe": True}
                    else:
                        try:
                            approval_result = approve_if_safe(token, data)
                            if approval_result.get("approved") and approval_key:
                                handled_approvals.add(approval_key)
                        except Exception as exc:  # noqa: BLE001
                            approval_result = {"approved": False, "reason": f"approval_call_failed:{exc}", "safe": False}
                    tool_events.append({"event": "openatlas.scenario_approval_guard", "data": approval_result})
            if event_name == "error":
                tool_events.append({"event": event_name, "data": data})
            if event_name == "done":
                break
            if time.time() - started > STREAM_TIMEOUT:
                raise ScenarioError(f"stream timeout after {STREAM_TIMEOUT}s")
    return {
        "events": events,
        "assistant_text": "".join(text_parts),
        "files": files,
        "speakers": [s for s in speakers if s],
        "tool_events": tool_events[:20],
        "duration_ms": int((time.time() - started) * 1000),
    }


def recover_session(token: str, session_id: str) -> dict:
    try:
        return request("POST", f"/sessions/{urllib.parse.quote(session_id)}/recover", token=token, timeout=60) or {}
    except Exception as exc:  # noqa: BLE001
        return {"_recover_error": str(exc)[:500]}


def persisted_assistant_text(messages: list[dict]) -> str:
    return "\n\n".join(
        str(item.get("content") or "")
        for item in messages
        if item.get("role") == "assistant" and str(item.get("content") or "").strip()
    )


def collect_session_outputs(token: str, session_id: str, scenario: dict) -> tuple[dict, list[dict], list[dict]]:
    """Recover and poll late Hermes outputs/artifacts for detached long runs."""
    expected_artifact = str(scenario.get("expected_artifact") or "").lower()
    deadline = time.time() + max(0, RECOVER_WAIT)
    recovery: dict = {}
    messages: list[dict] = []
    artifacts: list[dict] = []
    while True:
        recovery = recover_session(token, session_id)
        artifacts = request("GET", f"/artifacts?session_id={urllib.parse.quote(session_id)}&limit=50", token=token).get("items", [])
        messages = request("GET", f"/sessions/{session_id}/messages", token=token).get("items", [])
        text = persisted_assistant_text(messages)
        artifact_kinds = {str(a.get("kind") or "").lower() for a in artifacts}
        has_expected_artifact = (
            expected_artifact == ""
            or expected_artifact == "markdown"
            or expected_artifact in artifact_kinds
            or (expected_artifact == "html" and ("<html" in text.lower() or "```html" in text.lower()))
        )
        status = str(recovery.get("task_status") or "").lower()
        if status in {"completed", "failed", "needs_input"} and has_expected_artifact:
            break
        if has_expected_artifact and len(text.strip()) >= 260:
            break
        if time.time() >= deadline:
            break
        time.sleep(10)
    return recovery, messages, artifacts


def fetch_artifact_previews(token: str, artifacts: list[dict]) -> list[dict]:
    enriched: list[dict] = []
    for item in artifacts:
        row = dict(item)
        artifact_id = str(row.get("id") or "")
        if not artifact_id:
            enriched.append(row)
            continue
        try:
            preview = request("GET", f"/artifacts/{urllib.parse.quote(artifact_id)}/preview", token=token, timeout=45)
            content = str(preview.get("content") or "")
            row["_preview_kind"] = preview.get("preview_kind")
            row["_preview_renderable"] = preview.get("renderable")
            row["_preview_text"] = content[:30000]
            row["_preview_chars"] = len(content)
        except Exception as exc:  # noqa: BLE001
            row["_preview_error"] = str(exc)[:500]
        enriched.append(row)
    return enriched


class _ScenarioTimeout:
    def __init__(self, seconds: int, label: str):
        self.seconds = max(1, int(seconds))
        self.label = label
        self.prev_handler = None

    def _handle(self, signum, frame):  # noqa: ANN001, ARG002
        raise TimeoutError(f"{self.label} exceeded {self.seconds}s")

    def __enter__(self):
        if hasattr(signal, "SIGALRM"):
            self.prev_handler = signal.signal(signal.SIGALRM, self._handle)
            signal.alarm(self.seconds)
        return self

    def __exit__(self, exc_type, exc, tb):  # noqa: ANN001
        if hasattr(signal, "SIGALRM"):
            signal.alarm(0)
            if self.prev_handler is not None:
                signal.signal(signal.SIGALRM, self.prev_handler)
        return False


def score_response(scenario: dict, stream: dict, artifacts: list[dict]) -> dict:
    text = stream.get("assistant_text") or ""
    artifact_text = "\n\n".join(str(a.get("_preview_text") or "") for a in artifacts)
    scored_text = f"{text}\n\n{artifact_text}".strip()
    text_lower = text.lower()
    scored_lower = scored_text.lower()
    required_terms = scenario.get("required_terms") or []
    required_sections = scenario.get("required_sections") or []
    expected_artifact = str(scenario.get("expected_artifact") or "").lower()
    attachments = scenario.get("attachments") or []

    term_hits = [term for term in required_terms if str(term).lower() in scored_lower]
    section_hits = [term for term in required_sections if str(term).lower() in scored_lower]
    artifact_kinds = {str(a.get("kind") or "").lower() for a in artifacts}
    approval_required = any("approval" in str(item.get("event") or "") for item in stream.get("tool_events") or [])
    tool_blobs = [
        json.dumps(item, ensure_ascii=False).lower()
        for item in (stream.get("tool_events") or [])
    ]

    score = 0
    reasons: list[str] = []
    if approval_required and not text.strip():
        reasons.append("waiting_for_tool_approval_without_visible_answer")

    progress_only_phrases = (
        "开始生成", "正在生成", "开始分析", "正在分析", "开始整理", "正在整理",
        "已读取", "数据已读取", "开始制作", "正在制作", "交付物", "我来",
    )
    has_business_markers = any(
        marker in text
        for marker in ("##", "|", "<html", "摘要", "结论", "风险", "建议", "表", "清单")
    )
    progress_phrase_hits = sum(1 for phrase in progress_only_phrases if phrase in text)
    if len(text.strip()) < 260 and progress_phrase_hits >= 2 and not has_business_markers:
        reasons.append("progress_update_without_deliverable")

    if len(scored_text.strip()) >= 160:
        score += 12
    else:
        reasons.append("assistant_text_too_short")

    if required_terms:
        ratio = len(term_hits) / len(required_terms)
        score += int(24 * ratio)
        if ratio < 0.75:
            reasons.append(f"missing_required_terms:{','.join(str(x) for x in required_terms if x not in term_hits)}")
    else:
        score += 24

    if required_sections:
        ratio = len(section_hits) / len(required_sections)
        score += int(18 * ratio)
        if ratio < 0.6:
            reasons.append(f"missing_sections:{','.join(str(x) for x in required_sections if x not in section_hits)}")
    else:
        score += 18

    if attachments:
        injected = stream.get("files") or []
        if len(injected) >= len(attachments):
            score += 16
        else:
            reasons.append(f"file_context_incomplete:{len(injected)}/{len(attachments)}")
    else:
        score += 16

    artifact_ok = False
    if expected_artifact == "html":
        artifact_ok = "html" in artifact_kinds or "<html" in scored_lower or "```html" in scored_lower
    elif expected_artifact == "markdown":
        artifact_ok = bool(artifacts) or "表" in text or "|" in text or "##" in text
    else:
        artifact_ok = True
    if artifact_ok:
        score += 15
    else:
        reasons.append(f"expected_artifact_missing:{expected_artifact}")

    leaked = any(tag in scored_lower for tag in ("<system_prompt>", "<file_context>", "<context>", "<hermes_skills>"))
    file_denial = bool(attachments) and any(phrase in text for phrase in ("看不到文件", "无法读取文件", "没有收到文件", "请重新上传"))
    if not leaked and not file_denial:
        score += 15
    else:
        if leaked:
            reasons.append("internal_context_leaked")
        if file_denial:
            reasons.append("claimed_file_unavailable")

    guessed_server_path = any(
        marker in blob
        for blob in tool_blobs
        for marker in ("/users/", "~/.openatlas", ".openatlas/uploads")
    )
    hallucinated_local_path = any(
        marker in scored_lower
        for marker in ("/users/", "desktop/", "desktop\\", "桌面")
    )
    hard_fail = False
    if guessed_server_path:
        score -= 12
        reasons.append("guessed_server_local_file_path")
        hard_fail = True
    if hallucinated_local_path:
        score -= 8
        reasons.append("claimed_local_os_path_for_bs_artifact")
        hard_fail = True

    normalized_score = max(0, min(score, 100))
    return {
        "score": normalized_score,
        "min_score": int(scenario.get("min_score") or 70),
        "ok": (not hard_fail) and normalized_score >= int(scenario.get("min_score") or 70),
        "term_hits": term_hits,
        "section_hits": section_hits,
        "artifact_kinds": sorted(k for k in artifact_kinds if k),
        "reasons": reasons,
    }


def run_scenario(token: str, scenario: dict, employees: dict[str, dict]) -> dict:
    employee_name = scenario["employee"]
    emp = employees.get(employee_name)
    if not emp:
        if scenario.get("optional"):
            return {
                "id": scenario["id"],
                "employee": employee_name,
                "ok": True,
                "skipped": True,
                "reason": "optional_employee_not_found",
            }
        raise ScenarioError(f"employee not found: {employee_name}")

    sid = request("POST", "/sessions", {
        "employee_id": emp["id"],
        "title": f"业务场景验收 · {scenario['title']} · {uuid.uuid4().hex[:6]}",
    }, token=token, timeout=60)["id"]
    uploaded: list[dict] = []
    keep_session = KEEP_SESSIONS
    try:
        for filename in scenario.get("attachments") or []:
            uploaded.append(upload_file(token, sid, filename))
        attachment_ids = [item["id"] for item in uploaded]
        try:
            with _ScenarioTimeout(STREAM_TIMEOUT + 30, f"scenario {scenario['id']}"):
                stream = chat_stream(token, sid, scenario["message"], attachment_ids)
        except TimeoutError as exc:
            stream = {
                "events": ["stream_timeout"],
                "assistant_text": "",
                "files": [],
                "speakers": [],
                "tool_events": [{"event": "stream_timeout", "data": {"error": str(exc)}}],
                "duration_ms": (STREAM_TIMEOUT + 30) * 1000,
                "stream_error": str(exc),
            }
        except ScenarioError as exc:
            if "stream timeout" not in str(exc).lower():
                raise
            stream = {
                "events": ["stream_timeout"],
                "assistant_text": "",
                "files": [],
                "speakers": [],
                "tool_events": [{"event": "stream_timeout", "data": {"error": str(exc)}}],
                "duration_ms": STREAM_TIMEOUT * 1000,
                "stream_error": str(exc),
            }
        recovery, messages, artifacts = collect_session_outputs(token, sid, scenario)
        artifacts = fetch_artifact_previews(token, artifacts)
        stored_text = persisted_assistant_text(messages)
        if len(stored_text) > len(stream.get("assistant_text") or ""):
            stream["stream_assistant_text"] = stream.get("assistant_text") or ""
            stream["assistant_text"] = stored_text
        score = score_response(scenario, stream, artifacts)
        if not score["ok"]:
            keep_session = True
        return {
            "id": scenario["id"],
            "employee": employee_name,
            "session_id": sid,
            "skipped": False,
            "ok": score["ok"],
            "score": score,
            "uploaded": [
                {
                    "id": item.get("id"),
                    "name": item.get("original_name") or item.get("name"),
                    "extracted_chars": item.get("extracted_chars"),
                }
                for item in uploaded
            ],
            "stream": {
                "duration_ms": stream["duration_ms"],
                "events": stream["events"][:40],
                "assistant_chars": len(stream["assistant_text"]),
                "files_injected": len(stream.get("files") or []),
                "speakers": stream.get("speakers") or [],
                "tool_events": stream.get("tool_events") or [],
                "stream_error": stream.get("stream_error"),
            },
            "artifacts": [
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "kind": item.get("kind"),
                    "managed_status": item.get("managed_status"),
                    "preview_kind": item.get("_preview_kind"),
                    "preview_chars": item.get("_preview_chars"),
                    "preview_error": item.get("_preview_error"),
                }
                for item in artifacts
            ],
            "message_count": len(messages),
            "recovery": recovery,
            "assistant_preview": stream["assistant_text"][:800],
            "kept_for_review": keep_session,
        }
    except Exception:
        keep_session = True
        raise
    finally:
        if not keep_session:
            try:
                request("DELETE", f"/sessions/{sid}", token=token)
            except Exception:
                pass


def main() -> int:
    content = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
    scenarios = content.get("employee_scenarios") or []
    if IDS:
        scenarios = [s for s in scenarios if s.get("id") in IDS]
    if LIMIT > 0:
        scenarios = scenarios[:LIMIT]
    token = login()
    employee_items = request("GET", "/employees", token=token).get("items", [])
    employees = {item.get("display_name"): item for item in employee_items}

    checks: list[dict] = []
    for scenario in scenarios:
        started = time.time()
        try:
            result = run_scenario(token, scenario, employees)
            result["ms"] = int((time.time() - started) * 1000)
        except Exception as exc:  # noqa: BLE001
            result = {
                "id": scenario.get("id"),
                "employee": scenario.get("employee"),
                "ok": False,
                "skipped": False,
                "ms": int((time.time() - started) * 1000),
                "error": str(exc),
            }
        checks.append(result)
        status = "SKIP" if result.get("skipped") else ("PASS" if result.get("ok") else "FAIL")
        score = ((result.get("score") or {}).get("score") if result.get("score") else "-")
        print(f"[{status}] {result.get('id')} employee={result.get('employee')} score={score} ms={result.get('ms')}", flush=True)

    ok = all(item.get("ok") for item in checks)
    report = {
        "ok": ok,
        "base": BASE,
        "content_version": content.get("version"),
        "strict": STRICT,
        "scenario_count": len(checks),
        "passed": sum(1 for item in checks if item.get("ok") and not item.get("skipped")),
        "skipped": sum(1 for item in checks if item.get("skipped")),
        "failed": sum(1 for item in checks if not item.get("ok")),
        "checks": checks,
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REPORT_DIR / f"employee-scenario-report-{time.strftime('%Y%m%d-%H%M%S')}.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report: {out_path}", flush=True)
    print(json.dumps({k: report[k] for k in ("ok", "scenario_count", "passed", "skipped", "failed")}, ensure_ascii=False), flush=True)
    return 0 if ok or not STRICT else 1


if __name__ == "__main__":
    raise SystemExit(main())
