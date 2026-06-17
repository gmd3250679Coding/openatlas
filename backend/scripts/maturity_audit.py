"""OpenAtlas product maturity audit.

This is intentionally stricter than smoke/E2E. A green quality gate means the
main paths work; it does not mean the product is 90/100 mature. This script
scores the product across the nine dimensions used in product reviews and
writes a report that explains the evidence and gaps.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "output" / "maturity"
BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58003/api").rstrip("/")
EMAIL = os.environ.get("OPENATLAS_EMAIL", "admin@demo.openatlas")
PASSWORD = os.environ.get("OPENATLAS_PASSWORD", "openatlas")
TARGET = int(os.environ.get("OPENATLAS_MATURITY_TARGET", "90"))
MIN_PASS = int(os.environ.get("OPENATLAS_MATURITY_MIN", "70"))


class ProbeError(RuntimeError):
    pass


def request(method: str, path: str, body: object | None = None, token: str | None = None, timeout: int = 20) -> Any:
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
        raise ProbeError(f"{method} {path} -> HTTP {exc.code}: {detail[:500]}") from exc


def read_text(path: Path) -> str:
    try:
        return path.read_text("utf-8", errors="ignore")
    except FileNotFoundError:
        return ""


def has(path: str) -> bool:
    return (ROOT / path).exists()


def grep(path: str, pattern: str) -> bool:
    return re.search(pattern, read_text(ROOT / path), re.I | re.S) is not None


def report_issue_counts(name: str) -> dict[str, int]:
    text = read_text(ROOT / "output" / "playwright" / name)
    match = re.search(r"P0=(\d+),\s*P1=(\d+),\s*P2=(\d+),\s*P3=(\d+)", text)
    if not match:
        return {"P0": 0, "P1": 0, "P2": 0, "P3": 0, "missing": 1}
    return {"P0": int(match.group(1)), "P1": int(match.group(2)), "P2": int(match.group(3)), "P3": int(match.group(4)), "missing": 0}


def pct(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def count_value(container: Any, key: str) -> int:
    if not isinstance(container, dict):
        return 0
    value = container.get(key)
    if isinstance(value, list):
        return len(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def cap(score: int, ceiling: int) -> int:
    return min(score, ceiling)


def weighted_average(items: list[dict[str, Any]]) -> int:
    total_weight = sum(int(item["weight"]) for item in items) or 1
    return round(sum(int(item["score"]) * int(item["weight"]) for item in items) / total_weight)


def login() -> str:
    data = request("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    token = data.get("access_token")
    if not token:
        raise ProbeError("login succeeded without access_token")
    return token


def build_scores(token: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    evidence: dict[str, Any] = {}
    caps = request("GET", "/capabilities", token=token)
    features = caps.get("features", {})
    tenant = request("GET", "/dashboard/tenant", token=token)
    runtime = request("GET", "/runtime/health", token=token)
    identity = request("GET", "/admin/identity/overview", token=token)
    market = request("GET", "/skill-market", token=token)
    sessions = request("GET", "/sessions", token=token)
    run_queue = request("GET", "/run-queue", token=token)
    latest_session_id = ""
    latest_runs: dict[str, Any] = {}
    latest_replay: dict[str, Any] = {}
    if isinstance(sessions.get("items"), list):
        for item in sessions["items"][:20]:
            sid = str(item.get("id") or "")
            if not sid:
                continue
            try:
                probe_runs = request("GET", f"/sessions/{sid}/runs", token=token)
                probe_replay = request("GET", f"/sessions/{sid}/replay", token=token)
            except Exception:
                continue
            if probe_runs.get("items") or probe_replay.get("workflow_run"):
                latest_session_id = sid
                latest_runs = probe_runs
                latest_replay = probe_replay
                break
    if latest_session_id and not latest_runs:
        try:
            latest_runs = request("GET", f"/sessions/{latest_session_id}/runs", token=token)
            latest_replay = request("GET", f"/sessions/{latest_session_id}/replay", token=token)
        except Exception:
            latest_runs = {}
            latest_replay = {}
    product_issues = report_issue_counts("product-audit-report.md")
    power_issues = report_issue_counts("power-user-audit-report.md")

    evidence.update({
        "runtime": runtime,
        "capability_features": {k: features.get(k) for k in sorted(features) if k in {
            "run_events_sse", "run_approval_response", "approval_events", "skills_api",
            "session_chat_streaming", "session_fork", "tool_progress_events",
        }},
        "tenant_maturity": tenant.get("maturity"),
        "identity_counts": {
            "tenants": count_value(identity, "tenants"),
            "users": count_value(identity, "users"),
            "org_units": count_value(identity, "org_units"),
        },
        "skill_market_count": len(market.get("items", [])),
        "session_count": len(sessions.get("items", [])),
        "run_queue_count": len(run_queue.get("items", [])),
        "latest_session_run_count": len(latest_runs.get("items", [])) if isinstance(latest_runs, dict) else 0,
        "latest_session_replay": {
            "has_workflow": bool((latest_replay or {}).get("workflow_run")),
            "runs": len((latest_replay or {}).get("runs") or []),
            "artifacts": len((latest_replay or {}).get("artifacts") or []),
            "events": len((latest_replay or {}).get("events") or []),
        },
        "product_audit_issues": product_issues,
        "power_user_audit_issues": power_issues,
    })

    app_py = "backend/app/main.py"
    cmd = "frontend/src/pages/CommandCenter.tsx"
    right = "frontend/src/components/RightAside.tsx"
    skill_page = "frontend/src/pages/SkillMarket.tsx"
    dashboard = "frontend/src/pages/Dashboard.tsx"

    dimensions: list[dict[str, Any]] = []

    core_score = 72
    if has("docs/product/DIGITAL-WORKFORCE-CATALOG.md"):
        core_score += 4
    if grep(cmd, r"Digital Workforce|数智员工|工作台|Atlas"):
        core_score += 3
    if has("outputs/product-function-inventory/OpenAtlas_产品功能清单_2026-06-16.xlsx"):
        core_score += 2
    dimensions.append({
        "name": "核心定位",
        "weight": 10,
        "score": cap(core_score, 82),
        "judgement": "方向清楚，已经不是普通聊天壳；但价值主张、套餐边界、可售卖场景还需要更强产品化。",
        "evidence": ["数智员工目录、工作台、功能清单已存在"],
        "gaps": ["缺少面向企业采购的角色价值路径、ROI/合规叙事和行业化落地包"],
    })

    chat_score = 62
    if grep("frontend/e2e/main-chain.spec.ts", r"DOCX upload|group relay|Skill binding|template reuse"):
        chat_score += 8
    if grep(app_py, r"openatlas\.run_detached|_schedule_detached_run_reconcile|recover_session"):
        chat_score += 7
    if grep(app_py, r"class SessionRun|session_runs|/sessions/\{sid\}/runs|waiting_approval|waiting_input"):
        chat_score += 4
    if grep(app_py, r"workflow_node_action|retry_requested|continue_requested"):
        chat_score += 2
    if grep(cmd, r"approval_required|pendingApproval|仅本次允许"):
        chat_score += 5
    if grep(right, r"会话健康|补同步 / 恢复会话|输出物"):
        chat_score += 4
    dimensions.append({
        "name": "主聊天链路",
        "weight": 15,
        "score": cap(chat_score, 87),
        "judgement": "单员工、文件、Skill、群聊接力和恢复入口已可用；已补会话运行状态机，但长任务续跑还需更多真实样本。",
        "evidence": ["main-chain E2E 覆盖登录、附件、历史、群聊、Skill、模板", "SessionRun 已记录 running/completed/waiting 等状态"],
        "gaps": ["缺少长任务分段续跑与明确任务检查点", "审批状态机已起步，但还缺高危工具固定回归夹具"],
    })

    hermes_score = 58
    hermes_score += 5 if features.get("run_events_sse") else 0
    hermes_score += 5 if features.get("run_approval_response") else 0
    hermes_score += 5 if features.get("skills_api") else 0
    hermes_score += 5 if grep(app_py, r"stream_run_events|respond_run_approval|stop_run") else 0
    hermes_score += 3 if grep(app_py, r"SessionRun|hermes_run_id|openatlas\.approval_required") else 0
    hermes_score += 4 if grep(app_py, r"_sync_installed_hermes_skills|_run_hermes_skills_install") else 0
    dimensions.append({
        "name": "Hermes 集成",
        "weight": 15,
        "score": cap(hermes_score, 82),
        "judgement": "Gateway、Run Events、Skills、审批和工具事件都接进来了；但仍需要更强的 Hermes 行为兜底和事件一致性验证。",
        "evidence": [f"capabilities: {evidence['capability_features']}"],
        "gaps": ["缺少真实高危工具审批的固定回归样例", "Run Events 空窗后的后台补同步还需要更多业务样本验证"],
    })

    file_score = 60
    file_score += 6 if grep(app_py, r"_artifact_provenance|context_counts|context_items") else 0
    file_score += 5 if grep(app_py, r"_artifact_from_path|_tool_artifacts_from_payload|_wrap_html_artifact") else 0
    file_score += 5 if grep("backend/scripts/api_smoke.py", r"pptx|openatlas-api-smoke.md|extracted_chars") else 0
    file_score += 4 if grep(app_py, r"source_path|version|provenance_payload|_next_artifact_version") else 0
    file_score += 3 if grep(app_py, r"patch_artifact|artifact.update|status.*final") and grep(right, r"标记为终稿|重命名交付物|v\\{f.version") else 0
    file_score += 3 if grep(right, r"归档交付物|artifactMeta|Query:") else 0
    dimensions.append({
        "name": "文件与交付物",
        "weight": 12,
        "score": cap(file_score, 85),
        "judgement": "文件提取、HTML/Markdown 交付物、来源追踪、版本和运行归属已成型；预览和归档后的检索还没完全产品化。",
        "evidence": ["artifact provenance 已返回来源员工、Query、上下文计数", "交付物已记录 source_path/version/run_id/employee_id"],
        "gaps": ["PDF/Excel/TXT/Markdown/HTML 预览体验仍需要持续肉眼 QA", "交付物重新生成、归档后的检索和二次编辑还弱"],
    })

    canvas_score = 55
    canvas_score += 8 if grep("frontend/e2e/canvas-main-chain.spec.ts", r"save reusable collaboration plan|verify persistence") else 0
    canvas_score += 6 if grep(app_py, r"collaboration_plan|save-template|canvas-state") else 0
    canvas_score += 4 if grep("frontend/src/components/CollaborationCanvas.tsx", r"failureStrategy|outputType|defaultPrompt|skills") else 0
    canvas_score += 8 if grep(app_py, r"WorkflowRun|WorkflowNodeRun|/sessions/\{sid\}/replay|_update_workflow_node_run") else 0
    canvas_score += 3 if grep(cmd, r"协作执行回放|节点执行|本次交付物") else 0
    canvas_score += 4 if grep(cmd, r"从此继续|重试节点|handleWorkflowNodeAction") and grep(app_py, r"workflow_node_action") else 0
    canvas_score += 5 if grep(app_py, r"WorkflowStepEvent|WorkflowCheckpoint|WorkflowRunFork|resume_workflow_checkpoint") and grep(cmd, r"展开步骤|从这里恢复执行") else 0
    canvas_score += 4 if grep(app_py, r"workflow_step_action|WorkflowStepActionIn|tool\.\{action\}_requested") and grep(cmd, r"handleWorkflowStepAction|重试工具|跳过继续") else 0
    dimensions.append({
        "name": "协作画布",
        "weight": 10,
        "score": cap(canvas_score, 90),
        "judgement": "画布能配置、保存、复用，已具备节点级 Step Timeline、Checkpoint、Replay Fork 和工具步骤恢复入口；但并行/合流、变量映射仍未成熟。",
        "evidence": ["Canvas E2E 覆盖打开、配置节点、保存方案、复用方案", "WorkflowRun/WorkflowNodeRun/WorkflowStepEvent 已记录节点执行证据"],
        "gaps": ["缺少真实并行/合流语义、变量映射和输入输出契约", "Checkpoint/工具恢复已起步，但还需要更多真实长任务样本验证"],
    })

    skill_score = 60
    skill_score += 5 if grep(skill_page, r"风险等级|risk|version|binding_count|health") else 0
    skill_score += 5 if grep(app_py, r"input_example|output_example|risk_level|suitable_employees") else 0
    skill_score += 5 if grep(app_py, r"missing_in_hermes|skill_failure_rate|_find_hermes_skill_md") else 0
    skill_score += 4 if grep(skill_page, r"SkillGovernanceDrawer|治理建议|绑定影响|详情/治理") else 0
    skill_score += 4 if grep("frontend/src/pages/EmployeeDetail.tsx", r"selectedBindingSkill|能力说明|输入示例|输出示例|失败率") else 0
    dimensions.append({
        "name": "Skill 管理",
        "weight": 10,
        "score": cap(skill_score, 82),
        "judgement": "Skill Market、Hub 筛选、绑定、健康检查和治理详情已具备；版本升级/回滚和风险策略还要继续产品化。",
        "evidence": [f"Skill Market 当前 {evidence['skill_market_count']} 条"],
        "gaps": ["缺少版本升级/回滚策略", "Skill 风险策略、灰度发布和批量治理还需补齐"],
    })

    enterprise_score = 56
    enterprise_score += 6 if grep("frontend/src/pages/IdentityAdmin.tsx", r"租户|组织|用户|权限|隔离") else 0
    enterprise_score += 5 if grep(dashboard, r"产品成熟度|Runtime|Skill 失败率|任务交付物") else 0
    enterprise_score += 5 if grep(app_py, r"AuditLog|audit[(]|dashboard_tenant|tenant_isolation") else 0
    enterprise_score += 4 if has("backend/scripts/isolation_smoke.py") else 0
    dimensions.append({
        "name": "企业管理",
        "weight": 10,
        "score": cap(enterprise_score, 76),
        "judgement": "租户、组织、用户、审计、Dashboard 都有框架；但离成熟后台还有权限粒度、策略、导出和运营动作差距。",
        "evidence": [f"identity counts: {evidence['identity_counts']}"],
        "gaps": ["缺少 SSO/LDAP、角色模板、资源级授权策略", "审计导出和按资源追踪还需更强交互闭环"],
    })

    stability_score = 58
    stability_score += 6 if has("backend/scripts/api_smoke.py") else 0
    stability_score += 6 if has("backend/scripts/isolation_smoke.py") else 0
    stability_score += 6 if grep("frontend/e2e/product-audit.spec.ts", r"requestfailed|pageerror|overflowX|iconButtonsWithoutName") else 0
    stability_score += 5 if product_issues["P0"] == 0 and power_issues["P0"] == 0 else -8
    stability_score += 4 if grep(app_py, r"_session_health_snapshot|_watch_detached_run|recover_session") else 0
    stability_score += 4 if grep("backend/scripts/api_smoke.py", r"/sessions/\{sid\}/runs|/sessions/\{sid\}/replay|session runs") else 0
    stability_score += 2 if grep("backend/scripts/api_smoke.py", r"workflow-nodes|node_action") else 0
    stability_score += 2 if grep("backend/scripts/api_smoke.py", r"workflow-steps|step_action_route") and grep(app_py, r"workflow_step_action") else 0
    stability_score += 3 if grep("backend/scripts/api_smoke.py", r"step_count|checkpoint_count|checkpoint_resume") and grep(app_py, r"status=\"stalled\"|checkpoint_type=\"stalled\"") else 0
    dimensions.append({
        "name": "稳定性/鲁棒性",
        "weight": 13,
        "score": cap(stability_score, 89),
        "judgement": "自动化、隔离、健康检查、补同步和运行状态落库已经是明显进步；但异常矩阵和高危审批回归仍不够厚。",
        "evidence": [f"product audit issues: {product_issues}", f"power audit issues: {power_issues}"],
        "gaps": ["缺少 chaos/fault injection", "缺少真实长任务多轮连续样本和高危工具授权回归夹具"],
    })

    ux_score = 58
    ux_score += 5 if grep(cmd, r"liquid|glass|quick|dock|全部历史") else 0
    ux_score += 5 if product_issues["P1"] == 0 else -5
    ux_score += 4 if power_issues["P1"] == 0 else -5
    ux_score += 3 if grep(right, r"当前会话进展|本轮上下文|输出物|员工详情") else 0
    ux_score += 2 if grep(cmd, r"协作执行回放|节点执行|任务运行状态") else 0
    ux_score += 2 if grep(cmd, r"从此继续|重试节点") and grep(right, r"标记为终稿|重命名交付物") else 0
    dimensions.append({
        "name": "产品体验",
        "weight": 5,
        "score": cap(ux_score, 79),
        "judgement": "首页、右侧栏、画布、宠物和 Dock 有记忆点；协作回放增强了任务可解释性，但高级用户效率还没完全收敛。",
        "evidence": ["产品巡检和重度用户巡检未发现规则内 P0/P1"],
        "gaps": ["需要更多真实用户任务走查", "首页、历史、工作区、任务队列的心智还需持续统一"],
    })

    return dimensions, evidence


def write_reports(result: dict[str, Any]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "maturity-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
    lines = [
        "# OpenAtlas 产品成熟度评估",
        "",
        f"生成时间: {result['generated_at']}",
        f"目标分: {TARGET}",
        f"当前综合分: {result['overall']}",
        f"结论: {result['verdict']}",
        "",
        "## 维度评分",
        "",
        "| 维度 | 权重 | 分数 | 判断 |",
        "|---|---:|---:|---|",
    ]
    for item in result.get("dimensions", []):
        lines.append(f"| {item['name']} | {item['weight']} | {item['score']} | {item['judgement']} |")
    lines.extend(["", "## 关键缺口", ""])
    for item in result.get("dimensions", []):
        if item["score"] < 80:
            lines.append(f"### {item['name']} ({item['score']})")
            for gap in item["gaps"]:
                lines.append(f"- {gap}")
            lines.append("")
    if result.get("error"):
        lines.extend(["### 评估失败", "", str(result["error"]), ""])
    lines.extend(["## 支撑证据", "", "```json", json.dumps(result.get("evidence", {}), ensure_ascii=False, indent=2)[:6000], "```", ""])
    (OUT_DIR / "maturity-audit-report.md").write_text("\n".join(lines), "utf-8")


def main() -> int:
    started = time.time()
    try:
        token = login()
        dimensions, evidence = build_scores(token)
        overall = weighted_average(dimensions)
        verdict = "未达到 90 分成熟度"
        if overall >= TARGET and all(item["score"] >= 85 for item in dimensions):
            verdict = "达到目标成熟度"
        elif overall >= 80:
            verdict = "接近企业试点成熟，但未到 90"
        result = {
            "ok": overall >= MIN_PASS,
            "target": TARGET,
            "minimum_pass": MIN_PASS,
            "overall": overall,
            "verdict": verdict,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "duration_ms": int((time.time() - started) * 1000),
            "dimensions": dimensions,
            "evidence": evidence,
            "report": str(OUT_DIR / "maturity-audit-report.md"),
        }
    except Exception as exc:  # noqa: BLE001
        result = {
            "ok": False,
            "target": TARGET,
            "minimum_pass": MIN_PASS,
            "overall": 0,
            "verdict": "成熟度评估失败",
            "error": str(exc),
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "duration_ms": int((time.time() - started) * 1000),
        }
    write_reports(result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
