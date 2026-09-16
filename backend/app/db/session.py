"""DB session + auto-init (no alembic for MVP)."""
from __future__ import annotations

import json
import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import OPENATLAS_HOME, SQLITE_PATH
from app.core.config import (
    DEFAULT_ADMIN_EMAIL,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_TENANT_NAME,
    DEFAULT_TENANT_SLUG,
)
from app.core.security import hash_password
from app.db.models import (
    Base,
    CanvasEvent,
    CollaborationTemplate,
    ContractDocument,
    ContractReviewIssue,
    ContractVersion,
    ContextInjection,
    DigitalEmployee,
    EmployeeStatus,
    FileAsset,
    HermesRuntime,
    MessageRecord,
    OrganizationUnit,
    PresentationDeckDocument,
    PresentationDeckVersion,
    Scope,
    SessionRecord,
    SessionRunEvent,
    SkillRun,
    SkillPackage,
    TaskArtifact,
    Tenant,
    User,
    UserRole,
    WhiteboardDocument,
    WorkflowCheckpoint,
    WorkflowRunFork,
    WorkflowStepEvent,
)


engine = create_engine(
    f"sqlite:///{SQLITE_PATH}",
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(engine, "connect")
def _enable_sqlite_fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

DEMO_USER_EMAIL = "demo@demo.openatlas"


def _schema(data: dict | list) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


WHITEBOARD_OFFICIAL_LIBRARY_CONTEXT = """Atlas 已预装官方 Excalidraw 素材库（来源 libraries.excalidraw.com / excalidraw-libraries，MIT）：
- Software Architecture: 微服务、数据库、缓存、事件总线等软件架构组件
- System Design Template / Components / Icons: 系统设计模板、服务、存储、流量、估算等组件
- Flow Chart Symbols: 标准流程图符号
- Shapes for UML & ER Diagrams: UML、ER、类图/实体关系符号
- Network topology icons: 网络拓扑、路由、交换、服务器等图标
- Kubernetes Icons Set: Kubernetes 架构图标
- Desktop Resolutions / Wireframing placeholders / HTML input elements: 桌面线框、占位内容、表单控件
- Cloud Design Patterns: 云设计模式组件
生成或精修画布时，必须先输出 asset_plan（key、index、purpose、placement），再把选中的官方素材克隆进 scene.elements；不能只写“建议使用素材库”。
每个克隆素材元素都要保留 customData.atlasLibrarySource、atlasLibraryKey、atlasLibraryItemIndex，输出中用 library_asset_refs 标明实际已使用素材。"""


WHITEBOARD_SKILL_SEEDS = [
    {
        "name": "创意白板生成",
        "slug": "creative-whiteboard-draft",
        "description": "根据自然语言目标生成流程图、PPT 草稿、网络架构图或原型线框的白板初稿。",
        "category": "whiteboard",
        "system_prompt": f"""你是 Atlas 创意白板生成 Skill。你的任务是把用户的业务目标转成可编辑的 Excalidraw 画布初稿。
必须遵守：
1. 优先生成结构清晰、可继续编辑的图，而不是装饰图。
2. 根据 kind 选择图形：flowchart=流程节点与箭头；ppt=多页 16:9 幻灯片故事板；architecture=分层架构；wireframe=产品线框。
3. 输出必须保留用户原始意图、关键术语和交付目标。
4. 画布中的文本要短、可读、便于数智员工后续转 prompt。
5. 先判断哪些官方 Excalidraw 预制素材能复用，再补充业务文字和连接关系。
6. 官方素材必须出现在主体结构中：流程节点、架构组件、PPT 页面内容或原型控件里；不要只放在角落当参考库。

{WHITEBOARD_OFFICIAL_LIBRARY_CONTEXT}""",
        "input_schema": _schema({
            "type": "object",
            "required": ["kind", "prompt"],
            "properties": {
                "kind": {"type": "string", "enum": ["flowchart", "ppt", "architecture", "wireframe"]},
                "prompt": {"type": "string", "description": "用户要梳理的主题、流程、产品或方案目标"},
                "title": {"type": "string"},
                "style": {"type": "string", "default": "clean"},
                "slide_count": {"type": "integer", "minimum": 1, "maximum": 12, "default": 6}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["title", "kind", "scene", "summary"],
            "properties": {
                "title": {"type": "string"},
                "kind": {"type": "string"},
                "scene": {"type": "object", "description": "Excalidraw scene JSON"},
                "summary": {"type": "string"},
                "library_asset_refs": {"type": "array", "items": {"type": "string"}},
                "asset_plan": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["key", "index", "purpose", "placement"],
                        "properties": {
                            "key": {"type": "string"},
                            "index": {"type": "integer"},
                            "purpose": {"type": "string"},
                            "placement": {"type": "string"}
                        }
                    }
                },
                "next_steps": {"type": "array", "items": {"type": "string"}}
            }
        }),
        "few_shot_examples": _schema([
            {
                "input": {"kind": "flowchart", "prompt": "线索进入，需求诊断，方案评审，合同签署，交付复盘"},
                "output": "asset_plan 选择 flow-chart-symbols#14/#13/#12/#8/#11，把这些官方符号作为 5 个主流程节点，并用用户业务文字替换节点标签。"
            },
            {
                "input": {"kind": "ppt", "prompt": "Atlas 路演：问题、方案、能力、场景、价值、路线"},
                "output": "生成 6 页 16:9 幻灯片卡片；每页内嵌 system-design-template、flow-chart-symbols、system-design-components 等官方素材，而不是单独放素材参考区。"
            }
        ]),
    },
    {
        "name": "画布转提示词",
        "slug": "canvas-to-prompt",
        "description": "读取 Excalidraw 白板元素、文字和关系，转换成可交给数智员工继续执行的结构化提示词。",
        "category": "whiteboard",
        "system_prompt": f"""你是 Atlas 画布理解 Skill。你的任务是读取白板中的文字、Frame、节点和关系，把视觉结构转换成数智员工可执行的提示词。
必须遵守：
1. 先总结画布意图，再提取结构化要点。
2. 不输出内部元素 ID，除非它是用户显式命名的业务对象。
3. 生成的 prompt 要包含目标、上下文、约束、交付格式和待确认问题。
4. 如果画布信息不足，要明确列出缺口，而不是臆造。
5. 识别 customData.atlasLibrarySource / atlasOfficialLibraries，把用到的官方素材库写入 prompt，方便数智员工理解图形语义。

{WHITEBOARD_OFFICIAL_LIBRARY_CONTEXT}""",
        "input_schema": _schema({
            "type": "object",
            "required": ["scene"],
            "properties": {
                "scene": {"type": "object", "description": "Excalidraw scene JSON"},
                "title": {"type": "string", "default": "创意白板"},
                "target": {"type": "string", "enum": ["方案", "代码", "PPT 文案", "流程说明", "产品方案"]}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["summary", "prompt", "texts"],
            "properties": {
                "summary": {"type": "string"},
                "prompt": {"type": "string"},
                "texts": {"type": "array", "items": {"type": "string"}},
                "asset_refs": {"type": "array", "items": {"type": "string"}},
                "asset_plan": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["key", "index", "purpose", "placement"],
                        "properties": {
                            "key": {"type": "string"},
                            "index": {"type": "integer"},
                            "source": {"type": "string"},
                            "purpose": {"type": "string"},
                            "placement": {"type": "string"}
                        }
                    }
                },
                "element_count": {"type": "integer"}
            }
        }),
        "few_shot_examples": _schema([
            {
                "input": {"title": "AI 架构图", "target": "产品方案"},
                "output": "请基于白板摘要、节点列表和关系，继续产出产品方案；先复述逻辑，再输出草稿。"
            }
        ]),
    },
    {
        "name": "图表精修",
        "slug": "diagram-refiner",
        "description": "按用户要求对当前白板进行局部扩写、重排和补充说明。",
        "category": "whiteboard",
        "system_prompt": f"""你是 Atlas 图表精修 Skill。你的任务是在已有白板基础上做二次修改。
必须遵守：
1. 默认非破坏式编辑：保留原有内容，在旁边新增修改建议、补充节点或重排草案。
2. 只有用户明确要求替换/删除时，才输出 destructive patch。
3. 输出要说明修改计划、影响范围、可回退方式。
4. 适合处理：补充节点、改写文案、重排结构、增加风险/假设/下一步。
5. 如果当前图缺少专业表达，优先建议或追加官方 Excalidraw 素材库中的架构、流程、UML、线框组件。
6. 如果追加官方素材，必须把素材作为 patch_elements 的一部分返回，并标明 asset_plan；不要只写“可使用某素材”。

{WHITEBOARD_OFFICIAL_LIBRARY_CONTEXT}""",
        "input_schema": _schema({
            "type": "object",
            "required": ["scene", "instruction"],
            "properties": {
                "scene": {"type": "object"},
                "instruction": {"type": "string", "description": "用户对当前画布的修改要求"},
                "mode": {"type": "string", "enum": ["append", "polish", "restructure", "replace"], "default": "append"},
                "preserve_existing": {"type": "boolean", "default": True}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["scene", "summary", "change_plan"],
            "properties": {
                "scene": {"type": "object"},
                "summary": {"type": "string"},
                "change_plan": {"type": "array", "items": {"type": "string"}},
                "library_asset_refs": {"type": "array", "items": {"type": "string"}},
                "asset_plan": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["key", "index", "purpose", "placement"],
                        "properties": {
                            "key": {"type": "string"},
                            "index": {"type": "integer"},
                            "purpose": {"type": "string"},
                            "placement": {"type": "string"}
                        }
                    }
                },
                "changed_elements": {"type": "array", "items": {"type": "string"}}
            }
        }),
        "few_shot_examples": _schema([
            {
                "input": {"mode": "append", "instruction": "帮我补充风险和下一步行动"},
                "output": "保留原图，在右侧新增“风险/待确认/下一步”三个卡片；如涉及流程，用 flow-chart-symbols#12/#11 作为实际 patch 元素。"
            },
            {
                "input": {"mode": "restructure", "instruction": "按售前、交付、复盘三阶段重排"},
                "output": "新增三阶段泳道和重排建议，不直接删除原有节点。"
            }
        ]),
    },
    {
        "name": "幻灯片故事板",
        "slug": "slide-storyboard",
        "description": "把白板 Frame 或画布结构转换为 PPT 故事线、页面标题和导出材料。",
        "category": "whiteboard",
        "system_prompt": f"""你是 Atlas 幻灯片故事板 Skill。你的任务是根据用户需求在同一个 Excalidraw 画布中生成多张 16:9 PPT 页面。
必须遵守：
1. 默认 16:9 比例，每页必须有边框线、页码和标题。
2. 一次生成多张页面，排列在同一个画布文件中。
3. 每页只放一个核心观点和 2-4 条要点，避免大段文字。
4. 若用户未指定页数，默认生成 6 页；若用户指定页数，最多 12 页。
5. 页面内容涉及系统、流程、架构、原型时，优先在画布中引用官方 Excalidraw 素材作为视觉证据或参考组件。
6. 官方素材必须放在对应 PPT 页面内部，作为页面内容的一部分；不要放在画布外侧素材参考区。

{WHITEBOARD_OFFICIAL_LIBRARY_CONTEXT}""",
        "input_schema": _schema({
            "type": "object",
            "required": ["prompt"],
            "properties": {
                "prompt": {"type": "string", "description": "路演/汇报/PPT 主题和素材"},
                "title": {"type": "string"},
                "audience": {"type": "string"},
                "slide_count": {"type": "integer", "minimum": 1, "maximum": 12, "default": 6},
                "aspect_ratio": {"type": "string", "default": "16:9"}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["scene", "slides"],
            "properties": {
                "scene": {"type": "object"},
                "slides": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["page", "title", "bullets"],
                        "properties": {
                            "page": {"type": "integer"},
                            "title": {"type": "string"},
                            "bullets": {"type": "array", "items": {"type": "string"}}
                        }
                    }
                },
                "library_asset_refs": {"type": "array", "items": {"type": "string"}},
                "asset_plan": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["page", "key", "index", "purpose"],
                        "properties": {
                            "page": {"type": "integer"},
                            "key": {"type": "string"},
                            "index": {"type": "integer"},
                            "purpose": {"type": "string"}
                        }
                    }
                }
            }
        }),
        "few_shot_examples": _schema([
            {
                "input": {"prompt": "Atlas 产品发布会：定位、痛点、能力、场景、价值、路线", "slide_count": 6},
                "output": "同一画布中生成 6 张 16:9 页面，每页包含边框线、页码、标题、三条要点，并在页面内部嵌入官方素材组件作为视觉表达。"
            }
        ]),
    },
]


CONTRACT_REVIEW_SKILL_SEEDS = [
    {
        "name": "合同 DOCX 审核与修订",
        "slug": "docx-contract-review",
        "description": "面向合同智能审核的 DOCX 解析、结构化审查、在线审查报告与 Word 批注修订建议稿生成能力。支持按合同类型、审查视角和重点关注项动态调整审查清单。",
        "category": "contract",
        "source_ref": "openatlas-contract:docx-contract-review",
        "system_prompt": """你是 Atlas 合同 DOCX 审核与修订 Skill。你的任务是帮助法务、销售、采购和项目团队审查合同文件，并输出可追踪、可复核、可下载的交付物。
必须遵守：
1. 优先保留原合同结构和原文，不擅自删除原文。
2. 审核建议必须结构化，包含风险等级、问题分类、条款定位、原文摘录、风险说明、修改建议和拟修订文本。
3. 对 DOCX 文件应尽量解析段落并保留定位；对暂未深度解析的 PDF，应明确能力边界并提示转换/上传 DOCX。
4. 合同类型会改变审查清单：销售合同关注回款、售后、风险转移；采购合同关注供货、质量、供应商合规；技术服务合同关注 SLA、变更、里程碑验收；劳动合同关注薪酬、工时、保密竞业；NDA 关注保密范围、使用限制、返还销毁。
5. 审查视角必须生效：偏甲方强调验收、扣款、解除权；偏乙方强调收款保护、配合义务和责任上限；强风控强调审批、合规、责任边界和退出机制。
6. 用户填写的重点关注项是动态强制清单，命中正文时要专项复核，未命中正文时要作为全文缺失项提出补充条款。
7. 生成 Word 修订建议稿时，当前版本采用“原文 + Word 批注 + 已采纳缺失项写入正文 + 审核修订建议附录”的稳妥模式；如运行时具备 OOXML Track Changes 能力，可升级为原文内联修订。
8. 不为了演示压缩审查深度；审查范围应覆盖主体、标的、付款、交付验收、违约责任、知识产权、保密、终止、争议解决和用户指定关注点。
9. 所有输出要服务业务决策：先给结论，再给证据定位，再给可执行修订方案。""",
        "input_schema": _schema({
            "type": "object",
            "required": ["contract_id", "file_path"],
            "properties": {
                "contract_id": {"type": "string"},
                "file_path": {"type": "string", "description": "租户隔离后的服务端合同文件路径"},
                "contract_type": {"type": "string", "default": "general"},
                "review_perspective": {"type": "string", "enum": ["balanced", "party_a", "party_b", "strict"], "default": "balanced"},
                "focus": {"type": "array", "items": {"type": "string"}},
                "max_file_size_mb": {"type": "integer", "default": 10}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["summary", "issues", "report_path"],
            "properties": {
                "summary": {"type": "string"},
                "issues": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["severity", "category", "title", "risk", "recommendation"],
                        "properties": {
                            "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                            "category": {"type": "string"},
                            "title": {"type": "string"},
                            "clause_ref": {"type": "string"},
                            "paragraph_index": {"type": "integer"},
                            "excerpt": {"type": "string"},
                            "risk": {"type": "string"},
                            "recommendation": {"type": "string"},
                            "proposed_revision": {"type": "string"},
                            "confidence": {"type": "number"}
                        }
                    }
                },
                "report_path": {"type": "string"},
                "revised_docx_path": {"type": "string"},
                "engine": {"type": "string", "description": "python-docx / ooxml-track-changes / hermes-skill"}
            }
        }),
        "few_shot_examples": _schema([
            {
                "input": {"contract_type": "service", "review_perspective": "party_a", "focus": ["付款", "验收", "知识产权"]},
                "output": "输出高/中/低风险卡片，定位到具体段落；报告说明付款节点、验收标准、成果归属的风险；Word 修订建议稿保留原文并追加可执行修订条款。"
            }
        ]),
    }
]


AI2UI_SKILL_SEEDS = [
    {
        "name": "AI2UI 交互界面规划",
        "slug": "ai2ui-surface-planner",
        "description": "把 Agent 的下一步动作转换为可渲染、可确认、可编辑的 UI patch，适用于表单、卡片、审阅区、画布节点、进度状态和动作按钮。",
        "category": "ai2ui",
        "source_ref": "openatlas:ai2ui:surface-planner",
        "system_prompt": """你是 Atlas AI2UI Surface Planner Skill。你的任务不是回答用户问题，而是把 Agent 的下一步交互转换成可执行 UI patch。
必须遵守：
1. 保持领域中立，不为 PPT、公文、合同、白板等具体场景硬编码规则。
2. 当缺少结构化信息时，优先生成表单、选择卡、确认卡或画布节点，而不是只用自然语言追问。
3. 输出必须包含组件类型、字段、校验、默认值来源、动作协议和状态变化；UI patch 要能被 React/AntD 或其他 renderer 消费。
4. 不确定时用 confidence、assumptions、missing_fields 表达，不编造用户没有提供的事实。
5. 组件要服务任务推进：确认、补字段、选择方案、审阅初稿、补资料、发起生成、比较版本、下载交付物。
6. 只输出结构化结果，不输出无法执行的设计感描述。""",
        "input_schema": _schema({
            "type": "object",
            "required": ["task", "context"],
            "properties": {
                "task": {"type": "string"},
                "context": {"type": "object"},
                "available_components": {
                    "type": "array",
                    "items": {"type": "string"},
                    "default": ["form", "card", "review_panel", "canvas_node", "progress", "choice_group", "table", "timeline"]
                },
                "renderer": {"type": "string", "default": "react-antd"},
                "constraints": {"type": "object"}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["ui_patches", "state_patch", "rationale"],
            "properties": {
                "ui_patches": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["op", "component", "props"],
                        "properties": {
                            "op": {"type": "string", "enum": ["add", "update", "remove", "replace"]},
                            "target": {"type": "string"},
                            "component": {"type": "string"},
                            "props": {"type": "object"},
                            "validation": {"type": "object"},
                            "actions": {"type": "array", "items": {"type": "object"}},
                            "confidence": {"type": "number"}
                        }
                    }
                },
                "state_patch": {"type": "object"},
                "missing_fields": {"type": "array", "items": {"type": "object"}},
                "assumptions": {"type": "array", "items": {"type": "string"}},
                "rationale": {"type": "string"}
            }
        }),
        "few_shot_examples": _schema([
            {"input": {"task": "缺少受众和格式"}, "output": "生成确认表单，字段包含受众、格式、语气、是否需要图表；每个默认值标明 recognized/defaulted/needs_confirm。"},
            {"input": {"task": "初稿需要审阅"}, "output": "生成 review_panel + version_actions，支持预览、修改意见、下载、生成新版本。"}
        ]),
    },
    {
        "name": "证据检索与资料归纳",
        "slug": "evidence-research-synthesizer",
        "description": "基于任务上下文、当前内容和候选来源生成检索计划、资料摘要、引用证据和可回写的内容补丁。",
        "category": "ai2ui",
        "source_ref": "openatlas:ai2ui:evidence-research-synthesizer",
        "system_prompt": """你是 Atlas Evidence Research Synthesizer Skill。你的任务是把资料缺口转成可执行研究任务，并把搜索、文件或知识库结果归纳为可信证据包。
必须遵守：
1. 保持通用，适用于报告、PPT、文章、公文、合同、方案、培训材料等任意交付物。
2. 先理解当前内容要证明什么，再决定需要什么资料；不要把用户原话直接当搜索词。
3. 只能基于输入来源归纳事实；来源不足时输出 gap，不编造数字、案例、政策或引用。
4. 输出要能回写到上游 UI：知识卡、引用列表、内容 patch、需要人工补充的问题。
5. 区分 source_backed、assumption、missing；每条证据都要说明适用位置和使用方式。
6. 联网检索、文件检索、企业知识库检索都是工具来源，不改变本 Skill 的输出协议。""",
        "input_schema": _schema({
            "type": "object",
            "required": ["research_goal", "context"],
            "properties": {
                "research_goal": {"type": "string"},
                "context": {"type": "object"},
                "source_candidates": {"type": "array", "items": {"type": "object"}},
                "allowed_tools": {"type": "array", "items": {"type": "string"}},
                "constraints": {"type": "object"}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["evidence_pack", "content_patch", "gaps"],
            "properties": {
                "search_queries": {"type": "array", "items": {"type": "string"}},
                "evidence_pack": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["claim", "source", "usage", "status"],
                        "properties": {
                            "claim": {"type": "string"},
                            "source": {"type": "object"},
                            "usage": {"type": "string"},
                            "status": {"type": "string", "enum": ["source_backed", "assumption", "missing"]},
                            "confidence": {"type": "number"}
                        }
                    }
                },
                "content_patch": {"type": "object"},
                "knowledge_cards": {"type": "array", "items": {"type": "object"}},
                "gaps": {"type": "array", "items": {"type": "string"}},
                "warnings": {"type": "array", "items": {"type": "string"}}
            }
        }),
        "few_shot_examples": _schema([
            {"input": {"research_goal": "为某段内容补充可信资料"}, "output": "先给搜索 query，再将来源归纳为 evidence_pack，最后给 content_patch 和仍缺资料。"}
        ]),
    },
    {
        "name": "交付物结构规划",
        "slug": "artifact-structure-planner",
        "description": "把用户目标规划为文档、演示、报告、页面、流程等交付物的章节/页面/模块结构、依赖资料和生成顺序。",
        "category": "ai2ui",
        "source_ref": "openatlas:ai2ui:artifact-structure-planner",
        "system_prompt": """你是 Atlas Artifact Structure Planner Skill。你的任务是为任意复杂交付物建立可编辑结构，而不是直接写最终稿。
必须遵守：
1. 交付物类型可以是 document、deck、report、article、web_page、workflow、review_package 等，不能只为 PPT 设计。
2. 结构必须包含叙事逻辑、受众目标、章节/页面/模块、每个节点的核心观点、资料依赖和完成状态。
3. 对用户没有给出的事实，不写成确定结论；用 missing_inputs 和 assumptions 标出。
4. 结构要支持人机协同：用户可以增删节点、确认顺序、补资料、锁定节点，再进入生成阶段。
5. 输出要尽量稳定，可被画布、表单、目录树、时间线或审阅区渲染。
6. 不生成最终 HTML、DOCX、PPT，只生成结构化计划。""",
        "input_schema": _schema({
            "type": "object",
            "required": ["goal", "artifact_type"],
            "properties": {
                "goal": {"type": "string"},
                "artifact_type": {"type": "string"},
                "audience": {"type": "string"},
                "context": {"type": "object"},
                "style_tokens": {"type": "object"},
                "min_nodes": {"type": "integer", "minimum": 1, "default": 3},
                "constraints": {"type": "object"}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["title", "nodes", "dependencies", "generation_plan"],
            "properties": {
                "title": {"type": "string"},
                "artifact_type": {"type": "string"},
                "nodes": {"type": "array", "items": {"type": "object"}},
                "dependencies": {"type": "array", "items": {"type": "object"}},
                "missing_inputs": {"type": "array", "items": {"type": "object"}},
                "generation_plan": {"type": "array", "items": {"type": "string"}},
                "review_checklist": {"type": "array", "items": {"type": "string"}}
            }
        }),
        "few_shot_examples": _schema([
            {"input": {"artifact_type": "deck", "goal": "生成产品汇报"}, "output": "输出节点结构和资料依赖，不直接生成 PPT。"},
            {"input": {"artifact_type": "document", "goal": "生成正式公文初稿"}, "output": "输出文档结构、字段依赖和格式要求，不把规则写死到其他交付物。"}
        ]),
    },
    {
        "name": "Token 化 HTML 渲染",
        "slug": "tokenized-html-renderer",
        "description": "把结构化交付物规格和设计 Token 渲染为安全、可预览、可下载的 HTML，适用于演示、报告、长文、看板和审阅页。",
        "category": "ai2ui",
        "source_ref": "openatlas:ai2ui:tokenized-html-renderer",
        "system_prompt": """你是 Atlas Tokenized HTML Renderer Skill。你的任务是把结构化 artifact spec 渲染为高质量 HTML，而不是重新规划内容。
必须遵守：
1. 保持渲染器通用，支持 deck、document、report、article、dashboard、review_package 等 artifact_type。
2. 严格使用输入中的 design_tokens、layout_intent 和 render_hints；不要发明不受控的品牌色、字体、装饰元素。
3. HTML 必须可离线预览，默认不引入远程脚本；必要资源必须通过输入资产或内联样式表达。
4. 输出要考虑响应式、可读性、可访问性、打印/全屏/下载场景。
5. 不修改事实内容；发现内容不足、引用缺失、布局拥挤时输出 warnings 和 repair_requests。
6. 复杂图表或媒体无法渲染时，使用语义化占位块，并说明所需资产。""",
        "input_schema": _schema({
            "type": "object",
            "required": ["artifact_spec", "design_tokens"],
            "properties": {
                "artifact_spec": {"type": "object"},
                "design_tokens": {"type": "object"},
                "aspect_ratio": {"type": "string"},
                "render_target": {"type": "string", "enum": ["preview", "fullscreen", "download", "print"], "default": "preview"},
                "assets": {"type": "array", "items": {"type": "object"}},
                "constraints": {"type": "object"}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["html", "render_summary", "warnings"],
            "properties": {
                "html": {"type": "string"},
                "render_summary": {"type": "string"},
                "asset_manifest": {"type": "array", "items": {"type": "object"}},
                "warnings": {"type": "array", "items": {"type": "string"}},
                "repair_requests": {"type": "array", "items": {"type": "object"}},
                "quality_checks": {"type": "array", "items": {"type": "object"}}
            }
        }),
        "few_shot_examples": _schema([
            {"input": {"artifact_spec": {"artifact_type": "deck"}, "render_target": "fullscreen"}, "output": "生成包含键盘翻页、固定比例页面和 token 化 CSS 的单文件 HTML。"}
        ]),
    },
    {
        "name": "交付物审阅与修复",
        "slug": "artifact-critic-repair",
        "description": "对结构化计划、UI patch、HTML 预览或最终交付物做质量审阅，并输出可执行修复补丁。",
        "category": "ai2ui",
        "source_ref": "openatlas:ai2ui:artifact-critic-repair",
        "system_prompt": """你是 Atlas Artifact Critic & Repair Skill。你的任务是审阅交付物质量，并给出可执行修复补丁，而不是泛泛评价。
必须遵守：
1. 通用评审维度包括：用户目标匹配、结构完整性、事实可信度、引用来源、版式可读性、组件可执行性、可访问性、状态流转和下载/预览可用性。
2. 发现问题要输出 severity、location、reason、repair_patch；不要只写建议。
3. 不要把不同场景混为一谈；根据 artifact_type 和 acceptance_criteria 调整检查项。
4. 对无法自动修复的问题，输出 needs_human_input，并说明最小补充信息。
5. 评分必须可解释，ready_to_publish 只能在关键问题清零时为 true。
6. 修复补丁要保持最小改动，不重写用户已经确认的内容。""",
        "input_schema": _schema({
            "type": "object",
            "required": ["artifact", "acceptance_criteria"],
            "properties": {
                "artifact": {"type": "object"},
                "artifact_type": {"type": "string"},
                "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
                "source_context": {"type": "object"},
                "render_observations": {"type": "object"},
                "constraints": {"type": "object"}
            }
        }),
        "output_schema": _schema({
            "type": "object",
            "required": ["score", "ready_to_publish", "findings", "repair_patches"],
            "properties": {
                "score": {"type": "integer", "minimum": 0, "maximum": 100},
                "ready_to_publish": {"type": "boolean"},
                "findings": {"type": "array", "items": {"type": "object"}},
                "repair_patches": {"type": "array", "items": {"type": "object"}},
                "needs_human_input": {"type": "array", "items": {"type": "object"}},
                "summary": {"type": "string"}
            }
        }),
        "few_shot_examples": _schema([
            {"input": {"artifact_type": "deck", "acceptance_criteria": ["至少 8 页", "引用可信"]}, "output": "输出具体页面的问题和 patch，例如更新第 3 页 layout_intent、补第 5 页 evidence dependency。"}
        ]),
    },
]


def _ensure_demo_user(db: Session, tenant: Tenant, org_unit_id: str | None = None) -> User:
    """Seed the low-privilege demo account used by the login screen."""
    demo_user = db.query(User).filter_by(tenant_id=tenant.id, email=DEMO_USER_EMAIL).first()
    if not demo_user:
        demo_user = User(
            tenant_id=tenant.id,
            org_unit_id=org_unit_id,
            email=DEMO_USER_EMAIL,
            username="王六",
            password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
            role=UserRole.user,
            is_active=True,
        )
        db.add(demo_user)
        return demo_user
    demo_user.username = "王六"
    demo_user.role = UserRole.user
    demo_user.is_active = True
    demo_user.password_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
    if org_unit_id and not demo_user.org_unit_id:
        demo_user.org_unit_id = org_unit_id
    return demo_user


def _ensure_whiteboard_skills(db: Session, tenant: Tenant, created_by: str) -> None:
    for seed in WHITEBOARD_SKILL_SEEDS:
        existing = db.query(SkillPackage).filter(
            SkillPackage.owner_tenant_id == tenant.id,
            SkillPackage.slug == seed["slug"],
        ).first()
        if existing:
            existing.name = seed["name"]
            existing.description = seed["description"]
            existing.category = seed["category"]
            existing.system_prompt = seed.get("system_prompt", "")
            existing.input_schema = seed.get("input_schema", "{}")
            existing.output_schema = seed.get("output_schema", "{}")
            existing.few_shot_examples = seed.get("few_shot_examples", "[]")
            existing.status = "enabled"
            existing.mutable = True
            continue
        db.add(SkillPackage(
            scope=Scope.tenant,
            owner_tenant_id=tenant.id,
            owner_user_id=None,
            name=seed["name"],
            slug=seed["slug"],
            description=seed["description"],
            category=seed["category"],
            version="1.0.0",
            visibility="tenant",
            mutable=True,
            source_ref=f"openatlas:whiteboard:{seed['slug']}",
            status="enabled",
            system_prompt=seed.get("system_prompt", ""),
            input_schema=seed.get("input_schema", "{}"),
            output_schema=seed.get("output_schema", "{}"),
            few_shot_examples=seed.get("few_shot_examples", "[]"),
            created_by=created_by,
        ))


def _ensure_ai2ui_skills(db: Session, tenant: Tenant, created_by: str) -> None:
    for seed in AI2UI_SKILL_SEEDS:
        existing = db.query(SkillPackage).filter(
            SkillPackage.owner_tenant_id == tenant.id,
            SkillPackage.slug == seed["slug"],
        ).first()
        if existing:
            existing.name = seed["name"]
            existing.description = seed["description"]
            existing.category = seed["category"]
            existing.version = "1.0.0"
            existing.visibility = "tenant"
            existing.mutable = True
            existing.source_ref = seed.get("source_ref", "")
            existing.system_prompt = seed.get("system_prompt", "")
            existing.input_schema = seed.get("input_schema", "{}")
            existing.output_schema = seed.get("output_schema", "{}")
            existing.few_shot_examples = seed.get("few_shot_examples", "[]")
            existing.status = "enabled"
            continue
        db.add(SkillPackage(
            scope=Scope.tenant,
            owner_tenant_id=tenant.id,
            owner_user_id=None,
            name=seed["name"],
            slug=seed["slug"],
            description=seed["description"],
            category=seed["category"],
            version="1.0.0",
            visibility="tenant",
            mutable=True,
            source_ref=seed.get("source_ref", ""),
            status="enabled",
            system_prompt=seed.get("system_prompt", ""),
            input_schema=seed.get("input_schema", "{}"),
            output_schema=seed.get("output_schema", "{}"),
            few_shot_examples=seed.get("few_shot_examples", "[]"),
            created_by=created_by,
        ))


def _ensure_contract_review_skills(db: Session, tenant: Tenant, created_by: str) -> None:
    for seed in CONTRACT_REVIEW_SKILL_SEEDS:
        existing = db.query(SkillPackage).filter(
            SkillPackage.owner_tenant_id == tenant.id,
            SkillPackage.slug == seed["slug"],
        ).first()
        if existing:
            existing.name = seed["name"]
            existing.description = seed["description"]
            existing.category = seed["category"]
            existing.version = "1.0.0"
            existing.visibility = "tenant"
            existing.mutable = True
            existing.source_ref = seed.get("source_ref", "")
            existing.system_prompt = seed.get("system_prompt", "")
            existing.input_schema = seed.get("input_schema", "{}")
            existing.output_schema = seed.get("output_schema", "{}")
            existing.few_shot_examples = seed.get("few_shot_examples", "[]")
            existing.status = "enabled"
            continue
        db.add(SkillPackage(
            scope=Scope.tenant,
            owner_tenant_id=tenant.id,
            owner_user_id=None,
            name=seed["name"],
            slug=seed["slug"],
            description=seed["description"],
            category=seed["category"],
            version="1.0.0",
            visibility="tenant",
            mutable=True,
            source_ref=seed.get("source_ref", ""),
            status="enabled",
            system_prompt=seed.get("system_prompt", ""),
            input_schema=seed.get("input_schema", "{}"),
            output_schema=seed.get("output_schema", "{}"),
            few_shot_examples=seed.get("few_shot_examples", "[]"),
            created_by=created_by,
        ))


def init_db() -> None:
    """Create tables + seed demo tenant & admin if empty.

    Phase 2: also backfills api_key_encrypted/pid columns for existing rows,
    and normalizes legacy 'healthy' status to 'running'.
    """
    Base.metadata.create_all(engine)
    # Phase 2: cheap SQLite backfill (idempotent ALTER TABLE)
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(hermes_runtimes)").fetchall()}
        if "api_key_encrypted" not in cols:
            conn.exec_driver_sql("ALTER TABLE hermes_runtimes ADD COLUMN api_key_encrypted VARCHAR(255) DEFAULT ''")
        if "pid" not in cols:
            conn.exec_driver_sql("ALTER TABLE hermes_runtimes ADD COLUMN pid INTEGER")
        # Phase 3.4 — resource limits on tenants
        tcols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(tenants)").fetchall()}
        if "max_sessions" not in tcols:
            conn.exec_driver_sql("ALTER TABLE tenants ADD COLUMN max_sessions INTEGER")
        if "max_employees" not in tcols:
            conn.exec_driver_sql("ALTER TABLE tenants ADD COLUMN max_employees INTEGER")
        ucols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()}
        if "org_unit_id" not in ucols:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN org_unit_id VARCHAR(36)")
        # P3.11 (2026-06-06): 群聊接力员工列表回填 (Bug 3/4/11).
        # SessionRecord.participant_ids 加列, 存 json string, 默认 "[]".
        # createBase.metadata.create_all 上面那行已经给新 DB 建好列了, 这里
        # 补 ALTER TABLE 给老 DB.
        scols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(sessions)").fetchall()}
        if "participant_ids" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN participant_ids TEXT DEFAULT '[]'")
        if "canvas_state" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN canvas_state TEXT DEFAULT ''")
        if "reusable_template_id" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN reusable_template_id VARCHAR(36)")
        if "archived" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN archived BOOLEAN DEFAULT 0")
        if "pinned" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN pinned BOOLEAN DEFAULT 0")
        if "workspace" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN workspace VARCHAR(128) DEFAULT ''")
        if "model_override" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN model_override VARCHAR(128) DEFAULT ''")
        if "task_status" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN task_status VARCHAR(24) DEFAULT 'draft'")
        if "task_summary" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN task_summary TEXT DEFAULT ''")
        if "summary_updated_at" not in scols:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN summary_updated_at DATETIME")
        # SessionRunEvent is a new table, but create_all is intentionally
        # conservative with existing SQLite files. Keep this lightweight guard
        # so upgrades from older local/demo DBs do not need Alembic.
        if not conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='session_run_events'"
        ).fetchone():
            SessionRunEvent.__table__.create(bind=conn, checkfirst=True)
        if not conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='presentation_deck_documents'"
        ).fetchone():
            PresentationDeckDocument.__table__.create(bind=conn, checkfirst=True)
        if not conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='presentation_deck_versions'"
        ).fetchone():
            PresentationDeckVersion.__table__.create(bind=conn, checkfirst=True)
        acols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(task_artifacts)").fetchall()}
        if "source_path" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN source_path VARCHAR(512) DEFAULT ''")
        if "run_id" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN run_id VARCHAR(36)")
        if "employee_id" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN employee_id VARCHAR(36)")
        if "version" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN version INTEGER DEFAULT 1")
        if "provenance_payload" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN provenance_payload TEXT DEFAULT '{}'")
        if "storage_path" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN storage_path VARCHAR(512) DEFAULT ''")
        if "storage_size" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN storage_size INTEGER DEFAULT 0")
        if "managed_status" not in acols:
            conn.exec_driver_sql("ALTER TABLE task_artifacts ADD COLUMN managed_status VARCHAR(24) DEFAULT 'pending'")
        spcols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(skill_packages)").fetchall()}
        if "system_prompt" not in spcols:
            conn.exec_driver_sql("ALTER TABLE skill_packages ADD COLUMN system_prompt TEXT DEFAULT ''")
        if "input_schema" not in spcols:
            conn.exec_driver_sql("ALTER TABLE skill_packages ADD COLUMN input_schema TEXT DEFAULT '{}'")
        if "output_schema" not in spcols:
            conn.exec_driver_sql("ALTER TABLE skill_packages ADD COLUMN output_schema TEXT DEFAULT '{}'")
        if "few_shot_examples" not in spcols:
            conn.exec_driver_sql("ALTER TABLE skill_packages ADD COLUMN few_shot_examples TEXT DEFAULT '[]'")
        mcols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(messages)").fetchall()}
        if "speaker_employee_id" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN speaker_employee_id VARCHAR(36)")
        if "speaker_name" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN speaker_name VARCHAR(128) DEFAULT ''")
        if "turn_index" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN turn_index INTEGER")
        if "input_tokens" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN input_tokens INTEGER DEFAULT 0")
        if "output_tokens" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN output_tokens INTEGER DEFAULT 0")
        if "total_tokens" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN total_tokens INTEGER DEFAULT 0")
        if "attachments" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT '[]'")
        if "reasoning" not in mcols:
            conn.exec_driver_sql("ALTER TABLE messages ADD COLUMN reasoning TEXT DEFAULT ''")
        ccols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(collaboration_templates)").fetchall()}
        if "category" not in ccols:
            conn.exec_driver_sql("ALTER TABLE collaboration_templates ADD COLUMN category VARCHAR(64) DEFAULT 'general'")
        if "visibility" not in ccols:
            conn.exec_driver_sql("ALTER TABLE collaboration_templates ADD COLUMN visibility VARCHAR(16) DEFAULT 'private'")
        conn.commit()
    with SessionLocal() as db:
        # Backfill api_key → api_key_encrypted for legacy rows
        for r in db.query(HermesRuntime).all():
            if not r.api_key_encrypted and r.api_key:
                r.api_key_encrypted = r.api_key
            if r.status == "healthy":
                r.status = "running"
        db.commit()

        if db.query(Tenant).filter_by(slug=DEFAULT_TENANT_SLUG).first():
            demo = db.query(Tenant).filter_by(slug=DEFAULT_TENANT_SLUG).first()
            root = db.query(OrganizationUnit).filter_by(tenant_id=demo.id, parent_id=None).first() if demo else None
            if demo and not db.query(OrganizationUnit).filter_by(tenant_id=demo.id).first():
                root = OrganizationUnit(
                    tenant_id=demo.id,
                    parent_id=None,
                    name=demo.name,
                    code="ROOT",
                    description="默认组织根节点",
                    sort_order=0,
                )
                db.add(root)
                db.flush()
                for idx, (name, code) in enumerate([("经营管理部", "OPS"), ("市场销售部", "SALES"), ("人力行政部", "HR")], 1):
                    db.add(OrganizationUnit(
                        tenant_id=demo.id,
                        parent_id=root.id,
                        name=name,
                        code=code,
                        description="演示组织单元",
                        sort_order=idx,
                    ))
                admin_user = db.query(User).filter_by(tenant_id=demo.id, email=DEFAULT_ADMIN_EMAIL).first()
                if admin_user:
                    admin_user.org_unit_id = root.id
            if demo:
                admin_user = db.query(User).filter_by(tenant_id=demo.id, email=DEFAULT_ADMIN_EMAIL).first()
                demo_user = _ensure_demo_user(db, demo, root.id if root else None)
                seed_user_id = (admin_user.id if admin_user else demo_user.id)
                _ensure_whiteboard_skills(db, demo, seed_user_id)
                _ensure_ai2ui_skills(db, demo, seed_user_id)
                _ensure_contract_review_skills(db, demo, seed_user_id)
                db.commit()
            return
        tenant = Tenant(slug=DEFAULT_TENANT_SLUG, name=DEFAULT_TENANT_NAME)
        db.add(tenant)
        db.flush()
        root_org = OrganizationUnit(
            tenant_id=tenant.id,
            parent_id=None,
            name=tenant.name,
            code="ROOT",
            description="默认组织根节点",
            sort_order=0,
        )
        db.add(root_org)
        db.flush()
        for idx, (name, code) in enumerate([("经营管理部", "OPS"), ("市场销售部", "SALES"), ("人力行政部", "HR")], 1):
            db.add(OrganizationUnit(
                tenant_id=tenant.id,
                parent_id=root_org.id,
                name=name,
                code=code,
                description="演示组织单元",
                sort_order=idx,
            ))
        admin = User(
            tenant_id=tenant.id,
            org_unit_id=root_org.id,
            email=DEFAULT_ADMIN_EMAIL,
            username="王六",
            password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
            role=UserRole.tenant_admin,
        )
        db.add(admin)
        _ensure_demo_user(db, tenant, root_org.id)
        db.flush()
        runtime_api_key = os.environ.get("API_SERVER_KEY", "openatlas-demo-dev-key")
        runtime = HermesRuntime(
            tenant_id=tenant.id,
            runtime_type="process",
            gateway_base_url="http://127.0.0.1:58642",
            api_key=runtime_api_key,
            api_key_encrypted=runtime_api_key,
            hermes_home_path=str(OPENATLAS_HOME / "hermes-tenants" / DEFAULT_TENANT_SLUG / ".hermes"),
            port=58642,
            status="running",
        )
        db.add(runtime)
        # Seed one global skill (the spec calls for a global Skill Market)
        global_skill = SkillPackage(
            scope=Scope.global_,
            owner_tenant_id=None,
            owner_user_id=None,
            name="Hermes Built-in Tools",
            slug="hermes-builtin-tools",
            description="All built-in Hermes toolsets available to the runtime.",
            category="runtime",
            version="1.0.0",
            visibility="public",
            mutable=False,
            created_by=admin.id,
        )
        db.add(global_skill)
        _ensure_whiteboard_skills(db, tenant, admin.id)
        _ensure_ai2ui_skills(db, tenant, admin.id)
        _ensure_contract_review_skills(db, tenant, admin.id)
        # Seed a demo digital employee so the list is non-empty
        emp = DigitalEmployee(
            tenant_id=tenant.id,
            display_name="Atlas 助手",
            profile_name=f"tenant_{tenant.slug}__employee_atlas_helper",
            description="默认演示员工，擅长通用问答与文件操作。",
            avatar="A",
            status=EmployeeStatus.active,
            model="hermes-agent",
            provider="hermes",
            system_prompt="你是一名高效、耐心的企业数字员工，名字叫 Atlas 助手。",
            created_by=admin.id,
        )
        db.add(emp)
        db.commit()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
