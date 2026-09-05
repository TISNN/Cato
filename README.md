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
  <a href="#快速开始">开始使用</a> · <a href="#已包含的功能">功能</a> · <a href="#workbuddy-接入">WorkBuddy</a> · <a href="#架构">架构</a>
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
- 内容情报：手动录入、内容检索、归档、从证据创建选题。
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

口播转写入口已保留，但当前未配置本地 Whisper/faster-whisper 引擎时会明确显示 `not_configured`，不会生成虚构转写内容。

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

Cato 已提供本地 WorkBuddy MCP Connector（最低 WorkBuddy 版本 `4.24.0`）。WorkBuddy 是调用层，Cato 仍是内容数据和业务规则的唯一 owner；Connector 不会直接读取 SQLite。

### 使用步骤

1. 登录 Cato，点击左下角“连接 WorkBuddy”。
2. 下载 `Cato Connector 包`，或使用 [本地下载地址](http://127.0.0.1:5173/cato-workbuddy-connector.zip)。
3. 在 WorkBuddy 的“专家·技能·连接器”中按本机 Connector 的导入或开发流程加载该包。不同客户端的本地导入入口可能不同；若客户端仅支持连接器市场，需要先走 WorkBuddy 的连接器分发流程。
4. 回到 Cato 生成连接令牌，复制到 WorkBuddy 的 Connector 表单。
5. `CATO_API_URL` 保持默认值 `http://127.0.0.1:5173`，前提是 Cato 和 WorkBuddy 运行在同一台电脑上。

重新生成令牌会使旧连接立即失效。令牌只在生成后的 Cato 页面显示一次；Cato 数据库仅保存其哈希，WorkBuddy 将凭证保存在本机。

Connector 提供的工具：

- `cato_search_library`：搜索资料库。
- `cato_read_library_document`：读取资料全文。
- `cato_search_intelligence`：搜索已采集的内容情报。
- `cato_capture_inbox_note`：记录灵感到收件箱。
- `cato_list_content_projects`：列出创作项目。
- `cato_create_content_project`：创建草稿项目。

其中记录灵感和创建项目都要求 WorkBuddy 先获得用户明确确认，随后才会传入 `confirmed: true` 执行写入。

Connector 源码位于 [`integrations/workbuddy-cato-connector`](./integrations/workbuddy-cato-connector)，包内没有真实令牌或本机数据。

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
        ├── MediaCrawler Connector：平台采集
        └── WorkBuddy MCP Connector：受限读取与确认后写入
```

### 目录说明

```text
src/                              React 工作台界面
server.mjs                        本地 HTTP 服务、SQLite schema 与业务接口
data/                             本地数据库、导入文件、采集结果（不提交）
public/                           品牌资源、登录页资源、Connector 下载包
integrations/MediaCrawler/        本地 MediaCrawler checkout（忽略，不随仓库发布）
integrations/workbuddy-cato-connector/
                                  WorkBuddy MCP Connector 源码
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
| 服务与认证 | `GET /api/health`、`GET /api/auth/status`、`POST /api/auth/setup`、`POST /api/auth/login`、`POST /api/auth/reset-password`、`POST /api/auth/logout` |
| 工作区加载 | `GET /api/bootstrap` |
| 灵感 | `POST /api/inbox`、`POST /api/inbox/:id/topic`、`DELETE /api/inbox/:id` |
| 资料库 | `GET /api/library/context`、`POST /api/library`、`POST /api/library/import`、`PUT /api/library/:id`、`GET /api/library/:id/history` |
| 内容情报 | `POST /api/evidence`、`PUT /api/evidence/:id/archive`、`DELETE /api/evidence/:id` |
| 采集 | `GET /api/connectors/mediacrawler`、`POST /api/connectors/mediacrawler/prepare`、`POST /api/crawls/mediacrawler`、`POST /api/crawls/douyin-url` |
| 选题与项目 | `POST /api/topics`、`PUT /api/topics/:id`、`POST /api/projects`、`PUT /api/projects/:id`、`POST /api/projects/:id/variants` |
| 发布与复盘 | `PUT /api/projects/:id/schedule`、`PUT /api/projects/:id/publish`、`PUT /api/projects/:id/metrics` |
| WorkBuddy | `GET /api/workbuddy/status`、`POST /api/workbuddy/token`，以及受 Bearer Token 保护的 `/api/workbuddy/*` 接口 |

接口面向当前本地 UI 与 Connector 使用，不承诺为远程或多租户场景提供稳定公共 API。

## 开发与验证

```bash
node --check server.mjs
node --check integrations/workbuddy-cato-connector/server.mjs
npm run build
```

目前已验证：

- TypeScript 构建与 Vite 生产构建。
- SQLite 初始化与健康检查。
- WorkBuddy Token 的哈希存储、受限 API 鉴权、写入确认拦截。
- WorkBuddy Connector 的 stdio MCP 初始化、工具列表和资料库搜索通路。

尚未作为完成证据的事项：

- 带真实登录态的平台采集、封面/评论导入与失败重试。
- 本地 Whisper/faster-whisper 转写。
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

若使用 WorkBuddy，需同时把 Connector 中的 `CATO_API_URL` 改为对应端口。

### PDF 或 Office 文档无法导入

确认文件小于 8 MB、不是受密码保护或仅含扫描图片的文件。PDF 需要 `pdftotext`；在 macOS 以外的环境，DOC/DOCX/ODT/RTF 的正文转换需要补充系统等价工具。

### MediaCrawler 显示未准备好

确认 `integrations/MediaCrawler` 存在，安装 `uv` 后执行 `uv sync`，再回到 Cato 初始化。平台登录失败、二维码失效和平台风控属于外部连接器运行问题，应在采集任务状态中查看具体错误。

### WorkBuddy 连接失败

确认 Cato 正在本机运行、地址与端口一致，并在 Cato 中重新生成令牌后更新 WorkBuddy 表单。若客户端未显示本地导入入口，先确认其连接器分发权限与支持方式。不要把令牌发送到聊天、Issue 或代码仓库。
