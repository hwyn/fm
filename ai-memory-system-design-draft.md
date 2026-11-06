# AI 持续认知与行为 Runtime 骨架规范

> 本文定义系统方向、使用边界、不可取消约束和必须能力。对象语义以 [ai-memory-semantic-model-design.md](ai-memory-semantic-model-design.md) 为准。

## 0. 北极星定义

本系统是本地、单一 Runtime、由外部事件驱动的持续认知与行为系统。外部输入只触发处理；Runtime 自己维护长期认知链、当前运行状态、有限会话窗口、Context 编译和一次外部输入所触发的有界处理循环，并保留记忆、状态、工具调用后果的裁决与提交权。

系统的唯一长期认知路径是：

```text
Source
-> SourceCapture
-> Event / Artifact
-> Derivation
-> Claim
-> ApplicabilityAssessment
-> CurrentView
-> ContextItem / ResponseProvenance
```

这条路径不是世界真相机器。Source 说明输入来自哪里；Event 与 Artifact 说明观察或内容曾被受控捕获；Derivation 说明转换如何发生；Claim 是可评估的表述；ApplicabilityAssessment 说明它在何种条件下可用；CurrentView 只说明此时此地能安全使用什么。

### 核心运行闭环

系统的核心不是让 LLM 直接拥有数据库或外设，而是由 Runtime 将记忆 API 与外设/API 工具编译为当前任务可用的 ToolManifest。一次 ExternalInput 处理固定遵循以下闭环：

```text
记忆 API + 外设/API 工具
-> Runtime 按当前权限、状态、预算和 Tool 可用性编译 ToolManifest
-> 与有限 SessionWindow、当前输入、合法 CurrentView 组成 Context
-> LLM 推理并选择要调用的 Tool
-> Runtime 验证、执行并返回 ToolResult
-> LLM 在有限轮次内继续推理或输出
```

每个 ToolResult 都开启新的推理轮次：Runtime 重建 SessionWindow、ContextSnapshot 与 ToolManifest；旧轮次的 Proposal、ToolCall、快照和清单不能继续使用。

完整处理步骤为：

```text
ExternalInput
-> Gateway 认证、规范化与幂等检查
-> Memory Tool 处理捕获、资格与当前状态
-> Runtime 按当前权限、状态、预算和 Tool 可用性编译 ToolManifest
-> ContextAssembler 将有限 SessionWindow、当前输入、合法 CurrentView、状态摘要与安全化 ToolResult 组成 Context
-> LLM Provider 无状态推理并选择 ToolCall 或输出候选
-> Runtime 逐项验证并执行获准 ToolCall，向有限后续推理轮次返回 ToolResult
-> Runtime 仅提交已验证的认知对象、状态变化、输出或 EffectIntent
-> 外部反馈成为新的 ExternalInput
```

该闭环具有三条不可替代的职责边界：

1. **LLM 选择**：Provider 只能从当前 ToolManifest 选择下一步工具、提出候选或输出；它不能直接访问记忆存储、凭据、外设或控制数据。
2. **Runtime 裁决**：Runtime 决定工具是否出现于清单、调用是否允许、结果可披露的范围以及哪些后果可以提交。
3. **任务期隔离**：SessionWindow、Context、ToolManifest、ToolCall 与 ToolResult 仅服务当前有界处理；它们不自动成为长期记忆、权限或治理操作。只有来源、目的与留存均获准的对话 turn 才可作为长期记忆的引用锚点。
4. **紧凑推理**：高频外设/平台输入先按静态接入配置在 Adapter 侧归约；Provider 默认接收简洁的 MemoryCard，并只能通过受限详情工具按需展开证据、原话片段、结构化字段或锚点附近的有界对话窗口。
5. **受限混合检索**：Provider 可为 `memory.query` 提出由关键词、时间范围、注册元数据字段、语义查询和预算组成的 MemoryQueryPlan；Runtime 在授权与 Tombstone 预过滤后，以参数化 SQLite 查询合并宽表生成列、FTS5 和向量候选，再以确定性规则输出有限 MemoryCard。查询计划不是 SQL、读取权限、事实判断或适用性结论。

系统不自行定时唤醒或制造任务。人类消息、平台事件、感知结果、工具回执以及外部定时资源提交的事件，均通过同一 ExternalInput 入口处理。外部 worker、定时器或平台回调可调用受控维护入口以驱动投递、协调、刷新或清理；这些入口不触发认知推理，Runtime 也不承诺在没有外部触发时自行完成后台工作。

## 0.1 角色与边界

### Cognitive Runtime

Runtime 是认知、记忆、当前状态、Tool 控制、有限会话窗口、Context 与行为处理的唯一边界。它拥有持久化认知链、RuntimeState、Tool、Context 编译、Provider 选择、Proposal 验证以及行为与效果意图的接受、拒绝与提交。

Runtime 只在收到 ExternalInput 后执行一次有界处理，并在结束后保持可恢复的持久状态。

### Owner

Owner 是拥有最高控制权限的外部主体。Owner 的普通消息、观察和反馈与其他外部输入一样，经由 Source、SourceCapture 和 Runtime 的认知路径处理；它们不天然构成命令、事实或状态修改。

Owner 的认证控制操作经独立控制面处理，可暂停、停止、重置、删除、配置策略、授予或收回能力、限制留存与紧急中断效果。控制操作不交由 LLM 决定，也不因普通消息而隐式发生。

### LLM Provider

LLM Provider 是可替换的无状态推理组件。它接收 Runtime 编译的 InferenceRequest、当前 ToolManifest 和安全化 ToolResult，并返回符合协议的 InferenceProposal。它不持有长期记忆、Context、授权、运行状态、调度权或直接工具执行权。

Provider 的模型身份、模型摘要、模板摘要、协议版本与上下文限制必须被 Runtime 静态注册和验证。所有 Provider 位于本地信任边界内；Context、输入和召回内容不得通过 Provider 路径出站。

### ToolAdapter

ToolAdapter 是后续接入鼠标、键盘、屏幕、游戏、语音、直播、社交平台或其他外部资源的静态适配器。每个可用工具绑定由单一 Tool 控制记录保存稳定结构、生命周期与当前可用性；适配器只能提交有类型的输入、观察或回执，或执行 Runtime 已批准的 EffectIntent。它不能读取 Context、拥有记忆、修改 RuntimeState、授予权限或调用其他适配器。

## 0.2 使用方向

系统从外部反馈中保留获准、可核验的经历，形成条件化理解，并据此产生可追溯的表达、状态变化或受控效果。它追求的不是积累一切信息，而是使以下问题始终可回答：

```text
观察从何而来
转换如何发生
结论在何种条件下可用
本轮 Context 为什么包含这些内容
LLM 提议为何被接受或拒绝
外部效果的已知状态是什么
```

系统支持开放联想、结构检验与条件化复用。LLM 可以依据获准 Context 提出跨领域的机制比较；联想不是事实、因果结论或长期规则。带来源、条件、差异、反证与不确定性的比较可作为 `mechanism_candidate` 留存；没有新的合格来源、受控 Verifier 或认证控制确认时，它不得成为 `direct_evidence` 或外部效果的直接依据。

系统优先向 Provider 提供可扫描的摘要、适用条件、不确定性和可展开标记，而非完整对象链或原始历史。记忆的置信度与新鲜度只影响召回和摘要优先级，不能替代 Tombstone、授权、适用性或外部效果控制。

系统也支持历史说明：Event 与 Artifact 说明观察，Claim 与 Assessment 说明解释，ResponseProvenance 说明一条已记录输出实际使用的最小证据包，受控结果观察说明外部效果。系统不重建隐藏推理、未记录历史或不可披露内容。

## 0.3 不可取消约束

1. Runtime 是唯一认知、记忆、状态与 Context 边界；Owner、LLM Provider 与 ToolAdapter 都不是该边界的替代者。
2. SessionWindow、Context、CurrentView、ContextItem、InferenceRequest 和 InferenceProposal 是任务期数据，可丢弃和重建，不能成为未授权的长期记忆或读取权限。
3. Source、SourceCapture、Event、Artifact、Derivation、Claim、ApplicabilityAssessment、RuntimeState、Tool、ResponseProvenance 与效果控制记录的持久化只能由 Memory Tool 完成，并受当前 Policy、授权代次和目标侧验证约束。
4. Source 身份、捕获完整性、目的、留存、披露、派生、读取、状态变化和效果授权彼此独立；某项允许不得自动扩大其他允许。
5. Tombstone 优先于读取、索引、缓存、派生、CurrentView、Context、回答追溯、当前状态引用与未尝试效果。删除不宣称撤销已发生的外部世界效果。
6. LLM Provider 可以从当前 ToolManifest 选择记忆查询、记忆写入候选、状态转移候选或适配器动作候选；它不能认证来源、决定权限、持久化、删除、解除 Tombstone、直接执行工具、读取或修改 Tool 控制字段，或推进 RuntimeState。
7. 条件未知、来源不完整、派生不可验证、Assessment 过期或冲突无法消解时，Runtime 必须限制使用、请求补充信息、受限输出或结束当前处理，不能默认适用。
8. Context 只由当前合法的 SessionWindow、CurrentView、RuntimeState 摘要和 ExternalInput 编译。Provider 与 ToolAdapter 不能为自身或他方扩大 Context、权限或披露范围。
9. 外部效果只经 EffectIntent、Outbox 与受控执行器发生。请求、派发、尝试和结果互不替代；无法确认结果时保持 `outcome_unknown`。
10. 每次 ExternalInput 处理都具有硬边界：SessionWindow 消息数与 token、输入大小、候选数、派生输入数、推理轮数、Context token、效果数与处理预算必须可检查。
11. Tool 的当前可用性只由可验证回执、超时、重试边界或健康检查更新；工具的禁用、废弃或恢复只由认证 Owner 控制操作更新。普通记忆查询只返回 CurrentView，不返回 Tool 控制字段或错误历史。
12. LLM 提出的纠错只是候选；Runtime 必须在创建纠错事件和改变 CurrentView 前检查其目标、证据、范围、反证、Tombstone、授权代次与预算。

## 0.4 明确非目标

本系统不是：

1. 完整聊天记录仓库、LLM 思维链持久化系统或全量历史回放系统。
2. 只依赖文本或向量相似度的历史搜索系统。
3. 多租户、组织协作、团队知识运营、通用审批流或通用工作流平台。
4. 允许 Provider、适配器、平台或外部输入绕过来源、留存、删除、状态、授权和效果边界的自动化执行平台。
5. 世界知识图谱、预定义行业本体、通用因果推理引擎，或自动将一次联想提升为长期事实的系统。
6. 由 LLM 自行定义 Context、保存记忆、选择任意外部能力或在没有 ExternalInput 时持续运行的系统。
7. 按领域复制独立记忆库、独立 Context 语义或独立治理语义的系统。

## 1. 目标与成功效果

### 1.1 总体目标

让系统在连续外部反馈中形成长期、可追溯、条件化且可纠错的认知，并在当前状态和可用能力范围内推进后续交互。它必须能够：

1. 保留获准、可核验的观察，而不把所有交互默认写成长期历史；已留存的对话只作为可撤销、可过期、按需展开的局部证据窗口。
2. 从当前合法经历中提出结构性比较，并清楚地区分可复用机制、关键差异、反证与未知项。
3. 依据当前有限 SessionWindow、ExternalInput、RuntimeState 和 CurrentView 编译有界 Context，调用任意合格 LLM Provider 推理。
4. 将 Provider 输出限制为可验证候选，并仅提交符合来源、条件、授权、预算和状态规则的后果。
5. 对过去观察、输出依据、状态变化和效果结果提供受限且可追溯的说明。
6. 允许后续静态 ToolAdapter 扩展感知与行动能力，而不改变认知对象、Context 语义或权限边界。

### 1.2 可见结果

系统在当前披露范围内可产生：

1. **观察说明**：当前可披露的来源、时间、范围、完整性与已知内容。
2. **条件化解释**：哪些 Claim 在当前 SituationFrame 下直接支持，哪些仅为机制候选，哪些被反例或范围限制排除。
3. **比较说明**：候选经验之间的共享机制、关键差异、风险、反证和覆盖缺口。
4. **交互输出**：由当前 Context、RuntimeState 与 Provider 提议形成的表达，或受限结束。
5. **历史依据说明**：某条获准记录的输出实际使用了哪些最小证据，或为何无法确定当时依据。
6. **纠错说明**：新验证结果、认证控制操作或来源限制如何影响内容的当前可用性。
7. **效果状态说明**：已知的排队、尝试、可验证结果或 `outcome_unknown`，不把请求或超时表述为外部世界结果。

### 1.3 不可接受结果

必须禁止：

1. 跨授权边界的来源、内容、Context、状态或回答追溯泄漏。
2. 错误、过期、冲突或条件不明的 Claim 被直接当成当前事实或自动效果依据。
3. 删除内容经重放、索引、缓存、摘要、Context、状态、回答追溯或恢复被重新暴露。
4. 外部输入、Provider 输出或 ToolAdapter 反向改变系统指令、权限、控制流程或能力边界。
5. Provider 的自信、表面相似、来源领域或历史成功被表述为当前事实、必然因果或无需治理裁决的行动依据。
6. 控制操作伪装成普通输入，或普通输入绕过认证控制面。

## 2. 系统边界与责任分层

### 2.1 运行控制层

运行控制层接收 ExternalInput 与认证控制操作，维护 RuntimeState，选择 InferenceProvider，编译 Context，验证 Proposal，提交认知与效果后果，并在失败时保持可恢复状态。它不把状态推进、授权消费或效果执行交给 LLM Provider 或 ToolAdapter。

### 2.2 认知与验证层

Memory Tool、Policy 与 Verifier 共同维护来源资格、条件、派生链、当前投影、纠错、Tombstone、授权代次与可检查的结果。它们不认证模型语义，不把候选直接提升为事实，也不以运行状态替代认知证据。

### 2.3 Provider 与适配器层

LLM Provider 只接受 InferenceRequest 并返回 InferenceProposal。ToolAdapter 只提供已注册的输入、观察、回执或效果执行能力。二者都不能直接访问 SQLite、CurrentView 原始内容、长期索引、授权令牌或其他适配器。

## 3. 不可取消主路径

### 3.1 ExternalInput 处理

```text
ExternalInput
-> Gateway 验证身份、来源、完整性、顺序与幂等边界
-> Policy 裁决捕获、读取、披露、状态与效果范围
-> Memory Tool 持久化合格 SourceCapture + Event / Artifact，或限定任务期处理
-> Runtime 取得当前 RuntimeState、有界 CurrentView 与有限 SessionWindow
-> ContextAssembler 生成 ContextSnapshot 与 ContextItem
-> InferenceProvider 返回 InferenceProposal
-> Runtime、Verifier、Policy 与 Memory Tool 逐项接受、限制或拒绝后果
-> 输出、状态变化、EffectIntent 或受限结束
```

输入不能记录时，系统可以在任务期按当前处理边界使用它，但不形成 SourceCapture、Event、Artifact、Claim 或可重建的 ResponseProvenance。高影响效果、持久化、来源限制、Tombstone 与认证控制操作始终需要各自独立的授权。

### 3.2 当前投影与推理

Runtime 按当前身份、目的、来源、Tombstone、时间、稳定引用、RuntimeState 与授权代次缩小候选，再生成 CurrentView。ContextAssembler 只交付当前允许使用的 ContextItem，并保留来源锚点、适用性结果、直接依据、反证、条件差异、未知覆盖、披露边界与截断说明。

Provider 只能通过当前 ToolManifest 请求额外信息或后果。Runtime 可以基于当前规则补充、拒绝或要求受限结束；Provider 不能自行查询存储、选择索引、扩大范围或要求暴露受限内容。

### 3.3 历史说明与结果解释

```text
发生过什么              由当前可披露的 Event / Artifact 说明
可如何解释              由 Claim 与 ApplicabilityAssessment 说明
一条输出为何这样形成    由获准记录的 ResponseProvenance 说明
状态为何这样变化        由已接受的状态转移与直接依据说明
外部效果是否发生        由可验证回执或结果观察说明
```

系统不得以当前解释补造过去观察，不得把当前不可见的内容暗示为历史存在，也不得将模型隐藏推理描述为历史依据。

### 3.4 纠错、删除与外部效果

观察不原地改写。新的验证结果、认证控制操作或来源范围限制以带目标和范围的受控纠错记录表达。范围限制、授权撤销与 Tombstone 立即改变当前资格规则及其代次；任何读取、推理、状态提交、输出、效果入队或效果执行边界都必须比较当前代次，不能依赖逐项修改历史对象。

纠错不会修改已经给过 Provider 的 Context、已经提交的输出、已经接受的历史状态变化或已经尝试的外部效果。受影响的 CurrentView、ContextItem、未提交 Proposal、未提交状态变化、未入队效果和后续复用在下一个边界被判定失效。系统从当前合法输入重建投影与 Context；无法安全重建时只能受限输出或结束当前处理。

外部效果始终区分意图、授权、排队、尝试和可验证结果。未知结果保持 `outcome_unknown`，除非当前授权与可验证结果证据或强幂等边界共同允许处理。

## 4. 必须功能

1. 可追溯的来源注册、受控捕获、观察与内容引用。
2. 直接输入可检查的派生链，以及 Provider 候选和已验证结论的严格区分。
3. 条件化 Claim、反例、范围限制、时效、冲突与未知覆盖的显式表达。
4. ExternalInput 驱动的有界 RuntimeState 推进、CurrentView 编译、推理与后果验证。
5. 可替换、静态注册且位于本地信任边界内的 LLM Provider。
6. 对过去观察、输出依据、状态变化与效果结果的受限说明，不重建隐藏推理或未记录历史。
7. 最小输出追溯、纠错定位与依赖重评估。
8. Tombstone 驱动的读取、索引、派生、Context、状态引用、输出追溯与效果阻断。
9. 短事务、可索引过滤、有界候选、有限派生输入、有限推理轮数和硬 Context 预算。
10. 通过静态 ToolAdapter、Outbox、强幂等边界或可验证结果证据控制外部效果；未知结果不自动重试。

## 5. 文档职责

1. [ai-memory-semantic-model-design.md](ai-memory-semantic-model-design.md) 是认知对象、运行控制对象、引用、条件、Assessment、CurrentView、RuntimeState 与 ResponseProvenance 的唯一语义规范。
2. [ai-memory-architecture-kernel-std.md](ai-memory-architecture-kernel-std.md) 定义部署、组件、事件处理、控制面、事务、Provider、ToolAdapter、Outbox 与故障控制。
3. [ai-memory-llm-integration-design.md](ai-memory-llm-integration-design.md) 定义 InferenceRequest、InferenceProposal、ContextAssembler 与 Proposal 验证。
4. [架构裁决与实施清单.md](架构裁决与实施清单.md) 仅记录交付状态、验收项与验证证据，不重定义任何语义。
