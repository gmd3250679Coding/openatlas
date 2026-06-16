# OpenAtlas 现场验收 — 2026-06-06 第二轮

> 王六实际登录 demo 端口 (3381/58003/58642) 全程点过一遍。
> 8 个真问题(其中 2 个"ok"、6 个"待修")。本页是分诊报告 + 修复路线图,**非交付文档**。
> 决定权:王六,按"继续"=默认走 A 路线全做。

---

## 0. 验收基线

- 后端 58003 / 前端 3381 / demo gateway 58642 / acme gateway 58643 全部 ready
- 隔离验证:`~/.hermes/*` 5 天 mtime 未变,lsof 0 refs
- 浏览器:已登录 `admin@demo.openatlas`(system_admin)看 system 视图

---

## 1. 实际表现 vs 预期 (按王六反馈顺序)

| # | 王六反馈 | 实际表现 (我 grep/curl/读码验证) | 根因 | 严重度 |
|---|---|---|---|---|
| 1 | 登录 ok | 200 + 角色 system_admin + tenant demo | — | — |
| 2 | 列数字员工 ok | `/api/employees` 200,7 items | — | — |
| 3 | 招聘"所属部门"必填在哪配置?有什么用?有必要必填? | ① 部门下拉永远空(`fetchDepartments` 在 `api.ts:497` 直接 `return []`,后端无 `/api/departments`);② spec §2.2.4 招聘字段:display_name / description / model / skills / toolsets,**没部门**;③ spec §3.3 数据模型也没 Department 表 | 残留的早期 mock 字段,既不在 spec 也不在后端 schema | 中 |
| 4 | 员工详情页"找不到员工" | `EmployeeDetail.tsx:55` `fetchEmployeeDetail(Number(id))` — `Number(uuid-string)` = `NaN`,后端 GET `/api/employees/NaN` 必 404 | 类型迁移残留(number → string UUID),Phase 1.5 加 FNV-1a shim 后没回头改这里 | **高**,1 行可修 |
| 5 | 工作台直发消息成功但**没模型回复** | ① `CommandCenter.tsx:718` 调用 `chatWithEmployeeStream(employee.id, userInput, conversationIdRef.current, attachmentsToSend)`(4 参);② `api.ts:596` 实现是 `async function* chatWithEmployeeStream(_employeeId, _opts) { return; }` — **no-op generator,签名还不匹配**;③ 真正的 `streamChat(sessionId, message)` 从未被 CommandCenter 调用 | Phase 1.5 接通 backend SSE 验证 (verify_p35_e2e.py 5.14s 跑通) 时只写了后端和测试脚本,CommandCenter.tsx 整套 dispatch 模拟器没改成真路径 | **阻塞核心体验**,需重写 simulateDispatch + simulateGroupDispatch |
| 6 | 没看到左下"新会话"按钮 | 真实位置:CommandCenter 左下角有"+ 新对话" 按钮(在会话列表最底部),王六可能没看到;但点 "新会话" / "群聊" 都会失败,因为 `handleNewConversation:529` 调 `createConversation` → 调 `createSession` → 真实后端 ✅ 200 — **后端 OK**,问题在切换会话时 `fetchConversationDetail` (`api.ts:540`) 是 mock stub 内部从 sessions list 找,翻车在 GET /api/sessions/{id} 不存在 | Phase 1.5 留的 mock stub,模拟器没改成真 | 中 |
| 7 | 新页面(Jobs/Skills/SkillMarket/MemoryCenter/Dashboard/Audit) "没样式 + token 失效"感觉 | 5 个新页面我全部用了 `var(--color-text-muted)` / `var(--color-primary)` / `var(--color-surface-1)` / `var(--color-border)` / `var(--color-error)`;**这些 CSS var 在 index.css 里根本不存在**。真实变量名是 `--text-tertiary` / `--accent` / `--border-default` / `--color-success` 等。Antd 组件本身有默认样式但被覆盖了 | 我自创了一套变量名,没参照 index.css 已有的 design token 体系 | **高**,批量替换 + 1 个 design token 文档 |
| 8 | Skill 应是 ZIP 导入包,需研究 Coze/Dify/FastGPT | 现状:`/api/skill-market` 只管元数据,真正"安装" Skill 只是在 profile.skills 数组里加名字;**没有任何** .zip / .tar 上传 → 解压 → 解析 SKILL.md → 注册到 `~/.openatlas/hermes-tenants/{tenant}/.hermes/skills/` 的流程 | spec §2.2.8 没写 ZIP 导入,只说"第一阶段只读"+ §2.2.8.1 元数据/授权/绑定。但王六判断"按其他厂商经验应该是"是合理的产品方向 | **大**,要做端到端设计 |

---

## 2. 根因总结(全在 frontend)

```
8 个问题里 7 个根因都在前端
  4 → 1 行:Number(id) → id
  5 → 整段 simulateDispatch 重写接 streamChat
  6 → fetchConversationDetail 改用 /api/sessions/{id}
  7 → 5 个新页批量改 CSS var 名
  3 → 删部门字段 / 或实现 /api/departments(但 spec 都不需要)

后端 0 bug,backend 58003 + 2 个 gateway 都健康
```

---

## 3. 修复路线图(默认 A = 全部修,共 4 phase,顺序串行)

### Phase 3.6.1 — Critical 1-liner (30 min)
- 修 `EmployeeDetail.tsx:55` `Number(id)` → `id`
- 验证:进任一员工详情页能加载(200 + 真实数据)

### Phase 3.6.2 — 真流式聊天(2-3h,核心)
- 重写 `simulateDispatch` 走 `streamChat(conversationId, message)`
- 解决 conversationId 字符串 vs number 的传参链
- 把 `chatWithEmployeeStream` 这个 no-op stub 删掉,统一走 `streamChat`
- SSE 事件映射:`assistant.delta` → fullResponse 累积,`tool.started/progress/completed` → toolCalls 数组,`run.completed` → 收尾
- 群聊:每个接力员工独立 stream,独立 message 行
- 验证:CommandCenter 发消息能收到 LLM 回复 + ToolCallPanel 显示 _thinking 事件

### Phase 3.6.3 — 设计 token 体系统一(1-2h)
- 选项 A:把 5 个新页的 CSS var 全部改成真实名(`--color-text-muted` → `--text-tertiary`,`--color-primary` → `--accent`,...)
- 选项 B:在 `index.css` 顶部加一组 alias(`--color-text-muted: var(--text-tertiary)` 等)
- 推荐 A:从源头改,避免别名污染
- 同时把 5 个新页的 layout 从 inline style 改用 `atlas-page` / `atlas-page-title` / `atlas-toolbar` className 体系(沿用旧页风格)
- 验证:5 个新页在 dark + light 主题下都有正确配色

### Phase 3.6.4 — 招聘字段清理(15 min)
- 删 `dept_id` Form.Item(`Recruit.tsx:120-143`)+ 删 `fetchDepartments` 调用 + 删 `Department` import + 删 `mood` / `avatar_char`(后端不存)
- 让 form 跟 spec §2.2.4 对齐:display_name / description / model / skills
- 验证:不选部门也能提交,后端 200

### Phase 3.6.5 — Session 真实切换(30 min)
- `fetchConversationDetail` 改用真实 `GET /api/sessions/{id}`
- 验证:点会话列表任一会话能切换 + 加载历史消息

### Phase 3.6.6 — Skill ZIP 导入(4-6h,**新增 spec 扩展**)
- 行业调研:Coze / Dify / FastGPT / 阿里云百炼 / 腾讯元宝 的 Skill 打包格式
- 设计 OpenAtlas Skill Package 格式:`skill.zip` = `SKILL.md`(yaml frontmatter) + `tools/*.py` + `tests/` + `__init__.py`
- 后端:
  - `POST /api/skill-market/import`(multipart,zip)
  - 解压到 `$HERMES_HOME/skills/{slug}/`
  - 解析 `SKILL.md` 写 DB 元数据
  - 调 `hermes_client.reload_skills()` 让 gateway 立即可见
- 前端:
  - 技能市场页面顶部"+ 导入 Skill" 按钮
  - 上传后立即出现在列表(scope = user)
- 验证:上传一个 zip → 立刻能在 Recruit 里选到

### Phase 3.6.7 — 更新文档
- `DELIVERY-PHASE-3.5.md` 加 §10 已知问题
- 写 `DELIVERY-PHASE-3.6.md` 收口
- memory 更新:加新坑(chat stub + CSS var 不存在)

---

## 4. 优先级建议

| 优先级 | Phase | 估时 | 阻塞核心功能? |
|---|---|---|---|
| P0 (今天) | 3.6.1 + 3.6.2 + 3.6.4 + 3.6.5 | ~3-4h | 是 — 没聊天 = MVP 不通 |
| P1 (明天) | 3.6.3 | 1-2h | 视觉问题不影响功能 |
| P2 (下期) | 3.6.6 Skill ZIP | 4-6h | 是 — 但要做产品调研,不算 bug |

---

## 5. 非目标(明确不做)

- 不实现 Department 表 / `/api/departments`(spec 没要)
- 不实现 spec §1.3 Phase 4 安全沙箱
- 不动 Hermes 任何内部模块
- 不重做 mock data(Phase 1 早就删了,新前端直接走真后端)

---

## 6. 决策点(王六拍板)

默认走 P0 全做(王六"继续"原则)。**唯一需要决定的是 3.6.6 Skill ZIP 是不是本期做**。如果"是"我直接进研究模式(读 Coze / Dify / FastGPT 文档);如果"否"我就把 3.6.6 推到 Phase 3.7+ 当独立 sprint。
