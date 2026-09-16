# InsightLab

InsightLab 是一个面向企业团队的数智员工协作与交付平台。它把模型、技能、记忆、文件、审批和交付物组织到同一条可追踪的任务链路中，而不是只提供一个聊天窗口。

当前整理版：`0.2.0-preview.1`（2026-09-16）。本版本以现有可运行主线为准，保留历史能力，停止把本地运行产物当作源码发布，并补齐统一的项目入口和部署说明。

## 核心功能

| 模块       | 当前能力                                                              |
| ---------- | --------------------------------------------------------------------- |
| 数智员工   | 员工创建、招聘、停用、岗位详情、技能与工具集绑定                      |
| 任务工作台 | 单员工对话、多人接力协作、流式进度、停止/恢复、会话历史               |
| 工作流治理 | 节点状态、步骤事件、检查点、重放、恢复分支、人工审批                  |
| 交付物     | 文件上传、在线预览、下载、版本、终稿标记、归档                        |
| 技能与记忆 | Hermes Skill 同步、企业技能市场、作用域绑定、版本与健康检查、分层记忆 |
| A2UI 场景  | 创意白板、AI PPT、PPT Designer、公文写作、合同审查                    |
| 企业管理   | 租户、组织、用户、权限矩阵、运行时、作业、审计与运营看板              |
| 安全与隔离 | 租户隔离、独立 Hermes Home、工具审批、操作证据与运行诊断              |

完整清单见 [docs/FEATURES.md](docs/FEATURES.md)，文档导航见 [docs/README.md](docs/README.md)。

## 技术架构

```text
React 19 + TypeScript + Vite
            │
            ▼
FastAPI + SQLAlchemy + SQLite
            │
            ▼
Hermes Agent Gateway / 模型与工具运行时
```

- `frontend/`：浏览器端产品界面和 Playwright 场景测试。
- `backend/`：认证、业务 API、任务编排、文件与交付物、治理数据。
- `runtime/hermes/`：随仓库交付的 Hermes Agent 源码（`v2026.6.5` / `0.16.0`）。
- `runtime/launchers/`：InsightLab 的隔离启动适配器。
- `scripts/`：本地启动脚本。
- `deploy/`：nginx、systemd 和腾讯云 CVM 发布脚本。
- `demo-pack/`：不含真实业务数据的演示材料。

更详细的目录边界见 [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md)。

## 本地启动

要求：Python 3.11–3.13、Node.js 20+、npm 和 `uv`。推荐统一使用 Python 3.12；当前依赖不支持 Python 3.14。Hermes Agent 源码已经包含在项目的 `runtime/hermes/` 中，不需要从 `~/.hermes` 复制。

```bash
git clone https://github.com/gmd3250679Coding/openatlas.git
cd openatlas

uv venv backend/.venv --python 3.12 --seed --allow-existing
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
bash scripts/setup-hermes-runtime.sh

cd frontend
npm ci
cd ..
```

环境准备完成后启动开发栈。若 `runtime/hermes/.venv` 缺失，开发启动器也会自动初始化：

```bash
cp -n .env.example .env
# 编辑 .env，填写 TOKENHUB_API_KEY
./scripts/dev-stack.sh --no-quality
```

默认地址：

- 前端：`http://127.0.0.1:3381`
- 后端：`http://127.0.0.1:58003`
- Hermes Gateway：`http://127.0.0.1:58642`

如需覆盖数据目录：

```bash
./scripts/dev-stack.sh --openatlas-home /absolute/path/to/openatlas-data --no-quality
```

AI PPT 离线演示页为 `/aippt-offline-demo`，它使用本地 Mock Adapter，不依赖后端或模型服务。

## Hermes runtime

项目将 Hermes 源码和运行数据明确分离：

- 源码位于 `runtime/hermes/`，随 InsightLab 一起发布。
- Hermes 使用独立环境 `runtime/hermes/.venv/`，不会与 `backend/.venv/` 混用。
- 腾讯云模型密钥统一从项目根目录 `.env` 读取；该文件随整体交付目录保存，但已被 Git 忽略。
- 租户运行配置、会话、技能、记忆和日志仍写入 `${OPENATLAS_HOME:-$HOME/.openatlas}/hermes-tenants/`，不会提交到仓库。
- 启动器禁止读取或执行用户现有的 `~/.hermes/hermes-agent/`，避免污染个人 Hermes 环境。

初始化或修复 Hermes 环境：

```bash
bash scripts/setup-hermes-runtime.sh
```

该命令可重复执行，会按 Hermes 自带的锁文件准备 Python 3.12 环境，并补充 InsightLab API Server 所需的 `aiohttp`。开发启动器会在环境缺失或无法导入 Gateway 时自动执行同一流程。

如需使用另一份兼容的 Hermes 源码，可以显式覆盖：

```bash
./scripts/dev-stack.sh \
  --hermes-runtime /absolute/path/to/hermes-agent \
  --no-quality
```

模型和供应商密钥不会写入源码。本地整体交付使用项目根目录的 `.env`，模板见 [.env.example](.env.example)；服务器生产部署仍使用 [deploy/openatlas.env.example](deploy/openatlas.env.example)。

默认模型网关已配置为腾讯云 Token Plan 企业版专业套餐，接口地址为
`https://tokenhub.tencentmaas.com/plan/v3`，默认模型为 `auto`。在项目根目录的 `.env` 中填写：

```dotenv
TOKENHUB_API_KEY=<USER_API_KEY>
TOKENHUB_BASE_URL=https://tokenhub.tencentmaas.com/plan/v3
```

完整模型清单位于 `runtime/config/tencent-models.json`，后端
`/api/models` 会返回同一份清单且不会暴露 API Key。

如果安装时出现 `failed-wheel-build-for-install` 或 `pydantic_core` 构建失败，请确认没有使用 Python 3.14，然后重新创建后端与 Hermes 的 Python 3.12 环境。

## 验证

```bash
cd frontend
npm run build:full
```

服务已启动时可运行完整质量门禁：

```bash
./scripts/dev-stack.sh
```

完整门禁包含 API smoke、租户隔离检查、前端构建和 Playwright E2E。与真实模型相关的测试需要配置服务端环境变量；模板见 [deploy/openatlas.env.example](deploy/openatlas.env.example)。

## 部署

生产部署参考 [deploy/README.md](deploy/README.md)。仓库不会提交 `.env`、密钥、本地数据库、日志、浏览器截图、依赖目录和构建产物。

## 当前技术债

- 后端 MVP 仍以单体 `backend/app/main.py` 为主，后续应按身份、协作、交付物、技能、记忆和 A2UI 场景拆分路由。
- 部分 `docs/DELIVERY-*` 与 `docs/SESSION-LOG-*` 是历史交付证据，只用于追溯，不代表当前入口。
- 前端大体积依赖已做路由懒加载和 vendor 分包，但 AI PPT、画布、Ant Design 等 chunk 仍有继续优化空间。
- TypeScript 生产构建已通过；严格 ESLint 仍有历史遗留的 `any`、未使用符号和 Hook 依赖问题，需按模块逐步清理。

## License

当前仓库未声明开源许可证。除非仓库所有者另行授权，默认保留全部权利。
