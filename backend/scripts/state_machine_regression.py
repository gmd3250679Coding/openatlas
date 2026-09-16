"""State-machine regression checks for session/run isolation.

This avoids the live model path and focuses on the OpenAtlas contract:
- non-draft empty sessions remain visible while run state is being reconciled
- late artifacts are discoverable through the session artifact endpoint
- empty completed sessions do not reuse messages from another running session
- repeated reads after a simulated disconnect do not hide a running session
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path


BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58003/api").rstrip("/")
EMAIL = os.environ.get("OPENATLAS_EMAIL", "admin@demo.openatlas")
PASSWORD = os.environ.get("OPENATLAS_PASSWORD", "openatlas")
DB_PATH = Path(
    os.environ.get("OPENATLAS_SQLITE_PATH")
    or Path.home() / ".openatlas" / "backend-data" / "openatlas.db"
)
PREFIX = "STATE_MACHINE_REGRESSION_"


def sql_quote(value: object) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def run_sql(sql: str) -> None:
    subprocess.check_call(["sqlite3", "-cmd", ".timeout 15000", str(DB_PATH), sql])


def query_json(sql: str) -> list[dict]:
    raw = subprocess.check_output(
        ["sqlite3", "-cmd", ".timeout 15000", "-json", str(DB_PATH), sql],
        text=True,
    ).strip()
    return json.loads(raw) if raw else []


def request(method: str, path: str, body: object | None = None, token: str | None = None) -> dict:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def login() -> str:
    data = request("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    token = data.get("access_token")
    if not token:
        raise RuntimeError("login did not return access_token")
    return str(token)


def cleanup() -> None:
    run_sql(
        f"""
        delete from task_artifacts where session_id in (select id from sessions where title like {sql_quote(PREFIX + '%')});
        delete from messages where session_id in (select id from sessions where title like {sql_quote(PREFIX + '%')});
        delete from sessions where title like {sql_quote(PREFIX + '%')};
        """
    )


def seed() -> dict[str, str]:
    cleanup()
    user_rows = query_json(f"select id, tenant_id from users where email={sql_quote(EMAIL)} limit 1;")
    if not user_rows:
        raise RuntimeError(f"missing user {EMAIL}")
    user = user_rows[0]
    emp_rows = query_json(
        f"select id, display_name from digital_employees where tenant_id={sql_quote(user['tenant_id'])} "
        "and status='active' order by display_name limit 1;"
    )
    if not emp_rows:
        raise RuntimeError("missing active employee")
    employee = emp_rows[0]
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    ids = {
        "running": str(uuid.uuid4()),
        "completed_empty": str(uuid.uuid4()),
        "late_artifact": str(uuid.uuid4()),
        "old_message": str(uuid.uuid4()),
        "late_user_msg": str(uuid.uuid4()),
        "late_assistant_msg": str(uuid.uuid4()),
        "old_user_msg": str(uuid.uuid4()),
    }

    def insert_session(sid: str, suffix: str, status: str, last_message: str, count: int) -> str:
        return f"""
        insert into sessions (
          id, tenant_id, user_id, employee_id, hermes_session_id, title, last_message,
          message_count, archived, pinned, workspace, model_override, task_status, task_summary,
          participant_ids, canvas_state, created_at, updated_at
        ) values (
          {sql_quote(sid)}, {sql_quote(user['tenant_id'])}, {sql_quote(user['id'])}, {sql_quote(employee['id'])},
          {sql_quote('state_machine_' + sid[:8])}, {sql_quote(PREFIX + suffix)}, {sql_quote(last_message)},
          {count}, 0, 0, '', '', {sql_quote(status)}, '', '[]', '', {sql_quote(now)}, {sql_quote(now)}
        );
        """

    run_sql(
        "begin immediate;"
        + insert_session(ids["running"], "running_empty_visible", "running", "", 0)
        + insert_session(ids["completed_empty"], "completed_empty_visible", "completed", "", 0)
        + insert_session(ids["late_artifact"], "late_artifact_session", "completed", "生成报告", 2)
        + insert_session(ids["old_message"], "old_message_source", "running", "OLD_MESSAGE_SHOULD_NOT_LEAK", 1)
        + f"""
        insert into messages (
          id, session_id, role, content, model_message, tool_calls, reasoning, attachments,
          input_tokens, output_tokens, total_tokens, speaker_employee_id, speaker_name, turn_index, created_at
        ) values
        ({sql_quote(ids['late_user_msg'])}, {sql_quote(ids['late_artifact'])}, 'user', '请生成投资报告', '', '[]', '[]', '[]', 8, 0, 8, null, '', null, {sql_quote(now)}),
        ({sql_quote(ids['late_assistant_msg'])}, {sql_quote(ids['late_artifact'])}, 'assistant', '报告生成中，稍后归档。', '', '[]', '[]', '[]', 0, 12, 12, {sql_quote(employee['id'])}, {sql_quote(employee['display_name'])}, 0, {sql_quote(now)}),
        ({sql_quote(ids['old_user_msg'])}, {sql_quote(ids['old_message'])}, 'user', 'OLD_MESSAGE_SHOULD_NOT_LEAK', '', '[]', '[]', '[]', 6, 0, 6, null, '', null, {sql_quote(now)});
        commit;
        """
    )
    ids["tenant_id"] = str(user["tenant_id"])
    ids["user_id"] = str(user["id"])
    ids["employee_id"] = str(employee["id"])
    ids["assistant_msg_id"] = ids["late_assistant_msg"]
    return ids


def insert_late_artifact(ids: dict[str, str]) -> str:
    artifact_id = str(uuid.uuid4())
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    run_sql(
        f"""
        insert into task_artifacts (
          id, tenant_id, user_id, session_id, message_id, kind, name, mime_type, content,
          source, source_path, storage_path, storage_size, managed_status, run_id, employee_id,
          version, provenance_payload, status, archived, created_at
        ) values (
          {sql_quote(artifact_id)}, {sql_quote(ids['tenant_id'])}, {sql_quote(ids['user_id'])},
          {sql_quote(ids['late_artifact'])}, {sql_quote(ids['assistant_msg_id'])}, 'html',
          'state-machine-late-artifact.html', 'text/html;charset=utf-8',
          '<!doctype html><html><body><h1>Late Artifact</h1></body></html>',
          'reconcile', '', '', 0, 'pending', null, {sql_quote(ids['employee_id'])},
          1, '{{}}', 'active', 0, {sql_quote(now)}
        );
        """
    )
    return artifact_id


def main() -> None:
    token = login()
    ids = seed()
    try:
        sessions = request("GET", "/sessions", token=token)["items"]
        visible_ids = {item["id"] for item in sessions}
        assert ids["running"] in visible_ids, "empty running session should remain visible"
        assert ids["completed_empty"] in visible_ids, "empty completed session should remain visible"

        sessions_again = request("GET", "/sessions", token=token)["items"]
        visible_again = {item["id"]: item for item in sessions_again}
        assert ids["running"] in visible_again, "running session disappeared after reconnect-style list reload"
        assert visible_again[ids["running"]]["task_status"] == "running", visible_again[ids["running"]]

        empty_msgs = request("GET", f"/sessions/{ids['completed_empty']}/messages", token=token)["items"]
        assert empty_msgs == [], f"empty completed session returned unexpected messages: {empty_msgs}"
        empty_detail = request("GET", f"/sessions/{ids['completed_empty']}", token=token)
        assert "OLD_MESSAGE_SHOULD_NOT_LEAK" not in json.dumps(empty_detail, ensure_ascii=False)

        before = request("GET", f"/sessions/{ids['late_artifact']}/artifacts", token=token)["items"]
        assert before == [], f"late artifact fixture should start empty: {before}"
        artifact_id = insert_late_artifact(ids)
        after = request("GET", f"/sessions/{ids['late_artifact']}/artifacts", token=token)["items"]
        assert any(item["id"] == artifact_id for item in after), "late artifact was not discoverable"

        print(json.dumps({
            "ok": True,
            "checks": [
                "empty running/completed sessions visible",
                "reconnect reads keep the same running session",
                "empty completed messages do not reuse old session text",
                "late artifact discoverable through session artifacts API",
            ],
            "session_ids": {
                "running": ids["running"],
                "completed_empty": ids["completed_empty"],
                "late_artifact": ids["late_artifact"],
            },
        }, ensure_ascii=False, indent=2))
    finally:
        cleanup()


if __name__ == "__main__":
    main()
