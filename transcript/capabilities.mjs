import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { locateCommand } from "./proc.mjs";

/**
 * 引擎探测。三条能力分别决定链路能走到哪一步：
 *
 *   ytdlp   → 决定 S2 元数据与 S3「原生字幕优先」是否可用（零成本路径）
 *   ffmpeg  → ASR 路径的前置（抽音频）
 *   asr     → 语音识别引擎（仅在没有原生字幕时才需要）
 *
 * 这些能力全部缺失时，调用方必须返回 not_configured，
 * 不允许生成任何占位或推测文本。
 */
export async function probeCapabilities({ rootDir, refresh = false } = {}) {
  if (
    !refresh &&
    cached &&
    cached.rootDir === rootDir &&
    Date.now() - cached.at < CACHE_TTL_MS
  ) {
    return { ...cached.value, cached: true };
  }
  const localToolRoot = join(rootDir, ".tools");
  const [ytdlp, ffmpeg, asr] = await Promise.all([
    locateCommand([
      process.env.CATO_YTDLP_PATH,
      join(localToolRoot, "ytdlp", "bin", "yt-dlp"),
      "yt-dlp",
      "yt-dlp.exe",
    ]),
    locateCommand([process.env.CATO_FFMPEG_PATH, "ffmpeg"]),
    locateCommand([
      process.env.CATO_ASR_COMMAND,
      // Apple Silicon 上 mlx-whisper 比 openai-whisper 快得多，优先探测。
      "mlx_whisper",
      "whisper-cli",
      "whisper",
    ]),
  ]);

  const subtitlePath = Boolean(ytdlp);
  const asrInfo = await resolveAsr({ located: asr, rootDir });
  // whisper.cpp 光有二进制不够，必须带模型文件；缺模型时宁可报不可用，
  // 也不要让用户以为能用、到运行时才失败。
  const asrPath = Boolean(ytdlp && ffmpeg && asrInfo.usable);

  const value = {
    ytdlp: describe("ytdlp", "yt-dlp", ytdlp, "用于解析链接元数据与抓取平台原生字幕。"),
    ffmpeg: describe("ffmpeg", "ffmpeg", ffmpeg, "ASR 路径需要它把视频抽成音频。"),
    asr: {
      ...describe("asr", asrInfo.label, asr, "仅在平台没有原生字幕时才需要。"),
      available: Boolean(asrInfo.usable),
      kind: asrInfo.kind,
      model: asrInfo.model,
      // 二进制在、但缺模型：单独标出来，供 buildHint 给出可执行指引。
      missingModel: asrInfo.missingModel,
    },
    subtitlePath,
    asrPath,
    mode: subtitlePath ? (asrPath ? "full" : "subtitle_only") : "unavailable",
    checkedAt: new Date().toISOString(),
    localToolRoot,
  };
  value.hint = buildHint(value);
  cached = { rootDir, value, at: Date.now() };
  return value;
}

export function invalidateCapabilityCache() {
  cached = null;
}

let cached = null;

/**
 * 缓存存活时间。刻意设得很短：探测只是几个 `command -v` 与 `--version`，
 * 代价远低于「用户在终端跑完 npm run transcript:setup、界面却还显示未安装」
 * 这种必须重启服务才能好的一次性困惑。
 */
const CACHE_TTL_MS = 15_000;

const WHISPER_MODEL_RANK = [
  "large-v3",
  "large-v2",
  "large",
  "medium",
  "small",
  "base",
  "tiny",
];

function describe(id, label, located, purpose) {
  return {
    id,
    label,
    purpose,
    available: Boolean(located),
    path: located?.path || "",
    version: located?.version || "",
    command: located?.command || "",
    args: located?.args || [],
  };
}

/**
 * 判定 ASR 引擎型号，并解析 whisper.cpp 需要的模型文件。
 * 不同引擎的参数完全不同，必须在探测阶段就定下来，
 * 否则会把 openai-whisper 的参数喂给 whisper.cpp，失败原因还很难看懂。
 */
async function resolveAsr({ located, rootDir }) {
  if (!located) {
    return { usable: false, label: "语音识别引擎", kind: "none", model: "", missingModel: false };
  }
  const name = (basename(located.command) || located.command).toLowerCase();
  const kind = name.includes("mlx")
    ? "mlx"
    : name.includes("whisper-cli") || name.includes("whisper.cpp")
      ? "whisper_cpp"
      : name.includes("whisper")
        ? "openai"
        : "unknown";
  if (kind !== "whisper_cpp") {
    return {
      usable: true,
      label: name || located.command,
      kind,
      model: "",
      missingModel: false,
    };
  }
  const model = await resolveWhisperModel({ rootDir });
  return {
    usable: Boolean(model),
    label: name,
    kind,
    model,
    missingModel: !model,
  };
}

/**
 * 找 whisper.cpp 的 ggml 模型。按「质量优先」排序，
 * 找不到返回空串——调用方据此把 ASR 标为不可用。
 */
export async function resolveWhisperModel({ rootDir } = {}) {
  const explicit = process.env.CATO_WHISPER_MODEL;
  if (explicit && (await isFile(explicit))) return explicit;
  const directories = [
    process.env.CATO_WHISPER_MODEL_DIR,
    join(rootDir, ".tools", "models"),
    join(homedir(), ".cache", "whisper.cpp"),
    "/opt/homebrew/share/whisper.cpp",
    "/usr/local/share/whisper.cpp",
  ].filter(Boolean);
  const found = [];
  for (const directory of directories) {
    const names = await readdir(directory).catch(() => []);
    for (const entry of names) {
      if (!/^ggml-.*\.bin$/u.test(entry)) continue;
      // for-tests 这类模型是给上游做回归的，体积小但质量不可用。
      if (entry.includes("for-tests")) continue;
      found.push(join(directory, entry));
    }
  }
  if (!found.length) return "";
  const rank = (file) => {
    const name = basename(file).toLowerCase();
    const index = WHISPER_MODEL_RANK.findIndex((key) => name.includes(key));
    return index === -1 ? WHISPER_MODEL_RANK.length : index;
  };
  return found.sort((a, b) => rank(a) - rank(b))[0];
}

async function isFile(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

function buildHint(capabilities) {
  if (capabilities.mode === "full") return "";
  if (!capabilities.ytdlp.available) {
    return "缺少 yt-dlp：无法解析链接与原生字幕。可在「内容情报」点击安装，或在项目根目录执行 npm run transcript:setup。";
  }
  if (!capabilities.ffmpeg.available) {
    return "已具备原生字幕提取能力。缺少 ffmpeg，暂不能对没有字幕的视频做语音转写。macOS 可执行 brew install ffmpeg。";
  }
  if (capabilities.asr.missingModel) {
    return "已具备原生字幕提取能力。检测到 whisper.cpp，但缺少模型文件，暂不能对没有字幕的视频做语音转写。执行 npm run transcript -- model 下载模型（默认 small，约 490 MB；中文口播推荐，base 错字偏多）。";
  }
  if (!capabilities.asr.available) {
    return "已具备原生字幕提取能力。缺少语音识别引擎，暂不能对没有字幕的视频做语音转写。可执行 pip install mlx-whisper（Apple Silicon），或安装 whisper.cpp 并下载模型。";
  }
  return "";
}
