import { createServer } from "node:http";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, extname, join, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer as createViteServer } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const isDevelopment = process.argv.includes("--dev");
const dataDir = join(rootDir, "data");
const databasePath =
  process.env.CREATOR_OS_DATABASE_PATH || join(dataDir, "creator-os.db");
const mediaCrawlerRoot =
  process.env.MEDIA_CRAWLER_HOME ||
  join(rootDir, "integrations", "MediaCrawler");
const mediaCrawlerOutputRoot = join(dataDir, "mediacrawler-runs");
const libraryUploadsRoot = join(dataDir, "library-uploads");
const port = Number(process.env.PORT || 5173);
const activeCrawlerProcesses = new Map();
let mediaCrawlerSetupProcess = null;

await mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS evidence_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL,
    author TEXT NOT NULL,
    signal TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    image_urls TEXT NOT NULL DEFAULT '[]',
    video_url TEXT NOT NULL DEFAULT '',
    transcript TEXT NOT NULL DEFAULT '',
    transcript_status TEXT NOT NULL DEFAULT 'not_requested',
    created_at TEXT NOT NULL,
    source_provider TEXT NOT NULL DEFAULT 'manual',
    source_external_id TEXT NOT NULL DEFAULT '',
    crawl_run_id TEXT,
    archived_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    angle TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('待确认', '已确认')),
    source_note_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS topic_evidence (
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
    PRIMARY KEY (topic_id, evidence_id)
  );
  CREATE TABLE IF NOT EXISTS content_projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('草稿', '待审核')),
    body TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT '草稿',
    review_note TEXT NOT NULL DEFAULT '',
    content_format TEXT NOT NULL DEFAULT '图文笔记',
    source_project_id TEXT REFERENCES content_projects(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS publication_plans (
    project_id TEXT PRIMARY KEY REFERENCES content_projects(id) ON DELETE CASCADE,
    scheduled_at TEXT NOT NULL,
    published_at TEXT,
    published_url TEXT NOT NULL DEFAULT '',
    metric_views INTEGER NOT NULL DEFAULT 0,
    metric_likes INTEGER NOT NULL DEFAULT 0,
    metric_comments INTEGER NOT NULL DEFAULT 0,
    metric_saves INTEGER NOT NULL DEFAULT 0,
    metrics_recorded_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS crawler_runs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    platform TEXT NOT NULL,
    query TEXT NOT NULL,
    max_items INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    output_path TEXT NOT NULL,
    imported_count INTEGER NOT NULL DEFAULT 0,
    imported_comments INTEGER NOT NULL DEFAULT 0,
    capture_mode TEXT NOT NULL DEFAULT 'keyword',
    source_url TEXT NOT NULL DEFAULT '',
    transcript_status TEXT NOT NULL DEFAULT 'not_requested',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS evidence_comments (
    id TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
    source_provider TEXT NOT NULL,
    source_external_id TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    like_count INTEGER NOT NULL DEFAULT 0,
    reply_count INTEGER NOT NULL DEFAULT 0,
    commented_at TEXT NOT NULL DEFAULT '',
    crawl_run_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(source_provider, source_external_id)
  );
  CREATE TABLE IF NOT EXISTS inbox_notes (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '未分类',
    tags TEXT NOT NULL DEFAULT '[]',
    ai_readable INTEGER NOT NULL DEFAULT 1 CHECK (ai_readable IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL DEFAULT '人工',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    archived_at TEXT NOT NULL DEFAULT '',
    source_file_name TEXT NOT NULL DEFAULT '',
    source_file_path TEXT NOT NULL DEFAULT '',
    source_file_type TEXT NOT NULL DEFAULT '',
    source_file_size INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS knowledge_document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    ai_readable INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, version)
  );
  CREATE TABLE IF NOT EXISTS workspace_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES workspace_users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
`);
db.exec(
  "UPDATE knowledge_documents SET ai_readable = 1; UPDATE knowledge_document_versions SET ai_readable = 1;",
);

function ensureWorkspaceUserColumns() {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(workspace_users)")
      .all()
      .map((column) => column.name),
  );
  if (!columns.has("display_name"))
    db.exec(
      "ALTER TABLE workspace_users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
    );
}

ensureWorkspaceUserColumns();

function ensureKnowledgeDocumentColumns() {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(knowledge_documents)")
      .all()
      .map((column) => column.name),
  );
  const additions = [
    ["source_file_name", "TEXT NOT NULL DEFAULT ''"],
    ["source_file_path", "TEXT NOT NULL DEFAULT ''"],
    ["source_file_type", "TEXT NOT NULL DEFAULT ''"],
    ["source_file_size", "INTEGER NOT NULL DEFAULT 0"],
  ];
  additions.forEach(([name, definition]) => {
    if (!columns.has(name))
      db.exec(`ALTER TABLE knowledge_documents ADD COLUMN ${name} ${definition}`);
  });
}

ensureKnowledgeDocumentColumns();

function ensureProjectColumns() {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(content_projects)")
      .all()
      .map((column) => column.name),
  );
  const additions = [
    ["body", "TEXT NOT NULL DEFAULT ''"],
    ["version", "INTEGER NOT NULL DEFAULT 1"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["review_status", "TEXT NOT NULL DEFAULT '草稿'"],
    ["review_note", "TEXT NOT NULL DEFAULT ''"],
    ["content_format", "TEXT NOT NULL DEFAULT '图文笔记'"],
    ["source_project_id", "TEXT"],
  ];
  const needsReviewStatus = !columns.has("review_status");
  additions.forEach(([name, definition]) => {
    if (!columns.has(name))
      db.exec(`ALTER TABLE content_projects ADD COLUMN ${name} ${definition}`);
  });
  db.prepare(
    "UPDATE content_projects SET updated_at = created_at WHERE updated_at = ''",
  ).run();
  if (needsReviewStatus)
    db.prepare("UPDATE content_projects SET review_status = status").run();
}

ensureProjectColumns();

function ensureTopicColumns() {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(topics)")
      .all()
      .map((column) => column.name),
  );
  if (!columns.has("source_note_id"))
    db.exec("ALTER TABLE topics ADD COLUMN source_note_id TEXT");
}

ensureTopicColumns();

function ensurePublicationPlanColumns() {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(publication_plans)")
      .all()
      .map((column) => column.name),
  );
  const additions = [
    ["published_at", "TEXT"],
    ["published_url", "TEXT NOT NULL DEFAULT ''"],
    ["metric_views", "INTEGER NOT NULL DEFAULT 0"],
    ["metric_likes", "INTEGER NOT NULL DEFAULT 0"],
    ["metric_comments", "INTEGER NOT NULL DEFAULT 0"],
    ["metric_saves", "INTEGER NOT NULL DEFAULT 0"],
    ["metrics_recorded_at", "TEXT"],
  ];
  additions.forEach(([name, definition]) => {
    if (!columns.has(name))
      db.exec(`ALTER TABLE publication_plans ADD COLUMN ${name} ${definition}`);
  });
}

ensurePublicationPlanColumns();

function ensureCrawlerRunColumns() {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(crawler_runs)")
      .all()
      .map((column) => column.name),
  );
  const additions = [
    ["imported_comments", "INTEGER NOT NULL DEFAULT 0"],
    ["capture_mode", "TEXT NOT NULL DEFAULT 'keyword'"],
    ["source_url", "TEXT NOT NULL DEFAULT ''"],
    ["transcript_status", "TEXT NOT NULL DEFAULT 'not_requested'"],
  ];
  additions.forEach(([name, definition]) => {
    if (!columns.has(name))
      db.exec(`ALTER TABLE crawler_runs ADD COLUMN ${name} ${definition}`);
  });
}

ensureCrawlerRunColumns();

function ensureEvidenceColumns() {
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(evidence_items)")
      .all()
      .map((column) => column.name),
  );
  if (!columns.has("body"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN body TEXT NOT NULL DEFAULT ''",
    );
  if (!columns.has("source_url"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN source_url TEXT NOT NULL DEFAULT ''",
    );
  if (!columns.has("cover_url"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''",
    );
  if (!columns.has("image_urls"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN image_urls TEXT NOT NULL DEFAULT '[]'",
    );
  if (!columns.has("video_url"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN video_url TEXT NOT NULL DEFAULT ''",
    );
  if (!columns.has("transcript"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN transcript TEXT NOT NULL DEFAULT ''",
    );
  if (!columns.has("transcript_status"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN transcript_status TEXT NOT NULL DEFAULT 'not_requested'",
    );
  if (!columns.has("created_at"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
    );
  if (!columns.has("source_provider"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN source_provider TEXT NOT NULL DEFAULT 'manual'",
    );
  if (!columns.has("source_external_id"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN source_external_id TEXT NOT NULL DEFAULT ''",
    );
  if (!columns.has("crawl_run_id"))
    db.exec("ALTER TABLE evidence_items ADD COLUMN crawl_run_id TEXT");
  if (!columns.has("archived_at"))
    db.exec(
      "ALTER TABLE evidence_items ADD COLUMN archived_at TEXT NOT NULL DEFAULT ''",
    );
  db.prepare(
    "UPDATE evidence_items SET created_at = ? WHERE created_at = ''",
  ).run(new Date().toISOString());
}

ensureEvidenceColumns();
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_external_source
  ON evidence_items(source_provider, source_external_id)
  WHERE source_provider != '' AND source_external_id != ''`);

const now = () => new Date().toISOString();
const firstValue = (value) => (typeof value === "string" ? value.trim() : "");
const normalizeDouyinUrl = (value) => {
  const candidate = firstValue(value).match(/https?:\/\/[^\s]+/iu)?.[0] || "";
  if (!candidate || candidate.length > 2_000) return "";
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    if (
      ![
        "douyin.com",
        "iesdouyin.com",
      ].some((domain) => host === domain || host.endsWith(`.${domain}`))
    )
      return "";
    return url.toString();
  } catch {
    return "";
  }
};
const nonnegativeInteger = (value) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};
const normalizeInboxTags = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((tag) => typeof tag === "string")
            .map((tag) => tag.trim().replace(/^#/u, ""))
            .filter(Boolean)
            .filter((tag) => tag.length <= 24),
        ),
      ].slice(0, 8)
    : [];
const normalizeLibraryTags = (value) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((tag) => typeof tag === "string")
            .map((tag) => tag.trim().replace(/^#/u, ""))
            .filter(Boolean)
            .filter((tag) => tag.length <= 32),
        ),
      ].slice(0, 12)
    : [];
const platformSet = new Set(["小红书", "公众号", "抖音"]);
const reviewStatusSet = new Set(["草稿", "待审核", "已批准"]);
const contentFormatSet = new Set([
  "图文笔记",
  "长文文章",
  "短视频脚本",
  "口播稿",
]);
const scrypt = promisify(scryptCallback);
const sessionCookieName = "cato_session";

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(hash).toString("base64url")}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, salt, storedHash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !storedHash) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(storedHash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s, 2))
      .filter(([key]) => key),
  );
}

function sessionCookie(token, expiresAt) {
  const secure = !isDevelopment ? "; Secure" : "";
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

function clearSessionCookie() {
  const secure = !isDevelopment ? "; Secure" : "";
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function getSession(request) {
  const token = parseCookies(request.headers.cookie)[sessionCookieName];
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.email, u.display_name AS displayName FROM workspace_sessions s
    JOIN workspace_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(hashSessionToken(token), now()) || null
  );
}

function createSession(userId, rememberMe) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + (rememberMe ? 30 * 24 : 8) * 60 * 60 * 1000,
  ).toISOString();
  db.prepare(
    "INSERT INTO workspace_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(hashSessionToken(token), userId, expiresAt, now());
  return { token, expiresAt };
}

function authStatus(request) {
  const hasUsers = Boolean(
    db.prepare("SELECT 1 FROM workspace_users LIMIT 1").get(),
  );
  return { setupRequired: !hasUsers, user: getSession(request) };
}

function getWorkBuddyToken(request) {
  const authorization = request.headers.authorization || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim();
  const token = bearer || firstValue(request.headers["x-cato-api-token"]);
  if (!token || token.length > 512) return null;
  const record = db
    .prepare(
      "SELECT id, user_id AS userId FROM workspace_api_tokens WHERE token_hash = ? AND revoked_at IS NULL",
    )
    .get(hashSessionToken(token));
  if (!record) return null;
  db.prepare("UPDATE workspace_api_tokens SET last_used_at = ? WHERE id = ?").run(
    now(),
    record.id,
  );
  return record;
}

function requireWorkBuddyToken(request, response) {
  const token = getWorkBuddyToken(request);
  if (token) return token;
  sendJson(response, 401, {
    error: "WorkBuddy 连接令牌无效或已失效，请在 Cato 重新生成后更新连接。",
  });
  return null;
}

function getWorkBuddyStatus(userId) {
  const token = db
    .prepare(
      "SELECT created_at AS createdAt, last_used_at AS lastUsedAt FROM workspace_api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId);
  return {
    connected: Boolean(token),
    createdAt: token?.createdAt || null,
    lastUsedAt: token?.lastUsedAt || null,
    apiUrl: `http://127.0.0.1:${port}`,
  };
}

function createWorkBuddyToken(userId) {
  const token = `cato_${randomBytes(32).toString("base64url")}`;
  const createdAt = now();
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE workspace_api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    ).run(createdAt, userId);
    db.prepare(
      "INSERT INTO workspace_api_tokens (id, user_id, label, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      userId,
      "WorkBuddy",
      hashSessionToken(token),
      createdAt,
    );
    db.exec("COMMIT");
    return { token, createdAt };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function removeLegacySampleData() {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM content_projects WHERE id = ?").run(
      "project-existing",
    );
    db.prepare("DELETE FROM topics WHERE id = ?").run("topic-existing");
    db.prepare(
      "DELETE FROM evidence_items WHERE id IN ('source-1', 'source-2', 'source-3', 'source-4')",
    ).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

removeLegacySampleData();

function listTopics() {
  const rows = db
    .prepare(
      "SELECT id, title, angle, status, source_note_id AS inboxNoteId FROM topics ORDER BY created_at DESC",
    )
    .all();
  const evidenceStatement = db.prepare(
    "SELECT evidence_id FROM topic_evidence WHERE topic_id = ? ORDER BY evidence_id",
  );
  return rows.map((topic) => ({
    ...topic,
    evidenceIds: evidenceStatement
      .all(topic.id)
      .map((item) => item.evidence_id),
  }));
}

function listInboxNotes() {
  return db
    .prepare(
      "SELECT id, body, tags, topic_id AS topicId, created_at AS createdAt, updated_at AS updatedAt FROM inbox_notes ORDER BY updated_at DESC, id DESC",
    )
    .all()
    .map((note) => {
      try {
        return {
          ...note,
          tags: normalizeInboxTags(JSON.parse(note.tags)),
          topicId: note.topicId || null,
        };
      } catch {
        return { ...note, tags: [], topicId: note.topicId || null };
      }
    });
}

const knowledgeDocumentSelect =
  "SELECT id, title, body, category, tags, version, updated_by AS updatedBy, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt, source_file_name AS sourceFileName, source_file_type AS sourceFileType, source_file_size AS sourceFileSize FROM knowledge_documents";

function mapKnowledgeDocument(document) {
  try {
    return {
      ...document,
      tags: normalizeLibraryTags(JSON.parse(document.tags)),
      archivedAt: document.archivedAt || null,
    };
  } catch {
    return {
      ...document,
      tags: [],
      archivedAt: document.archivedAt || null,
    };
  }
}

function listKnowledgeDocuments() {
  return db
    .prepare(
      `${knowledgeDocumentSelect} WHERE archived_at = '' ORDER BY updated_at DESC, id DESC`,
    )
    .all()
    .map(mapKnowledgeDocument);
}

function getKnowledgeDocument(documentId) {
  const document = db
    .prepare(`${knowledgeDocumentSelect} WHERE id = ?`)
    .get(documentId);
  return document ? mapKnowledgeDocument(document) : null;
}

function listKnowledgeDocumentVersions(documentId) {
  return db
    .prepare(
      "SELECT id, document_id AS documentId, version, title, body, category, tags, updated_by AS updatedBy, created_at AS createdAt FROM knowledge_document_versions WHERE document_id = ? ORDER BY version DESC LIMIT 20",
    )
    .all(documentId)
    .map((version) => ({
      ...version,
      tags: (() => {
        try {
          return normalizeLibraryTags(JSON.parse(version.tags));
        } catch {
          return [];
        }
      })(),
    }));
}

function createKnowledgeDocument({
  title,
  body,
  category,
  tags,
  updatedBy,
  sourceFileName = "",
  sourceFilePath = "",
  sourceFileType = "",
  sourceFileSize = 0,
}) {
  const createdAt = now();
  const document = {
    id: crypto.randomUUID(),
    title,
    body,
    category,
    tags,
    version: 1,
    updatedBy,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    sourceFileName,
    sourceFileType,
    sourceFileSize,
  };
  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO knowledge_documents (id, title, body, category, tags, ai_readable, version, updated_by, created_at, updated_at, source_file_name, source_file_path, source_file_type, source_file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      document.id,
      document.title,
      document.body,
      document.category,
      JSON.stringify(document.tags),
      1,
      document.version,
      document.updatedBy,
      createdAt,
      createdAt,
      sourceFileName,
      sourceFilePath,
      sourceFileType,
      sourceFileSize,
    );
    db.prepare(
      "INSERT INTO knowledge_document_versions (id, document_id, version, title, body, category, tags, ai_readable, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      document.id,
      document.version,
      document.title,
      document.body,
      document.category,
      JSON.stringify(document.tags),
      1,
      document.updatedBy,
      createdAt,
    );
    db.exec("COMMIT");
    return document;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const importableLibraryExtensions = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".html",
  ".htm",
  ".xml",
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".pdf",
]);
const plainTextLibraryExtensions = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".html",
  ".htm",
  ".xml",
]);

function commandText(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 300_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4_000) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      reject(new Error(stderr.trim() || "文件正文提取失败。"));
    });
  });
}

async function extractImportedLibraryText(filePath, extension, fileBuffer) {
  if (plainTextLibraryExtensions.has(extension)) return fileBuffer.toString("utf8");
  if (extension === ".pdf") return commandText("pdftotext", ["-layout", filePath, "-"]);
  return commandText("textutil", ["-convert", "txt", "-stdout", filePath]);
}

const projectSelect = `SELECT p.id, p.title, p.platform, p.topic_id AS topicId, p.source_project_id AS sourceProjectId, p.status, p.review_status AS reviewStatus, p.review_note AS reviewNote, p.content_format AS contentFormat, p.body, p.version, p.updated_at AS updatedAt, plan.scheduled_at AS scheduledAt, plan.published_at AS publishedAt, COALESCE(plan.published_url, '') AS publishedUrl, COALESCE(plan.metric_views, 0) AS metricViews, COALESCE(plan.metric_likes, 0) AS metricLikes, COALESCE(plan.metric_comments, 0) AS metricComments, COALESCE(plan.metric_saves, 0) AS metricSaves, plan.metrics_recorded_at AS metricsRecordedAt FROM content_projects p LEFT JOIN publication_plans plan ON plan.project_id = p.id`;

function getProject(projectId) {
  return db.prepare(`${projectSelect} WHERE p.id = ?`).get(projectId);
}

const crawlerPlatformLabel = {
  xhs: "小红书",
  dy: "抖音",
  ks: "快手",
  bili: "B站",
  wb: "微博",
  tieba: "贴吧",
  zhihu: "知乎",
};

async function hasFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function getMediaCrawlerStatus() {
  const installed =
    (await hasFile(join(mediaCrawlerRoot, "main.py"))) &&
    (await hasFile(join(mediaCrawlerRoot, "pyproject.toml")));
  const prepared =
    installed && (await hasFile(join(mediaCrawlerRoot, ".venv", "pyvenv.cfg")));
  return {
    id: "mediacrawler",
    label: "MediaCrawler",
    source: "NanmiCoder/MediaCrawler",
    root: mediaCrawlerRoot,
    installed,
    prepared,
    activeRuns: activeCrawlerProcesses.size,
    status: !installed
      ? "missing"
      : mediaCrawlerSetupProcess
        ? "preparing"
        : !prepared
          ? "needs_setup"
          : activeCrawlerProcesses.size
            ? "running"
            : "ready",
  };
}

async function prepareMediaCrawler() {
  const connector = await getMediaCrawlerStatus();
  if (!connector.installed) throw new Error("未找到 MediaCrawler 项目。");
  if (connector.prepared) return connector;
  if (mediaCrawlerSetupProcess) return connector;
  const child = spawn("uv", ["sync"], {
    cwd: mediaCrawlerRoot,
    env: { ...process.env, PYTHONUTF8: "1" },
    stdio: "ignore",
  });
  mediaCrawlerSetupProcess = child;
  const clear = () => {
    mediaCrawlerSetupProcess = null;
  };
  child.once("error", clear);
  child.once("close", clear);
  return { ...connector, status: "preparing" };
}

function listCrawlerRuns() {
  return db
    .prepare(
      "SELECT id, provider, platform, query, max_items AS maxItems, status, imported_count AS importedCount, imported_comments AS importedComments, capture_mode AS captureMode, source_url AS sourceUrl, transcript_status AS transcriptStatus, error_message AS errorMessage, created_at AS createdAt, started_at AS startedAt, completed_at AS completedAt FROM crawler_runs ORDER BY created_at DESC LIMIT 12",
    )
    .all();
}

async function listFilesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      return entry.isDirectory()
        ? listFilesRecursively(entryPath)
        : [entryPath];
    }),
  );
  return nested.flat();
}

function summarizeSignal(item) {
  const labels = [
    ["liked_count", "点赞"],
    ["collected_count", "收藏"],
    ["comment_count", "评论"],
    ["share_count", "分享"],
  ];
  return (
    labels
      .map(([key, label]) =>
        item[key] === undefined || item[key] === null || item[key] === ""
          ? ""
          : `${label} ${item[key]}`,
      )
      .filter(Boolean)
      .join(" · ") || "MediaCrawler 导入"
  );
}

function extractMediaUrls(item) {
  const directCover = [
    firstValue(item.cover_url),
    firstValue(item.video_cover_url),
    firstValue(item.pic),
  ];
  const imageLists = [
    firstValue(item.image_list),
    firstValue(item.note_download_url),
  ].flatMap((value) => value.split(","));
  return [...directCover, ...imageLists]
    .map((url) => url.trim())
    .filter(
      (url, index, urls) =>
        /^https?:\/\//iu.test(url) && urls.indexOf(url) === index,
    )
    .slice(0, 12);
}

function extractCoverUrl(item) {
  return extractMediaUrls(item)[0] || "";
}

function extractVideoUrl(item) {
  return [firstValue(item.video_download_url), firstValue(item.video_url)]
    .find((url) => /^https?:\/\//iu.test(url)) || "";
}

async function importMediaCrawlerOutput(run) {
  let files = [];
  try {
    files = (await listFilesRecursively(run.outputPath)).filter((filePath) =>
      /_contents_.*\.jsonl$/u.test(filePath),
    );
  } catch {
    return 0;
  }
  const provider = `mediacrawler:${run.platform}`;
  let importedCount = 0;
  db.exec("BEGIN");
  try {
    const findExisting = db.prepare(
      "SELECT id FROM evidence_items WHERE source_provider = ? AND source_external_id = ?",
    );
    const insertEvidence = db.prepare(
      "INSERT INTO evidence_items (id, title, summary, body, platform, author, signal, collected_at, source_url, cover_url, image_urls, video_url, created_at, source_provider, source_external_id, crawl_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const updateEvidence = db.prepare(
      "UPDATE evidence_items SET title = ?, summary = ?, body = ?, platform = ?, author = ?, signal = ?, collected_at = ?, source_url = ?, cover_url = ?, image_urls = ?, video_url = ?, crawl_run_id = ? WHERE id = ?",
    );
    for (const filePath of files) {
      const lines = (await readFile(filePath, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean);
      for (const line of lines) {
        let item;
        try {
          item = JSON.parse(line);
        } catch {
          continue;
        }
        const title =
          firstValue(item.title) || firstValue(item.desc).slice(0, 180);
        if (!title) continue;
        const externalId =
          firstValue(item.note_id) ||
          firstValue(item.aweme_id) ||
          firstValue(item.video_id) ||
          firstValue(item.id);
        const summary = firstValue(item.desc) || title;
        const body = firstValue(item.desc) || title;
        const author =
          firstValue(item.nickname) ||
          firstValue(item.author) ||
          "MediaCrawler 导入";
        const sourceUrl =
          firstValue(item.note_url) ||
          firstValue(item.aweme_url) ||
          firstValue(item.video_url) ||
          "";
        const coverUrl = extractCoverUrl(item);
        const imageUrls = JSON.stringify(extractMediaUrls(item));
        const videoUrl = extractVideoUrl(item);
        const values = [
          title.slice(0, 180),
          summary.slice(0, 2000),
          body,
          crawlerPlatformLabel[run.platform] || run.platform,
          author.slice(0, 80),
          summarizeSignal(item).slice(0, 80),
          new Intl.DateTimeFormat("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date()),
          sourceUrl.slice(0, 2000),
          coverUrl.slice(0, 2_000),
          imageUrls,
          videoUrl.slice(0, 2_000),
        ];
        const existing = externalId
          ? findExisting.get(provider, externalId)
          : null;
        if (existing) updateEvidence.run(...values, run.id, existing.id);
        else
          insertEvidence.run(
            crypto.randomUUID(),
            ...values,
            now(),
            provider,
            externalId,
            run.id,
          );
        importedCount += 1;
      }
    }
    db.exec("COMMIT");
    return importedCount;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function importMediaCrawlerComments(run) {
  let files = [];
  try {
    files = (await listFilesRecursively(run.outputPath)).filter((filePath) =>
      /_comments_.*\.jsonl$/u.test(filePath),
    );
  } catch {
    return 0;
  }
  const provider = `mediacrawler:${run.platform}`;
  let importedCount = 0;
  db.exec("BEGIN");
  try {
    const findEvidence = db.prepare(
      "SELECT id FROM evidence_items WHERE source_provider = ? AND source_external_id = ?",
    );
    const upsertComment = db.prepare(
      "INSERT INTO evidence_comments (id, evidence_id, source_provider, source_external_id, author, body, like_count, reply_count, commented_at, crawl_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_provider, source_external_id) DO UPDATE SET evidence_id = excluded.evidence_id, author = excluded.author, body = excluded.body, like_count = excluded.like_count, reply_count = excluded.reply_count, commented_at = excluded.commented_at, crawl_run_id = excluded.crawl_run_id",
    );
    for (const filePath of files) {
      const lines = (await readFile(filePath, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean);
      for (const line of lines) {
        let item;
        try {
          item = JSON.parse(line);
        } catch {
          continue;
        }
        const sourceExternalId =
          firstValue(item.comment_id) ||
          firstValue(item.id) ||
          firstValue(item.commentId);
        const evidenceExternalId =
          firstValue(item.note_id) ||
          firstValue(item.aweme_id) ||
          firstValue(item.video_id) ||
          firstValue(item.item_id);
        const body = firstValue(item.content) || firstValue(item.text);
        if (!sourceExternalId || !evidenceExternalId || !body) continue;
        const evidence = findEvidence.get(provider, evidenceExternalId);
        if (!evidence) continue;
        upsertComment.run(
          crypto.randomUUID(),
          evidence.id,
          provider,
          sourceExternalId,
          (firstValue(item.nickname) || firstValue(item.author)).slice(0, 80),
          body.slice(0, 10_000),
          nonnegativeInteger(item.like_count ?? item.comment_like_count),
          nonnegativeInteger(item.sub_comment_count),
          String(item.create_time ?? item.create_date_time ?? "").slice(0, 80),
          run.id,
          now(),
        );
        importedCount += 1;
      }
    }
    db.exec("COMMIT");
    return importedCount;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function backfillMediaCrawlerCovers() {
  const runs = db
    .prepare(
      "SELECT platform, output_path AS outputPath FROM crawler_runs WHERE provider = 'mediacrawler' AND status = 'succeeded'",
    )
    .all();
  const updateMedia = db.prepare(
    "UPDATE evidence_items SET cover_url = ?, image_urls = ? WHERE source_provider = ? AND source_external_id = ? AND (cover_url = '' OR image_urls = '[]')",
  );
  const updateBody = db.prepare(
    "UPDATE evidence_items SET body = ? WHERE source_provider = ? AND source_external_id = ? AND body = ''",
  );
  for (const run of runs) {
    let files = [];
    try {
      files = (await listFilesRecursively(run.outputPath)).filter((filePath) =>
        /_contents_.*\.jsonl$/u.test(filePath),
      );
    } catch {
      continue;
    }
    for (const filePath of files) {
      const lines = (await readFile(filePath, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean);
      for (const line of lines) {
        let item;
        try {
          item = JSON.parse(line);
        } catch {
          continue;
        }
        const externalId =
          firstValue(item.note_id) ||
          firstValue(item.aweme_id) ||
          firstValue(item.video_id) ||
          firstValue(item.id);
        const mediaUrls = extractMediaUrls(item);
        const coverUrl = mediaUrls[0] || "";
        const body = firstValue(item.desc) || firstValue(item.title);
        if (externalId && coverUrl)
          updateMedia.run(
            coverUrl.slice(0, 2_000),
            JSON.stringify(mediaUrls),
            `mediacrawler:${run.platform}`,
            externalId,
          );
        if (externalId && body)
          updateBody.run(body, `mediacrawler:${run.platform}`, externalId);
      }
    }
  }
}

await backfillMediaCrawlerCovers();

async function startMediaCrawlerRun({
  platform,
  query,
  maxItems,
  collectComments,
  captureMode = "keyword",
  sourceUrl = "",
  requestTranscript = false,
}) {
  const connector = await getMediaCrawlerStatus();
  if (!connector.installed) throw new Error("未找到 MediaCrawler 项目。");
  if (!connector.prepared)
    throw new Error(
      "MediaCrawler 尚未初始化。请先在 integrations/MediaCrawler 中运行 uv sync。",
    );
  const id = crypto.randomUUID();
  const outputPath = join(mediaCrawlerOutputRoot, id);
  const createdAt = now();
  await mkdir(outputPath, { recursive: true });
  db.prepare(
    "INSERT INTO crawler_runs (id, provider, platform, query, max_items, status, output_path, capture_mode, source_url, transcript_status, created_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    "mediacrawler",
    platform,
    query,
    maxItems,
    "running",
    outputPath,
    captureMode,
    sourceUrl,
    requestTranscript ? "not_configured" : "not_requested",
    createdAt,
    createdAt,
  );
  const args = [
    "run",
    "main.py",
    "--platform",
    platform,
    "--lt",
    "qrcode",
    "--type",
    captureMode === "douyin_url" ? "detail" : "search",
    "--save_data_option",
    "jsonl",
    "--save_data_path",
    outputPath,
    "--get_comment",
    String(Boolean(collectComments)),
    "--get_sub_comment",
    "false",
    "--headless",
    "false",
    "--crawler_max_notes_count",
    String(captureMode === "douyin_url" ? 1 : maxItems),
    "--max_concurrency_num",
    "1",
  ];
  if (captureMode === "douyin_url") args.splice(8, 0, "--specified_id", sourceUrl);
  else args.splice(8, 0, "--keywords", query);
  const child = spawn("uv", args, {
    cwd: mediaCrawlerRoot,
    env: { ...process.env, PYTHONUTF8: "1" },
    stdio: "ignore",
  });
  activeCrawlerProcesses.set(id, child);
  let finalized = false;
  const finish = async (errorMessage = "") => {
    if (finalized) return;
    finalized = true;
    activeCrawlerProcesses.delete(id);
    try {
      const importedCount = errorMessage
        ? 0
        : await importMediaCrawlerOutput({ id, platform, outputPath });
      const importedComments =
        errorMessage || !collectComments
          ? 0
          : await importMediaCrawlerComments({ id, platform, outputPath });
      if (!errorMessage && requestTranscript)
        db.prepare(
          "UPDATE evidence_items SET transcript_status = 'not_configured' WHERE crawl_run_id = ?",
        ).run(id);
      db.prepare(
        "UPDATE crawler_runs SET status = ?, imported_count = ?, imported_comments = ?, error_message = ?, completed_at = ? WHERE id = ?",
      ).run(
        errorMessage ? "failed" : "succeeded",
        importedCount,
        importedComments,
        errorMessage.slice(0, 1000),
        now(),
        id,
      );
    } catch (error) {
      db.prepare(
        "UPDATE crawler_runs SET status = ?, error_message = ?, completed_at = ? WHERE id = ?",
      ).run(
        "failed",
        error instanceof Error
          ? error.message.slice(0, 1000)
          : "导入采集结果失败。",
        now(),
        id,
      );
    }
  };
  child.once("error", (error) => {
    void finish(error.message || "无法启动 MediaCrawler。");
  });
  child.once("close", (code) => {
    void finish(
      code === 0 ? "" : `MediaCrawler 运行失败，退出码 ${code ?? "未知"}。`,
    );
  });
  return db
    .prepare(
      "SELECT id, provider, platform, query, max_items AS maxItems, status, imported_count AS importedCount, imported_comments AS importedComments, capture_mode AS captureMode, source_url AS sourceUrl, transcript_status AS transcriptStatus, error_message AS errorMessage, created_at AS createdAt, started_at AS startedAt, completed_at AS completedAt FROM crawler_runs WHERE id = ?",
    )
    .get(id);
}

async function bootstrap() {
  const mediaCrawler = await getMediaCrawlerStatus();
  const mapEvidence = (items) =>
    items.map((item) => ({
      ...item,
      archivedAt: item.archivedAt || null,
      imageUrls: (() => {
        try {
          const urls = JSON.parse(item.imageUrls);
          return Array.isArray(urls)
            ? urls.filter((url) => typeof url === "string")
            : [];
        } catch {
          return [];
        }
      })(),
    }));
  const evidenceSelect =
    "SELECT id, title, summary, body, platform, author, signal, collected_at AS collectedAt, source_url AS sourceUrl, cover_url AS coverUrl, image_urls AS imageUrls, video_url AS videoUrl, transcript, transcript_status AS transcriptStatus, archived_at AS archivedAt FROM evidence_items";
  return {
    sources: mapEvidence(
      db
        .prepare(
          `${evidenceSelect} WHERE archived_at = '' ORDER BY created_at DESC, id DESC`,
        )
        .all(),
    ),
    archivedSources: mapEvidence(
      db
        .prepare(
          `${evidenceSelect} WHERE archived_at != '' ORDER BY archived_at DESC, id DESC`,
        )
        .all(),
    ),
    topics: listTopics(),
    projects: db.prepare(`${projectSelect} ORDER BY p.updated_at DESC`).all(),
    connectors: { mediaCrawler },
    crawlRuns: listCrawlerRuns(),
    inboxNotes: listInboxNotes(),
    libraryDocuments: listKnowledgeDocuments(),
    comments: db
      .prepare(
        "SELECT c.id, c.evidence_id AS evidenceId, e.title AS evidenceTitle, e.platform, c.author, c.body, c.like_count AS likeCount, c.reply_count AS replyCount, c.commented_at AS commentedAt, c.created_at AS collectedAt FROM evidence_comments c JOIN evidence_items e ON e.id = c.evidence_id WHERE e.archived_at = '' ORDER BY c.created_at DESC LIMIT 500",
      )
      .all(),
  };
}

async function readJson(request, maxLength = 64 * 1024) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maxLength) throw new Error("请求体过大。");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("请求格式无效。");
  }
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function handleApi(request, response, path) {
  if (request.method === "GET" && path === "/api/health")
    return sendJson(response, 200, { ok: true, database: "sqlite" });
  if (request.method === "GET" && path === "/api/auth/status")
    return sendJson(response, 200, authStatus(request));
  if (request.method === "POST" && path === "/api/auth/setup") {
    const body = await readJson(request);
    const email = firstValue(body.email).toLowerCase();
    const displayName = firstValue(body.displayName);
    const password = typeof body.password === "string" ? body.password : "";
    const rememberMe = body.rememberMe !== false;
    if (db.prepare("SELECT 1 FROM workspace_users LIMIT 1").get())
      return sendJson(response, 409, {
        error: "工作区账号已创建，请直接登录。",
      });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254)
      return sendJson(response, 400, { error: "请输入有效的邮箱地址。" });
    if (!displayName || displayName.length > 80)
      return sendJson(response, 400, { error: "请输入 1 至 80 个字符的姓名。" });
    if (!password || password.length > 256)
      return sendJson(response, 400, {
        error: "密码不能为空，且不能超过 256 个字符。",
      });
    const user = { id: crypto.randomUUID(), email, displayName };
    db.prepare(
      "INSERT INTO workspace_users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      user.id,
      user.email,
      user.displayName,
      await hashPassword(password),
      now(),
    );
    const session = createSession(user.id, rememberMe);
    return sendJson(
      response,
      201,
      { user },
      { "Set-Cookie": sessionCookie(session.token, session.expiresAt) },
    );
  }
  if (request.method === "POST" && path === "/api/auth/login") {
    const body = await readJson(request);
    const email = firstValue(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const rememberMe = body.rememberMe !== false;
    const user = db
      .prepare(
        "SELECT id, email, display_name AS displayName, password_hash AS passwordHash FROM workspace_users WHERE email = ?",
      )
      .get(email);
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      return sendJson(response, 401, { error: "邮箱或密码不正确。" });
    const session = createSession(user.id, rememberMe);
    return sendJson(
      response,
      200,
      { user: { id: user.id, email: user.email, displayName: user.displayName } },
      { "Set-Cookie": sessionCookie(session.token, session.expiresAt) },
    );
  }
  if (request.method === "POST" && path === "/api/auth/reset-password") {
    const body = await readJson(request);
    const email = firstValue(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const rememberMe = body.rememberMe !== false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254)
      return sendJson(response, 400, { error: "请输入有效的邮箱地址。" });
    if (!password || password.length > 256)
      return sendJson(response, 400, {
        error: "密码不能为空，且不能超过 256 个字符。",
      });
    const user = db
      .prepare("SELECT id, email, display_name AS displayName FROM workspace_users WHERE email = ?")
      .get(email);
    if (!user)
      return sendJson(response, 404, { error: "未找到这个本地工作区账号。" });
    const passwordHash = await hashPassword(password);
    db.exec("BEGIN");
    try {
      db.prepare(
        "UPDATE workspace_users SET password_hash = ? WHERE id = ?",
      ).run(passwordHash, user.id);
      db.prepare("DELETE FROM workspace_sessions WHERE user_id = ?").run(
        user.id,
      );
      const session = createSession(user.id, rememberMe);
      db.exec("COMMIT");
      return sendJson(
        response,
        200,
        { user },
        { "Set-Cookie": sessionCookie(session.token, session.expiresAt) },
      );
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (request.method === "POST" && path === "/api/auth/logout") {
    const token = parseCookies(request.headers.cookie)[sessionCookieName];
    if (token)
      db.prepare("DELETE FROM workspace_sessions WHERE token_hash = ?").run(
        hashSessionToken(token),
      );
    return sendJson(response, 204, {}, { "Set-Cookie": clearSessionCookie() });
  }
  if (request.method === "GET" && path === "/api/workbuddy/status") {
    const user = getSession(request);
    if (!user) return sendJson(response, 401, { error: "请先登录工作区。" });
    return sendJson(response, 200, getWorkBuddyStatus(user.id));
  }
  if (request.method === "POST" && path === "/api/workbuddy/token") {
    const user = getSession(request);
    if (!user) return sendJson(response, 401, { error: "请先登录工作区。" });
    const created = createWorkBuddyToken(user.id);
    return sendJson(response, 201, {
      token: created.token,
      createdAt: created.createdAt,
      apiUrl: `http://127.0.0.1:${port}`,
    });
  }
  if (path.startsWith("/api/workbuddy/")) {
    if (!requireWorkBuddyToken(request, response)) return;
    const url = new URL(request.url, "http://localhost");
    const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const includesQuery = (value) =>
      !query || String(value).toLocaleLowerCase().includes(query.toLocaleLowerCase());
    if (request.method === "GET" && path === "/api/workbuddy/library/search") {
      const documents = listKnowledgeDocuments()
        .filter((document) =>
          includesQuery(`${document.title}\n${document.body}\n${document.category}\n${document.tags.join(" ")}`),
        )
        .slice(0, 12)
        .map(({ id, title, body, category, tags, version, updatedAt }) => ({
          id,
          title,
          excerpt: body.slice(0, 1_200),
          category,
          tags,
          version,
          updatedAt,
        }));
      return sendJson(response, 200, { documents });
    }
    const workBuddyLibraryMatch = path.match(/^\/api\/workbuddy\/library\/([^/]+)$/);
    if (request.method === "GET" && workBuddyLibraryMatch) {
      const document = getKnowledgeDocument(decodeURIComponent(workBuddyLibraryMatch[1]));
      if (!document || document.archivedAt)
        return sendJson(response, 404, { error: "资料不存在。" });
      return sendJson(response, 200, {
        document: {
          ...document,
          body: document.body.slice(0, 50_000),
        },
      });
    }
    if (request.method === "GET" && path === "/api/workbuddy/intelligence/search") {
      const platform = firstValue(url.searchParams.get("platform"));
      if (platform && !platformSet.has(platform))
        return sendJson(response, 400, { error: "采集平台无效。" });
      const evidence = db
        .prepare(
          "SELECT id, title, summary, body, platform, author, signal, collected_at AS collectedAt, source_url AS sourceUrl, cover_url AS coverUrl, video_url AS videoUrl, transcript, transcript_status AS transcriptStatus FROM evidence_items WHERE archived_at = '' ORDER BY created_at DESC, id DESC",
        )
        .all()
        .filter((item) =>
          (!platform || item.platform === platform) &&
          includesQuery(`${item.title}\n${item.summary}\n${item.body}\n${item.author}\n${item.signal}`),
        )
        .slice(0, 20)
        .map((item) => ({
          ...item,
          body: item.body.slice(0, 4_000),
          transcript: item.transcript.slice(0, 4_000),
        }));
      return sendJson(response, 200, { evidence });
    }
    if (request.method === "POST" && path === "/api/workbuddy/inbox") {
      const body = await readJson(request);
      if (body.confirmed !== true)
        return sendJson(response, 409, { error: "请在调用前取得用户确认，并传入 confirmed: true。" });
      const noteBody = firstValue(body.body);
      const tags = normalizeInboxTags(body.tags);
      if (!noteBody || noteBody.length > 10_000)
        return sendJson(response, 400, { error: "灵感内容不能为空，且不能超过 10,000 个字符。" });
      const createdAt = now();
      const note = {
        id: crypto.randomUUID(),
        body: noteBody,
        tags,
        topicId: null,
        createdAt,
        updatedAt: createdAt,
      };
      db.prepare(
        "INSERT INTO inbox_notes (id, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(note.id, note.body, JSON.stringify(note.tags), createdAt, createdAt);
      return sendJson(response, 201, { note });
    }
    if (request.method === "GET" && path === "/api/workbuddy/projects") {
      const reviewStatus = firstValue(url.searchParams.get("reviewStatus"));
      if (reviewStatus && !reviewStatusSet.has(reviewStatus))
        return sendJson(response, 400, { error: "审核状态无效。" });
      const projects = db
        .prepare(`${projectSelect} ORDER BY p.updated_at DESC`)
        .all()
        .filter((project) => !reviewStatus || project.reviewStatus === reviewStatus)
        .slice(0, 50);
      return sendJson(response, 200, { projects });
    }
    if (request.method === "POST" && path === "/api/workbuddy/projects") {
      const body = await readJson(request);
      if (body.confirmed !== true)
        return sendJson(response, 409, { error: "请在调用前取得用户确认，并传入 confirmed: true。" });
      const title = firstValue(body.title);
      const platform = firstValue(body.platform);
      const contentFormat = firstValue(body.contentFormat) || "图文笔记";
      const topicId = firstValue(body.topicId) || null;
      const content = typeof body.body === "string" ? body.body : "";
      if (!title || !platformSet.has(platform) || !contentFormatSet.has(contentFormat))
        return sendJson(response, 400, { error: "稿件标题、目标平台或内容格式无效。" });
      if (content.length > 60 * 1024)
        return sendJson(response, 400, { error: "正文不能超过 60,000 个字符。" });
      const topic = topicId
        ? db.prepare("SELECT id, status FROM topics WHERE id = ?").get(topicId)
        : null;
      if (topicId && !topic) return sendJson(response, 400, { error: "选题不存在。" });
      if (topic && topic.status !== "已确认")
        return sendJson(response, 409, { error: "请先确认选题，再创建稿件。" });
      const createdAt = now();
      const project = {
        id: crypto.randomUUID(),
        title,
        platform,
        contentFormat,
        topicId,
        status: "草稿",
        reviewStatus: "草稿",
        reviewNote: "",
        body: content,
        version: 1,
        updatedAt: createdAt,
      };
      db.prepare(
        "INSERT INTO content_projects (id, title, platform, content_format, topic_id, status, body, version, created_at, updated_at, review_status, review_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        project.id,
        project.title,
        project.platform,
        project.contentFormat,
        project.topicId,
        project.status,
        project.body,
        project.version,
        createdAt,
        project.updatedAt,
        project.reviewStatus,
        project.reviewNote,
      );
      return sendJson(response, 201, { project: getProject(project.id) });
    }
    return sendJson(response, 404, { error: "WorkBuddy 接口不存在。" });
  }
  if (!getSession(request))
    return sendJson(response, 401, { error: "请先登录工作区。" });
  if (request.method === "GET" && path === "/api/bootstrap")
    return sendJson(response, 200, await bootstrap());
  if (request.method === "POST" && path === "/api/inbox") {
    const body = await readJson(request);
    const noteBody = firstValue(body.body);
    const tags = normalizeInboxTags(body.tags);
    if (!noteBody || noteBody.length > 10_000)
      return sendJson(response, 400, {
        error: "灵感内容不能为空，且不能超过 10,000 个字符。",
      });
    const createdAt = now();
    const note = {
      id: crypto.randomUUID(),
      body: noteBody,
      tags,
      topicId: null,
      createdAt,
      updatedAt: createdAt,
    };
    db.prepare(
      "INSERT INTO inbox_notes (id, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(note.id, note.body, JSON.stringify(note.tags), createdAt, createdAt);
    return sendJson(response, 201, { note });
  }
  const inboxMatch = path.match(/^\/api\/inbox\/([^/]+)$/);
  const inboxTopicMatch = path.match(/^\/api\/inbox\/([^/]+)\/topic$/);
  if (request.method === "POST" && inboxTopicMatch) {
    const noteId = decodeURIComponent(inboxTopicMatch[1]);
    const note = db
      .prepare("SELECT id, body, topic_id AS topicId FROM inbox_notes WHERE id = ?")
      .get(noteId);
    if (!note) return sendJson(response, 404, { error: "灵感不存在。" });
    if (note.topicId)
      return sendJson(response, 409, { error: "这条灵感已经创建过选题。" });
    const title =
      note.body
        .split(/[\n。！？!?]/u)
        .map((line) => line.trim())
        .find(Boolean)
        ?.slice(0, 80) || "未命名灵感";
    const topic = {
      id: crypto.randomUUID(),
      title,
      angle: note.body,
      status: "待确认",
      evidenceIds: [],
      inboxNoteId: note.id,
    };
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO topics (id, title, angle, status, source_note_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        topic.id,
        topic.title,
        topic.angle,
        topic.status,
        note.id,
        now(),
      );
      db.prepare("UPDATE inbox_notes SET topic_id = ?, updated_at = ? WHERE id = ?").run(
        topic.id,
        now(),
        note.id,
      );
      db.exec("COMMIT");
      return sendJson(response, 201, { topic, noteId: note.id });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (request.method === "DELETE" && inboxMatch) {
    const noteId = decodeURIComponent(inboxMatch[1]);
    const result = db.prepare("DELETE FROM inbox_notes WHERE id = ?").run(noteId);
    if (!result.changes) return sendJson(response, 404, { error: "灵感不存在。" });
    return sendJson(response, 200, { id: noteId });
  }
  if (request.method === "GET" && path === "/api/library/context") {
    const url = new URL(request.url, "http://localhost");
    const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const documents = listKnowledgeDocuments()
      .filter((document) => {
        if (!query) return true;
        return `${document.title}\n${document.body}\n${document.category}\n${document.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase());
      })
      .slice(0, 20)
      .map(({ id, title, body, category, tags, version, updatedAt }) => ({
        id,
        title,
        body,
        category,
        tags,
        version,
        updatedAt,
      }));
    return sendJson(response, 200, { documents });
  }
  if (request.method === "POST" && path === "/api/library") {
    const body = await readJson(request);
    const title = firstValue(body.title);
    const content = typeof body.body === "string" ? body.body.trim() : "";
    const category = firstValue(body.category) || "未分类";
    const tags = normalizeLibraryTags(body.tags);
    if (!title || !content)
      return sendJson(response, 400, { error: "资料标题和正文均为必填项。" });
    if (title.length > 160 || content.length > 50_000 || category.length > 40)
      return sendJson(response, 400, { error: "资料字段超过允许长度。" });
    const updatedBy =
      firstValue(body.updatedBy) === "AI"
        ? "AI"
        : getSession(request)?.displayName || "人工";
    const document = createKnowledgeDocument({
      title,
      body: content,
      category,
      tags,
      updatedBy,
    });
    return sendJson(response, 201, { document });
  }
  if (request.method === "POST" && path === "/api/library/import") {
    const body = await readJson(request, 12 * 1024 * 1024);
    const fileName = basename(firstValue(body.fileName)).trim();
    const extension = extname(fileName).toLocaleLowerCase();
    const encoded = typeof body.contentBase64 === "string" ? body.contentBase64 : "";
    if (!fileName || !importableLibraryExtensions.has(extension))
      return sendJson(response, 400, { error: "仅支持 TXT、Markdown、CSV、HTML、JSON、Word、RTF、ODT 和 PDF 文件。" });
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded))
      return sendJson(response, 400, { error: "上传文件格式无效。" });
    const fileBuffer = Buffer.from(encoded, "base64");
    if (!fileBuffer.length || fileBuffer.length > 8 * 1024 * 1024)
      return sendJson(response, 400, { error: "单个文件需小于 8 MB。" });
    const storageName = `${crypto.randomUUID()}${extension}`;
    const storagePath = join(libraryUploadsRoot, storageName);
    await mkdir(libraryUploadsRoot, { recursive: true });
    await writeFile(storagePath, fileBuffer, { flag: "wx" });
    try {
      const extractedText = (await extractImportedLibraryText(
        storagePath,
        extension,
        fileBuffer,
      )).replace(/\u0000/gu, "").trim();
      if (!extractedText) throw new Error("未能从该文件提取正文，请确认文件不是扫描件或受保护文件。" );
      const wasTruncated = extractedText.length > 50_000;
      const document = createKnowledgeDocument({
        title: basename(fileName, extension).slice(0, 160) || "未命名资料",
        body: extractedText.slice(0, 50_000),
        category: firstValue(body.category) || "导入资料",
        tags: normalizeLibraryTags(body.tags),
        updatedBy: getSession(request)?.displayName || "人工",
        sourceFileName: fileName.slice(0, 255),
        sourceFilePath: storagePath,
        sourceFileType: extension.slice(1),
        sourceFileSize: fileBuffer.length,
      });
      return sendJson(response, 201, { document, wasTruncated });
    } catch (error) {
      await unlink(storagePath).catch(() => {});
      return sendJson(response, 422, {
        error: error instanceof Error ? error.message : "资料导入失败。",
      });
    }
  }
  const libraryMatch = path.match(/^\/api\/library\/([^/]+)$/);
  const libraryHistoryMatch = path.match(/^\/api\/library\/([^/]+)\/history$/);
  if (request.method === "GET" && libraryHistoryMatch) {
    const documentId = decodeURIComponent(libraryHistoryMatch[1]);
    if (!getKnowledgeDocument(documentId))
      return sendJson(response, 404, { error: "资料不存在。" });
    return sendJson(response, 200, {
      versions: listKnowledgeDocumentVersions(documentId),
    });
  }
  if (request.method === "PUT" && libraryMatch) {
    const documentId = decodeURIComponent(libraryMatch[1]);
    const existing = getKnowledgeDocument(documentId);
    if (!existing || existing.archivedAt)
      return sendJson(response, 404, { error: "资料不存在。" });
    const body = await readJson(request);
    const title = firstValue(body.title);
    const content = typeof body.body === "string" ? body.body.trim() : "";
    const category = firstValue(body.category) || "未分类";
    const tags = normalizeLibraryTags(body.tags);
    const expectedVersion = Number.isInteger(body.version) ? body.version : null;
    if (!title || !content)
      return sendJson(response, 400, { error: "资料标题和正文均为必填项。" });
    if (title.length > 160 || content.length > 50_000 || category.length > 40)
      return sendJson(response, 400, { error: "资料字段超过允许长度。" });
    if (expectedVersion !== existing.version)
      return sendJson(response, 409, {
        error: "这份资料已被更新，请刷新后再保存。",
        document: existing,
      });
    const updatedAt = now();
    const updatedBy =
      firstValue(body.updatedBy) === "AI"
        ? "AI"
        : getSession(request)?.displayName || "人工";
    const document = {
      ...existing,
      title,
      body: content,
      category,
      tags,
      version: existing.version + 1,
      updatedBy,
      updatedAt,
    };
    db.exec("BEGIN");
    try {
      db.prepare(
        "UPDATE knowledge_documents SET title = ?, body = ?, category = ?, tags = ?, ai_readable = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = ?",
      ).run(
        document.title,
        document.body,
        document.category,
        JSON.stringify(document.tags),
        1,
        document.version,
        document.updatedBy,
        updatedAt,
        documentId,
      );
      db.prepare(
        "INSERT INTO knowledge_document_versions (id, document_id, version, title, body, category, tags, ai_readable, updated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        crypto.randomUUID(),
        documentId,
        document.version,
        document.title,
        document.body,
        document.category,
        JSON.stringify(document.tags),
        1,
        document.updatedBy,
        updatedAt,
      );
      db.exec("COMMIT");
      return sendJson(response, 200, { document });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (request.method === "GET" && path === "/api/connectors/mediacrawler")
    return sendJson(response, 200, {
      connector: await getMediaCrawlerStatus(),
      runs: listCrawlerRuns(),
    });
  if (
    request.method === "POST" &&
    path === "/api/connectors/mediacrawler/prepare"
  ) {
    try {
      return sendJson(response, 202, {
        connector: await prepareMediaCrawler(),
      });
    } catch (error) {
      return sendJson(response, 409, {
        error:
          error instanceof Error ? error.message : "无法初始化 MediaCrawler。",
      });
    }
  }
  if (request.method === "POST" && path === "/api/crawls/mediacrawler") {
    const body = await readJson(request);
    const platform = firstValue(body.platform);
    const query = firstValue(body.query);
    const maxItems = Number.isInteger(body.maxItems) ? body.maxItems : 10;
    const collectComments = body.collectComments === true;
    if (
      !["xhs", "dy"].includes(platform) ||
      !query ||
      query.length > 120 ||
      maxItems < 1 ||
      maxItems > 50
    )
      return sendJson(response, 400, { error: "采集平台、关键词或数量无效。" });
    try {
      const run = await startMediaCrawlerRun({
        platform,
        query,
        maxItems,
        collectComments,
      });
      return sendJson(response, 202, { run });
    } catch (error) {
      return sendJson(response, 409, {
        error: error instanceof Error ? error.message : "无法启动采集任务。",
      });
    }
  }
  if (request.method === "POST" && path === "/api/crawls/douyin-url") {
    const body = await readJson(request);
    const sourceUrl = normalizeDouyinUrl(body.sourceUrl);
    const collectComments = body.collectComments === true;
    const requestTranscript = body.requestTranscript === true;
    if (!sourceUrl)
      return sendJson(response, 400, {
        error: "请输入有效的抖音视频链接或 v.douyin.com 短链。",
      });
    try {
      const run = await startMediaCrawlerRun({
        platform: "dy",
        query: "抖音单条链接",
        maxItems: 1,
        collectComments,
        captureMode: "douyin_url",
        sourceUrl,
        requestTranscript,
      });
      return sendJson(response, 202, {
        run,
        transcript:
          requestTranscript
            ? { status: "not_configured", message: "本机尚未配置口播转写引擎。" }
            : { status: "not_requested" },
      });
    } catch (error) {
      return sendJson(response, 409, {
        error: error instanceof Error ? error.message : "无法启动链接采集任务。",
      });
    }
  }
  if (request.method === "POST" && path === "/api/evidence") {
    const body = await readJson(request);
    const title = firstValue(body.title);
    const summary = firstValue(body.summary);
    const platform = firstValue(body.platform);
    const author = firstValue(body.author);
    const signal = firstValue(body.signal) || "手动录入";
    const sourceUrl = firstValue(body.sourceUrl);
    if (!title || !summary || !platformSet.has(platform) || !author)
      return sendJson(response, 400, {
        error: "标题、内容摘要、平台和作者均为必填项。",
      });
    if (
      title.length > 180 ||
      summary.length > 2_000 ||
      author.length > 80 ||
      signal.length > 80 ||
      sourceUrl.length > 2_000
    )
      return sendJson(response, 400, { error: "情报字段超过允许长度。" });
    if (sourceUrl) {
      try {
        const url = new URL(sourceUrl);
        if (!["http:", "https:"].includes(url.protocol))
          throw new Error("unsupported protocol");
      } catch {
        return sendJson(response, 400, {
          error: "来源链接必须是有效的 HTTP 或 HTTPS 地址。",
        });
      }
    }
    const createdAt = now();
    const item = {
      id: crypto.randomUUID(),
      title,
      summary,
      body: summary,
      platform,
      author,
      signal,
      collectedAt: new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date()),
      sourceUrl,
      coverUrl: "",
      imageUrls: [],
      archivedAt: null,
    };
    db.prepare(
      "INSERT INTO evidence_items (id, title, summary, body, platform, author, signal, collected_at, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      item.id,
      item.title,
      item.summary,
      item.body,
      item.platform,
      item.author,
      item.signal,
      item.collectedAt,
      item.sourceUrl,
      createdAt,
    );
    return sendJson(response, 201, { item });
  }
  const evidenceMatch = path.match(/^\/api\/evidence\/([^/]+)$/);
  const archiveMatch = path.match(/^\/api\/evidence\/([^/]+)\/archive$/);
  if (request.method === "PUT" && archiveMatch) {
    const evidenceId = decodeURIComponent(archiveMatch[1]);
    const body = await readJson(request);
    if (typeof body.archived !== "boolean")
      return sendJson(response, 400, { error: "归档状态无效。" });
    const item = db
      .prepare("SELECT id FROM evidence_items WHERE id = ?")
      .get(evidenceId);
    if (!item) return sendJson(response, 404, { error: "内容情报不存在。" });
    const archivedAt = body.archived ? now() : "";
    db.prepare("UPDATE evidence_items SET archived_at = ? WHERE id = ?").run(
      archivedAt,
      evidenceId,
    );
    const updated = db
      .prepare(
        "SELECT id, title, summary, body, platform, author, signal, collected_at AS collectedAt, source_url AS sourceUrl, cover_url AS coverUrl, image_urls AS imageUrls, video_url AS videoUrl, transcript, transcript_status AS transcriptStatus, archived_at AS archivedAt FROM evidence_items WHERE id = ?",
      )
      .get(evidenceId);
    return sendJson(response, 200, {
      item: {
        ...updated,
        archivedAt: updated.archivedAt || null,
        imageUrls: (() => {
          try {
            const urls = JSON.parse(updated.imageUrls);
            return Array.isArray(urls)
              ? urls.filter((url) => typeof url === "string")
              : [];
          } catch {
            return [];
          }
        })(),
      },
    });
  }
  if (request.method === "DELETE" && evidenceMatch) {
    const evidenceId = decodeURIComponent(evidenceMatch[1]);
    if (
      !db.prepare("SELECT id FROM evidence_items WHERE id = ?").get(evidenceId)
    )
      return sendJson(response, 404, { error: "内容情报不存在。" });
    if (
      db
        .prepare("SELECT 1 FROM topic_evidence WHERE evidence_id = ? LIMIT 1")
        .get(evidenceId)
    )
      return sendJson(response, 409, {
        error: "该内容正在被选题引用，请先替换或删除对应选题。",
      });
    db.prepare("DELETE FROM evidence_items WHERE id = ?").run(evidenceId);
    return sendJson(response, 200, { id: evidenceId });
  }
  if (request.method === "POST" && path === "/api/topics") {
    const body = await readJson(request);
    const title = firstValue(body.title);
    const angle = firstValue(body.angle);
    const evidenceIds = Array.isArray(body.evidenceIds)
      ? [
          ...new Set(
            body.evidenceIds.filter((value) => typeof value === "string"),
          ),
        ]
      : [];
    if (!title || !angle || evidenceIds.length === 0)
      return sendJson(response, 400, {
        error: "选题标题、内容角度和至少一条引用均为必填项。",
      });
    const evidenceCount = db
      .prepare(
        `SELECT COUNT(*) AS count FROM evidence_items WHERE id IN (${evidenceIds.map(() => "?").join(",")})`,
      )
      .get(...evidenceIds).count;
    if (evidenceCount !== evidenceIds.length)
      return sendJson(response, 400, { error: "引用内容不存在。" });
    const topic = {
      id: crypto.randomUUID(),
      title,
      angle,
      status: "待确认",
      evidenceIds,
    };
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO topics (id, title, angle, status, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(topic.id, topic.title, topic.angle, topic.status, now());
      const link = db.prepare(
        "INSERT INTO topic_evidence (topic_id, evidence_id) VALUES (?, ?)",
      );
      evidenceIds.forEach((evidenceId) => link.run(topic.id, evidenceId));
      db.exec("COMMIT");
      return sendJson(response, 201, { topic });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const topicMatch = path.match(/^\/api\/topics\/([^/]+)$/);
  if (request.method === "PUT" && topicMatch) {
    const topicId = decodeURIComponent(topicMatch[1]);
    const body = await readJson(request);
    const status = firstValue(body.status);
    if (status !== "已确认")
      return sendJson(response, 400, { error: "仅支持确认选题。" });
    const result = db
      .prepare(
        "UPDATE topics SET status = '已确认' WHERE id = ? AND status = '待确认'",
      )
      .run(topicId);
    if (result.changes === 0)
      return sendJson(
        response,
        db.prepare("SELECT id FROM topics WHERE id = ?").get(topicId)
          ? 409
          : 404,
        { error: "选题已确认或不存在。" },
      );
    return sendJson(response, 200, {
      topic: listTopics().find((topic) => topic.id === topicId),
    });
  }
  if (request.method === "POST" && path === "/api/projects") {
    const body = await readJson(request);
    const title = firstValue(body.title);
    const platform = firstValue(body.platform);
    const contentFormat = firstValue(body.contentFormat) || "图文笔记";
    const topicId = firstValue(body.topicId) || null;
    const content = typeof body.body === "string" ? body.body : "";
    if (
      !title ||
      !platformSet.has(platform) ||
      !contentFormatSet.has(contentFormat)
    )
      return sendJson(response, 400, {
        error: "稿件标题、目标平台或内容格式无效。",
      });
    if (content.length > 60 * 1024)
      return sendJson(response, 400, { error: "正文不能超过 60,000 个字符。" });
    const topic = topicId
      ? db.prepare("SELECT id, status FROM topics WHERE id = ?").get(topicId)
      : null;
    if (topicId && !topic)
      return sendJson(response, 400, { error: "选题不存在。" });
    if (topic && topic.status !== "已确认")
      return sendJson(response, 409, { error: "请先确认选题，再创建稿件。" });
    const createdAt = now();
    const project = {
      id: crypto.randomUUID(),
      title,
      platform,
      contentFormat,
      topicId,
      status: "草稿",
      reviewStatus: "草稿",
      reviewNote: "",
      body: content,
      version: 1,
      updatedAt: createdAt,
      scheduledAt: null,
      publishedAt: null,
    };
    db.prepare(
      "INSERT INTO content_projects (id, title, platform, content_format, topic_id, status, body, version, created_at, updated_at, review_status, review_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      project.id,
      project.title,
      project.platform,
      project.contentFormat,
      project.topicId,
      project.status,
      project.body,
      project.version,
      createdAt,
      project.updatedAt,
      project.reviewStatus,
      project.reviewNote,
    );
    return sendJson(response, 201, { project: getProject(project.id) });
  }
  const variantMatch = path.match(/^\/api\/projects\/([^/]+)\/variants$/);
  if (request.method === "POST" && variantMatch) {
    const projectId = decodeURIComponent(variantMatch[1]);
    const body = await readJson(request);
    const platform = firstValue(body.platform);
    const contentFormat = firstValue(body.contentFormat);
    if (!platformSet.has(platform) || !contentFormatSet.has(contentFormat))
      return sendJson(response, 400, { error: "目标平台或内容格式无效。" });
    const source = getProject(projectId);
    if (!source) return sendJson(response, 404, { error: "原稿件不存在。" });
    if (source.platform === platform && source.contentFormat === contentFormat)
      return sendJson(response, 409, { error: "请选择不同的平台或内容格式。" });
    const createdAt = now();
    const project = {
      id: crypto.randomUUID(),
      title: `${source.title} · ${platform}`,
      platform,
      contentFormat,
      topicId: source.topicId || null,
      sourceProjectId: source.id,
      status: "草稿",
      reviewStatus: "草稿",
      reviewNote: "",
      body: source.body,
      version: 1,
      updatedAt: createdAt,
    };
    db.prepare(
      "INSERT INTO content_projects (id, title, platform, content_format, topic_id, source_project_id, status, body, version, created_at, updated_at, review_status, review_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      project.id,
      project.title,
      project.platform,
      project.contentFormat,
      project.topicId,
      project.sourceProjectId,
      project.status,
      project.body,
      project.version,
      createdAt,
      project.updatedAt,
      project.reviewStatus,
      project.reviewNote,
    );
    return sendJson(response, 201, { project: getProject(project.id) });
  }
  const scheduleMatch = path.match(/^\/api\/projects\/([^/]+)\/schedule$/);
  if (request.method === "PUT" && scheduleMatch) {
    const projectId = decodeURIComponent(scheduleMatch[1]);
    const body = await readJson(request);
    const scheduledAt = firstValue(body.scheduledAt);
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt)))
      return sendJson(response, 400, { error: "请选择有效的发布时间。" });
    const project = getProject(projectId);
    if (!project) return sendJson(response, 404, { error: "稿件不存在。" });
    if (project.reviewStatus !== "已批准")
      return sendJson(response, 400, {
        error: "只有已批准稿件可以进入发布日历。",
      });
    if (project.publishedAt)
      return sendJson(response, 409, {
        error: "该稿件已确认发布，不能再调整排期。",
      });
    const changedAt = now();
    db.prepare(
      "INSERT INTO publication_plans (project_id, scheduled_at, published_at, created_at, updated_at) VALUES (?, ?, NULL, ?, ?) ON CONFLICT(project_id) DO UPDATE SET scheduled_at = excluded.scheduled_at, published_at = NULL, updated_at = excluded.updated_at",
    ).run(projectId, scheduledAt, changedAt, changedAt);
    return sendJson(response, 200, { project: getProject(projectId) });
  }
  const publishMatch = path.match(/^\/api\/projects\/([^/]+)\/publish$/);
  if (request.method === "PUT" && publishMatch) {
    const projectId = decodeURIComponent(publishMatch[1]);
    const project = getProject(projectId);
    if (!project) return sendJson(response, 404, { error: "稿件不存在。" });
    if (!project.scheduledAt)
      return sendJson(response, 400, { error: "请先安排发布时间。" });
    if (project.publishedAt)
      return sendJson(response, 409, { error: "该稿件已确认发布。" });
    if (Date.parse(project.scheduledAt) > Date.now())
      return sendJson(response, 400, {
        error: "尚未到发布时间，不能确认发布。",
      });
    const changedAt = now();
    db.prepare(
      "UPDATE publication_plans SET published_at = ?, updated_at = ? WHERE project_id = ?",
    ).run(changedAt, changedAt, projectId);
    return sendJson(response, 200, { project: getProject(projectId) });
  }
  const metricsMatch = path.match(/^\/api\/projects\/([^/]+)\/metrics$/);
  if (request.method === "PUT" && metricsMatch) {
    const projectId = decodeURIComponent(metricsMatch[1]);
    const body = await readJson(request);
    const publishedUrl = firstValue(body.publishedUrl);
    const metricViews = body.metricViews;
    const metricLikes = body.metricLikes;
    const metricComments = body.metricComments;
    const metricSaves = body.metricSaves;
    const metricValues = [
      metricViews,
      metricLikes,
      metricComments,
      metricSaves,
    ];
    if (publishedUrl.length > 2_000)
      return sendJson(response, 400, {
        error: "发布链接不能超过 2,000 个字符。",
      });
    if (publishedUrl) {
      try {
        const url = new URL(publishedUrl);
        if (!["http:", "https:"].includes(url.protocol))
          throw new Error("unsupported protocol");
      } catch {
        return sendJson(response, 400, {
          error: "发布链接必须是有效的 HTTP 或 HTTPS 地址。",
        });
      }
    }
    if (
      metricValues.some(
        (value) =>
          !Number.isInteger(value) || value < 0 || value > 2_147_483_647,
      )
    )
      return sendJson(response, 400, {
        error: "表现数据必须是 0 至 2,147,483,647 的整数。",
      });
    const project = getProject(projectId);
    if (!project) return sendJson(response, 404, { error: "稿件不存在。" });
    if (!project.publishedAt)
      return sendJson(response, 409, {
        error: "请先人工确认发布，再记录表现。",
      });
    const changedAt = now();
    db.prepare(
      "UPDATE publication_plans SET published_url = ?, metric_views = ?, metric_likes = ?, metric_comments = ?, metric_saves = ?, metrics_recorded_at = ?, updated_at = ? WHERE project_id = ?",
    ).run(
      publishedUrl,
      metricViews,
      metricLikes,
      metricComments,
      metricSaves,
      changedAt,
      changedAt,
      projectId,
    );
    return sendJson(response, 200, { project: getProject(projectId) });
  }
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (request.method === "PUT" && projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1]);
    const body = await readJson(request);
    const title = firstValue(body.title);
    const platform = firstValue(body.platform);
    const contentFormat = firstValue(body.contentFormat) || "图文笔记";
    const content = typeof body.body === "string" ? body.body : "";
    const reviewStatus = firstValue(body.reviewStatus || body.status);
    const reviewNote = firstValue(body.reviewNote);
    const version = Number.isInteger(body.version) ? body.version : 0;
    if (
      !title ||
      !platformSet.has(platform) ||
      !contentFormatSet.has(contentFormat) ||
      !reviewStatusSet.has(reviewStatus) ||
      version < 1
    )
      return sendJson(response, 400, { error: "稿件内容、格式或版本无效。" });
    if (content.length > 60 * 1024)
      return sendJson(response, 400, { error: "正文不能超过 60,000 个字符。" });
    if (reviewNote.length > 2_000)
      return sendJson(response, 400, {
        error: "审核意见不能超过 2,000 个字符。",
      });
    const updatedAt = now();
    const status = reviewStatus === "草稿" ? "草稿" : "待审核";
    const result = db
      .prepare(
        "UPDATE content_projects SET title = ?, platform = ?, content_format = ?, status = ?, review_status = ?, review_note = ?, body = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
      )
      .run(
        title,
        platform,
        contentFormat,
        status,
        reviewStatus,
        reviewNote,
        content,
        updatedAt,
        projectId,
        version,
      );
    if (result.changes === 0)
      return sendJson(
        response,
        db
          .prepare("SELECT id FROM content_projects WHERE id = ?")
          .get(projectId)
          ? 409
          : 404,
        { error: "稿件已在其他位置更新，请刷新后再保存。" },
      );
    const project = getProject(projectId);
    return sendJson(response, 200, { project });
  }
  return sendJson(response, 404, { error: "接口不存在。" });
}

const vite = isDevelopment
  ? await createViteServer({
      root: rootDir,
      appType: "spa",
      server: { middlewareMode: true },
    })
  : null;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

async function serveProduction(request, response, pathname) {
  const candidate = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(candidate).replace(/^([.][.][/\\])+/, "");
  const filePath = join(rootDir, "dist", safePath);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "Content-Type":
        contentTypes[extname(filePath)] || "application/octet-stream",
    });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(await readFile(join(rootDir, "dist", "index.html")));
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || "localhost"}`,
  );
  try {
    if (url.pathname.startsWith("/api/"))
      return await handleApi(request, response, url.pathname);
    if (vite)
      return vite.middlewares(request, response, () => {
        response.writeHead(404);
        response.end();
      });
    return await serveProduction(request, response, url.pathname);
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: "服务暂时不可用。" });
  }
});

server.listen(port, "127.0.0.1", () =>
  console.log(`Creator OS is running at http://127.0.0.1:${port}`),
);
