<p align="center">
  <img src="./public/brand/cat-mark-v2.svg" width="116" alt="Cato AI" />
</p>

<h1 align="center">Cato AI</h1>

<p align="center">
  从内容情报到发布复盘，一站式 AI 内容运营工作台。
</p>

<p align="center">
  让每条内容都有来处、状态和下一步。
</p>

<p align="center">
  <a href="#快速开始">开始使用</a> · <a href="#已包含的功能">功能</a> · <a href="#workbuddy-接入">WorkBuddy</a> · <a href="#架构">架构</a> · <a href="./docs/REFERENCE_PROJECTS.md">参考项目</a>
</p>

## 为什么是 Cato

内容运营的麻烦不在于少一个生成器，而在于素材、灵感、选题、稿件和复盘分散在不同工具里，最后很难回答两件事：现在应该推进什么，以及这条内容为什么值得做。

Cato AI 把这些对象放进同一张编辑台。你可以从真实内容信号出发，形成可追溯的选题与稿件；AI 和外部连接器负责辅助，人保留判断、审核与发布确认。

## 核心流程

```text
内容情报 / 灵感 / 资料库
        ↓
      选题确认
        ↓
      创作项目
        ↓
      人工审核
        ↓
  发布计划 → 发布确认 → 数据复盘
```

数据保存在本机 SQLite。Cato 不以“自动发布一切”为目标：采集、AI 与外部工具均通过连接器接入，选题确认、审核、发布确认等关键动作保留给人。

## 已包含的功能

### 工作台

- 概览：按待审核、待排期、待确认发布和草稿呈现下一步。
- 内容情报：手动录入、内容检索、归档、从证据创建选题、**从视频链接提取文案**。
- 灵感收件箱：随手记录灵感、标签管理、从灵感创建选题。
- 资料库：新建、编辑、版本记录、全文检索与文件导入；资料默认可供 AI 读取。
- 评论洞察：浏览已采集评论，并回到关联内容情报。
- 创作项目：图文笔记、长文文章、短视频脚本、口播稿；支持正文编辑、版本、审核状态和多平台变体。
- 发布日历：为已批准稿件排期、手动确认发布、记录浏览/点赞/评论/收藏数据。
- 素材资产与归档：集中查看采集素材，保留可恢复的归档状态。

### 本地账号与数据

- 首次打开创建一个本地工作区账号；密码使用 `scrypt` 哈希保存。
- 登录会话使用 HttpOnly Cookie，仅监听 `127.0.0.1`。
- 默认数据库：`data/creator-os.db`。
- 所有工作区数据、导入资料和采集结果都在当前电脑本地保存。

### 资料库导入

支持以下文件格式：

- 纯文本与结构化文本：TXT、Markdown、CSV、JSON、HTML、XML。
- 办公文档：DOC、DOCX、ODT、RTF。
- PDF。

原文件会保存在 `data/library-uploads/`，提取后的正文进入资料库，可继续编辑并保留版本。

单文件上限为 8 MB，正文最多保存 50,000 个字符。PDF 依赖 `pdftotext`；办公文档转换当前依赖 macOS 自带的 `textutil`，因此非 macOS 环境需要自行提供等价转换能力。

### 内容采集

项目提供 `MediaCrawler` 连接器入口：

- 小红书关键词采集。
- 抖音单条链接采集：保存发布文案、作者、封面、视频链接及可选评论。
- 采集任务、导入数量与失败信息均会保存在本地。

需要先准备本地 MediaCrawler checkout、运行环境与对应平台登录态。MediaCrawler 本身不会随本仓库发布，以避免把虚拟环境、浏览器登录数据或平台配置带入 Cato 仓库。真实平台采集是否成功取决于本地登录、平台风控、网络和 MediaCrawler 当前能力，不能仅以“任务已创建”视为采集成功。

### 从链接提取文案

内容情报页的「从链接提取」走的是**另一条独立链路**，不依赖 MediaCrawler，也不需要任何平台登录态：

- 粘贴一条视频链接（抖音、B 站、YouTube 等 yt-dlp 支持的站点），一次请求即可拿到标题、作者、封面与口播逐字稿。
- 同一链接重复提交会更新已有情报，不会在列表里刷出多条。
- 提取顺序是**先找平台原生字幕，找不到才回落语音识别**。原生字幕是零成本路径，大多数有字幕的视频根本不需要跑 ASR。

底层由 `transcript/` 模块实现：

- `yt-dlp` 解析链接元数据并抓取原生字幕（必需）。
- `ffmpeg` + ASR 仅在平台没有原生字幕时才需要。
- 引擎未就绪时，`/api/evidence/from-url` 会返回 `409` 与 `not_configured`，**绝不落库、绝不生成虚构文本**。
- 自动字幕的滚动重复行会被识别并去重；排版折行会被摊平成连续句子，产出可直接使用或再加工的文本。
- 能力探测是**诚实的**：whisper.cpp 只有二进制、没有模型文件时，会报「语音识别 不可用」并说明原因，而不是等到运行时报一个看不懂的错。

一键安装到项目本地（不改动系统环境）：

```bash
npm run transcript:setup              # 安装/更新 yt-dlp 到 .tools/
npm run transcript -- doctor          # 查看本机引擎能力与缺失项
npm run transcript -- model small     # 下载 whisper.cpp 模型（tiny/base/small/medium/large-v3）
npm run transcript -- extract <url>   # 命令行直接提取，调试用
```

`whisper.cpp`（Homebrew 的 `whisper-cli`）本身不带模型，必须单独下载 ggml 模型才能做语音转写。`mlx-whisper` 与 `openai-whisper` 自行管理模型，不需要这一步。

**模型规格怎么选**（本机实测，13 秒中文音频）：

| 规格 | 体积 | 耗时 | 中文表现 |
| --- | --- | --- | --- |
| `base` | 约 150 MB | 约 1 秒 | 错字偏多（「逐字稿」→「竹字稿」、「是」→「式」） |
| `small` | 约 490 MB | 约 3 秒 | **推荐**，「链接」「是」这类常见词都能正确落字 |

引擎会自动挑选**已下载模型里质量最高的那个**（large > medium > small > base > tiny），所以补装了更大的模型不需要改任何配置就会自动生效。
中文口播建议直接上 `small`：ASR 是逐字稿质量的唯一源头，而速度余量很大——13 秒音频只要数秒，瓶颈从不在模型大小。

**中文输出为什么是简体**：whisper.cpp 的中文结果默认是繁体、用词偏港台（实测「歡迎來到我的頻道」「視頻鏈接」）。
链路会先用 `-dl` 单独探一次语言（只读音频不解码，约 0.2 秒），**确认是中文才注入 `--prompt` 引导简体**；非中文素材不注入，避免内容被带偏甚至被翻译成中文。
实现见 `whisperCppPromptArgs()`，有单测兜着这条规则。

`.tools/` 已在 `.gitignore` 中，不会进仓库。详细设计与实现见 [`transcript/README.md`](transcript/README.md)。

> 已有平台若被 yt-dlp 支持不全（例如部分抖音分享链接），会**诚实回报失败并给出替代路径**，而不是伪造字幕。这类链接请改用 MediaCrawler 采集。

## 快速开始

### 环境要求

- Node.js：需要支持 `node:sqlite` 的版本。当前开发环境使用 Node `23.11.0`；建议 Node 22.5 或更高版本。
- npm。
- 可选：`uv`，仅用于准备 MediaCrawler。
- 可选：`pdftotext`，用于提取 PDF 正文。

### 安装并启动

```bash
npm ci
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。首次使用时创建本地工作区账号；之后直接登录即可。

生产预览：

```bash
npm run build
npm run preview
```

健康检查：

```bash
curl http://127.0.0.1:5173/api/health
```

预期返回：

```json
{"ok":true,"database":"sqlite"}
```

### 准备 MediaCrawler（可选）

```bash
git clone https://github.com/NanmiCoder/MediaCrawler.git integrations/MediaCrawler
cd integrations/MediaCrawler
uv sync
```

也可以在 Cato 的“内容情报”页面点击初始化。首次实际采集通常需要按 MediaCrawler 的流程完成平台登录；不要把 Cookie、登录态或密钥提交到本仓库。

## 配置

服务默认仅监听本机回环地址 `127.0.0.1`。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `5173` | Cato 本地服务端口。 |
| `CREATOR_OS_DATABASE_PATH` | `data/creator-os.db` | SQLite 数据库路径，适用于隔离测试或迁移。 |
| `MEDIA_CRAWLER_HOME` | `integrations/MediaCrawler` | MediaCrawler 项目目录。 |

示例：

```bash
PORT=5190 CREATOR_OS_DATABASE_PATH=/tmp/cato-test.db npm run dev
```

## WorkBuddy 接入

Cato 自带一个本机 HTTP MCP 端点（`POST {CATO_API_URL}/mcp`，Streamable HTTP 传输），不再分发 Connector 包。WorkBuddy 通过 Bearer Token 调用 Cato 受限接口；SQLite 只保存令牌哈希，Cato 仍是业务数据的唯一 owner。

### 使用步骤

1. 启动 Cato（`npm run dev` 或 `node server.mjs`），确认监听 `http://127.0.0.1:5173`。
2. 打开 Cato，左下角点击 **连接 WorkBuddy**，按 **生成连接令牌**。令牌只显示一次，重新生成会立刻让旧令牌失效。
3. 在 WorkBuddy 客户端按 `⌘K` 打开 **连接器 → 自定义连接器 → 配置 MCP**，粘贴下面的 JSON，把 `Bearer ...` 替换成上一步拿到的令牌：

   ```json
   {
     "mcpServers": {
       "cato-ai-content-workbench": {
         "url": "http://127.0.0.1:5173/mcp",
         "type": "streamable-http",
         "headers": {
           "Authorization": "Bearer 在此粘贴 Cato 令牌"
         },
         "timeout": 30000
       }
     }
   }
   ```

   也可以直接编辑 `~/.workbuddy/mcp.json` 写入同一段 JSON，再回到客户端点击新条目右侧的 **Trust** 启用。
4. 回到 Cato，点击 **测试连接** 验证 `GET /api/workbuddy/ping` 通过。
5. 若 `CATO_API_URL` 不是默认 `5173`，把上面 `url` 同步改成本机实际地址。

### WorkBuddy MCP 行为规约

写入灵感、创建项目都要求 WorkBuddy 先在对话中向用户展示将写入的内容并取得明确确认，再传 `confirmed: true`。不要把「帮我记一下」「创建一个」之外的模糊意图视为确认。创建项目时，目标平台必须是小红书、公众号或抖音；若关联选题，先确认该选题已确认，不要自行创建或确认选题。

遇到令牌无效或 Cato 无法连接时，提示用户在 Cato 端重新生成令牌并到 WorkBuddy 连接器设置更新 Bearer；不要要求用户把令牌发到对话、Issue 或代码仓库。

### 提供的工具

| 工具 | 说明 | 写入 |
| --- | --- | --- |
| `cato_search_library` | 搜索资料库（标题、正文、分类、标签） | 否 |
| `cato_read_library_document` | 读取单篇资料全文 | 否 |
| `cato_search_intelligence` | 搜索已采集的内容情报，可按小红书 / 公众号 / 抖音 筛选 | 否 |
| `cato_capture_inbox_note` | 记录一条灵感到收件箱 | 是（需 `confirmed: true`） |
| `cato_extract_video_transcript` | 从视频链接提取标题、作者与口播逐字稿，并落成内容情报 | 是（需 `confirmed: true`） |
| `cato_list_content_projects` | 列出创作项目及其审核状态 | 否 |
| `cato_create_content_project` | 创建草稿项目 | 是（需 `confirmed: true`） |

MCP 端点代码直接位于 [`server.mjs`](./server.mjs) 的 `/mcp` 路由中，无需额外目录。

## 架构

```text
React + Vite 前端
        │
        │ HTTP（仅 localhost）
        ▼
Node.js 本地服务（server.mjs）
        │
        ├── SQLite：账号、情报、灵感、选题、项目、计划、资料与版本
        ├── 本地文件：导入资料与采集结果
        ├── MediaCrawler Connector：平台采集（需登录态）
        ├── transcript 引擎：链接解析与原生字幕/ASR（无需登录态）
        └── WorkBuddy MCP 端点（/mcp）：Bearer Token 鉴权、Streamable HTTP
```

### 目录说明

```text
src/                              React 工作台界面
server.mjs                        本地 HTTP 服务、SQLite schema、业务接口与 /mcp 端点
transcript/                       链接解析与转写引擎（能力探测、字幕解析、主链路、CLI）
.tools/                           本地工具链安装目录（忽略，不随仓库发布）
data/                             本地数据库、导入文件、采集结果（不提交）
public/                           品牌资源、登录页资源
integrations/MediaCrawler/        本地 MediaCrawler checkout（忽略，不随仓库发布）
PRODUCT.md                        产品范围与交互原则
DESIGN.md                         TraeWork Light 设计规范
```

### 核心对象

- `EvidenceItem`：采集或手动录入的内容证据。
- `InboxNote`：未整理的灵感。
- `Topic`：由证据或灵感形成、等待确认的选题。
- `ContentProject`：可编辑、审核、排期与复盘的创作稿件。
- `PublicationPlan`：发布计划与已发布后的指标快照。
- `KnowledgeDocument` / `KnowledgeDocumentVersion`：运营资料及其版本。
- `CrawlerRun`：一次采集任务与导入结果。

外部项目只通过 Connector 边界访问：其 Cookie、签名、配置与存储模型不会成为 Cato 的业务数据模型。

## API 概览

所有常规业务接口均需要登录 Cookie；除健康检查和认证接口外，未登录请求会返回 `401`。

| 区域 | 主要接口 |
| --- | --- |
| 服务与认证 | `GET /api/health`、`GET /api/auth/status`、`POST /api/auth/setup`、`POST /api/auth/login`、`POST /api/auth/reset-password`、`POST /api/auth/logout`、`GET /api/account`、`PATCH /api/account` |
| 工作区加载 | `GET /api/bootstrap` |
| 自媒体账号 | `POST /api/creator-accounts`、`PUT /api/creator-accounts/:id`、`PUT /api/creator-accounts/:id/status` |
| 灵感 | `POST /api/inbox`、`POST /api/inbox/:id/topic`、`DELETE /api/inbox/:id` |
| 资料库 | `GET /api/library/context`、`POST /api/library`、`POST /api/library/import`、`PUT /api/library/:id`、`GET /api/library/:id/history` |
| 内容情报 | `POST /api/evidence`、`PUT /api/evidence/:id/archive`、`DELETE /api/evidence/:id` |
| 链接提取与转写 | `POST /api/evidence/from-url`、`POST /api/evidence/:id/transcript`、`GET /api/transcript/capabilities`、`POST /api/transcript/setup` |
| 采集 | `GET /api/connectors/mediacrawler`、`POST /api/connectors/mediacrawler/prepare`、`POST /api/crawls/mediacrawler`、`POST /api/crawls/douyin-url` |
| 选题与项目 | `POST /api/topics`、`PUT /api/topics/:id`、`POST /api/projects`、`PUT /api/projects/:id`、`POST /api/projects/:id/variants` |
| 发布与复盘 | `PUT /api/projects/:id/schedule`、`PUT /api/projects/:id/publish`、`PUT /api/projects/:id/metrics` |
| WorkBuddy | `GET /api/workbuddy/status`、`POST /api/workbuddy/token`、`GET /api/workbuddy/ping`，受 Bearer Token 保护的 `/api/workbuddy/*` 接口，以及 `POST /mcp`（Streamable HTTP MCP 端点） |

接口面向当前本地 UI 与 Connector 使用，不承诺为远程或多租户场景提供稳定公共 API。

## 开发与验证

```bash
node --check server.mjs
npm run build
```

目前已验证：

- TypeScript 构建与 Vite 生产构建。
- SQLite 初始化与健康检查。
- WorkBuddy Token 的哈希存储、受限 API 鉴权、写入确认拦截。
- Cato 内置 `/mcp` 端点：Streamable HTTP 握手、`tools/list`、`tools/call`、Bearer Token 鉴权与 `confirmed` 拦截。
- Cato 内置 `GET /api/workbuddy/ping`：返回 `{ ok, service, pingedAt }`，UI 中测试连接按钮可达。
- transcript 引擎单元测试 76 项（字幕解析、滚动重复去重、折行摊平、语言打分、模型解析、中文简体引导、引擎缺失时的失败路径）。
- `POST /api/evidence/from-url` 端到端：真实视频取到逐字稿、重复导入走更新、`404`/`401` 边界、引擎缺失时 `409 + not_configured` 且不落库。
- ASR 回落路径的完整链路：无原生字幕视频 → yt-dlp 抽音频 → whisper.cpp 转写 → 落库。CLI、API 与 UI 三层均已跑通（`S3 原生字幕：该视频没有可用字幕轨` → `S4 ASR：whisper.cpp · ggml-small.bin` → 逐字稿 · asr · zh）。

尚未作为完成证据的事项：

- 带真实登录态的平台采集、封面/评论导入与失败重试。
- WorkBuddy 客户端中的实际导入与真实对话写入。
- 云端部署、多设备同步、多人协作与真实平台自动发布。

## 常见问题

### 启动时报 `node:sqlite` 不存在

升级 Node.js 到支持 `node:sqlite` 的版本后重新执行 `npm ci`。当前项目不依赖单独安装的 SQLite 原生模块。

### 端口 5173 被占用

使用其他端口启动：

```bash
PORT=5190 npm run dev
```

若使用 WorkBuddy，需把自定义连接器配置里的 `url` 同步改为对应端口（如 `http://127.0.0.1:5190/mcp`），并重新生成 Cato 令牌。

### PDF 或 Office 文档无法导入

确认文件小于 8 MB、不是受密码保护或仅含扫描图片的文件。PDF 需要 `pdftotext`；在 macOS 以外的环境，DOC/DOCX/ODT/RTF 的正文转换需要补充系统等价工具。

### MediaCrawler 显示未准备好

确认 `integrations/MediaCrawler` 存在，安装 `uv` 后执行 `uv sync`，再回到 Cato 初始化。平台登录失败、二维码失效和平台风控属于外部连接器运行问题，应在采集任务状态中查看具体错误。

### 「从链接提取」提示引擎未就绪

在内容情报页点「从链接提取」后，面板顶部会显示引擎状态与三个引擎的明细。按缺失项处理：

- **`yt-dlp` 未安装** → 点面板里的安装按钮，或在终端执行 `npm run transcript:setup`。
- **显示「缺模型」** → 检测到 whisper.cpp 但没有 ggml 模型文件。点面板里的「下载语音模型 small（推荐）」，或执行 `npm run transcript -- model small`。这一步只影响**没有原生字幕**的视频，有字幕的视频不需要它。

运行中的服务会缓存能力探测结果（15 秒），过期后自动刷新；想立刻生效可执行 `npm run transcript -- doctor`。

若引擎已就绪但仍提取失败，通常是链接本身不支持：

- **抖音分享短链**：yt-dlp 对抖音支持有限，会诚实回报失败并给替代路径。这类链接请改用「采集内容」（MediaCrawler），或先把链接解析成完整视频地址。
- **平台风控或需登录**：报错会带上具体原因，不会伪造文本。

### 提取到的逐字稿是空的或很短

按顺序排查：

1. 视频本身没有说话（纯音乐、纯画面）→ 属正常，无口播可提。
2. 视频没有原生字幕轨，且 ASR 不可用（`npm run transcript -- doctor` 里「语音识别 不可用」）→ 只会拿到元数据，逐字稿为空。
3. 确实有字幕但没取到 → 用 `npm run transcript -- extract <url>` 在终端复现，命令会打印每个阶段的详细状态。

### WorkBuddy 连接失败

1. 在 Cato 中点击 **测试连接**，看 Cato 是否能拿到自身 `/api/workbuddy/ping` 的 `ok: true`。
2. 确认 Cato 监听地址与端口和 `~/.workbuddy/mcp.json` 中的 `url` 完全一致（默认 `http://127.0.0.1:5173/mcp`）。
3. 重新生成 Cato 令牌，并把自定义连接器配置里的 `Authorization: Bearer ...` 同步更新。
4. 确认 WorkBuddy 客户端已经对这条连接器点过 **Trust**。
5. 不要把令牌发送到聊天、Issue 或代码仓库。
