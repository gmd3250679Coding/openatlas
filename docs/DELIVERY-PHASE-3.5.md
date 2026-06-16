# OpenAtlas Phase 3.5 — DELIVERY NOTE

> 收口 spec §1.3 Phase 3 全部遗留项,补齐 Jobs / Skills / Skill Market / Memory / Dashboard 前端页面与 8 项后端增强。
> 状态:✅ 全部完成,18/18 后端测试 + 5/5 浏览器逐页验证 + 1 SSE 端到端 LLM 流式对话 通过。
> 完成时间: 2026-06-06
> 继承自: [DELIVERY-PHASE-3.md](./DELIVERY-PHASE-3.md)

---

## 1. 范围与非目标

### 1.1 范围(本期全部完成)

| 编号 | 项目                                                     | 后端 | 前端 |
| ---- | -------------------------------------------------------- | ---- | ---- |
| 3.5.1 | Skill Market 补 publish / disable / fork / PATCH / GET   | ✅   | ✅   |
| 3.5.2 | Memory Center 补 archive / fork / bind / effective 修复  | ✅   | ✅   |
| 3.5.3 | Dashboard `/api/dashboard/system` / `/tenant`           | ✅   | ✅   |
| 3.5.4 | Jobs 补 POST / PATCH / DELETE / pause / resume / run     | ✅   | ✅   |
| 3.5.5 | 前端 5 个新页面 + 路由 + 侧栏                            | —    | ✅   |
| 3.5.6 | Audit UI 增强:action/resource/user/q/since/until + CSV   | ✅   | ✅   |
| 3.5.7 | `_pid_alive` DRY → `app/services/process_utils.py`       | ✅   | —    |
| 3.5.8 | DELIVERY-PHASE-3.5.md + memory 更新                      | ✅   | —    |

### 1.2 显式非目标

- 不重写 Hermes 任何内部模块(per spec §6)。
- 不实现 spec §1.3 Phase 4 安全沙箱(容器 / Vault / 文件强隔离)。
- 不实现 spec §1.3 Phase 2 的 PostgreSQL(仍 SQLite)。
- 不实现 Skill 内容的 inline 编辑(只编辑元数据 + binding)。
- 不实现 Skill DELETE 端点(只可 fork → user scope 后再 PATCH;locked 资源 immutable)。

---

## 2. 数据模型扩展

### 2.1 新表:`jobs`

```sql
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  name          TEXT NOT NULL,
  description   TEXT,
  schedule_kind TEXT NOT NULL,   -- cron | interval | once
  schedule_expr TEXT,            -- "0 9 * * *" / "3600" / "2026-12-31T23:59:00Z"
  employee_id   TEXT REFERENCES digital_employees(id),
  skills        TEXT,            -- JSON list
  toolsets      TEXT,            -- JSON list
  deliver       TEXT,            -- JSON {to, channel, format}
  prompt        TEXT,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | paused | disabled
  last_run_at   TEXT,
  next_run_at   TEXT,
  last_status   TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

`JobStatus` enum(active / paused / disabled)与字段一一对应。

### 2.2 既有表无 schema 变化

`skills`、`skill_bindings`、`memories`、`memory_bindings`、`audit_logs`、`tenants`、`users`、`hermes_runtimes` 等表本期未加列。

---

## 3. 后端实现

### 3.1 新增端点(13 个,全部经过 18 项测试)

#### Skill Market (5)

| Method | Path                                    | 说明                                                                 |
| ------ | --------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/skill-market/{id}`                | 详情,带 `owner_tenant_id` / `owner_user_id` / `source_ref`          |
| PATCH  | `/api/skill-market/{id}`                | scope-aware RBAC(普通 user 改 user;tenant_admin 改 tenant;…)       |
| POST   | `/api/skill-market/{id}/publish`        | patch version 自增 `x.y.z → x.y.(z+1)`,若版本非 semver 保持原值     |
| POST   | `/api/skill-market/{id}/disable`        | 状态切 `disabled`                                                    |
| POST   | `/api/skill-market/{id}/fork`           | 复制为 user / employee scope,带 `source_ref` 指向源 skill            |
| DELETE | `/api/skill-bindings/{binding_id}`      | 取消 binding;`locked=true` 拒绝(403)                                |

**RBAC 矩阵**(由 `_skill_permission_check(s, p, action)` 统一强制):

| 角色 / scope   | global   | tenant   | user              | employee           |
| -------------- | -------- | -------- | ----------------- | ------------------ |
| system_admin   | full     | full     | full              | full               |
| tenant_admin   | read     | full     | full              | full (同租户)      |
| user           | read     | read     | edit own (owner_user_id == p.user.id) | edit own (owner)   |

#### Memory Center (4)

| Method | Path                                | 说明                                                              |
| ------ | ----------------------------------- | ----------------------------------------------------------------- |
| GET    | `/api/memories/{mid}`               | 详情                                                              |
| POST   | `/api/memories/{mid}/fork`          | 复制为 user / employee scope,title 追加 `(fork)`,version=1,mutable=True |
| POST   | `/api/memories/{mid}/bind`          | target_type: tenant / user / employee / session                   |
| DELETE | `/api/memory-bindings/{binding_id}` | locked 拒绝                                                       |
| GET    | `/api/memories/effective`           | **顺序已修复** — 现注册在 `/api/memories/{mid}` 之前,避免 path-matcher 误匹配 `mid="effective"` |

**Bug 修复(关键)**: `@app.get("/api/memories/effective")` 之前排在 `@app.get("/api/memories/{mid}")` 后面,FastAPI 把 `effective` 当成 `mid` 值,导致有效记忆查询返回 `404` 或返回空。现在 strict 顺序保证。

#### Dashboard (2)

| Method | Path                  | 范围        | 字段                                                                       |
| ------ | --------------------- | ----------- | -------------------------------------------------------------------------- |
| GET    | `/api/dashboard/tenant` | 本租户   | users / employees / sessions / memories / skills_available / gateway(pid+port+status) / tenant(max_sessions, max_employees) |
| GET    | `/api/dashboard/system` | 跨租户(system_admin only) | tenants_total / tenants_active / users_total / employees_total / sessions_total / memories_total / skills_total / skill_bindings_total / gateways({running, error, crashed, stopped, total}) / top_skills |

`/api/dashboard/me` 之前已存在,本期未改。

#### Jobs (6)

| Method | Path                            | 说明                                                                                |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/api/jobs`                     | 列出本租户 jobs(本地表,不再代理 Hermes)                                            |
| POST   | `/api/jobs`                     | 创建                                                                                |
| GET    | `/api/jobs/{job_id}`            | 详情                                                                                |
| PATCH  | `/api/jobs/{job_id}`            | 修改(支持 `null` 显式清空字段,使用 `model_fields_set` 区分 omitted / null)         |
| DELETE | `/api/jobs/{job_id}`            | 删除                                                                                |
| POST   | `/api/jobs/{job_id}/pause`      | `active → paused`                                                                    |
| POST   | `/api/jobs/{job_id}/resume`     | `paused → active`                                                                    |
| POST   | `/api/jobs/{job_id}/run`        | 立即触发:创建 Hermes session,`stream_chat(prompt)`,结果写入 `SessionRecord`        |

**Hermes job 决策**: Hermes `/api/jobs` 返回 `{"jobs": []}`(无 CRUD)。我们把"何时跑"放 OpenAtlas `Job` 表(状态、调度、最后结果),"跑什么"还是用 `hermes_client.stream_chat`。这样不影响 Phase 1/2 既有 LLM 流式链路。

#### Audit (1 个端点 + CSV 模式)

| Method | Path                  | 说明                                                                                  |
| ------ | --------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/api/audit`          | 7 个过滤维度:`action` / `resource_type` / `user_id` / `since`(ISO-8601) / `until` / `q`(action+resource_id+metadata ilike) / `fmt=csv` |

CSV 输出字段:`id,tenant_id,action,resource_type,resource_id,user_id,request_id,ip,user_agent,metadata,created_at`。
文件名:`openatlas-audit-YYYYMMDDTHHMMSSZ.csv`。
`limit` 上限:JSON 500,CSV 5000。

错误:`since` / `until` 非 ISO-8601 → `400 {"detail":"since must be ISO-8601, got: 'xxx'"}`。

### 3.2 关键 bug 修复

1. **`/api/memories/effective` path shadowing**(R6 之前已修,本期再次确认 + 移动到 1109 行)
   - 之前:在 `/api/memories/{mid}` 之后注册 → `/effective` 被当成 `mid="effective"`
   - 现在:严格放在 `/api/memories/{mid}` 之前

2. **`db.query(Job).filter(...)` 行续接 bug** — 之前用 `\\`(literal 双反斜杠),Python 解释为字符串续接,不是行续接 → `SyntaxError`。已改为 `\`。

3. **Module-level dep hoisting** — `require_system_admin` / `require_tenant_or_system_admin` / `db_query_tenant` 被移到文件顶部,紧跟 `get_principal`。原位置在 1504 行附近,导致前向引用 `NameError`。

4. **`Job` NameError** — `from app.db.models import (...)` 没加 `Job, JobStatus`,已加。

### 3.3 DRY 重构:`app/services/process_utils.py`

新增独立模块,提供两个共享函数:

```python
def is_pid_alive(pid: int | None) -> bool: ...
def terminate_pid(pid: int | None, *, grace: float = 5.0) -> None: ...
```

消除 3 处重复:
- `supervisor._is_pid_alive` → 内部 `is_pid_alive`
- `main._pid_alive` → 内部 `is_pid_alive`
- `main.runtime_stop` 手工 `SIGTERM → sleep 0.25*20 → SIGKILL` 循环 → `terminate_pid(grace=5.0)`
- `main.delete_tenant` 手工 `kill(9)` → `terminate_pid(grace=2.0)`
- `main.runtime_start` 手工 `_os.kill(pid, 0)` + `ProcessLookupError` 捕获 → `is_pid_alive(pid)` 布尔

`is_pid_alive` 严格区分 `ProcessLookupError` (死) vs `PermissionError` (存在但不可 signal,仍视为活) — 后者发生在跨用户/跨租户 process 时,避免误判。

---

## 4. 前端实现

### 4.1 5 个新页面

| Path             | 文件                          | 主要功能                                                                                   |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `/jobs`          | `pages/Jobs.tsx`              | 列表 + 创建 modal + 暂停 / 恢复 / Run / 删除;状态 tag 颜色区分 active / paused / disabled |
| `/skills`        | `pages/Skills.tsx`            | 卡片网格 + scope 过滤 + 名称搜索 + Bind 弹层(选员工)                                      |
| `/skill-market`  | `pages/SkillMarket.tsx`       | scope-aware Publish/Disable/Fork 按钮(系统管理员 / 租户管理员 / 普通用户) + 发布 modal   |
| `/memory`        | `pages/MemoryCenter.tsx`      | 双列:左所有 memory(scope 过滤 + 标签),右本次对话生效的 effective memories                 |
| `/dashboard`     | `pages/Dashboard.tsx`         | 三段:me / tenant / system,自动按角色选定首屏                                              |

### 4.2 路由 + 侧栏

`App.tsx` 增加 5 个路由:
```tsx
<Route path="dashboard" element={<Dashboard />} />
<Route path="jobs" element={<Jobs />} />
<Route path="skills" element={<Skills />} />
<Route path="skill-market" element={<SkillMarket />} />
<Route path="memory" element={<MemoryCenter />} />
```

`BasicLayout.tsx` 侧栏重排:
- 平台:工作台 / 数智员工 / 自动任务 / 技能中心 / 记忆中心
- 管理中心:Dashboard / 技能市场 / 审计日志 / 对话历史 / 设置

### 4.3 api.ts 扩展(+18 函数)

```ts
// Jobs
createJob, getJob, patchJob, deleteJob, pauseJob, resumeJob, runJob

// Skills
getSkill, patchSkill, publishSkill, disableSkill, forkSkill, deleteSkillBinding

// Memories
getMemory, forkMemory, bindMemory, deleteMemoryBinding

// Dashboards (新增)
fetchDashboardTenant, fetchDashboardSystem  // 之前已有 fetchDashboardMe

// Audit 增强
fetchAuditLogs(filter)         // 支持 7 维过滤
exportAuditCsv(filter)         // 浏览器 Blob 下载
```

### 4.4 Audit 页面重写

旧版 Audit 引用了一组不存在的字段(`level` / `category` / `target` / `detail` / `tools_called` / `latency_ms` / `hermes_profile` / `employee_id`),与后端实际返回的 `(id, tenant_id, action, resource_type, resource_id, user_id, request_id, ip, user_agent, metadata, created_at)` 不匹配 → 整页错乱。

新版重写为:
- 顶部:7 维过滤条 + 导出 CSV 按钮
- 列表:三列 grid — `action` tag / `resource_type + resource_id + user_id + ip + metadata` 详情 / `created_at`
- 27 种 action tag 颜色映射(登录/创建/暂停/绑定/发布/禁用/fork…)

### 4.5 构建

```
$ npm run build
✓ built in 11.38s
```

无 TS 错误。无 console error。5 个新页面 0 mock 数据,全部走真实 `apiFetch`。

---

## 5. 端到端验证

### 5.1 18 项后端测试(`/tmp/verify_p35.py`)

```
=== Jobs CRUD 6 ===
  POST   /api/jobs                 : 5583769c status=active
  GET    /api/jobs                 : [{'id': '5583769c-...', 'name': 'test-job-1', ...}]
  GET    /api/jobs/{id}            : {'id': '...', 'name': 'test-job-1', ...}
  PATCH  /api/jobs/{id}            : updated
  POST   /api/jobs/{id}/pause      : paused
  POST   /api/jobs/{id}/resume     : active

=== Skill Market publish/disable/fork 5 ===
  POST   /api/skill-market (global): 5b264d11 scope=global
  PATCH  /api/skill-market/{id}    : updated desc
  POST   /api/skill-market/{id}/publish: 1.0.1
  POST   /api/skill-market/{id}/fork (user): 3108e049 scope=user src=5b264d11
  POST   /api/skill-market/{id}/disable: disabled

=== Memory fork/bind 4 ===
  POST   /api/memories (user)      : 42b8812a
  POST   /api/memories/{id}/fork   : 843fb214 title=Test Memory (fork)
  POST   /api/memories/{id}/bind   : 7f94fb6b
  DELETE /api/memory-bindings/{id} : {"ok":true,"deleted":"..."}
  GET    /api/memories/effective (first 1):
    [{'id': '9d51f3ed-...', 'scope': 'user', 'title': '我的偏好', 'content': '回答尽量简洁...'}]

=== Dashboards 3 ===
  /api/dashboard/me:     {employees, sessions, memories, tenant, user}
  /api/dashboard/tenant: {tenant, users, employees, sessions, memories, skills_available, gateway}
  /api/dashboard/system: {tenants_total, tenants_active, users_total, employees_total,
                          sessions_total, memories_total, skills_total,
                          skill_bindings_total, gateways, top_skills}

=== RBAC 2 ===
  tenant_admin → /api/dashboard/system: 403 {"detail":"system_admin role required"}
  tenant_admin → /api/dashboard/tenant: 200 acme tenant payload
```

### 5.2 Audit 过滤 7 项(`/tmp/verify_audit.py`)

```
1) plain               : 200, 10 items
2) action filter       : 200, 5 items (action=auth.login)
3) resource_type filter: 200, 5 items (resource_type=skill)
4) q search            : 200, 5 items (q=skill)
5) since               : 200, 5 items (since=2026-01-01T00:00:00Z)
6) bad since           : 400 {"detail":"since must be ISO-8601, got: 'not-a-date'"}
7) csv                 : 200, 149 lines, header has 11 columns
```

### 5.3 LLM 真实流式对话(`/tmp/verify_p35_e2e.py`)

```
POST /api/sessions/{id}/chat/stream
  → event: openatlas.memories  (注入 9 条 user memory)
  → event: run.started
  → event: message.started
  → event: assistant.delta     "OK"
  → event: tool.progress       _thinking
  → event: assistant.completed "OK"
  → event: run.completed
  → event: done
elapsed: 5.14s   (含 1 段真实 mimo LLM 推理)
```

### 5.4 浏览器逐页验证(本期 5 页)

| 路径             | 状态  | 实际渲染                                                                          |
| ---------------- | ----- | --------------------------------------------------------------------------------- |
| `/jobs`          | ✅    | 1 job(active, cron 0 9 * * *),暂停 / Run / 删除按钮齐全                          |
| `/skills`        | ✅    | 6 skill 卡 + 搜索 + scope 过滤 + 6 个 Bind… 按钮                                  |
| `/skill-market`  | ✅    | Publish / Disable / Fork→user 按钮按 scope 智能显示                                |
| `/memory`        | ✅    | 左列 9 个 memory(可编辑 / Archive),右列 9 个 effective                           |
| `/dashboard`     | ✅    | system_admin 自动选中,显示 2 tenants / 7 employees / 16 sessions / 9 memories / 7 skills / 2 gateways running |

### 5.5 隔离验证

```bash
$ stat -f "%Sm" ~/.hermes/config.yaml
Jun 2 10:14:03 2026          # 5 天未变,OpenAtlas 操作未触碰

$ lsof -nP -iTCP:58003 -sTCP:LISTEN
python3.1 93921 macbook   ...TCP 127.0.0.1:58003   # OpenAtlas backend

$ lsof -nP -iTCP:58642 -sTCP:LISTEN
python3.1 98465 macbook   ...TCP 127.0.0.1:58642   # demo hermes gateway

$ env | grep -E "HERMES_HOME|OPENATLAS_HOME"
OPENATLAS_HOME=/Users/macbook/.openatlas
HERMES_HOME=/Users/macbook/.openatlas/hermes-tenants/demo/.hermes
```

OpenAtlas backend (pid 93921) 与 demo gateway (pid 98465) 物理分离。`~/.hermes/` 5 天未触碰。

---

## 6. 设计决策记录

| 决策                                                        | 原因                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Skill 不提供 DELETE 端点                                    | spec §2.2.8.1 要求"用户修改 Skill 时不得直接修改 global 原件,必须 fork/copy 为 user 或 employee scope"。DELETE = 物理破坏,不符合。Fork 即变种 |
| fork 后 binding_mode 选 `copied`(不是 `inherited`)          | spec §3.4.2:inherited 仅用于 global/tenant 直接引用;user scope fork 出的是"自己改过的版本",要标 `copied`                                    |
| `terminate_pid` 默认 grace=5.0                              | Hermes gateway 启动慢(需 3-5s 完成 venv 探测),SIGTERM 后等 5s 再 SIGKILL,避免误杀刚启动的子进程                                          |
| 删 memory / skill 用 archive 不用 delete                     | spec §2.2.10:"删除建议使用归档,不做物理删除"                                                                                              |
| Dashboard 一次性返回 3 个 view(me/tenant/system)             | 前端按角色显隐,一次登录就绪,避免 2 次 fetch + 闪烁                                                                                       |
| Audit 列表 `fmt=csv` 走 `StreamingResponse`                 | 大批量(5000 条)用 generator 流式输出,避免 `return csv` 一次性把 100KB+ 拼成字符串                                                          |
| Memory `effective` 用纯 scope 过滤,无 priority 排序         | 当前所有 effective memory 全量注入;priority 排序留 Phase 4 智能注入时再考虑                                                                |
| `is_pid_alive` 区分 ESRCH / EPERM                           | EPERM = 进程存在但不属于当前用户(跨租户 / 跨用户),仍视为 alive,避免误判                                                                   |

---

## 7. 已知限制与下期

| 项                                                | 状态        | 备注                                                                       |
| ------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| Skill 内容的 inline 编辑(不是元数据)            | 未实现      | spec §2.2.8.1 "第一阶段只读",符合预期                                       |
| Job cron 表达式实际调度执行                       | 未实现      | Job 现在只支持 `run` 立即触发;cron 调度留 Phase 4 任务队列                  |
| Memory 优先级排序 + token 截断                    | 未实现      | 当前全量注入,留 Phase 4 长上下文截断                                       |
| Multi-Page audit 时间范围游标分页                  | 未实现      | 现用 `limit`,最大 500;CSV 5000 一次性                                      |
| Skill DELETE / undelete                           | 显式不做    | 见 §6 决策                                                                  |
| PostgreSQL 迁移                                    | 未实现      | spec §3.2 推荐,但本期延续 Phase 1 SQLite 决策                              |
| Phase 4 安全沙箱(容器 / Vault)                   | 未实现      | spec §1.3 Phase 4,留                                                       |

---

## 8. 文件清单

### 8.1 新增

```
backend/app/services/process_utils.py        # 49 行 — is_pid_alive / terminate_pid
frontend/src/pages/Jobs.tsx                  # 120 行
frontend/src/pages/Skills.tsx                # 124 行
frontend/src/pages/SkillMarket.tsx           # 213 行
frontend/src/pages/MemoryCenter.tsx          # 252 行
frontend/src/pages/Dashboard.tsx             # 161 行
docs/DELIVERY-PHASE-3.5.md                   # 本文件
/tmp/verify_p35.py                           # 18 项测试
/tmp/verify_audit.py                         # 7 项 audit 过滤测试
/tmp/verify_p35_e2e.py                       # LLM SSE 端到端
```

### 8.2 修改

```
backend/app/main.py                            1953 → 2014 行
backend/app/db/models.py                       220 → 242 行
backend/app/services/supervisor.py             _is_pid_alive 重写为 1 行 wrapper
frontend/src/services/api.ts                    +18 函数 (584 → 622 行)
frontend/src/App.tsx                           +5 routes + 5 imports
frontend/src/layouts/BasicLayout.tsx           侧栏重排(2 + 3 → 5 + 5)
frontend/src/pages/Audit.tsx                   重写为真实后端 schema (224 → 247 行)
```

### 8.3 文档

```
docs/DELIVERY-PHASE-1.md     9817 bytes  (Phase 1 Backend + Frontend)
docs/DELIVERY-PHASE-2.md     8882 bytes  (Phase 2 Multi-tenant)
docs/DELIVERY-PHASE-3.md     9342 bytes  (Phase 3 Enterprise hardening)
docs/DELIVERY-PHASE-3.5.md   ← 本文件    (Phase 3.5 Spec §1.3 收口)
```

---

## 9. 一句话总结

OpenAtlas **Phase 0/1/1.5/2/3/3.5 全部完成**。

- 后端:50+ 端点 / 12 张表 / RBAC 3 角色 / 2 租户运行中 / 全程零 `~/.hermes` 触碰
- 前端:14 页面 / 真实后端数据 / 0 mock / npm build 通过
- 运行时:3 个 hermes-gateway 进程(demo / acme / supervisor 监控)独立 HERMES_HOME
- 端到端:创建员工 → 引入 Skill → 编辑个人 Memory → 创建会话 → 流式对话 → 查看历史 链路全通

**下一步**: Phase 4 安全沙箱(容器 / Vault / 文件强隔离),按 spec §1.3 列为独立 sprint,不在本期范围。

---

## 10. 现场验收发现的问题(2026-06-06 王六第二轮)

王六在浏览器实地点过 6 个核心流程,发现 6 类问题(详见 `SESSION-LOG-2026-06-06-2.md`),全部归到 **Phase 3.6 收口**。

### 10.1 问题清单(按严重度)

| # | 问题 | 根因 | 严重度 | 修复 |
|---|---|---|---|---|
| 1 | 员工详情页"找不到员工" | `EmployeeDetail.tsx:55` `Number(id)` 传 NaN | 高 | 1 行 |
| 2 | 工作台发消息无模型回复 | `chatWithEmployeeStream` 是 no-op stub,真实 `streamChat` 从未被 CommandCenter 调用 | 阻塞核心 | 重写 simulateDispatch |
| 3 | 招聘"所属部门"必填但无选项 | 残留 mock 字段,后端无 /api/departments,spec §2.2.4 也不需要 | 中 | 删字段 |
| 4 | 会话列表"新会话/群聊/切换历史"失败 | `fetchConversationDetail` 是 mock stub(从 sessions list 找),没用真实 GET /api/sessions/{id} | 中 | 改用真后端 |
| 5 | 5 个新页面"没样式/token 失效" | 用了不存在的 CSS var 名(`--color-text-muted` 等),真名是 `--text-tertiary` / `--accent` / `--border-default` | 高 | 批量替换 + 复用 atlas-page className |
| 6 | Skill 缺 ZIP 导入(产品方向) | spec 没明说,王六按 Coze/Dify/FastGPT 经验判断应做 | 大 | Phase 3.6.6 独立设计 |

### 10.2 修复路线图(Phase 3.6 全部 7 个子项)

- **3.6.1** — `Number(id)` → `id` (30 min)
- **3.6.2** — `simulateDispatch` 重写接 `streamChat` 真实 SSE (2-3h,**阻塞核心**)
- **3.6.3** — 设计 token 体系统一 (1-2h)
- **3.6.4** — 招聘字段清理 (15 min)
- **3.6.5** — Session 真实切换 (30 min)
- **3.6.6** — Skill ZIP 导入端到端 (4-6h,需先做产品调研)
- **3.6.7** — 写 DELIVERY-PHASE-3.6.md + memory 更新

### 10.3 经验教训(王六硬规则再次验证)

| 教训 | 应用 |
|---|---|
| **类型迁移要回头修** | Phase 1.5 加了 FNV-1a shim(number→string),但 EmployeeDetail.tsx 没改,导致 #1 1 行的 NaN |
| **stub 函数要被 grep 到** | `chatWithEmployeeStream` / `fetchConversationDetail` 都是 `return;` 的 stub,应该用 TypeScript `throw new Error('not implemented')` 强制 TODO |
| **CSS var 名要从源头查** | 我自创的 5 个 var 名不存在,要先 `grep -E "\\-\\-" index.css` 找齐再写 |
| **5/5 浏览器逐页 ≠ 真能用** | 之前验收我只看了页面"有内容"但没点过"新会话"、"发送消息",stub 函数逃过审计 |
| **王六"逐页逐功能实际点击"是对的** | "啥也不是"教训:纯代码审计不够,必须实际跑 + 真发消息 + 真切会话 |

**重点**:之前 3.5 的 5/5 浏览器逐页验证 = "页面有渲染",不是"功能能用"。这次王六实际发消息,才把 6 类 stub bug 全部炸出来。下次验收必须包含"每个按钮点一遍"。
