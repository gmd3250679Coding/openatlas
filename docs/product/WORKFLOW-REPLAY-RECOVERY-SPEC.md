# OpenAtlas Workflow Replay & Recovery Spec

> Version: 2026-06-17
> Scope: 协作画布、Hermes Run Events、长任务恢复、节点级回放与重放。

## 1. 背景

当前协作画布已经具备节点配置、保存为方案、执行回放、节点继续/重试入口。但现阶段的"从此继续/重试节点"主要是把续跑提示放回输入框, 本质仍依赖用户手动重新发起一轮会话。

下一阶段要把它升级为真正的工作流恢复执行器: 用户可以在回放画布中看清楚 Agent 每一步做了什么, 并从某个正确的对话状态恢复执行, 避免长任务失败后从头再来。

## 2. 产品目标

1. 看得清: 回放画布不仅展示节点状态, 还要展示 Agent 在节点内的每一步行为, 包括思考摘要、工具调用、审批、文件读写、交付物生成、错误和重试。
2. 找得到: 用户能快速定位"哪一步是正确的, 哪一步开始跑偏"。
3. 回得去: 用户能选择一个正确检查点, 让 Agent 从该状态继续、重试或分叉执行。
4. 不重头来: 上游已完成节点、已确认的工具结果、已生成的有效交付物应尽量复用。
5. 可审计: 所有回滚、重试、分叉、审批和人工修改都必须留下审计记录。

## 3. 核心概念

### 3.1 Step Event

Step Event 是节点内部的最小可回放事件, 来源包括 Hermes Run Events、OpenAtlas 文件/记忆/Skill 注入事件、审批事件和交付物事件。

建议事件类型:

- `reasoning.summary`: 模型思考摘要, 不展示不可公开的完整 chain-of-thought, 只展示可审计的高层计划和判断。
- `context.injected`: 注入的文件、记忆、Skill、系统提示、节点默认提示。
- `tool.started`: 工具调用开始, 记录工具名、参数摘要、风险等级。
- `tool.completed`: 工具调用完成, 记录输出摘要、耗时、产物路径。
- `tool.failed`: 工具调用失败, 记录错误、可恢复建议。
- `approval.required`: 需要人工确认的高危或不确定动作。
- `approval.resolved`: 用户批准、拒绝、仅本次允许、本会话允许等审批结果。
- `file.read`: 读取文件或片段。
- `file.write`: 写入文件。
- `artifact.created`: 生成交付物。
- `message.delta`: 模型回复增量摘要。
- `node.checkpoint`: 可恢复检查点。
- `node.completed`: 节点完成。
- `node.failed`: 节点失败。

### 3.2 Checkpoint

Checkpoint 是一个可以恢复执行的稳定状态。不是每个事件都能回滚, 只有满足以下条件的状态才应成为检查点:

- 上下文快照完整: 包括用户 Query、节点输入、上游节点输出、文件/记忆/Skill 注入清单。
- Hermes 状态可恢复: 有 Hermes session/run id 或可重建的消息上下文。
- 工具副作用可解释: 文件写入、外部调用、审批结果已记录。
- 交付物归属明确: 能区分保留、废弃、重新生成或创建新版本。

建议自动生成检查点:

- 节点开始前。
- 每次审批通过后。
- 每个工具调用完成后。
- 每个文件写入或交付物创建后。
- 节点完成后。
- 发生失败、停滞、超时前后的最近稳定点。

### 3.3 Replay Fork

当用户从历史检查点重新执行时, 系统不应直接覆盖原执行历史, 而应创建 Replay Fork:

- 原 workflow_run 保留为审计历史。
- 新 workflow_run 记录 `parent_run_id`、`forked_from_node_run_id`、`forked_from_checkpoint_id`。
- 复用检查点之前的上下文与上游节点输出。
- 检查点之后的节点状态标记为 `superseded` 或在新分支中重新生成。

## 4. 用户故事

### 4.1 看清 Agent 每一步做了什么

作为业务用户, 我打开协作执行回放后, 希望看到每个节点内部的时间线:

- Agent 先读了哪些文件。
- 注入了哪些记忆和 Skill。
- 调用了哪些工具。
- 哪些工具成功、失败或等待审批。
- 写了哪些文件。
- 生成了哪些交付物。
- 每一步用了多久、是否有错误、是否可以作为恢复点。

验收标准:

- 节点卡片可展开为 Step Timeline。
- 每个 Step 有类型、时间、状态、摘要、输入输出摘要和风险标识。
- 工具调用能看到参数摘要和结果摘要, 但敏感内容需要脱敏。
- 文件写入和交付物生成能直接跳转预览或下载。

### 4.2 从正确状态重新执行

作为重度用户, 当我发现 Agent 某一步开始跑偏时, 希望选择跑偏前的检查点重新执行, 而不是从头重新发起任务。

验收标准:

- Step Timeline 中可恢复的节点显示"从这里继续"。
- 用户点击后, 系统展示将被复用和将被重新执行的范围。
- 用户确认后创建 Replay Fork。
- 新执行从指定 checkpoint 恢复, 上游结果不重复执行。
- 原执行历史仍可查看。

### 4.3 节点重试

作为用户, 当某个员工节点失败时, 我希望只重试该节点, 并让后续节点基于新结果继续。

验收标准:

- 点击"重试节点"后, 当前节点进入 `queued`。
- 当前节点旧结果保留为历史版本。
- 该节点之后的依赖节点标记为 `invalidated` 或进入新分支待执行。
- 重试成功后, 后续节点自动继续。
- 交付物新版本要保留和旧版本的关联。

### 4.4 节点继续

作为用户, 当长任务因超时、断流、审批或工具卡住中断时, 我希望从最近稳定状态继续。

验收标准:

- 系统自动推荐最近可恢复 checkpoint。
- 用户可选择"继续等待"、"从最近检查点继续"、"从节点开头重试"。
- 如果 Hermes run 仍可恢复, 优先续接原 run events。
- 如果 Hermes run 已不可恢复, 使用 checkpoint 重建上下文并发起 continuation run。

## 5. 前端设计要求

### 5.1 回放画布

回放画布应从"节点摘要列表"升级为"节点 + 时间线 + 检查点"三层结构:

1. 第一层: 协作流程图, 显示节点状态、依赖、耗时、交付物数量。
2. 第二层: 点击节点展开 Step Timeline。
3. 第三层: 点击 Step 查看详情, 包括上下文、工具输入输出、文件、产物和审批。

节点状态建议:

- `pending`: 待执行。
- `running`: 执行中。
- `waiting_approval`: 等待审批。
- `waiting_input`: 等待用户补充。
- `stalled`: 长时间无事件。
- `completed`: 已完成。
- `failed`: 失败。
- `invalidated`: 上游重跑后已失效。
- `superseded`: 被新分支替代。

### 5.2 Step Timeline 交互

每个 Step 需要支持:

- 展开/收起详情。
- 复制摘要。
- 查看原始事件 JSON, 仅管理员或调试模式可见。
- 查看关联文件或交付物。
- 对可恢复检查点执行"从这里继续"。
- 对失败工具执行"重试此工具"或"跳过并继续", 具体取决于风险策略。

### 5.3 恢复确认弹窗

用户点击"从这里继续"后, 必须显示确认弹窗:

- 恢复点: 节点名、Step 类型、时间。
- 将复用: 上游节点、文件、记忆、Skill、已批准审批。
- 将重新执行: 当前 Step 之后的工具调用、节点、交付物。
- 可能影响: 哪些交付物会生成新版本, 哪些旧交付物会被标为 superseded。
- 风险: 是否包含外部副作用, 是否需要重新审批。

确认动作:

- `创建分支并继续`
- `仅生成续跑提示`
- `取消`

## 6. 后端设计要求

### 6.1 数据模型扩展

建议新增或扩展:

```text
workflow_step_events
- id
- tenant_id
- session_id
- workflow_run_id
- workflow_node_run_id
- employee_id
- event_type
- status
- title
- summary
- input_summary
- output_summary
- raw_event_ref
- payload_json
- risk_level
- tool_name
- artifact_ids
- file_ids
- created_at

workflow_checkpoints
- id
- tenant_id
- session_id
- workflow_run_id
- workflow_node_run_id
- step_event_id
- checkpoint_type
- context_snapshot_json
- hermes_session_id
- hermes_run_id
- upstream_node_outputs_json
- artifact_policy_json
- created_at

workflow_run_forks
- id
- tenant_id
- parent_workflow_run_id
- child_workflow_run_id
- forked_from_node_run_id
- forked_from_checkpoint_id
- reason
- created_by
- created_at
```

### 6.2 执行器接口

建议新增接口:

```text
GET /api/sessions/{sid}/workflow-runs/{run_id}/timeline
POST /api/sessions/{sid}/workflow-checkpoints/{checkpoint_id}/resume
POST /api/sessions/{sid}/workflow-nodes/{node_run_id}/retry
POST /api/sessions/{sid}/workflow-steps/{step_event_id}/retry
POST /api/sessions/{sid}/workflow-runs/{run_id}/fork
```

当前已有的 `POST /api/sessions/{sid}/workflow-nodes/{node_run_id}/action` 可以保留, 但应逐步从"生成续跑提示"升级为调用真实执行器。

### 6.3 恢复执行策略

恢复执行器需要支持:

- 从节点开头重试。
- 从节点内某个 checkpoint 继续。
- 从工具失败点重试工具。
- 跳过失败工具继续节点。
- 从已完成节点之后继续下游。
- 生成新分支, 不覆盖旧历史。

执行时必须:

- 重建 system prompt、节点提示、Skill、记忆、文件上下文。
- 注入上游节点输出。
- 复用已批准审批结果, 但对高风险外部副作用重新确认。
- 将所有新事件继续写入 Step Timeline。
- 将新交付物写入 artifact version。

## 7. Hermes 集成要求

1. Run Events 要映射为 Step Event, 保留 Hermes 原始 event id 或 sequence。
2. 审批事件必须成为可视化 Step, 并能驱动 workflow 状态进入 `waiting_approval`。
3. 工具调用事件要区分只读、写文件、外部副作用和高风险动作。
4. 60 秒无新事件不直接判失败, 应进入 `stalled`, 后台 watcher 继续补同步。
5. 如果 Hermes session/run 可继续, 优先续接原 run; 如果不可继续, 用 checkpoint 重建上下文。

## 8. 审计与权限

- 普通用户只能恢复自己的会话和自己的 workflow run。
- 管理员可以查看租户内回放, 但原始 payload 中的敏感字段需要脱敏。
- 所有 resume、retry、fork、skip、approval 操作写入审计日志。
- 有外部副作用的工具调用不得静默重放, 必须重新审批或明确标记为只读可复用。

## 9. 验收清单

P0:

- 回放画布能展示节点内 Step Timeline。
- Step Timeline 至少覆盖 reasoning summary、context injected、tool started/completed/failed、artifact created、node completed/failed。
- 支持从节点 checkpoint 创建 Replay Fork 并继续执行。
- 支持节点级重试并使下游节点重新执行。
- 60 秒无事件进入 stalled, 不误报任务彻底失败。

P1:

- 支持工具级重试/跳过。
- 支持恢复确认弹窗展示影响范围。
- 支持交付物 superseded/final/version 关系。
- 支持管理员查看原始事件 JSON。

P2:

- 支持并行节点合流后的局部重放。
- 支持变量映射和节点输入输出契约校验。
- 支持对比两个 Replay Fork 的输出差异。

## 10. 非目标

- 不展示完整模型私密思维链, 只展示可审计的思考摘要和行动计划。
- 不对已经产生外部副作用的动作做无提示自动重放。
- 不要求第一阶段支持复杂 DAG 的所有并行/合流恢复, 先完成线性接力和单节点重试。
