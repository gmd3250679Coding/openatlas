"""OpenAtlas one-command quality gate.

Runs the checks that protect the main Hermes/OpenAtlas paths:
- backend API smoke
- tenant isolation smoke
- frontend production build
- Playwright E2E
- product maturity audit

The script assumes the OpenAtlas backend and frontend dev server are already
running. Use scripts/dev-stack.sh when you want startup + quality in one step.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def run_step(label: str, cmd: list[str], cwd: Path, env: dict[str, str] | None = None) -> dict:
    started = time.time()
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=merged_env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=int(os.environ.get("OPENATLAS_QUALITY_TIMEOUT", "300")),
    )
    return {
        "label": label,
        "ok": proc.returncode == 0,
        "ms": int((time.time() - started) * 1000),
        "cmd": " ".join(cmd),
        "output_tail": proc.stdout[-6000:],
    }


def main() -> int:
    python = os.environ.get("PYTHON", sys.executable)
    steps = [
        ("api_smoke", [python, str(BACKEND / "scripts" / "api_smoke.py")], ROOT),
        ("isolation_smoke", [python, str(BACKEND / "scripts" / "isolation_smoke.py")], ROOT),
        ("frontend_build", ["npm", "run", "build"], FRONTEND),
        ("frontend_e2e", ["npm", "run", "test:e2e", "--", "--reporter=list"], FRONTEND),
        ("maturity_audit", [python, str(BACKEND / "scripts" / "maturity_audit.py")], ROOT),
    ]
    if os.environ.get("OPENATLAS_QUALITY_SKIP_E2E") == "1":
        steps = [s for s in steps if s[0] != "frontend_e2e"]
    if os.environ.get("OPENATLAS_QUALITY_SKIP_ISOLATION") == "1":
        steps = [s for s in steps if s[0] != "isolation_smoke"]
    if os.environ.get("OPENATLAS_QUALITY_SKIP_MATURITY") == "1":
        steps = [s for s in steps if s[0] != "maturity_audit"]

    results = []
    for label, cmd, cwd in steps:
        result = run_step(label, cmd, cwd)
        results.append(result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if not result["ok"] and os.environ.get("OPENATLAS_QUALITY_KEEP_GOING") != "1":
            break

    ok = all(r["ok"] for r in results)
    print(json.dumps({"ok": ok, "steps": [{"label": r["label"], "ok": r["ok"], "ms": r["ms"]} for r in results]}, ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
