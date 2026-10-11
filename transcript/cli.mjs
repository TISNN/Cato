#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { probeCapabilities } from "./capabilities.mjs";
import {
  downloadWhisperModel,
  listWhisperModels,
  setupTranscriptEngine,
} from "./setup.mjs";
import { extractTranscriptFromUrl } from "./pipeline.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const command = (process.argv[2] || "status").toLowerCase();

function printStatus(capabilities) {
  const line = (entry) => {
    // 二进制在、但不满足可用条件（例如 whisper.cpp 缺模型）时，
    // 仍然把路径打出来，避免用户以为「根本没装」。
    const detail = entry.path
      ? `${entry.path}${entry.available ? "" : "  ⚠ 缺少依赖"}`
      : "未检测到";
    console.log(
      `  ${entry.available ? "✓" : "✗"} ${entry.label.padEnd(22)} ${detail}${
        entry.version ? `  (${entry.version})` : ""
      }`,
    );
  };
  console.log("转写引擎状态");
  line(capabilities.ytdlp);
  line(capabilities.ffmpeg);
  line(capabilities.asr);
  console.log(`\n  模式：${capabilities.mode}`);
  console.log(
    `  能力：原生字幕 ${capabilities.subtitlePath ? "可用" : "不可用"} · 语音识别 ${
      capabilities.asrPath ? "可用" : "不可用"
    }`,
  );
  if (capabilities.hint) console.log(`\n  ${capabilities.hint}`);
}

function printStages(stages = []) {
  for (const stage of stages) {
    console.log(`  [${String(stage.status).padEnd(15)}] ${stage.stage}  ${stage.detail}`);
  }
}

// status 与 doctor 语义一致：都做一次强刷新探测。
// doctor 额外打印每个引擎的用途，便于排查「缺哪个、为什么需要」。
if (command === "status" || command === "doctor") {
  const capabilities = await probeCapabilities({ rootDir, refresh: true });
  printStatus(capabilities);
  if (command === "doctor") {
    console.log("\n  引擎用途");
    for (const entry of [capabilities.ytdlp, capabilities.ffmpeg, capabilities.asr]) {
      console.log(`    ${entry.label.padEnd(18)} ${entry.purpose}`);
    }
  }
  process.exit(0);
}

if (command === "extract") {
  const url = process.argv[3];
  if (!url) {
    console.error("用法：npm run transcript -- extract <视频链接>");
    process.exit(1);
  }
  const capabilities = await probeCapabilities({ rootDir });
  console.log(`链接：${url}\n模式：${capabilities.mode}\n`);
  const outcome = await extractTranscriptFromUrl({ url, capabilities });
  printStages(outcome.stages);
  console.log(`\n状态：${outcome.status}`);
  if (outcome.source) console.log(`来源：${outcome.source} · 语言：${outcome.language || "未知"}`);
  if (outcome.metadata?.title) console.log(`标题：${outcome.metadata.title}`);
  if (outcome.error) console.log(`错误：${outcome.error}`);
  if (outcome.hint) console.log(`提示：${outcome.hint}`);
  if (outcome.text) {
    const chars = Array.from(outcome.text).length;
    console.log(`\n逐字稿（${chars} 字）：\n${outcome.text}`);
  }
  process.exit(outcome.status === "succeeded" ? 0 : 1);
}

if (command === "setup") {
  console.log("正在安装 yt-dlp 到项目本地 .tools/ytdlp …\n");
  const result = await setupTranscriptEngine({ rootDir });
  if (result.ok && result.capabilities) {
    console.log(result.skipped ? "已是最新，无需重复安装。\n" : "安装完成。\n");
    printStatus(result.capabilities);
    process.exit(0);
  }
  console.error(`安装失败：${result.error || "未知错误"}`);
  process.exit(1);
}

// 只有 whisper.cpp 才需要单独下模型：mlx / openai 系的模型由引擎自己管。
if (command === "model") {
  const size = (process.argv[3] || "small").toLowerCase();
  if (!listWhisperModels().some((entry) => entry.id === size)) {
    console.error(
      `未知规格：${size}\n可选：${listWhisperModels()
        .map((entry) => `${entry.id}（${entry.size}，${entry.note}）`)
        .join("\n      ")}`,
    );
    process.exit(1);
  }
  console.log(`正在下载 whisper.cpp 模型 ${size} 到 .tools/models/ …\n`);
  const result = await downloadWhisperModel({ rootDir, size });
  if (result.ok) {
    console.log(result.skipped ? "模型已存在，跳过下载。\n" : "下载完成。\n");
    if (result.capabilities) printStatus(result.capabilities);
    process.exit(0);
  }
  console.error(`失败：${result.error}`);
  process.exit(1);
}

console.error(
  `未知命令：${command}\n可用命令：status、doctor、setup、model [size]、extract <url>`,
);
process.exit(1);
