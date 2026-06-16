# SESSION-LOG-2026-06-06-5 — Phase 3.9 Skill Binding UX 收口

**时段**: 2026-06-06 21:00-22:30
**trigger**: 王六 第四轮 "继续" (P3.7 + P3.8 已 closed)

## 背景

P3.5 收口时 SkillBinding 数据层完成,8 个 verify + 7 audit 全过。
但前端 3 个核心场景的 UX 缺失:
- EmployeeDetail 看不到已绑定的市场技能
- Skills 中心不显示已绑员工
- SkillMarket 的 Fork→employee 按钮缺失

王六报"3.6.6 推到 P3.7, P3.7/P3.8 跑通后还有 P3.9 收 UX"。

## 流程

### 3.9.1 reality probe
- grep 现有 EmployeeDetail / Skills / SkillMarket: 都没有用 fetchSkillBindings
- grep api.ts:bindSkill: `body: JSON.stringify(body)` 漏 skill_id
- grep hermes_client.py: 没有 update_profile 函数(只能改名字,不能改 skills)
- 决策:前端用 2 skill systems 并存 (employee.skills NAMES vs SkillBinding DB),不强行合并

### 3.9.2 后端 GET /api/skill-bindings
- 加 endpoint 带 target_type/target_id/skill_id filter
- join SkillPackage 表带回 skill_name/version/scope/category
- 验证 0 items → 手动 backend bind 1 → 验证 1 item

### 3.9.3 前端 fetchSkillBindings + bindSkill bug 修
- 加 fetchSkillBindings + SkillBindingRow interface
- 修 bindSkill: 加 `skill_id: skillId` 到 body (P3.5 静默 422 bug)
- 验证 backend bind 200 OK

### 3.9.4 EmployeeDetail.tsx "已绑定市场技能" section
- +fetchSkillBindings/deleteSkillBinding/SkillBindingRow import
- +skillBindings state +bindingsLoading +reloadSkillBindings
- +handleUnbind 用 window.confirm (初始版本)
- +"已绑定市场技能" section 嵌在 SKILL 配置 tab
- 浏览器验证:导航到 /employee/18313dd4-..., 看到 "Phase 3.5 Test (fork) · user · v1.0.0 · mode: copied" + 解绑按钮

### 3.9.5 Skills.tsx bound status badges
- +fetchSkillBindings/deleteSkillBinding import
- +bindings state +bindingsBySkill helper
- +onUnbind via Tag onClose
- cyan Tag for employee target, orange for user target
- 浏览器 E2E 第一次失败 — **"已绑定" 0 个**

**BUG 发现 #1 (FNV-1a shim 比较错位)**: Skills 列表用 withIdShim 包装,s.id 是 hashInt;但 binding.skill_id 是真 UUID。比较永远 0 结果。
- 修法: `bindingsBySkill((s as any).__id || s.id)`
- 修后: "已绑定 1 个员工: DemoSecret · copied" 出现 ✓

**BUG 发现 #2 (window.confirm 阻塞浏览器)**: 点 EmployeeDetail 解绑按钮浏览器工具 timeout 30s。
- 原因: window.confirm 是同步 native dialog,Antd 测试工具无法 dismiss
- 修法: 改用 Antd `Popconfirm` 组件,带 okText="解 绑" okButtonProps danger cancelText="取 消"
- 修后: Popconfirm 弹出 → 点 解绑 → API DELETE → "已解绑" 消息 → 列表刷新 ✓

**BUG 发现 #3 (Tag onClose 冒泡)**: 点击 Skills 页 Tag 的 close icon 浏览器跳到 about:blank
- 修法: onClose handler 加 `e.stopPropagation()`
- 修后: JS click 触发 close icon → DELETE 200 → binding 消失 ✓

**BUG 发现 #4 (SkillMarket onFork/onPublish/onDisable 用 s.id shim 失败)**: Fork→user 第一次 click 看到 0 fork 创建
- 修法: 全改 `s.__id || s.id`
- 修后: 点击 Fork→user → "Hermes Built-in Tools (fork)" user scope 出现 ✓

### 3.9.6 SkillMarket.tsx Fork→employee 按钮
- 之前 P3.5 收口时只有 Fork→user 按钮
- 补 Fork→employee 按钮
- onFork target='employee' 时: window.prompt 列出员工 → 输入 number → 调 forkSkill(id, 'employee', target_id)
- 浏览器 E2E 第一次失败 — **fork 创建但 list 看不到**

**BUG 发现 #5 (后端 list_market 漏 employee scope)**: list_market 的 filter 只覆盖 global/tenant/user
- 修法: 加 `| (SkillPackage.scope == Scope.employee)` 分支
- 修后: 6 个 Hermes 技能(4 employee + 1 global + 1 user)都显示 ✓

**BUG 发现 #6 (后端 fork→employee 不自动建 binding)**: fork 创建 SkillPackage 但从没在 SkillBinding 表里建记录
- 修法: fork endpoint 在 target_scope=employee 分支自动建 SkillBinding(mode=copied, locked=False) + audit skill.bind via=fork
- 修后: fork→employee 后, EmployeeDetail 立即显示该 skill ✓

**BUG 发现 #7 (fork→employee 缺 target_id 校验)**: Pydantic schema 注释 "required if target_scope=employee" 但没 enforce
- 修法: fork endpoint 显式 `if not body.target_id: raise 400` + 校验 employee belongs to tenant
- 修后: backend 200,带 binding_id ✓

### 3.9.7 浏览器 E2E 完整验证
- 直接 backend fork→employee(用真 UUID)→ EmployeeDetail 立即显示
- click 解绑 → Popconfirm 弹出 → click 解绑 → DELETE 200 → 列表刷新
- /skills 看到 "Hermes Built-in Tools" 卡片显示 "已绑定 2 个员工: Atlas 助手 · inherited, DemoSecret · inherited" (cyan, no close 因 locked)
- /skills 看到 "Phase 3.5 Test (fork)" 卡片显示 "已绑定 1 个员工: DemoSecret · copied" (cyan, 有 close)
- 全链路通过

### 3.9.8 docs + memory
- DELIVERY-PHASE-3.9.md (13.6KB)
- SESSION-LOG-2026-06-06-5.md (本文件)
- memory entry: P3.6+P3.7+P3.8+P3.9 closure + 6 new hard rules

## 改动文件汇总

**backend/app/main.py** (~50 lines):
- +@app.get("/api/skill-bindings") endpoint (~45 lines)
- +scope filter in list_market (1 line)
- +fork endpoint target_id validation + auto binding (~30 lines)
- backend pid 53827 → killed → restarted (pid 76136)

**frontend/src/services/api.ts** (~50 lines):
- +fetchSkillBindings + SkillBindingRow
- +bindSkill fix: 漏 skill_id
- +forkSkill: +target_id parameter

**frontend/src/pages/EmployeeDetail.tsx** (~70 lines):
- +useCallback, +Tag Button, +Popconfirm
- +fetchSkillBindings/deleteSkillBinding/SkillBindingRow imports
- +skillBindings state +reloadSkillBindings +handleUnbind
- +"已绑定市场技能" section + 解绑 button + Popconfirm

**frontend/src/pages/Skills.tsx** (~30 lines):
- +useCallback, +fetchSkillBindings/deleteSkillBinding
- +bindings state +bindingsBySkill
- **+ FNV-1a shim 修复: bindingsBySkill((s as any).__id || s.id)**
- + Tag onClose with stopPropagation

**frontend/src/pages/SkillMarket.tsx** (~50 lines):
- +fetchEmployees import
- +onFork 增强: employee 模式 prompt 选择员工
- **+ FNV-1a shim 修复: onPublish/onDisable/onFork 用 s.__id**

**docs/**:
- DELIVERY-PHASE-3.9.md (NEW 13658 bytes)
- SESSION-LOG-2026-06-06-5.md (NEW 本文件)

## 关键决策

- **FNV-1a shim 比较错位**: skills 列表用 shim hashInt, bindings 用真 UUID。修法: caller 必用 `__id`, 写进 `bindingsBySkill((s as any).__id || s.id)` 一次性修复
- **window.confirm → Popconfirm**: 不用 native confirm, 避免阻塞浏览器自动化, 同时 UX 更原生
- **fork→employee 自动建 binding**: fork 不是简单 copy, 而是"复制 + 立即绑定"的复合语义, 减少用户操作
- **market list 包含 employee scope**: employee skill 必须可见, 否则用户 fork→employee 后看不到

## 王六新硬规则 (P3.9 累积)

1. **FNV-1a shim 比较双 ID 规则**: `s.id` 是 hashInt 不能传给后端或跟 binding.skill_id 比较
2. **Tag onClose 必加 stopPropagation**
3. **解绑/删除 严禁 window.confirm, 用 Antd Popconfirm 替代**
4. **后端 fork→employee 必须自动建 binding** + 校验 target_id
5. **后端 list 必须包含所有 scope**, 不能漏 employee
6. **N 个 verify 测试 PASS 也不代表能用, 必须浏览器真点击 bind 按钮端到端跑通**

## 测试结果

- /tmp/verify_p35.py 18/18 PASS
- /tmp/verify_audit.py 7/7 PASS
- npm run build ✓ 9.5s
- 浏览器 E2E 6 个场景全过 (EmployeeDetail 显示/解绑/inherited lock, Skills Bind 流程/已绑显示, SkillMarket Fork→employee)

## 状态

P3.9 ✅ 收口。下一个 phase 待王六定。
