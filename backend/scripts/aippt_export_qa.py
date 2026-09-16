#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import (  # noqa: E402
    _aippt_repetition_runs,
    _build_aippt_pptx,
    _presentation_config_from_input,
    _presentation_prepare_delivery_plan,
    _presentation_quality_checks,
    _presentation_spec_lock_route_drifts,
    _presentation_template_id_for_slide,
    _validate_aippt_pptx_package,
)


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        value = json.load(fh)
    if not isinstance(value, dict):
        raise SystemExit(f"{path} must be a JSON object")
    return value


def convert_to_pdf(input_path: Path, outdir: Path) -> tuple[bool, str]:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return False, "soffice/libreoffice not found"
    proc = subprocess.run(
        [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(input_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=60,
        check=False,
    )
    pdf_path = outdir / f"{input_path.stem}.pdf"
    ok = proc.returncode == 0 and pdf_path.exists() and pdf_path.stat().st_size > 0
    return ok, proc.stdout.strip()


def pdf_conversion_unavailable(log: str) -> bool:
    return "soffice/libreoffice not found" in (log or "").lower()


def analyze_pdf_visual(pdf_path: Path, *, expected_pages: int | None = None) -> dict:
    report = {
        "ok": False,
        "gateOk": False,
        "skipped": False,
        "pdf": str(pdf_path),
        "pageCount": 0,
        "expectedPageCount": expected_pages,
        "issues": [],
        "warnings": [],
        "pages": [],
    }
    if not pdf_path.exists() or pdf_path.stat().st_size <= 0:
        report["issues"].append({"type": "pdf_missing", "message": "PDF file was not generated."})
        return report
    try:
        import fitz  # type: ignore
        from PIL import Image  # type: ignore
        fitz.TOOLS.mupdf_display_errors(False)
        fitz.TOOLS.mupdf_display_warnings(False)
    except Exception as exc:  # pragma: no cover - optional local QA dependency
        report.update({
            "skipped": True,
            "gateOk": True,
            "log": f"visual PDF QA skipped: {exc}",
        })
        return report

    def page_signature(image: "Image.Image") -> list[int]:
        thumb = image.convert("L").resize((32, 18))
        return list(thumb.getdata())

    try:
        doc = fitz.open(str(pdf_path))
        page_count = len(doc)
        report["pageCount"] = page_count
        if expected_pages is not None and page_count != expected_pages:
            report["issues"].append({
                "type": "page_count_mismatch",
                "message": f"Expected {expected_pages} pages, got {page_count}.",
            })
        if page_count <= 0:
            report["issues"].append({"type": "empty_pdf", "message": "PDF has no pages."})
            report["ok"] = False
            report["gateOk"] = False
            return report

        previous_signature: list[int] | None = None
        for page_index, page in enumerate(doc, start=1):
            pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
            image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            width, height = image.size
            pixels = image.load()
            step_x = max(1, width // 180)
            step_y = max(1, height // 100)
            threshold = 245
            total = 0
            content = 0
            brightness_sum = 0.0
            brightness_sq_sum = 0.0
            buckets: set[tuple[int, int, int]] = set()
            min_x = width
            min_y = height
            max_x = -1
            max_y = -1
            left_edge = right_edge = bottom_edge = 0
            left_total = right_total = bottom_total = 0
            edge_x = max(2, width // 80)
            edge_y = max(2, height // 80)
            for y in range(0, height, step_y):
                for x in range(0, width, step_x):
                    r, g, b = pixels[x, y]
                    brightness = (r + g + b) / 3
                    total += 1
                    brightness_sum += brightness
                    brightness_sq_sum += brightness * brightness
                    buckets.add((r // 32, g // 32, b // 32))
                    is_content = brightness < threshold
                    if x <= edge_x:
                        left_total += 1
                        left_edge += 1 if is_content else 0
                    if x >= width - edge_x:
                        right_total += 1
                        right_edge += 1 if is_content else 0
                    if y >= height - edge_y:
                        bottom_total += 1
                        bottom_edge += 1 if is_content else 0
                    if not is_content:
                        continue
                    content += 1
                    min_x = min(min_x, x)
                    min_y = min(min_y, y)
                    max_x = max(max_x, x)
                    max_y = max(max_y, y)

            non_white_ratio = content / total if total else 0
            mean_brightness = brightness_sum / total if total else 255
            variance = (brightness_sq_sum / total - mean_brightness * mean_brightness) if total else 0
            edge_density = {
                "left": left_edge / left_total if left_total else 0,
                "right": right_edge / right_total if right_total else 0,
                "bottom": bottom_edge / bottom_total if bottom_total else 0,
            }
            bbox = None
            if content:
                bbox = {
                    "x": round(min_x / width, 4),
                    "y": round(min_y / height, 4),
                    "w": round((max_x - min_x + step_x) / width, 4),
                    "h": round((max_y - min_y + step_y) / height, 4),
                }
            page_issues = []
            page_warnings = []
            if width < 320 or height < 180:
                page_issues.append({"type": "small_render", "message": "Rendered PDF page is unexpectedly small."})
            if non_white_ratio < 0.006 or (len(buckets) < 4 and variance < 8):
                page_issues.append({"type": "blank_or_low_visual_density", "message": "Page appears blank or visually too sparse."})
            elif non_white_ratio < 0.015:
                page_warnings.append({"type": "sparse_visual_density", "message": "Page has very little rendered content."})
            full_bleed_background = non_white_ratio > 0.72
            if (not full_bleed_background) and bbox and (bbox["x"] <= 0.003 or bbox["x"] + bbox["w"] >= 0.997):
                page_warnings.append({"type": "content_touches_horizontal_edge", "message": "Content may be clipped near left/right edge."})
            if (not full_bleed_background) and bbox and bbox["y"] + bbox["h"] >= 0.997 and edge_density["bottom"] > 0.12:
                page_warnings.append({"type": "content_touches_bottom_edge", "message": "Content may be clipped near bottom edge."})

            signature = page_signature(image)
            if previous_signature is not None:
                diff = sum(abs(a - b) for a, b in zip(previous_signature, signature)) / len(signature)
                if diff < 2.2:
                    page_warnings.append({
                        "type": "adjacent_pages_highly_similar",
                        "message": "Adjacent PDF pages are visually very similar.",
                        "diff": round(diff, 2),
                    })
            previous_signature = signature

            page_record = {
                "page": page_index,
                "width": width,
                "height": height,
                "nonWhiteRatio": round(non_white_ratio, 4),
                "uniqueColorBuckets": len(buckets),
                "brightnessVariance": round(max(0, variance), 2),
                "contentBox": bbox,
                "edgeDensity": {key: round(value, 4) for key, value in edge_density.items()},
                "issues": page_issues,
                "warnings": page_warnings,
            }
            report["pages"].append(page_record)
            for issue in page_issues:
                report["issues"].append({"page": page_index, **issue})
            for warning in page_warnings:
                report["warnings"].append({"page": page_index, **warning})
        doc.close()
    except Exception as exc:
        report["issues"].append({"type": "pdf_visual_analysis_failed", "message": str(exc)})
        return report

    report["ok"] = not report["issues"]
    report["gateOk"] = not report["issues"]
    return report


def build_qa_summary(plan: dict, package_report: dict, *, pptx_pdf_ok: bool) -> dict:
    spec_lock = plan.get("specLock") if isinstance(plan.get("specLock"), dict) else {}
    slides = [slide for slide in plan.get("slides", []) if isinstance(slide, dict)]
    page_templates = spec_lock.get("pageTemplates") if isinstance(spec_lock.get("pageTemplates"), dict) else {}
    layout_plan = spec_lock.get("layoutPlan") if isinstance(spec_lock.get("layoutPlan"), dict) else {}
    pages = layout_plan.get("pages") if isinstance(layout_plan.get("pages"), list) else []
    layouts = [str(slide.get("layout") or "two_column") for slide in slides]
    templates = [
        str(page_templates.get(str(slide.get("id") or "")) or _presentation_template_id_for_slide(slide, str(slide.get("layout") or "")))
        for slide in slides
    ]
    covered = sorted({template for template in templates if template})
    checks = package_report.get("checks") if isinstance(package_report.get("checks"), list) else []
    route_drifts = _presentation_spec_lock_route_drifts(plan)
    layout_repetition = _aippt_repetition_runs(layouts)
    template_repetition = _aippt_repetition_runs(templates)
    potential_overflows = package_report.get("potential_overflows") or []
    machine_gate = {
        "ok": bool(package_report.get("ok"))
        and len(page_templates) >= len(slides)
        and not route_drifts
        and not layout_repetition
        and not template_repetition
        and not potential_overflows,
        "rules": [
            "pptx_package_ok",
            "spec_lock_template_coverage",
            "spec_lock_route_alignment",
            "no_layout_or_template_run_ge_3",
            "no_potential_text_overflow",
        ],
    }
    return {
        "specLockVersion": spec_lock.get("version"),
        "templateCatalogVersion": spec_lock.get("templateCatalogVersion"),
        "templateCoverage": {
            "slideCount": len(slides),
            "coveredCount": len([template for template in templates if template]),
            "coveredTemplates": covered,
            "pages": [
                {
                    "slideId": page.get("slideId"),
                    "layout": page.get("layout"),
                    "templateId": page.get("templateId"),
                    "pptxSupport": page.get("pptxSupport"),
                }
                for page in pages
                if isinstance(page, dict)
            ],
        },
        "nativeChartCount": int(package_report.get("native_chart_count") or 0),
        "editableTextShapeCount": int(package_report.get("editable_text_shape_count") or 0),
        "layoutRepetition": layout_repetition,
        "templateRepetition": template_repetition,
        "specLockRouteDrift": route_drifts,
        "potentialOverflows": potential_overflows,
        "pptxPackageValidation": {
            "ok": bool(package_report.get("ok")),
            "pptxPdfOk": pptx_pdf_ok,
            "checks": checks,
            "errors": package_report.get("errors") or [],
            "warnings": package_report.get("warnings") or [],
        },
        "machineGate": machine_gate,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AIPPT export QA for PPTX and optional HTML.")
    parser.add_argument("--plan", required=True, help="Path to DeckPlan JSON")
    parser.add_argument("--config", required=True, help="Path to DeckConfig JSON")
    parser.add_argument("--html", default="", help="Optional exported HTML file to convert to PDF")
    parser.add_argument("--outdir", default="", help="Output directory for generated PPTX/PDF")
    args = parser.parse_args()

    raw_config = load_json(args.config)
    config = _presentation_config_from_input(raw_config.get("topic") or "", raw_config)
    plan = _presentation_prepare_delivery_plan(load_json(args.plan), config)
    outdir = Path(args.outdir) if args.outdir else Path(tempfile.mkdtemp(prefix="aippt-export-qa-"))
    outdir.mkdir(parents=True, exist_ok=True)

    pptx_path = outdir / "aippt-export-qa.pptx"
    pptx_path.write_bytes(_build_aippt_pptx(plan, config))
    package_report = _validate_aippt_pptx_package(pptx_path.read_bytes(), plan, config)
    pptx_pdf_ok, pptx_pdf_log = convert_to_pdf(pptx_path, outdir)
    pptx_pdf_gate_ok = pptx_pdf_ok or pdf_conversion_unavailable(pptx_pdf_log)
    if pptx_pdf_ok:
        pptx_pdf_visual = analyze_pdf_visual(outdir / "aippt-export-qa.pdf", expected_pages=len(plan.get("slides", []) or []))
    else:
        pptx_pdf_visual = {
            "ok": False,
            "gateOk": pptx_pdf_gate_ok,
            "skipped": pdf_conversion_unavailable(pptx_pdf_log),
            "pdf": str(outdir / "aippt-export-qa.pdf"),
            "issues": [] if pptx_pdf_gate_ok else [{"type": "pdf_conversion_failed", "message": pptx_pdf_log}],
            "warnings": [],
            "pages": [],
        }
    native_chart_count = int(package_report.get("native_chart_count") or 0)
    quality = _presentation_quality_checks(plan, config, native_chart_count=native_chart_count, pdf_rendered=pptx_pdf_ok)
    summary = build_qa_summary(plan, package_report, pptx_pdf_ok=pptx_pdf_ok)
    summary["pptxPdfVisual"] = {
        "gateOk": bool(pptx_pdf_visual.get("gateOk")),
        "skipped": bool(pptx_pdf_visual.get("skipped")),
        "pageCount": pptx_pdf_visual.get("pageCount"),
        "expectedPageCount": pptx_pdf_visual.get("expectedPageCount"),
        "issueCount": len(pptx_pdf_visual.get("issues") or []),
        "warningCount": len(pptx_pdf_visual.get("warnings") or []),
    }

    html_pdf = None
    if args.html:
        html_path = Path(args.html)
        html_pdf_ok, html_pdf_log = convert_to_pdf(html_path, outdir)
        html_pdf_gate_ok = html_pdf_ok or pdf_conversion_unavailable(html_pdf_log)
        html_pdf = {
            "input": str(html_path),
            "ok": html_pdf_ok,
            "gateOk": html_pdf_gate_ok,
            "skipped": pdf_conversion_unavailable(html_pdf_log),
            "log": html_pdf_log,
            "pdf": str(outdir / f"{html_path.stem}.pdf"),
        }

    report = {
        "ok": bool(package_report.get("ok"))
        and summary["machineGate"]["ok"]
        and pptx_pdf_gate_ok
        and bool(pptx_pdf_visual.get("gateOk"))
        and (html_pdf is None or html_pdf["gateOk"]),
        "outdir": str(outdir),
        "pptx": str(pptx_path),
        "pptx_pdf": {
            "ok": pptx_pdf_ok,
            "gateOk": pptx_pdf_gate_ok,
            "skipped": pdf_conversion_unavailable(pptx_pdf_log),
            "log": pptx_pdf_log,
            "pdf": str(outdir / "aippt-export-qa.pdf"),
        },
        "pptx_pdf_visual": pptx_pdf_visual,
        "html_pdf": html_pdf,
        "summary": summary,
        "package": package_report,
        "quality": quality,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
