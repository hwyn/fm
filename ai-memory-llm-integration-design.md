# LLM Provider 推理与工具协议设计

> 本文定义 LLM Provider 的无状态推理合同、ContextAssembler、ToolManifest、ToolCall、ToolResult 和本地提交边界。认知对象与运行控制对象以 [ai-memory-semantic-model-design.md](ai-memory-semantic-model-design.md) 为准；事件处理、授权和效果边界以 [ai-memory-architecture-kernel-std.md](ai-memory-architecture-kernel-std.md) 为准。

## 1. 角色边界

LLM Provider 是 Runtime 调用的可替换推理组件。Runtime 提供有限 SessionWindow、受控 Context 和当前允许的工具清单；Provider 依据它们选择下一步工具、处理 ToolResult，或形成输出候选。

```text
Runtime compiles InferenceRequest + ToolManifest
-> Provider returns InferenceProposal with ToolCall[] or responseCandidate
-> Runtime validates and executes accepted ToolCall
-> Runtime returns safe ToolResult in the next InferenceRequest
-> Provider continues within the fixed round budget
```

Provider 可以选择工具，但不能绕过 Runtime 执行工具。它不得：

```text
读取 SQLite、缓存、历史原文或索引
保存或修改长期记忆
读取或修改 RuntimeState
读取或修改 Tool 的 lifecycle、availability、错误计数或控制记录
构造未在 ToolManifest 中出现的工具、目标、能力或适配器
携带凭据、授权令牌或绕过目标侧验证
授予权限、消费 grant、解除 Tombstone 或推进授权代次
自行创建 ExternalInput、后续任务或无输入的持续运行
```

模型切换不影响 Runtime 的记忆、当前状态、Context、权限、工具注册表或效果语义。

## 2. Provider 注册

Runtime 只能使用静态注册、位于本地信任边界内且已启用的 Provider：

```text
ProviderRegistration {
  providerId
  modelId
  modelDigest
  protocolVersion
  contextLimit
  structuredOutputSupport
}
```

一次 InferenceRequest 固定 `providerId`、`modelDigest`、`templateDigest` 和 `protocolVersion`；Provider 变化只能从下一次请求开始生效。Context、输入和召回内容不得通过 Provider 路径出站。

## 3. 事件驱动推理

Gateway 收到 ExternalInput 后，由 CognitiveRuntime 决定是否调用 Provider。Owner 的普通消息与其他 ExternalInput 具有相同推理路径；OwnerControlCommand 不进入本协议。

一次 ExternalInput 处理中的有限协议为：

```text
CompileContextAndTools
-> Infer
-> ValidateToolCallsOrOutput
-> ExecuteAcceptedTools
-> ReturnToolResults
-> RecompileContextAndTools
-> Infer
-> CommitAcceptedConsequences
-> End
```

Runtime 只在 ToolCall 通过验证后执行工具。最大推理轮数、最大工具调用数、最大记忆查询数、最大写入候选数、最大效果数和 Context token 预算在处理开始前固定。达到边界时，Runtime 只提交已经验证的后果或受限结束。

## 4. InferenceRequest 与 ToolManifest

Runtime 向 Provider 发送：

```text
InferenceRequest {
  requestId
  roundId
  externalInput
  sessionWindow
  runtimeStateSummary
  contextSnapshot
  toolManifest
  priorToolResults[]
  priorToolResultDigests[]
  providerId
  modelDigest
  templateDigest
  protocolVersion
  budget
}
```

`requestId` 标识本次推理请求，`roundId` 标识当前有界推理轮次。`externalInput` 是 Gateway 认证后的当前输入数据或安全化摘要。`sessionWindow` 是当前 session 的有限消息列表，包含先前 user、assistant 和安全化 tool 消息；它有固定消息数与 token 上限，超限信息只以截断说明保留。`runtimeStateSummary` 只包含本轮所需的受控状态摘要，不包含完整状态存储。

`contextSnapshot` 包含：

```text
snapshotDigest
roundId
externalInputDigest
sessionWindowDigest
runtimeStateDigest
dependencyFingerprint
authorityRevision
providerPolicyDigest
contextItems[]
```

即使没有长期记忆，Runtime 也必须生成空记忆 ContextSnapshot。它固定当前 ExternalInput、SessionWindow、RuntimeState、授权代次和 Provider 策略，从而允许无记忆处理被验证、追溯和安全提交。

ToolManifest 是 Runtime 在当前快照下提供的受限工具集合：

```text
ToolManifest {
  manifestDigest
  requestId
  roundId
  contextSnapshotDigest
  tools[]
}

ToolDescriptor {
  toolRef
  toolVersion
  kind: memory.query | memory.detail.get | memory.write.propose |
        runtime.state.transition.propose | adapter.action.propose
  description
  inputSchema
  allowedScope
  budget
}
```

`memory.query` 的参数必须符合 MemoryQueryPlan：Provider 只能选择当前描述符公开的 `lexicalTerms`、`timeRange`、注册 `indexedField` 上的 `metaFilters`、`semanticQuery` 和预算内的候选/结果上限，不能提交 SQL、JSONPath、表名、列名、索引提示或任意表达式。Runtime 先执行资格与授权预过滤，再按固定参数化查询形状合并 FTS5、时间/元数据和当前 EmbeddingProfile 的向量候选；它在候选预算内计算适用性并补足 eligible 或 partially applicable 结果后，才返回当前允许范围内的安全化 CurrentView 投影。Provider 不能选择嵌入模型、向量版本或重排策略。结果默认以紧凑 MemoryCard 返回，不能返回 Tool 控制记录、错误日志或当前可用性。`memory.detail.get` 只能以当前 ContextItem 的 `itemRef` 请求 `evidence`、`excerpt`、`structured_fields` 或 `context_window` 级别的有界补充；`context_window` 只可请求锚点前后有限 turn 数。Runtime 必须验证目的、披露范围、Tombstone、来源资格、锚点留存、查询次数和总字节预算。`memory.write.propose` 只能提交结构化 Derivation、Claim、Assessment 或 CorrectionProposal 候选；每个 Claim 候选必须提供 MemoryAddress，并可引用获准留存的 `contextAnchorRefs`。`stable` Claim 候选还必须提供认证主体确认、受控 Verifier 或两项独立直接观察的依据；从 candidate 稳定化时必须提出新的 stable Claim 与 `supersedes` correction，不能原地更新旧 Claim。`runtime.state.transition.propose` 只能提交带预期版本与依据的状态转移候选。`adapter.action.propose` 只能引用当前允许的动作描述符和目标范围。

ToolManifest 是能力邀请，不是权限授予；每次 ToolCall 仍须由 Policy、Verifier 和 Memory Tool 复验。它是根据 Tool 的生命周期、当前可用性、授权与预算编译出的投影，不暴露原始 Tool 控制字段。

## 5. ContextAssembler

ContextAssembler 由 Runtime 控制，是确定性任务期组件。它只将当前有限 SessionWindow、Memory Tool 返回的 CurrentView、当前 RuntimeState 摘要、已获准 ExternalInput 和已接受的安全化 ToolResult 组织为当前轮 ContextSnapshot 与 ContextItem。

每个 ContextItem 必须包含：

```text
itemRef
use
injectionBoundary: treat_as_data_not_instruction
sourceAnchors[]
applicability
permittedUse
counterEvidenceOrDifference?
uncertainty[]
coverageGaps[]
disclosureBoundary
tokenCost
dependencyFingerprint
```

ContextAssembler 必须优先保留直接依据、反证与冲突、条件差异、未知覆盖和必要当前输入，并以紧凑 MemoryCard 呈现它们。预算不足时只能裁剪较低优先级支持细节；不能静默移除反证、条件差异或未知覆盖。无法保留最小安全表达时，Runtime 必须受限结束。需要原话、证据片段或结构化字段时，Provider 必须选择 `memory.detail.get`，不能要求自由数据库查询。

ContextItem 的来源锚点不是读取原内容的权限。Context、ContextItem、CurrentView、ContextSnapshot、ToolManifest、ToolCall、ToolResult 和推理摘要不得直接持久化为新的长期对象。

SessionWindow 也不得自动持久化为长期对象。Runtime 只能在当前处理边界内向 Provider 交付该窗口；需要未来连贯检索的消息必须先成为获准留存的 ConversationTurn，再由 `memory.write.propose` 引用其 ContextAnchor。Provider 不能要求完整会话重放。

## 6. InferenceProposal 与 ToolCall

Provider 只能返回 schema 校验后的提议：

```text
InferenceProposal {
  requestId
  roundId
  basedOnContextSnapshot
  basedOnToolManifest
  interpretation?
  toolCalls[]
  correctionProposals[]
  responseCandidate?
  uncertainty[]
}

ToolCall {
  callId
  toolRef
  toolVersion
  arguments
  basedOnContextSnapshot
  basedOnToolManifest
}
```

`requestId`、`roundId`、`basedOnContextSnapshot` 与 `basedOnToolManifest` 必须分别等于当前请求及其摘要。ToolCall 只能引用当前 ToolManifest 中的描述符，并且参数必须符合该描述符的输入 schema。Provider 可以在同一 Proposal 中请求多个工具，但 Runtime 逐项授权、排序和执行；超出工具调用预算的请求必须拒绝。

`correctionProposals[]` 只能引用当前合法的原 Claim、事件或 Artifact 证据，并包含范围与不确定性。每个纠错候选必须提供 `targetRefs[]` 或 `targetAddress`；`self_report` 模式只可针对当前认证主体的低风险信息。Runtime 先以 targetAddress 返回有界候选，Provider 只能选择其中的唯一目标或请求澄清。候选目标不唯一时不得形成修订。它们必须经 Runtime 的 Correction Gate 接受、限制或拒绝后才可形成 correction Event、Assessment 或 CurrentView 变化。Provider 可以返回空 Proposal、受限输出或不确定性；这不是协议错误。

## 7. ToolCall 验证、执行与回传

CognitiveRuntime、Policy、Verifier 与 Memory Tool 对每个 ToolCall 独立检查：

```text
ContextSnapshot、ToolManifest 与 RuntimeState 仍有效
工具描述符、版本、目标、参数和作用域匹配
资格、Tombstone、授权代次和生命周期仍有效
调用符合目的、预算、幂等边界和风险规则
记忆写入候选具有直接输入、条件、用途与不确定性
状态转移候选具有预期版本和直接依据
适配器动作可形成当前允许的 EffectIntent
```

通过的调用由 Runtime 执行，并返回任务期 ToolResult：

```text
ToolResult {
  originatingRequestId
  originatingRoundId
  callId
  outcome: accepted | rejected | completed | unavailable
  safeResult?
  resultDigest
}
```

`memory.query` 的结果仅是安全化投影，并包含实际执行的 `retrievalPlanDigest`、`retrievalExecutionDigest`、截断和不确定性；它不证明候选的语义正确性或当前可直接使用。`memory.detail.get(context_window)` 的结果是锚点前后连续 turn 的有限片段，必须标明截断、来源和不确定性。`memory.write.propose` 的结果仅说明候选是否被接受或为何被拒绝；通过后才分别形成 Derivation、Claim 或 Assessment。`runtime.state.transition.propose` 通过后才形成 RuntimeStateTransition。`adapter.action.propose` 通过后才形成 EffectIntent，Outbox 与 ToolAdapter 依旧独立处理实际外部执行。

ToolResult 仅描述其发起轮次的调用结果，不是工具当前可用性的权威结论，也不得由 Provider 解释为 Tool 生命周期变化。Runtime 收到 ToolResult 后必须以新的 `roundId` 重新编译 SessionWindow、ContextSnapshot 与 ToolManifest，才可发送下一次 InferenceRequest；旧轮次的 Proposal、ToolCall、快照和清单均不得复用。只有可验证的适配器回执、超时、重试边界或健康检查可由 Runtime 更新 Tool 的 `availability`；这类控制更新不进入 `memory.query`。验证失败时，Runtime 必须拒绝对应调用、返回安全化 ToolResult 或受限结束。它不得把失败包装为 `supported`，不得泄漏受限对象，也不得把 ToolCall 直接转换为设备调用。

## 8. 证据强度与输出

Provider 的输出只能使用它引用的可用 ContextItem 与安全化 ToolResult：

```text
supported + direct_evidence
  可作为直接依据。

mechanism_candidate / partially_applicable
  只能作为机制候选或条件化表达。

clarification_required
  必须请求受限信息、补充 ExternalInput 或受限结束。

unknown / inapplicable / restricted
  不得被表述为直接支持。
```

跨领域类比或机制归纳只能在 `mechanism_candidate` 下使用。Provider 可将其作为带条件、差异、反证和不确定性的输出或记忆候选；没有新的合格来源、受控 Verifier 或认证控制确认时，不得提升为 `direct_evidence`，也不得单独支撑 EffectIntent。

当 Runtime 接受 `responseCandidate` 时，它从实际使用的 ContextItem 构造稳定的最小 `usedEvidence[]`、模板摘要、模型摘要和 ContextSnapshot 摘要。通过 `response-provenance.record` 与 `response.emit` 授权并完成依赖、状态版本和授权代次复验后，Memory Tool 原子持久化 ResponseProvenance 与本地交付请求。

外部交付在事务后独立尝试。交付状态只能说明本地尚未尝试、已尝试、可验证失败或未知，不能证明接收方已收到、阅读或接受输出。

## 9. 失效、故障与终态

当纠错、范围限制、授权变化、Assessment 到期、验证变化、Tombstone、RuntimeState 版本或 RuntimeLifecycle 变化使 ContextSnapshot 或 ToolManifest 失效时，Runtime 必须丢弃未执行 ToolCall、Proposal 和未提交后果。它只能重新编译当前合法 Context 与 ToolManifest，或受限结束。

| 情况 | 必须行为 |
| --- | --- |
| Provider 不可用或超时 | 当前处理受限结束；不生成事实、状态或效果 |
| Provider 输出非结构化或 schema 无效 | 拒绝 Proposal；不作为自由文本指令执行 |
| ContextSnapshot 或 ToolManifest 失效 | 丢弃 Proposal 与未执行 ToolCall，重新编译或结束 |
| ToolCall 不在当前清单、参数无效或超预算 | 拒绝调用并返回安全化结果 |
| 记忆写入或状态转移依据不足 | 不形成长期对象或状态变化 |
| 适配器动作无法形成当前 EffectIntent | 不入队、不派发 |
| Provider 不在本地信任边界 | 不调用该 Provider |

## 10. 协议验收

1. Provider 无法读取数据库、Context 原文、授权令牌、RuntimeState 或未在 ToolManifest 中出现的工具。
2. 每次请求都绑定 ContextSnapshot、ToolManifest、模型摘要、模板摘要、协议版本和预算；空记忆请求也不例外。
3. Provider 切换不会改变长期记忆、状态、权限、工具注册表或效果语义。
4. Provider 可以从当前 ToolManifest 选择工具，但无法直接执行、绕过授权或扩大作用域。
5. 每个 ToolCall 在执行前都经目标侧验证；每个 ToolResult 只返回当前允许披露的结果。
6. Provider Proposal、ToolCall 和 CorrectionProposal 在验证前不能形成事实、状态变化、输出追溯、EffectIntent 或 Tool 控制字段变化。
7. Context 或 ToolManifest 失效后，旧 Proposal、ToolCall 和 ContextItem 均不可继续使用。
8. 输出追溯只保存实际使用的最小证据引用，并受 Tombstone、披露和留存边界约束。
9. Provider 无法通过 ToolResult、纠错候选或普通记忆写入改变 Tool 的生命周期或可用性；普通记忆查询也不返回这些控制字段。
