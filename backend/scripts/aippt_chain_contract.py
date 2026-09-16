#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import (  # noqa: E402
    _build_aippt_pptx,
    _presentation_config_from_input,
    _presentation_prepare_delivery_plan,
    _presentation_spec_lock_route_drifts,
    _presentation_template_id_for_slide,
    _validate_aippt_pptx_package,
)


def _assert_no_three(values: list[str], label: str) -> None:
    for idx in range(len(values) - 2):
        if values[idx] and values[idx] == values[idx + 1] == values[idx + 2]:
            raise AssertionError(f"{label} repeated on slides {idx + 1}-{idx + 3}: {values[idx]}")


def _sample_plan() -> dict:
    chart_spec = {
        "type": "line",
        "templateId": "line_chart",
        "title": "增长趋势",
        "chart": {
            "kind": "line",
            "labels": ["M1", "M2", "M3", "M4"],
            "series": [{"name": "效率", "values": [32, 41, 57, 68], "unit": "%"}],
            "source": "contract smoke fixture",
            "methodology": "演示样例数据，仅用于链路验证",
            "estimated": True,
        },
        "metrics": [
            {"label": "效率", "value": "68%", "detail": "M4 样例"},
            {"label": "覆盖", "value": "42%", "detail": "M4 样例"},
        ],
    }
    return {
        "title": "AIPPT 链路合约验证",
        "sections": [
            {"id": "s1", "title": "开场", "purpose": "说明目标"},
            {"id": "s2", "title": "能力", "purpose": "验证模板"},
        ],
        "knowledge": [
            {"id": "k1", "title": "样例数据", "source": "fixture", "detail": "用于本地合约测试。", "status": "ready"}
        ],
        "slides": [
            {"id": "slide-1", "sectionId": "s1", "index": 1, "title": "链路验证", "headline": "Schema 驱动 HTML 与 PPTX 输出", "bullets": ["旧 deck 兼容", "模板语义锁定"], "visual": "封面", "layout": "cover", "knowledgeIds": ["k1"], "status": "confirmed", "speakerNotes": ""},
            *[
                {"id": f"slide-{idx}", "sectionId": "s2", "index": idx, "title": f"增长趋势 {idx - 1}", "headline": "连续模板会被规范化打散", "bullets": ["效率提升口径", "覆盖率提升口径", "留存趋势口径"], "visual": "折线图 + 指标卡", "layout": "metrics", "knowledgeIds": ["k1"], "status": "draft", "speakerNotes": "", "renderHints": ["chart=line"], "visualSpec": chart_spec}
                for idx in range(2, 5)
            ],
            {"id": "slide-5", "sectionId": "s2", "index": 5, "title": "能力矩阵", "headline": "feature matrix 应落到矩阵模板", "bullets": ["AIPPT：Schema、Renderer、PPTX", "竞品：模板少、导出弱"], "visual": "功能矩阵", "layout": "compare", "knowledgeIds": ["k1"], "status": "draft", "speakerNotes": "", "renderHints": ["chartTemplate=feature_matrix_table"]},
            {"id": "slide-6", "sectionId": "s2", "index": 6, "title": "分层架构", "headline": "架构页保留 layers", "bullets": ["规划层：大纲与 specLock", "渲染层：HTML 与 Designer", "导出层：PPTX 原生形状"], "visual": "三层架构", "layout": "diagram", "knowledgeIds": ["k1"], "status": "draft", "speakerNotes": "", "renderHints": ["chartTemplate=layered_architecture"]},
            {"id": "slide-7", "sectionId": "s2", "index": 7, "title": "生成流程", "headline": "流程页保留 rows", "bullets": ["大纲确认", "逐页扩写", "导出校验"], "visual": "流程图", "layout": "process", "knowledgeIds": ["k1"], "status": "draft", "speakerNotes": ""},
            {"id": "slide-8", "sectionId": "s2", "index": 8, "title": "路线图", "headline": "时间线页保留 roadmap 语义", "bullets": ["第 1 周：模板锁定", "第 2 周：导出校验", "第 3 周：验收"], "visual": "路线图", "layout": "timeline", "knowledgeIds": ["k1"], "status": "draft", "speakerNotes": "", "renderHints": ["chartTemplate=timeline"]},
        ],
        "generatedAt": "2026-06-30T00:00:00.000Z",
    }


def main() -> int:
    config = _presentation_config_from_input("AIPPT 链路合约验证 8页", {
        "topic": "AIPPT 链路合约验证",
        "useCase": "report",
        "pageCount": 8,
        "styleKey": "executive_blue",
        "chartLevel": "rich",
    })
    plan = _presentation_prepare_delivery_plan(_sample_plan(), config)
    slides = [slide for slide in plan.get("slides", []) if isinstance(slide, dict)]
    spec_lock = plan.get("specLock") if isinstance(plan.get("specLock"), dict) else {}
    if spec_lock.get("version") != "aippt-spec-lock-v2":
        raise AssertionError("specLock.version is not aippt-spec-lock-v2")
    if len((spec_lock.get("layoutPlan") or {}).get("pages") or []) != len(slides):
        raise AssertionError("layoutPlan pages do not match slides")
    if len(spec_lock.get("pageTemplates") or {}) != len(slides):
        raise AssertionError("pageTemplates do not cover all slides")
    if not all((slide.get("visualSpec") or {}).get("templateId") for slide in slides):
        raise AssertionError("some slides lost visualSpec.templateId")
    route_drifts = _presentation_spec_lock_route_drifts(plan)
    if route_drifts:
        raise AssertionError(f"specLock route drift: {json.dumps(route_drifts[:4], ensure_ascii=False)}")

    layouts = [str(slide.get("layout") or "") for slide in slides]
    templates = [_presentation_template_id_for_slide(slide, str(slide.get("layout") or "")) for slide in slides]
    _assert_no_three(layouts, "layout")
    _assert_no_three(templates, "template")

    pptx = _build_aippt_pptx(plan, config)
    report = _validate_aippt_pptx_package(pptx, plan, config)
    if not report.get("ok"):
        raise AssertionError(json.dumps(report.get("errors") or report, ensure_ascii=False))
    with zipfile.ZipFile(io.BytesIO(pptx)) as zf:
        slide_xml = [name for name in zf.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml")]
        if len(slide_xml) != len(slides):
            raise AssertionError(f"pptx slide count mismatch: {len(slide_xml)} != {len(slides)}")

    print(json.dumps({
        "ok": True,
        "slides": len(slides),
        "layouts": layouts,
        "templates": templates,
        "specLockVersion": spec_lock.get("version"),
        "specLockRouteDrift": route_drifts,
        "nativeChartCount": report.get("native_chart_count"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
