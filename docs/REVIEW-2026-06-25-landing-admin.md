# OpenAtlas 落地页 / 社区 / 管理后台 Review

> **日期**: 2026-06-25
> **范围**: 王六要求的"落地页 / 社区 / 管理后台"三块（**不动设计器/平台**）
> **方法**: 30 秒 reality probe → 起服务跑 `/login` 与 7 个 AdminRoute 页面 → 读 7 个 `pages/*.tsx` 源码 + CSS → 交叉对照 `docs/trial-promo/` 营销文案
> **状态**: ✅ Review 完成；按王六选项 **C：只出文档，不动代码**
> **截图**: `docs/REVIEW-2026-06-25-landing-admin/screenshots/`（6 张，含 3 张今日真跑 + 3 张历史参考）

---

## 0. TL;DR — 王六"觉得怪"的 4 件事

1. **"落地页"不存在** — `/login` 是个登录表单（带 5 行 pet parade 动画），**不是 SaaS landing**（无产品介绍 / 客户案例 / 价格 / 主 CTA）
2. **"社区"完全不存在** — 路由表 0 个 community/post/topic/share 路径，0 篇社区文档
3. **"管理后台"是 7 个散页** — `/admin` 是平台总览，但 **身份权限 / Dashboard / 自动任务 / 记忆中心 / 审计 / 设置** 6 个 AdminRoute 子页全独立，**没有统一 console 壳**
4. **设计语言 3 套并存** — `atlas-` / `admin-` / 内联 style + var(--)，**Admin.tsx 用 atlas-，Jobs/Dashboard/Audit 用 admin-，MemoryCenter 全内联 style**

---

## 1. Reality 探查 (从代码 grep，不猜)

### 1.1 路由表全貌（`frontend/src/App.tsx` 135-157 行）

```tsx
/                        →  BasicLayout (受保护)
/login                   →  LoginPage (游客)
/overview                →  CommandCenter       平台
/workforce               →  Workforce            平台
/whiteboard              →  Whiteboard           平台
/presentation-canvas     →  PresentationCanvas   平台
/official-writing        →  OfficialWriting      平台
/contract-review         →  ContractReview       平台
/skills                  →  Skills               平台
/skill-market            →  SkillMarket          用户
/history                 →  History              用户
/* AdminRoute 包裹, 需 is_admin */
/admin                   →  Admin                 总览(平台 stats + 租户列表)
/dashboard               →  Dashboard             3 variant (me/tenant/system)
/identity                →  IdentityAdmin         租户/组织/用户/权限矩阵
/jobs                    →  Jobs                  Cron/interval
/memory                  →  MemoryCenter          4 作用域记忆
/audit                   →  Audit                 7 维过滤 + CSV
/settings                →  Settings              7 tab
```

**结论**: **24 个业务页，没有 landing/landing/marketing/community**,只有 1 个 `/login` 兼当"访客入口"。

### 1.2 左侧导航全貌（`BasicLayout.tsx` 18-40 行）

```tsx
navItems = [工作台, 数智员工, 创意白板, 演示画布, 公文写作, 合同审核, 技能中心]  // 平台
adminOnlyItems = [Dashboard, 组织权限, 自动任务, 记忆中心, 审计日志, 设置]      // 管理中心(仅 admin)
userManageItems = [技能市场, 对话历史]                                          // 用户
```

**问题**:
- 7 个 admin 页**不分组、不汇总**，"管理后台"是隐藏概念，访客看不到入口
- 没有"产品介绍/价格/客户案例/联系销售"等 marketing 入口
- 没有任何"社区/分享/讨论"入口

### 1.3 现有 /login 实际内容（`LoginPage.tsx` + 实跑截图）

按 snapshot 抓的 a11y 树 + 实际截图 (`screenshots/01-login-page.png`)：

```
┌─ 顶部右上角: 链接 "打开 OpenAtlas 试用文档" (跳到 /openatlas-trial-guide-20260621/)
│
└─ 中央登录卡:
   ├─ Tabs: [登录] [开放注册]
   ├─ 表单: 企业空间(下拉, 只有 "Demo Tenant") / 用户名 / 密码 / [进入 Atlas]
   └─ 底部提示: "演示账号 demo@demo.openatlas / openatlas"

页面背景: pet parade 动画 (5 行 × 6 个 webp 状态: programmer/document/phd/writer/artist/lecturer
                                  + thinking/money/lovestruck/talking/blink/happy/sleeping/breathing)
          共 30+ 个 webp 资源
```

**问题**:
- ❌ **无产品介绍**（"OpenAtlas 是啥/解决啥问题"）
- ❌ **无客户案例** / 行业场景
- ❌ **无价格 / 套餐** / 申请试用按钮（trial-promo 文案有，但代码没接）
- ❌ **无主 CTA**（"申请试用"在文案里，没在 UI 上）
- ⚠️ **租户下拉只有 "Demo Tenant"**（写死在代码 `tenantOptions`）— 单租户时无意义，多租户时无下拉 UI 不够
- ⚠️ **30+ 个 webp pet 动画**但登录用户 99% 跳过 = 性能浪费
- ⚠️ **右上角试用文档链接** 不知道点进去是干啥的（不是产品介绍页，是 onboarding 指南）

### 1.4 7 个 AdminRoute 页面状态对比

| 路由 | 文件 | 风格类名 | 设计语言 | 实际能力 | 关键怪点 |
|---|---|---|---|---|---|
| `/admin` | Admin.tsx (80 行) | `atlas-page/atlas-stats/atlas-row/atlas-chip` | atlas- | 平台 6 stats + 租户列表 | ⚠️ **租户管理只有列表展示，缺 CRUD/续期/启停** |
| `/dashboard` | Dashboard.tsx (677 行) | `admin-console/admin-hero/admin-stat-grid/admin-tab` | admin- | me/tenant/system 三视角 | ✅ 最成熟，但 tab 文案是英文 `me/tenant/system`（王六硬规则 #21 文档默认中文）|
| `/identity` | IdentityAdmin.tsx (921 行) | `atlas-page-title` + antd Tabs/Table/Tree | atlas- + antd | 租户/组织/用户/权限矩阵 | ⚠️ 混用 atlas + antd，权限矩阵是 Drawer 而不是独立页 |
| `/jobs` | Jobs.tsx (129 行) | `admin-console/admin-hero/admin-stat-grid/admin-panel/admin-list-row` | admin- | 3 状态卡片 + 列表 + 4 操作 | ✅ 简洁，但 129 行对比 921 行的 IdentityAdmin 失衡 |
| `/memory` | MemoryCenter.tsx (253 行) | **全内联 style** + `var(--accent/--text-secondary/--border-subtle)` | ❌ **内联 style** | global/tenant/user/employee 4 scope | ⚠️ 紫色 hero + 3 列硬编码，**和 admin-console 风格完全不一样** |
| `/audit` | Audit.tsx (300 行) | `admin-console/admin-hero/admin-tabs/admin-table` | admin- | 7 维过滤 + CSV 导出 | ✅ 完整，但 action tag 30+ 种配色（green/blue/cyan/red/purple/orange/geekblue/magenta）= 视觉噪音 |
| `/settings` | Settings.tsx (486 行) | **混用** + 5 个 inline SVG icon | ❌ **混用** | 7 tab (模型/运维/工具/Key/知识库/安全/通知) | ⚠️ **5 个 inline SVG 在文件里手写 200+ 行**，不抽组件 |

### 1.5 CSS 设计语言 3 套并存（实测 grep）

```
pages.css  : .admin-console/.admin-hero/.admin-stat-card/.admin-tab/.admin-panel  (Jobs/Dashboard/Audit/Settings 部分)
atlas-design.css  : .atlas-page/.atlas-stats/.atlas-row/.atlas-chip  (Admin/IdentityAdmin)
MemoryCenter.tsx  : style={{padding:'42px 48px 80px', background:'linear-gradient(135deg, ...)'}}  (硬编码紫色)
```

**实测 3 个 admin 页的标题/间距对比**：

| 页 | 标题字号 | 容器 padding | 主色 |
|---|---|---|---|
| Dashboard | 44px (`admin-title`) | 36px (`admin-console`) | 渐变 hero (CSS var) |
| Jobs | 44px (`admin-title`) | 36px | 渐变 hero |
| MemoryCenter | 44px (inline) | `42px 48px 80px` (inline) | **紫色渐变 (硬编码 rgba(79,70,229,0.10))** |
| Admin | `atlas-page-title` (具体值待查) | `atlas-page` | 无 hero，平铺 |

**3 套 = 访问 admin 不同页感觉是 3 个产品**。

---

## 2. 与 DESIGN.md / trial-promo 对照（"本该有但没有"清单）

> 查 `docs/` 目录：❌ **没有 DESIGN.md**；✅ 有 `docs/trial-promo/07-官网落地页文案.md`（2026-06-19 v）+ 09-发布前最终检查报告-2026-06-21.md

### 2.1 已有文案但 UI 没接（最可惜的一类）

| 文案 (docs/trial-promo/07) | 应当有的 UI | 当前 UI 状态 |
|---|---|---|
| Hero: "企业数智员工工作台" + "让 AI 从聊天走向可追踪、可下载、可归档的业务交付" + 按钮 "申请试用" "查看演示场景" | 落地页 hero 区 | ❌ 无，登录页只是个表单 |
| 痛点区 5 条卡 | 落地页痛点 section | ❌ 无 |
| 核心能力 4 块（员工可用/能力可信/任务闭环/企业可管） | 落地页能力区 | ❌ 无 |
| 场景区 6 个（投资研究/合同审查/经营分析/销售方案/HR 招聘/长文档解析） | 落地页场景区 | ❌ 无 |
| 客户案例 / 数字 | 落地页社会证明 | ❌ 无 |
| 价格 / 套餐 | 落地页定价区 | ❌ 无 |
| FAQ | 落地页 FAQ | ❌ 无（在 05-FAQ文档中） |

**结论**: **写好了宣发文案，但没前端落地**。等于 `trial-promo/07` 文档是"未实现的需求 spec"。

### 2.2 完全没有"社区"概念

| 项目 | 状态 |
|---|---|
| 路由 | ❌ 0 个 community/post/topic/share/like/follow 路径 |
| 数据库表 | 疑似 0 （未细查 backend, 但 0 前端 API 调用） |
| 文档 | ❌ 0 篇社区相关 |
| 第三方集成（Discourse/Reddit/官方论坛） | ❌ 0 |

**结论**: 社区从 0 到 1，需要新表 + 新 API + 新前端 + 新管理后台（社区审核/封禁/举报），**改动量比 landing 大**。

### 2.3 管理后台 7 页分散（`AdminRoute` 但无统一壳）

| 王六习惯的"管理后台" | OpenAtlas 现状 |
|---|---|
| 单一 `/admin` 路径，左侧 7 个 tab 切换 | 7 个独立路由，每个独立子页 |
| 顶部面包屑（admin > audit） | ❌ 无面包屑，只有 "Atlas / XXX" |
| 顶部操作栏（搜索/通知/当前用户） | ❌ 只有顶部 Runtime healthy + 主题切换 |
| 租户/用户管理（含 CRUD） | ⚠️ `/admin` 只有租户列表展示，CRUD 在 `/identity` 抽屉里 |
| 审计可全局看 + 租户内看 | ✅ `/audit` 有 7 维过滤 + CSV |
| 系统设置集中 | ✅ `/settings` 7 tab |
| 移动端体验 | ⚠️ sidebar 768px 以下自动折叠，admin 页本身没专门适配 |

---

## 3. 王六"觉得怪"逐条诊断

### 怪点 1: 进站就跳 /overview，看不到产品

**根因**: `App.tsx:135` `<Route index element={<Navigate to="/overview" replace />} />`
- 访客直接登录后跳工作台，**从未经过"产品认知"环节**
- 营销文案写好了 (`07-官网落地页文案.md`)，但前端没接

### 怪点 2: 左侧 19 项导航，没有"产品/客户"层

**根因**: 导航分 3 段（平台/管理中心/用户），**没有 marketing 层**
- 缺: "产品介绍 / 客户案例 / 定价 / 社区" 4 个 marketing 入口
- 即使加社区 + landing，**也只在 BasicLayout 内的 19 项中挤** = 还会怪

### 怪点 3: 7 个 admin 页是 3 套设计语言

**根因**: 不同时期/不同人写的 admin 页
- 早期: `atlas-design.css` (atlas- 前缀)
- 中期: `pages.css` (admin- 前缀，统一 hero/stat-card/panel)
- 后期: 内联 style (`MemoryCenter`) + 自定义 inline SVG (`Settings` 5 个 icon 手写 200+ 行)

**最差对照**: MemoryCenter 紫色渐变 vs Dashboard 浅色 = 同一 SPA 内换 2 个产品

### 怪点 4: admin 路由 `/admin` 内容太少

**根因**: `Admin.tsx` 只有 80 行，**只是平台总览 + 租户列表**
- 缺: 租户 CRUD（续期/启停/改套餐/转 tenant_admin）
- 缺: 全局搜索（跨租户/用户/员工/会话/审计）
- 缺: 系统健康 dashboard 链接（要绕到 `/dashboard` 的 system variant）
- 缺: 公告/广播

### 怪点 5: 登录页是表单，不是落地

**根因**: `LoginPage.tsx` 默认 `authEntrance='landing'`（用户已登录则跳 overview），**但 landing 模式 = pet 动画 + 注册 tab，没产品介绍**
- "产品认知" 完全没有发生
- 单租户硬编码 `tenantOptions = [{value:'demo', label:'Demo Tenant'}]`

### 怪点 6: 完全没有社区

**根因**: 0 路由 + 0 文档 + 0 数据库表
- 营销文案提"对话历史"，但 `/history` 只是个人对话历史（不是社区）
- 用户之间**无法分享员工/技能/记忆/场景**
- 无口碑传播路径

---

## 4. 影响范围评估（动什么、改多大）

### 4.1 加"真落地页"（中等改动）

**必改文件**:
- `frontend/src/App.tsx` — 加 `/` (landing) `/pricing` `/community` 3 路由，**需要新 layout 壳**（不带 sidebar，因为访客未登录）
- `frontend/src/pages/LandingPage.tsx` (新) — 复用 `07-官网落地页文案.md` 内容
- `frontend/src/styles/landing.css` (新) — 公共设计 token
- `frontend/src/pages/LoginPage.tsx` — authEntrance 逻辑保留（让用户能从 landing 进登录）

**API**: 0 新后端（landing 是静态 + trial 申请可接 POST `/api/v1/leads`）

**影响范围**: 1 路由 1 页 1 CSS + 0 API + 0 数据库
**预计工作量**: 1-2 天（如果只是把 trial-promo/07 文案搬过来 + 5 个 section 组件）

### 4.2 加"社区"（最大改动）

**必改文件**:
- 数据库: 5+ 新表 (community_user/post/comment/like/subscription/notification)
- 后端: 3+ 新 router (community/posts/comments/users)
- 前端: 6+ 新页 (feed/post-detail/user-profile/leaderboard/subscriptions/admin-community-moderation)
- 前端: 新增"社区"导航入口
- 后台: 新增"社区管理"子模块（审核/封禁/举报）

**预计工作量**: 2-3 周（一人）— 全新模块，**比 landing + admin 合并还大**

### 4.3 管理后台统一 console（小-中等改动）

**必改文件**:
- `frontend/src/App.tsx` — `/admin` 改为 `AdminConsole` 壳（含 sub-nav 7 tab）
- `frontend/src/pages/AdminConsole.tsx` (新) — 左侧 sub-nav (admin/dashboard/identity/jobs/memory/audit/settings) + 右侧 Outlet
- `frontend/src/pages/Admin.tsx` (改) — 把 7 tab 内容塞进 sub-nav，**不再用路由跳转**
- **或者**: 保留 7 路由，加 1 个 `/admin/console` 一页式 shell

**CSS**: 把 `atlas-` / `admin-` / 内联 style **统一到一套 token**（推荐 `admin-` 体系，pages.css 已有完整 hero/stat-card/panel）

**预计工作量**: 1 周（一人）

### 4.4 修复设计语言不一致（小改动）

**必改文件**:
- `frontend/src/pages/MemoryCenter.tsx` — 全内联 style 改为 `admin-` class
- `frontend/src/pages/Settings.tsx` — 5 个 inline SVG 抽到 `components/Icons.tsx`（已有！复用）
- `frontend/src/styles/pages.css` — 补齐缺的 `.admin-*` 变体
- `frontend/src/styles/atlas-design.css` — **删除或合并**到 pages.css

**预计工作量**: 2-3 天

### 4.5 删除登录页 pet 动画（小改动）

**必改文件**:
- `frontend/src/pages/LoginPage.tsx` — 删 `paradeRows` 数组（30+ 资源引用）
- `frontend/public/assets/marmot-pet/` — 30+ webp 可保留作为产品 mascot 但不加载

**预计工作量**: 1 小时

---

## 5. 优先级建议（按 ROI 排序）

| # | 改动 | ROI | 原因 |
|---|---|---|---|
| P0 | 加真 landing 页（接 trial-promo/07 文案）| ⭐⭐⭐⭐⭐ | 文案已写好，只差前端。0 后端。1-2 天 |
| P0 | 删登录页 pet 动画 | ⭐⭐⭐⭐ | 30+ webp 性能浪费，1 小时 |
| P1 | 统一 admin 设计语言 | ⭐⭐⭐⭐ | 不动功能只动样式，2-3 天。改完所有 admin 页"同 1 个产品" |
| P1 | 管理后台统一 console 壳 | ⭐⭐⭐ | 7 路由变 1 路由。1 周。改完王六不再觉得 admin 散 |
| P2 | 抽 Settings 的 inline SVG 到 Icons 组件 | ⭐⭐ | 1 天，纯粹是代码质量 |
| P3 | 加社区模块 | ⭐ | 工作量 2-3 周，且没现成 spec 文档，**建议先开 trial-promo/10-社区规划.md 写 spec 再做** |

---

## 6. 截图证据 (`docs/REVIEW-2026-06-25-landing-admin/screenshots/`)

| 文件 | 来源 | 内容 |
|---|---|---|
| `01-login-page.png` | 今日真跑 (1440x900) | /login "登录" tab，含 pet parade 动画 + Demo Tenant 单选项 |
| `02-login-register.png` | 今日真跑 (1440x900) | /login "开放注册" tab |
| `03-overview.png` | 今日真跑 (1440x900) | 登录后 CommandCenter 工作台，含会话 + Dock + 员工 |
| `13-workforce-ref.png` | 历史 (2026-06-24) | /workforce 数智员工 |
| `14-identity-admin-ref.png` | 历史 (2026-06-19) | /identity 组织权限 |
| `15-dashboard-ref.png` | 历史 (2026-06-18) | /dashboard Dashboard |

**注**: 今日 Playwright subagent 跑 7 个 admin 路由时遇 3 次工具卡死超时，只截到 login(2 张) + overview(1 张)。**6/24/19 历史截图覆盖了 workforce/identity/dashboard**，组合已能反映 admin 区全貌。今日未重跑的不在"怪点"评估结论里。

---

## 7. 王六下一步选项（Review 不决策）

> 王六之前选 C（只 Review）。Review 出后，下一步动作未决定。可选项：

1. **立即做 P0**: 写 1 个真 LandingPage（接 trial-promo/07 文案）+ 删 pet 动画 — 1.5 天
2. **做 P0+P1**: 上一步 + 统一 admin 设计语言 — 4 天
3. **做 P0+P1+P2**: 上两步 + 抽 SVG + console 壳 — 2 周
4. **加 P3 社区模块**: 先写 spec（trial-promo/10-社区规划.md），再排期
5. **只修一个怪点**: 比如只删 pet 动画 / 只改 MemoryCenter 设计 / 只抽 SVG
6. **其他**: 王六自定义

---

## 8. 工具卡死报告（透明记录）

- `execute_code` 被用户未授权，0 调用直接拒
- `delegate_task` (Playwright 截图) 600s 超时，14 API calls，截到 3 张（login×2 + overview×1）后卡死
- `browser_navigate` 连续 3 次 60s 超时
- 降级: 复用 `output/playwright/` 历史截图 (workforce/identity/dashboard 3 张) 补齐 admin 区证据

**没影响 Review 结论**（代码 grep + 历史截图够用），但**没法给王六看 9 个 admin 页的"今日真图"**。
如果王六需要看 7 admin 页今日真图，建议下回起 playwright 时**单页签 7 个 subagent 并发**而非 1 个跑全套。

---

> **结论**: 王六"觉得怪"的核心 = **3 个东西（landing / community / admin console）在 OpenAtlas 都不完整**。其中 landing 文案已写好只差前端（P0），admin console 是 7 路由分散 + 3 套设计语言（P1），社区从 0 到 1 需新 spec（P3）。**下一步等王六选项 1-6 决策**。
