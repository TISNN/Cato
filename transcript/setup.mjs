import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { invalidateCapabilityCache, probeCapabilities } from "./capabilities.mjs";
import { locateCommand, runCommand } from "./proc.mjs";
/**
 * 把 yt-dlp 装到项目本地的 .tools/ytdlp 虚拟环境里。
 *
 * 刻意不装到全局：一是避免污染用户环境，二是这个路径由
 * capabilities.mjs 的探测顺序覆盖，换机器不用改配置。
 * 目前只装纯 Python 依赖，不需要 brew 或编译工具链。
 */

let state = { running: false, step: "", startedAt: "", error: "", finishedAt: "" };

export function getSetupState() {
  return { ...state };
}

export async function setupTranscriptEngine({ rootDir }) {
  if (state.running) return { ...state, alreadyRunning: true };
  state = { running: true, step: "准备中", startedAt: new Date().toISOString(), error: "", finishedAt: "" };

  const toolRoot = join(rootDir, ".tools");
  const venvRoot = join(toolRoot, "ytdlp");
  const venvPython = join(venvRoot, "bin", "python");
  const venvBinary = join(venvRoot, "bin", "yt-dlp");

  try {
    // 已经装过就直接复用，避免重复下载。
    const existing = await probeCapabilities({ rootDir, refresh: true });
    if (existing.ytdlp.available && existing.ytdlp.path.includes(".tools")) {
      state.running = false;
      state.step = "已就绪";
      state.finishedAt = new Date().toISOString();
      return { ...state, ok: true, skipped: true, capabilities: existing };
    }

    const python = await locateCommand([
      process.env.CATO_PYTHON_PATH,
      "python3",
      "python",
    ]);
    if (!python) {
      throw new Error("未找到 python3，无法创建本地虚拟环境。");
    }

    state.step = "创建本地虚拟环境";
    await mkdir(toolRoot, { recursive: true });
    const venv = await runCommand(python.command, ["-m", "venv", venvRoot], {
      timeoutMs: 180_000,
    });
    if (!venv.ok && !(await pathExists(venvPython))) {
      throw new Error(`创建虚拟环境失败：${venv.error}`);
    }

    state.step = "安装 yt-dlp";
    const install = await runCommand(
      venvPython,
      ["-m", "pip", "install", "--upgrade", "--quiet", "yt-dlp"],
      { timeoutMs: 600_000, maxStdout: 400_000 },
    );
    if (!install.ok && !(await pathExists(venvBinary))) {
      throw new Error(`安装 yt-dlp 失败：${install.error}`);
    }

    invalidateCapabilityCache();
    const capabilities = await probeCapabilities({ rootDir, refresh: true });
    state.running = false;
    state.step = "已就绪";
    state.finishedAt = new Date().toISOString();
    return { ...state, ok: true, capabilities };
  } catch (error) {
    invalidateCapabilityCache();
    state.running = false;
    state.step = "失败";
    state.error = error instanceof Error ? error.message : "安装失败。";
    state.finishedAt = new Date().toISOString();
    return { ...state, ok: false };
  }
}

async function pathExists(target) {
  return await runCommand("test", ["-e", target], { timeoutMs: 5_000 }).then(
    (result) => result.ok,
  );
}

/**
 * 下载 whisper.cpp 的 ggml 模型。
 *
 * 单独成一个动作而不是并进 setupTranscriptEngine：
 * 模型有 75 MB ~ 3 GB 的量级差异，不该在用户只想装个解析器时顺手拉下来。
 * 默认 base：中文可用、约 150 MB，是「能用」与「别等太久」之间的平衡点。
 */
const MODEL_SOURCES = {
  tiny: { file: "ggml-tiny.bin", size: "约 75 MB", note: "最快，中文准确率偏低" },
  base: { file: "ggml-base.bin", size: "约 150 MB", note: "默认，中文基本可用" },
  small: { file: "ggml-small.bin", size: "约 490 MB", note: "中文明显更准" },
  medium: { file: "ggml-medium.bin", size: "约 1.5 GB", note: "准确率高，明显更慢" },
  "large-v3": { file: "ggml-large-v3.bin", size: "约 3 GB", note: "最准，需要较大内存" },
};

export function listWhisperModels() {
  return Object.entries(MODEL_SOURCES).map(([id, meta]) => ({ id, ...meta }));
}

export async function downloadWhisperModel({ rootDir, size = "small" } = {}) {
  const key = String(size || "small").toLowerCase();
  const source = MODEL_SOURCES[key];
  if (!source) {
    return {
      ok: false,
      error: `未知的模型规格：${size}。可选：${Object.keys(MODEL_SOURCES).join("、")}`,
    };
  }
  const modelDir = join(rootDir, ".tools", "models");
  const target = join(modelDir, source.file);
  if (await pathExists(target)) {
    invalidateCapabilityCache();
    return {
      ok: true,
      skipped: true,
      path: target,
      capabilities: await probeCapabilities({ rootDir, refresh: true }),
    };
  }
  const curl = await locateCommand(["curl"]);
  if (!curl) {
    return {
      ok: false,
      error:
        "未找到 curl，无法下载模型。可手动下载后放进 .tools/models/，或设置 CATO_WHISPER_MODEL 指向已有模型。",
    };
  }
  await mkdir(modelDir, { recursive: true });
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${source.file}`;
  const download = await runCommand(
    curl.command,
    ["-L", "--fail", "--retry", "2", "-o", target, url],
    { timeoutMs: 1_800_000, maxStdout: 200_000 },
  );
  if (!download.ok || !(await pathExists(target))) {
    const raw = (download.error || "").split("\n").slice(-1)[0].trim();
    return { ok: false, error: `下载模型失败：${raw || "未生成模型文件。"}` };
  }
  invalidateCapabilityCache();
  return {
    ok: true,
    skipped: false,
    path: target,
    capabilities: await probeCapabilities({ rootDir, refresh: true }),
  };
}
