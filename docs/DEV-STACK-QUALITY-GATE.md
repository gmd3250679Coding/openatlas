# OpenAtlas Dev Stack And Quality Gate

This project keeps Hermes itself isolated and treats OpenAtlas as the product
layer around Hermes Gateway. The local dev stack runner starts only the missing
OpenAtlas services and reuses healthy services that are already running.

## One-command verification

```bash
openatlas/scripts/dev-stack.sh
```

Default behavior:

- Reuses a healthy Hermes Gateway on `127.0.0.1:58642`.
- Reuses a healthy Vite frontend on `127.0.0.1:3381`.
- Starts OpenAtlas backend on `127.0.0.1:58003` if missing.
- Runs `quality_gate.py`: API smoke, tenant isolation smoke, frontend build,
  and Playwright E2E.
- Leaves reused services alone.

## Useful options

```bash
# Start/reuse services only.
openatlas/scripts/dev-stack.sh --no-quality

# Run the gate but skip the browser test.
openatlas/scripts/dev-stack.sh --skip-e2e

# Run the gate but skip demo-tenant-a/demo-tenant-b runtime isolation.
openatlas/scripts/dev-stack.sh --skip-isolation

# Stop only processes started by this runner before exit.
openatlas/scripts/dev-stack.sh --cleanup-owned

# Require real non-empty model output in smoke/E2E.
openatlas/scripts/dev-stack.sh --strict-model
```

## Isolation contract

The runner delegates Hermes startup to `scripts/start.sh`, so the existing
guards remain in force:

- `HERMES_HOME` stays under `/Users/macbook/.openatlas`.
- The live local `/Users/macbook/.hermes` service is never killed by name.
- Tenant runtimes use separate Hermes homes and ports.
- The quality gate verifies cross-tenant employee, session, file, Skill, and
  memory access is denied.

## Quality gate directly

If services are already running:

```bash
cd openatlas/frontend
npm run quality
```

or:

```bash
openatlas/backend/.venv/bin/python openatlas/backend/scripts/quality_gate.py
```
