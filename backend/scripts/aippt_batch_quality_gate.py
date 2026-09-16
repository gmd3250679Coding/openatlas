#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from aippt_export_qa import analyze_pdf_visual, build_qa_summary, convert_to_pdf, pdf_conversion_unavailable  # noqa: E402
from app.main import (  # noqa: E402
    _build_aippt_pptx,
    _presentation_config_from_input,
    _presentation_heuristic_plan,
    _presentation_prepare_delivery_plan,
    _presentation_quality_checks,
    _presentation_spec_lock_route_drifts,
    _presentation_template_id_for_slide,
    _validate_aippt_pptx_package,
)


DEFAULT_CASES: list[dict[str, Any]] = [
    {
        "id": "investor-roadshow-openatlas",
        "prompt": "帮我做一份 OpenAtlas 数智员工融资路演，面向投资人，20 分钟，突出市场机会、产品差异、商业模式、增长指标和融资用途，图表要丰富",
        "config": {
            "topic": "OpenAtlas 数智员工融资路演",
            "useCase": "roadshow",
            "pageCount": 12,
            "styleKey": "tech_launch",
            "audience": "投资人",
            "durationMinutes": 20,
            "chartLevel": "rich",
        },
    },
    {
        "id": "cio-executive-report",
        "prompt": "帮我做一份企业 CIO AI Agent 落地路线图汇报，20 分钟，强调现状痛点、方案架构、阶段计划、指标口径和治理风险",
        "config": {
            "topic": "企业 CIO AI Agent 落地路线图",
            "useCase": "report",
            "pageCount": 11,
            "styleKey": "executive_blue",
            "audience": "企业 CIO",
            "durationMinutes": 20,
            "chartLevel": "rich",
        },
    },
    {
        "id": "sales-ops-review",
        "prompt": "生成一份销售运营季度复盘，面向销售负责人，包含漏斗转化、区域排行、重点客户、下季度行动清单",
        "config": {
            "topic": "销售运营季度复盘",
            "useCase": "report",
            "pageCount": 10,
            "styleKey": "executive_blue",
            "audience": "销售负责人",
            "durationMinutes": 18,
            "chartLevel": "rich",
        },
    },
    {
        "id": "product-launch-roadshow",
        "prompt": "做一份产品发布路演，介绍企业级 AIPPT 产品，面向客户和生态伙伴，突出场景、架构、价值、价格套餐和行动号召",
        "config": {
            "topic": "企业级 AIPPT 产品发布路演",
            "useCase": "roadshow",
            "pageCount": 12,
            "styleKey": "tech_launch",
            "audience": "客户和生态伙伴",
            "durationMinutes": 18,
            "chartLevel": "balanced",
        },
    },
    {
        "id": "data-security-training",
        "prompt": "帮我生成一份数据安全培训课件，面向新员工，30 分钟，讲清分级分类、权限、审计、外发规范和案例练习",
        "config": {
            "topic": "数据安全培训课件",
            "useCase": "training",
            "pageCount": 13,
            "styleKey": "teaching_clear",
            "audience": "新员工",
            "durationMinutes": 30,
            "chartLevel": "balanced",
        },
    },
    {
        "id": "government-project-status",
        "prompt": "生成一份政企项目阶段汇报，面向业主单位，包含项目背景、进展、风险、里程碑、下一步计划，版式稳重",
        "config": {
            "topic": "政企项目阶段汇报",
            "useCase": "report",
            "pageCount": 10,
            "styleKey": "executive_blue",
            "audience": "业主单位",
            "durationMinutes": 15,
            "chartLevel": "balanced",
        },
    },
    {
        "id": "customer-success-review",
        "prompt": "做一份客户成功季度复盘，面向大客户，包含上线成果、使用指标、问题闭环、续费价值和共创计划",
        "config": {
            "topic": "客户成功季度复盘",
            "useCase": "report",
            "pageCount": 10,
            "styleKey": "executive_blue",
            "audience": "大客户",
            "durationMinutes": 18,
            "chartLevel": "rich",
        },
    },
    {
        "id": "manufacturing-ai-training",
        "prompt": "生成一份制造业智能质检方案培训，面向工厂运营团队，讲清业务流程、模型能力、数据采集、异常处理和上线步骤",
        "config": {
            "topic": "制造业智能质检方案培训",
            "useCase": "training",
            "pageCount": 12,
            "styleKey": "teaching_clear",
            "audience": "工厂运营团队",
            "durationMinutes": 25,
            "chartLevel": "balanced",
        },
    },
    {
        "id": "medical-data-governance",
        "prompt": "做一份医疗数据治理高管汇报，面向院方管理层，包含治理目标、系统架构、数据质量指标、合规风险和路线图",
        "config": {
            "topic": "医疗数据治理高管汇报",
            "useCase": "report",
            "pageCount": 11,
            "styleKey": "executive_blue",
            "audience": "院方管理层",
            "durationMinutes": 20,
            "chartLevel": "rich",
        },
    },
    {
        "id": "large-screen-operations",
        "prompt": "生成一份 3:1 大屏经营驾驶舱介绍，面向管理层，突出核心指标、趋势、风险预警和行动闭环",
        "config": {
            "topic": "经营驾驶舱大屏介绍",
            "useCase": "report",
            "aspectRatio": "3:1",
            "pageCount": 8,
            "styleKey": "executive_blue",
            "audience": "管理层",
            "durationMinutes": 12,
            "chartLevel": "rich",
        },
    },
]


def _slug(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-").lower()
    return clean or "case"


def _slides(plan: dict[str, Any]) -> list[dict[str, Any]]:
    return [slide for slide in plan.get("slides", []) if isinstance(slide, dict)]


def _layout_template_stats(plan: dict[str, Any]) -> dict[str, Any]:
    slides = _slides(plan)
    layouts = [str(slide.get("layout") or "two_column") for slide in slides]
    templates = [
        _presentation_template_id_for_slide(slide, str(slide.get("layout") or ""))
        for slide in slides
    ]
    content_pairs = [
        (layout, template)
        for layout, template in zip(layouts, templates)
        if layout not in {"cover", "section", "quote"}
    ]
    content_layouts = [layout for layout, _ in content_pairs]
    content_templates = [template for _, template in content_pairs if template]
    return {
        "slideCount": len(slides),
        "layouts": layouts,
        "templates": templates,
        "layoutCounts": dict(Counter(layouts)),
        "templateCounts": dict(Counter(templates)),
        "contentLayoutVariety": len(set(content_layouts)),
        "contentTemplateVariety": len(set(content_templates)),
        "twoColumnShare": round((content_layouts.count("two_column") / len(content_layouts)) if content_layouts else 0, 4),
        "visualSpecCoverage": round(
            sum(1 for slide in slides if isinstance(slide.get("visualSpec"), dict) and slide["visualSpec"].get("templateId")) / len(slides),
            4,
        ) if slides else 0,
    }


def _chart_richness(plan: dict[str, Any], package_report: dict[str, Any]) -> dict[str, Any]:
    slides = _slides(plan)
    chart_slides = []
    metric_count = 0
    provenance_count = 0
    for slide in slides:
        spec = slide.get("visualSpec") if isinstance(slide.get("visualSpec"), dict) else {}
        template = str(spec.get("templateId") or spec.get("chartTemplate") or "")
        spec_type = str(spec.get("type") or "")
        if spec_type in {"scorecard", "combo_metrics", "bar", "line"} or any(word in template for word in ("chart", "metric", "kpi", "funnel", "waterfall", "economics")):
            chart_slides.append(slide.get("id") or slide.get("title"))
        metrics = spec.get("metrics") if isinstance(spec.get("metrics"), list) else []
        metric_count += len(metrics)
        chart = spec.get("chart") if isinstance(spec.get("chart"), dict) else {}
        if chart and (chart.get("source") or chart.get("methodology") or chart.get("estimated") is not None):
            provenance_count += 1
    return {
        "chartLikeSlideCount": len(chart_slides),
        "chartLikeSlides": chart_slides,
        "metricCount": metric_count,
        "nativeChartCount": int(package_report.get("native_chart_count") or 0),
        "chartProvenanceCount": provenance_count,
    }


def _quality_check_map(package_report: dict[str, Any], quality: list[dict[str, Any]]) -> dict[str, bool]:
    rows = []
    rows.extend(package_report.get("checks") if isinstance(package_report.get("checks"), list) else [])
    rows.extend(package_report.get("quality") if isinstance(package_report.get("quality"), list) else [])
    rows.extend(quality)
    values: dict[str, bool] = {}
    for row in rows:
        if isinstance(row, dict) and row.get("key"):
            values[str(row["key"])] = bool(row.get("ok"))
    return values


def _score_case(
    *,
    plan: dict[str, Any],
    config: dict[str, Any],
    package_report: dict[str, Any],
    summary: dict[str, Any],
    quality: list[dict[str, Any]],
    pptx_pdf_ok: bool,
    pptx_pdf_visual: dict[str, Any],
    require_pdf_visual: bool,
) -> dict[str, Any]:
    stats = _layout_template_stats(plan)
    charts = _chart_richness(plan, package_report)
    checks = _quality_check_map(package_report, quality)
    slides = _slides(plan)
    content_count = max(1, stats["slideCount"] - stats["layoutCounts"].get("cover", 0) - stats["layoutCounts"].get("section", 0) - stats["layoutCounts"].get("quote", 0))
    min_layout_variety = min(5, max(3, math.ceil(content_count * 0.32)))
    min_template_variety = min(7, max(4, math.ceil(content_count * 0.42)))
    target_chart_like = max(2, math.ceil(stats["slideCount"] * (0.32 if config.get("chartLevel") == "rich" else 0.22)))

    penalties: list[dict[str, Any]] = []

    def penalize(key: str, points: float, detail: str) -> None:
        if points > 0:
            penalties.append({"key": key, "points": round(points, 2), "detail": detail})

    if not package_report.get("ok"):
        penalize("pptx_package", 25, "PPTX 包结构或兼容性检查未通过")
    if not (summary.get("machineGate") or {}).get("ok"):
        penalize("machine_gate", 18, "Spec Lock、模板重复或溢出机器门未通过")
    if _presentation_spec_lock_route_drifts(plan):
        penalize("spec_lock_route_drift", 12, "Spec Lock 与 slide/template 路由存在偏移")
    if summary.get("potentialOverflows"):
        penalize("potential_text_overflow", min(12, len(summary["potentialOverflows"]) * 2.5), "发现潜在 PPTX 文本溢出")
    if summary.get("layoutRepetition"):
        penalize("layout_repetition", 8, "存在连续 3 页同 layout")
    if summary.get("templateRepetition"):
        penalize("template_repetition", 10, "存在连续 3 页同视觉模板")
    if stats["contentLayoutVariety"] < min_layout_variety:
        penalize("layout_variety", (min_layout_variety - stats["contentLayoutVariety"]) * 3, f"内容页 layout 覆盖 {stats['contentLayoutVariety']}/{min_layout_variety}")
    if stats["contentTemplateVariety"] < min_template_variety:
        penalize("template_variety", (min_template_variety - stats["contentTemplateVariety"]) * 2.5, f"内容页 template 覆盖 {stats['contentTemplateVariety']}/{min_template_variety}")
    if stats["twoColumnShare"] > 0.35:
        penalize("two_column_share", min(10, (stats["twoColumnShare"] - 0.35) * 24), f"two_column 占比 {stats['twoColumnShare']:.0%}")
    if stats["visualSpecCoverage"] < 0.96:
        penalize("visual_spec_coverage", (0.96 - stats["visualSpecCoverage"]) * 18, f"visualSpec.templateId 覆盖率 {stats['visualSpecCoverage']:.0%}")
    if charts["chartLikeSlideCount"] < target_chart_like:
        penalize("chart_richness", (target_chart_like - charts["chartLikeSlideCount"]) * 3, f"图表/指标页 {charts['chartLikeSlideCount']}/{target_chart_like}")
    if config.get("chartLevel") == "rich" and charts["nativeChartCount"] < 1:
        penalize("native_chart", 7, "rich 图表场景没有原生 PPTX chart")
    if charts["metricCount"] < target_chart_like * 2:
        penalize("metric_density", min(8, (target_chart_like * 2 - charts["metricCount"]) * 1.2), f"指标卡数量 {charts['metricCount']} 偏少")
    if not checks.get("story_boundary_roles", True):
        penalize("story_boundary", 4, "首尾页未形成封面/收束角色")
    if not pptx_pdf_ok:
        pdf_penalty = 15 if require_pdf_visual else 6
        penalize("pptx_pdf_render", pdf_penalty, "PPTX 未能转 PDF" if require_pdf_visual else "PPTX PDF 视觉检查跳过或不可用")
    if not pptx_pdf_visual.get("gateOk"):
        penalize("pptx_pdf_visual_gate", 18, "PPTX PDF 视觉 gate 未通过")
    if require_pdf_visual and pptx_pdf_visual.get("skipped"):
        penalize("pptx_pdf_visual_skipped", 12, "要求 PDF 视觉检查但被跳过")
    visual_issues = len(pptx_pdf_visual.get("issues") or [])
    visual_warnings = len(pptx_pdf_visual.get("warnings") or [])
    if visual_issues:
        penalize("pdf_visual_issues", min(18, visual_issues * 5), f"PDF 视觉问题 {visual_issues} 项")
    if visual_warnings > max(4, stats["slideCount"] // 2):
        penalize("pdf_visual_warnings", min(8, visual_warnings * 0.5), f"PDF 视觉 warning {visual_warnings} 项")

    score = max(0.0, 100.0 - sum(float(item["points"]) for item in penalties))
    hard_ok = (
        bool(package_report.get("ok"))
        and bool((summary.get("machineGate") or {}).get("ok"))
        and bool(pptx_pdf_visual.get("gateOk"))
        and (not require_pdf_visual or (pptx_pdf_ok and not pptx_pdf_visual.get("skipped")))
        and score >= 86
    )
    return {
        "score": round(score, 2),
        "ok": hard_ok,
        "penalties": penalties,
        "thresholds": {
            "minScore": 86,
            "minLayoutVariety": min_layout_variety,
            "minTemplateVariety": min_template_variety,
            "targetChartLikeSlides": target_chart_like,
        },
        "stats": stats,
        "charts": charts,
    }


def _run_case(case: dict[str, Any], outdir: Path, *, require_pdf_visual: bool) -> dict[str, Any]:
    case_id = _slug(str(case.get("id") or case.get("prompt") or "case"))
    case_dir = outdir / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    prompt = str(case.get("prompt") or "")
    config = _presentation_config_from_input(prompt, case.get("config") if isinstance(case.get("config"), dict) else {})
    raw_plan = _presentation_heuristic_plan(config)
    plan = _presentation_prepare_delivery_plan(raw_plan, config)
    slides = _slides(plan)

    config_path = case_dir / "deck.config.json"
    plan_path = case_dir / "deck.plan.json"
    pptx_path = case_dir / "deck.pptx"
    report_path = case_dir / "case.qa.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    pptx_path.write_bytes(_build_aippt_pptx(plan, config))

    package_report = _validate_aippt_pptx_package(pptx_path.read_bytes(), plan, config)
    pptx_pdf_ok, pptx_pdf_log = convert_to_pdf(pptx_path, case_dir)
    pptx_pdf_gate_ok = pptx_pdf_ok or (not require_pdf_visual and pdf_conversion_unavailable(pptx_pdf_log))
    pdf_path = case_dir / "deck.pdf"
    if pptx_pdf_ok:
        pptx_pdf_visual = analyze_pdf_visual(pdf_path, expected_pages=len(slides))
    else:
        pptx_pdf_visual = {
            "ok": False,
            "gateOk": pptx_pdf_gate_ok,
            "skipped": pdf_conversion_unavailable(pptx_pdf_log),
            "pdf": str(pdf_path),
            "issues": [] if pptx_pdf_gate_ok else [{"type": "pdf_conversion_failed", "message": pptx_pdf_log}],
            "warnings": [],
            "pages": [],
        }
    summary = build_qa_summary(plan, package_report, pptx_pdf_ok=pptx_pdf_ok)
    quality = _presentation_quality_checks(
        plan,
        config,
        native_chart_count=int(package_report.get("native_chart_count") or 0),
        pdf_rendered=pptx_pdf_ok,
    )
    score = _score_case(
        plan=plan,
        config=config,
        package_report=package_report,
        summary=summary,
        quality=quality,
        pptx_pdf_ok=pptx_pdf_ok,
        pptx_pdf_visual=pptx_pdf_visual,
        require_pdf_visual=require_pdf_visual,
    )
    report = {
        "ok": score["ok"],
        "caseId": case_id,
        "prompt": prompt,
        "outdir": str(case_dir),
        "config": str(config_path),
        "plan": str(plan_path),
        "pptx": str(pptx_path),
        "pptx_pdf": {
            "ok": pptx_pdf_ok,
            "gateOk": pptx_pdf_gate_ok,
            "skipped": pdf_conversion_unavailable(pptx_pdf_log),
            "log": pptx_pdf_log,
            "pdf": str(pdf_path),
        },
        "pptx_pdf_visual": {
            "gateOk": bool(pptx_pdf_visual.get("gateOk")),
            "skipped": bool(pptx_pdf_visual.get("skipped")),
            "pageCount": pptx_pdf_visual.get("pageCount"),
            "expectedPageCount": pptx_pdf_visual.get("expectedPageCount"),
            "issueCount": len(pptx_pdf_visual.get("issues") or []),
            "warningCount": len(pptx_pdf_visual.get("warnings") or []),
            "issueTypes": dict(Counter(str(item.get("type") or "unknown") for item in (pptx_pdf_visual.get("issues") or []))),
            "warningTypes": dict(Counter(str(item.get("type") or "unknown") for item in (pptx_pdf_visual.get("warnings") or []))),
            "sampleWarnings": (pptx_pdf_visual.get("warnings") or [])[:8],
        },
        "score": score,
        "summary": summary,
        "quality": quality,
        "package": package_report,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def load_cases(path: str | None) -> list[dict[str, Any]]:
    if not path:
        return DEFAULT_CASES
    with open(path, "r", encoding="utf-8") as fh:
        value = json.load(fh)
    if isinstance(value, dict) and isinstance(value.get("cases"), list):
        value = value["cases"]
    if not isinstance(value, list):
        raise SystemExit("--cases must be a JSON array or an object with cases[]")
    cases = [case for case in value if isinstance(case, dict)]
    if not cases:
        raise SystemExit("--cases did not contain any case objects")
    return cases


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AIPPT batch quality gate across realistic golden prompts.")
    parser.add_argument("--cases", default="", help="Optional JSON file with [{id,prompt,config}] cases.")
    parser.add_argument("--limit", type=int, default=8, help="Maximum cases to run. Use 0 for all cases.")
    parser.add_argument("--outdir", default="", help="Output directory for generated plans, PPTX files and QA reports.")
    parser.add_argument("--min-score", type=float, default=86.0, help="Minimum average score for the batch.")
    parser.add_argument("--min-pass-rate", type=float, default=0.88, help="Minimum case pass rate, 0-1.")
    parser.add_argument("--require-pdf-visual", action="store_true", help="Fail cases when PPTX->PDF visual QA is unavailable.")
    args = parser.parse_args()

    outdir = Path(args.outdir) if args.outdir else Path(tempfile.mkdtemp(prefix="aippt-batch-quality-"))
    outdir.mkdir(parents=True, exist_ok=True)
    cases = load_cases(args.cases or None)
    if args.limit and args.limit > 0:
        cases = cases[: args.limit]

    case_reports = [_run_case(case, outdir, require_pdf_visual=bool(args.require_pdf_visual)) for case in cases]
    scores = [float(report["score"]["score"]) for report in case_reports]
    pass_count = sum(1 for report in case_reports if report.get("ok"))
    average_score = round(sum(scores) / len(scores), 2) if scores else 0.0
    pass_rate = round(pass_count / len(case_reports), 4) if case_reports else 0.0
    layout_varieties = [report["score"]["stats"]["contentLayoutVariety"] for report in case_reports]
    template_varieties = [report["score"]["stats"]["contentTemplateVariety"] for report in case_reports]
    chart_like = [report["score"]["charts"]["chartLikeSlideCount"] for report in case_reports]
    all_penalties = [
        {"caseId": report["caseId"], **penalty}
        for report in case_reports
        for penalty in report["score"].get("penalties", [])
    ]
    failed_cases = [
        {
            "caseId": report["caseId"],
            "score": report["score"]["score"],
            "penalties": report["score"].get("penalties", [])[:8],
        }
        for report in case_reports
        if not report.get("ok")
    ]
    report = {
        "ok": average_score >= args.min_score and pass_rate >= args.min_pass_rate and not failed_cases,
        "outdir": str(outdir),
        "caseCount": len(case_reports),
        "passCount": pass_count,
        "passRate": pass_rate,
        "averageScore": average_score,
        "minScore": min(scores) if scores else 0,
        "thresholds": {
            "minAverageScore": args.min_score,
            "minPassRate": args.min_pass_rate,
            "requirePdfVisual": bool(args.require_pdf_visual),
        },
        "aggregate": {
            "avgContentLayoutVariety": round(sum(layout_varieties) / len(layout_varieties), 2) if layout_varieties else 0,
            "avgContentTemplateVariety": round(sum(template_varieties) / len(template_varieties), 2) if template_varieties else 0,
            "avgChartLikeSlides": round(sum(chart_like) / len(chart_like), 2) if chart_like else 0,
            "penaltyCounts": dict(Counter(str(item["key"]) for item in all_penalties)),
        },
        "failedCases": failed_cases,
        "cases": [
            {
                "caseId": report["caseId"],
                "ok": report["ok"],
                "score": report["score"]["score"],
                "slides": report["score"]["stats"]["slideCount"],
                "layoutVariety": report["score"]["stats"]["contentLayoutVariety"],
                "templateVariety": report["score"]["stats"]["contentTemplateVariety"],
                "chartLikeSlides": report["score"]["charts"]["chartLikeSlideCount"],
                "nativeChartCount": report["score"]["charts"]["nativeChartCount"],
                "twoColumnShare": report["score"]["stats"]["twoColumnShare"],
                "pptxPdfVisual": report["pptx_pdf_visual"],
                "report": str(outdir / report["caseId"] / "case.qa.json"),
            }
            for report in case_reports
        ],
    }
    report_path = outdir / "aippt-batch-quality.report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
