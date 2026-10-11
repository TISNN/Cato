/**
 * 平台字幕解析与后处理。
 *
 * 两种字幕的质量差距很大，不能在输出里混为一谈：
 *   人工字幕（subtitles）        → 断句干净，可直接用
 *   自动字幕（automatic_captions）→ 滚动式重叠，同一行会被相邻 cue 反复输出
 *
 * 自动字幕不去重的话，转写稿会变成「A B / B C / C D」这种阅读灾难。
 * 这里的做法是：先探测是否滚动式，再只对滚动式做「上一行已输出则跳过」，
 * 避免误伤正常字幕里合法的重复（如副歌、叠句）。
 */

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;
const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function parseTimestamp(value) {
  const match = String(value || "")
    .trim()
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/u);
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  const ms = Number(fraction.padEnd(3, "0"));
  return (
    Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds) + ms / 1000
  );
}

function stripMarkup(line) {
  return line
    .replace(/<[^>]*>/gu, "")
    .replace(/&[a-z#0-9]+;/giu, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[\u200b-\u200f\ufeff]/gu, "")
    .replace(/[ \t]+/gu, " ")
    .trim();
}

/** 解析 SRT / WebVTT / YouTube json3，统一成 cue 列表。 */
export function parseSubtitlePayload(content, extension = "") {
  const ext = String(extension || "").toLowerCase().replace(/^\./u, "");
  if (ext === "json3" || ext === "json" || content.trimStart().startsWith("{")) {
    return parseJson3(content);
  }
  return parseSrtOrVtt(content);
}

function parseJson3(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const events = Array.isArray(data?.events) ? data.events : [];
  const cues = [];
  for (const event of events) {
    if (!Array.isArray(event?.segs)) continue;
    const text = event.segs
      .map((segment) => segment?.utf8 ?? "")
      .join("");
    const cleaned = stripMarkup(text.replace(/\n/gu, " "));
    if (!cleaned) continue;
    const start = Number(event.tStartMs || 0) / 1000;
    cues.push({
      start,
      end: start + Number(event.dDurationMs || 0) / 1000,
      text: cleaned,
    });
  }
  return cues;
}

function parseSrtOrVtt(content) {
  const cues = [];
  // 时间轴行同时兼容 SRT 的逗号毫秒与 VTT 的句点毫秒。
  const blocks = String(content || "")
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u);
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim());
    if (!lines.length) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex === -1) continue;
    const [rawStart, rawEnd] = lines[timingIndex].split("-->");
    const start = parseTimestamp(rawStart);
    if (start === null) continue;
    const end = parseTimestamp(rawEnd) ?? start;
    const text = lines
      .slice(timingIndex + 1)
      .map(stripMarkup)
      .filter(Boolean)
      .join("\n");
    if (!text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * 滚动式自动字幕的探测。
 * 判据：相邻 cue 之间共享至少一行的比例高于阈值。
 * 正常字幕几乎不会出现这种情况，滚动式字幕则几乎必然出现。
 *
 * 下限刻意压到 4 段：短素材（十几秒的切片）同样会滚动，
 * 漏判的代价是整篇重复句，比偶尔误判重得多。
 */
export function isRollingCaption(cues, threshold = 0.3) {
  if (cues.length < 4) return false;
  let shared = 0;
  for (let index = 1; index < cues.length; index += 1) {
    const previous = new Set(cues[index - 1].text.split("\n"));
    if (cues[index].text.split("\n").some((line) => previous.has(line))) shared += 1;
  }
  return shared / (cues.length - 1) >= threshold;
}

/**
 * 去掉滚动式字幕里被「带下来」的重复行。
 *
 * 只跟紧邻的上一条 cue 比对，不用全局已输出集合——
 * 滚动字幕的机制是原样带下上一行，而副歌、叠句、口头禅这类
 * 合法的远距离重复必须保留，用全局集合会误删后者。
 */
export function dedupeRollingCues(cues) {
  const result = [];
  let previousLines = [];
  for (const cue of cues) {
    const lines = cue.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const fresh = lines.filter((line) => !previousLines.includes(line));
    previousLines = lines;
    if (!fresh.length) continue;
    result.push({ ...cue, text: fresh.join("\n") });
  }
  return result;
}

function isCjkDominant(text) {
  const sample = text.replace(/\s/gu, "");
  if (!sample) return true;
  let cjk = 0;
  for (const char of sample) if (CJK_PATTERN.test(char)) cjk += 1;
  return cjk / sample.length >= 0.15;
}

/**
 * 把 cue 序列拼成可读转写稿。
 * 拼接规则按语言区分：中文行间不加空格，拉丁文字行间补空格——
 * 否则中文会连成一片、英文单词会粘在一起。
 * 段落边界用时间间隔判断：停顿超过阈值即视为换段。
 */
export function assembleTranscript(cues, options = {}) {
  const { paragraphGapSeconds = 1.8, maxParagraphChars = 220 } = options;
  const list = Array.isArray(cues) ? cues.filter((cue) => cue?.text?.trim()) : [];
  if (!list.length) return "";
  const cjk = isCjkDominant(list.map((cue) => cue.text).join(""));
  const separator = cjk ? "" : " ";
  const paragraphs = [];
  let current = "";
  let previousEnd = null;
  let previousText = "";

  const flush = () => {
    const text = current.replace(/\s{2,}/gu, " ").trim();
    if (text) paragraphs.push(text);
    current = "";
  };

  for (const cue of list) {
    const gap = previousEnd === null ? 0 : cue.start - previousEnd;
    const tooLong = current.length >= maxParagraphChars;
    if (previousEnd !== null && (gap >= paragraphGapSeconds || tooLong)) flush();
    const joined = joinSegment(previousText, cue.text);
    if (joined === null) {
      // 当前 cue 完整包含上一次的文本（滚动字幕合并行的情况）。
      previousEnd = Math.max(previousEnd ?? 0, cue.end);
      continue;
    }
    // cue 内部的换行是字幕排版折行，不是语义断句——按语言规则摊平，
    // 否则逐字稿会保留一堆来源字幕的折行宽度。
    const inline = joined.replace(/\s*\n\s*/gu, separator);
    if (inline) current = current ? `${current}${separator}${inline}` : inline;
    previousText = cue.text;
    previousEnd = cue.end;
  }
  flush();
  return paragraphs.join("\n\n");
}

/**
 * 把纯文本转写（ASR 的输出）摊成与字幕路径同构的段落稿。
 *
 * whisper 系引擎按语音片段逐行输出，行长由模型分段决定而非语义决定，
 * 直接保留会得到一堆平均十几个字的短行。空行仍视为段落边界。
 */
export function normalizePlainTranscript(text) {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  const separator = isCjkDominant(raw) ? "" : " ";
  const blocks = raw
    .split(/\n\s*\n/u)
    .map((block) =>
      block
        .split(/\n/u)
        .map((line) => stripMarkup(line))
        .filter(Boolean)
        .join(separator),
    )
    .filter(Boolean);
  return blocks.join("\n\n").replace(/[ \t]{2,}/gu, " ").trim();
}

/** 少于这个长度的「上一段文本」不参与前缀/包含判断，避免把正常的短句误切。 */
const MIN_CARRY_LENGTH = 6;

/**
 * 处理「上一条 cue 的文本被带到本条」的情况。
 * 返回本条相对上一条新增的内容；返回 null 表示本条完全是带下来的重复。
 *
 * 包含判断用「挖掉后拼两侧」而不是直接丢弃整条——
 * 直接丢弃会把字幕在中间滚动时的新内容一起吃掉，那是不可逆的信息损失。
 */
function joinSegment(previous, next) {
  const trimmed = next.trim();
  if (!trimmed) return "";
  if (!previous) return trimmed;
  if (trimmed === previous) return null;
  if (previous.length < MIN_CARRY_LENGTH) return trimmed;
  if (trimmed.startsWith(previous)) return trimmed.slice(previous.length).trim();
  const index = trimmed.indexOf(previous);
  if (index >= 0)
    return `${trimmed.slice(0, index)}${trimmed.slice(index + previous.length)}`.trim();
  return trimmed;
}

export function countChars(text) {
  return Array.from(String(text || "")).length;
}
