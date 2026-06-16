# SESSION-LOG-2026-06-06-6 (P3.10 收口 + P4.0 拆 phase)

**Date**: 2026-06-06
**Sprint**: 段 6 (post-P3.9 收口)
**Trigger**: 王六 "P3.10、P4.0 是什么来着"
**Outcome**: 5 分钟收口 P3.10 + P4.0 拆 4 phase 名实相符

---

## 1. 触发 (王六问题)

```
回顾一下 P3.10、 P4.0 的开发内容是什么来着
```

## 2. Reality probe (质疑前先 grep 验证)

### 2.1 grep 验证 P3.10

```
$ grep -nE "lib.*es5" frontend/tsconfig.app.json frontend/tsconfig.node.json
no es5 reference

$ cat frontend/tsconfig.app.json | grep -E "target|lib"
"target": "ES2020",
"lib": ["ES2020", "DOM", "DOM.Iterable"],
```

**发现**: P3.10 实质已完, P3.9 收口时 memory 写的 "P3.10 tsconfig es5→es2020 (low pri)" 是过时的口径。

### 2.2 grep 验证 P4.0

P4.0 在 4 个 DELIVERY 中出现, 口径互相覆盖:

| 来源 | 说法 |
|---|---|
| `DELIVERY-PHASE-3.7.md:87` | "If we ever need to 'activate' a skill in a hermes runtime, Phase 4 will copy it from `tenant-skills/` to `hermes-tenants/{tenant}/.hermes/skills/`" |
| `DELIVERY-PHASE-3.8.md:182` | "P4.0: Sandbox — terminal command isolation, vault-backed credentials" |
| `DELIVERY-PHASE-3.9.md:359` | "P4.0 sandbox: 真实 mutate Hermes profile 的 skills (现在绑了 binding 但没真的写到 hermes profile)" |
| `DELIVERY-PHASE-3.md:35,98,149,151,153` | Phase 4 = KMS/Vault 换 Fernet local key + supervisor HTTP health probe + sandbox 容器 |

**发现**: P4.0 是 4 件事的杂烩, 不是单一 deliverable, 名实不符。

### 2.3 现实约束 grep

```
$ docker --version
command not found: docker
```

王六本机无 Docker Desktop, P4.0.4 容器沙箱在 spec §1.3 写"生产前至少 Level 3 容器隔离", 本机不可行。

王六硬红线 = 不动本机 `~/.hermes`, P4.0.1 "Hermes profile 真实写入" 需改 Hermes 上游, 根治路径封死。

## 3. 王六决策: A 选项

```
A 是 5 分钟关 P3.10 + 把 P4.0 拆 4 个 phase
```

**A 选项定义** (段 5 复盘时提的):
- 5 分钟关 P3.10: 写 1 份 DELIVERY-P3.10-cleanup.md
- P4.0 拆 4 个 phase 名实相符

## 4. P4.0 拆分决策

| 新 phase | scope | 可行性 | 环境约束 | 状态 |
|---|---|---|---|---|
| **P4.1** | Vault: Fernet local key → KMS / 加密凭据 Vault 化 | ✅ 本机可做 | 需 Fernet key 路径从 `~/.openatlas/backend-data/secrets.key` 升级 | ❌ 未做, 推后 |
| **P4.2** | Supervisor: socket-level TCP probe → HTTP /health probe | ✅ 本机可做 | 需 `hermes-runtime/hermes_cli/web_server.py` 加 /health 端点 (但不修 `~/.hermes`, 修 `OPENATLAS_HOME/hermes-runtime` 副本) | ❌ 未做, 推后 |
| **P4.3** | Hermes profile 真写: SkillBinding → hermes profile.skills 真实 mutation | ❌ 本机不可行 | 需改 Hermes 上游 web_server.py PATCH /api/profiles/{name} 加 skills 端点, **违反"不动本机 ~/.hermes"红线** | 🚧 Blocked, 等环境变化 |
| **P4.4** | 容器沙箱: terminal 命令隔离 / 工作区持久卷 / docker-compose runner | ❌ 本机不可行 | 需 Docker Desktop 2GB+ 安装 + Dockerfile 镜像化 + network policy | 🚧 Blocked, 等环境变化 |

**P4.1 + P4.2** 都是 backend-only, 不动 `~/.hermes`, 1 个 sprint 收口可做。
**P4.3 + P4.4** 标 blocker, 等环境 (Docker Desktop 安装 OR 不再硬红线 `~/.hermes`)。

## 5. 行动

1. 写 `docs/DELIVERY-P3.10-cleanup.md` ✅
2. 写本 SESSION-LOG ✅
3. memory 更新: 删除 P3.10 待做条目, 替换为 P3.10 done retrospective + P4.0 拆分决策记录
4. **不**写 PHASE-ROADMAP.md (王六没要, 也不必造, 4 phase 状态在本 log 即可)

## 6. 决策记录 (王六"质疑前 grep" 硬规则触发)

**学到的**: 以后 phase 名 / sprint 名 写入 memory 前, 必先 grep 验证: "这件事真的未做, 还是只是没单独写 doc"
- P3.10 是个反例: 实际做了, 只是没单独 doc, memory 写 "待做" 误导
- P4.0 是个反例: 4 件事被捆成 1 个 phase, 名实不符, 应该早点拆

**下次 follow-up**: 复盘其他 4-5 个 "P3.x 候选" 是不是也有类似 P3.10 问题 (e.g. P3.11 pre-build shim→uuid index 是不是其实 P3.8 顺手做了? 没单独 doc? 待王六问 P3.11 时再 grep)

## 7. 进程状态 (本机 ~/.hermes 全程未触碰)

- backend pid 76136 on 58003
- vite pid 57764 on 3381
- hermes demo pid 98465 on 58642
- hermes acme pid 28677 on 58643
- OPENATLAS_HOME=/Users/macbook/.openatlas

## 8. 后续

- P3.10 ✅ 收口
- P4.0 拆 4 phase 决策落档
- P4.1 + P4.2 候选 (王六决定下次 sprint 是否做)
- P4.3 + P4.4 标 blocked (环境约束)
- P3.11 候选: shim→uuid index (待 grep 验证是否 P3.8 顺手做了)
