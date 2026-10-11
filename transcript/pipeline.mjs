import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { runCommand } from "./proc.mjs";
import {
  assembleTranscript,
  countChars,
  dedupeRollingCues,
  isRollingCaption,
  normalizePlainTranscript,
  parseSubtitlePayload,
} from "./subtitles.mjs";

/**
 * 链路阶段刻意与产品语义对齐（见 docs/REFERENCE_PROJECTS.md 的七步链路）：
 * S1 归一化 → S2 元数据 → S3 原生字幕优先 → S4 ASR 兜底 → S5 文本后处理
 *
 * 每一阶段都会写进 stages 数组并带 status，供 UI 与 MCP 调用方审计。
 * 任何一段失败都不允许用推测文本填充。
 */

export const PLATFORM_LABELS = {
  抖音: "抖音",
  小红书: "小红书",
  哔哩哔哩: "哔哩哔哩",
  视频号: "视频号",
  快手: "快手",
  YouTube: "YouTube",
  其他: "其他",
};

const PLATFORM_MATCHERS = [
  [["douyin.com", "iesdouyin.com"], "抖音"],
  [["xiaohongshu.com", "xhslink.com"], "小红书"],
  [["bilibili.com", "b23.tv"], "哔哩哔哩"],
  [["weixin.qq.com", "finder.video.qq.com"], "视频号"],
  [["kuaishou.com"], "快手"],
  [["youtube.com", "youtu.be"], "YouTube"],
];

export function detectPlatform(value) {
  const candidate = extractUrl(value);
  if (!candidate) return "";
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    for (const [domains, label] of PLATFORM_MATCHERS) {
      if (domains.some((domain) => host === domain || host.endsWith(`.${domain}`)))
        return label;
    }
    return "其他";
  } catch {
    return "";
  }
}

/** 从任意粘贴内容里取出第一个 http(s) 链接，容忍短链前后带说明文字。 */
export function extractUrl(value) {
  const candidate = String(value ?? "").match(/https?:\/\/[^\s"'<>]+/iu)?.[0] || "";
  if (!candidate || candidate.length > 2_000) return "";
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function cookieArgs() {
  const browser = String(process.env.CATO_YTDLP_COOKIES_FROM_BROWSER || "").trim();
  return browser ? ["--cookies-from-browser", browser] : [];
}

async function withTempDir(prefix, task) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await task(directory);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 完整的「链接 → 文案」链路。
 * @returns {Promise<object>} 结果对象。status 为 not_configured 时 text 必为空串。
 */
export async function extractTranscriptFromUrl({
  url,
  capabilities,
  maxChars = 60_000,
} = {}) {
  const stages = [];
  const record = (stage, status, detail = "") => {
    stages.push({ stage, status, detail });
  };
  const result = (payload) => ({
    status: "failed",
    source: "",
    text: "",
    language: "",
    durationSeconds: 0,
    metadata: {},
    stages,
    error: "",
    hint: "",
    ...payload,
  });

  const normalized = extractUrl(url);
  if (!normalized) {
    record("S1 归一化", "failed", "未识别到合法链接。");
    return result({ error: "请输入以 http(s) 开头的视频链接。" });
  }
  const platform = detectPlatform(normalized);
  record("S1 归一化", "succeeded", `${platform || "未知平台"} · ${normalized}`);

  if (!capabilities?.ytdlp?.available) {
    record("S2 元数据", "not_configured", "缺少 yt-dlp。");
    return result({
      status: "not_configured",
      hint:
        capabilities?.hint ||
        "缺少 yt-dlp，无法解析链接。请在项目根目录执行 npm run transcript:setup。",
    });
  }

  return withTempDir("cato-transcript-", async (workspace) => {
    // ---- S2 元数据 -------------------------------------------------------
    const metadataProbe = await runCommand(
      capabilities.ytdlp.command,
      [
        ...capabilities.ytdlp.args,
        ...cookieArgs(),
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        normalized,
      ],
      { timeoutMs: 90_000, maxStdout: 8_000_000 },
    );

    let metadata = null;
    if (metadataProbe.ok) {
      try {
        metadata = JSON.parse(metadataProbe.stdout);
      } catch {
        metadata = null;
      }
    }
    if (!metadata) {
      const raw = (metadataProbe.error || "").split("\n")[0].trim();
      const unsupported = /unsupported url|no video formats/iu.test(raw);
      record(
        "S2 元数据",
        "failed",
        raw || "yt-dlp 未能解析该链接。",
      );
      return result({
        status: unsupported ? "unsupported" : "failed",
        error: unsupported
          ? `${platform || "该平台"}链接不受 yt-dlp 支持。`
          : `解析失败：${raw || "未知错误"}`,
        hint: unsupported
          ? "yt-dlp 不覆盖抖音等平台。请改用「抖音单条链接」采集取得视频地址，或粘贴平台原生字幕可用的链接。"
          : "",
        metadata: { platform },
      });
    }

    const info = {
      platform,
      title: String(metadata.title || "").slice(0, 180),
      author: String(
        metadata.uploader || metadata.channel || metadata.creator || "",
      ).slice(0, 80),
      description: String(metadata.description || ""),
      thumbnail: String(metadata.thumbnail || ""),
      webpageUrl: String(metadata.webpage_url || normalized),
      durationSeconds: Number(metadata.duration || 0),
      extractor: String(metadata.extractor_key || metadata.extractor || ""),
    };
    record(
      "S2 元数据",
      "succeeded",
      `${info.extractor || "未知解析器"} · ${info.durationSeconds ? `${Math.round(info.durationSeconds)} 秒` : "时长未知"}`,
    );

    const manualTracks = metadata.subtitles || {};
    const automaticTracks = metadata.automatic_captions || {};
    const manualLanguage = pickLanguage(Object.keys(manualTracks));
    const automaticLanguage = manualLanguage ? "" : pickLanguage(Object.keys(automaticTracks));

    // ---- S3 原生字幕优先（零成本） ---------------------------------------
    if (manualLanguage || automaticLanguage) {
      const wanted = manualLanguage || automaticLanguage;
      const subtitleRun = await runCommand(
        capabilities.ytdlp.command,
        [
          ...capabilities.ytdlp.args,
          ...cookieArgs(),
          "--skip-download",
          "--no-warnings",
          "--no-playlist",
          ...(manualLanguage ? ["--write-subs"] : []),
          ...(automaticLanguage ? ["--write-auto-subs"] : []),
          "--sub-langs",
          wanted,
          "--sub-format",
          "srt/vtt/json3/best",
          "-o",
          join(workspace, "%(id)s.%(ext)s"),
          normalized,
        ],
        { timeoutMs: 180_000, maxStdout: 1_000_000 },
      );

      const subtitleFile = subtitleRun.ok
        ? await pickSubtitleFile(workspace)
        : null;
      if (subtitleFile) {
        const cues = parseSubtitlePayload(
          await readFile(subtitleFile, "utf8"),
          extname(subtitleFile),
        );
        const rolling = isRollingCaption(cues);
        const usable = rolling ? dedupeRollingCues(cues) : cues;
        const text = assembleTranscript(usable);
        if (text) {
          record(
            "S3 原生字幕",
            "succeeded",
            `${manualLanguage ? "人工字幕" : "自动字幕"} · ${wanted}${isTranslatedTrack(wanted) ? "（机器翻译轨）" : ""} · ${usable.length} 段${rolling ? " · 已去滚动重复" : ""}`,
          );
          record("S4 ASR", "skipped", "已有原生字幕，无需语音识别。");
          record("S5 后处理", "succeeded", `成稿 ${countChars(text)} 字符。`);
          return result({
            status: "succeeded",
            source: manualLanguage ? "platform_subtitle" : "automatic_caption",
            text: clamp(text, maxChars),
            language: wanted,
            durationSeconds: info.durationSeconds,
            metadata: info,
          });
        }
        record("S3 原生字幕", "failed", "字幕文件存在但未解析出文本。");
      } else {
        record(
          "S3 原生字幕",
          "failed",
          subtitleRun.error || "未取到字幕文件。",
        );
      }
    } else {
      record("S3 原生字幕", "skipped", "该视频没有可用字幕轨。");
    }

    // ---- S4 ASR 兜底 -----------------------------------------------------
    const missing = [];
    if (!capabilities.ffmpeg?.available) missing.push("ffmpeg");
    if (!capabilities.asr?.available) missing.push("语音识别引擎");
    if (missing.length) {
      record("S4 ASR", "not_configured", `缺少 ${missing.join(" 与 ")}。`);
      return result({
        status: "not_configured",
        metadata: info,
        hint: `该视频没有原生字幕，需要语音识别，但本机缺少 ${missing.join(" 与 ")}。${capabilities.hint || ""}`,
      });
    }

    const asr = await transcribeWithAsr({
      capabilities,
      workspace,
      source: normalized,
      language: "",
    });
    if (!asr.ok) {
      record("S4 ASR", "failed", asr.error);
      return result({ status: "failed", error: asr.error, metadata: info, hint: asr.hint });
    }
    record("S4 ASR", "succeeded", `${asr.engine} · ${countChars(asr.text)} 字符。`);
    record("S5 后处理", "succeeded", `成稿 ${countChars(asr.text)} 字符。`);
    return result({
      status: "succeeded",
      source: "asr",
      text: clamp(asr.text, maxChars),
      language: asr.language,
      durationSeconds: info.durationSeconds,
      metadata: info,
    });
  });
}

/**
 * 对已知媒体地址（如 MediaCrawler 采集到的 video_url）做语音转写。
 * 该路径无法获得字幕轨，直接走抽音频 + ASR。
 */
export async function transcribeMediaUrl({ mediaUrl, capabilities, maxChars = 60_000 } = {}) {
  const stages = [];
  const record = (stage, status, detail = "") => stages.push({ stage, status, detail });
  const normalized = extractUrl(mediaUrl);
  if (!normalized)
    return { status: "failed", text: "", error: "媒体地址无效。", stages };

  const missing = [];
  if (!capabilities?.ytdlp?.available) missing.push("yt-dlp");
  if (!capabilities?.ffmpeg?.available) missing.push("ffmpeg");
  if (!capabilities?.asr?.available) missing.push("语音识别引擎");
  if (missing.length) {
    record("S4 ASR", "not_configured", `缺少 ${missing.join(" 与 ")}。`);
    return {
      status: "not_configured",
      text: "",
      error: "",
      hint: `本机缺少 ${missing.join(" 与 ")}，无法对无字幕视频做语音转写。${capabilities?.hint || ""}`,
      stages,
    };
  }

  return withTempDir("cato-asr-", async (workspace) => {
    const asr = await transcribeWithAsr({
      capabilities,
      workspace,
      source: normalized,
      language: "",
    });
    if (!asr.ok) {
      record("S4 ASR", "failed", asr.error);
      return { status: "failed", text: "", error: asr.error, hint: asr.hint, stages };
    }
    record("S4 ASR", "succeeded", `${asr.engine} · ${countChars(asr.text)} 字符。`);
    return {
      status: "succeeded",
      text: clamp(asr.text, maxChars),
      language: asr.language,
      error: "",
      hint: "",
      stages,
    };
  });
}

async function transcribeWithAsr({ capabilities, workspace, source, language }) {
  const audio = await runCommand(
    capabilities.ytdlp.command,
    [
      ...capabilities.ytdlp.args,
      ...cookieArgs(),
      "--no-warnings",
      "--no-playlist",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "7",
      "-o",
      join(workspace, "audio.%(ext)s"),
      source,
    ],
    { timeoutMs: 600_000, maxStdout: 1_000_000 },
  );

  const audioFiles = (await readdir(workspace).catch(() => [])).filter((name) =>
    /^audio\./u.test(name),
  );
  if (!audioFiles.length) {
    const raw = (audio.error || "").split("\n").slice(-1)[0].trim();
    return { ok: false, error: `抽取音频失败：${raw || "未生成音频文件。"}` };
  }
  const audioPath = join(workspace, audioFiles[0]);
  const kind = capabilities.asr.kind || "unknown";
  const engineLabel =
    kind === "whisper_cpp"
      ? `whisper.cpp · ${basename(capabilities.asr.model || "")}`
      : kind;

  let asrArgs;
  let outputPath;
  // whisper.cpp 单独探测出的实际语言；其余引擎沿用调用方传入值。
  let spokenLanguage = language || "";
  if (kind === "mlx") {
    outputPath = join(workspace, "transcript.txt");
    asrArgs = [
      ...capabilities.asr.args,
      audioPath,
      "--output-dir",
      workspace,
      "--output-format",
      "txt",
      "--output-name",
      "transcript",
      ...(language ? ["--language", language] : []),
    ];
  } else if (kind === "whisper_cpp") {
    // whisper.cpp 的 CLI（whisper-cli）。参数与 openai-whisper 完全不同，
    // 用错会直接退出而不是产出文件。必须显式指定 -m 模型。
    //
    // 没指定语言时先单独探一次：whisper.cpp 的中文输出默认是繁体、用词偏港台
    // （实测「歡迎來到我的頻道」），要靠 initial prompt 掰成简体普通话；但中文
    // prompt 注入到英文音频上会把内容带偏甚至触发翻译，所以必须先确认语言。
    const spoken = language || (await detectSpokenLanguage({ capabilities, audioPath }));
    spokenLanguage = spoken;
    outputPath = join(workspace, "transcript.txt");
    asrArgs = [
      ...capabilities.asr.args,
      "-m",
      capabilities.asr.model,
      "-f",
      audioPath,
      "-l",
      spoken || "auto",
      "-otxt",
      "-nt",
      "-np",
      "-of",
      join(workspace, "transcript"),
      ...whisperCppPromptArgs(spoken),
    ];
  } else if (kind === "openai") {
    outputPath = join(workspace, "transcript.txt");
    asrArgs = [
      ...capabilities.asr.args,
      audioPath,
      "--output_dir",
      workspace,
      "--output_format",
      "txt",
      ...(language ? ["--language", language] : []),
    ];
  } else {
    return {
      ok: false,
      error: `不支持的语音识别引擎：${basename(capabilities.asr.command) || "未知"}。`,
      hint: "当前支持 mlx_whisper、openai-whisper 与 whisper.cpp（whisper-cli）。可用 CATO_ASR_COMMAND 指定。",
    };
  }

  const asrRun = await runCommand(capabilities.asr.command, asrArgs, {
    cwd: workspace,
    timeoutMs: 1_800_000,
    maxStdout: 1_000_000,
  });

  const candidates = [outputPath, join(workspace, `${basename(audioPath, extname(audioPath))}.txt`)];
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (!info.isFile() || info.size === 0) continue;
      const text = normalizePlainTranscript(await readFile(candidate, "utf8"));
      if (text) return { ok: true, text, language: spokenLanguage || language, engine: engineLabel };
    } catch {
      // 继续尝试下一个候选路径。
    }
  }
  // 失败时把「退出码 / stderr 尾部 / 工作目录里实际有哪些文件」一起带出去。
  // 只报「未生成转写文件」会让排查变成猜谜：真因可能是参数、可能是输入格式、
  // 也可能只是输出路径与预期不符。
  const produced = (await readdir(workspace).catch(() => [])).join("、") || "（空）";
  const tail = (value) =>
    String(value || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-2)
      .join(" / ");
  const diagnostic = [
    asrRun.code === null ? "未能启动" : `退出码 ${asrRun.code}`,
    tail(asrRun.stderr) || tail(asrRun.stdout),
    `工作目录产物：${produced}`,
  ]
    .filter(Boolean)
    .join("；");
  return {
    ok: false,
    error: `语音识别失败（${kind}）：${diagnostic}`,
    hint: `确认 ${basename(capabilities.asr.command)} 能直接处理该音轨格式；也可用 npm run transcript -- extract 复现。`,
  };
}

/**
 * 字幕语言打分。两层规则叠在一起：
 *
 *   1) 语言偏好：中文 > 英文 > 其他（产品面向中文创作）
 *   2) 原轨 vs 翻译轨：`zh-Hans-en` 这种三段式是「以英文为源的机器翻译轨」，
 *      同语言内排在原轨之后。
 *
 * 注意第 2 层不会把中文翻译轨压到英文原轨之下——中文文案对目标用户更可直接使用。
 * 人工字幕与自动字幕的优先级**不在**这里处理：调用方先选人工轨，没有再落到自动轨。
 */
export function languageScore(code) {
  const value = String(code || "").toLowerCase();
  if (!value) return 99;
  const translated = isTranslatedTrack(value);
  if (value.startsWith("zh")) return translated ? 1 : 0;
  if (value.startsWith("en")) return translated ? 4 : 2;
  return translated ? 5 : 3;
}

/** 平台把翻译轨命名为 `<目标语言>-<源语言>`，三段以上即视为机器翻译轨。 */
export function isTranslatedTrack(code) {
  return String(code || "").toLowerCase().split("-").length >= 3;
}

/**
 * whisper.cpp 的中文输出默认是繁体、用词偏港台，靠 initial prompt 掰成简体普通话。
 * 实测 base 模型不加这句必然输出「歡迎來到我的頻道」「視頻鏈接」。
 * 模型越大越少出错，但方向问题依旧，所以 prompt 不能省。
 */
const SIMPLIFIED_CHINESE_PROMPT = "以下是简体中文普通话的转写，请使用简体字。";

/** 会被 whisper 归入中文系的语言码。粤语/吴语等方言同样吐繁体字，一并纳入。 */
const CHINESE_LANGUAGE_CODES = new Set([
  "zh",
  "zh-cn",
  "zh-hans",
  "zh-tw",
  "cmn",
  "yue",
  "wuu",
  "nan",
  "hak",
]);

export function isChineseLanguage(code) {
  return CHINESE_LANGUAGE_CODES.has(String(code || "").trim().toLowerCase());
}

/**
 * 只有中文系语言才注入简体 prompt。
 * 单独抽出来是为了可测——这条规则一旦写反（例如对所有语言都注入），
 * 英文素材会被带偏甚至被翻译成中文，属于静默出错，必须有断言兜着。
 */
export function whisperCppPromptArgs(language) {
  return isChineseLanguage(language) ? ["--prompt", SIMPLIFIED_CHINESE_PROMPT] : [];
}

/**
 * 用 whisper.cpp 的 -dl 单独探一次语言后立即退出。
 * 代价只是读一遍音频、不做解码（base 实测约 0.2 秒），换来确定性：
 * 比把 -l auto 交给解码过程、解码到一半才发现判断错了要稳。
 * 探测失败返回空串，调用方据此回退到 -l auto 且不注入 prompt。
 */
async function detectSpokenLanguage({ capabilities, audioPath }) {
  const probe = await runCommand(
    capabilities.asr.command,
    [...capabilities.asr.args, "-m", capabilities.asr.model, "-f", audioPath, "-dl"],
    { timeoutMs: 300_000, maxStdout: 200_000, maxStderr: 200_000 },
  );
  const match = `${probe.stdout}\n${probe.stderr}`.match(
    /auto-detected language:\s*([A-Za-z][A-Za-z-]{1,7})/u,
  );
  return match ? match[1].toLowerCase() : "";
}

export function pickLanguage(languages = []) {
  const list = languages.filter(Boolean);
  if (!list.length) return "";
  return [...list].sort(
    (a, b) => languageScore(a) - languageScore(b) || a.localeCompare(b),
  )[0];
}

async function pickSubtitleFile(workspace) {
  const entries = await readdir(workspace).catch(() => []);
  const candidates = entries.filter((name) => /\.(srt|vtt|json3|json)$/iu.test(name));
  if (!candidates.length) return null;
  const rank = (name) => {
    const ext = extname(name).slice(1).toLowerCase();
    return ["srt", "vtt", "json3", "json"].indexOf(ext);
  };
  candidates.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return join(workspace, candidates[0]);
}

function clamp(text, maxChars) {
  const value = String(text || "").trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[转写内容超出 ${maxChars} 字符上限，已截断]`;
}
