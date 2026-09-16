# 项目结构与发布边界

```text
openatlas/
├── .env.example    本地模型配置模板；复制为被 Git 忽略的 .env 后填写密钥
├── backend/        FastAPI、SQLAlchemy、任务编排、质量脚本
├── frontend/       React Web 应用、页面、组件、E2E
├── runtime/        内置 Hermes Agent 源码与隔离启动适配
├── scripts/        本地开发启动入口
├── deploy/         nginx、systemd、CVM 发布与云端质量门禁
├── demo-pack/      可公开的演示材料与种子数据
├── docs/           当前说明、专项设计和历史交付记录
├── outputs/        人工保留的产品清单；其余生成结果默认忽略
├── VERSION         当前整理版本
└── CHANGELOG.md    版本变更记录
```

## 源码与运行数据

源码仓库负责保存可复现产品能力，不保存某台机器的运行状态。

| 类型 | 位置 | 是否入库 |
| --- | --- | --- |
| 前后端源码 | `frontend/src/`、`backend/app/` | 是 |
| 自动化测试 | `frontend/e2e/`、`backend/scripts/*smoke*.py` | 是 |
| 部署模板 | `deploy/` | 是，但只提交示例值 |
| Hermes runtime 源码 | `runtime/hermes/` | 是，固定为已验证的上游版本 |
| 产品直接引用的静态资产 | `frontend/public/` | 是 |
| 依赖 | `node_modules/`、`.venv/` | 否 |
| 构建结果 | `frontend/dist/`、`dist/` | 否 |
| 数据与日志 | `.local/`、`.openatlas-dev/`、`*.db`、`*.log` | 否 |
| 浏览器测试结果 | `.playwright-cli/`、`test-results/`、`playwright-report/` | 否 |
| 本地环境模板 | `.env.example` | 是，只含空值和示例值 |
| 本地环境与密钥 | `.env`、`*.key`、`*.pem` | 否 |

## 版本判断

以后判断“最新版本”时，以以下顺序为准：

1. Git 默认分支上的最新提交。
2. 根目录 `VERSION`。
3. `CHANGELOG.md` 中最上方的版本记录。
4. `README.md` 与 `docs/FEATURES.md` 描述的当前入口。

历史日志不应覆盖上述文件中的当前结论。
