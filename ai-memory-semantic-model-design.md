# AI 持续认知 Runtime 语义模型

> 本文是 Source、SourceCapture、Event、Artifact、Derivation、Claim、ApplicabilityAssessment、CurrentView、ContextItem、RuntimeState、效果控制记录与 ResponseProvenance 的唯一规范性来源。

## 1. 语义边界

系统的长期认知链为：

```text
Source -> SourceCapture -> Event / Artifact -> Derivation
-> Claim -> ApplicabilityAssessment -> CurrentView
-> ContextItem / ResponseProvenance
```

Runtime 是该链、当前运行状态和 Context 编译的唯一边界。Owner、其他人、平台、ToolAdapter 与 LLM Provider 都是 Runtime 外部的身份、输入或能力边界；Owner 只在认证控制操作中拥有更高权限。

长期数据分为三类：

```text
认知对象：来源、观察、内容、派生、结论、适用性与纠错依据
运行控制对象：状态版本、授权代次、Tool、效果意图、Outbox、尝试和回执
任务期数据：SessionWindow、CurrentView、ContextItem、ContextSnapshot、InferenceRequest、InferenceProposal
```

任务期数据可丢弃和重建。它们不能独立成为长期事实、读取权限或效果依据。LLM Provider 的输出在被 Runtime 接受前只属于任务期数据。

## 2. 通用不变量

1. 所有长期写入由 Memory Tool 在目标侧校验后提交。
2. Event、Artifact、Derivation、Claim、Assessment、纠错记录、状态版本、效果意图和回执均不可原地改写。
3. Tombstone 优先于来源资格、派生资格、Assessment、CurrentView、Context、状态引用和效果执行。
4. 资格、限制和授权的当前代次必须在读取、推理、状态提交、输出提交、效果入队和执行前比较。
5. 未知不满足正向支持；LLM Provider 的候选不能单独认证来源、语义或效果结果。
6. 任何外部输入、输出或效果都必须有稳定关联键、幂等边界和最小追溯锚点。

## 3. 来源、捕获与观察

### 3.1 Source

Source 是静态注册、可识别且受 Policy 管理的输入边界：

```text
Source {
  sourceId
  sourceKind
  originIdentity
  adapterRef?
  ingressProfile?
  verifierRef?
  allowedPurposes[]
  retentionBoundary
}
```

```text
IngressProfile {
  mode: exact | sample | batch | threshold | deduplicate
  window?
  maxEvents?
  thresholdRules?
  summarySchema?
  retainRaw: never | bounded | on_anomaly
}
```

`originIdentity` 可以标识 Owner 交互边界、其他人、文件、仓库、服务端点、平台通道、工具回执或外部定时资源。`ingressProfile` 是 Source 或 ToolAdapter 的静态接入配置；它只约束高频输入如何采样、聚合或丢弃，不能由 LLM Provider 临时改变。错误、状态跃迁、控制操作和高风险回执必须以 `exact` 方式进入。Source 不是权限、事实或状态修改本身。

### 3.2 SourceRestriction

SourceRestriction 是 Policy 在 `source.restrict` 授权下创建的治理记录：

```text
SourceRestriction {
  restrictionId
  sourceRef
  action: impose | revoke
  scope
  reasonEvidenceRefs[]
  targetRestrictionRef?
  effectiveAt
  qualificationRevision
  governanceBindingRef
}
```

`scope` 只可引用可检查的时间、版本、路径、稳定对象或捕获范围。`impose` 推进该 Source 与 scope 的当前资格代次；匹配对象在下一次读取或使用时被判定为 `restricted`。`revoke` 必须精确引用同一 Source 的既有 `impose`。安全性只依赖使用时的当前资格判定，索引刷新只负责按批次重建投影。

### 3.3 Tombstone

Tombstone 是认证控制操作在 `tombstone.apply` 授权下创建的不可逆治理记录：

```text
Tombstone {
  tombstoneId
  targetRefs[]?
  scope?
  reasonEvidenceRefs[]
  effectiveAt
  authorityRevision
  governanceBindingRef
}
```

`targetRefs[]` 与 `scope` 至少存在其一。目标可指向 Source、SourceCapture、Event、Artifact、ConversationSession、ConversationTurn、ContextAnchor、Derivation、Claim、ApplicabilityAssessment、RuntimeStateTransition、ResponseProvenance 或未尝试 EffectIntent；`scope` 只可使用可检查的来源、时间、路径、稳定对象或捕获范围。Tombstone 在提交时立即推进当前资格和授权代次，并阻断所有匹配对象及其派生使用、状态引用、投影、Context、输出追溯与未尝试效果。物理清理、备份清理和索引更新不影响该逻辑阻断。

### 3.4 SourceCapture、Event 与 Artifact

```text
SourceCapture {
  captureId
  sourceRef
  capturedAt
  purpose
  originRevision?
  integrityDigest
  governanceBindingRef
}

Event {
  eventId
  captureRef
  eventKind: observation | correction | outcome
  occurredAt
  observedConditions[]
  aggregation?
  relatedToolRefs[]?
  payloadDigest
  correctionTargets[]?
  correctionKind?
  replacementRefs[]?
  correctionScope?
}

Artifact {
  artifactId
  captureRef
  mediaType
  contentDigest
  controlledLocation
  byteLength
}
```

```text
ConversationSession {
  sessionRef
  sourceRef
  retentionBoundary
  openedAt
  closedAt?
}

ConversationTurn {
  turnRef
  sessionRef
  sequence
  role: user | assistant | tool
  contentRef
  contentDigest
  capturedAt
}
```

ConversationSession 与 ConversationTurn 是可选的长期来源对象，不是 SessionWindow 的自动镜像。只有当前 Source、目的、留存与披露规则允许时，Memory Tool 才可持久化有序 turn；`contentRef` 必须指向受控 Artifact、本地输出或安全化工具结果。Turn 不复制完整会话；其 `sequence` 只用于在需要时恢复一个有界的连续窗口。

`aggregation` 在输入经 IngressProfile 归约时记录 `mode`、`window`、`sourceEventCount`、`discardedCount?` 与 `summarySchema?`。它说明 Event 是有损摘要，不将摘要伪装成逐条原始观察。

Event 是不可变观察。Artifact 是受控内容引用；它不扩大内容采集、披露或派生资格。`observedConditions[]` 只记录捕获时可验证的事实。

Owner 的普通消息与其他输入一样只能形成 SourceCapture 或任务期输入。认证的 Owner 控制操作可产生治理记录，但不因身份直接认证普通观察或 Claim。

### 3.4 Correction Event

`eventKind = correction` 必须由受控 SourceCapture、认证控制操作，或 Runtime 接受的 CorrectionProposal 创建，带有精确目标、可披露依据和可检查范围。目标只能指向 Source、SourceCapture、Event、Artifact、Derivation、Claim 或 ApplicabilityAssessment。

```text
invalidates
  在 correctionScope 内使目标及其依赖不得作为直接依据；历史对象仍可解释。

supersedes
  必须提供 replacementRefs[]；在 correctionScope 内，投影优先使用替代对象，
  被替代对象保留为历史和冲突说明，不能静默删除。

narrows_scope
  必须提供 correctionScope；目标保留，但该范围成为明确不适用条件。
```

三种纠错都会推进受影响资格代次。Tombstone 仍优先于任何纠错或替代。没有精确目标、依据或范围的反馈只能作为当前输入，不得改变长期资格。

LLM Provider 只能提出任务期 CorrectionProposal，不能创建 correction Event 或自行改变 CurrentView：

```text
CorrectionProposal {
  proposalDigest
  targetRefs[]
  targetAddress?
  correctionMode: self_report | evidence_update
  correctionKind: invalidates | supersedes | narrows_scope
  evidenceRefs[]
  correctionScope?
  replacementRefs[]?
  uncertainty[]
  basedOnContextSnapshot
}

CorrectionDecision {
  decisionId
  proposalDigest
  decision: accepted | restricted | rejected
  evidenceRefs[]
  policyDigest
  authorityRevision
  acceptedEventRef?
}
```

Runtime 的 Correction Gate 必须在创建 correction Event 前检查目标、目标地址、证据谱系、范围、反证、当前资格、Tombstone、授权代次与预算。`self_report` 只适用于认证主体对自身低风险信息的直接更正；当 targetAddress 不能唯一定位目标时，Runtime 只能记录冲突候选或要求澄清，不能任意修订历史对象。它可接受、缩小范围或拒绝候选；不能把一次 Provider 推理直接视为纠错事实。CorrectionDecision 是运行控制审计记录，不是可由 `memory.query` 召回的认知结论。

## 4. 派生、Claim 与条件

### 4.1 Derivation

```text
Derivation {
  derivationId
  outputRef
  inputRefs[]
  transformerRef
  transformerVersion
  transformKind
  inputDigest
  governanceBindingRef
}
```

`inputRefs[]` 只能引用当前获准的 Event、Artifact 或已获准 Derivation。每个 Derivation 的输入数量、总输入字节与最大派生深度必须受 Runtime 配置的硬上限约束；超限时拒绝持久化或要求分段形成独立派生。Memory Tool 维护反向依赖索引，但单次刷新也必须受最大扇出和批次大小限制。

Derivation 只陈述转换发生过及其直接输入；它不认证输出语义，也不把共享 SourceCapture 伪装为独立支持。

### 4.2 Claim

Claim 是唯一长期结论对象：

```text
Claim {
  claimId
  derivationRef
  statement
  claimKind
  memoryAddress
  contextAnchorRefs[]?
  maturity: candidate | stable
  createdAt
  governanceBindingRef
}
```

```text
MemoryAddress {
  subjectRef?
  facet
  timeScope?
  objectRef?
}

ContextAnchor {
  anchorRef
  sessionRef
  anchorTurnRef
  turnRange: { startSequence, endSequence }
  sourceRefs[]
  createdAt
  governanceBindingRef
}
```

`anchorTurnRef` 必须指向 `sessionRef` 中的 ConversationTurn，且其 `sequence` 必须位于 `turnRange` 的闭区间；`startSequence <= endSequence`。详情展开只能读取同一 `sessionRef` 中该闭区间内连续存在的 turn，任一引用、序号或来源资格不匹配即拒绝锚点创建或返回不可用。

Claim 不含全局 `truth`、可原地修改的结论状态或无限期适用承诺。每个 Claim 必须有 `memoryAddress`；`facet` 区分其可纠错的方面，其他字段可为空以表示无主体、无对象或无时间范围的结论。Runtime 以该地址缩小检索及纠错候选；`contextAnchorRefs` 只引用获准留存的 ConversationTurn 局部窗口。ContextAnchor 是独立、不可变且可被 Tombstone 的治理对象。留存清理可移除其内容与索引，但必须保留不可解析的 `anchorRef` 记录，不能改写引用它的 Claim。

`maturity` 表示创建时的召回优先级而非真值：`candidate` 是可冲突、可快速修订的低风险记忆；`stable` 只能由认证主体确认、受控 Verifier，或至少两项独立直接观察支持。独立观察必须来自不同的 SourceCapture，且它们的直接输入与派生谱系不能相互包含或仅共同依赖同一 Capture。Claim 不原地改变 maturity；将 candidate 稳定化时，Memory Tool 必须以新的 `stable` Claim 和 `supersedes` correction 保留旧 Claim、直接依据和晋升原因。两者的当前可用性仍只由来源资格、Tombstone、条件与 ApplicabilityAssessment 决定。

### 4.3 Condition 与 ApplicabilityAssessment

Condition 使用固定维度与类型：

```text
time_range
subject_ref
memory_facet
source_identity
origin_revision
repository
branch
path
runtime
language_version
api_version
controller_confirmed_scope
stable_object_ref
```

运算符仅为：

```text
equals | not_equals | in | not_in | before | after | between
version_lt | version_lte | version_gt | version_gte | matches_stable_ref
```

ConditionGroup 内按 AND 计算，ConditionGroup 数组按 OR 计算。`verificationMode` 只能为 `machine_checkable` 或 `controller_confirmed`。未知不满足正向支持。

```text
ApplicabilityAssessment {
  assessmentId
  claimRef
  basisRefs[]
  supportedWhen[]
  inapplicableWhen[]
  permittedUse: direct_evidence | mechanism_candidate |
                clarification_required | do_not_use
  assessedAt
  effectiveFrom?
  effectiveUntil?
  retrievalConfidence?
  lastConfirmedAt?
  governanceBindingRef
}
```

`basisRefs[]` 必须引用合格的 Event、Artifact 或验证结果。`supportedWhen` 只能由明确来源、受控 Verifier 或认证控制确认建立；LLM Provider 候选不能单独形成正向支持。

`retrievalConfidence` 仅用于 CurrentView 的排序、摘要优先级与 Context 纳入选择；`lastConfirmedAt` 支持新鲜度判断。两者不授予读取权限、不覆盖 Tombstone 或适用性、不决定 Tool 生命周期，也不能单独作为状态变化或外部效果的依据。

跨领域比较或机制归纳可由 LLM Provider 提出，并在来源、条件、差异、反证与不确定性可追溯时持久化为 `mechanism_candidate`。它不能仅凭 Provider 推理获得 `direct_evidence` 用途，也不能单独成为外部效果的直接依据；提升用途必须有新的合格来源、受控 Verifier 或认证控制确认。

## 5. 当前投影与任务期 Context

### 5.0 MemoryQueryPlan

MemoryQueryPlan 是 Provider 或 Runtime 为一次记忆查询提出的受限候选定位计划，不是 SQL、数据库权限或适用性结论：

```text
MemoryQueryPlan {
  planDigest
  lexicalTerms[]?
  timeRange?
  metaFilters[]?
  semanticQuery?
  candidateLimit
  resultLimit
}

MetaFilter {
  indexedField
  operator: equals | in | before | after | between
  value
}

EmbeddingProfile {
  embeddingProfileRef
  modelDigest
  dimension
  normalizationDigest
}
```

`indexedField` 只能是 Runtime 注册的稳定字段或 `meta_json` 生成列，不能是任意 JSONPath、表名、列名或表达式。`candidateLimit` 与 `resultLimit` 必须受当前 Tool budget 的硬上限约束。Runtime 将计划编译为固定的参数化查询形状：先执行身份、目的、来源、Tombstone、留存、授权与资格预过滤，再使用时间和元数据硬过滤、FTS5 词法候选与当前 EmbeddingProfile 的向量语义候选合并，并以确定性本地规则排序。Provider 不选择 EmbeddingProfile；Runtime 负责将 `semanticQuery` 编码为向量。不同 `embeddingProfileRef`、`modelDigest`、维度或归一化规则的向量不得混合比较；过期或不匹配的向量只能重建或跳过，查询退回可用的词法、时间和元数据路径。

Runtime 按排序顺序计算候选的派生与适用性，并在 `candidateLimit` 内有界补足，直至取得 `resultLimit` 个 eligible 或 partially applicable 结果，或候选耗尽。inapplicable、unknown 与 restricted 候选不能占用该结果上限，只能作为必要的反证、冲突或未知覆盖保留。词法、时间、元数据与向量都只影响候选定位和相关性排序；它们不授予读取权限、不证明 Claim 为真，也不替代 ApplicabilityAssessment。

Provider 不能提交或执行自由 SQL，不能指定索引实现，不能扩大过滤字段集合，也不能将候选排序直接提升为 `direct_evidence`。Runtime 可拒绝、收紧或替换超预算、字段不允许、范围不完整或无效的计划，并只将当前合法的结果投影为 MemoryCard。

### 5.1 CurrentView

CurrentView 是一次处理时的可丢弃投影：

```text
CurrentView {
  queryRef
  retrievalPlanDigest
  retrievalExecutionDigest
  situationFrame
  dependencyFingerprint
  eligibleClaims[]
  partiallyApplicableClaims[]
  excludedClaims[]
  evidenceRefs[]
  uncertainty[]
  coverageGaps[]
  truncationNotice?
}
```

`retrievalExecutionDigest` 绑定实际使用的 EmbeddingProfile、索引修订与重排策略版本。查询先按当前 Runtime 身份、目的、来源、Tombstone、时间、稳定引用、资格代次和授权代次缩小候选，再按 MemoryQueryPlan 的受限混合检索与确定性重排产生有界候选，并在候选预算内计算派生与适用性、补足可用结果。不得扫描完整历史、展开无界依赖、执行自由 SQL 或执行自由文本条件推理。

### 5.2 SessionWindow

SessionWindow 是进入一次推理的有限消息列表，不是 ConversationSession 的自动持久化镜像：

```text
SessionWindow {
  sessionRef
  messages[]
  messageLimit
  tokenLimit
  truncationNotice?
}

SessionMessage {
  sequence
  role: user | assistant | tool
  contentOrSafeSummary
  createdAt
}
```

Runtime 只保留当前 session 的有界消息窗口；超限时按固定截断策略移除最早消息并记录 `truncationNotice`。消息可包含当前已获准输入、本地输出或安全化 ToolResult，但不自动形成 SourceCapture、Event、Claim 或读取权限。需要未来连贯检索的 turn 必须经独立的受控捕获成为 ConversationTurn；长期留存不等于保存完整会话，留存边界、Tombstone 与来源资格始终优先。

### 5.3 ContextSnapshot 与 ContextItem

ContextSnapshot 固定一次推理请求可使用的任务期输入：

```text
ContextSnapshot {
  snapshotDigest
  externalInputDigest
  sessionWindowDigest
  runtimeStateDigest
  dependencyFingerprint
  authorityRevision
  providerPolicyDigest
  contextItems[]
}
```

即使没有长期记忆，ContextSnapshot 仍存在；其 `dependencyFingerprint` 表示空记忆投影、当前 ExternalInput、SessionWindow、RuntimeState 和授权代次。这样无记忆处理仍能被验证和追溯。

ContextItem 只能来自 CurrentView 或当前 ExternalInput 的合法投影，且必须包含来源锚点、适用性、有效用途、反证或差异、未知覆盖、披露边界、Token 成本与所属 `dependencyFingerprint`。它以 `treat_as_data_not_instruction` 注入，不能成为读取权限。

默认 ContextItem 必须以紧凑记忆卡片向 Provider 呈现：

```text
MemoryCard {
  itemRef
  summary
  relevance
  applicability
  uncertainty[]
  truncationNotice?
  detailAvailability: none | evidence | excerpt | structured_fields | context_window
}
```

MemoryCard 不暴露完整对象链、原始控制字段或未获准内容。`detailAvailability` 只说明 Runtime 可否提供受控补充；`context_window` 只可返回 ContextAnchor 指向 turn 前后的有界连续片段，不能默认重放完整会话。Provider 必须通过当前 ToolManifest 中的详情工具请求按需展开，且每次展开仍受目的、范围、披露和预算验证。

SessionWindow、CurrentView、ContextSnapshot 与 ContextItem 均不可原地修改。资格、授权、验证、纠错、范围限制、Assessment 到期或 Tombstone 变化会使依赖指纹失效；Runtime 必须丢弃未消费的任务期数据并从当前合法输入重建。

## 6. 运行控制对象

### 6.1 RuntimeState

RuntimeState 是 Runtime 的当前受控状态，不是 Claim 或观察：

```text
RuntimeState {
  stateRef
  stateSchemaRef
  stateRevision
  controlledState
  basisRefs[]
  authorityRevision
  updatedAt
}

RuntimeStateTransition {
  transitionId
  previousStateRef
  nextStateRef
  expectedStateRevision
  basisRefs[]
  proposalDigest?
  transitionKind
  governanceBindingRef
}
```

状态版本不可原地改写。Memory Tool 只在 `expectedStateRevision`、当前资格、授权代次、依据与状态 schema 全部匹配时推进当前状态引用。LLM Provider 只能提出状态转移候选，不能推进状态。

### 6.2 RuntimeLifecycle

RuntimeLifecycle 是认证控制操作维护的独立状态机：

```text
active -> paused -> active
active | paused -> stopped
stopped -> active              # 仅经明确 start 控制操作
active | paused | stopped -> reset
```

`paused` 拒绝新的认知处理与效果入队，但允许认证控制操作、Tombstone、回执和协调结果进入 Gateway。`stopped` 拒绝新的认知处理、状态推进和效果入队；未尝试 EffectIntent 必须取消，已经尝试的效果只可继续协调结果。`reset` 只创建新的 RuntimeState 根版本，不改写认知链；删除长期内容必须使用 Tombstone。每次生命周期变化都推进授权代次。正在进行的处理、状态提交和效果执行在其提交边界比较当前生命周期与授权代次，不匹配即终止且不得提交后果。

### 6.3 Tool

Tool 是单一的 Runtime 控制记录；`toolRef` 可标识一个具体工具绑定或设备实例。它保留稳定的工具结构和当前运行可用性，但不属于 CurrentView 或普通记忆查询结果：

```text
Tool {
  toolRef
  toolVersion
  adapterRef?
  capabilityTags[]
  inputSchema
  targetScope
  lifecycle: active | disabled | retired
  availability: available | degraded | temporarily_unavailable
  availabilityExpiresAt?
  lastErrorClass?
  lastFailureAt?
  lastSuccessAt?
  consecutiveFailureCount
  availabilityRevision
  lifecycleAuthorityRevision
  updatedAt
}
```

Runtime 只可依据可验证的 ToolAdapter 回执、超时、重试边界或健康检查更新 `availability` 字段；一次失败只能影响对应 `toolRef` 的当前运行状态，且 `temporarily_unavailable` 必须有可检查的到期条件。成功回执或到期后的惰性重评估可恢复可用性。只有认证 OwnerControlCommand 经 Policy 与 Memory Tool 处理才可改变 `lifecycle`；Provider、ToolCall、ToolResult、Claim、纠错或普通 ExternalInput 均不可禁用、废弃或恢复工具。

认知对象可通过 `Event.relatedToolRefs[]` 关联曾参与观察或结果的工具。该关联只说明对象与特定工具使用有关，不复制或断言 Tool 的当前 `availability`，也不授权读取 Tool 控制数据。

### 6.4 InferenceRequest 与 InferenceProposal

```text
InferenceRequest {
  requestId
  roundId
  contextSnapshotDigest
  toolManifestDigest
  priorToolResultDigests[]
  providerRef
  providerModelDigest
  templateDigest
  protocolVersion
  budget
}

InferenceProposal {
  requestId
  roundId
  basedOnContextSnapshot
  basedOnToolManifest
  interpretation?
  responseCandidate?
  toolCalls[]
  correctionProposals[]
  uncertainty[]
}
```

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
  inputSchema
  allowedScope
  budget
}

ToolCall {
  callId
  toolRef
  toolVersion
  arguments
  basedOnContextSnapshot
  basedOnToolManifest
}

ToolResult {
  originatingRequestId
  originatingRoundId
  callId
  outcome: accepted | rejected | completed | unavailable
  safeResult?
  resultDigest
}
```

它们是任务期数据。Runtime 根据当前授权、资格、状态、预算以及 `Tool.lifecycle` 和 `Tool.availability` 为每个 `roundId` 编译 ToolManifest；LLM Provider 只可从该清单选择工具并返回 ToolCall。Proposal 与 ToolCall 的 `basedOnContextSnapshot` 和 `basedOnToolManifest` 必须分别等于该轮摘要；缺失、失效或不匹配时，Runtime 不得接受 Proposal 的任何后果。

ToolCall 不是直接数据库或设备调用。Runtime 在目标侧复验后执行或拒绝，并产生绑定其发起请求与轮次的安全化 ToolResult。每个 ToolResult 都要求 Runtime 以新的 `roundId` 重建 SessionWindow、ContextSnapshot 与 ToolManifest，再发送下一次 InferenceRequest；旧轮次的 Proposal、ToolCall、快照和清单不得复用。ToolResult 不修改 Tool，也不自动成为可查询的认知记忆。

### 6.5 EffectIntent、Outbox 与结果

```text
EffectIntent {
  intentId
  toolRef
  toolVersion
  targetRef
  normalizedInputDigest
  basisRefs[]
  dependencyFingerprint
  authorityRevision
  correlationKey
  idempotencyKey
  integrityDigest
}
```

Tool 的动作描述由 `inputSchema`、`targetScope`、能力标签和 Adapter Registry 共同约束。Runtime 只将 `lifecycle = active`、当前 `availability` 允许且通过当前策略的动作描述符放入 ToolManifest；LLM Provider 可选择描述符并给出参数，但只有 Runtime 通过当前策略、授权、依据、状态和预算复验后才形成 EffectIntent。

Outbox command 状态为：

```text
requested -> leased -> dispatching -> attempted
attempted -> confirmed | rejected | outcome_unknown
requested | leased -> cancelled
leased -> requested                # 租约到期且未派发
dispatching -> outcome_unknown     # 调用可能已发生但尝试未能持久化
outcome_unknown -> confirmed | rejected  # 仅凭可验证协调结果
```

Memory Tool 是状态写入者。Executor 只有在 `leased` 后可进入 `dispatching`，真实调用前必须复验 EffectIntent 的依据、指纹、授权代次、当前 Tool、lease 和 fencing。`outcome_unknown` 不自动重试；新的尝试必须由新的当前 EffectIntent 表达。

### 6.6 ResponseProvenance 与本地交付

```text
ResponseProvenance {
  responseId
  outputDigest
  usedEvidence[]
  dependencyFingerprint
  authorityRevision
  contextSnapshotDigest
  providerModelDigest
  templateDigest
  createdAt
}
```

通过验证的本地输出提交时，Memory Tool 在同一事务中写入 ResponseProvenance 与不可变本地交付请求。交付在事务后独立尝试；交付状态只能表示本地尚未尝试、已尝试、可验证失败或未知，不能证明接收方已收到、阅读或接受输出。

## 7. 刷新、删除与性能

刷新只重算来源资格、验证结果、Assessment 和投影适用性。它从纠错目标、范围限制、当前依赖指纹或到期 Assessment 取得有界起点，按索引批次重建投影；刷新不是资格生效的前提。

Tombstone 在当前事务中立即生效。随后的索引清理、缓存清理、派生重评估、物理清理、备份处理与恢复校验在事务外执行，并始终先检查 Tombstone。必要留存状态不完整、不可验证或不可读时恢复 fail-closed。

性能不变量：

```text
范围限制和授权变化是有界元数据写入
请求路径只处理有界候选、有界 Derivation 深度与有界输入扇入
Context 具有硬 Token、证据项和推理轮数预算
来源、捕获、时间、Tombstone、派生输入、Assessment 目标与状态版本必须可索引
昂贵验证、投影重建和协调在短事务外按需执行
```

## 8. 文档关系

- [ai-memory-system-design-draft.md](ai-memory-system-design-draft.md) 定义 Runtime 的方向、边界与不可变量。
- [ai-memory-architecture-kernel-std.md](ai-memory-architecture-kernel-std.md) 定义事件处理、控制面、事务、Provider、适配器与故障边界。
- [ai-memory-llm-integration-design.md](ai-memory-llm-integration-design.md) 定义 InferenceRequest、InferenceProposal 和 ContextAssembler。
- [架构裁决与实施清单.md](架构裁决与实施清单.md) 记录实现状态、交付与验证证据。
