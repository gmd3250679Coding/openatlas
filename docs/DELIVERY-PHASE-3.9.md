# Phase 3.9 — Skill Binding UX 收口

**日期**: 2026-06-06
**session**: 第 5 轮 Skill Binding 用户体验闭环
**status**: ✅ closed

---

## 0. TL;DR

P3.5 收口时把 SkillBinding 数据层做好了,但前端三个核心场景的 UX 都没做:
- EmployeeDetail 看不到已绑定的市场技能
- Skills 中心不显示已绑员工
- SkillMarket 的 Fork→employee 按钮缺失

P3.9 把这三块前端补齐,并在浏览器端真实跑通"创建→绑定→展示→解绑"完整链路。同时修出 4 个隐藏 P3.5/P3.7 bug。

---

## 1. P3.9 子目标

| # | 子目标 | 状态 |
|---|--------|------|
| 3.9.1 | reality probe 现状 + hermes_client 无 update_profile | ✅ |
| 3.9.2 | 后端 `GET /api/skill-bindings?target_type=...&target_id=...` | ✅ |
| 3.9.3 | 前端 `fetchSkillBindings` + `bindSkill` 漏 `skill_id` 修 | ✅ |
| 3.9.4 | EmployeeDetail "已绑定市场技能" section | ✅ |
| 3.9.5 | Skills 中心 closable Tag + onUnbind | ✅ |
| 3.9.6 | SkillMarket Fork→employee 按钮 | ✅ |
| 3.9.7 | 浏览器 E2E 验证 bind 真实显示在 EmployeeDetail | ✅ |
| 3.9.8 | docs + memory | ✅ |

---

## 2. 后端改动

### 2.1 新增 `GET /api/skill-bindings`

```python
@app.get("/api/skill-bindings")
def list_skill_bindings(
    target_type: str | None = Query(default=None),  # employee/user/tenant
    target_id: str | None = Query(default=None),
    skill_id: str | None = Query(default=None),
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> dict:
    q = select(SkillBinding, SkillPackage).join(
        SkillPackage, SkillBinding.skill_id == SkillPackage.id
    ).where(SkillBinding.tenant_id == p.tenant.id)
    if target_type: q = q.where(SkillBinding.target_type == target_type)
    if target_id:   q = q.where(SkillBinding.target_id == target_id)
    if skill_id:    q = q.where(SkillBinding.skill_id == skill_id)
    rows = db.execute(q).all()
    items = []
    for b, s in rows:
        d = {c.name: getattr(b, c.name) for c in b.__table__.columns}
        d["skill_name"] = s.name
        d["skill_version"] = s.version
        d["skill_scope"] = s.scope.value
        d["skill_category"] = s.category
        items.append(d)
    return {"items": items}
```

返回示例:
```json
{
  "items": [{
    "id": "2e5f2697-129a-4904-a050-e14fd165aaa5",
    "skill_id": "a43c9367-bfe1-4829-8bf9-ee49776bd56a",
    "skill_name": "Phase 3.5 Test (fork)",
    "skill_version": "1.0.0",
    "skill_scope": "user",
    "skill_category": "general",
    "target_type": "employee",
    "target_id": "18313dd4-e0d2-4b12-abf9-536eb3522618",
    "binding_mode": "copied",
    "enabled": true,
    "locked": false,
    "created_at": "2026-06-06T13:17:19.217873"
  }]
}
```

### 2.2 修复 fork endpoint (Phase 3.9 真实 bug)

**P3.5 留下的 3 个 bug 在 P3.9 修复:**

1. **market 列表不显示 employee scope 技能**
   - `list_market` 的 filter 只覆盖 global/tenant/user
   - 修复:增加 `| (SkillPackage.scope == Scope.employee)` 分支
   - 影响:之前前端 fork→employee 创建的 skill 在市场不可见

2. **fork→employee 没有自动创建 binding**
   - 之前 fork 创建 employee-scope 的 SkillPackage,但从不在 SkillBinding 表里建记录
   - 修复:在 fork endpoint 里,如果 target_scope=employee,自动创建 SkillBinding(mode=copied, locked=False)
   - 影响:用户 fork→employee 后,该 skill 并没真的"绑定"到员工,只是多了一个独立 skill

3. **fork→employee 缺 target_id 校验**
   - Pydantic schema 写了 `# required if target_scope=employee` 但没 enforce
   - 修复:fork endpoint 显式 400 + 校验 employee belongs to tenant

修复后的 fork endpoint:
```python
if body.target_scope == Scope.employee:
    if not body.target_id:
        raise HTTPException(400, "target_id (employee uuid) is required for employee forks")
    emp = db.get(DigitalEmployee, body.target_id)
    if not emp or emp.tenant_id != p.tenant.id:
        raise HTTPException(404, "employee not found")
# ... create new skill ...
if body.target_scope == Scope.employee and body.target_id:
    binding = SkillBinding(
        tenant_id=p.tenant.id, skill_id=new.id,
        target_type="employee", target_id=body.target_id,
        binding_mode="copied", enabled=True, locked=False,
        created_by=p.user.id,
    )
    db.add(binding)
    audit(... action="skill.bind" extra={"via": "fork"} ...)
```

---

## 3. 前端改动

### 3.1 api.ts

**新加 `fetchSkillBindings` helper:**
```ts
export async function fetchSkillBindings(opts: {
  target_type?: 'employee' | 'user' | 'tenant';
  target_id?: string;
  skill_id?: string;
} = {}): Promise<SkillBindingRow[]> {
  const q = new URLSearchParams();
  if (opts.target_type) q.set('target_type', opts.target_type);
  if (opts.target_id) q.set('target_id', opts.target_id);
  if (opts.skill_id) q.set('skill_id', opts.skill_id);
  const qs = q.toString();
  const r = await apiFetch<{ items: SkillBindingRow[] }>(`/skill-bindings${qs ? `?${qs}` : ''}`);
  return r.items || [];
}
```

**新加 `SkillBindingRow` interface:**
```ts
export interface SkillBindingRow {
  id: string;
  skill_id: string;
  skill_name: string;
  skill_version: string;
  skill_scope: 'global' | 'tenant' | 'user' | 'employee';
  skill_category: string;
  target_type: 'employee' | 'user' | 'tenant';
  target_id: string;
  binding_mode: 'inherited' | 'copied' | 'custom';
  enabled: boolean;
  locked: boolean;
  created_at: string | null;
}
```

**修 `bindSkill` 漏 `skill_id` 字段 (P3.5 静默 422 bug):**
```ts
export async function bindSkill(skillId: string, body: {...}): Promise<any> {
  return apiFetch(`/skill-market/${skillId}/bind`, {
    method: 'POST',
    body: JSON.stringify({ ...body, skill_id: skillId }),  // 关键:url 字段也写进 body
  });
}
```

**修 `forkSkill` 支持 `target_id`:**
```ts
export async function forkSkill(id: string, target_scope: 'user' | 'employee', target_id?: string): Promise<any> {
  return apiFetch(`/skill-market/${id}/fork`, { method: 'POST', body: JSON.stringify({ target_scope, target_id }) });
}
```

### 3.2 EmployeeDetail.tsx — "已绑定市场技能" section

在 "已绑定 SKILLS" 之后新增 section:
- header: "已绑定市场技能"
- 空态: "暂未从技能市场绑定技能。前往 技能中心 / 技能市场 绑定。"
- 有数据时: 列表 + 解绑按钮(Popconfirm)

```tsx
{skillBindings.length === 0 ? (
  <div>暂未从技能市场绑定技能。前往 <a>技能中心</a> 或 <a>技能市场</a> 绑定。</div>
) : (
  <div>
    {skillBindings.map(b => (
      <div key={b.id}>
        <strong>{b.skill_name}</strong>
        <Tag color={b.skill_scope === 'global' ? 'geekblue' : b.skill_scope === 'tenant' ? 'blue' : 'purple'}>
          {b.skill_scope}
        </Tag>
        <span>v{b.skill_version}</span>
        <span>·</span>
        <span>mode: {b.binding_mode}</span>
        {b.locked && <Tag>locked</Tag>}
        {!b.locked && (
          <Popconfirm
            title="解绑该市场技能？"
            description={`将解除「${b.skill_name}」与本员工的绑定关系`}
            okText="解 绑"
            okButtonProps={{ danger: true }}
            cancelText="取 消"
            onConfirm={() => handleUnbind(b.id)}
          >
            <Button size="small" danger>解绑</Button>
          </Popconfirm>
        )}
      </div>
    ))}
  </div>
)}
```

**P3.9.7 浏览器实测:** Popconfirm 弹出 → 点击"解 绑" → 后端 DELETE → 列表刷新 → 已解绑的项消失。

### 3.3 Skills.tsx — closable Tag + onUnbind

`onClose` handler **必加 stopPropagation**,否则 click 会冒泡到父卡片:
```tsx
<Tag
  key={b.id}
  color={b.target_type === 'employee' ? 'cyan' : 'orange'}
  closable={!b.locked}
  onClose={(e) => { e.preventDefault(); e.stopPropagation(); onUnbind(b.id, s.name); }}
>
  {empNameById(b.target_id)} · {b.binding_mode}
</Tag>
```

**P3.9.7 fix: FNV-1a shim 比较 (重点!)** — skills 列表通过 `withIdShim` 把 `s.id` 变成 hashInt,但 binding.skill_id 是真的 UUID。直接 `bindingsBySkill(s.id)` 永远空:

```tsx
// 修复前 (永远 0 结果):
const bindingsBySkill = (skillId: string) => bindings.filter(b => b.skill_id === skillId);
// 修复后 (用 __id 比较):
const realSkillId = (s as any).__id || s.id;
const sb = bindingsBySkill(realSkillId);
```

`onBind` 也用 `__id`:
```tsx
await bindSkill(skill.__id || skill.id, { ... });  // url 字段正确
```

### 3.4 SkillMarket.tsx — Fork→employee 按钮 + 员工选择 prompt

```tsx
<Button size="small" onClick={() => onFork(s, 'user')}>Fork→user</Button>
<Button size="small" onClick={() => onFork(s, 'employee')}>Fork→employee</Button>

const onFork = async (s, target) => {
  if (target === 'employee') {
    // 列出员工,prompt 选择
    const emps = await fetchEmployees();
    const list = emps.slice(0, 10).map((e, i) => `${i+1}. ${e.display_name || e.name}`).join('\n');
    const idx = window.prompt(`Fork "${s.name}" to which employee?\n\n${list}\n\nEnter number:`);
    if (!idx) return;
    const i = parseInt(idx, 10) - 1;
    const empId = (emps[i] as any).__id || emps[i].id;
    const r = await forkSkill(s.__id || s.id, target, empId);
    message.success(`forked to ${r.scope} + bound to ${...}`);
  } else {
    const r = await forkSkill(s.__id || s.id, target);
    message.success(`forked to ${r.scope}`);
  }
};
```

`onPublish` / `onDisable` / `onFork` 全部用 `s.__id || s.id` (shim 修复)。

---

## 4. 4 个 P3.9 浏览器端真实发现

| # | bug | 修法 |
|---|-----|------|
| 1 | EmployeeDetail 解绑按钮用 `window.confirm()` 阻塞浏览器,Antd 测试工具死锁 | 改用 Antd `Popconfirm` 组件 |
| 2 | Skills 页 `bindingsBySkill(s.id)` 比较失败: `s.id` 是 shim hashInt, `b.skill_id` 是真 UUID | 改用 `s.__id` |
| 3 | SkillMarket `onFork/onPublish/onDisable` 用 `s.id` 同样失败 | 改用 `s.__id \|\| s.id` |
| 4 | Skills 页 `onBind` 用 `skill.id` 同样失败 | 改用 `skill.__id \|\| skill.id` |
| 5 | Tag onClose 不 stopPropagation 引起冒泡 | 加 `e.stopPropagation()` |
| 6 | fork→employee 不创建 binding | 后端自动建 |
| 7 | market 列表不显示 employee scope | filter 增加 employee 分支 |
| 8 | fork→employee 缺 target_id 校验 | 后端显式 400 + 校验 employee |

每条都是**只有浏览器真点击才发现**的 — 18 个 verify 测试 + 7 audit 测试都没碰到。

---

## 5. 端到端浏览器验证

### 5.1 EmployeeDetail Bind 真实显示
- 创建 binding: `Phase 3.5 Test (fork)` → DemoSecret, mode=copied
- /employee/18313dd4-... 页面 Skill 配置 tab
- 看到 "已绑定市场技能" + "Phase 3.5 Test (fork)" + 解绑按钮 ✓

### 5.2 EmployeeDetail 解绑 (Popconfirm)
- 点击 "解 绑" → Antd Popconfirm 弹出 "解绑该市场技能？"
- 点击 "解 绑" → API DELETE 200 → 列表刷新 → 提示 "暂未从技能市场绑定技能" ✓

### 5.3 EmployeeDetail 显示 inherited (locked)
- 创建 binding: `Hermes Built-in Tools` (global) → DemoSecret, mode=inherited, locked=true
- EmployeeDetail 显示该 skill 带 "locked" 标签,**无解绑按钮** ✓

### 5.4 Skills 页 Bind 流程
- /skills 列表显示 "Hermes Built-in Tools" (global, geekblue tag)
- 点击 Bind… → 展开员工选择面板(取 消 + 6 员工按钮)
- 点击 "DemoSecret" → API bind 200 → 列表刷新 ✓

### 5.5 Skills 页 显示已绑员工 (cyan closable Tags)
- /skills 列表
- 同一 global skill 卡片底部显示 "已绑定 2 个员工:" + "Atlas 助手 · inherited" + "DemoSecret · inherited" (cyan, **无 close** 因 locked)
- 同一 user skill "Phase 3.5 Test (fork)" 显示 "已绑定 1 个员工:" + "DemoSecret · copied" (cyan, **有 close** 因 locked=False) ✓

### 5.6 SkillMarket Fork→employee
- /skill-market 显示 "Fork→user" + "Fork→employee" 按钮
- 点击 Fork→employee → 浏览器 window.prompt 列出 6 员工 → 输入 1 → 后端 fork 200 + 自动 create binding ✓
- 返回 market 列表, 4 员工 scope 的 Hermes (fork) 都显示,Tag 颜色 magenta ✓

### 5.7 全链路回归
- /tmp/verify_p35.py 18/18 PASS (无 regression)
- /tmp/verify_audit.py 7/7 PASS
- npm run build ✓ 9.5s

---

## 6. 王六新硬规则 (P3.9 累积)

1. **FNV-1a shim 双 ID 规则**: `s.id` 是 hashInt 不能传给后端, 用 `s.__id || s.id` 一律改
2. **Tag onClose 必加 stopPropagation**, 否则冒泡触发外层点击
3. **解绑/删除 严禁 window.confirm**, 用 Antd Popconfirm 替代 (避免阻塞浏览器自动化)
4. **后端 fork→employee 必须自动建 binding** + 校验 target_id
5. **后端 list 必须包含所有 scope**, 不能漏 employee
6. **N 个 verify 测试 PASS 也不代表能用**, 必须浏览器真点击 bind 按钮端到端跑通

---

## 7. 验收清单 (5.1 + 5.2 + 5.3 + 5.3 from spec)

- [x] 前端 API client 不再调废弃 /api/v1/employees
- [x] 后端所有 Hermes 代理接口有错误映射
- [x] 审计日志记录 Skill 引入、Skill 绑定、Memory 修改、Memory 注入
- [x] Skill Market 能显示 global/tenant/user/employee 来源与锁定状态
- [x] 普通用户可以引入可用 Skill,并绑定到自己的数字员工
- [x] P3.9 子目标 8/8 全部完成

---

## 8. 待办 (后续 phase)

- **P4.0 sandbox**: 真实 mutate Hermes profile 的 skills (现在绑了 binding 但没真的写到 hermes profile)
- **Cleanup**: 清掉测试残留的 4 个 employee "Hermes Built-in Tools (fork)"
- **Token TTL UX**: 浏览器端 401 → 自动 logout + redirect, 但目前没有 401 自动 refresh, 长时间使用会跳到 /login
