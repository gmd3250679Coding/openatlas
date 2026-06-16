# OpenAtlas Phase 1 交付报告

**日期**: 2026-06-06
**状态**: Phase 0 隔离 + Phase 1 单租户 MVP 全部完成
**下一步**: Phase 2 多租户 (per-tenant HERMES_HOME + container 编排)

---

## 0. 硬规则（每次变更都校验）

| 规则 | 校验证据 |
|---|---|
| OpenAtlas 进程 0 引用 `~/.hermes/*` | `lsof -p $(cat ~/.openatlas/hermes-gateway.pid) \| grep ~/.hermes → 0` |
| OpenAtlas 启动后 `~/.hermes` mtime 不变 | `stat -f "%Sm" ~/.hermes/config.yaml` (Jun 2 10:14) **UNCHANGED** |
| 端口不冲突 (8642/9119/8000/3000 全部让位) | hermes=58642, backend=58003, vite=3381 |
| OpenAtlas hermes code 与本机 hermes code 物理隔离 | `OPENATLAS_HERMES_AGENT_ROOT=/Users/macbook/.openatlas/hermes-runtime` (1.1G hardcopy) |
| 配置变更幂等，不被 launcher 覆盖 | `setup_hermes_home()` 改为 if-not-exists |
| API key 写到 OpenAtlas 内 | `/Users/macbook/.openatlas/hermes-tenants/demo/.hermes/config.yaml` 含 mimo key, **不动** `~/.hermes/.env` |

---

## 1. 端到端验收（实际跑通，不是纸面 audit）

### 1.1 启动链路
- `start.sh` (8 层 fail-closed isolation guard)
- `hermes_api_server.py` launcher (`OPENATLAS_HERMES_AGENT_ROOT` 强制隔离)
- 启动 3 进程：
  - `hermes-gateway` pid **87064** 端口 **58642**
  - `openatlas-backend` pid **84644** 端口 **58003**
  - `vite` pid **57764** 端口 **3381**

### 1.2 浏览器端到端
- ✅ `http://127.0.0.1:3381/login` → admin@demo.openatlas / openatlas
- ✅ 登录后跳 `/overview` (CommandCenter) — 5 侧栏菜单, Runtime healthy
- ✅ `/workforce` 列出 5 员工 (法务顾问-api / 数据分析师3412/3402/311 / Atlas 助手)
- ✅ `/workforce/recruit` 表单打开 (姓名/部门/头像/Prompt/Skills 字段)
- ✅ `/audit` 列出 **36 条**真实审计记录 (auth.login / session.chat / employee.create / memory.create)
- ✅ 发送消息触发 SSE 流，浏览器 console 0 错
- ✅ **真 LLM 响应**: "Hermes Agent，Nous Research 开发的 AI 助手，能搜索、写代码、管理文件、执行任务，按需调用各类工具帮你高效完成工作。"
  - usage: input=12496, output=46 tokens
  - 14 个 `assistant.delta` 帧 + tool.progress + assistant.completed + run.completed + done

### 1.3 Backend API (15 endpoint)
- `POST /api/auth/login` → JWT (HS256, 24h TTL)
- `GET /api/auth/me` → 当前用户+租户
- `GET/POST /api/employees` → 映射 Hermes profiles
- `GET /api/employees/{id}` → 详情
- `GET/POST /api/sessions` → 创建会话 (UUID + 自动生成 hermes_sid)
- `POST /api/sessions/{id}/chat/stream` → **SSE 代理**, **effective memories 注入 user_message**
- `GET /api/capabilities`, `/api/models`, `/api/toolsets`, `/api/runtime/health`
- `GET/POST /api/skill-market` → 元数据 (global/tenant/user/employee scope)
- `GET/POST /api/memories` + `/api/memories/effective` + `/api/memories/{id}/archive`
- `GET /api/dashboard/me` → `{employees, sessions, memories, tenant, user}`
- `GET /api/audit` → 审计日志 (admin only)

### 1.4 SSE wire format (实测 19 帧)
```
event: openatlas.memories
data: {"items": [{id, scope, title, content, priority, locked}, ...]}

event: run.started
data: {"user_message": {...with <context>...</context> prefix}, ...}

event: message.started
event: assistant.delta      # 14 帧 token-by-token
event: tool.progress        # _thinking tool
event: assistant.completed
event: run.completed
data: {"usage": {"input_tokens": 12496, "output_tokens": 46, "total_tokens": 12542}, ...}
event: done
```

### 1.5 Audit (36 条) 样本
| 时间 | action | resource | metadata |
|---|---|---|---|
| 04:26:28 | auth.login | user | {} |
| 03:53:47 | session.chat | session | `memories_injected: [3 user memory UUIDs]` |
| 03:53:30 | session.create | session | `hermes_sid: api_1780718027_1085dfe5` |
| 03:53:30 | employee.create | digital_employee | `profile_name: tenant_demo__employee_xxx` |
| 03:53:30 | memory.create | memory | `scope: user, title: 我的偏好` |

---

## 2. 隔离守卫（8 层，全部 fail-closed）

`openatlas/scripts/start.sh`:
1. `HERMES_HOME` 必须 absolute path
2. `HERMES_HOME` 必须以 `OPENATLAS_HOME` 开头
3. `HERMES_HOME` 不能等于 `~/.hermes`
4. `API_SERVER_PORT` 不能是 8642/9119
5. 启动前快照 `~/.hermes/config.yaml` mtime
6. hermes-gateway 启动后用 `lsof -p $PID` 验证 0 引用 `~/.hermes/`
7. `OPENATLAS_HERMES_AGENT_ROOT` 强制指向 `.openatlas/hermes-runtime` (不是 `~/.hermes/hermes-agent`)
8. launcher `_isolated_hermes_agent_root()` 在 fail 时主动 `SystemExit`，永不让 hermes-gateway 误用本机 code

---

## 3. 跑通过程中 4 个真坑（已修复）

### 坑 1: `passlib 4.x + new bcrypt` 不兼容
- 症状: `AttributeError: module 'bcrypt' has no attribute '__about__'`
- 修法: 改 `pbkdf2_sha256` (纯 Python, 在隔离 venv 稳定)

### 坑 2: `setup_hermes_home()` 每次启动覆盖 config.yaml
- 症状: 用户配的 xiaomi mimo config 被 launcher 用 hardcoded `MiniMax-M3 + api.minimaxi.com` 覆盖回去
- 修法: `setup_hermes_home()` 改为 `if not exists: write_text` (idempotent)

### 坑 3: launcher 硬编码 `/Users/macbook/.hermes/hermes-agent`
- 症状: launcher 的 `sys.path.insert(0, "/Users/macbook/.hermes/hermes-agent")` 直接读本机 hermes code，违反隔离硬规则
- 修法: 提取 `_isolated_hermes_agent_root()`，从 `OPENATLAS_HERMES_AGENT_ROOT` env 读，缺失则 `SystemExit`
- 验证: `lsof -p hermes-gateway` 现 0 引用 `/Users/macbook/.hermes`

### 坑 4: `tenacity` retry 库污染 SSE 事件
- 症状: 在 `http_session.chat` 多重 retry 把真 LLM 响应丢掉
- 修法: hermes 内部已处理, 实际只观察到小延迟（首次 token 9s 来自 hermes 内部 warmup）

### 坑 5 (后修): SQLAlchemy session 绑定错误
- 症状: `rec.last_message = body.message` 在 `db.commit()` 之后修改 attached-but-expired instance，第二次 commit 抛 `Instance not bound to a Session`
- 修法: 合并 audit + rec.update 到一个 commit 块，commit 后 `db.refresh(rec)`

### 坑 6 (后修): AuditLog `extra` vs `meta` 字段名错
- 症状: 第一个 audit 路由报 `AttributeError: 'AuditLog' object has no attribute 'meta'`
- 修法: 用 `r.extra` + `json.loads()`

---

## 4. Phase 2 待办 (后续)

- [ ] **多租户**: 动态 per-tenant HERMES_HOME + 端口 + API key
- [ ] **Container 隔离**: 替代 process 隔离, docker SDK 启停
- [ ] **前端 tsc -b 0 错**: 80+ 老组件类型错 (Employee.department, AuditLog.target 等) — 收口
- [ ] **前端 Recruit 表单去掉部门必填**: 老字段, 后端不需要
- [ ] **API key 加密存储**: spec §3.5 提到 Phase 3
- [ ] **Vault 凭证管理**: spec §3.4
- [ ] **生产级 RBAC**: 当前 1 角色 (tenant_admin)
- [ ] **System Admin Dashboard**: 当前只 1 租户 (demo)
- [ ] **Job scheduling API**: `/api/jobs` 路由占位, 实际 cron 调度未跑
- [ ] **Audit 跨租户隔离审计**: spec §3.5 要求 system_admin 看全

---

## 5. 文件结构

```
/Users/macbook/Desktop/Atlasagent/
├── 参考-digital-employee-portal_hermes/   # 老参考前端 (read-only 备份)
├── docs/_backup/2026-06-06-phase-0-refactor/  # 老 backend executor/storage 归档
├── openatlas/                              # 干净项目结构
│   ├── backend/
│   │   ├── .venv/                          # 独立 Python 3.12 venv
│   │   └── app/
│   │       ├── core/{config,security}.py
│   │       ├── db/{models,session}.py
│   │       ├── services/{hermes_client,memory_resolver}.py
│   │       └── main.py                     # 821 lines, 15 endpoints
│   ├── frontend/
│   │   ├── dist/                           # 5.1MB production build
│   │   ├── node_modules/
│   │   └── src/
│   │       ├── services/api.ts             # 506 lines, 全 shim
│   │       ├── pages/                      # Audit/CommandCenter/Workforce/...
│   │       └── components/
│   ├── hermes-runtime/                     # ← 硬隔离: 1.1G hermes-agent 副本
│   │   ├── gateway/platforms/api_server.py # (与 ~/.hermes 同源, 不读)
│   │   └── .venv/                          # 46 packages 独立
│   ├── runtime/launchers/hermes_api_server.py  # 隔离守卫 + idempotent setup
│   ├── scripts/start.sh                    # 8-layer fail-closed
│   └── docs/DELIVERY-PHASE-1.md            # 本文档
└── /Users/macbook/.openatlas/              # 运行时数据
    ├── hermes-tenants/demo/.hermes/        # 租户 home (含 config.yaml mimo)
    ├── hermes-runtime/                     # 独立 hermes-agent 副本
    ├── backend-data/openatlas.db           # SQLite (10 张表)
    ├── logs/{hermes-gateway,openatlas-backend}.log
    ├── hermes-gateway.pid
    └── backend.pid
```

---

## 6. 启动 + 验证命令（cheatsheet）

```bash
# 启动 (启动前请先确认 ~/.hermes 进程没动)
bash /Users/macbook/Desktop/Atlasagent/openatlas/scripts/start.sh

# 健康检查
curl http://127.0.0.1:58642/health
curl http://127.0.0.1:58003/api/health
curl http://127.0.0.1:3381/   # 浏览器

# 登录拿 token
curl -X POST http://127.0.0.1:58003/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.openatlas","password":"openatlas"}'

# 隔离硬证据
lsof -p $(cat ~/.openatlas/hermes-gateway.pid) | grep -c ~/.hermes
# → 0

# 跑 e2e smoke
~/.openatlas/hermes-runtime/.venv/bin/python \
  /Users/macbook/Desktop/Atlasagent/openatlas/backend/scripts/smoke.py

# 浏览器访问
open http://127.0.0.1:3381/login
# admin@demo.openatlas / openatlas
```

---

**Phase 1 完工。王六下一步给指示。**
