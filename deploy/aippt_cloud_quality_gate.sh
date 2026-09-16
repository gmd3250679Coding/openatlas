#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${REMOTE:-}" ]]; then
  echo "Usage: REMOTE=ubuntu@your-cvm-public-ip [SSH_OPTS='-i ~/.ssh/id_ed25519'] [REQUIRE_PDF_VISUAL=1] bash deploy/aippt_cloud_quality_gate.sh" >&2
  exit 2
fi

APP_ROOT="${APP_ROOT:-/opt/openatlas}"
REMOTE_OUTDIR="${REMOTE_OUTDIR:-/tmp/openatlas-aippt-cloud-qa}"
REQUIRE_PDF_VISUAL="${REQUIRE_PDF_VISUAL:-1}"
SSH_OPTS="${SSH_OPTS:-}"
SSH_ARGS=()
if [[ -n "$SSH_OPTS" ]]; then
  read -r -a SSH_ARGS <<< "$SSH_OPTS"
fi

ssh ${SSH_ARGS[@]+"${SSH_ARGS[@]}"} "$REMOTE" "bash -s" -- "$APP_ROOT" "$REMOTE_OUTDIR" "$REQUIRE_PDF_VISUAL" <<'REMOTE_SCRIPT'
set -euo pipefail

APP_ROOT="$1"
OUTDIR="$2"
REQUIRE_PDF_VISUAL="$3"
CURRENT="$APP_ROOT/current"
PYTHON="$CURRENT/backend/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "OpenAtlas backend venv not found at $PYTHON" >&2
  exit 1
fi

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"
cd "$CURRENT"

curl -fsS http://127.0.0.1:58003/api/health > "$OUTDIR/health.json"
PYTHONPYCACHEPREFIX="$OUTDIR/pycache" "$PYTHON" -m py_compile \
  backend/app/main.py \
  backend/scripts/aippt_chain_contract.py \
  backend/scripts/aippt_export_qa.py \
  backend/scripts/aippt_batch_quality_gate.py \
  backend/scripts/aippt_template_gallery.py
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" backend/scripts/aippt_chain_contract.py > "$OUTDIR/aippt_chain_contract.json"
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" backend/scripts/aippt_template_gallery.py --outdir "$OUTDIR/gallery" > "$OUTDIR/aippt_template_gallery.log"
BATCH_PDF_ARGS=()
if [[ "$REQUIRE_PDF_VISUAL" == "1" ]]; then
  BATCH_PDF_ARGS+=(--require-pdf-visual)
fi
PYTHONDONTWRITEBYTECODE=1 "$PYTHON" backend/scripts/aippt_batch_quality_gate.py --limit 8 --outdir "$OUTDIR/batch" "${BATCH_PDF_ARGS[@]}" > "$OUTDIR/aippt_batch_quality.log"

PYTHONDONTWRITEBYTECODE=1 "$PYTHON" - "$OUTDIR" "$REQUIRE_PDF_VISUAL" <<'PY'
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

outdir = Path(sys.argv[1])
require_pdf_visual = sys.argv[2] == "1"
health = json.loads((outdir / "health.json").read_text(encoding="utf-8"))
chain = json.loads((outdir / "aippt_chain_contract.json").read_text(encoding="utf-8"))
gallery = json.loads((outdir / "gallery" / "aippt-template-gallery.qa.json").read_text(encoding="utf-8"))
batch = json.loads((outdir / "batch" / "aippt-batch-quality.report.json").read_text(encoding="utf-8"))
summary = gallery.get("summary") if isinstance(gallery.get("summary"), dict) else {}
coverage = summary.get("templateCoverage") if isinstance(summary.get("templateCoverage"), dict) else {}
visual = gallery.get("pptx_pdf_visual") if isinstance(gallery.get("pptx_pdf_visual"), dict) else {}
machine_gate = summary.get("machineGate") if isinstance(summary.get("machineGate"), dict) else {}
package = gallery.get("package") if isinstance(gallery.get("package"), dict) else {}
ok = (
    health.get("status") == "ok"
    and bool(chain.get("ok"))
    and bool(gallery.get("ok"))
    and bool(batch.get("ok"))
    and bool(visual.get("gateOk"))
    and (not require_pdf_visual or not visual.get("skipped"))
)
report = {
    "ok": ok,
    "release": str(Path("/opt/openatlas/current").resolve()),
    "soffice": shutil.which("soffice") or shutil.which("libreoffice"),
    "health": health,
    "chain": {
        "ok": chain.get("ok"),
        "slides": chain.get("slides"),
        "layouts": chain.get("layouts"),
        "templates": chain.get("templates"),
        "specLockRouteDrift": chain.get("specLockRouteDrift"),
        "nativeChartCount": chain.get("nativeChartCount"),
    },
    "gallery": {
        "ok": gallery.get("ok"),
        "slideCount": coverage.get("slideCount"),
        "coveredCount": coverage.get("coveredCount"),
        "nativeChartCount": summary.get("nativeChartCount"),
        "editableTextShapeCount": summary.get("editableTextShapeCount"),
        "layoutRepetition": summary.get("layoutRepetition"),
        "templateRepetition": summary.get("templateRepetition"),
        "specLockRouteDrift": summary.get("specLockRouteDrift"),
        "potentialOverflowCount": len(summary.get("potentialOverflows") or []),
        "machineGateOk": machine_gate.get("ok"),
        "packageOk": package.get("ok"),
    },
    "batch": {
        "ok": batch.get("ok"),
        "caseCount": batch.get("caseCount"),
        "passCount": batch.get("passCount"),
        "passRate": batch.get("passRate"),
        "averageScore": batch.get("averageScore"),
        "minScore": batch.get("minScore"),
        "penaltyCounts": (batch.get("aggregate") or {}).get("penaltyCounts"),
        "failedCases": batch.get("failedCases"),
    },
    "pptxPdfVisual": {
        "gateOk": visual.get("gateOk"),
        "skipped": visual.get("skipped"),
        "pageCount": visual.get("pageCount"),
        "expectedPageCount": visual.get("expectedPageCount"),
        "issueCount": len(visual.get("issues") or []),
        "warningCount": len(visual.get("warnings") or []),
    },
    "artifacts": {
        "outdir": str(outdir),
        "galleryReport": str(outdir / "gallery" / "aippt-template-gallery.qa.json"),
        "galleryPptx": str(outdir / "gallery" / "aippt-template-gallery.pptx"),
        "galleryPdf": str(outdir / "gallery" / "aippt-template-gallery.pdf"),
        "batchReport": str(outdir / "batch" / "aippt-batch-quality.report.json"),
    },
}
print(json.dumps(report, ensure_ascii=False, indent=2))
raise SystemExit(0 if ok else 1)
PY
REMOTE_SCRIPT
