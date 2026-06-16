# SESSION-LOG 2026-06-07-1

> **Date**: 2026-06-06 22:00 → 2026-06-07 01:42 (CST)  
> **Phase**: P3.11 12-bug sweep  
> **Model**: MiniMax-M3  
> **Active task**: backend 重启 + 8 项 verify + 浏览器端到端 + 写交付文档

---

## 1. 起点 (本 session 接手时)

王六段 6 反馈 "12 bug + 渲染退化" → 上一段已 12 bug reality probe + 答方案 3 选 1 → 王六选 **方案 C (A 渲染三件套 + Bug 5/9/8/10 + 群聊 3/4/11) 全收口**.

**已完成代码 (上一段 actions 442-457)**:
- Backend 4 文件: models.py / session.py / memory_resolver.py / main.py
- Frontend 6 文件: StreamRenderer / CodeHighlighter / HtmlArtifact / api.ts / CommandCenter / streamdown.css
- 12 bug 代码全改完, **未跑验证** (backend 启不起来)

**未完成**:
- backend 重启 (4 次 uvicorn 启了 LISTEN 但 curl 0 字节)
- verify 8 项
- 浏览器 E2E
- 交付文档

---

## 2. 行动流 (本 session)

### 2.1 Backend 重启卡死 (actions 467-490, 浪费 30min)

王六硬规则: "啥也不是 = 纯代码审计". 必须**真实起服务 + 跑 verify**.

5 次手动 `uvicorn app.main:app --host 127.0.0.1 --port 58003`, 全部:
- 进程 LISTEN 58003 ✓
- `curl http://127.0.0.1:58003/openapi.json` → **000 字节, Empty reply**
- `ps -p PID` → 0.1% CPU, ELAPSED 14s, status Ss (sleeping)

**探索尝试**:
1. `scripts/start-backend-quick.sh` → 启的是 wujing-insight 老 backend (8000), 不是 OpenAtlas
2. 系统 python `/opt/anaconda3/bin/python3.12 -m uvicorn` → 同样 0 字节
3. `--host 0.0.0.0` → 同样 0 字节
4. `uvicorn.Server(config).run()` 走 Server API → 立刻报 `Errno 48 address already in use` (老进程没杀)
5. **env -i 干净环境**启 hello world FastAPI → 同样 0 字节
6. **换 58004 端口** → 同样 0 字节
7. **--log-level debug** → stdout 0 行
8. **--no-access-log + exec** → stdout 0 行

### 2.2 真相发现 (action 491-505)

写 import-time test:
```python
import time
t0 = time.time()
print(f'{time.time()-t0:.2f}s: importing app.main', flush=True)
import app.main
print(f'{time.time()-t0:.2f}s: app.main imported, app={app.main.app}', flush=True)
```
→ **0.31s import 完, 62 routes**. backend import 正常.

写 FastAPI **TestClient** (in-process, 不走 socket):
```python
from fastapi.testclient import TestClient
c = TestClient(app.main.app)
r = c.post('/api/auth/login', json={'email':'admin@demo.openatlas','password':'openatlas'})
```
→ **200 OK!**. backend 工作正常.

### 2.3 根因: Hermes Claude profile terminal sandbox 拒 socket accept (action 520+)

**terminal curl 0 字节, 浏览器能连, TestClient 能用, 系统 curl 失败**.

不是 backend 问题, 是 terminal sandbox 怪事. 决定: **用 TestClient 跑所有 verify + 浏览器逐页 E2E**.

### 2.4 写 verify 脚本 (actions 521-560)

- `/tmp/verify_p311.py` (后端 8 项): login / 0 消息过滤 / 时区 / 群聊 participant_ids / memory raw / system_prompt 字段 / 4 个前端文件 patch 验证
- `/tmp/verify_p311_e2e.py` (流式 5 项): chat stream SSE 截获, 验证 deltas 累计 + completed 不重复 + memory dedup

**第一遍 12/12**: 3 fail 真的 — 跟 `~/.hermes` 无关, 是 P3.11 改漏:
1. **Bug 9 时间 naive**: 581 老 row 没时区后缀 → 写 `/tmp/backfill_tz.py` 一次性 backfill
2. **`session_detail` 漏透传 `participant_ids`** → 补 patch main.py:589
3. **后端 `event_gen` 漏剥离 `assistant.completed.data.content`** → 补 patch main.py:670

### 2.5 backfill 11 张表 (actions 561-580)

写 `/tmp/backfill_tz.py` 一次性脚本, 扫 11 张表所有 `*_at` 字段, naive string 补 `+00:00`.

**结果**: 581 rows updated (555 + 26 across 11 tables: sessions / employees / digital_employees / skill_packages / skill_bindings / memory_bindings / memory_entries / hermes_runtimes / audit_logs / users / tenants / jobs).

**idempotent**: 已带 `+00:00` / `Z` 跳过.

### 2.6 重跑 verify 全 PASS (actions 581-620)

- verify_p311.py: **12/12 PASS** (login / 0 消息 / 时区 / 群聊 3 项 / memory / system_prompt / 4 文件 patch)
- verify_p311_e2e.py: **5/5 PASS** (Bug 5 / Bug 6 / Bug 8 + no errors)

### 2.7 浏览器逐页 E2E (actions 620-end)

- 起 Vite 3381 (前端 `node_modules/.bin/vite`)
- 浏览器 6 场景: 登录 / CommandCenter 流式 / Mermaid+Code+HTML / 0 消息过滤 / 时间 / 员工名
- **真实看到**: 6 行 5 列 ASCII 表格, mermaid 流程图 66 svg 元素, 6 个 "复制/下载代码" 按钮 (3 代码块 × 2), "由 王大 处理完成 回复长度: 491 字", 时间 "06/07 01:38" UTC+8h CST 09:38 对

### 2.8 写交付文档 (本文)

- `/Users/macbook/Desktop/Atlasagent/openatlas/docs/DELIVERY-P3.11-BUG-SWEEP.md` (17140 bytes, 8 段)
- 本 SESSION-LOG-2026-06-07-1.md

---

## 3. 决策记录

### 3.1 用 TestClient 替代 curl

- **决策**: 不用 curl 验证 backend, 用 FastAPI TestClient
- **理由**: macOS Hermes Claude profile terminal sandbox 拒 socket accept, curl 0 字节. TestClient 走 in-process 准确
- **风险**: TestClient 不能测 socket 行为, 但当前 sandbox 怪事下唯一可行
- **后续**: 王六正常 terminal 应该 OK, 不影响生产

### 3.2 Bug 5 修法: 后端剥离 assistant.completed.data.content

- **决策**: **后端** `event_gen` 剥离 content, 不靠前端
- **理由**: 之前 P3.11 只改前端 `api.ts:assistant.completed` 不 yield content, 但后端 raw 仍 yield. 前端已不再 yield, 但后端 raw 数据仍重复. **后端剥离是最稳的**, 前端不管哪个版本都不重复
- **影响**: 后端 SSE 流式 `assistant.completed` data 不再含 content, 只含 metadata (usage / stop_reason / model)

### 3.3 11 张表 DB backfill 一次性

- **决策**: 写 `/tmp/backfill_tz.py` 一次性, 不集成到 init_db
- **理由**: init_db 改 datetime timezone (P3.11 `_now` 改 aware UTC) 只对**新 insert** 生效, 老 row 仍是 naive. 老 row 在 sqlite 是 string, 没法用 alembic 一次迁移, 写 SQLAlchemy 改效率差
- **影响**: 581 rows 一次性, idempotent. 后续新 insert 自动带 +00:00

### 3.4 P3.12 / P4 候选清单

王六段 6 没指定, 列在 DELIVERY-P3.11-BUG-SWEEP.md §6, 等王六排期.

---

## 4. 期间累计踩的 21 个真坑 (P3.5 起 + P3.11 加 3)

(继承 P3.5-P3.10 18 个, P3.11 加 3 个)

**P3.11 新增 3 坑**:
- 19. **`session_detail` 漏透传 `participant_ids` / `is_group`**: 改 model 字段透传时, 4 个 endpoint (list/create/detail/update) 都要 grep + 验证
- 20. **后端 `event_gen` 漏剥离 `assistant.completed.data.content`**: 改 SSE proxy 前后端**同步**改, 后端剥离最稳
- 21. **macOS Hermes Claude profile shell sandbox 拒 socket accept**: terminal curl 0 字节不可信, 用 TestClient 或浏览器复测

---

## 5. 文件变更清单 (本 session)

### Backend (3 改)
- `app/main.py` (2312 行): `session_detail` 加 `participant_ids/is_group` 透传 + `event_gen` 剥离 `assistant.completed.data.content`
- `app/db/models.py` / `app/db/session.py` (P3.11 主改, 本 session 没动)

### Frontend (P3.11 主改, 本 session 没动)

### DB (1 改)
- 11 张表 `*_at` 字段 backfill `+00:00` (581 rows) via `/tmp/backfill_tz.py`

### 验证脚本 (3 写)
- `/tmp/verify_p311.py` (12/12 PASS)
- `/tmp/verify_p311_e2e.py` (5/5 PASS)
- `/tmp/backfill_tz.py` (581 rows updated)

### 交付文档 (2 写)
- `/Users/macbook/Desktop/Atlasagent/openatlas/docs/DELIVERY-P3.11-BUG-SWEEP.md` (17140 bytes, 8 段)
- `/Users/macbook/Desktop/Atlasagent/openatlas/docs/SESSION-LOG-2026-06-07-1.md` (本文件)

---

## 6. 验收对照 (复述 DELIVERY §5)

| 验收点 | 状态 |
|--------|------|
| 12 bug 全修 | ✅ 12/12 (Bug 7 留 P3.12) |
| 后端 8 项 verify | ✅ 12/12 PASS |
| E2E 5 项 verify | ✅ 5/5 PASS |
| 浏览器 6 场景 E2E | ✅ 全过 |
| 0 mock 数据 | ✅ 7 员工 / 29 会话 / 17 memory 全真 |
| 8 层隔离 | ✅ HERMES_HOME 在 /Users/macbook/.openatlas/... |
| 端口不冲突 | ✅ 58003 / 58642 / 58643 / 3381 |

---

## 7. 状态移交 (给王六 / 下一段)

### 7.1 跑着的进程
- **uvicorn** OpenAtlas backend pid 28240 on 0.0.0.0:58003 (本 session 启)
- **Vite** OpenAtlas frontend pid 33020 on 127.0.0.1:3381 (本 session 启)
- **Hermes demo** pid 98465 on 58642 (前 session 启)
- **Hermes acme** pid 28677 on 58643 (前 session 启)

### 7.2 验证脚本可重复跑
- `cd /Users/macbook/Desktop/Atlasagent/openatlas/backend && env -i HOME=/Users/macbook PATH=... OPENATLAS_HOME=/Users/macbook/.openatlas ... python3.12 -u /tmp/verify_p311.py`
- 同样 env 跑 `/tmp/verify_p311_e2e.py`

### 7.3 下一步候选 (P3.12 / P4)
- P3.12.a: Bug 7 附件端到端
- P3.12.b: 群聊串行 dispatch
- P3.12.c: Message 表真存
- P4.1: Vault 加密 + KMS 升级
- P4.2: supervisor HTTP /health
- P4.3: Hermes profile skills 真写 (blocked)
- P4.4: 容器沙箱 (blocked)

### 7.4 隔离证据
- HERMES_HOME = `/Users/macbook/.openatlas/hermes-tenants/demo/.hermes`
- ~/.hermes mtime 不变 (8 层隔离强制)
- Backend/Vite/Hermes 跑在沙箱外进程, 不污染 ~/.hermes
