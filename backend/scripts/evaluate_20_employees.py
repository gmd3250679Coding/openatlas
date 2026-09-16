"""Evaluate all 20 preset digital employees with lightweight business tasks.

This is a product-facing evaluation, not a load test. It creates one session per
employee, sends a compact realistic business prompt through the same SSE chat
endpoint used by the frontend, and records whether the employee gives a useful
role-appropriate answer.

Usage:
  OPENATLAS_API_BASE=http://127.0.0.1:58003/api \
  python3 backend/scripts/evaluate_20_employees.py

Useful env:
  OPENATLAS_EVAL_EMAIL=demo@demo.openatlas
  OPENATLAS_EVAL_PASSWORD=openatlas
  OPENATLAS_EVAL_IDS=行政小六,产品需求经理
  OPENATLAS_EVAL_STREAM_TIMEOUT=120
"""
from __future__ import annotations

import json
import hashlib
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
MATERIALS_DIR = ROOT / "demo-pack" / "materials"
REPORT_DIR = ROOT / "outputs" / "employee-evaluation"

BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58003/api").rstrip("/")
EMAIL = os.environ.get("OPENATLAS_EVAL_EMAIL", os.environ.get("OPENATLAS_EMAIL", "demo@demo.openatlas"))
PASSWORD = os.environ.get("OPENATLAS_EVAL_PASSWORD", os.environ.get("OPENATLAS_PASSWORD", "openatlas"))
IDS = {x.strip() for x in os.environ.get("OPENATLAS_EVAL_IDS", "").split(",") if x.strip()}
STREAM_TIMEOUT = int(os.environ.get("OPENATLAS_EVAL_STREAM_TIMEOUT", "150"))
RECOVER_WAIT = int(os.environ.get("OPENATLAS_EVAL_RECOVER_WAIT", "45"))
DELAY_SECONDS = float(os.environ.get("OPENATLAS_EVAL_DELAY_SECONDS", "8"))
QUOTA_RETRIES = int(os.environ.get("OPENATLAS_EVAL_QUOTA_RETRIES", "1"))
QUOTA_RETRY_WAIT = float(os.environ.get("OPENATLAS_EVAL_QUOTA_RETRY_WAIT", "60"))
AUTO_APPROVE = (
    os.environ.get("OPENATLAS_EVAL_AUTO_APPROVE", "0") == "1"
    or os.environ.get("OPENATLAS_EVAL_AUTO_APPROVE_SAFE", "0") == "1"
)
AUTO_DENY_UNSAFE = os.environ.get("OPENATLAS_EVAL_AUTO_DENY_UNSAFE", "1") != "0"
ALLOWED_APPROVAL_ROOTS = [
    Path(p).expanduser().resolve()
    for p in os.environ.get("OPENATLAS_EVAL_APPROVAL_ROOTS", str(ROOT)).split(os.pathsep)
    if p.strip()
]

urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))


class EvalError(RuntimeError):
    pass


SCENARIOS: dict[str, dict[str, Any]] = {
    "行政小六": {
        "prompt": "我第一次使用 Atlas，想调研一个客户行业、做销售方案，还可能需要合同风险审查。请告诉我应该 @ 哪些数智员工，以及推荐的协作顺序。",
        "required": ["推荐", "员工", "顺序"],
        "sections": ["推荐", "顺序"],
    },
    "文档情报分析员": {
        "attachments": ["customer-brief.md"],
        "prompt": "请阅读附件客户简报，提取客户目标、关键事实、风险缺口和后续建议，输出一份可追溯的文档情报摘要。",
        "required": ["客户", "目标", "风险", "建议"],
        "sections": ["摘要", "事实", "风险"],
    },
    "投资研究分析师": {
        "prompt": "请基于以下模拟信息，为“云制造机器人 SaaS”做一页投资尽调初筛：ARR 1.2亿元，近三年收入复合增速42%，毛利率63%，净收入留存118%，现金余额2.4亿元，主要风险是大客户集中和工业场景交付周期长。请输出投资亮点、风险、待尽调问题和初步结论。",
        "required": ["投资", "风险", "尽调", "结论"],
        "sections": ["亮点", "风险", "问题", "结论"],
    },
    "财务经营分析师": {
        "attachments": ["sales-pipeline-q2.csv"],
        "prompt": "请基于附件销售管道数据，做 Q2 财务经营分析：关注收入质量、回款风险、毛利压力和管理动作。",
        "required": ["收入", "回款", "毛利", "风险"],
        "sections": ["摘要", "指标", "风险", "动作"],
    },
    "法务合规顾问": {
        "attachments": ["agency-contract-sample.md"],
        "prompt": "请审查附件代理合同样例，按高/中/低风险输出条款依据、业务影响、修改建议和需要人工复核的问题。",
        "required": ["合同", "风险", "条款", "修改"],
        "sections": ["高", "中", "建议", "复核"],
    },
    "市场竞品研究员": {
        "prompt": "请调研“企业数智员工调度平台”面向中小企业的市场机会。请输出客户痛点、竞品/替代方案、差异化机会、销售验证问题。",
        "required": ["市场", "竞品", "痛点", "机会"],
        "sections": ["痛点", "竞品", "机会", "验证"],
    },
    "销售方案顾问": {
        "attachments": ["customer-brief.md"],
        "prompt": "请基于附件客户简报，为客户设计一份 Atlas 试点销售方案，包含价值主张、试点范围、推进路径、异议处理和复核点。",
        "required": ["方案", "价值", "试点", "推进"],
        "sections": ["价值", "范围", "路径", "风险"],
    },
    "HR 招聘与员工服务专员": {
        "attachments": ["job-description.md", "candidate-shortlist.csv"],
        "prompt": "请基于附件 JD 和候选人清单，做候选人初筛排序，输出匹配依据、风险、面试问题和下一步安排。",
        "required": ["候选人", "JD", "排序", "面试"],
        "sections": ["排序", "依据", "风险", "问题"],
    },
    "运营增长顾问": {
        "prompt": "某 SaaS 产品 5 月活跃客户 180 家，续费到期客户 26 家，NPS 32，工单 SLA 达标率 86%，新手引导完成率 41%。请输出运营增长诊断、优先动作、负责人类型和验收指标。",
        "required": ["运营", "增长", "SLA", "指标"],
        "sections": ["诊断", "动作", "负责人", "验收"],
    },
    "项目交付经理": {
        "attachments": ["meeting-notes.md"],
        "prompt": "请把附件会议记录整理为项目闭环材料：管理层摘要、决议、行动清单、风险依赖、下次检查点。",
        "required": ["决议", "行动", "风险", "检查"],
        "sections": ["摘要", "决议", "行动", "风险"],
    },
    "翻书人 PageTurner": {
        "prompt": "请把这段论文摘要做成中文快读版：This paper proposes a multi-hazard coupling prediction framework for underground coal mines, integrating gas concentration, water inflow, roof pressure, microseismic signals, and ventilation parameters. The model uses temporal graph learning to identify cascading risk patterns and generate early-warning explanations for dispatchers. 请输出术语解释、研究问题、方法、价值和 HTML 快读版片段。",
        "required": ["煤矿", "多灾种", "快读", "HTML"],
        "sections": ["术语", "方法", "价值"],
    },
    "中国股市投资助手": {
        "prompt": "请以中国 A 股投资研究口径，基于以下模拟数据分析“云鼎科技 000409”：2025Q1 营收同比 +18%，归母净利同比 +22%，煤炭数字化订单增长较快，估值处于近三年中位数上方。请输出基本面、估值、催化、风险和免责声明。",
        "required": ["A股", "估值", "风险", "免责声明"],
        "sections": ["基本面", "估值", "催化", "风险"],
    },
    "数据洞察分析师": {
        "attachments": ["sales-pipeline-q2.csv"],
        "prompt": "请基于附件数据做销售漏斗洞察，输出关键指标、异常线索、分组对比和建议的可视化图表。",
        "required": ["数据", "指标", "异常", "图表"],
        "sections": ["指标", "异常", "对比", "建议"],
    },
    "办公自动化秘书": {
        "prompt": "请帮我写一份内部通知：下周三 14:00 召开数智员工试点复盘会，参会人包括销售、交付、法务、财务，要求会前提交问题清单。语气正式但不僵硬。",
        "required": ["通知", "时间", "参会", "提交"],
        "sections": ["主题", "时间", "要求"],
    },
    "客户成功经理": {
        "prompt": "客户 A 已上线 45 天，活跃用户 38/120，核心功能使用率 27%，提了 12 个工单，负责人担心试点价值不足。请输出客户健康度、续约风险、价值补救计划和沟通话术。",
        "required": ["客户", "健康", "续约", "话术"],
        "sections": ["健康", "风险", "计划", "话术"],
    },
    "采购供应链顾问": {
        "prompt": "公司准备采购 200 台边缘计算盒子，供应商甲报价低但交期 45 天，供应商乙价格高 12% 但交期 20 天且质保更长。请输出供应商对比、成本/交付/质量风险和推荐决策。",
        "required": ["采购", "供应商", "交付", "风险"],
        "sections": ["对比", "风险", "推荐"],
    },
    "风险内控审计员": {
        "prompt": "请审计这个流程风险：销售可直接承诺定制开发，交付排期由项目经理手工维护，合同模板由业务自行修改，回款节点未和验收里程碑绑定。请输出内控风险清单和整改建议。",
        "required": ["内控", "风险", "整改", "合同"],
        "sections": ["风险", "影响", "整改", "材料"],
    },
    "产品需求经理": {
        "prompt": "请为 Atlas 首页“@员工启动任务 + 历史会话快速恢复”写一份 PRD 初稿，包含目标用户、问题、用户故事、验收标准、埋点指标和风险。",
        "required": ["PRD", "用户故事", "验收", "指标"],
        "sections": ["目标", "用户故事", "验收", "风险"],
    },
    "知识库与培训专员": {
        "attachments": ["meeting-notes.md"],
        "prompt": "请把附件会议记录沉淀为内部知识库条目和 5 道培训测验题，标注适用对象和来源范围。",
        "required": ["知识库", "培训", "测验", "来源"],
        "sections": ["条目", "FAQ", "测验", "适用"],
    },
    "高管简报秘书": {
        "prompt": "请把这段信息压缩成高管简报：Atlas 试点一周内完成 20 个预制员工、Skill Market、文件预览、输出物归档和作战室，但长任务反馈、用户记忆、外部 Skill 质量和移动端兼容仍需打磨。请输出一句话结论、决策选项、风险和下周动作。",
        "required": ["高管", "结论", "决策", "风险"],
        "sections": ["一句话", "选项", "风险", "动作"],
    },
}


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
        raise EvalError(f"{method} {path} -> HTTP {exc.code}: {detail[:500]}") from exc


def login() -> str:
    return request("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})["access_token"]


def approval_command(payload: dict[str, Any]) -> str:
    for key in ("command", "preview", "description", "label"):
        value = payload.get(key)
        if value:
            return str(value)
    return ""


def is_project_safe_approval(payload: dict[str, Any]) -> tuple[bool, str]:
    """Auto-approve only small, project-scoped compute approvals.

    The evaluator is allowed to act like a human tester, but it must not approve
    commands that can mutate the host or touch unrelated files. Anything outside
    this narrow guard remains a manual product issue and is recorded.
    """
    command = approval_command(payload)
    tool_name = str(payload.get("tool") or payload.get("tool_name") or "").lower()
    lowered = command.lower()
    padded = f" {lowered} "
    dangerous_terms = (
        " rm ", "rm -", "sudo", "chmod", "chown", "mkfs", " dd ",
        "shutil.rmtree", "os.remove", "unlink(", "rmdir(", "subprocess",
        "requests.", "urllib.", "socket.", "curl ", "wget ", "scp ", "ssh ",
        "path.home", "~/", "/etc/", "/var/", "/system/", "/library/",
        "/applications/", "/users/macbook/.ssh", "/users/macbook/.aws",
        "/users/macbook/.config",
    )
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


def approve_if_safe(token: str, payload: dict[str, Any]) -> dict[str, Any]:
    safe, reason = is_project_safe_approval(payload)
    run_id = str(payload.get("hermes_run_id") or payload.get("run_id") or "")
    approval_id = payload.get("approval_id")
    if not AUTO_APPROVE:
        return {"approved": False, "reason": "auto_approve_disabled", "safe": safe}
    if not run_id:
        return {"approved": False, "reason": "missing_run_id", "safe": safe}
    if not safe:
        if AUTO_DENY_UNSAFE:
            response = request(
                "POST",
                f"/hermes-runs/{urllib.parse.quote(run_id)}/approval",
                {"choice": "deny", "approval_id": approval_id},
                token=token,
                timeout=45,
            )
            return {"approved": False, "denied": True, "reason": reason, "safe": False, "response": response}
        return {"approved": False, "reason": reason, "safe": False}
    response = request(
        "POST",
        f"/hermes-runs/{urllib.parse.quote(run_id)}/approval",
        {"choice": "once", "approval_id": approval_id},
        token=token,
        timeout=45,
    )
    return {"approved": True, "reason": reason, "safe": True, "response": response}


def upload_file(token: str, session_id: str, filename: str) -> dict:
    path = MATERIALS_DIR / filename
    if not path.exists():
        raise EvalError(f"missing material: {filename}")
    data = path.read_bytes()
    boundary = "----OpenAtlasEmployeeEval" + uuid.uuid4().hex
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {guess_content_type(path)}\r\n\r\n"
    ).encode("utf-8")
    payload = head + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        BASE + f"/files/upload?session_id={urllib.parse.quote(session_id)}",
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
    return {
        ".md": "text/markdown; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pdf": "application/pdf",
    }.get(path.suffix.lower(), "application/octet-stream")


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


def chat_stream(token: str, session_id: str, prompt: str, attachment_ids: list[str]) -> dict:
    body = {"message": prompt, "attachment_ids": attachment_ids}
    req = urllib.request.Request(
        BASE + f"/sessions/{session_id}/chat/stream",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    events: list[str] = []
    text_parts: list[str] = []
    speakers: list[str] = []
    files: list[dict] = []
    tool_events: list[dict] = []
    last_tool_by_run: dict[str, str] = {}
    handled_approvals: set[str] = set()
    started = time.time()
    with urllib.request.urlopen(req, timeout=STREAM_TIMEOUT + 30) as resp:
        for ev in parse_sse(resp):
            event_name = ev["event"]
            data = ev["data"] or {}
            events.append(event_name)
            if event_name == "openatlas.files" and isinstance(data, dict):
                files = data.get("items") or []
            if event_name == "agent_join" and isinstance(data, dict):
                speakers.append(str(data.get("speaker_name") or data.get("speaker_employee_id") or ""))
            if event_name in {"assistant.delta", "message.delta"} and isinstance(data, dict):
                text_parts.append(str(data.get("delta") or data.get("content") or data.get("text") or ""))
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
            if event_name.startswith(("tool", "openatlas.approval", "hermes", "run.")) or event_name in {"error", "openatlas.run_idle", "openatlas.run_detached"}:
                tool_events.append({"event": event_name, "data": data})
                if event_name == "openatlas.approval_required" and isinstance(data, dict):
                    approval_command_digest = hashlib.sha256(
                        approval_command(data).encode("utf-8", errors="ignore")
                    ).hexdigest()[:16]
                    approval_key = str(
                        data.get("approval_id")
                        or f"{data.get('hermes_run_id') or data.get('run_id') or ''}:{data.get('tool_name') or data.get('tool') or ''}:{approval_command_digest}"
                    )
                    if approval_key and approval_key in handled_approvals:
                        result = {"approved": False, "reason": "already_approved_for_run", "safe": True}
                    else:
                        try:
                            result = approve_if_safe(token, data)
                            if result.get("approved") and approval_key:
                                handled_approvals.add(approval_key)
                        except Exception as exc:  # noqa: BLE001
                            result = {"approved": False, "reason": f"approval_call_failed:{exc}", "safe": False}
                    tool_events.append({"event": "openatlas.eval_approval_guard", "data": result})
            if event_name in {"done", "error"}:
                break
            if time.time() - started > STREAM_TIMEOUT:
                tool_events.append({"event": "eval.timeout", "data": {"timeout_s": STREAM_TIMEOUT}})
                break
    return {
        "events": events,
        "assistant_text": "".join(text_parts),
        "speakers": [x for x in speakers if x],
        "files": files,
        "tool_events": tool_events[:40],
        "duration_ms": int((time.time() - started) * 1000),
    }


def collect_outputs(token: str, session_id: str) -> dict:
    deadline = time.time() + RECOVER_WAIT
    detail: dict[str, Any] = {}
    messages: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    terminal_statuses = {"completed", "failed", "needs_input", "stopped", "cancelled"}
    background_statuses = {"running", "stalled", "waiting_approval", "waiting_input"}
    while True:
        try:
            request("POST", f"/sessions/{urllib.parse.quote(session_id)}/recover", token=token, timeout=45)
        except Exception:
            pass
        try:
            detail = request("GET", f"/sessions/{session_id}", token=token, timeout=30)
        except Exception:
            detail = {}
        try:
            messages = request("GET", f"/sessions/{session_id}/messages", token=token, timeout=30).get("items", [])
        except Exception:
            messages = []
        try:
            artifacts = request("GET", f"/artifacts?session_id={urllib.parse.quote(session_id)}&limit=20", token=token, timeout=30).get("items", [])
        except Exception:
            artifacts = []
        assistant_text = "\n\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "assistant")
        status = str(detail.get("task_status") or detail.get("progress", {}).get("status") or "")
        text_ready = len(assistant_text.strip()) >= 260
        artifact_ready = bool(artifacts)
        if status in terminal_statuses:
            if status == "completed" and not text_ready and not artifact_ready and time.time() <= deadline:
                time.sleep(5)
                continue
            break
        if status not in background_statuses and (text_ready or artifact_ready):
            break
        if time.time() > deadline:
            break
        time.sleep(5)
    return {"detail": detail, "messages": messages, "artifacts": artifacts}


def score_result(scenario: dict, stream: dict, outputs: dict) -> dict:
    persisted = "\n\n".join(
        str(m.get("content") or "")
        for m in outputs.get("messages", [])
        if m.get("role") == "assistant"
    )
    stream_text = str(stream.get("assistant_text") or "").strip()
    persisted_text = persisted.strip()
    text = persisted_text if len(persisted_text) >= len(stream_text) else stream_text
    lower = text.lower()
    required = scenario.get("required", [])
    sections = scenario.get("sections", [])
    hits = [term for term in required if str(term).lower() in lower]
    section_hits = [term for term in sections if str(term).lower() in lower]
    reasons: list[str] = []
    score = 0
    if len(text) >= 180:
        score += 20
    else:
        reasons.append("输出过短")
    if required:
        ratio = len(hits) / len(required)
        score += int(30 * ratio)
        if ratio < 0.75:
            reasons.append("关键业务词覆盖不足")
    else:
        score += 30
    if sections:
        ratio = len(section_hits) / len(sections)
        score += int(25 * ratio)
        if ratio < 0.5:
            reasons.append("结构化章节不足")
    else:
        score += 25
    if scenario.get("attachments"):
        if len(stream.get("files") or []) >= len(scenario.get("attachments") or []):
            score += 15
        else:
            reasons.append("附件上下文未完整注入")
    else:
        score += 15
    bad_phrases = ["看不到文件", "无法读取文件", "没有收到文件", "请重新上传", "<system_prompt>", "<file_context>"]
    if any(p.lower() in lower for p in bad_phrases):
        reasons.append("出现文件不可见或内部上下文泄露风险")
    else:
        score += 10
    if any(item.get("event") == "error" for item in stream.get("tool_events", [])):
        reasons.append("SSE 出现 error 事件")
    if any(item.get("event") == "eval.timeout" for item in stream.get("tool_events", [])):
        reasons.append("流式等待超时")
    status = str(outputs.get("detail", {}).get("task_status") or "")
    ok = score >= 70 and not any("error" in reason.lower() or "超时" in reason for reason in reasons)
    return {
        "score": max(0, min(score, 100)),
        "ok": ok,
        "task_status": status,
        "required_hits": hits,
        "section_hits": section_hits,
        "reasons": reasons,
        "assistant_chars": len(text),
        "assistant_excerpt": text[:1200],
    }


def run_employee(token: str, emp: dict, scenario: dict) -> dict:
    session = request("POST", "/sessions", {
        "employee_id": emp["id"],
        "title": f"员工评测-{emp['display_name']}-{uuid.uuid4().hex[:6]}",
    }, token=token, timeout=45)
    sid = session["id"]
    attachments = []
    for filename in scenario.get("attachments", []):
        attachments.append(upload_file(token, sid, filename))
    stream = chat_stream(token, sid, scenario["prompt"], [item["id"] for item in attachments])
    outputs = collect_outputs(token, sid)
    score = score_result(scenario, stream, outputs)
    return {
        "employee_id": emp["id"],
        "employee": emp["display_name"],
        "session_id": sid,
        "prompt": scenario["prompt"],
        "attachments": [a.get("original_name") or a.get("name") for a in attachments],
        "stream": stream,
        "artifacts": outputs.get("artifacts", []),
        "score": score,
    }


def has_quota_error(result: dict[str, Any]) -> bool:
    for item in result.get("stream", {}).get("tool_events", []):
        data = item.get("data") if isinstance(item.get("data"), dict) else {}
        message = str(data.get("message") or data.get("error") or "")
        if "429" in message or "quota exhausted" in message.lower():
            return True
    return False


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    token = login()
    employees = request("GET", "/employees", token=token, timeout=45)["items"]
    by_name = {e["display_name"]: e for e in employees}
    names = [name for name in SCENARIOS if (not IDS or name in IDS)]
    results: list[dict[str, Any]] = []
    print(f"OpenAtlas 20-employee evaluation: {BASE}")
    for index, name in enumerate(names, 1):
        emp = by_name.get(name)
        if not emp:
            result = {"employee": name, "ok": False, "error": "employee not found"}
        else:
            print(f"[{index:02d}/{len(names)}] {name}", flush=True)
            started = time.time()
            try:
                result = run_employee(token, emp, SCENARIOS[name])
                for attempt in range(QUOTA_RETRIES):
                    if not has_quota_error(result):
                        break
                    wait_s = QUOTA_RETRY_WAIT * (attempt + 1)
                    print(f"  -> quota/rate limit, wait {wait_s:.0f}s then retry", flush=True)
                    time.sleep(wait_s)
                    result = run_employee(token, emp, SCENARIOS[name])
                result["elapsed_ms"] = int((time.time() - started) * 1000)
                mark = "OK" if result["score"]["ok"] else "WARN"
                print(f"  -> {mark} score={result['score']['score']} chars={result['score']['assistant_chars']} status={result['score']['task_status']}")
            except Exception as exc:  # noqa: BLE001
                result = {"employee": name, "ok": False, "error": str(exc)[:1000], "elapsed_ms": int((time.time() - started) * 1000)}
                print(f"  -> ERROR {result['error']}")
        results.append(result)
        if index < len(names) and DELAY_SECONDS > 0:
            time.sleep(DELAY_SECONDS)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    json_path = REPORT_DIR / f"employee-eval-{stamp}.json"
    md_path = REPORT_DIR / f"employee-eval-{stamp}.md"
    payload = {
        "base": BASE,
        "email": EMAIL,
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "results": results,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(payload), encoding="utf-8")
    ok_count = sum(1 for r in results if r.get("score", {}).get("ok"))
    print(f"report_json={json_path}")
    print(f"report_md={md_path}")
    print(f"passed={ok_count}/{len(results)}")
    return 0 if ok_count == len(results) else 2


def render_markdown(payload: dict[str, Any]) -> str:
    rows = [
        "# OpenAtlas 20 个数智员工实际表现评测",
        "",
        f"- API: `{payload['base']}`",
        f"- 账号: `{payload['email']}`",
        f"- 时间: {payload['generated_at']}",
        "",
        "| 员工 | 分数 | 状态 | 输出字数 | 主要问题 | 会话 |",
        "|---|---:|---|---:|---|---|",
    ]
    for item in payload["results"]:
        if "score" not in item:
            rows.append(f"| {item.get('employee')} | 0 | ERROR | 0 | {item.get('error','')} | |")
            continue
        score = item["score"]
        issues = "；".join(score.get("reasons") or []) or "无明显问题"
        rows.append(
            f"| {item['employee']} | {score['score']} | {score.get('task_status') or '-'} | "
            f"{score['assistant_chars']} | {issues} | `{item['session_id']}` |"
        )
    rows.extend(["", "## 输出摘录", ""])
    for item in payload["results"]:
        if "score" not in item:
            continue
        rows.extend([
            f"### {item['employee']} ({item['score']['score']}分)",
            "",
            f"会话: `{item['session_id']}`",
            "",
            item["score"].get("assistant_excerpt") or "_无可见输出_",
            "",
        ])
    return "\n".join(rows)


if __name__ == "__main__":
    raise SystemExit(main())
