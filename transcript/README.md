# transcript

把「一条视频链接」变成「可编辑文案」的本地引擎。Cato 的「内容情报」通过它获得口播逐字稿。

## 链路

刻意与产品语义对齐，每一阶段都会记录状态，可在 UI 与 MCP 返回里审计：

| 阶段 | 做什么 | 依赖 |
| --- | --- | --- |
| S1 归一化 | 从粘贴内容里取出链接，识别平台 | 无 |
| S2 元数据 | 标题、作者、发布文案、封面、时长 | yt-dlp |
| **S3 原生字幕优先** | 抓平台已有字幕轨（**零成本**） | yt-dlp |
| S4 ASR 兜底 | 仅在 S3 拿不到字幕时才抽音频做语音识别 | yt-dlp + ffmpeg + ASR 引擎 |
| S5 后处理 | 去滚动重复、按停顿分段、成稿 | 无 |

**S3 优先是刻意的。** 平台原生字幕的成本是零，而 ASR 是按时长计费或占本机算力的。只有在视频确实没有字幕轨时才应该往下走。

当前能力分三档，由 `GET /api/transcript/capabilities` 返回的 `mode` 表示：

| mode | 含义 |
| --- | --- |
| `full` | 有字幕走字幕，没字幕走 ASR |
| `subtitle_only` | 只能处理有原生字幕的视频（缺 ffmpeg，或 ASR 引擎/模型不全） |
| `unavailable` | 缺少 yt-dlp，无法解析链接 |

## 引擎安装

```bash
npm run transcript:setup
```

会把 yt-dlp 装进项目本地的 `.tools/ytdlp` 虚拟环境。刻意不装全局：不污染用户环境，并且这个路径已在探测顺序里，换机器不用改配置。目前只需要纯 Python 依赖，不需要 brew 或编译工具链。

ASR 引擎不自动安装（体积大、平台相关）。需要时按本机情况选一个：

```bash
pip install mlx-whisper     # Apple Silicon，推荐
pip install openai-whisper  # 通用
brew install whisper-cpp    # whisper.cpp，Homebrew 里叫 whisper-cli
```

**whisper.cpp 光有二进制不够，必须再下模型**（`mlx-whisper` / `openai-whisper` 自行管理模型，不需要这步）：

```bash
npm run transcript -- model small   # tiny / base / small / medium / large-v3
```

模型落在 `.tools/models/`。探测会按「质量优先」自动挑选已下载的模型（large-v3 > large > medium > small > base > tiny）。也可以设置 `CATO_WHISPER_MODEL` 直接指向任意 ggml 文件。

**探测是诚实的**：只有 `whisper-cli` 而没有模型时，`asr.available` 会是 `false`、`mode` 停在 `subtitle_only`，并给出可执行的提示。宁可如实报「缺模型」，也不要让用户到运行时才收到一个由参数不匹配引起的怪错误。

## CLI

```bash
npm run transcript -- status          # 引擎状态（强刷新）
npm run transcript -- doctor          # 状态 + 每个引擎的用途
npm run transcript -- setup           # 安装 yt-dlp
npm run transcript -- model [size]    # 下载 whisper.cpp 模型
npm run transcript -- extract <url>   # 直接跑一次完整链路，打印每个阶段
npm run transcript:test               # 跑单测（66 项）
```

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `CATO_YTDLP_PATH` | 指定 yt-dlp 可执行文件，覆盖自动探测 |
| `CATO_FFMPEG_PATH` | 指定 ffmpeg |
| `CATO_ASR_COMMAND` | 指定 ASR 引擎，可带参数（如 `mlx_whisper --model mlx-community/whisper-large-v3-turbo`） |
| `CATO_WHISPER_MODEL` | 指定 whisper.cpp 的 ggml 模型文件 |
| `CATO_WHISPER_MODEL_DIR` | 额外的模型搜索目录 |
| `CATO_YTDLP_COOKIES_FROM_BROWSER` | 传平台登录态，如 `chrome`、`safari` |

探测顺序：环境变量 → 项目 `.tools/` → 系统路径（含 Homebrew）。

## 硬约束

**引擎缺失时一律返回 `not_configured`，`text` 必须是空串。**

这与项目既有约定一致（未配置转写引擎时不生成虚构转写内容）。任何"为了让界面好看"而填充占位文本的做法都是错的——用户会把它当成真实文案去用。

## 已知边界

- **yt-dlp 不覆盖抖音。** 抖音链接会返回 `unsupported`，引导走「抖音单条链接」采集取得视频地址。平台采集的登录态、风控问题属外部连接器责任。
- **滚动字幕去重是行级 + 邻接的。** 主流形态（YouTube 自动字幕，每条 cue 原样带下上一行）能完全还原。罕见形态是单行 cue 内部部分重叠（上一条的尾巴出现在本条中间），这种会保留重复。
  取舍是刻意偏保守：宁可残留重复，也不误删内容——重复肉眼可见可修，丢字是静默的。
- **短于 6 个字符的「上一段文本」不参与前缀判断**，避免把「我们」+「我们的目标」误切成「的目标」。
- **段落边界靠时间间隔**（默认 1.8 秒），不靠语义。超长段落在 220 字符处强制断开。
- **中英拼接规则按 CJK 占比自动切换**：中文行间不补空格，拉丁文字行间补空格。
- **ASR 引擎参数按型号分支**：`mlx` / `openai` / `whisper_cpp` 三套 CLI 参数完全不同，由 `capabilities.mjs` 的 `resolveAsr` 判定型号后在 `pipeline.mjs` 的 `transcribeWithAsr` 里分发。其余引擎需要在这里扩展。
- **中文要先探语言再注入简体 prompt**：whisper.cpp 的中文输出默认是繁体、用词偏港台（实测「歡迎來到我的頻道」「視頻鏈接」）。链路先用 `-dl` 单独探一次语言（读音频但不解码，base 实测约 0.2 秒），**确认是中文系才注入 `--prompt "以下是简体中文普通话的转写，请使用简体字。"`**。
  这个顺序不能省：中文 prompt 一旦注入到英文音频上，会把内容带偏甚至触发整段翻译，属于静默出错。规则收在 `whisperCppPromptArgs()` 里，有单测断言「英文不注入」。
- **模型默认 `small` 而非 `base`**：实测 13 秒中文音频，base 约 1 秒、small 约 3 秒——速度不是瓶颈，而 base 会把「逐字稿」听成「竹字稿」、把「是」听成「式」。探测按「质量优先」自动挑已下载的模型，所以补装更大的模型不用改配置。

## 测试

引擎的纯函数（字幕解析、去重、拼接、URL 与语言识别）不依赖外部命令，可直接单测。`extractTranscriptFromUrl` 在引擎缺失时也应返回 `not_configured` 且 `text` 为空串——这是必须守住的回退行为。
