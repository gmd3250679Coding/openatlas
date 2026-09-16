#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path


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
    _presentation_prepare_delivery_plan,
    _presentation_template_id_for_slide,
    _validate_aippt_pptx_package,
)


CORE_TEMPLATE_SLOTS = [
    ("cover", "cover"),
    ("section", "section"),
    ("quote", "quote"),
    ("kpi_cards", "kpi_cards"),
    ("hero_metric", "hero_metric"),
    ("metric_dashboard", "metric_dashboard"),
    ("bullet_chart", "bullet_chart"),
    ("line_chart", "line_chart"),
    ("multi_line_chart", "multi_line_chart"),
    ("bar_chart", "bar_chart"),
    ("grouped_bar_chart", "grouped_bar_chart"),
    ("horizontal_bar_chart", "horizontal_bar_chart"),
    ("waterfall_chart", "waterfall_chart"),
    ("funnel_chart", "funnel_chart"),
    ("comparison_table", "comparison_table"),
    ("comparison_columns", "comparison_columns"),
    ("feature_matrix_table", "feature_matrix_table"),
    ("quadrant_text_bullets", "quadrant_text_bullets"),
    ("matrix_2x2", "matrix_2x2"),
    ("layered_architecture", "layered_architecture"),
    ("hub_spoke", "hub_spoke"),
    ("system_map", "system_map"),
    ("journey_map", "journey_map"),
    ("process_flow", "process_flow"),
    ("pipeline_with_stages", "pipeline_with_stages"),
    ("numbered_steps", "numbered_steps"),
    ("agenda_list", "agenda_list"),
    ("timeline", "timeline"),
    ("roadmap_vertical", "roadmap_vertical"),
    ("gantt_chart", "gantt_chart"),
    ("business_model_canvas", "business_model_canvas"),
    ("unit_economics", "unit_economics"),
    ("case_study_cards", "case_study_cards"),
]


def _slide(
    index: int,
    template_id: str,
    layout: str,
    title: str,
    headline: str,
    bullets: list[str],
    visual: str,
    visual_spec: dict,
    *,
    section_id: str = "gallery-core",
) -> dict:
    spec = {
        "templateId": template_id,
        "chartTemplate": template_id,
        **visual_spec,
    }
    return {
        "id": f"gallery-{index:02d}-{template_id}",
        "sectionId": section_id,
        "index": index,
        "title": title,
        "headline": headline,
        "bullets": bullets,
        "visual": visual,
        "layout": layout,
        "knowledgeIds": ["k-gallery"],
        "status": "confirmed",
        "speakerNotes": "AIPPT Round 2 模板画廊合约样例，用于 PPTX 原生导出与 QA。",
        "renderHints": [f"chartTemplate={template_id}", "rhythm=dense"],
        "visualSpec": spec,
        "evidenceRole": "本页为本地 QA fixture，数值为演示口径，不作为业务结论。",
    }


def build_gallery_config() -> dict:
    page_count = len(CORE_TEMPLATE_SLOTS)
    return _presentation_config_from_input(f"AIPPT 核心模板 PPTX 原生还原画廊 {page_count}页", {
        "topic": "AIPPT 核心模板 PPTX 原生还原画廊",
        "useCase": "report",
        "aspectRatio": "16:9",
        "styleKey": "executive_blue",
        "audience": "OpenAtlas AIPPT QA",
        "durationMinutes": 18,
        "pageCount": page_count,
        "density": "dense",
        "chartLevel": "rich",
        "speakerNotes": True,
    })


def build_gallery_plan() -> dict:
    return {
        "title": "AIPPT 核心模板 PPTX 原生还原画廊",
        "sections": [
            {"id": "gallery-opening", "title": "叙事页面", "purpose": "覆盖封面、章节和金句页。"},
            {"id": "gallery-core", "title": "核心图形模板", "purpose": "覆盖指标、图表、矩阵、架构、流程和时间线。"},
        ],
        "knowledge": [
            {
                "id": "k-gallery",
                "title": "AIPPT Round 2 QA Fixture",
                "source": "backend/scripts/aippt_template_gallery.py",
                "detail": "覆盖核心模板、原生图表、原生形状、长中文文本换行和 PPTX 包验证。",
                "status": "ready",
            }
        ],
        "slides": [
            _slide(
                1,
                "cover",
                "cover",
                "AIPPT 原生模板画廊",
                "用一组可复现样例验证 HTML 语义到 PPTX 可编辑形状的还原质量",
                ["Spec Lock v2", "模板 registry", "PPTX native shapes/charts"],
                "封面主视觉",
                {"type": "generic", "title": "核心模板覆盖"},
                section_id="gallery-opening",
            ),
            _slide(
                2,
                "kpi_cards",
                "metrics",
                "KPI 卡片组",
                "独立指标卡要保持数字、口径和标签都可编辑",
                ["转化率 18.6%", "自动化节省 42小时", "覆盖门店 128家", "满意度 94%"],
                "四张 KPI 卡片",
                {
                    "type": "scorecard",
                    "metrics": [
                        {"label": "转化率", "value": "18.6%", "detail": "演示口径：核心漏斗转化"},
                        {"label": "节省工时", "value": "42", "unit": "小时", "detail": "每周运营重复动作"},
                        {"label": "覆盖门店", "value": "128", "unit": "家", "detail": "已接入门店范围"},
                        {"label": "满意度", "value": "94%", "detail": "用户反馈样例"},
                    ],
                },
            ),
            _slide(
                3,
                "comparison_columns",
                "compare",
                "方案列对比",
                "并排列卡表达不同服务层级和推荐路径",
                ["基础版：看板与下载", "专业版：协同编辑与 QA", "企业版：私有知识库和审计"],
                "三列方案对比",
                {
                    "type": "matrix",
                    "columns": [
                        {"label": "基础版", "items": ["HTML 预览", "基础下载", "轻量演示"]},
                        {"label": "专业版", "items": ["Designer 编辑", "PPTX QA", "团队协作"]},
                        {"label": "企业版", "items": ["权限审计", "知识库接入", "模板治理"]},
                    ],
                },
            ),
            _slide(
                4,
                "layered_architecture",
                "diagram",
                "分层架构",
                "规划、渲染、导出与 QA 分层清晰，每层都是可编辑文本和形状",
                ["需求输入层：用户目标与资料", "Schema 层：DeckPlan 与 Spec Lock", "渲染层：HTML 与 Designer", "导出层：PPTX 与 QA"],
                "四层架构图",
                {
                    "type": "architecture",
                    "layers": [
                        {"label": "需求输入层", "detail": "用户目标、资料、受众与演示场景"},
                        {"label": "Schema 层", "detail": "DeckPlan、DeckConfig、Spec Lock v2"},
                        {"label": "渲染层", "detail": "HTML 预览、Designer 编辑、模板语义"},
                        {"label": "导出层", "detail": "PPTX 原生图表、形状和 QA 报告"},
                    ],
                    "callouts": ["可审计", "可回退"],
                },
            ),
            _slide(
                5,
                "process_flow",
                "process",
                "生成到导出的流程",
                "流程页要在 3-8 步之间保持编号、节点和说明不溢出",
                ["确认需求：锁定主题、受众和页数", "生成大纲：保留真实草案和 warnings", "补齐 visualSpec：同步模板和数据", "导出 PPTX：生成原生 shape/chart", "运行 QA：检查包结构和潜在溢出"],
                "五步流程图",
                {
                    "type": "process",
                    "rows": [
                        {"label": "确认需求", "detail": "锁定主题、受众和页数"},
                        {"label": "生成大纲", "detail": "保留真实 Hermes 草案和 warnings"},
                        {"label": "补齐 visualSpec", "detail": "同步模板语义和图表数据"},
                        {"label": "导出 PPTX", "detail": "生成可编辑原生 shape/chart"},
                        {"label": "运行 QA", "detail": "检查包结构、重复模板和潜在溢出"},
                    ],
                },
            ),
            _slide(
                6,
                "timeline",
                "timeline",
                "Timeline Roadmap",
                "横向里程碑表达路线图，保持阶段说明可编辑并尽量少溢出",
                ["R1：Spec Lock 和 registry 落地", "R2：PPTX 原生还原与 QA 样例库", "R3：真实数据接入和视觉验收", "GA：模板治理与团队发布"],
                "路线图时间线",
                {
                    "type": "roadmap",
                    "rows": [
                        {"label": "R1", "detail": "Spec Lock 和 registry 落地"},
                        {"label": "R2", "detail": "PPTX 原生还原与 QA 样例库"},
                        {"label": "R3", "detail": "真实数据接入和视觉验收"},
                        {"label": "GA", "detail": "模板治理与团队发布"},
                    ],
                },
            ),
            _slide(
                7,
                "section",
                "section",
                "第二组：数据与判断",
                "章节页用于分隔不同叙事段落，并保持大字号文本安全",
                ["原生 chart", "原生 shape", "QA loop"],
                "章节转场",
                {"type": "generic", "title": "章节转场"},
                section_id="gallery-opening",
            ),
            _slide(
                8,
                "metric_dashboard",
                "metrics",
                "指标看板",
                "主指标和辅助指标形成高管看板，长中文口径要自动缩放",
                ["主指标 128%", "交付准时率 96%", "内容可编辑率 100%", "导出告警 0"],
                "主指标 + 辅助指标",
                {
                    "type": "scorecard",
                    "metrics": [
                        {"label": "PPTX 可编辑率", "value": "100%", "detail": "核心模板均使用文本框、shape 或原生 chart"},
                        {"label": "导出成功率", "value": "99%", "detail": "结构级包验证样例"},
                        {"label": "潜在溢出", "value": "0", "unit": "项", "detail": "基于文本预算估算"},
                        {"label": "原生图表", "value": "2", "unit": "页", "detail": "line + grouped bar"},
                    ],
                },
            ),
            _slide(
                9,
                "feature_matrix_table",
                "compare",
                "能力矩阵表",
                "矩阵表要导出为 PPTX 原生网格，而不是整张图片",
                ["OpenAtlas：Spec Lock、Designer、PPTX QA、模板治理", "通用 Agent：大纲生成、弱模板、导出不可控", "传统模板工具：手工编辑、缺少生成链路"],
                "功能矩阵",
                {
                    "type": "matrix",
                    "columns": [
                        {"label": "OpenAtlas", "score": "high", "items": ["Spec Lock", "Designer", "PPTX QA", "模板治理"]},
                        {"label": "通用 Agent", "score": "medium", "items": ["大纲生成", "弱模板", "导出不可控"]},
                        {"label": "传统工具", "score": "low", "items": ["手工编辑", "静态模板"]},
                    ],
                    "description": "用单元格表达能力覆盖情况。",
                },
            ),
            _slide(
                10,
                "line_chart",
                "metrics",
                "折线趋势",
                "趋势页需要生成真正的 PowerPoint chart part，并保留来源和口径说明",
                ["MRR 205万", "Pipeline 188万", "留存率 94%"],
                "折线图 + 指标卡",
                {
                    "type": "line",
                    "title": "增长质量趋势",
                    "chart": {
                        "kind": "line",
                        "labels": ["1月", "2月", "3月", "4月", "5月"],
                        "series": [
                            {"name": "MRR", "values": [120, 148, 171, 205, 232], "unit": "万"},
                            {"name": "Pipeline", "values": [80, 96, 140, 188, 216], "unit": "万"},
                        ],
                        "source": "AIPPT gallery fixture",
                        "methodology": "演示数据，仅用于导出 QA",
                        "estimated": True,
                    },
                    "metrics": [
                        {"label": "NDR", "value": "128%", "detail": "净收入留存"},
                        {"label": "留存率", "value": "94%", "detail": "客户留存"},
                    ],
                },
            ),
            _slide(
                11,
                "quote",
                "quote",
                "关键判断",
                "PPTX 原生还原的目标不是替代 PowerPoint，而是让核心模板打开即可继续编辑",
                ["可编辑", "少溢出", "语义一致"],
                "收束金句",
                {"type": "generic", "title": "关键判断"},
                section_id="gallery-opening",
            ),
            _slide(
                12,
                "grouped_bar_chart",
                "metrics",
                "分组柱状图",
                "多序列分类对比也要生成原生 chart，并保留指标卡摘要",
                ["开放率增长 21%", "二次编辑率增长 37%", "QA 通过率增长 44%"],
                "分组柱状图",
                {
                    "type": "bar",
                    "title": "模板链路改进效果",
                    "chart": {
                        "kind": "bar",
                        "labels": ["HTML", "Designer", "PPTX", "QA"],
                        "series": [
                            {"name": "Round 1", "values": [68, 72, 54, 61], "unit": "%"},
                            {"name": "Round 2", "values": [78, 82, 86, 91], "unit": "%"},
                        ],
                        "source": "AIPPT gallery fixture",
                        "methodology": "演示数据，仅用于趋势表达",
                        "estimated": True,
                    },
                    "metrics": [
                        {"label": "PPTX 形状", "value": "86%", "detail": "核心场景 native"},
                        {"label": "QA 覆盖", "value": "91%", "detail": "结构与溢出扫描"},
                    ],
                },
            ),
        ],
        "generatedAt": "2026-06-30T00:00:00.000Z",
    }


def _metric_fixture() -> list[dict]:
    return [
        {"label": "效率提升", "value": "42", "unit": "%", "detail": "平均生成到确认耗时下降"},
        {"label": "可编辑率", "value": "96", "unit": "%", "detail": "PPTX 原生文本和形状占比"},
        {"label": "返工下降", "value": "31", "unit": "%", "detail": "二次排版修改减少"},
        {"label": "覆盖模板", "value": len(CORE_TEMPLATE_SLOTS), "unit": "个", "detail": "核心模板 QA 样例"},
    ]


def _chart_fixture(kind: str = "line", *, multi: bool = False) -> dict:
    if kind == "line":
        return {
            "kind": "line",
            "labels": ["1月", "2月", "3月", "4月", "5月", "6月"],
            "series": [
                {"name": "生成质量", "values": [62, 70, 78, 84, 88, 92], "unit": "分"},
                *([{"name": "导出质量", "values": [48, 56, 67, 76, 83, 89], "unit": "分"}] if multi else []),
            ],
            "source": "AIPPT gallery fixture",
            "methodology": "演示数据，用于 QA 与版式验收",
            "estimated": True,
        }
    return {
        "kind": "bar",
        "labels": ["规划", "设计", "导出", "QA"],
        "series": [
            {"name": "Round 2", "values": [86, 82, 79, 91], "unit": "%"},
            *([{"name": "Round 3", "values": [92, 89, 87, 95], "unit": "%"}] if multi else []),
        ],
        "source": "AIPPT gallery fixture",
        "methodology": "演示数据，用于 QA 与版式验收",
        "estimated": True,
    }


def _columns_fixture() -> list[dict]:
    return [
        {"label": "OpenAtlas", "score": "high", "items": ["Spec Lock", "HTML 预览", "Designer 编辑", "PPTX QA"]},
        {"label": "传统模板", "score": "medium", "items": ["静态版式", "手工排版", "弱数据结构"]},
        {"label": "通用 Agent", "score": "low", "items": ["文本生成", "缺导出纪律", "弱编辑链路"]},
    ]


def _rows_fixture() -> list[dict]:
    return [
        {"label": "需求配置", "detail": "锁定主题、受众、页数、风格和数据密度"},
        {"label": "大纲画布", "detail": "先生成可确认的章节和页面节点"},
        {"label": "Schema 生成", "detail": "为每页补齐 layout、templateId 和 visualSpec"},
        {"label": "HTML 预览", "detail": "同一份 Deck Schema 解释渲染"},
        {"label": "PPTX 导出", "detail": "尽量使用原生 chart 和 shape"},
        {"label": "QA 拦截", "detail": "检查重复、溢出和包结构"},
    ]


def _layers_fixture() -> list[dict]:
    return [
        {"label": "输入层", "detail": "用户目标、材料、知识和约束"},
        {"label": "规划层", "detail": "章节、叙事节奏和页面角色"},
        {"label": "模板层", "detail": "templateId、chartTemplate、visualSpec"},
        {"label": "渲染层", "detail": "HTML、Designer、PPTX exporter"},
        {"label": "验收层", "detail": "QA report、版本、回退和下载"},
    ]


def _gallery_slide_case(index: int, template_id: str, layout: str, title: str, headline: str, visual: str, spec: dict, bullets: list[str] | None = None, *, section_id: str = "gallery-v2") -> dict:
    return _slide(
        index,
        template_id,
        layout,
        title,
        headline,
        bullets or [
            "同一份 Deck Schema 驱动 HTML 预览、Designer 和 PPTX 导出",
            "模板需包含可编辑文本、可复用版式和明确的数据口径",
            "QA 会检查连续重复、潜在溢出、原生图表和 PPTX 包结构",
        ],
        visual,
        spec,
        section_id=section_id,
    )


def build_gallery_plan_v2() -> dict:
    cases = [
        ("cover", "cover", "AIPPT 模板能力画廊", "33 个模板进入同一条 Schema 到 PPTX 的验收链路", "封面主张页", {"type": "generic", "title": "模板能力画廊"}, "gallery-opening"),
        ("kpi_cards", "metrics", "KPI 卡片组", "多指标卡片要保持数字、标签和口径都可编辑", "四张 KPI 卡片", {"type": "scorecard", "metrics": _metric_fixture()}, "gallery-metrics"),
        ("comparison_table", "compare", "比较表", "密集对比表用于产品能力、方案差异和服务层级", "横向比较表", {"type": "matrix", "columns": _columns_fixture()}, "gallery-compare"),
        ("layered_architecture", "diagram", "分层架构", "把生成、渲染、编辑和导出拆成可解释能力层", "五层架构图", {"type": "architecture", "layers": _layers_fixture(), "callouts": ["可审计", "可回退"]}, "gallery-diagram"),
        ("process_flow", "process", "端到端流程", "从需求配置到 QA 拦截形成稳定链路纪律", "流程图", {"type": "process", "rows": _rows_fixture()}, "gallery-process"),
        ("line_chart", "metrics", "单趋势折线", "单序列趋势页要输出原生 PowerPoint chart", "折线图", {"type": "line", "chart": _chart_fixture("line"), "metrics": _metric_fixture()[:2]}, "gallery-metrics"),
        ("section", "section", "第二章：模板扩展", "叙事页负责建立节奏，而不是堆卡片", "章节转场", {"type": "generic", "title": "模板扩展"}, "gallery-opening"),
        ("hero_metric", "metrics", "Hero Metric", "一页只突出一个最关键数字，并保留解释口径", "超大数字卡", {"type": "scorecard", "metrics": [{"label": "核心模板覆盖", "value": len(CORE_TEMPLATE_SLOTS), "unit": "个", "detail": "进入自动 gallery 与 QA 门禁"}]}, "gallery-metrics"),
        ("comparison_columns", "compare", "方案列对比", "并排列卡表达不同套餐或阶段方案", "三列方案卡", {"type": "matrix", "columns": _columns_fixture()}, "gallery-compare"),
        ("metric_dashboard", "metrics", "指标仪表盘", "主指标加辅助指标形成高管看板", "主指标 + 辅助指标", {"type": "scorecard", "metrics": _metric_fixture()}, "gallery-metrics"),
        ("hub_spoke", "diagram", "中心辐射图", "一个核心能力连接多项周边组件", "中心辐射图", {"type": "architecture", "title": "AIPPT Core", "layers": _layers_fixture()[:6]}, "gallery-diagram"),
        ("pipeline_with_stages", "process", "阶段管线", "适合销售、实施、数据处理和发布流程", "阶段管线", {"type": "process", "rows": _rows_fixture()[:5]}, "gallery-process"),
        ("timeline", "timeline", "横向时间线", "阶段节点和里程碑要有清晰时间顺序", "时间线", {"type": "timeline", "rows": _rows_fixture()[:5]}, "gallery-timeline"),
        ("quote", "quote", "关键判断", "好模板不是静态皮肤，而是可编辑、可验收、可复用的页面语义", "收束金句", {"type": "generic", "title": "关键判断"}, "gallery-opening"),
        ("grouped_bar_chart", "metrics", "分组柱状图", "多序列分类对比输出原生 chart", "分组柱状图", {"type": "bar", "chart": _chart_fixture("bar", multi=True), "metrics": _metric_fixture()[:2]}, "gallery-metrics"),
        ("feature_matrix_table", "compare", "能力矩阵", "能力 checklist 以原生表格化形状输出", "能力矩阵", {"type": "matrix", "columns": _columns_fixture(), "description": "以强/部分/待补表达能力覆盖。"}, "gallery-compare"),
        ("system_map", "diagram", "系统地图", "用中心能力和模块关系表达平台结构", "系统地图", {"type": "architecture", "title": "OpenAtlas", "layers": _layers_fixture()[:6]}, "gallery-diagram"),
        ("journey_map", "process", "用户旅程", "按阶段表达用户从输入需求到下载交付的体验路径", "旅程图", {"type": "process", "rows": _rows_fixture()[:6]}, "gallery-process"),
        ("roadmap_vertical", "timeline", "纵向路线图", "适合季度、月份和版本计划", "纵向路线图", {"type": "roadmap", "rows": _rows_fixture()[:5]}, "gallery-timeline"),
        ("bullet_chart", "metrics", "目标达成卡", "目标、实际、差距和口径用紧凑指标表达", "目标达成", {"type": "scorecard", "metrics": _metric_fixture()[:4]}, "gallery-metrics"),
        ("quadrant_text_bullets", "compare", "四象限判断", "用影响和投入拆解优先级选择", "四象限", {"type": "matrix", "columns": [{"label": "高影响低投入", "items": ["优先上线", "模板 QA"]}, {"label": "高影响高投入", "items": ["Designer 深编辑", "PPTX 兼容"]}, {"label": "低影响低投入", "items": ["提示微调"]}, {"label": "低影响高投入", "items": ["暂缓"]}]}, "gallery-compare"),
        ("business_model_canvas", "diagram", "商业模式画布", "九宫格表达产品化、客户、收入和成本结构", "商业画布", {"type": "matrix", "columns": _columns_fixture()}, "gallery-diagram"),
        ("numbered_steps", "process", "编号步骤", "适合操作指南、培训流程和实施任务", "编号步骤", {"type": "process", "rows": _rows_fixture()[:4]}, "gallery-process"),
        ("multi_line_chart", "metrics", "多趋势折线", "多序列趋势对比要保留图例和数据来源", "多序列折线", {"type": "line", "chart": _chart_fixture("line", multi=True), "metrics": _metric_fixture()[:2]}, "gallery-metrics"),
        ("matrix_2x2", "compare", "二维矩阵", "战略定位或优先级判断用二维象限呈现", "2x2 矩阵", {"type": "matrix", "columns": [{"label": "高价值", "items": ["高优先级模板"]}, {"label": "高复杂", "items": ["导出兼容"]}, {"label": "低复杂", "items": ["快速交付"]}, {"label": "观察项", "items": ["暂缓"]}]}, "gallery-compare"),
        ("unit_economics", "metrics", "单位经济模型", "CAC、LTV、毛利和回收期用经营看板表达", "单位经济指标", {"type": "scorecard", "metrics": [{"label": "CAC", "value": "1.8", "unit": "万", "detail": "获客成本"}, {"label": "LTV", "value": "12.6", "unit": "万", "detail": "客户生命周期价值"}, {"label": "毛利率", "value": "72", "unit": "%", "detail": "订阅服务毛利"}, {"label": "回收期", "value": "5.2", "unit": "月", "detail": "成本回收周期"}]}, "gallery-metrics"),
        ("agenda_list", "checklist", "议程列表", "培训、会议和评审用清单式信息组织", "议程清单", {"type": "process", "rows": _rows_fixture()[:5]}, "gallery-process"),
        ("bar_chart", "metrics", "单序列柱状图", "分类对比用原生 PowerPoint chart 输出", "单序列柱状图", {"type": "bar", "chart": _chart_fixture("bar"), "metrics": _metric_fixture()[:2]}, "gallery-metrics"),
        ("funnel_chart", "metrics", "转化漏斗", "线索到成交按阶段收敛表达", "漏斗图", {"type": "bar", "metrics": [{"label": "访问", "value": "10000", "unit": "次", "detail": "入口流量"}, {"label": "注册", "value": "3200", "unit": "人", "detail": "注册用户"}, {"label": "试用", "value": "980", "unit": "人", "detail": "进入试用"}, {"label": "成交", "value": "186", "unit": "单", "detail": "付费客户"}]}, "gallery-metrics"),
        ("gantt_chart", "timeline", "甘特排期", "任务持续时间、依赖和里程碑用时间轴表达", "甘特图", {"type": "timeline", "rows": _rows_fixture()[:6]}, "gallery-timeline"),
        ("horizontal_bar_chart", "metrics", "横向排名条", "长标签排行和占比对比用横向柱图", "横向柱状图", {"type": "bar", "chart": _chart_fixture("bar"), "metrics": _metric_fixture()}, "gallery-metrics"),
        ("waterfall_chart", "metrics", "瀑布桥图", "收入、成本或效果拆解要能表达正负贡献", "瀑布图", {"type": "bar", "metrics": [{"label": "基线收入", "value": "120", "unit": "万", "detail": "期初收入"}, {"label": "新增", "value": "36", "unit": "万", "detail": "新客户贡献"}, {"label": "扩展", "value": "18", "unit": "万", "detail": "老客户扩容"}, {"label": "流失", "value": "-12", "unit": "万", "detail": "客户流失"}, {"label": "期末收入", "value": "162", "unit": "万", "detail": "期末收入"}]}, "gallery-metrics"),
        ("case_study_cards", "two_column", "案例卡片组", "客户场景、问题、方案和结果用卡片表达", "案例卡片", {"type": "generic", "columns": [{"label": "制造客户", "items": ["流程自动化", "节省 36 小时"]}, {"label": "金融客户", "items": ["审计可追溯", "合规效率提升"]}, {"label": "零售客户", "items": ["门店运营", "培训材料复用"]}]}, "gallery-proof"),
    ]
    slides = [
        _gallery_slide_case(index, template_id, layout, title, headline, visual, spec, section_id=section_id)
        for index, (template_id, layout, title, headline, visual, spec, section_id) in enumerate(cases, start=1)
    ]
    return {
        "title": "AIPPT 核心模板 PPTX 原生还原画廊",
        "sections": [
            {"id": "gallery-opening", "title": "叙事页面", "purpose": "覆盖封面、章节和金句页。"},
            {"id": "gallery-metrics", "title": "指标与图表", "purpose": "覆盖 KPI、趋势、分类、漏斗和财务拆解。"},
            {"id": "gallery-compare", "title": "对比与矩阵", "purpose": "覆盖对比列、矩阵表、四象限和 2x2。"},
            {"id": "gallery-diagram", "title": "架构与模型", "purpose": "覆盖分层、中心辐射、系统图和商业画布。"},
            {"id": "gallery-process", "title": "流程与清单", "purpose": "覆盖流程、管线、编号步骤、议程和旅程。"},
            {"id": "gallery-timeline", "title": "时间线", "purpose": "覆盖路线图、时间线和甘特。"},
            {"id": "gallery-proof", "title": "案例证明", "purpose": "覆盖案例卡片和证明材料。"},
        ],
        "knowledge": [
            {
                "id": "k-gallery",
                "title": "AIPPT Round 3 QA Fixture",
                "source": "backend/scripts/aippt_template_gallery.py",
                "detail": "覆盖 30+ 核心模板、原生图表、原生形状、长中文文本换行和 PPTX 包验证。",
                "status": "ready",
            }
        ],
        "slides": slides,
        "generatedAt": "2026-06-30T00:00:00.000Z",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the AIPPT core template gallery and QA report.")
    parser.add_argument("--outdir", default="", help="Output directory for DeckConfig, DeckPlan, PPTX and QA report.")
    args = parser.parse_args()

    outdir = Path(args.outdir) if args.outdir else Path(tempfile.mkdtemp(prefix="aippt-template-gallery-"))
    outdir.mkdir(parents=True, exist_ok=True)

    config = build_gallery_config()
    plan = _presentation_prepare_delivery_plan(build_gallery_plan_v2(), config)
    slides = [slide for slide in plan.get("slides", []) if isinstance(slide, dict)]
    templates = [_presentation_template_id_for_slide(slide, str(slide.get("layout") or "")) for slide in slides]
    requested_templates = [template_id for _, template_id in CORE_TEMPLATE_SLOTS]
    missing = sorted(set(requested_templates) - set(templates))

    config_path = outdir / "aippt-template-gallery.config.json"
    plan_path = outdir / "aippt-template-gallery.plan.json"
    pptx_path = outdir / "aippt-template-gallery.pptx"
    report_path = outdir / "aippt-template-gallery.qa.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    pptx_path.write_bytes(_build_aippt_pptx(plan, config))

    package_report = _validate_aippt_pptx_package(pptx_path.read_bytes(), plan, config)
    pptx_pdf_ok, pptx_pdf_log = convert_to_pdf(pptx_path, outdir)
    pptx_pdf_gate_ok = pptx_pdf_ok or pdf_conversion_unavailable(pptx_pdf_log)
    if pptx_pdf_ok:
        pptx_pdf_visual = analyze_pdf_visual(outdir / "aippt-template-gallery.pdf", expected_pages=len(slides))
    else:
        pptx_pdf_visual = {
            "ok": False,
            "gateOk": pptx_pdf_gate_ok,
            "skipped": pdf_conversion_unavailable(pptx_pdf_log),
            "pdf": str(outdir / "aippt-template-gallery.pdf"),
            "issues": [] if pptx_pdf_gate_ok else [{"type": "pdf_conversion_failed", "message": pptx_pdf_log}],
            "warnings": [],
            "pages": [],
        }
    summary = build_qa_summary(plan, package_report, pptx_pdf_ok=pptx_pdf_ok)
    summary["coreTemplateSlots"] = [{"slot": slot, "templateId": template_id} for slot, template_id in CORE_TEMPLATE_SLOTS]
    summary["missingCoreTemplates"] = missing
    summary["pptxPdfVisual"] = {
        "gateOk": bool(pptx_pdf_visual.get("gateOk")),
        "skipped": bool(pptx_pdf_visual.get("skipped")),
        "pageCount": pptx_pdf_visual.get("pageCount"),
        "expectedPageCount": pptx_pdf_visual.get("expectedPageCount"),
        "issueCount": len(pptx_pdf_visual.get("issues") or []),
        "warningCount": len(pptx_pdf_visual.get("warnings") or []),
    }

    report = {
        "ok": bool(package_report.get("ok")) and pptx_pdf_gate_ok and bool(pptx_pdf_visual.get("gateOk")) and not missing,
        "outdir": str(outdir),
        "config": str(config_path),
        "plan": str(plan_path),
        "pptx": str(pptx_path),
        "pptx_pdf": {
            "ok": pptx_pdf_ok,
            "gateOk": pptx_pdf_gate_ok,
            "skipped": pdf_conversion_unavailable(pptx_pdf_log),
            "log": pptx_pdf_log,
            "pdf": str(outdir / "aippt-template-gallery.pdf"),
        },
        "pptx_pdf_visual": pptx_pdf_visual,
        "summary": summary,
        "package": package_report,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
