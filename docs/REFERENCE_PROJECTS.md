# Cato AI 参考项目与接入边界

> 更新日期：2026-09-05
>
> 用途：为后续功能开发、连接器选择和 Agent 设计提供统一依据。
>
> 本文只讨论产品与技术复用，不评估许可证。

## 结论

Cato 是内容运营的业务事实层：情报、灵感、资料、选题、稿件、发布计划、指标和操作记录都由 Cato 保存与管理。

参考项目分为三类：

1. **产品工作流参考**：Beav。
2. **外部能力连接器**：MediaCrawler、Spider_XHS、social-auto-upload。
3. **可版本化的方法与 Agent 组织参考**：Viral Writer Skill、self-media-content-workflow、DSH Desktop。

不要把任一参考项目直接当作 Cato 的数据库、主界面或 Agent runtime。它们只能通过稳定的 Connector 或 Skill 契约接入。

```text
Cato UI / API / SQLite
        │
        ├── Collector Connector ── MediaCrawler / Spider_XHS
        ├── Composition Skill ─── Viral Writer / 自有写作 Skill
        ├── Publisher Connector ─ social-auto-upload
        └── Agent Host ────────── WorkBuddy MCP（当前）/ 后续可选 Agent runtime
```

## Cato 的稳定对象

下列对象是产品内部契约。外部项目的 Cookie、平台签名、CLI 参数、文件路径和配置模型不得渗透到这些对象中。

| Cato 对象 | 职责 | 外部项目的关系 |
| --- | --- | --- |
| `EvidenceItem` / `EvidenceComment` | 内容信号、来源、正文、封面、评论与采集元数据 | 采集器输出需转换为此结构 |
| `InboxNote` / `KnowledgeDocument` | 灵感和长期运营资料 | 供人和 AI 检索，不由外部项目持有 |
| `Topic` | 已确认的内容方向与证据关联 | 写作 Skill 的输入，而非临时 Markdown 流程 |
| `ContentProject` / `ContentVersion` | 稿件、平台变体、审核和版本 | 写作 Skill 的产物落点 |
| `PublishJob` / `PublicationPlan` | 发布确认、排期、执行记录与链接 | 发布器只执行，不拥有状态 |
| `MetricSnapshot` | 发布后的表现数据 | 复盘与下一轮选题的依据 |
| `AgentRun`（后续） | 一次 Agent 执行的输入、工具调用、引用和产物 | Agent host 只编排，不替代业务记录 |

## 参考矩阵

| 项目 | 适合复用的部分 | Cato 中的落点 | 接入状态 | 优先级 |
| --- | --- | --- | --- | --- |
| [Beav](https://github.com/Jamailar/Beav) | 内容工作台信息架构、采集→知识库→选题→创作→日历的连续体验 | 产品交互与模块边界 | 参考中 | 高 |
| [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 多平台公开内容采集、登录态浏览器自动化、关键词/详情/评论能力 | `Collector Connector` | 小红书关键词、抖音单链接入口已接 | 高 |
| [Viral Writer Skill](https://github.com/nashsu/Viral_Writer_Skill) | 洞见驱动写作、标题候选、配图提示词的结构化输出 | `Composition Skill` | 待抽取为自有模板 | 高 |
| [self-media-content-workflow](https://github.com/yanhua1010/self-media-content-workflow) | Brief、策略、趋势、平台文案、视频、复盘的 Skill 分层与确认点 | Skill 路由、审核与发布流程 | 待接 | 高 |
| [social-auto-upload](https://github.com/dreammis/social-auto-upload) | 多平台上传器、CLI、定时发布执行方式 | `Publisher Connector` | 待接 | 中 |
| [Spider_XHS](https://github.com/cv-cat/Spider_XHS) | 小红书专用采集、账号与发布能力的深度参考 | 可选 `XHS Connector` | 仅评估 | 低 |
| [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop) | 插件化桌面壳、工具权限、任务持久化和运行状态呈现 | 后续 Agent host / 桌面封装 | 仅参考 | 低 |

## 项目说明

### 1. Beav：工作台形态参考

Beav 的核心价值是把采集、知识库、选题、创作、视觉制作和内容日历组织成一个连续工作流，并提供浏览器采集与 Agent/插件入口。[其 README 将“采集爆款 → 选题 → 创作 → 排期”作为主流程](https://github.com/Jamailar/Beav)。

**Cato 借鉴**

- 用一个工作台串联内容情报、资料库、选题、创作项目、日历和复盘，而不是多个孤立工具页。
- 对每个对象显示明确的下一步：从情报创建选题、从选题创建项目、审核后排期、发布后记录数据。
- Agent 或连接器在产品之外执行，结果回到 Cato 可查看、可编辑、可审核的对象中。

**Cato 不复用**

- 不把其 Electron、IPC、本地工作空间格式或插件实现作为当前 Web 版的基础。
- 不照搬“全自动创作/分发”的产品承诺；Cato 的发布确认是显式状态。

**后续检查点**

- 当 Web 版的离线能力、原生文件选择或常驻采集需求成为瓶颈时，再评估 Tauri 桌面壳。

### 2. MediaCrawler：默认采集连接器

MediaCrawler 使用浏览器自动化和已保存的登录态来采集小红书、抖音、快手、B 站、微博、贴吧、知乎等平台，公开 README 列出了关键词、指定帖子、评论和作者主页等能力。[项目说明](https://github.com/NanmiCoder/MediaCrawler)强调其基于 Playwright 或 CDP 的登录态环境。

**Cato 借鉴与接入方式**

- 作为本地 Python Worker，不发布到 Cato 仓库，也不直接访问 Cato SQLite。
- Cato 只发送规范化采集请求：平台、采集方式、关键词或 URL、数量、是否采集评论。
- Cato 将结果映射为 `EvidenceItem`、`EvidenceComment` 和 `CrawlerRun`，保留来源 URL、原始时间、导入数量和失败信息。
- 当前入口：小红书关键词采集、抖音单链接采集。

**禁止耦合**

- 浏览器 profile、Cookie、代理和任何登录态只留在 MediaCrawler 本地目录。
- 不让 MediaCrawler 的内部表、JSONL 或平台字段成为 Cato 页面和业务 API 的对外契约。

**验收门槛**

- 对每个平台分别验证：登录、详情、封面/正文/评论导入、失败重试和结果去重。
- “已创建采集任务”不等于“真实内容已成功导入”。

### 3. Viral Writer Skill：写作输出模板参考

Viral Writer Skill 将主题转为平台适配正文、5 个标题候选和配图提示词，并用 11 个洞见维度约束内容思考，例如观点、论证、情绪、语言风格和互动钩子。[项目 README](https://github.com/nashsu/Viral_Writer_Skill)给出了该输出结构。

**Cato 借鉴与接入方式**

- 把 11 个维度转为 Cato 的内部写作检查表或可版本化模板，不要求向用户展示模型的隐藏推理过程。
- 输入必须来自 `Topic`、关联 `EvidenceItem`、目标平台、账号调性和格式约束。
- 输出创建 `ContentVersion`，并附带标题候选、封面/配图需求、适用平台和引用证据。

**不直接采用**

- 不把单一 `SKILL.md` 当作不可替换的提示词真源。
- 不允许没有证据或明确标记为“创意假设”的数据型表述进入可发布稿。

### 4. self-media-content-workflow：Skill 编排与人工确认参考

该项目将内容生产拆为 Brief、内容策略、趋势雷达、平台文案、短视频、数据复盘和交付归档等 Skills，并把方向、平台、标题、终稿、发布授权列为强制确认点。[其架构与原则](https://github.com/yanhua1010/self-media-content-workflow)与 Cato 的人审工作流一致。

**Cato 借鉴与接入方式**

- 以 `ContentBrief` 为生成前置条件：目标、受众、证据、角度、平台和限制必须明确。
- 采用“母题共享事实，平台分别改写”的策略：同一 `Topic` 可以产生多个 `ContentVersion`。
- 将审核节点落实为 Cato 状态转换，而非聊天文字中的模糊同意。
- 将复盘结果写回选题和资料库，而不是仅输出一次性报告。

**建议的 Skill 路由**

```text
Brief → 策略 / 趋势 → 平台文案 / 短视频 → 审核 → 发布包 → 复盘 → 资料库与选题池
```

### 5. social-auto-upload：发布执行连接器

social-auto-upload 提供多个国内外平台的视频/图文上传、定时发布、CLI 和 uploader 模块。[其 README 的能力矩阵](https://github.com/dreammis/social-auto-upload)可用作发布器选型基线。

**Cato 借鉴与接入方式**

- 作为异步 `Publisher Connector`，由 Cato 创建 `PublishJob` 后调用。
- Cato 传入已批准的发布包：标题、正文、媒体路径、平台、账号引用、发布时间和可见性。
- Worker 返回结构化执行结果：状态、远端 URL、平台返回标识、开始/结束时间、错误摘要。
- 首版只支持“导出发布包 + 人工确认调用”；自动发布必须单独打开连接器开关。

**禁止耦合**

- 不使用其前端作为 Cato 的发布页面。
- 不让发布器拥有 Cato 的项目状态；它无权绕过审核或修改稿件正文。
- 平台账号和登录态留在 Worker，不写入 Cato 的业务表或日志。

### 6. Spider_XHS：小红书深度能力备选

Spider_XHS 覆盖小红书 PC 端内容/评论/作者采集、创作者平台图文与视频发布，以及 KOL 数据等能力。[项目功能说明](https://github.com/cv-cat/Spider_XHS)显示它对平台内部协议和账号能力耦合较深。

**适合的用途**

- MediaCrawler 的小红书采集无法满足明确的产品需求时，作为单独的 `XHS Connector` 备选。
- 需要小红书专用的发布校验、账号健康或 KOL 数据时，先做小范围能力验证。

**接入前提**

- 不把平台签名、Cookie、账号管理和底层 API 对象暴露给 Cato。
- 所有写操作均需从已审核的 `PublishJob` 发起，并保存外部执行记录。
- 先验证一个账号、一种内容格式、一条发布路径，再扩大范围。

### 7. DSH Desktop：Agent 宿主参考，不是当前依赖

DSH Desktop 将 DeepSeek Harness 的本地 Web UI、Host 服务与插件系统封装为 macOS/Windows 桌面应用，并强调插件化组合。[其项目说明](https://github.com/anywhere-labs/dsh-desktop)可用于理解桌面 Agent 宿主的组织方式。

**Cato 借鉴**

- 工具最小权限：采集、检索、创建草稿、创建发布任务应是独立工具。
- 每次运行保存输入、工具调用、引用、产物、状态与错误。
- 插件/Skill 的能力声明与产品页面解耦，方便后续替换模型或 Agent host。

**当前边界**

- Cato 现有 WorkBuddy MCP Connector 已足够提供受限检索和确认后写入。
- 暂不嵌入完整 DSH runtime，不做插件市场，不做多 Agent 群聊。

## 连接器契约

### 采集

```ts
type CollectRequest = {
  platform: "xhs" | "douyin" | "bilibili" | string;
  mode: "keyword" | "detail" | "creator";
  query: string;
  limit?: number;
  includeComments?: boolean;
};

type CollectResult = {
  runId: string;
  status: "succeeded" | "failed";
  items: Array<{
    sourceUrl: string;
    externalId?: string;
    title?: string;
    body?: string;
    author?: string;
    coverUrl?: string;
    collectedAt?: string;
  }>;
  error?: string;
};
```

### 写作

```ts
type ComposeRequest = {
  topicId: string;
  evidenceIds: string[];
  platform: string;
  contentFormat: string;
  brandVoice?: string;
};

type ComposeResult = {
  versionId: string;
  body: string;
  titleCandidates: string[];
  assetBriefs: string[];
  evidenceIds: string[];
};
```

### 发布

```ts
type PublishRequest = {
  publishJobId: string;
  projectId: string;
  platform: string;
  accountRef: string;
  scheduledAt?: string;
  confirmed: true;
};

type PublishResult = {
  status: "published" | "scheduled" | "failed";
  publishedUrl?: string;
  externalId?: string;
  error?: string;
};
```

## 推荐实施顺序

### 现在：先把已存在的闭环做扎实

1. 完成 MediaCrawler 小红书关键词与抖音单链接的真实登录态验收。
2. 统一采集结果的去重、失败提示、重试与原始附件保存策略。
3. 从 `EvidenceItem` → `Topic` → `ContentProject` → `PublicationPlan` 的每一步保证可回溯。
4. 把 Viral Writer 的输出形态沉淀为 Cato 自有、可版本化的写作模板。

### 下一步：引入可控的生成和发布

1. 实现 `ContentBrief` 与证据引用校验。
2. 为项目增加标题候选、封面/配图需求和平台变体。
3. 用 social-auto-upload 建立单平台、单账号、人工确认后的 `Publisher Connector` 验证路径。
4. 发布成功后写入 URL 与指标录入入口。

### 后续：按真实需求增加深度能力

1. 仅当 MediaCrawler 的小红书能力不够时，评估 Spider_XHS Connector。
2. 仅当 Web 形态成为阻碍时，评估 Tauri 桌面壳或 DSH 风格 Agent host。
3. 当连接器数量与复杂度增加后，再引入独立队列、对象存储和更完整的 `AgentRun` 审计。

## 每次接入前的检查

- 是否能映射到 Cato 的稳定对象，而不是把第三方数据模型透传进来？
- 是否把平台账号、Cookie、浏览器 profile、Token 和外部配置隔离在连接器目录？
- 是否有明确的输入、输出、错误与重试状态？
- 写入动作是否经过已审核的 Cato 状态和人工确认？
- 是否能在 Cato 中追溯来源、执行者、时间、外部标识与结果？
- 是否分别验证了“任务创建成功”和“外部操作实际成功”？

## 更新规则

当参考项目的主版本、接口、关键能力或运行方式变化时，先更新本文对应章节和 Connector 契约，再改 Cato 实现。不要依据旧的 README 描述直接升级连接器。
