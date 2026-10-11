#!/usr/bin/env node

const apiUrl = (process.env.CATO_API_URL || "http://127.0.0.1:5173").replace(/\/$/u, "");
const token = process.env.CATO_API_TOKEN || "";

const tools = [
  {
    name: "cato_search_library",
    title: "搜索 Cato 资料库",
    description: "按标题、正文、分类和标签搜索 Cato 资料库，返回匹配结果与正文摘录。",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "检索词；留空返回最近资料。" } },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "cato_read_library_document",
    title: "读取 Cato 资料",
    description: "读取一份资料库文档的完整正文。先用 cato_search_library 获取 documentId。",
    inputSchema: {
      type: "object",
      properties: { documentId: { type: "string", description: "资料 ID。" } },
      required: ["documentId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "cato_search_intelligence",
    title: "搜索 Cato 内容情报",
    description: "搜索已采集的内容情报；可按小红书、公众号或抖音筛选。",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索词；留空返回最新情报。" },
        platform: { type: "string", enum: ["小红书", "公众号", "抖音"], description: "可选平台。" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "cato_capture_inbox_note",
    title: "记录到 Cato 灵感收件箱",
    description: "将一条灵感写入 Cato 收件箱。必须先取得用户确认，再传 confirmed: true。",
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string", description: "灵感正文。" },
        tags: { type: "array", items: { type: "string" }, description: "可选标签。" },
        confirmed: { type: "boolean", description: "仅在用户明确确认写入后设为 true。" }
      },
      required: ["body", "confirmed"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  },
  {
    name: "cato_list_content_projects",
    title: "列出 Cato 创作项目",
    description: "读取 Cato 的创作项目及其审核、发布状态。",
    inputSchema: {
      type: "object",
      properties: { reviewStatus: { type: "string", enum: ["草稿", "待审核", "已批准"], description: "可选审核状态。" } },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "cato_create_content_project",
    title: "创建 Cato 创作项目",
    description: "在 Cato 创建一份草稿项目。必须先向用户展示关键信息并取得确认。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "稿件标题。" },
        platform: { type: "string", enum: ["小红书", "公众号", "抖音"], description: "目标平台。" },
        contentFormat: { type: "string", enum: ["图文笔记", "长文文章", "短视频脚本", "口播稿"], description: "内容形式，默认图文笔记。" },
        topicId: { type: "string", description: "可选，已确认选题的 ID。" },
        body: { type: "string", description: "可选，初始正文。" },
        confirmed: { type: "boolean", description: "仅在用户明确确认创建后设为 true。" }
      },
      required: ["title", "platform", "confirmed"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false }
  }
];

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function cato(path, options = {}) {
  if (!token) throw new Error("缺少 Cato 连接令牌。请在 WorkBuddy 连接器设置中重新填写。");
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Cato 请求失败（${response.status}）。`);
  return payload;
}

async function callTool(name, args = {}) {
  if (name === "cato_search_library") {
    const search = new URLSearchParams();
    if (args.query) search.set("q", args.query);
    return cato(`/api/workbuddy/library/search?${search}`);
  }
  if (name === "cato_read_library_document") return cato(`/api/workbuddy/library/${encodeURIComponent(args.documentId)}`);
  if (name === "cato_search_intelligence") {
    const search = new URLSearchParams();
    if (args.query) search.set("q", args.query);
    if (args.platform) search.set("platform", args.platform);
    return cato(`/api/workbuddy/intelligence/search?${search}`);
  }
  if (name === "cato_capture_inbox_note") return cato("/api/workbuddy/inbox", { method: "POST", body: JSON.stringify(args) });
  if (name === "cato_list_content_projects") {
    const search = new URLSearchParams();
    if (args.reviewStatus) search.set("reviewStatus", args.reviewStatus);
    return cato(`/api/workbuddy/projects?${search}`);
  }
  if (name === "cato_create_content_project") return cato("/api/workbuddy/projects", { method: "POST", body: JSON.stringify(args) });
  throw new Error("未知的 Cato 工具。");
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return null;
  if (message.method === "notifications/initialized") return null;
  if (message.method === "initialize") {
    return rpcResult(message.id, {
      protocolVersion: message.params?.protocolVersion || "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "cato-ai-content-workbench", version: "0.1.0" }
    });
  }
  if (message.method === "ping") return rpcResult(message.id, {});
  if (message.method === "tools/list") return rpcResult(message.id, { tools });
  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {});
      return rpcResult(message.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (error) {
      return rpcResult(message.id, {
        content: [{ type: "text", text: error instanceof Error ? error.message : "Cato 调用失败。" }],
        isError: true
      });
    }
  }
  return rpcError(message.id, -32601, `不支持的方法：${message.method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).replace(/\r$/u, "");
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    try {
      const response = await handle(JSON.parse(line));
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "无效的 JSON-RPC 请求。"))}\n`);
    }
  }
});
