#!/usr/bin/env node
// transcript 引擎单测。只覆盖纯函数与失败回退，不依赖本机是否装好引擎。
// 运行：npm run transcript:test
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mod = await import("./index.mjs");
const sub = await import("./subtitles.mjs");
const caps = await import("./capabilities.mjs");

let pass = 0;
let fail = 0;
const check = (name, condition, detail = "") => {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ""}`);
  }
};

console.log("\n== 1. SRT 解析 ==");
const srt = [
  "1",
  "00:00:01,000 --> 00:00:03,500",
  "大家好，这里是测试。",
  "",
  "2",
  "00:00:04,000 --> 00:00:07,000",
  "我们今天讲三个问题。",
  "",
  "3",
  "00:00:09,000 --> 00:00:12,000",
  "第一个问题是成本。",
].join("\n");
const srtCues = sub.parseSubtitlePayload(srt, ".srt");
check("解析出 3 段 cue", srtCues.length === 3, `实际 ${srtCues.length}`);
check("起始时间正确 (1s)", srtCues[0].start === 1, `实际 ${srtCues[0].start}`);
check("结束时间正确 (3.5s)", srtCues[0].end === 3.5, `实际 ${srtCues[0].end}`);
check("文本正确", srtCues[1].text === "我们今天讲三个问题。");
check("非滚动字幕判定为 false", sub.isRollingCaption(srtCues) === false);
const srtText = sub.assembleTranscript(srtCues);
check("中文行间不加空格", srtText.includes("测试。我们今天"), JSON.stringify(srtText.slice(0, 40)));
// cue1→cue2 间隔 0.5s（同一段），cue2→cue3 间隔 2.0s（换段）
check("0.5s 间隔并入同段、2.0s 间隔换段", srtText.split("\n\n").length === 2, `实际 ${srtText.split("\n\n").length} 段`);
console.log("  转写结果:", JSON.stringify(srtText));

console.log("\n== 2. VTT 自动字幕（滚动重叠）—— 回归用例 ==");
const vtt = [
  "WEBVTT",
  "",
  "00:00:00.500 --> 00:00:02.000",
  "我们都知道",
  "",
  "00:00:02.000 --> 00:00:03.500",
  "我们都知道",
  "内容运营最难的是",
  "",
  "00:00:03.500 --> 00:00:05.000",
  "内容运营最难的是",
  "素材太散",
  "",
  "00:00:05.000 --> 00:00:06.500",
  "素材太散",
  "灵感留不住",
].join("\n");
const vttCues = sub.parseSubtitlePayload(vtt, ".vtt");
check("解析出 4 段 cue", vttCues.length === 4, `实际 ${vttCues.length}`);
check("短素材也判定为滚动式（回归：守卫从 6 降到 4）", sub.isRollingCaption(vttCues) === true);
const deduped = sub.dedupeRollingCues(vttCues);
const vttText = sub.assembleTranscript(deduped);
const expected = "我们都知道内容运营最难的是素材太散灵感留不住";
check("去重后成稿完全等于原文", vttText === expected, JSON.stringify(vttText));
check("无重复「我们都知道」", (vttText.match(/我们都知道/gu) || []).length === 1, vttText);
check("无重复「内容运营最难的是」", (vttText.match(/内容运营最难的是/gu) || []).length === 1, vttText);
check("无重复「素材太散」", (vttText.match(/素材太散/gu) || []).length === 1, vttText);
console.log("  去重后:", JSON.stringify(vttText));

console.log("\n== 3. 远距离合法重复必须保留（回归：不再用全局已输出集合）==");
const chorus = [
  ["00:00:01.000", "00:00:02.000", "副歌第一句"],
  ["00:00:03.000", "00:00:04.000", "中间内容甲"],
  ["00:00:05.000", "00:00:06.000", "中间内容乙"],
  ["00:00:07.000", "00:00:08.000", "中间内容丙"],
  ["00:00:09.000", "00:00:10.000", "副歌第一句"],
]
  .map(([a, b, t], index) => `${index + 1}\n${a} --> ${b}\n${t}`)
  .join("\n\n");
const chorusCues = sub.parseSubtitlePayload(chorus, ".srt");
const chorusText = sub.assembleTranscript(sub.dedupeRollingCues(chorusCues));
check(
  "副歌重复两次都被保留",
  (chorusText.match(/副歌第一句/gu) || []).length === 2,
  chorusText,
);
console.log("  结果:", JSON.stringify(chorusText));

console.log("\n== 4. 短前缀不误切（回归：MIN_CARRY_LENGTH 守卫）==");
const shortCues = [
  ["00:00:01.000", "00:00:02.000", "我们"],
  ["00:00:02.000", "00:00:03.000", "我们的目标"],
]
  .map(([a, b, t], index) => `${index + 1}\n${a} --> ${b}\n${t}`)
  .join("\n\n");
const shortText = sub.assembleTranscript(sub.parseSubtitlePayload(shortCues, ".srt"));
check("短前缀内容不被截断", shortText.includes("我们的目标"), JSON.stringify(shortText));
console.log("  结果:", JSON.stringify(shortText), "（宁可重复也不丢字）");

console.log("\n== 5. 字幕滚动时新内容不被吞掉 ==");
const midCues = [
  ["00:00:01.000", "00:00:02.000", "内容运营最难的是"],
  ["00:00:02.000", "00:00:03.000", "内容运营最难的是素材太散"],
]
  .map(([a, b, t], index) => `${index + 1}\n${a} --> ${b}\n${t}`)
  .join("\n\n");
const midText = sub.assembleTranscript(sub.parseSubtitlePayload(midCues, ".srt"));
check("新内容「素材太散」被保留", midText.includes("素材太散"), JSON.stringify(midText));
console.log("  结果:", JSON.stringify(midText));

console.log("\n== 6. VTT 内联标签与实体 ==");
const tagged = sub.parseSubtitlePayload(
  ["WEBVTT", "", "00:00:01.000 --> 00:00:02.000", "<v Speaker>你好&nbsp;世界</v>", "&amp; 测试"].join("\n"),
  ".vtt",
);
check("剥离 <v> 标签", tagged[0].text.includes("你好 世界"), JSON.stringify(tagged[0]?.text));
check("解码实体", tagged[0].text.includes("& 测试"), JSON.stringify(tagged[0]?.text));

console.log("\n== 7. json3 解析 ==");
const json3 = JSON.stringify({
  events: [
    { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "第一句" }] },
    { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: "第二句" }] },
    { tStartMs: 5000, dDurationMs: 1000 },
  ],
});
check("解析出 2 段（跳过无 segs 的事件）", sub.parseSubtitlePayload(json3, ".json3").length === 2);

console.log("\n== 8. 英文拼接加空格 ==");
const enCues = sub.parseSubtitlePayload(
  ["1", "00:00:01,000 --> 00:00:02,000", "hello", "", "2", "00:00:02,000 --> 00:00:03,000", "world"].join("\n"),
  ".srt",
);
check("英文行间补空格", sub.assembleTranscript(enCues).includes("hello world"));

console.log("\n== 9. URL 与平台识别 ==");
check("douyin 短链", mod.detectPlatform("https://v.douyin.com/iABC123/") === "抖音");
check("b23.tv", mod.detectPlatform("https://b23.tv/abc") === "哔哩哔哩");
check("youtube", mod.detectPlatform("https://www.youtube.com/watch?v=abc") === "YouTube");
check("小红书", mod.detectPlatform("https://www.xiaohongshu.com/explore/123") === "小红书");
check("未知站归入其他", mod.detectPlatform("https://example.com/v/1") === "其他");
check("从带说明文字的文本里抽链接", mod.extractUrl("看这个 https://b23.tv/abc 很有意思") === "https://b23.tv/abc");
check("非 http 协议被拒", mod.extractUrl("ftp://example.com/a") === "");
check("无链接返回空串", mod.extractUrl("没有链接") === "");

console.log("\n== 10. 语言偏好（中文优先，且区分原轨与机器翻译轨）==");
check("zh-Hans 优先于 en", mod.pickLanguage(["en", "zh-Hans"]) === "zh-Hans");
check("zh 优先于 en-US", mod.pickLanguage(["en-US", "zh"]) === "zh");
check("zh-Hant 优先于 en", mod.pickLanguage(["en", "zh-Hant"]) === "zh-Hant");
check("只有 en 时选 en", mod.pickLanguage(["en-US", "en-GB"]) === "en-GB");
check(
  "中文机器翻译轨仍优先于英文原轨",
  mod.pickLanguage(["en", "zh-Hans-en"]) === "zh-Hans-en",
);
check("同语言内原轨优先于翻译轨", mod.languageScore("zh-Hans") < mod.languageScore("zh-Hans-en"));
check("识别三段式翻译轨", mod.isTranslatedTrack("zh-Hans-en") === true);
check("两段式不是翻译轨", mod.isTranslatedTrack("zh-Hans") === false);
check("区域码不被误判为翻译轨", mod.isTranslatedTrack("en-US") === false);
check("语言码为空时排最后", mod.languageScore("") === 99);

console.log("\n== 11. 引擎探测（只断言结构，不依赖本机装了什么）==");
const capabilities = await mod.probeCapabilities({ rootDir: ROOT, refresh: true });
check(
  "返回三个引擎条目",
  ["ytdlp", "ffmpeg", "asr"].every(
    (key) => capabilities[key] && typeof capabilities[key].available === "boolean",
  ),
);
check(
  "mode 取值合法",
  ["full", "subtitle_only", "unavailable"].includes(capabilities.mode),
  capabilities.mode,
);
check(
  "subtitlePath 跟随 ytdlp",
  capabilities.subtitlePath === capabilities.ytdlp.available,
);
check(
  "asrPath 需三者齐备",
  capabilities.asrPath ===
    Boolean(
      capabilities.ytdlp.available &&
        capabilities.ffmpeg.available &&
        capabilities.asr.available,
    ),
);
check(
  "非 full 模式必须给可执行提示",
  capabilities.mode === "full" || capabilities.hint.length > 0,
  capabilities.hint,
);
console.log("  本机实际：", capabilities.mode, "| yt-dlp:", capabilities.ytdlp.version || "未安装");

console.log("\n== 12. 未配置引擎时不产生虚构文本（项目硬约束）==");
// 注入一份「引擎全缺」的能力快照，让这条断言与本机装了什么都无关。
const emptyCapabilities = {
  ...capabilities,
  ytdlp: { ...capabilities.ytdlp, available: false, command: "", path: "" },
  subtitlePath: false,
  asrPath: false,
  mode: "unavailable",
  hint: "缺少 yt-dlp，无法解析链接。",
};
const notConfigured = await mod.extractTranscriptFromUrl({
  url: "https://www.youtube.com/watch?v=abc",
  capabilities: emptyCapabilities,
});
check("status = not_configured", notConfigured.status === "not_configured", notConfigured.status);
check("text 为空串", notConfigured.text === "", JSON.stringify(notConfigured.text));
check("stages 记录了失败阶段", notConfigured.stages.length >= 1);
check("hint 被透传", notConfigured.hint.includes("yt-dlp"), notConfigured.hint);

const badUrl = await mod.extractTranscriptFromUrl({ url: "不是链接", capabilities });
check("非法链接直接 failed（先于引擎检查）", badUrl.status === "failed", badUrl.status);
check("非法链接同样 text 为空", badUrl.text === "");

console.log("\n== 13. cue 内部折行被摊平（回归：排版折行不是语义断句）==");
const wrappedLatin = sub.parseSubtitlePayload(
  [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "We're no strangers to love",
    "You know the rules",
    "",
    "2",
    "00:00:03,000 --> 00:00:05,000",
    "and so do I",
  ].join("\n"),
  ".srt",
);
const wrappedLatinText = sub.assembleTranscript(wrappedLatin);
check(
  "拉丁文字折行摊平为一个空格",
  wrappedLatinText ===
    "We're no strangers to love You know the rules and so do I",
  JSON.stringify(wrappedLatinText),
);
const wrappedCjk = sub.parseSubtitlePayload(
  ["1", "00:00:01,000 --> 00:00:03,000", "第一行", "第二行"].join("\n"),
  ".srt",
);
check(
  "中文折行不补空格",
  sub.assembleTranscript(wrappedCjk) === "第一行第二行",
  JSON.stringify(sub.assembleTranscript(wrappedCjk)),
);

console.log("\n== 14. normalizePlainTranscript：ASR 逐行输出摊成段落 ==");
check(
  "拉丁文字多行合并为空格分隔",
  sub.normalizePlainTranscript("Hello there\nGeneral Kenobi") ===
    "Hello there General Kenobi",
  JSON.stringify(sub.normalizePlainTranscript("Hello there\nGeneral Kenobi")),
);
check(
  "中文多行不补空格",
  sub.normalizePlainTranscript("第一句话\n第二句话") === "第一句话第二句话",
);
check(
  "空行保留为段落边界",
  sub.normalizePlainTranscript("第一段一\n第一段二\n\n第二段") ===
    "第一段一第一段二\n\n第二段",
  JSON.stringify(sub.normalizePlainTranscript("第一段一\n第一段二\n\n第二段")),
);
check(
  "零宽字符与多余空格被清掉",
  sub.normalizePlainTranscript("a\u200b  b\n\n\n\nc") === "a b\n\nc",
  JSON.stringify(sub.normalizePlainTranscript("a\u200b  b\n\n\n\nc")),
);
check("空输入返回空串", sub.normalizePlainTranscript("   \n  ") === "");
check("undefined 不抛异常", sub.normalizePlainTranscript(undefined) === "");
check(
  "只有空行的输入返回空串",
  sub.normalizePlainTranscript("\n\n\n") === "",
);
check(
  "[BLANK_AUDIO] 这类非语音标记被保留（不伪造也不丢弃）",
  sub.normalizePlainTranscript("[BLANK_AUDIO]\n[BLANK_AUDIO]") ===
    "[BLANK_AUDIO] [BLANK_AUDIO]",
  JSON.stringify(sub.normalizePlainTranscript("[BLANK_AUDIO]\n[BLANK_AUDIO]")),
);

console.log("\n== 15. whisper.cpp 模型解析 ==");
const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const { join: joinPath } = await import("node:path");
const scratch = await mkdtemp(joinPath(tmpdir(), "cato-model-test-"));
const restoreEnv = process.env.CATO_WHISPER_MODEL;
delete process.env.CATO_WHISPER_MODEL;

check(
  "空目录里找不到模型",
  (await caps.resolveWhisperModel({ rootDir: scratch })) === "",
);

// 建一个假的模型目录结构，验证命名筛选与质量排序。
const { mkdir } = await import("node:fs/promises");
const modelDir = joinPath(scratch, ".tools", "models");
await mkdir(modelDir, { recursive: true });
await writeFile(joinPath(modelDir, "ggml-base.bin"), "x");
await writeFile(joinPath(modelDir, "ggml-small.bin"), "x");
await writeFile(joinPath(modelDir, "ggml-for-tests-abc.bin"), "x");
await writeFile(joinPath(modelDir, "notes.txt"), "x");
check(
  "优先选质量更高的 small 而不是 base",
  (await caps.resolveWhisperModel({ rootDir: scratch })).endsWith("ggml-small.bin"),
  await caps.resolveWhisperModel({ rootDir: scratch }),
);
check(
  "忽略非 ggml 文件与 for-tests 模型",
  !(await caps.resolveWhisperModel({ rootDir: scratch })).includes("for-tests"),
);

process.env.CATO_WHISPER_MODEL = joinPath(modelDir, "ggml-base.bin");
check(
  "CATO_WHISPER_MODEL 覆盖自动挑选",
  (await caps.resolveWhisperModel({ rootDir: scratch })).endsWith("ggml-base.bin"),
);
process.env.CATO_WHISPER_MODEL = joinPath(scratch, "不存在.bin");
check(
  "环境变量指向不存在的文件时回落到自动挑选",
  (await caps.resolveWhisperModel({ rootDir: scratch })).endsWith("ggml-small.bin"),
);
if (restoreEnv === undefined) delete process.env.CATO_WHISPER_MODEL;
else process.env.CATO_WHISPER_MODEL = restoreEnv;
await rm(scratch, { recursive: true, force: true });

console.log("\n== 16. whisper.cpp 缺模型时判定为不可用（不许虚报）==");
const fakeCaps = await caps.probeCapabilities({ rootDir: ROOT, refresh: true });
if (fakeCaps.asr.kind === "whisper_cpp") {
  check(
    "kind 为 whisper_cpp 时 available 与 model 一致",
    fakeCaps.asr.available === Boolean(fakeCaps.asr.model),
    `available=${fakeCaps.asr.available} model=${fakeCaps.asr.model}`,
  );
  check(
    "缺模型时给出可执行的下载提示",
    fakeCaps.asr.available || fakeCaps.hint.includes("transcript -- model"),
    fakeCaps.hint,
  );
} else {
  check(
    `本机 ASR 不是 whisper.cpp（kind=${fakeCaps.asr.kind}），跳过该组断言`,
    true,
  );
}

console.log("\n== 17. 中文简体引导（whisper.cpp 默认吐繁体）==");
check("zh 判定为中文", mod.isChineseLanguage("zh"));
check("zh-Hans 判定为中文", mod.isChineseLanguage("zh-Hans"));
check("cmn 判定为中文", mod.isChineseLanguage("cmn"));
check("yue 判定为中文（粤语同样吐繁体）", mod.isChineseLanguage("yue"));
check("en 不算中文", !mod.isChineseLanguage("en"));
check("空串不算中文", !mod.isChineseLanguage(""));
check("undefined 不算中文", !mod.isChineseLanguage(undefined));
check(
  "中文注入简体 prompt",
  mod.whisperCppPromptArgs("zh")[0] === "--prompt" &&
    mod.whisperCppPromptArgs("zh")[1].includes("简体"),
  JSON.stringify(mod.whisperCppPromptArgs("zh")),
);
check(
  "英文不注入 prompt（否则内容会被带偏甚至翻译成中文）",
  mod.whisperCppPromptArgs("en").length === 0,
);
check("探测失败（空语言）不注入 prompt", mod.whisperCppPromptArgs("").length === 0);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
