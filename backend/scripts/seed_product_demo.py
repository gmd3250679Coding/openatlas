"""Seed OpenAtlas product-demo content through public APIs.

Usage:
  OPENATLAS_API_BASE=http://127.0.0.1:58103/api \
  python3 backend/scripts/seed_product_demo.py

The script is idempotent by business keys:
  - skills: slug
  - employees: display_name
  - templates: name
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CONTENT_FILE = ROOT / "demo-pack" / "seeds" / "openatlas-demo-content.json"
BASE = os.environ.get("OPENATLAS_API_BASE", "http://127.0.0.1:58103/api").rstrip("/")
EMAIL = os.environ.get("OPENATLAS_EMAIL", "admin@demo.openatlas")
PASSWORD = os.environ.get("OPENATLAS_PASSWORD", "openatlas")
DRY_RUN = os.environ.get("OPENATLAS_DEMO_DRY_RUN", "0") == "1"
CLEANUP = os.environ.get("OPENATLAS_DEMO_CLEANUP", "0") == "1"

urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))


class SeedError(RuntimeError):
    pass


def api(method: str, path: str, body: Any | None = None, token: str | None = None) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise SeedError(f"{method} {path} -> HTTP {exc.code}: {detail[:500]}") from exc


def login() -> str:
    out = api("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
    return out["access_token"]


def by_key(items: list[dict], key: str) -> dict[str, dict]:
    return {str(item.get(key) or ""): item for item in items if item.get(key)}


def ensure_skills(token: str, desired: list[dict]) -> dict[str, dict]:
    existing = by_key(api("GET", "/skill-market", token=token).get("items", []), "slug")
    out: dict[str, dict] = {}
    for skill in desired:
        slug = skill["slug"]
        if slug in existing:
            out[slug] = existing[slug]
            print(f"skill exists: {slug}")
            continue
        if DRY_RUN:
            print(f"would create skill: {slug}")
            out[slug] = {"id": f"dry-skill-{slug}", **skill}
            continue
        created = api("POST", "/skill-market", skill, token=token)
        out[slug] = created
        print(f"skill created: {slug} -> {created['id']}")
    return out


def ensure_employees(token: str, desired: list[dict], skills_by_slug: dict[str, dict]) -> dict[str, dict]:
    existing = by_key(api("GET", "/employees", token=token).get("items", []), "display_name")
    out: dict[str, dict] = {}
    for employee in desired:
        name = employee["display_name"]
        skill_ids = [
            skills_by_slug[slug]["id"]
            for slug in employee.get("skill_slugs", [])
            if slug in skills_by_slug
        ]
        payload = {
            "display_name": name,
            "avatar": employee.get("avatar", name[:1]),
            "description": employee.get("description", ""),
            "model": employee.get("model", "hermes-agent"),
            "provider": employee.get("provider", "hermes"),
            "temperature": employee.get("temperature", 0.4),
            "max_tokens": employee.get("max_tokens", 4096),
            "system_prompt": employee.get("system_prompt", ""),
            "toolsets": employee.get("toolsets", []),
            "initial_skill_ids": skill_ids,
        }
        if name in existing:
            emp = existing[name]
            out[name] = emp
            print(f"employee exists: {name}")
            if not DRY_RUN:
                patch_employee(token, emp["id"], payload)
                bind_missing_skills(token, emp["id"], skill_ids)
            continue
        if DRY_RUN:
            print(f"would create employee: {name}")
            out[name] = {"id": f"dry-employee-{name}", **payload}
            continue
        created = api("POST", "/employees", payload, token=token)
        out[name] = created
        print(f"employee created: {name} -> {created['id']}")
    return out


def patch_employee(token: str, employee_id: str, payload: dict) -> None:
    patch = {
        "description": payload["description"],
        "avatar": payload["avatar"],
        "model": payload["model"],
        "provider": payload["provider"],
        "temperature": payload["temperature"],
        "max_tokens": payload["max_tokens"],
        "system_prompt": payload["system_prompt"],
        "toolsets": payload["toolsets"],
    }
    api("PATCH", f"/employees/{employee_id}", patch, token=token)


def bind_missing_skills(token: str, employee_id: str, skill_ids: list[str]) -> None:
    existing = api("GET", f"/skill-bindings?target_type=employee&target_id={employee_id}", token=token).get("items", [])
    bound = {b.get("skill_id") for b in existing if b.get("enabled", True)}
    for skill_id in skill_ids:
        if skill_id in bound:
            continue
        api("POST", f"/skill-market/{skill_id}/bind", {
            "skill_id": skill_id,
            "target_type": "employee",
            "target_id": employee_id,
            "binding_mode": "inherited",
        }, token=token)
        print(f"skill bound: {skill_id} -> employee {employee_id}")


def ensure_templates(token: str, desired: list[dict], employees_by_name: dict[str, dict]) -> None:
    existing = by_key(api("GET", "/collaboration-templates", token=token).get("items", []), "name")
    for template in desired:
        name = template["name"]
        if name in existing:
            print(f"template exists: {name}")
            continue
        primary = employees_by_name.get(template["primary_employee"])
        if not primary:
            print(f"skip template missing primary employee: {name}")
            continue
        participants = [
            employees_by_name[p]["id"]
            for p in template.get("participants", [])
            if p in employees_by_name
        ]
        if DRY_RUN:
            print(f"would create template: {name}")
            continue
        session = api("POST", "/sessions", {
            "employee_id": primary["id"],
            "participant_ids": participants,
            "title": f"{name} 初始化",
        }, token=token)
        sid = session["id"]
        api("PATCH", f"/sessions/{sid}/canvas-state", {
            "version": 1,
            "nodes": build_nodes(primary, participants, employees_by_name),
            "edges": build_edges(primary, participants),
        }, token=token)
        saved = api("POST", f"/sessions/{sid}/save-template", {
            "name": name,
            "description": template.get("description", ""),
            "category": template.get("category", "general"),
            "visibility": template.get("visibility", "tenant"),
            "strategy": template.get("strategy", "relay"),
            "failure_strategy": template.get("failure_strategy", "continue_with_next_employee"),
            "default_prompt": template.get("default_prompt", ""),
            "output_type": template.get("output_type", "markdown"),
        }, token=token)
        print(f"template created: {name} -> {saved['id']}")


def cleanup_demo_noise(token: str, content: dict) -> None:
    """Clean obvious test/demo noise from the local demo tenant.

    This is intentionally opt-in because a customer's tenant may have useful
    custom content that we should never remove during a normal seed run.
    """
    desired_skill_slugs = {s["slug"] for s in content.get("skills", [])}
    desired_employee_names = {e["display_name"] for e in content.get("employees", [])}
    desired_template_names = {t["name"] for t in content.get("templates", [])}
    suspicious_markers = (
        "smoke", "test", "e2e", "proof", "zip-test", "p35test",
        "ui finance", "relay risk", "live finance",
    )
    noisy_employee_names = {
        "数据分析工程师",
        "项目管理助理",
    }

    employees = api("GET", "/employees", token=token).get("items", [])
    for emp in employees:
        name = str(emp.get("display_name") or "")
        haystack = name.lower()
        should_archive = (
            name not in desired_employee_names
            and (
                name in noisy_employee_names
                or any(marker in haystack for marker in suspicious_markers)
            )
        )
        if not should_archive:
            continue
        if DRY_RUN:
            print(f"would archive noisy employee: {name}")
        else:
            api("DELETE", f"/employees/{emp['id']}", token=token)
            print(f"archived noisy employee: {name}")

    skills = api("GET", "/skill-market", token=token).get("items", [])
    for skill in skills:
        slug = str(skill.get("slug") or "")
        name = str(skill.get("name") or "")
        haystack = f"{name} {slug}".lower()
        if slug in desired_skill_slugs or skill.get("status") != "enabled":
            continue
        if any(marker in haystack for marker in suspicious_markers):
            if DRY_RUN:
                print(f"would disable noisy skill: {name} ({slug})")
            else:
                api("POST", f"/skill-market/{skill['id']}/disable", token=token)
                print(f"disabled noisy skill: {name} ({slug})")

    templates = api("GET", "/collaboration-templates", token=token).get("items", [])
    for tpl in templates:
        name = str(tpl.get("name") or "")
        if name in desired_template_names:
            continue
        if DRY_RUN:
            print(f"would delete old template: {name}")
        else:
            api("DELETE", f"/collaboration-templates/{tpl['id']}", token=token)
            print(f"deleted old template: {name}")


def build_nodes(primary: dict, participant_ids: list[str], employees_by_name: dict[str, dict]) -> list[dict]:
    by_id = {emp["id"]: emp for emp in employees_by_name.values()}
    chain = [primary["id"], *participant_ids]
    nodes = [{
        "id": "user",
        "type": "user",
        "position": {"x": 120, "y": 220},
        "data": {"label": "用户", "role": "发起任务", "status": "idle"},
    }]
    for idx, emp_id in enumerate(chain):
        emp = by_id.get(emp_id, {"display_name": emp_id, "avatar": "?"})
        nodes.append({
            "id": f"employee-{emp_id}",
            "type": "employee",
            "position": {"x": 420 + idx * 260, "y": 160 + (idx % 2) * 120},
            "data": {
                "employee_id": emp_id,
                "label": emp.get("display_name") or emp.get("name") or emp_id,
                "role": emp.get("description", ""),
                "status": "idle",
            },
        })
    return nodes


def build_edges(primary: dict, participant_ids: list[str]) -> list[dict]:
    chain = [primary["id"], *participant_ids]
    edges = []
    prev = "user"
    for idx, emp_id in enumerate(chain):
        current = f"employee-{emp_id}"
        edges.append({
            "id": f"edge-{idx}",
            "source": prev,
            "target": current,
            "type": "smoothstep",
            "data": {"strategy": "relay", "order": idx + 1},
        })
        prev = current
    return edges


def main() -> int:
    if not CONTENT_FILE.exists():
        raise SeedError(f"content file not found: {CONTENT_FILE}")
    content = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))
    print(f"OpenAtlas demo seed: {BASE}")
    print(f"content version: {content.get('version')}")
    token = login()
    skills_by_slug = ensure_skills(token, content["skills"])
    employees_by_name = ensure_employees(token, content["employees"], skills_by_slug)
    ensure_templates(token, content["templates"], employees_by_name)
    if CLEANUP:
        cleanup_demo_noise(token, content)
    print("demo content seed complete")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
