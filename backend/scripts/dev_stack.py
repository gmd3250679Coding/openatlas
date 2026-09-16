"""OpenAtlas dev-stack runner.

Starts the missing local services, waits for health, then optionally runs the
quality gate. Existing healthy services are reused and never stopped.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
SCRIPTS = ROOT / "scripts"
BUNDLED_HERMES_RUNTIME = ROOT / "runtime" / "hermes"

DEFAULT_OPENATLAS_HOME = Path.home() / ".openatlas"
DEFAULT_TENANT = "demo"
DEFAULT_GATEWAY_PORT = 58642
DEFAULT_BACKEND_PORT = 58003
DEFAULT_FRONTEND_PORT = 3381
DEFAULT_API_KEY = "openatlas-demo-dev-key"

urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))


class DevStackError(RuntimeError):
    pass


def log(message: str) -> None:
    print(f"[dev-stack] {message}", flush=True)


def url_ok(url: str, *, headers: dict[str, str] | None = None, timeout: float = 3) -> bool:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 500
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def json_get(url: str, *, headers: dict[str, str] | None = None, timeout: float = 5) -> dict | None:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            return json.loads(raw) if raw else {}
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return None


def wait_until(label: str, check, *, timeout: float) -> None:
    deadline = time.time() + timeout
    last_note = ""
    while time.time() < deadline:
        ok, note = check()
        if ok:
            log(f"{label} ready")
            return
        last_note = note
        time.sleep(0.5)
    raise DevStackError(f"{label} did not become ready within {timeout:.0f}s: {last_note}")


def port_pid(port: int) -> str:
    proc = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=5,
    )
    return proc.stdout.strip().splitlines()[0] if proc.stdout.strip() else ""


def python_bin() -> str:
    candidates = [
        BACKEND / ".venv" / "bin" / "python",
        BACKEND / ".venv" / "bin" / "python3",
        Path(sys.executable),
    ]
    for candidate in candidates:
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return sys.executable


def start_process(label: str, cmd: list[str], cwd: Path, env: dict[str, str], log_file: Path) -> subprocess.Popen:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    out = log_file.open("a", encoding="utf-8")
    out.write(f"\n\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] starting {label}: {' '.join(cmd)}\n")
    out.flush()
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=out,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )
    log(f"started {label} pid={proc.pid} log={log_file}")
    return proc


def stop_process(label: str, proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    log(f"stopping owned {label} pid={proc.pid}")
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    except OSError:
        proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            proc.kill()


def gateway_headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"}


def ensure_hermes_runtime(args, env: dict[str, str]) -> Path:
    runtime = args.hermes_runtime
    source_markers = [
        runtime / "pyproject.toml",
        runtime / "gateway" / "platforms" / "api_server.py",
    ]
    missing = [str(path) for path in source_markers if not path.is_file()]
    if missing:
        raise DevStackError(
            "bundled Hermes runtime source is incomplete: " + ", ".join(missing)
        )

    python = runtime / ".venv" / "bin" / "python"
    check_env = env.copy()
    check_env["PYTHONPATH"] = str(runtime)
    healthy = False
    if python.is_file() and os.access(python, os.X_OK):
        probe = subprocess.run(
            [
                str(python),
                "-c",
                "import aiohttp; from gateway.config import PlatformConfig; "
                "from gateway.platforms.api_server import APIServerAdapter",
            ],
            cwd=str(runtime),
            env=check_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        healthy = probe.returncode == 0
    if healthy:
        log(f"Hermes runtime ready at {runtime}")
        return runtime

    setup_script = SCRIPTS / "setup-hermes-runtime.sh"
    if not setup_script.is_file():
        raise DevStackError(f"missing Hermes runtime setup script: {setup_script}")
    log(f"preparing bundled Hermes runtime at {runtime}")
    setup_env = env.copy()
    setup_env["OPENATLAS_HERMES_AGENT_ROOT"] = str(runtime)
    proc = subprocess.run(
        ["bash", str(setup_script)],
        cwd=str(ROOT),
        env=setup_env,
        text=True,
    )
    if proc.returncode != 0:
        raise DevStackError(
            f"Hermes runtime setup failed with exit code {proc.returncode}"
        )
    return runtime


def ensure_gateway(args, env: dict[str, str], owned: list[tuple[str, subprocess.Popen]]) -> str:
    base = f"http://127.0.0.1:{args.gateway_port}"
    health = f"{base}/health"
    if json_get(health, headers=gateway_headers(args.api_key)):
        log(f"reusing Hermes Gateway on {base}")
        return base

    pid = port_pid(args.gateway_port)
    if pid:
        raise DevStackError(f"port {args.gateway_port} is occupied by pid {pid}, but Hermes /health is not healthy")

    start_script = SCRIPTS / "start.sh"
    if not start_script.exists():
        raise DevStackError(f"missing gateway launcher: {start_script}")
    log("Hermes Gateway not running; invoking isolated start.sh")
    proc = start_process(
        "hermes-start",
        ["bash", str(start_script)],
        ROOT,
        env,
        args.openatlas_home / "logs" / "openatlas-dev-stack-hermes-start.log",
    )
    owned.append(("hermes-start-wrapper", proc))

    def check() -> tuple[bool, str]:
        payload = json_get(health, headers=gateway_headers(args.api_key))
        if payload:
            return True, json.dumps(payload, ensure_ascii=False)
        if proc.poll() not in (None, 0):
            return False, f"start.sh exited with {proc.returncode}"
        return False, "waiting for /health"

    wait_until("Hermes Gateway", check, timeout=args.wait_timeout)
    return base


def ensure_backend(args, env: dict[str, str], owned: list[tuple[str, subprocess.Popen]]) -> str:
    base = f"http://127.0.0.1:{args.backend_port}"
    if json_get(f"{base}/api/health"):
        log(f"reusing OpenAtlas backend on {base}")
        return base

    pid = port_pid(args.backend_port)
    if pid:
        raise DevStackError(f"port {args.backend_port} is occupied by pid {pid}, but backend /api/health is not healthy")

    proc = start_process(
        "backend",
        [python_bin(), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(args.backend_port), "--log-level", "warning"],
        BACKEND,
        env,
        args.openatlas_home / "logs" / "openatlas-backend.log",
    )
    owned.append(("backend", proc))

    def check() -> tuple[bool, str]:
        if proc.poll() is not None:
            return False, f"backend exited with {proc.returncode}"
        payload = json_get(f"{base}/api/health")
        return (True, "ok") if payload else (False, "waiting for /api/health")

    wait_until("OpenAtlas backend", check, timeout=args.wait_timeout)
    return base


def ensure_frontend(args, env: dict[str, str], owned: list[tuple[str, subprocess.Popen]]) -> str:
    base = f"http://127.0.0.1:{args.frontend_port}"
    if url_ok(base):
        log(f"reusing Vite frontend on {base}")
        return base

    pid = port_pid(args.frontend_port)
    if pid:
        raise DevStackError(f"port {args.frontend_port} is occupied by pid {pid}, but frontend is not responding")

    proc = start_process(
        "frontend",
        ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(args.frontend_port), "--strictPort"],
        FRONTEND,
        env,
        args.openatlas_home / "logs" / "openatlas-frontend.log",
    )
    owned.append(("frontend", proc))

    def check() -> tuple[bool, str]:
        if proc.poll() is not None:
            return False, f"frontend exited with {proc.returncode}"
        return (True, "ok") if url_ok(base) else (False, "waiting for Vite")

    wait_until("Vite frontend", check, timeout=args.wait_timeout)
    return base


def run_quality(args, env: dict[str, str]) -> int:
    cmd = [python_bin(), str(BACKEND / "scripts" / "quality_gate.py")]
    quality_env = env.copy()
    quality_env.update(
        {
            "OPENATLAS_API_BASE": f"http://127.0.0.1:{args.backend_port}/api",
            "OPENATLAS_E2E_BASE_URL": f"http://127.0.0.1:{args.frontend_port}",
            "OPENATLAS_E2E_API_BASE": f"http://127.0.0.1:{args.backend_port}/api",
        }
    )
    if args.skip_e2e:
        quality_env["OPENATLAS_QUALITY_SKIP_E2E"] = "1"
    if args.skip_isolation:
        quality_env["OPENATLAS_QUALITY_SKIP_ISOLATION"] = "1"
    if args.strict_model:
        quality_env["OPENATLAS_SMOKE_STRICT_MODEL"] = "1"
        quality_env["OPENATLAS_E2E_STRICT_MODEL"] = "1"

    log("running quality gate")
    proc = subprocess.run(cmd, cwd=str(ROOT), env=quality_env, text=True)
    return proc.returncode


def build_env(args) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "OPENATLAS_HOME": str(args.openatlas_home),
            "OPENATLAS_TENANT": args.tenant,
            "HERMES_HOME": str(args.openatlas_home / "hermes-tenants" / args.tenant / ".hermes"),
            "HERMES_BASE_URL": f"http://127.0.0.1:{args.gateway_port}",
            "HERMES_API_KEY": args.api_key,
            "API_SERVER_HOST": "127.0.0.1",
            "API_SERVER_PORT": str(args.gateway_port),
            "API_SERVER_KEY": args.api_key,
            "OPENATLAS_FRONTEND_PORT": str(args.frontend_port),
            "OPENATLAS_BACKEND_PORT": str(args.backend_port),
            "OPENATLAS_HERMES_AGENT_ROOT": str(args.hermes_runtime),
            "OPENATLAS_API_BASE": f"http://127.0.0.1:{args.backend_port}/api",
            "OPENATLAS_E2E_BASE_URL": f"http://127.0.0.1:{args.frontend_port}",
            "OPENATLAS_E2E_API_BASE": f"http://127.0.0.1:{args.backend_port}/api",
        }
    )
    for key in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "SOCKS_PROXY", "socks_proxy"):
        env.pop(key, None)
    return env


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start OpenAtlas local stack and run quality checks.")
    parser.add_argument("--openatlas-home", type=Path, default=DEFAULT_OPENATLAS_HOME)
    parser.add_argument(
        "--hermes-runtime",
        type=Path,
        default=BUNDLED_HERMES_RUNTIME,
        help="Hermes Agent source root (defaults to runtime/hermes in this checkout).",
    )
    parser.add_argument("--tenant", default=DEFAULT_TENANT)
    parser.add_argument("--gateway-port", type=int, default=DEFAULT_GATEWAY_PORT)
    parser.add_argument("--backend-port", type=int, default=DEFAULT_BACKEND_PORT)
    parser.add_argument("--frontend-port", type=int, default=DEFAULT_FRONTEND_PORT)
    parser.add_argument("--api-key", default=DEFAULT_API_KEY)
    parser.add_argument("--wait-timeout", type=float, default=45)
    parser.add_argument("--no-quality", action="store_true", help="Start services only; do not run quality_gate.py.")
    parser.add_argument("--skip-e2e", action="store_true", help="Skip Playwright E2E in the quality gate.")
    parser.add_argument("--skip-isolation", action="store_true", help="Skip tenant isolation smoke in the quality gate.")
    parser.add_argument("--strict-model", action="store_true", help="Require non-empty model output in smoke/E2E.")
    parser.add_argument("--cleanup-owned", action="store_true", help="Stop services this runner started before exit.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    args.openatlas_home = args.openatlas_home.resolve()
    args.hermes_runtime = args.hermes_runtime.resolve()
    env = build_env(args)
    owned: list[tuple[str, subprocess.Popen]] = []

    try:
        ensure_hermes_runtime(args, env)
        gateway = ensure_gateway(args, env, owned)
        backend = ensure_backend(args, env, owned)
        frontend = ensure_frontend(args, env, owned)
        summary = {
            "gateway": gateway,
            "backend": backend,
            "frontend": frontend,
            "hermes_runtime": str(args.hermes_runtime),
            "owned_processes": [{"label": label, "pid": proc.pid} for label, proc in owned],
        }
        log(json.dumps(summary, ensure_ascii=False, indent=2))

        if args.no_quality:
            return 0
        return run_quality(args, env)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    finally:
        if args.cleanup_owned:
            for label, proc in reversed(owned):
                stop_process(label, proc)


if __name__ == "__main__":
    raise SystemExit(main())
