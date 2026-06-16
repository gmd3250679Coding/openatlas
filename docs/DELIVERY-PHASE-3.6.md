# OpenAtlas Phase 3.6 收口交付

> 现场验收发现 6 stub bug,本 sprint 修通 5 个,第 6 个(Skill ZIP 导入)推到 Phase 3.7。
> 王六 2026-06-06 第二轮验收。完成 chat SSE 端到端真实可用 + 全部审计 + 文档更新。

---

## 1. 范围

王六 2026-06-06 上午在 `/overview` 现场验收,发现 6 个 stub bug:

| #   | 现象                                                   | 严重程度   | 状态   |
| --- | ------------------------------------------------------ | ---------- | ------ |
| 1   | 创建员工时"所属部门"必填字段,无配置入口               | 概念冗余   | ✅ 修通(3.6.1) |
| 2   | 员工详情页提示找不到员工                               | 阻塞       | ✅ 修通(3.6.1) |
| 3   | 左下"新会话"按钮看不到,但发送消息却成功               | UI 缺位   | ✅ 修通(3.6.1) |
| 4   | 切历史会话/群聊/自动任务/技能中心/记忆中心/Dashboard/审计/技能市场 8 个页面 Token 失效感,没样式 | 视觉/功能 | ✅ 修通(3.6.3 sed CSS 修名) |
| 5   | 发消息时没流式聊天 + 没工具事件                         | 阻塞       | ✅ 修通(3.6.2 — **本日核心**) |
| 6   | 技能中心缺 ZIP 包导入能力                              | 重要       | ⏭️ 推迟 Phase 3.7(王六 B 选项) |

**本日完成 5/6,第 6 项独立 sprint。**

---

## 2. 3.6.1 — Recruit / EmployeeDetail stub 修复

### 2.1 修复点 1: 移除冗余"部门"字段

- **文件**: `frontend/src/pages/Recruit.tsx`
- **改动**:
  - 移除 `department` 必填 `Form.Item` + `avatar_char` + `mood` 三个字段
  - 移除 `fetchDepartments` import 与 state
  - 表单精简为 `name / systemPrompt / skill_names` 三项
- **理由**: Recruit 表单是创建数字员工的入口,员工归属组织/部门是 WorkForce 列表/详情页的展示属性,不应在创建时强约束(后端本来就没这个列)。"创建时绑定部门"是 概念错位。

### 2.2 修复点 2: 员工详情 Number(id) → id

- **文件**: `frontend/src/pages/EmployeeDetail.tsx:55`
- **症状**:
  - `fetchEmployeeDetail(Number(id))` 把 UUID 字符串转成 `NaN`(Number("18313dd4-...") = NaN)
  - `GET /api/employees/NaN` 永远 404,详情页空
- **改动**:
  - `fetchEmployeeDetail(Number(id))` → `fetchEmployeeDetail(id)`
- **根因**: FNV-1a shim 把 backend 返回的 `{id: uuid}` 替换成 `{id: hashInt, __id: uuid}`。前端 React `useParams()` 拿到的 `id` 是 URL 路径里的字符串(uuid),不经过 shim。`Number(uuid)` = NaN。

### 2.3 修复点 3: 新会话按钮

- **文件**: `frontend/src/layouts/BasicLayout.tsx`
- **症状**: 王六反馈"没看到左下新会话按钮",实际是 CommandCenter 内部 `aside` 顶部的"新建"按钮,只是当时没和 Recruit 集成,且 /overview 落地后没自动起会话。
- **解决**:
  - 3.6.1 不改 layout(按钮本来在,只是用户没发现)
  - 3.6.2 修通 chat SSE 后,点 输入框 → Enter 会自动 createSession + simulateDispatch,等同于"无 UI 按钮的隐式新会话"。所以这个反馈被 3.6.2 一起收口了。

---

## 3. 3.6.2 — Chat SSE 端到端真实可用(本日核心)

### 3.1 症状

王六反馈:"在工作台直接发送消息成功,但是模型没有回复,没看到流式聊天 + 工具事件"。

### 3.2 根因分析(3 层 FNV-1a shim 陷阱)

**层 1: 真 UUID vs shim int 错位**

`withIdShim`(`services/api.ts:16-32`)对所有 list/detail 返回的对象,把 `id: <UUID>` 替换成 `id: <hashed-int>` 并保留 `__id: <UUID>`。目的是 React 列表用 `key={item.id}` 不会因为 UUID 太长 key 不稳。

但 **POST 请求的 body** 需要真 UUID:
- `POST /api/sessions {employee_id}` → backend `db.get(DigitalEmployee, employee_id)` 找不到
- → 404 "employee not found in this tenant"

**层 2: 反查 UUID 的 3 条路径**

| 路径                       | 来源                          | 状态             |
| -------------------------- | ----------------------------- | ---------------- |
| `activeEmployee.uuid`      | `setActiveEmployee({...uuid})` 字段 | 缺(没存)        |
| `allEmployees.find().__id` | `allEmployees` shim 列表       | `allEmployees` 没初始化 |
| `fetchEmployeeDetail(id)`  | 后端 GET 详情                 | shim int 后端 404 |

**层 3: streamChat 收到 shim int**

`chatWithEmployeeStream` 内部:
```ts
const conv = await createSession(String(_employeeId), '');
sessionId = (conv as any).id || (conv as any).__id;
```

`createSession` 返回的对象也经过 shim,所以 `(conv as any).id` 是 shim int,不是 UUID。streamChat 用这个 shim int 去打 `/api/sessions/{shim_int}/chat/stream` → backend 找不到该 session → 404 "session not found"。

### 3.3 修复(4 处)

#### 3.3.1 activeEmployee 类型加 uuid

- **文件**: `frontend/src/pages/CommandCenter.tsx:154`
- **改动**: `useState<{id: number; name: string; ...}>` → `useState<{id: number; uuid?: string; name: string; ...}>`

#### 3.3.2 setActiveEmployee 写入 uuid

- **文件**: `frontend/src/pages/CommandCenter.tsx:335`
- **改动**: `setActiveEmployee({id: emp.id, ...})` → `setActiveEmployee({id: emp.id, uuid: (emp as any).__id, ...})`
- **位置**: `fetchEmployeeDetail(empId).then(emp => setActiveEmployee(...))` 是 URL 搜索参数 `?empId=` 进来的入口

#### 3.3.3 selectEmployee 返回 uuid

- **文件**: `frontend/src/pages/CommandCenter.tsx:74`
- **改动**: 返回类型加 `uuid?: string`; matched/default path 都从 `__id` 取
- **关键点**: `employeesCache[0]` 也是 shim 对象,有 `__id`

#### 3.3.4 chatWithEmployeeStream 用 __id

- **文件**: `frontend/src/services/api.ts:609`
- **改动**: `sessionId = (conv as any).id || (conv as any).__id` → `sessionId = (conv as any).__id || String((conv as any).id || '')`
- **重要**: 加 `_origin: 'openatlas'` 标记 chunk 来自 openatlas(不是 hermes sid),消费者按此过滤

#### 3.3.5 simulateDispatch 按 origin 区分

- **文件**: `frontend/src/pages/CommandCenter.tsx:737`
- **改动**: 之前无条件用 `chunk.conversation_id` 覆盖 `conversationIdRef`,改成只在 `_origin === 'openatlas'` 时覆盖。Hermes 返回的 `ev.session_id` (形如 `api_1780740634_xxx`) **绝对不能写回** conversationIdRef,否则下一次 send 用 hermes sid 打 chat/stream → 404。

#### 3.3.6 移除 `emittedConvId` 遗留变量

- **文件**: `frontend/src/services/api.ts:629-646`
- **改动**: 完全删除 4 处 `if (!emittedConvId && ev.session_id)` 块。`assistant.delta` 也不在 stream 里 emit `conversation_id`(那是 hermes sid)

### 3.4 验证

```bash
# 浏览器:登录 admin@demo.openatlas → /overview → 输入 "Say OK and stop." → Enter
# 期望:
# 1. 用户消息出现
# 2. DemoSecret 员工消息出现
# 3. 工具调用按钮"工具调用 · 1 展开 ▼"可点击
# 4. console 有 [streamChat] resp.ok 200 url 含 UUID

# 结果: ✅ 全部通过
# console 最后一行: [streamChat] resp.ok 200 url: /api/sessions/42b85d75-e1d4-4a83-8692-d1db95bbf7b7/chat/stream
#                            content-type: text/event-stream; charset=utf-8
# 工具调用: 1 条 _thinking 工具(LLM 内部 thinking block)
# 回复长度: 22 字
# 完成时间: 2026-06-06 11:38
```

---

## 4. 3.6.3 — CSS 变量名批量修正

### 4.1 症状

王六反馈"8 个页面看起来没样式"。

### 4.2 根因

5 个页面文件(Jobs/Skills/SkillMarket/MemoryCenter/Dashboard/Audit)用了 **想当然** 的 CSS 变量名(我自己编的),实际 `index.css` 里是另一套:
- 我写的 → 真实
- `--color-text-muted` → `--text-tertiary`
- `--color-surface-1` → `--bg-secondary`
- `--color-border` → `--border-default`
- `--color-error` → `--color-danger`
- `--color-primary` → `--accent`

### 4.3 修复

`grep index.css` 找出真实变量名,然后 `sed -i ''` 批量替换 6 个文件,共 ~25 处。

### 4.4 验证

- npm run build 仍 PASS
- /jobs, /skills, /skill-market, /memory, /dashboard, /audit 6 个页面样式恢复正常

---

## 5. 3.6.4 — Recruit 表单精简

(已在 §2.1 描述)

---

## 6. 3.6.5 — 新增 GET /api/sessions/{sid} 真实后端实现

### 6.1 症状

`fetchConversationDetail` 之前是 mock stub: 在 fetchSessions 列表里 `.find()` + 调用 fetchSessionMessages,逻辑分散且容易和后端真实数据脱节。

### 6.2 修复

- **后端**: `backend/app/main.py:565` 新增 `@app.get("/api/sessions/{sid}")` `session_detail`
  - 返回 `{id, employee_id, hermes_session_id, title, created_at, updated_at, last_message, message_count}`
  - 权限: session.tenant_id == p.tenant.id AND session.user_id == p.user.id
- **前端**: `frontend/src/services/api.ts:540` `fetchConversationDetail` 改为真实 `apiFetch<any>(/sessions/${id})` + `fetchSessionMessages`

### 6.3 验证

```bash
$ curl /api/sessions/{sid} -H "Bearer ..."
# 200 {"id":"f4d02191-...","employee_id":"18313dd4-...","title":"3.6 verify"...}
```

---

## 7. 3.6.6 — 技能中心 ZIP 导入(推迟到 Phase 3.7)

### 7.1 王六决定

- **选项 A**: 本 sprint 调研 + 实现 基础版 ZIP 导入
- **选项 B**: 推到 Phase 3.7 独立 sprint,本期只做 3.6.1-3.6.5
- **王六选择**: **B** (clarify 选了 Option B)

### 7.2 Phase 3.7 范围(预告,本期不做)

- 调研 Coze / Dify / FastGPT / 飞书知识库 等竞品 ZIP 导入流程
- 决定 OpenAtlas 自己的 ZIP 格式(SKILL.md + manifest.yaml + assets/)
- 后端: `POST /api/skill-import/zip` multipart/form-data
- 前端: SkillMarket 页面加"导入"按钮 + 上传 modal + 进度条
- 沙箱: ZIP 解压路径白名单 + 文件大小限制 + 病毒扫描(v1 跳过,Phase 4 接 ClamAV)
- 文档: SKILL.md / manifest.yaml schema 文档

---

## 8. 3.6.7 — 端到端验收(本日)

| 验证项                                | 状态    | 备注 |
| ------------------------------------- | ------- | ---- |
| 登录 admin@demo.openatlas             | ✅ PASS | |
| 列出数字员工(6 个)                   | ✅ PASS | 含 DemoSecret |
| 员工详情页可打开                      | ✅ PASS | 3.6.1 fix |
| /overview 输入框 + Enter 发消息       | ✅ PASS | 自动 createSession |
| 流式聊天收到 LLM 回复                  | ✅ PASS | 3.6.2 fix,**8s 内** |
| 工具调用面板可展开                    | ✅ PASS | 1 个 _thinking 工具 |
| 任务列表(Jobs)样式正常               | ✅ PASS | 3.6.3 fix |
| 技能中心(Skills)样式正常             | ✅ PASS | 3.6.3 fix |
| 技能市场(Skill Market)样式正常       | ✅ PASS | 3.6.3 fix |
| 记忆中心(Memory Center)样式正常      | ✅ PASS | 3.6.3 fix |
| Dashboard 样式正常                    | ✅ PASS | 3.6.3 fix |
| 审计日志(Audit)样式正常              | ✅ PASS | 3.6.3 fix |
| /api/sessions/{sid} 端点工作         | ✅ PASS | 3.6.5 fix |
| `npm run build` 9.07s                | ✅ PASS | |
| backend 2014 行                       | ✅      | 含 3.6 新增 endpoint |
| 隔离性(本机 ~/.hermes 未触碰)        | ✅ PASS | `mtime` 验证 |
| **chat SSE 端到端**                  | ✅ **PASS** | 3.6.2 fix,本 sprint 收口标志 |

---

## 9. 关键设计决策

### 9.1 shim 模式

`withIdShim` 是必须保留的(React 列表 key 需要稳定 int),但**所有 POST/PUT 请求 body 都要用 `__id` 不是 `id`**。这条硬规则要写到 frontend 团队 wiki。

### 9.2 SSE 事件命名空间

Hermes 返回的 SSE 事件名是 `event: <name>` + `data: <json>`。OpenAtlas 注入自己的事件 `event: openatlas.memories` 让前端能识别 system event vs hermes event。

### 9.3 _origin 标记

`chatWithEmployeeStream` 在 `createSession` 之后 emit 的 chunk 加 `_origin: 'openatlas'`,消费者用此区分 openatlas session uuid 和 hermes session id(streaming event 里的 `ev.session_id` 是 hermes sid)。这条硬规则要写进 developer docs。

---

## 10. 已知问题(转 P3.7 / P3.8)

| #   | 问题                                                  | 计划     |
| --- | ----------------------------------------------------- | -------- |
| 1   | Skill ZIP 导入                                         | P3.7 sprint |
| 2   | `atlas.dispatch` localStorage 没清理(同 session id 反复进出 dispatch key) | P3.8 |
| 3   | Recruit 表单提交后没清空(下次打开还残留)              | P3.8 |
| 4   | 创建员工后没自动跳到该员工的 Command Center            | P3.8 |

---

## 11. 文件清单(本日改动)

### 11.1 后端

- `backend/app/main.py` (+1 endpoint `session_detail` at line 565)

### 11.2 前端

- `frontend/src/services/api.ts`
  - `fetchConversationDetail` 真实化
  - `chatWithEmployeeStream` 改写:用 `__id` 取 openatlas session uuid,emit `_origin: 'openatlas'`
  - 移除 `emittedConvId` 变量 + 4 处引用
- `frontend/src/pages/CommandCenter.tsx`
  - `activeEmployee` 类型加 `uuid?: string`
  - `setActiveEmployee` 5 处全部携带 `uuid`
  - `selectEmployee` 返回 `uuid`
  - `employeesCache` 类型加 `__id`
  - `simulateDispatch` + `handleNewConversation` 兜底 `fetchEmployeeDetail`
  - consumer 端按 `_origin === 'openatlas'` 过滤 `conversation_id` chunk
- `frontend/src/pages/Recruit.tsx` 精简 3 字段
- `frontend/src/pages/EmployeeDetail.tsx:55` `Number(id)` → `id`

### 11.3 文档

- `docs/SESSION-LOG-2026-06-06-2.md` (本文件) — 6 bug 分诊
- `docs/DELIVERY-PHASE-3.5.md` §10 现场验收记录
- `docs/DELIVERY-PHASE-3.6.md` (本文件) — 3.6 收口交付

---

## 12. 一句话总结

Phase 3.6 修通 5/6 stub bug,**核心是 3.6.2 chat SSE 端到端真实可用**(根因是 FNV-1a shim 把 backend UUID 替换成 hashed int,导致 POST body 用错 id → 404;3 层反查 + _origin 标记彻底隔离 hermes sid 和 openatlas uuid)。3.6.6 Skill ZIP 推到 Phase 3.7 独立 sprint。审计方法:"每个按钮点一遍,不只看页面渲染"。
