# OpenAtlas 对标 Hermes Web UI / Hermes Studio 审计

日期：2026-06-23

对标对象：

- GitHub：`EKKOLearnAI/hermes-web-ui`
- 本地审计副本：`/tmp/hermes-web-ui`
- 重点文件：
  - `README.md`
  - `ARCHITECTURE.md`
  - `packages/client/src/stores/hermes/chat.ts`
  - `packages/client/src/api/hermes/chat.ts`
  - `packages/server/src/services/hermes/run-chat/index.ts`
  - `packages/server/src/services/hermes/run-chat/abort.ts`
  - `tests/client/chat-store-compression-state.test.ts`

## 本轮已修复

### 1. 切换会话不再隐式停止任务

问题：

OpenAtlas 原先在 `setActiveSessionIdSafe` 中切换会话时直接 `abort()` 当前 `/chat/stream`。这会把“离开视图”误判为“停止任务”，导致 Hermes run 已启动但前端断流，后端没有进入 detached watcher，最终停在 `run.started`，消息卡片和交付物都不再更新。

修复：

- 前端切换会话只标记原 session 进入后台同步，不再 abort 当前 stream。
- 只有用户点击“停止当前任务”才会调用 abort 和 Hermes stop。
- 后端捕获 `asyncio.CancelledError`，只要 run 已经启动，就标记为后台同步并调度 detached reconcile。

涉及文件：

- `frontend/src/pages/CommandCenter.tsx`
- `backend/app/main.py`

### 2. 切换会话增加“最后一次点击优先”

问题：

快速点击多个会话时，旧的 `fetchConversationDetail` / `fetchEmployeeDetail` 可能晚于新点击返回，覆盖当前 active session，表现为“点击失效”或跳回旧会话。

修复：

- 增加 `switchSeqRef`，每次切换递增序号。
- 异步返回时只有最新序号允许写入 UI 状态。

### 3. 会话恢复统一走 hydrate

问题：

切回会话时旧逻辑手工把 `detail.messages` 映射成普通消息，容易覆盖运行卡、工具卡、交付物卡等增强状态。

修复：

- `handleSwitchConversation` 改为统一调用 `hydrateSessionFromDetail`。
- 只在空会话时补默认作战室提示。

## Hermes Web UI 值得借鉴的设计

### 1. 运行态归属 session，而不是归属当前页面

Hermes Web UI 的核心做法：

- 服务端用 `sessionMap` 保存每个 session 的 `isWorking`、`events`、`runId`、`abortController`、`queue`。
- 前端切换 session 时调用 `resumeSession`，不会默认停止正在跑的 run。
- Socket.IO room 按 session 分发事件，前端通过 `registerSessionHandlers(sessionId, handlers)` 订阅。

OpenAtlas 当前状态：

- 已经有 `messagesBySession` 和 `sessionMetaById`。
- 但仍有全局 `isProcessing`、单个 `streamAbortRef`、单个 `activeHermesRunIdsRef`。

风险：

- 一个后台任务运行时，其他会话输入可能被全局 `isProcessing` 阻塞。
- 多个 session 同时运行时，stop/approval/run id 容易误归属。
- 后台 session 的审批、失败、交付物事件不一定能第一时间浮出。

建议：

- P0：把运行态升级为 `runStateBySession`。
- P0：Stop、approval、heartbeat、active run ids 全部按 session 隔离。
- P1：支持同一租户内多个 session 同时后台运行，但受额度治理限制。

### 2. Reattach / Resume 是一等能力

Hermes Web UI 的设计：

- `resumeSession` 会返回 messages、isWorking、events、queueLength。
- 如果服务端发现 bridge run 仍在跑，会调用 `resumeBridgeRun` 重新挂接。
- `run.reattach_failed` 也会作为非终态事件回放到前端。

OpenAtlas 当前状态：

- 有 `streamSessionEvents` 和 `recover/sync`。
- 但缺少“打开任意运行中 session 时自动 reattach Hermes run”的稳定协议。
- 现在更多依赖轮询/同步按钮/reconcile watcher。

建议：

- P0：打开会话详情时，如果存在 open run，自动触发一次 `resume/recover` 检查。
- P0：把 `run.reattach_failed` / `run.reconciled` / `artifact.imported` 做成可回放事件。
- P1：为 session events 返回最近 N 条运行事件，前端可恢复运行卡。

### 3. 同一 session 运行中再次发送应排队，而不是全局锁死

Hermes Web UI 的设计：

- 同一 session `isWorking` 时，新输入进入 `state.queue`。
- 服务端发 `run.queued`，前端展示排队消息。
- abort 完成后或 run 完成后自动 dequeue 下一条。

OpenAtlas 当前状态：

- `isProcessing` 是全局开关。
- 用户在一个会话跑长任务时，其他会话也可能被影响。
- 同一会话继续输入缺少清晰的“排队/追加上下文/打断”选择。

建议：

- P0：同一 session 运行中二次发送，提供三种动作：排队、补充上下文、停止并重跑。
- P1：不同 session 允许并行，但走租户并发额度。

### 4. 事件回放测试要覆盖“空完成、迟到输出、旧消息误用”

Hermes Web UI 测试覆盖了：

- `run.completed` 内容为空时不能覆盖已有流式内容。
- 旧 assistant 消息不能被当成当前 run 输出。
- reconnect resume 后继续沿用正确的 active assistant。
- tool-only run 不应该自动播放旧 assistant。

OpenAtlas 当前状态：

- 有 smoke/E2E，但缺少 session 状态机级单测。
- 对“切走、断线、迟到消息、空 completed、二进制产物入库”的回归还不够。

建议：

- P0：新增前端状态机测试或 Playwright mock SSE：
  - run.started 后切会话，原 session 保持运行。
  - run.completed 空输出但已有 delta 时，不丢内容。
  - artifact.created 后切回，文件卡仍存在。
  - 老 assistant 不能作为新 run 的输出。
- P0：新增后端断流测试：
  - 客户端断开后 run 标为后台同步。
  - watcher 导入迟到 message/artifact。

### 5. 审批和澄清应支持后台 session 触达

Hermes Web UI 有 `approval.requested`、`approval.resolved`、`clarify.requested`、`clarify.resolved`，并在 resume payload 里回放。

OpenAtlas 当前状态：

- 活跃会话内审批能弹出。
- 但后台 session 如果触发审批，当前页面不一定有全局通知和待办入口。

建议：

- P0：审批事件进入全局待办队列，按 session 聚合。
- P0：右上角或会话列表标出“等待审批/需补充”。
- P1：审批弹窗支持跳转到对应会话并定位工具调用。

### 6. 文件交付物应与消息文本分层

Hermes Web UI 强调 path-based download，可下载上传文件和 agent 生成文件。

OpenAtlas 当前状态：

- 已修复一部分二进制产物不能塞进 content 的问题。
- 但仍需要确保 DOCX/PDF/XLSX/PPTX 统一走文件托管、预览、下载、权限检查。

建议：

- P0：所有二进制交付物强制走 artifact/file storage，不允许落入 message.content。
- P0：消息卡只引用 artifact id，不承载二进制内容。
- P1：文件浏览器与会话交付物打通，支持按 session/workspace 查看。

## OpenAtlas 需要重点整改的设计缺陷

| 优先级 | 问题 | 当前风险 | 建议 |
| --- | --- | --- | --- |
| P0 | 运行态仍有全局状态 | 多会话并发、停止、审批可能串状态 | 建立 `runStateBySession` |
| P0 | 后台 session 审批不可见 | 用户以为卡死，实际在等授权 | 全局审批待办 + 会话列表状态 |
| P0 | 同 session 二次输入没有排队语义 | 用户不知道是追加、打断还是新任务 | 增加排队/补充/停止重跑选择 |
| P0 | 缺少状态机级回归测试 | 同类 bug 容易复发 | 补 run lifecycle 测试矩阵 |
| P1 | reconnect/reattach 协议不够显式 | 依赖轮询和同步按钮 | 增加 session resume endpoint 的事件回放 |
| P1 | 交付物与消息仍需强约束 | 文件卡可能缺失或预览失败 | artifact-first 存储协议 |
| P1 | 右侧栏/过程卡/消息卡职责仍重叠 | 用户不知道看哪里 | 主状态只留消息内任务卡，右侧做详情 |
| P2 | 运行事件没有统一 canonical event contract | 前后端事件映射膨胀 | 定义 OpenAtlas Run Event Schema |

## 推荐下一轮实施顺序

1. `runStateBySession`：替换全局 `isProcessing/streamAbortRef/activeHermesRunIdsRef`。
2. 后台审批待办：所有 approval/clarify 进入全局 pending queue。
3. 同 session 输入排队：实现 queued user message 和 run.queued UI。
4. Reattach endpoint：打开运行中会话自动返回 messages + isWorking + replay events。
5. 回归矩阵：切会话、刷新、断网、空 completed、迟到 artifact、二进制 docx。

## 结论

OpenAtlas 的企业模型、租户隔离、数字员工和交付物闭环比 Hermes Web UI 更偏企业平台；但 Hermes Web UI 在“run 生命周期属于 session”这件事上更成熟。OpenAtlas 下一阶段不要继续叠 UI，应该先把 session/run/approval/artifact 四个生命周期协议收紧。否则越多页面越容易出现“看起来卡死、实际后台在跑、卡片不见、切回来状态错”的体验裂缝。
