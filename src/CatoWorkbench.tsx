import {
  ChangeEvent,
  FormEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Command,
  FilePenLine,
  FolderOpen,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  Link2,
  Lightbulb,
  LogOut,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";

type Section =
  | "概览"
  | "内容情报"
  | "灵感收件箱"
  | "评论洞察"
  | "资料库"
  | "创作项目"
  | "发布日历"
  | "素材资产"
  | "归档";
type Platform = "小红书" | "公众号" | "抖音";
type ContentFormat = "图文笔记" | "长文文章" | "短视频脚本" | "口播稿";
type ReviewStatus = "草稿" | "待审核" | "已批准";
type IntelligenceItem = {
  id: string;
  title: string;
  summary: string;
  body: string;
  platform: Platform;
  author: string;
  signal: string;
  collectedAt: string;
  sourceUrl: string;
  coverUrl: string;
  imageUrls: string[];
  videoUrl: string;
  transcript: string;
  transcriptStatus: "not_requested" | "not_configured" | "queued" | "running" | "succeeded" | "failed";
  archivedAt: string | null;
};
type Topic = {
  id: string;
  title: string;
  angle: string;
  evidenceIds: string[];
  status: "待确认" | "已确认";
  inboxNoteId?: string | null;
};
type InboxNote = {
  id: string;
  body: string;
  tags: string[];
  topicId: string | null;
  createdAt: string;
  updatedAt: string;
};
type LibraryDocument = {
  id: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  version: number;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  sourceFileName?: string;
  sourceFileType?: string;
  sourceFileSize?: number;
};
type LibraryVersion = Pick<
  LibraryDocument,
  "id" | "title" | "body" | "category" | "tags" | "version" | "updatedBy" | "createdAt"
> & { documentId: string };
type Project = {
  id: string;
  title: string;
  platform: Platform;
  contentFormat: ContentFormat;
  topicId?: string;
  sourceProjectId?: string;
  status: "草稿" | "待审核";
  reviewStatus: ReviewStatus;
  reviewNote: string;
  body: string;
  version: number;
  updatedAt: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  publishedUrl: string;
  metricViews: number;
  metricLikes: number;
  metricComments: number;
  metricSaves: number;
  metricsRecordedAt: string | null;
};
type TopicDraft = Pick<Topic, "title" | "angle" | "evidenceIds">;
type EvidenceDraft = Pick<
  IntelligenceItem,
  "title" | "summary" | "platform" | "author" | "signal" | "sourceUrl"
>;
type ProjectDraft = Pick<
  Project,
  "title" | "platform" | "contentFormat" | "topicId" | "body"
>;
type ProjectUpdate = Pick<
  Project,
  | "id"
  | "title"
  | "platform"
  | "contentFormat"
  | "reviewStatus"
  | "reviewNote"
  | "body"
  | "version"
>;
type MediaCrawlerConnector = {
  id: "mediacrawler";
  label: "MediaCrawler";
  source: string;
  root: string;
  installed: boolean;
  prepared: boolean;
  activeRuns: number;
  status: "missing" | "needs_setup" | "preparing" | "ready" | "running";
};
type CrawlRun = {
  id: string;
  provider: "mediacrawler";
  platform: string;
  query: string;
  maxItems: number;
  status: "running" | "succeeded" | "failed";
  importedCount: number;
  importedComments: number;
  captureMode: "keyword" | "douyin_url";
  sourceUrl: string;
  transcriptStatus: "not_requested" | "not_configured" | "queued" | "running" | "succeeded" | "failed";
  errorMessage: string;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
};
type CrawlRequest = Pick<CrawlRun, "platform" | "query" | "maxItems"> & {
  collectComments: boolean;
  mode?: "keyword" | "douyin_url";
  sourceUrl?: string;
  requestTranscript?: boolean;
};
type IntelligenceComment = {
  id: string;
  evidenceId: string;
  evidenceTitle: string;
  platform: Platform;
  author: string;
  body: string;
  likeCount: number;
  replyCount: number;
  commentedAt: string;
  collectedAt: string;
};
type BootstrapData = {
  sources: IntelligenceItem[];
  archivedSources: IntelligenceItem[];
  topics: Topic[];
  projects: Project[];
  connectors: { mediaCrawler: MediaCrawlerConnector };
  crawlRuns: CrawlRun[];
  inboxNotes: InboxNote[];
  libraryDocuments: LibraryDocument[];
  comments: IntelligenceComment[];
};
type WorkBuddyConnectionStatus = {
  connected: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  apiUrl: string;
};

const navItems: Array<{ label: Section; icon: typeof LayoutDashboard }> = [
  { label: "概览", icon: LayoutDashboard },
  { label: "内容情报", icon: Inbox },
  { label: "灵感收件箱", icon: Lightbulb },
  { label: "资料库", icon: BookOpen },
  { label: "评论洞察", icon: MessageCircle },
  { label: "创作项目", icon: FilePenLine },
  { label: "发布日历", icon: CalendarDays },
];
const reviewTone = (status: ReviewStatus) =>
  status === "待审核" ? "review" : status === "已批准" ? "success" : "schedule";
const platformLogoSrc: Record<Platform, string> = {
  小红书: "https://cdn.simpleicons.org/xiaohongshu/FF2442",
  公众号: "https://cdn.simpleicons.org/wechat/07C160",
  抖音: "https://cdn.simpleicons.org/tiktok/000000",
};
const crawlerPlatformLogoSrc = {
  xhs: platformLogoSrc.小红书,
  dy: platformLogoSrc.抖音,
} as const;

type CatoWorkbenchProps = {
  user: { id: string; email: string; displayName: string };
  onLogout: () => void;
};

function CatoWorkbench({ user, onLogout }: CatoWorkbenchProps) {
  const workspaceName = user.displayName || user.email.split("@")[0] || "工作区";
  const [section, setSection] = useState<Section>("概览");
  const [intelligenceSeedId, setIntelligenceSeedId] = useState<string | null>(
    null,
  );
  const [composerTopic, setComposerTopic] = useState<Topic | null | undefined>(
    undefined,
  );
  const [editorProject, setEditorProject] = useState<Project | undefined>(
    undefined,
  );
  const [notice, setNotice] = useState("");
  const [sources, setSources] = useState<IntelligenceItem[]>([]);
  const [archivedSources, setArchivedSources] = useState<IntelligenceItem[]>(
    [],
  );
  const [topics, setTopics] = useState<Topic[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mediaCrawler, setMediaCrawler] =
    useState<MediaCrawlerConnector | null>(null);
  const [crawlRuns, setCrawlRuns] = useState<CrawlRun[]>([]);
  const [inboxNotes, setInboxNotes] = useState<InboxNote[]>([]);
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>(
    [],
  );
  const [comments, setComments] = useState<IntelligenceComment[]>([]);
  const [dataState, setDataState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [dataError, setDataError] = useState("");
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [workBuddyOpen, setWorkBuddyOpen] = useState(false);
  const [workBuddyStatus, setWorkBuddyStatus] =
    useState<WorkBuddyConnectionStatus | null>(null);
  const [workBuddyToken, setWorkBuddyToken] = useState("");
  const [isWorkBuddyLoading, setIsWorkBuddyLoading] = useState(false);
  const [intelligenceSearchRequest, setIntelligenceSearchRequest] = useState<{
    query: string;
    id: number;
  } | null>(null);
  const workspaceSearchRef = useRef<HTMLInputElement>(null);
  const crawlerWasRunningRef = useRef(false);

  const loadWorkspace = async () => {
    setDataState("loading");
    setDataError("");
    try {
      const response = await fetch("/api/bootstrap");
      const data = (await response.json()) as BootstrapData & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "无法读取本地数据。");
      setSources(data.sources);
      setArchivedSources(data.archivedSources ?? []);
      setTopics(data.topics);
      setProjects(data.projects);
      setMediaCrawler(data.connectors?.mediaCrawler ?? null);
      setCrawlRuns(data.crawlRuns ?? []);
      setInboxNotes(data.inboxNotes ?? []);
      setLibraryDocuments(data.libraryDocuments ?? []);
      setComments(data.comments ?? []);
      setDataState("ready");
    } catch (error) {
      setDataState("error");
      setDataError(
        error instanceof Error ? error.message : "无法连接本地 SQLite 服务。",
      );
    }
  };
  const archiveEvidence = async (evidenceId: string, archived: boolean) => {
    try {
      const response = await fetch(
        `/api/evidence/${encodeURIComponent(evidenceId)}/archive`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived }),
        },
      );
      const data = (await response.json()) as {
        item?: IntelligenceItem;
        error?: string;
      };
      if (!response.ok || !data.item)
        throw new Error(data.error || "归档状态更新失败。");
      if (archived) {
        setSources((current) =>
          current.filter((item) => item.id !== data.item!.id),
        );
        setArchivedSources((current) => [
          data.item!,
          ...current.filter((item) => item.id !== data.item!.id),
        ]);
        setNotice("素材已归档。");
      } else {
        setArchivedSources((current) =>
          current.filter((item) => item.id !== data.item!.id),
        );
        setSources((current) => [
          data.item!,
          ...current.filter((item) => item.id !== data.item!.id),
        ]);
        setNotice("素材已恢复到内容情报。");
      }
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "归档状态更新失败。");
      return false;
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, []);
  useEffect(() => {
    document
      .getElementById("main-content")
      ?.scrollTo({ top: 0, behavior: "auto" });
  }, [section]);
  useEffect(() => {
    const shouldPoll =
      mediaCrawler?.status === "preparing" ||
      crawlRuns.some((run) => run.status === "running");
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      void fetch("/api/connectors/mediacrawler")
        .then(async (response) => {
          const data = (await response.json()) as {
            connector?: MediaCrawlerConnector;
            runs?: CrawlRun[];
          };
          if (response.ok) {
            const nextRuns = data.runs ?? [];
            const isRunning = nextRuns.some((run) => run.status === "running");
            const justFinished = crawlerWasRunningRef.current && !isRunning;
            crawlerWasRunningRef.current = isRunning;
            setMediaCrawler(data.connector ?? null);
            setCrawlRuns(nextRuns);
            if (justFinished) void loadWorkspace();
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [mediaCrawler?.status, crawlRuns]);
  const openComposer = (topic?: Topic | null) => {
    setEditorProject(undefined);
    setComposerTopic(topic);
    setNotice(
      topic ? `准备从「${topic.title}」创建稿件。` : "已打开新建内容。",
    );
  };
  const openProject = (project: Project) => {
    setComposerTopic(undefined);
    setEditorProject(project);
    setNotice(`已打开「${project.title}」。`);
  };
  const runWorkspaceSearch = () => {
    const query = workspaceSearch.trim();
    if (!query) {
      workspaceSearchRef.current?.focus();
      setNotice("输入关键词后按 Enter 搜索。");
      return;
    }
    setIntelligenceSearchRequest({ query, id: Date.now() });
    setSection("内容情报");
    setNotice(`正在内容情报中搜索「${query}」。`);
  };
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]'))
        return;
      if (
        event.key.toLowerCase() === "n" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        openComposer(null);
        return;
      }
      if (
        event.key === "/" ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        workspaceSearchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [openComposer]);
  const prepareMediaCrawler = async () => {
    try {
      const response = await fetch("/api/connectors/mediacrawler/prepare", {
        method: "POST",
      });
      const data = (await response.json()) as {
        connector?: MediaCrawlerConnector;
        error?: string;
      };
      if (!response.ok || !data.connector)
        throw new Error(data.error || "无法初始化 MediaCrawler。");
      setMediaCrawler(data.connector);
      setNotice("正在初始化 MediaCrawler 运行环境。");
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "无法初始化 MediaCrawler。",
      );
      return false;
    }
  };
  const startMediaCrawler = async (request: CrawlRequest) => {
    try {
      const response = await fetch(
        request.mode === "douyin_url"
          ? "/api/crawls/douyin-url"
          : "/api/crawls/mediacrawler",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        },
      );
      const data = (await response.json()) as {
        run?: CrawlRun;
        error?: string;
      };
      if (!response.ok || !data.run)
        throw new Error(data.error || "无法启动采集任务。");
      setCrawlRuns((current) => [data.run!, ...current]);
      crawlerWasRunningRef.current = true;
      setMediaCrawler((current) =>
        current
          ? {
              ...current,
              status: "running",
              activeRuns: current.activeRuns + 1,
            }
          : current,
      );
      setNotice(
        data.run.captureMode === "douyin_url"
          ? "正在采集抖音视频的发布文案、封面和评论。"
          : `正在通过 MediaCrawler 采集「${data.run.query}」。`,
      );
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法启动采集任务。");
      return false;
    }
  };
  const saveInboxNote = async (body: string, tags: string[]) => {
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, tags }),
      });
      const data = (await response.json()) as { note?: InboxNote; error?: string };
      if (!response.ok || !data.note)
        throw new Error(data.error || "灵感保存失败。");
      setInboxNotes((current) => [data.note!, ...current]);
      setNotice("灵感已收进 Inbox。");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "灵感保存失败。");
      return false;
    }
  };
  const deleteInboxNote = async (noteId: string) => {
    try {
      const response = await fetch(`/api/inbox/${encodeURIComponent(noteId)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id)
        throw new Error(data.error || "灵感删除失败。");
      setInboxNotes((current) => current.filter((note) => note.id !== noteId));
      setNotice("灵感已删除。");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "灵感删除失败。");
      return false;
    }
  };
  const createTopicFromInbox = async (noteId: string) => {
    try {
      const response = await fetch(
        `/api/inbox/${encodeURIComponent(noteId)}/topic`,
        { method: "POST" },
      );
      const data = (await response.json()) as {
        topic?: Topic;
        noteId?: string;
        error?: string;
      };
      if (!response.ok || !data.topic || !data.noteId)
        throw new Error(data.error || "创建选题失败。");
      setTopics((current) => [data.topic!, ...current]);
      setInboxNotes((current) =>
        current.map((note) =>
          note.id === data.noteId
            ? { ...note, topicId: data.topic!.id, updatedAt: new Date().toISOString() }
            : note,
        ),
      );
      setNotice(`已从灵感创建选题「${data.topic.title}」。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建选题失败。");
      return false;
    }
  };
  const createLibraryDocument = async (
    draft: Pick<LibraryDocument, "title" | "body" | "category" | "tags">,
  ) => {
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await response.json()) as {
        document?: LibraryDocument;
        error?: string;
      };
      if (!response.ok || !data.document)
        throw new Error(data.error || "资料创建失败。");
      setLibraryDocuments((current) => [data.document!, ...current]);
      setNotice(`资料「${data.document.title}」已创建。`);
      return data.document;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "资料创建失败。");
      return null;
    }
  };
  const importLibraryDocument = async (file: File) => {
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("无法读取该文件。"));
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          const separator = result.indexOf(",");
          if (separator < 0) return reject(new Error("文件编码失败。"));
          resolve(result.slice(separator + 1));
        };
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentBase64 }),
      });
      const data = (await response.json()) as {
        document?: LibraryDocument;
        wasTruncated?: boolean;
        error?: string;
      };
      if (!response.ok || !data.document)
        throw new Error(data.error || "资料导入失败。");
      setLibraryDocuments((current) => [data.document!, ...current]);
      setNotice(
        data.wasTruncated
          ? `已导入「${data.document.title}」，正文已截取前 50,000 字符。`
          : `已导入「${data.document.title}」。`,
      );
      return data.document;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "资料导入失败。");
      return null;
    }
  };
  const updateLibraryDocument = async (
    draft: Pick<LibraryDocument, "id" | "title" | "body" | "category" | "tags" | "version">,
  ) => {
    try {
      const response = await fetch(`/api/library/${encodeURIComponent(draft.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await response.json()) as {
        document?: LibraryDocument;
        error?: string;
      };
      if (!response.ok || !data.document)
        throw new Error(data.error || "资料保存失败。");
      setLibraryDocuments((current) =>
        current.map((item) =>
          item.id === data.document!.id ? data.document! : item,
        ),
      );
      setNotice(`资料已更新至 v${data.document.version}。`);
      return data.document;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "资料保存失败。");
      return null;
    }
  };
  const getLibraryHistory = async (documentId: string) => {
    try {
      const response = await fetch(
        `/api/library/${encodeURIComponent(documentId)}/history`,
      );
      const data = (await response.json()) as {
        versions?: LibraryVersion[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "无法读取更新记录。");
      return data.versions ?? [];
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法读取更新记录。");
      return [];
    }
  };
  const saveEvidence = async (evidence: EvidenceDraft) => {
    try {
      const response = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evidence),
      });
      const data = (await response.json()) as {
        item?: IntelligenceItem;
        error?: string;
      };
      if (!response.ok || !data.item)
        throw new Error(data.error || "情报保存失败。");
      setSources((current) => [data.item!, ...current]);
      setNotice(`情报「${data.item.title}」已保存。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "情报保存失败。");
      return false;
    }
  };
  const deleteEvidence = async (evidenceId: string) => {
    try {
      const response = await fetch(
        `/api/evidence/${encodeURIComponent(evidenceId)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id)
        throw new Error(data.error || "内容情报删除失败。");
      setSources((current) => current.filter((item) => item.id !== data.id));
      setNotice("内容情报已删除。");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "内容情报删除失败。");
      return false;
    }
  };
  const saveTopic = async (topic: TopicDraft) => {
    try {
      const response = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(topic),
      });
      const data = (await response.json()) as { topic?: Topic; error?: string };
      if (!response.ok || !data.topic)
        throw new Error(data.error || "选题保存失败。");
      setTopics((current) => [data.topic!, ...current]);
      setSection("创作项目");
      setNotice(`选题「${data.topic.title}」已保存，确认后即可创建稿件。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "选题保存失败。");
      return false;
    }
  };
  const confirmTopic = async (topicId: string) => {
    try {
      const response = await fetch(
        `/api/topics/${encodeURIComponent(topicId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "已确认" }),
        },
      );
      const data = (await response.json()) as { topic?: Topic; error?: string };
      if (!response.ok || !data.topic)
        throw new Error(data.error || "选题确认失败。");
      setTopics((current) =>
        current.map((item) =>
          item.id === data.topic!.id ? data.topic! : item,
        ),
      );
      setNotice(`选题「${data.topic.title}」已确认，可以开始创作。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "选题确认失败。");
      return false;
    }
  };
  const saveProject = async (project: ProjectDraft) => {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      const data = (await response.json()) as {
        project?: Project;
        error?: string;
      };
      if (!response.ok || !data.project)
        throw new Error(data.error || "草稿创建失败。");
      setProjects((current) => [data.project!, ...current]);
      setComposerTopic(undefined);
      setSection("创作项目");
      setEditorProject(data.project);
      setNotice(`草稿「${data.project.title}」已创建。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "草稿创建失败。");
      return false;
    }
  };
  const updateProject = async (project: ProjectUpdate) => {
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(project),
        },
      );
      const data = (await response.json()) as {
        project?: Project;
        error?: string;
      };
      if (!response.ok || !data.project)
        throw new Error(data.error || "稿件保存失败。");
      setProjects((current) =>
        current.map((item) =>
          item.id === data.project!.id ? data.project! : item,
        ),
      );
      setEditorProject(data.project);
      setNotice(
        data.project.reviewStatus === "待审核"
          ? `稿件「${data.project.title}」已提交审核。`
          : data.project.reviewStatus === "已批准"
            ? `稿件「${data.project.title}」已通过审核。`
            : `稿件「${data.project.title}」已保存。`,
      );
      return data.project;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "稿件保存失败。");
      return null;
    }
  };
  const createProjectVariant = async (
    projectId: string,
    platform: Platform,
    contentFormat: ContentFormat,
  ) => {
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/variants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, contentFormat }),
        },
      );
      const data = (await response.json()) as {
        project?: Project;
        error?: string;
      };
      if (!response.ok || !data.project)
        throw new Error(data.error || "内容变体创建失败。");
      setProjects((current) => [data.project!, ...current]);
      setEditorProject(data.project);
      setNotice(`已创建「${data.project.title}」，可继续改写。`);
      return data.project;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "内容变体创建失败。");
      return null;
    }
  };
  const scheduleProject = async (projectId: string, scheduledAt: string) => {
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/schedule`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt }),
        },
      );
      const data = (await response.json()) as {
        project?: Project;
        error?: string;
      };
      if (!response.ok || !data.project)
        throw new Error(data.error || "排期保存失败。");
      setProjects((current) =>
        current.map((item) =>
          item.id === data.project!.id ? data.project! : item,
        ),
      );
      setNotice(`已安排「${data.project.title}」的发布时间。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "排期保存失败。");
      return false;
    }
  };
  const markProjectPublished = async (projectId: string) => {
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/publish`,
        { method: "PUT" },
      );
      const data = (await response.json()) as {
        project?: Project;
        error?: string;
      };
      if (!response.ok || !data.project)
        throw new Error(data.error || "发布状态更新失败。");
      setProjects((current) =>
        current.map((item) =>
          item.id === data.project!.id ? data.project! : item,
        ),
      );
      setNotice(`已确认「${data.project.title}」发布。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "发布状态更新失败。");
      return false;
    }
  };
  const recordProjectMetrics = async (
    projectId: string,
    metrics: Pick<
      Project,
      | "publishedUrl"
      | "metricViews"
      | "metricLikes"
      | "metricComments"
      | "metricSaves"
    >,
  ) => {
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/metrics`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metrics),
        },
      );
      const data = (await response.json()) as {
        project?: Project;
        error?: string;
      };
      if (!response.ok || !data.project)
        throw new Error(data.error || "复盘数据保存失败。");
      setProjects((current) =>
        current.map((item) =>
          item.id === data.project!.id ? data.project! : item,
        ),
      );
      setNotice(`已记录「${data.project.title}」的发布表现。`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "复盘数据保存失败。");
      return false;
    }
  };
  const logout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("退出登录失败。");
      onLogout();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "退出登录失败。");
    }
  };
  const loadWorkBuddyStatus = async () => {
    try {
      const response = await fetch("/api/workbuddy/status");
      const data = (await response.json()) as WorkBuddyConnectionStatus & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || "无法读取 WorkBuddy 连接状态。");
      setWorkBuddyStatus(data);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "无法读取 WorkBuddy 连接状态。",
      );
    }
  };
  const createWorkBuddyToken = async () => {
    setIsWorkBuddyLoading(true);
    try {
      const response = await fetch("/api/workbuddy/token", { method: "POST" });
      const data = (await response.json()) as {
        token?: string;
        createdAt?: string;
        apiUrl?: string;
        error?: string;
      };
      if (!response.ok || !data.token || !data.createdAt || !data.apiUrl)
        throw new Error(data.error || "无法生成 WorkBuddy 令牌。");
      setWorkBuddyToken(data.token);
      setWorkBuddyStatus({
        connected: true,
        createdAt: data.createdAt,
        lastUsedAt: null,
        apiUrl: data.apiUrl,
      });
      setNotice("已生成新的 WorkBuddy 令牌，旧连接已失效。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法生成 WorkBuddy 令牌。");
    } finally {
      setIsWorkBuddyLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-row">
          <img className="brand-mark" src="/brand/cat-mark-v2.svg" alt="" />
          <span className="brand-name">Cato AI</span>
          <button className="icon-button quiet" aria-label="切换工作区">
            <ChevronDown size={16} />
          </button>
        </div>
        <button className="create-button" onClick={() => openComposer(null)}>
          <Plus size={16} />
          新建内容
        </button>
        <nav className="nav-list">
          <p className="nav-label">工作</p>
          {navItems.map(({ label, icon: Icon }) => (
            <button
              className={`nav-item ${section === label ? "is-active" : ""}`}
              key={label}
              onClick={() => {
                setSection(label);
                setNotice(`已切换到${label}。`);
              }}
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <nav className="nav-list nav-list-secondary" aria-label="资源导航">
          <p className="nav-label">资源</p>
          <button
            className={`nav-item ${section === "素材资产" ? "is-active" : ""}`}
            onClick={() => {
              setSection("素材资产");
              setNotice("已打开素材资产。");
            }}
          >
            <FolderOpen size={17} strokeWidth={1.8} />
            <span>素材资产</span>
          </button>
          <button
            className={`nav-item ${section === "归档" ? "is-active" : ""}`}
            onClick={() => {
              setSection("归档");
              setNotice("已打开归档。");
            }}
          >
            <Archive size={17} strokeWidth={1.8} />
            <span>归档</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <button
            className="help-link"
            onClick={() =>
              setNotice("快捷键：N 新建内容，⌘K 或 / 搜索，Enter 执行检索。")
            }
          >
            <CircleHelp size={16} />
            帮助与快捷键
          </button>
          <button
            className="help-link"
            onClick={() => {
              setWorkBuddyOpen(true);
              void loadWorkBuddyStatus();
            }}
          >
            <Link2 size={16} />
            连接 WorkBuddy
          </button>
          <div className="person-row">
            <div className="avatar">{workspaceName.slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{workspaceName}</strong>
            </div>
            <button
              className="icon-button quiet logout-button"
              type="button"
              onClick={() => void logout()}
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <strong>{section}</strong>
          </div>
          <div className="topbar-actions">
            <label className="search-field">
              <Search size={16} />
              <input
                ref={workspaceSearchRef}
                value={workspaceSearch}
                onChange={(event) => setWorkspaceSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    runWorkspaceSearch();
                  }
                }}
                aria-label="搜索内容"
                placeholder="搜索内容情报"
              />
              <kbd>
                <Command size={11} />K
              </kbd>
            </label>
            <button
              className="icon-button"
              aria-label="查看通知"
              onClick={() => setNotice("暂无新通知。")}
            >
              <span className="notification-dot" />
              <Inbox size={18} strokeWidth={1.8} />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          {dataState === "error" ? (
            <section className="empty-state">
              <div className="empty-icon">
                <CircleHelp size={20} />
              </div>
              <p className="eyebrow">本地数据</p>
              <h1>无法连接 SQLite</h1>
              <p>{dataError}</p>
              <button
                className="primary-button"
                onClick={() => void loadWorkspace()}
              >
                重新连接
              </button>
            </section>
          ) : (
            <>
              {section === "概览" && (
                <TodayView
                  projects={projects}
                  onCreate={() => openComposer(null)}
                  onOpenProject={openProject}
                  onOpenCalendar={() => setSection("发布日历")}
                  onOpenProjects={() => setSection("创作项目")}
                />
              )}
              {section === "内容情报" && (
                <IntelligenceView
                  items={sources}
                  isLoading={dataState === "loading"}
                  connector={mediaCrawler}
                  crawlRuns={crawlRuns}
                  onPrepareCrawler={prepareMediaCrawler}
                  onStartCrawler={startMediaCrawler}
                  onSaveTopic={saveTopic}
                  onSaveEvidence={saveEvidence}
                  onDeleteEvidence={deleteEvidence}
                  onArchiveEvidence={(id) => archiveEvidence(id, true)}
                  seedItemId={intelligenceSeedId}
                  onSeedHandled={() => setIntelligenceSeedId(null)}
                  searchRequest={intelligenceSearchRequest}
                />
              )}
              {section === "灵感收件箱" && (
                <InboxView
                  notes={inboxNotes}
                  onSave={saveInboxNote}
                  onDelete={deleteInboxNote}
                  onCreateTopic={createTopicFromInbox}
                />
              )}
              {section === "资料库" && (
                <LibraryView
                  documents={libraryDocuments}
                  onCreate={createLibraryDocument}
                  onImport={importLibraryDocument}
                  onUpdate={updateLibraryDocument}
                  onLoadHistory={getLibraryHistory}
                />
              )}
              {section === "评论洞察" && (
                <CommentInsightsView
                  comments={comments}
                  onOpenEvidence={(title) => {
                    setIntelligenceSearchRequest({ query: title, id: Date.now() });
                    setSection("内容情报");
                    setNotice("已定位到评论所属的内容情报。");
                  }}
                  onCollect={() => {
                    setSection("内容情报");
                    setNotice("在采集面板开启「同时采集评论」即可导入真实评论。");
                  }}
                />
              )}
              {section === "创作项目" && (
                <ProjectsView
                  topics={topics}
                  projects={projects}
                  onCreate={openComposer}
                  onConfirmTopic={confirmTopic}
                  onOpen={openProject}
                />
              )}
              {section === "发布日历" && (
                <CalendarView
                  projects={projects}
                  onSchedule={scheduleProject}
                  onMarkPublished={markProjectPublished}
                  onRecordMetrics={recordProjectMetrics}
                />
              )}
              {section === "素材资产" && (
                <AssetsView
                  items={sources}
                  isLoading={dataState === "loading"}
                  onArchiveEvidence={(id) => archiveEvidence(id, true)}
                  onOpenIntelligence={() => setSection("内容情报")}
                  onCreateTopicFromAsset={(itemId) => {
                    setIntelligenceSeedId(itemId);
                    setSection("内容情报");
                    setNotice("素材已带入内容情报，可继续建立选题。");
                  }}
                />
              )}
              {section === "归档" && (
                <ArchiveView
                  items={archivedSources}
                  isLoading={dataState === "loading"}
                  onRestore={(id) => archiveEvidence(id, false)}
                />
              )}
            </>
          )}
        </main>
      </div>
      {composerTopic !== undefined && (
        <ComposerPanel
          key={composerTopic?.id ?? "new"}
          topic={composerTopic}
          onClose={() => setComposerTopic(undefined)}
          onSave={saveProject}
        />
      )}
      {editorProject && (
        <ProjectEditor
          key={editorProject.id}
          project={editorProject}
          topics={topics}
          sources={[...sources, ...archivedSources]}
          onClose={() => setEditorProject(undefined)}
          onSave={updateProject}
          onCreateVariant={createProjectVariant}
        />
      )}
      {workBuddyOpen && (
        <WorkBuddyConnectionPanel
          status={workBuddyStatus}
          token={workBuddyToken}
          isLoading={isWorkBuddyLoading}
          onClose={() => {
            setWorkBuddyOpen(false);
            setWorkBuddyToken("");
          }}
          onGenerate={() => void createWorkBuddyToken()}
          onCopy={async () => {
            if (!workBuddyToken) return;
            try {
              await navigator.clipboard.writeText(workBuddyToken);
              setNotice("令牌已复制。请粘贴到 WorkBuddy，不要发送到聊天中。");
            } catch {
              setNotice("无法访问剪贴板，请手动复制令牌。");
            }
          }}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}

function WorkBuddyConnectionPanel({
  status,
  token,
  isLoading,
  onClose,
  onGenerate,
  onCopy,
}: {
  status: WorkBuddyConnectionStatus | null;
  token: string;
  isLoading: boolean;
  onClose: () => void;
  onGenerate: () => void;
  onCopy: () => Promise<void>;
}) {
  return (
    <aside className="workbuddy-panel" aria-label="连接 WorkBuddy">
      <header className="panel-header">
        <div>
          <p className="eyebrow">本机连接</p>
          <h2>连接 WorkBuddy</h2>
        </div>
        <button className="icon-button quiet" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </header>
      <div className="workbuddy-body">
        <div className="workbuddy-status">
          <span className={status?.connected ? "status-dot is-ready" : "status-dot"} />
          <span>{status?.connected ? "已生成连接令牌" : "尚未生成连接令牌"}</span>
        </div>
        <ol className="workbuddy-steps">
          <li>
            <span>1</span>
            <div>
              <strong>导入连接器</strong>
              <p>在 WorkBuddy 的连接器页导入 Cato Connector 包。</p>
              <a href="/cato-workbuddy-connector.zip" download>
                下载 Connector 包 <ArrowUpRight size={14} />
              </a>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>生成令牌</strong>
              <p>重新生成会立即断开旧的 WorkBuddy 连接。</p>
              <button
                className={token ? "text-button" : "primary-button"}
                type="button"
                disabled={isLoading}
                onClick={onGenerate}
              >
                {isLoading ? "生成中" : token ? "生成新的令牌" : "生成连接令牌"}
              </button>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>粘贴到 WorkBuddy</strong>
              <p>连接器表单中的本地地址保持默认即可。</p>
              {token ? (
                <div className="workbuddy-token">
                  <input value={token} readOnly aria-label="Cato WorkBuddy 连接令牌" />
                  <button className="text-button" type="button" onClick={() => void onCopy()}>
                    复制
                  </button>
                </div>
              ) : (
                <span className="workbuddy-url">{status?.apiUrl || "http://127.0.0.1:5173"}</span>
              )}
            </div>
          </li>
        </ol>
        <p className="workbuddy-note">
          WorkBuddy 通过受限 API 访问 Cato；它不会直接读取 SQLite。写入灵感和创建项目都要求在对话中再次确认。
        </p>
      </div>
    </aside>
  );
}

function TodayView({
  projects,
  onCreate,
  onOpenProject,
  onOpenCalendar,
  onOpenProjects,
}: {
  projects: Project[];
  onCreate: () => void;
  onOpenProject: (project: Project) => void;
  onOpenCalendar: () => void;
  onOpenProjects: () => void;
}) {
  const nextTasks = [
    ...projects
      .filter((project) => project.reviewStatus === "待审核")
      .map((project) => ({
        project,
        tone: "review",
        label: "待审核",
        detail: `${project.platform} · 已完成编辑，等待人工确认`,
        action: "审核",
        route: "project" as const,
      })),
    ...projects
      .filter(
        (project) => project.reviewStatus === "已批准" && !project.scheduledAt,
      )
      .map((project) => ({
        project,
        tone: "schedule",
        label: "待排期",
        detail: `${project.platform} · 已通过审核，尚未安排发布时间`,
        action: "排期",
        route: "calendar" as const,
      })),
    ...projects
      .filter(
        (project) =>
          project.scheduledAt &&
          !project.publishedAt &&
          new Date(project.scheduledAt) <= new Date(),
      )
      .map((project) => ({
        project,
        tone: "review",
        label: "待确认发布",
        detail: `${project.platform} · 已到发布时间，确认发布后完成闭环`,
        action: "确认发布",
        route: "calendar" as const,
      })),
    ...projects
      .filter((project) => project.reviewStatus === "草稿")
      .map((project) => ({
        project,
        tone: "schedule",
        label: "草稿",
        detail: project.reviewNote
          ? `审核意见：${project.reviewNote}`
          : `${project.platform} · 继续补充正文后再提交审核`,
        action: "继续写作",
        route: "project" as const,
      })),
  ];
  const scheduled = projects
    .filter((project) => project.scheduledAt)
    .sort((left, right) =>
      (left.scheduledAt || "").localeCompare(right.scheduledAt || ""),
    );
  const weekStart = startOfWeek(new Date());
  const week = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index),
  );
  const scheduledDates = new Set(
    scheduled.map((project) => dateKey(new Date(project.scheduledAt!))),
  );
  const today = dateKey(new Date());
  const recent = [...projects]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);
  const todayLabel = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">{todayLabel}</p>
          <h1>今日概览</h1>
          <p className="page-summary">
            {nextTasks.length
              ? `${nextTasks.length} 项需要你推进`
              : "当前没有待推进事项"}
          </p>
        </div>
        <button className="primary-button" onClick={onCreate}>
          <Plus size={16} />
          新建内容
        </button>
      </section>
      <section className="work-section" aria-labelledby="next-title">
        <div className="section-heading">
          <h2 id="next-title">下一步</h2>
          <button className="text-button" onClick={onOpenProjects}>
            全部稿件
            <ArrowUpRight size={15} />
          </button>
        </div>
        {nextTasks.length ? (
          <div className="task-list">
            {nextTasks.map((task) => (
              <article className="task-row" key={task.project.id}>
                <span
                  className={`status-dot ${task.tone}`}
                  aria-hidden="true"
                />
                <div className="task-body">
                  <div className="task-title-line">
                    <h3>{task.project.title}</h3>
                    <span className={`status-tag ${task.tone}`}>
                      {task.label}
                    </span>
                  </div>
                  <p>{task.detail}</p>
                </div>
                <button
                  className="row-action"
                  onClick={() =>
                    task.route === "calendar"
                      ? onOpenCalendar()
                      : onOpenProject(task.project)
                  }
                >
                  {task.action}
                  <ChevronRight size={15} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="task-empty">
            所有内容已处理。下一步可以从情报或新稿件开始。
          </div>
        )}
      </section>
      <div className="dashboard-grid">
        <section
          className="work-section schedule-section"
          aria-labelledby="schedule-title"
        >
          <div className="section-heading">
            <div>
              <h2 id="schedule-title">本周节奏</h2>
              <p>
                {scheduled.length
                  ? `已安排 ${scheduled.length} 项内容`
                  : "尚未安排发布内容"}
              </p>
            </div>
            <button
              className="icon-button quiet"
              aria-label="打开发布日历"
              onClick={onOpenCalendar}
            >
              <CalendarDays size={17} />
            </button>
          </div>
          <div className="week-grid" aria-label="本周发布计划">
            {week.map((day, index) => {
              const key = dateKey(day);
              return (
                <div
                  className={`day ${key === today ? "is-today" : ""}`}
                  key={key}
                >
                  <span>
                    {["一", "二", "三", "四", "五", "六", "日"][index]}
                  </span>
                  <strong>{day.getDate()}</strong>
                  {scheduledDates.has(key) && (
                    <i className="calendar-mark purple" />
                  )}
                </div>
              );
            })}
          </div>
          {scheduled.slice(0, 2).map((project) => (
            <div className="schedule-item" key={project.id}>
              <span className="schedule-time">
                {formatEventTime(project.scheduledAt!)}
              </span>
              <div>
                <strong>{project.title}</strong>
                <p>{project.platform} · 已排期</p>
              </div>
              <ChevronRight size={16} className="muted-icon" />
            </div>
          ))}
          {!scheduled.length && (
            <div className="schedule-empty">
              通过审核后，可在发布日历中安排具体时间。
            </div>
          )}
        </section>
        <section
          className="work-section activity-section"
          aria-labelledby="activity-title"
        >
          <div className="section-heading">
            <div>
              <h2 id="activity-title">最近更新</h2>
              <p>来自本地内容资产</p>
            </div>
            <button className="text-button" onClick={onOpenProjects}>
              查看全部
            </button>
          </div>
          {recent.length ? (
            <ol className="activity-list">
              {recent.map((project) => (
                <li key={project.id}>
                  <time>
                    {new Intl.DateTimeFormat("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(project.updatedAt))}
                  </time>
                  <div>
                    <strong>
                      {project.reviewStatus === "已批准"
                        ? "通过审核"
                        : project.reviewStatus === "待审核"
                          ? "提交审核"
                          : "保存草稿"}
                    </strong>
                    <p>{project.title}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="schedule-empty">
              创建稿件后，内容变化会显示在这里。
            </div>
          )}
        </section>
      </div>
    </>
  );
}

const splitInboxTags = (value: string) =>
  [
    ...new Set(
      value
        .split(/[，,\n]/u)
        .map((tag) => tag.trim().replace(/^#/u, ""))
        .filter(Boolean),
    ),
  ].slice(0, 8);

function InboxView({
  notes,
  onSave,
  onDelete,
  onCreateTopic,
}: {
  notes: InboxNote[];
  onSave: (body: string, tags: string[]) => Promise<boolean>;
  onDelete: (noteId: string) => Promise<boolean>;
  onCreateTopic: (noteId: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState("全部灵感");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) =>
      note.tags.forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)),
    );
    return [...counts.entries()].sort(([, left], [, right]) => right - left);
  }, [notes]);
  const visibleNotes = useMemo(
    () =>
      notes.filter((note) => {
        const matchesTag =
          activeTag === "全部灵感" || note.tags.includes(activeTag);
        const matchesQuery =
          !deferredQuery ||
          `${note.body}\n${note.tags.join(" ")}`
            .toLocaleLowerCase()
            .includes(deferredQuery);
        return matchesTag && matchesQuery;
      }),
    [activeTag, deferredQuery, notes],
  );
  const activity = useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) => {
      const date = new Date(note.createdAt);
      if (!Number.isNaN(date.valueOf())) {
        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
    return Array.from({ length: 70 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (69 - index));
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      return { key, count: counts.get(key) || 0 };
    });
  }, [notes]);
  useEffect(() => {
    if (selectedId && !notes.some((note) => note.id === selectedId))
      setSelectedId(null);
  }, [notes, selectedId]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody) return;
    setIsSaving(true);
    const saved = await onSave(trimmedBody, splitInboxTags(tagInput));
    setIsSaving(false);
    if (saved) {
      setBody("");
      setTagInput("");
    }
  };
  const remove = async (noteId: string) => {
    if (deleteConfirmId !== noteId) {
      setDeleteConfirmId(noteId);
      return;
    }
    setProcessingId(noteId);
    const deleted = await onDelete(noteId);
    setProcessingId(null);
    if (deleted) {
      setDeleteConfirmId(null);
      setSelectedId(null);
    }
  };
  const createTopic = async (noteId: string) => {
    setProcessingId(noteId);
    await onCreateTopic(noteId);
    setProcessingId(null);
  };
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));
  return (
    <section className="inbox-view">
      <div className="inbox-heading">
        <div>
          <h1>灵感收件箱</h1>
          <p>记下还不该丢失的念头，再决定是否把它写成内容。</p>
        </div>
        <label className="wide-search inbox-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索灵感"
            placeholder="搜索灵感"
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQuery("")}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </label>
      </div>
      <div className="inbox-layout">
        <aside className="inbox-rail" aria-label="灵感筛选">
          <div className="inbox-counts">
            <div>
              <strong>{notes.length}</strong>
              <span>灵感</span>
            </div>
            <div>
              <strong>{tagCounts.length}</strong>
              <span>标签</span>
            </div>
          </div>
          <div className="inbox-activity" aria-label="近 70 天灵感记录">
            {activity.map((day) => (
              <span
                className={`activity-dot ${day.count ? "is-active" : ""}`}
                data-level={Math.min(day.count, 3)}
                key={day.key}
                title={day.count ? `${day.count} 条灵感` : "无记录"}
              />
            ))}
          </div>
          <div className="inbox-filter-list">
            <button
              className={activeTag === "全部灵感" ? "is-active" : ""}
              onClick={() => setActiveTag("全部灵感")}
            >
              <Lightbulb size={15} />
              <span>全部灵感</span>
              <em>{notes.length}</em>
            </button>
            {tagCounts.map(([tag, count]) => (
              <button
                className={activeTag === tag ? "is-active" : ""}
                key={tag}
                onClick={() => setActiveTag(tag)}
              >
                <Tag size={14} />
                <span>{tag}</span>
                <em>{count}</em>
              </button>
            ))}
          </div>
        </aside>
        <div className="inbox-canvas">
          <form className="inbox-composer" onSubmit={save}>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="现在想到什么？"
              aria-label="记录灵感"
              maxLength={10_000}
            />
            <div className="inbox-composer-footer">
              <label className="inbox-tag-input">
                <Tag size={15} />
                <input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="标签，用逗号分隔"
                  maxLength={200}
                  aria-label="灵感标签"
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={!body.trim() || isSaving}
              >
                <Plus size={16} />
                {isSaving ? "保存中" : "保存灵感"}
              </button>
            </div>
          </form>
          <section className="inbox-note-list" aria-label="灵感列表">
            {visibleNotes.length ? (
              visibleNotes.map((note) => {
                const isSelected = selectedId === note.id;
                return (
                  <article
                    className={`inbox-note ${isSelected ? "is-selected" : ""}`}
                    key={note.id}
                    onClick={() => setSelectedId(note.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(note.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="inbox-note-meta">
                      <time>{formatDate(note.createdAt)}</time>
                      {note.tags.map((tag) => (
                        <span key={tag}>#{tag}</span>
                      ))}
                    </div>
                    <p>{note.body}</p>
                    {isSelected && (
                      <div className="inbox-note-actions">
                        {note.topicId ? (
                          <span className="inbox-converted">已创建选题</span>
                        ) : (
                          <button
                            className="text-button inbox-topic-action"
                            type="button"
                            disabled={processingId === note.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              void createTopic(note.id);
                            }}
                          >
                            <FilePenLine size={15} />
                            {processingId === note.id ? "创建中" : "创建选题"}
                          </button>
                        )}
                        {deleteConfirmId === note.id ? (
                          <>
                            <button
                              className="text-button delete-action"
                              type="button"
                              disabled={processingId === note.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void remove(note.id);
                              }}
                            >
                              确认删除
                            </button>
                            <button
                              className="text-button"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteConfirmId(null);
                              }}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            className="icon-button quiet inbox-delete-action"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void remove(note.id);
                            }}
                            aria-label="删除灵感"
                            title="删除"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="list-empty inbox-empty">
                <Lightbulb size={20} />
                <strong>{notes.length ? "没有匹配的灵感" : "先记下一条灵感"}</strong>
                <p>
                  {notes.length
                    ? "试试其他标签或更短的关键词。"
                    : "它会留在本地，之后可以直接转成选题。"}
                </p>
                {notes.length && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setQuery("");
                      setActiveTag("全部灵感");
                    }}
                  >
                    清除筛选
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function CommentInsightsView({
  comments,
  onOpenEvidence,
  onCollect,
}: {
  comments: IntelligenceComment[];
  onOpenEvidence: (title: string) => void;
  onCollect: () => void;
}) {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<"全部" | Platform>("全部");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleComments = useMemo(
    () =>
      comments.filter((comment) => {
        const text = `${comment.body}\n${comment.author}\n${comment.evidenceTitle}`.toLocaleLowerCase();
        return (
          (platform === "全部" || comment.platform === platform) &&
          (!deferredQuery || text.includes(deferredQuery))
        );
      }),
    [comments, deferredQuery, platform],
  );
  const platforms = [
    "全部",
    ...Array.from(new Set(comments.map((comment) => comment.platform))),
  ] as Array<"全部" | Platform>;
  return (
    <section className="comment-insights-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">评论洞察</p>
          <h1>回到真实评论里</h1>
          <p className="page-summary">
            只展示采集后已入库的评论，保留它来自哪一条内容。
          </p>
        </div>
        <button className="primary-button" onClick={onCollect}>
          <Inbox size={16} />
          采集评论
        </button>
      </div>
      <div className="comment-toolbar">
        <label className="wide-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索评论"
            placeholder="搜索评论、作者或来源内容"
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQuery("")}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </label>
        {platforms.length > 1 && (
          <div className="filter-tabs" role="tablist" aria-label="评论平台筛选">
            {platforms.map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={platform === item}
                className={platform === item ? "is-active" : ""}
                onClick={() => setPlatform(item)}
              >
                {item !== "全部" && (
                  <img
                    className="platform-filter-logo"
                    src={platformLogoSrc[item]}
                    alt=""
                    aria-hidden="true"
                  />
                )}
                <span className="platform-filter-label">{item}</span>
                <span>
                  {item === "全部"
                    ? comments.length
                    : comments.filter((comment) => comment.platform === item)
                        .length}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <section className="comment-list" aria-label="已采集评论">
        {visibleComments.length ? (
          visibleComments.map((comment) => (
            <article className="comment-row" key={comment.id}>
              <div className="comment-source">
                <span className="platform-tag">
                  <img src={platformLogoSrc[comment.platform]} alt={comment.platform} />
                </span>
                <button
                  className="comment-source-title"
                  onClick={() => onOpenEvidence(comment.evidenceTitle)}
                  title={`查看「${comment.evidenceTitle}」`}
                >
                  {comment.evidenceTitle}
                </button>
              </div>
              <p className="comment-body">{comment.body}</p>
              <div className="comment-meta">
                <span>{comment.author || "匿名用户"}</span>
                {comment.likeCount > 0 && <span>赞 {comment.likeCount}</span>}
                {comment.replyCount > 0 && <span>回复 {comment.replyCount}</span>}
                <span>{comment.commentedAt || comment.collectedAt}</span>
              </div>
            </article>
          ))
        ) : (
          <div className="list-empty comment-empty">
            <MessageCircle size={20} />
            <strong>{comments.length ? "没有匹配的评论" : "还没有已采集的评论"}</strong>
            <p>
              {comments.length
                ? "试试更短的关键词，或清除平台筛选。"
                : "下一次采集时开启「同时采集评论」，完成后会在这里出现。"}
            </p>
            {comments.length ? (
              <button
                className="text-button"
                onClick={() => {
                  setQuery("");
                  setPlatform("全部");
                }}
              >
                清除筛选
              </button>
            ) : (
              <button className="text-button" onClick={onCollect}>
                去采集评论
              </button>
            )}
          </div>
        )}
      </section>
    </section>
  );
}

function IntelligenceView({
  items,
  isLoading,
  connector,
  crawlRuns,
  onPrepareCrawler,
  onStartCrawler,
  onSaveTopic,
  onSaveEvidence,
  onDeleteEvidence,
  onArchiveEvidence,
  seedItemId,
  onSeedHandled,
  searchRequest,
}: {
  items: IntelligenceItem[];
  isLoading: boolean;
  connector: MediaCrawlerConnector | null;
  crawlRuns: CrawlRun[];
  onPrepareCrawler: () => Promise<boolean>;
  onStartCrawler: (request: CrawlRequest) => Promise<boolean>;
  onSaveTopic: (topic: TopicDraft) => Promise<boolean>;
  onSaveEvidence: (evidence: EvidenceDraft) => Promise<boolean>;
  onDeleteEvidence: (evidenceId: string) => Promise<boolean>;
  onArchiveEvidence: (evidenceId: string) => Promise<boolean>;
  seedItemId: string | null;
  onSeedHandled: () => void;
  searchRequest: { query: string; id: number } | null;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<"全部" | Platform>("全部");
  const [draftOpen, setDraftOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [crawlerOpen, setCrawlerOpen] = useState(false);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<IntelligenceItem | null>(null);
  const [detailItem, setDetailItem] = useState<IntelligenceItem | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (platform === "全部" || item.platform === platform) &&
          `${item.title}${item.summary}${item.body}${item.author}`.includes(
            query.trim(),
          ),
      ),
    [items, platform, query],
  );
  const panelOpen =
    draftOpen ||
    captureOpen ||
    crawlerOpen ||
    previewItem !== null ||
    detailItem !== null;
  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const allVisibleSelected =
    visibleItems.length > 0 &&
    visibleItems.every((item) => selected.includes(item.id));
  const toggleVisibleSelection = () =>
    setSelected((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleItems.some((item) => item.id === id))
        : [...new Set([...current, ...visibleItems.map((item) => item.id)])],
    );
  const deleteItem = async (item: IntelligenceItem) => {
    if (deleteConfirmId !== item.id) {
      setDeleteConfirmId(item.id);
      return;
    }
    setDeletingId(item.id);
    const deleted = await onDeleteEvidence(item.id);
    setDeletingId(null);
    if (deleted) {
      setDeleteConfirmId(null);
      setSelected((current) => current.filter((id) => id !== item.id));
      if (previewItem?.id === item.id) setPreviewItem(null);
      if (detailItem?.id === item.id) setDetailItem(null);
    }
  };
  const archiveItem = async (item: IntelligenceItem) => {
    setArchivingId(item.id);
    const archived = await onArchiveEvidence(item.id);
    setArchivingId(null);
    if (archived) {
      setSelected((current) => current.filter((id) => id !== item.id));
      if (previewItem?.id === item.id) setPreviewItem(null);
      if (detailItem?.id === item.id) setDetailItem(null);
    }
  };
  const openDraft = () => {
    const first = items.find((item) => selected.includes(item.id));
    setTopicTitle(first ? first.title : "");
    setAngle(
      first ? `围绕「${first.summary.slice(0, 20)}…」建立自己的判断角度。` : "",
    );
    setDetailItem(null);
    setPreviewItem(null);
    setCrawlerOpen(false);
    setCaptureOpen(false);
    setDraftOpen(true);
  };
  const openDetail = (item: IntelligenceItem) => {
    setDraftOpen(false);
    setCaptureOpen(false);
    setCrawlerOpen(false);
    setPreviewItem(null);
    setDetailItem(item);
  };
  const openPreview = (item: IntelligenceItem) => {
    setDetailItem(null);
    setDraftOpen(false);
    setCaptureOpen(false);
    setCrawlerOpen(false);
    setPreviewItem(item);
  };
  useEffect(() => {
    const closePanel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (detailItem) setDetailItem(null);
      else if (previewItem) setPreviewItem(null);
      else if (draftOpen) setDraftOpen(false);
      else if (captureOpen) setCaptureOpen(false);
      else if (crawlerOpen) setCrawlerOpen(false);
    };
    window.addEventListener("keydown", closePanel);
    return () => window.removeEventListener("keydown", closePanel);
  }, [captureOpen, crawlerOpen, detailItem, draftOpen, previewItem]);
  useEffect(() => {
    if (!seedItemId || !items.some((item) => item.id === seedItemId)) return;
    setSelected((current) =>
      current.includes(seedItemId) ? current : [...current, seedItemId],
    );
    onSeedHandled();
  }, [items, onSeedHandled, seedItemId]);
  useEffect(() => {
    if (!searchRequest) return;
    setPlatform("全部");
    setQuery(searchRequest.query);
  }, [searchRequest]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!topicTitle.trim() || selected.length === 0) return;
    setIsSaving(true);
    const saved = await onSaveTopic({
      title: topicTitle.trim(),
      angle: angle.trim(),
      evidenceIds: selected,
    });
    setIsSaving(false);
    if (saved) {
      setDraftOpen(false);
      setSelected([]);
    }
  };
  return (
    <section className="intelligence-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">内容情报</p>
          <h1>从信号到选题</h1>
          <p className="page-summary">选择有依据的内容，再决定值得写什么。</p>
        </div>
        <div className="page-actions">
          <button
            className="text-button"
            onClick={() => {
              setDetailItem(null);
              setPreviewItem(null);
              setDraftOpen(false);
              setCrawlerOpen(false);
              setCaptureOpen(true);
            }}
          >
            <FilePenLine size={16} />
            录入情报
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setDetailItem(null);
              setPreviewItem(null);
              setDraftOpen(false);
              setCaptureOpen(false);
              setCrawlerOpen(true);
            }}
          >
            <Inbox size={16} />
            采集内容
          </button>
        </div>
      </div>
      <div className="intelligence-toolbar">
        <label className="wide-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索情报"
            placeholder="搜索标题、作者或完整正文"
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQuery("")}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="filter-tabs" role="tablist" aria-label="平台筛选">
          {(["全部", "小红书", "公众号", "抖音"] as const).map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={platform === item}
              className={platform === item ? "is-active" : ""}
              onClick={() => setPlatform(item)}
            >
              {item !== "全部" && (
                <img
                  className="platform-filter-logo"
                  src={platformLogoSrc[item]}
                  alt=""
                  aria-hidden="true"
                />
              )}
              <span className="platform-filter-label">{item}</span>
              <span>
                {item === "全部"
                  ? items.length
                  : items.filter((source) => source.platform === item).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="selection-bar" aria-live="polite">
        <span>
          {isLoading
            ? "正在读取本地数据"
            : selected.length
              ? `已选择 ${selected.length} 条内容`
              : "选择内容以生成选题"}
        </span>
        {visibleItems.length > 0 && !isLoading && (
          <button className="text-button" onClick={toggleVisibleSelection}>
            {allVisibleSelected ? "取消全选" : "全选当前"}
          </button>
        )}
        {selected.length > 0 && (
          <>
            <button className="text-button" onClick={() => setSelected([])}>
              清除
            </button>
            <button
              className="text-button selection-action"
              onClick={openDraft}
            >
              生成选题
              <ArrowUpRight size={15} />
            </button>
          </>
        )}
      </div>
      <div className={`intelligence-layout ${panelOpen ? "has-panel" : ""}`}>
        <section className="source-list" aria-label="内容情报列表">
          {isLoading ? (
            <div className="list-empty">
              <strong>正在加载内容情报</strong>
            </div>
          ) : visibleItems.length ? (
            visibleItems.map((item) => {
              const isExpanded = expandedSourceId === item.id;
              const isActive =
                detailItem?.id === item.id || previewItem?.id === item.id;
              return (
                <article
                  className={`source-row ${selected.includes(item.id) ? "is-selected" : ""} ${isActive ? "is-active" : ""} ${isExpanded ? "is-expanded" : ""}`}
                  key={item.id}
                >
                  <label className="source-check">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      aria-label={`选择${item.title}`}
                    />
                    <span aria-hidden="true" />
                  </label>
                  {item.coverUrl && (
                    <button
                      type="button"
                      className="source-cover"
                      onClick={() => openPreview(item)}
                      aria-label={`预览${item.title}的图片`}
                    >
                      <img
                        src={item.coverUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      {item.imageUrls.length > 1 && (
                        <span>{item.imageUrls.length}</span>
                      )}
                    </button>
                  )}
                  <div className="source-content">
                    <div className="source-title-line">
                      <h2>{item.title}</h2>
                      <span className="platform-tag">
                        <img
                          src={platformLogoSrc[item.platform]}
                          alt={item.platform}
                        />
                      </span>
                    </div>
                    <p>{item.summary}</p>
                    <div className="source-meta">
                      <span>{item.author}</span>
                      <span>{item.signal}</span>
                      <span>{item.collectedAt}</span>
                    </div>
                    <div className="source-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => openDetail(item)}
                      >
                        查看全文
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedSourceId((current) =>
                            current === item.id ? null : item.id,
                          )
                        }
                      >
                        {isExpanded ? "收起摘要" : "展开摘要"}
                      </button>
                      {item.sourceUrl && (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看来源
                          <ArrowUpRight size={13} />
                        </a>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => void archiveItem(item)}
                        disabled={archivingId === item.id}
                      >
                        {archivingId === item.id ? "归档中" : "归档"}
                      </button>
                      {deleteConfirmId === item.id ? (
                        <>
                          <button
                            type="button"
                            className="text-button delete-action"
                            onClick={() => void deleteItem(item)}
                            disabled={deletingId === item.id}
                          >
                            {deletingId === item.id ? "删除中" : "确认删除"}
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setDeleteConfirmId(null)}
                            disabled={deletingId === item.id}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="text-button delete-action"
                          onClick={() => void deleteItem(item)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="list-empty">
              <Search size={20} />
              <strong>没有找到匹配内容</strong>
              <p>试试更短的关键词，或清除筛选条件。</p>
              <button
                className="text-button"
                onClick={() => {
                  setQuery("");
                  setPlatform("全部");
                }}
              >
                清除筛选
              </button>
            </div>
          )}
        </section>
        {draftOpen && (
          <aside className="topic-draft" aria-label="生成选题">
            <div className="draft-header">
              <div>
                <p className="eyebrow">选题草案</p>
                <h2>确定一个值得写的角度</h2>
              </div>
              <button
                className="icon-button quiet"
                onClick={() => setDraftOpen(false)}
                aria-label="关闭选题草案"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={save} className="topic-form">
              <p className="evidence-count">
                <Link2 size={15} />
                引用 {selected.length} 条内容
              </p>
              <label>
                选题标题
                <input
                  value={topicTitle}
                  onChange={(event) => setTopicTitle(event.target.value)}
                  placeholder="写下一个明确的问题或观点"
                  required
                />
              </label>
              <label>
                内容角度
                <textarea
                  value={angle}
                  onChange={(event) => setAngle(event.target.value)}
                  placeholder="说明你想从什么角度回答它"
                  required
                />
              </label>
              <div className="panel-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setDraftOpen(false)}
                  disabled={isSaving}
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? "保存中" : "保存选题"}
                </button>
              </div>
            </form>
          </aside>
        )}
        {captureOpen && (
          <EvidenceCapture
            onClose={() => setCaptureOpen(false)}
            onSave={onSaveEvidence}
          />
        )}
        {crawlerOpen && (
          <MediaCrawlerPanel
            connector={connector}
            runs={crawlRuns}
            onClose={() => setCrawlerOpen(false)}
            onPrepare={onPrepareCrawler}
            onStart={onStartCrawler}
          />
        )}
        {previewItem && (
          <MediaPreviewPanel
            key={previewItem.id}
            item={previewItem}
            onClose={() => setPreviewItem(null)}
            onRead={() => openDetail(previewItem)}
          />
        )}
        {detailItem && (
          <ContentDetailPanel
            item={detailItem}
            onClose={() => setDetailItem(null)}
            onPreview={() => openPreview(detailItem)}
          />
        )}
      </div>
    </section>
  );
}

function LibraryView({
  documents,
  onCreate,
  onImport,
  onUpdate,
  onLoadHistory,
}: {
  documents: LibraryDocument[];
  onCreate: (
    draft: Pick<LibraryDocument, "title" | "body" | "category" | "tags">,
  ) => Promise<LibraryDocument | null>;
  onImport: (file: File) => Promise<LibraryDocument | null>;
  onUpdate: (
    draft: Pick<LibraryDocument, "id" | "title" | "body" | "category" | "tags" | "version">,
  ) => Promise<LibraryDocument | null>;
  onLoadHistory: (documentId: string) => Promise<LibraryVersion[]>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("最近");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [documentCategory, setDocumentCategory] = useState("运营规范");
  const [tagsInput, setTagsInput] = useState("");
  const [versions, setVersions] = useState<LibraryVersion[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const selected = documents.find((document) => document.id === selectedId) || null;
  const categories = useMemo(
    () => [...new Set(documents.map((item) => item.category).filter(Boolean))],
    [documents],
  );
  const visibleDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return documents.filter((document) => {
      const matchesCategory =
        category === "最近" ||
        category === "全部资料" ||
        document.category === category;
      const matchesQuery =
        !normalized ||
        `${document.title}\n${document.body}\n${document.category}\n${document.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(normalized);
      return matchesCategory && matchesQuery;
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [category, documents, query]);
  const setEditorFromDocument = (document: LibraryDocument) => {
    setSelectedId(document.id);
    setIsNew(false);
    setTitle(document.title);
    setBody(document.body);
    setDocumentCategory(document.category);
    setTagsInput(document.tags.join("，"));
    setEditorOpen(true);
  };
  const createNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setTitle("");
    setBody("");
    setDocumentCategory("运营规范");
    setTagsInput("");
    setVersions([]);
    setEditorOpen(true);
  };
  useEffect(() => {
    if (!selected || !editorOpen) {
      setVersions([]);
      return;
    }
    void onLoadHistory(selected.id).then(setVersions);
  }, [editorOpen, onLoadHistory, selected?.id]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tags = tagsInput
      .split(/[，,\n]/u)
      .map((tag) => tag.trim().replace(/^#/u, ""))
      .filter(Boolean);
    setIsSaving(true);
    const saved = isNew
      ? await onCreate({
          title: title.trim(),
          body: body.trim(),
          category: documentCategory.trim(),
          tags,
        })
      : selected
        ? await onUpdate({
            id: selected.id,
            title: title.trim(),
            body: body.trim(),
            category: documentCategory.trim(),
            tags,
            version: selected.version,
          })
        : null;
    setIsSaving(false);
    if (saved) setEditorFromDocument(saved);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setIsNew(false);
    setSelectedId(null);
    setVersions([]);
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsImporting(true);
    const imported = await onImport(file);
    setIsImporting(false);
    if (imported) setEditorFromDocument(imported);
  };
  const formatUpdatedAt = (updatedAt: string) => {
    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return "刚刚更新";
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    return isToday
      ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  };
  return (
    <section className="library-browser">
      <aside className="library-browser-sidebar" aria-label="资料导航">
        <div className="library-sidebar-title">
          <h1>资料库</h1>
          <button className="icon-button quiet" type="button" onClick={createNew} aria-label="新建资料">
            <Plus size={17} />
          </button>
        </div>
        <label className="library-browser-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索资料"
              aria-label="搜索资料"
            />
        </label>
        <nav className="library-browser-nav" aria-label="资料分类">
          {["最近", "全部资料", ...categories].map((item) => (
              <button
                type="button"
                key={item}
                className={category === item ? "is-active" : ""}
                onClick={() => setCategory(item)}
                aria-current={category === item ? "page" : undefined}
              >
                {item}
                <span>
                  {item === "最近" || item === "全部资料"
                    ? documents.length
                    : documents.filter((document) => document.category === item).length}
                </span>
              </button>
          ))}
        </nav>
        <div className="library-sidebar-documents">
          <div className="library-sidebar-group-label">我的资料</div>
          {visibleDocuments.slice(0, 8).map((document) => (
                <button
                  type="button"
                  key={document.id}
                  className={`library-sidebar-document ${selectedId === document.id && editorOpen ? "is-selected" : ""}`}
                  onClick={() => setEditorFromDocument(document)}
                >
                  <BookOpen size={15} />
                  <span>{document.title}</span>
                </button>
          ))}
        </div>
      </aside>

      <section className="library-list-pane" aria-label="资料列表">
        <header className="library-list-heading">
          <div>
            <h2>{category === "全部资料" ? "全部资料" : category}</h2>
          </div>
          <div className="library-heading-actions">
            <input
              ref={importInputRef}
              className="library-import-input"
              type="file"
              accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.xml,.doc,.docx,.odt,.rtf,.pdf"
              onChange={importFile}
              tabIndex={-1}
            />
            <button
              className="library-import-button"
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={isImporting}
            >
              <FolderOpen size={16} />
              {isImporting ? "导入中" : "上传资料"}
            </button>
            <button className="primary-button" type="button" onClick={createNew}>
              <Plus size={16} />
              新建资料
            </button>
          </div>
        </header>
        <div className="library-list-tabs" role="tablist" aria-label="资料范围">
          {["最近", "全部资料"].map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={category === item}
              className={category === item ? "is-active" : ""}
              onClick={() => setCategory(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="library-table" role="table" aria-label={`${category}资料`}>
          <div className="library-table-head" role="row">
            <span role="columnheader">名称</span>
            <span role="columnheader">更新人</span>
            <span role="columnheader">位置</span>
            <span role="columnheader">最近更新</span>
          </div>
          {visibleDocuments.length ? (
            visibleDocuments.map((document) => (
              <button
                type="button"
                role="row"
                className={`library-table-row ${selectedId === document.id && editorOpen ? "is-selected" : ""}`}
                key={document.id}
                onClick={() => setEditorFromDocument(document)}
              >
                <span className="library-table-name" role="cell">
                  <BookOpen size={17} />
                  <strong>{document.title}</strong>
                </span>
                <span role="cell">{document.updatedBy || "Evan"}</span>
                <span role="cell">{document.category || "未分类"}</span>
                <time role="cell" dateTime={document.updatedAt}>{formatUpdatedAt(document.updatedAt)}</time>
              </button>
            ))
          ) : (
            <div className="library-list-empty">
              <BookOpen size={20} />
              <p>{query ? "没有匹配的资料" : "暂无资料"}</p>
              {!query && <button type="button" className="text-button" onClick={createNew}>新建资料</button>}
            </div>
          )}
        </div>
      </section>

      {editorOpen && (
        <aside className="library-editor-drawer" aria-label={isNew ? "新建资料" : "编辑资料"}>
          <form className="library-editor" onSubmit={save}>
            <header className="library-drawer-header">
              <div>
                <p>{isNew ? "新资料" : `版本 ${selected?.version ?? 1}`}</p>
                {!isNew && selected && <span>{selected.sourceFileName || `${selected.updatedBy} 更新于 ${formatUpdatedAt(selected.updatedAt)}`}</span>}
              </div>
              <button className="icon-button quiet" type="button" onClick={closeEditor} aria-label="关闭资料编辑">
                <X size={18} />
              </button>
            </header>
          <input
            className="library-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="资料标题"
            maxLength={160}
            required
          />
          <div className="library-editor-fields">
            <label>
              分类
              <input
                value={documentCategory}
                onChange={(event) => setDocumentCategory(event.target.value)}
                placeholder="例如：账号定位"
                maxLength={40}
                required
              />
            </label>
            <label>
              标签
              <input
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                placeholder="例如：小红书，选题"
                maxLength={400}
              />
            </label>
          </div>
          <label className="library-body-label">
            正文
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="记录账号定位、内容边界、平台规则、选题方法或复盘结论…"
              maxLength={50_000}
              required
            />
          </label>
          <div className="library-editor-footer">
            <span>{body.length.toLocaleString()} / 50,000</span>
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? "保存中" : isNew ? "创建资料" : "保存新版本"}
            </button>
          </div>
          {!isNew && selected && versions.length > 0 && (
            <div className="library-version-list" aria-label="版本记录">
              <p>版本记录</p>
              {versions.slice(0, 5).map((version) => (
                <div key={version.id}>
                  <strong>v{version.version}</strong>
                  <span>{version.updatedBy}</span>
                  <time dateTime={version.createdAt}>{formatUpdatedAt(version.createdAt)}</time>
                </div>
              ))}
            </div>
          )}
          </form>
        </aside>
      )}
    </section>
  );
}

function AssetsView({
  items,
  isLoading,
  onOpenIntelligence,
  onCreateTopicFromAsset,
  onArchiveEvidence,
}: {
  items: IntelligenceItem[];
  isLoading: boolean;
  onOpenIntelligence: () => void;
  onCreateTopicFromAsset: (itemId: string) => void;
  onArchiveEvidence: (itemId: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [platform, setPlatform] = useState<"全部" | Platform>("全部");
  const [mediaOnly, setMediaOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState("");
  const normalizedQuery = deferredQuery.toLocaleLowerCase();
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesPlatform =
          platform === "全部" || item.platform === platform;
        const matchesMedia =
          !mediaOnly || Boolean(item.coverUrl || item.imageUrls.length);
        const content =
          `${item.title}\n${item.summary}\n${item.body}\n${item.author}`.toLocaleLowerCase();
        return (
          matchesPlatform &&
          matchesMedia &&
          (!normalizedQuery || content.includes(normalizedQuery))
        );
      }),
    [items, mediaOnly, normalizedQuery, platform],
  );
  const selectedItem =
    visibleItems.find((item) => item.id === selectedId) ?? null;
  const selectedImages = selectedItem
    ? [
        ...new Set(
          [selectedItem.coverUrl, ...selectedItem.imageUrls].filter(Boolean),
        ),
      ]
    : [];
  const imageToDisplay = selectedImages.includes(selectedImage)
    ? selectedImage
    : selectedImages[0] || "";

  useEffect(() => {
    if (selectedId && !visibleItems.some((item) => item.id === selectedId)) {
      setSelectedId(null);
      setSelectedImage("");
    }
  }, [selectedId, visibleItems]);

  const selectItem = (item: IntelligenceItem) => {
    setSelectedId(item.id);
    setSelectedImage(item.coverUrl || item.imageUrls[0] || "");
  };

  return (
    <section className="assets-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">素材资产</p>
          <h1>采集的内容，留作下一次判断</h1>
          <p className="page-summary">
            所有素材均保留原始来源、完整正文和图片。
          </p>
        </div>
        <button
          className="text-button asset-library-link"
          onClick={onOpenIntelligence}
        >
          前往内容情报
          <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="asset-toolbar">
        <label className="wide-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索素材"
            placeholder="搜索标题、作者或完整正文"
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQuery("")}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="filter-tabs" role="tablist" aria-label="素材平台筛选">
          {(["全部", "小红书", "公众号", "抖音"] as const).map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={platform === item}
              className={platform === item ? "is-active" : ""}
              onClick={() => setPlatform(item)}
            >
              {item !== "全部" && (
                <img
                  className="platform-filter-logo"
                  src={platformLogoSrc[item]}
                  alt=""
                  aria-hidden="true"
                />
              )}
              <span className="platform-filter-label">{item}</span>
              <span>
                {item === "全部"
                  ? items.length
                  : items.filter((source) => source.platform === item).length}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`asset-media-filter ${mediaOnly ? "is-active" : ""}`}
          aria-pressed={mediaOnly}
          onClick={() => setMediaOnly((value) => !value)}
        >
          <ImageIcon size={15} />
          有图片
        </button>
      </div>
      <div className={`asset-layout ${selectedItem ? "has-inspector" : ""}`}>
        <section className="asset-rail" aria-label="素材列表">
          <div className="asset-rail-header">
            <span>
              {isLoading ? "正在读取素材" : `共 ${visibleItems.length} 条`}
            </span>
            {mediaOnly && (
              <button
                type="button"
                className="text-button"
                onClick={() => setMediaOnly(false)}
              >
                显示全部
              </button>
            )}
          </div>
          {isLoading ? (
            <div className="asset-empty">
              <ImageIcon size={20} />
              <strong>正在读取素材</strong>
            </div>
          ) : visibleItems.length ? (
            <div className="asset-grid">
              {visibleItems.map((item) => {
                const cover = item.coverUrl || item.imageUrls[0] || "";
                const mediaCount = new Set(
                  [item.coverUrl, ...item.imageUrls].filter(Boolean),
                ).size;
                return (
                  <button
                    type="button"
                    className={`asset-tile ${selectedItem?.id === item.id ? "is-selected" : ""}`}
                    key={item.id}
                    onClick={() => selectItem(item)}
                    aria-pressed={selectedItem?.id === item.id}
                  >
                    <span className="asset-thumbnail">
                      {cover ? (
                        <img
                          src={cover}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="asset-no-cover">
                          <ImageIcon size={21} />
                        </span>
                      )}
                      {mediaCount > 1 && (
                        <span className="asset-image-count">{mediaCount}</span>
                      )}
                    </span>
                    <span className="asset-tile-copy">
                      <span className="asset-tile-title">{item.title}</span>
                      <span className="asset-tile-meta">
                        <img
                          src={platformLogoSrc[item.platform]}
                          alt={item.platform}
                        />
                        {item.author}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="asset-empty">
              <Search size={20} />
              <strong>没有找到匹配素材</strong>
              <p>试试更短的关键词，或清除筛选条件。</p>
              <button
                className="text-button"
                onClick={() => {
                  setQuery("");
                  setPlatform("全部");
                  setMediaOnly(false);
                }}
              >
                清除筛选
              </button>
            </div>
          )}
        </section>
        {selectedItem && (
          <AssetInspector
            item={selectedItem}
            images={selectedImages}
            displayedImage={imageToDisplay}
            onSelectImage={setSelectedImage}
            onArchive={async () => {
              const archived = await onArchiveEvidence(selectedItem.id);
              if (archived) {
                setSelectedId(null);
                setSelectedImage("");
              }
            }}
            onCreateTopic={() => onCreateTopicFromAsset(selectedItem.id)}
            onClose={() => {
              setSelectedId(null);
              setSelectedImage("");
            }}
          />
        )}
      </div>
    </section>
  );
}

function ArchiveView({
  items,
  isLoading,
  onRestore,
}: {
  items: IntelligenceItem[];
  isLoading: boolean;
  onRestore: (itemId: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          !deferredQuery ||
          `${item.title}\n${item.summary}\n${item.body}\n${item.author}`
            .toLocaleLowerCase()
            .includes(deferredQuery),
      ),
    [deferredQuery, items],
  );
  const restore = async (itemId: string) => {
    setRestoringId(itemId);
    await onRestore(itemId);
    setRestoringId(null);
  };
  return (
    <section className="archive-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">归档</p>
          <h1>暂时收起，随时回到工作台</h1>
          <p className="page-summary">
            归档不删除内容，也不会影响已建立的选题引用。
          </p>
        </div>
      </div>
      <div className="archive-toolbar">
        <label className="wide-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索归档"
            placeholder="搜索归档内容"
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQuery("")}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <span>{isLoading ? "正在读取" : `${visibleItems.length} 条归档`}</span>
      </div>
      <section className="archive-list" aria-label="归档内容">
        {isLoading ? (
          <div className="archive-empty">
            <Archive size={20} />
            <strong>正在读取归档</strong>
          </div>
        ) : visibleItems.length ? (
          visibleItems.map((item) => {
            const cover = item.coverUrl || item.imageUrls[0] || "";
            const archivedAt = item.archivedAt
              ? new Intl.DateTimeFormat("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(item.archivedAt))
              : "";
            return (
              <article className="archive-row" key={item.id}>
                {cover ? (
                  <img
                    className="archive-cover"
                    src={cover}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="archive-placeholder">
                    <Archive size={18} />
                  </span>
                )}
                <div className="archive-content">
                  <div className="archive-title-line">
                    <h2>{item.title}</h2>
                    <img
                      src={platformLogoSrc[item.platform]}
                      alt={item.platform}
                    />
                  </div>
                  <p>{item.summary}</p>
                  <div className="archive-meta">
                    <span>{item.author}</span>
                    <span>归档于 {archivedAt || "刚刚"}</span>
                  </div>
                </div>
                <button
                  className="text-button restore-action"
                  type="button"
                  onClick={() => void restore(item.id)}
                  disabled={restoringId === item.id}
                >
                  <RotateCcw size={15} />
                  {restoringId === item.id ? "恢复中" : "恢复"}
                </button>
              </article>
            );
          })
        ) : (
          <div className="archive-empty">
            <Archive size={20} />
            <strong>{query ? "没有找到匹配归档" : "暂无归档内容"}</strong>
            <p>{query ? "试试更短的关键词。" : "归档后的素材会保留在这里。"}</p>
            {query && (
              <button className="text-button" onClick={() => setQuery("")}>
                清除搜索
              </button>
            )}
          </div>
        )}
      </section>
    </section>
  );
}

function AssetInspector({
  item,
  images,
  displayedImage,
  onSelectImage,
  onArchive,
  onCreateTopic,
  onClose,
}: {
  item: IntelligenceItem;
  images: string[];
  displayedImage: string;
  onSelectImage: (url: string) => void;
  onArchive: () => Promise<void>;
  onCreateTopic: () => void;
  onClose: () => void;
}) {
  const hasDistinctBody =
    Boolean(item.body.trim()) && item.body.trim() !== item.summary.trim();
  const body = item.body || item.summary || "原始正文暂不可用。";
  return (
    <aside className="asset-inspector" aria-label={`查看素材 ${item.title}`}>
      <div className="draft-header">
        <div>
          <p className="eyebrow">素材详情</p>
          <h2>{item.title}</h2>
        </div>
        <button
          className="icon-button quiet"
          onClick={onClose}
          aria-label="关闭素材详情"
        >
          <X size={18} />
        </button>
      </div>
      {displayedImage && (
        <>
          <div className="asset-preview-image">
            <img src={displayedImage} alt="" referrerPolicy="no-referrer" />
          </div>
          {images.length > 1 && (
            <div className="preview-thumbnails" aria-label="素材图片">
              {images.map((url, index) => (
                <button
                  type="button"
                  key={url}
                  className={displayedImage === url ? "is-selected" : ""}
                  onClick={() => onSelectImage(url)}
                  aria-label={`查看第 ${index + 1} 张图片`}
                >
                  <img src={url} alt="" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className="asset-detail-meta">
        <span>
          <img src={platformLogoSrc[item.platform]} alt="" />
          {item.platform}
        </span>
        <span>{item.author}</span>
        <span>{item.signal || "已采集"}</span>
        <span>{item.collectedAt}</span>
      </div>
      {hasDistinctBody && (
        <section className="asset-copy">
          <h3>摘要</h3>
          <p>{item.summary}</p>
        </section>
      )}
      <section className={`asset-copy ${hasDistinctBody ? "asset-body" : ""}`}>
        <h3>{item.platform === "抖音" ? "发布文案" : hasDistinctBody ? "完整正文" : "正文"}</h3>
        <p>{body}</p>
      </section>
      {item.platform === "抖音" && (
        <section className="asset-copy transcript-copy">
          <h3>口播逐字稿</h3>
          <p>
            {item.transcript ||
              (item.transcriptStatus === "not_configured"
                ? "未配置本机转写引擎。"
                : "尚未请求转写。")}
          </p>
        </section>
      )}
      <div className="panel-actions">
        {item.sourceUrl && (
          <a
            className="text-button"
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            查看来源
            <ArrowUpRight size={14} />
          </a>
        )}
        <button
          className="text-button"
          type="button"
          onClick={() => void onArchive()}
        >
          归档
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={onCreateTopic}
        >
          建立选题
          <ArrowUpRight size={14} />
        </button>
      </div>
    </aside>
  );
}

function MediaPreviewPanel({
  item,
  onClose,
  onRead,
}: {
  item: IntelligenceItem;
  onClose: () => void;
  onRead: () => void;
}) {
  const imageUrls = item.imageUrls.length ? item.imageUrls : [item.coverUrl];
  const [activeIndex, setActiveIndex] = useState(0);
  const activeUrl = imageUrls[Math.min(activeIndex, imageUrls.length - 1)];
  return (
    <aside
      className="topic-draft media-preview"
      aria-label={`图片预览 ${item.title}`}
    >
      <div className="draft-header">
        <div>
          <p className="eyebrow">内容图片</p>
          <h2>{item.title}</h2>
        </div>
        <button
          className="icon-button quiet"
          onClick={onClose}
          aria-label="关闭图片预览"
        >
          <X size={18} />
        </button>
      </div>
      <a
        className="preview-image"
        href={item.sourceUrl || activeUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="在来源页面打开图片"
      >
        <img src={activeUrl} alt="" referrerPolicy="no-referrer" />
      </a>
      {imageUrls.length > 1 && (
        <div className="preview-thumbnails" role="group" aria-label="选择图片">
          {imageUrls.map((url, index) => (
            <button
              type="button"
              className={index === activeIndex ? "is-selected" : ""}
              aria-pressed={index === activeIndex}
              onClick={() => setActiveIndex(index)}
              key={url}
              aria-label={`查看第 ${index + 1} 张图片`}
            >
              <img
                src={url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </button>
          ))}
        </div>
      )}
      <div className="preview-meta">
        <span>{item.platform}</span>
        <span>{imageUrls.length} 张图片</span>
        <span>{item.author}</span>
      </div>
      <div className="panel-actions">
        <button type="button" className="text-button" onClick={onRead}>
          阅读正文
        </button>
        <a
          className="text-button"
          href={item.sourceUrl || activeUrl}
          target="_blank"
          rel="noreferrer"
        >
          打开来源
          <ArrowUpRight size={14} />
        </a>
        <button type="button" className="text-button" onClick={onClose}>
          完成
        </button>
      </div>
    </aside>
  );
}

function ContentDetailPanel({
  item,
  onClose,
  onPreview,
}: {
  item: IntelligenceItem;
  onClose: () => void;
  onPreview: () => void;
}) {
  const imageCount = item.imageUrls.length || Number(Boolean(item.coverUrl));
  return (
    <aside
      className="topic-draft content-detail"
      aria-label={`完整正文 ${item.title}`}
    >
      <div className="draft-header">
        <div>
          <p className="eyebrow">{item.platform === "抖音" ? "发布文案" : "完整正文"}</p>
          <h2>{item.title}</h2>
        </div>
        <button
          className="icon-button quiet"
          onClick={onClose}
          aria-label="关闭完整正文"
        >
          <X size={18} />
        </button>
      </div>
      <div className="content-detail-meta">
        <span>{item.platform}</span>
        <span>{item.author}</span>
        <span>{item.signal}</span>
        <span>{item.collectedAt}</span>
      </div>
      <p className="content-detail-body">{item.body || item.summary}</p>
      {item.platform === "抖音" && (
        <section className="content-transcript-status">
          <strong>口播逐字稿</strong>
          <span>
            {item.transcript ||
              (item.transcriptStatus === "not_configured"
                ? "未配置本机转写引擎"
                : "尚未请求转写")}
          </span>
        </section>
      )}
      <div className="panel-actions">
        {imageCount > 0 && (
          <button type="button" className="text-button" onClick={onPreview}>
            查看图片 {imageCount}
          </button>
        )}
        {item.sourceUrl && (
          <a
            className="text-button"
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            打开来源
            <ArrowUpRight size={14} />
          </a>
        )}
        <button type="button" className="text-button" onClick={onClose}>
          完成
        </button>
      </div>
    </aside>
  );
}

function EvidenceCapture({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (evidence: EvidenceDraft) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [platform, setPlatform] = useState<Platform>("小红书");
  const [author, setAuthor] = useState("");
  const [signal, setSignal] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    const saved = await onSave({
      title: title.trim(),
      summary: summary.trim(),
      platform,
      author: author.trim(),
      signal: signal.trim(),
      sourceUrl: sourceUrl.trim(),
    });
    setIsSaving(false);
    if (saved) onClose();
  };
  return (
    <aside className="topic-draft evidence-capture" aria-label="录入内容情报">
      <div className="draft-header">
        <div>
          <p className="eyebrow">内容情报</p>
          <h2>记录一个值得追踪的信号</h2>
        </div>
        <button
          className="icon-button quiet"
          onClick={onClose}
          aria-label="关闭录入情报"
        >
          <X size={18} />
        </button>
      </div>
      <form onSubmit={save} className="topic-form">
        <label>
          标题
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="内容标题或你的观察"
            maxLength={180}
            required
          />
        </label>
        <label>
          摘要
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="保留它值得参考的原因、结构或读者反馈"
            maxLength={2000}
            required
          />
        </label>
        <div className="capture-fields">
          <label>
            平台
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
            >
              <option>小红书</option>
              <option>公众号</option>
              <option>抖音</option>
            </select>
          </label>
          <label>
            作者
            <input
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              placeholder="账号或来源"
              maxLength={80}
              required
            />
          </label>
        </div>
        <label>
          信号
          <input
            value={signal}
            onChange={(event) => setSignal(event.target.value)}
            placeholder="例如：评论 320、收藏 1.2 万"
            maxLength={80}
          />
        </label>
        <label>
          <span>
            来源链接 <em className="field-optional">可选</em>
          </span>
          <input
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://"
            maxLength={2000}
          />
        </label>
        <div className="panel-actions">
          <button
            type="button"
            className="text-button"
            onClick={onClose}
            disabled={isSaving}
          >
            取消
          </button>
          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? "保存中" : "保存情报"}
          </button>
        </div>
      </form>
    </aside>
  );
}

function MediaCrawlerPanel({
  connector,
  runs,
  onClose,
  onPrepare,
  onStart,
}: {
  connector: MediaCrawlerConnector | null;
  runs: CrawlRun[];
  onClose: () => void;
  onPrepare: () => Promise<boolean>;
  onStart: (request: CrawlRequest) => Promise<boolean>;
}) {
  const [platform, setPlatform] = useState<"xhs" | "dy">("xhs");
  const [query, setQuery] = useState("");
  const [captureMode, setCaptureMode] = useState<"keyword" | "douyin_url">(
    "keyword",
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [requestTranscript, setRequestTranscript] = useState(false);
  const [maxItems, setMaxItems] = useState(10);
  const [collectComments, setCollectComments] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const statusLabel =
    connector?.status === "ready"
      ? "已就绪"
      : connector?.status === "running"
        ? "采集中"
        : connector?.status === "preparing"
          ? "初始化中"
          : connector?.status === "needs_setup"
            ? "需要初始化"
            : "未检测到";
  const setupRequired =
    connector?.status === "needs_setup" || connector?.status === "preparing";
  const canStart =
    connector?.status === "ready" || connector?.status === "running";
  const platformLabel = platform === "xhs" ? "小红书" : "抖音";
  const runLabel = (run: CrawlRun) =>
    run.status === "succeeded"
      ? "已导入"
      : run.status === "failed"
        ? "未完成"
        : "进行中";
  const runDetail = (run: CrawlRun) =>
    run.status === "succeeded"
      ? `已导入 ${run.importedCount} 条内容情报${run.importedComments ? ` · ${run.importedComments} 条评论` : ""}${run.transcriptStatus === "not_configured" ? " · 口播转写未配置" : ""}`
      : run.status === "failed"
        ? run.errorMessage || "任务未完成，请重试。"
        : "浏览器中完成登录或验证后将继续导入。";
  const prepare = async () => {
    setIsSubmitting(true);
    await onPrepare();
    setIsSubmitting(false);
  };
  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    const started = await onStart(
      captureMode === "douyin_url"
        ? {
            platform: "dy",
            query: "抖音单条链接",
            maxItems: 1,
            collectComments,
            mode: "douyin_url",
            sourceUrl: sourceUrl.trim(),
            requestTranscript,
          }
        : { platform, query: query.trim(), maxItems, collectComments },
    );
    setIsSubmitting(false);
    if (started) {
      setQuery("");
      setSourceUrl("");
    }
  };
  return (
    <aside className="topic-draft crawler-panel" aria-label="MediaCrawler 采集">
      <div className="draft-header">
        <div>
          <p className="eyebrow">采集连接器</p>
          <h2>MediaCrawler</h2>
        </div>
        <button
          className="icon-button quiet"
          onClick={onClose}
          aria-label="关闭采集面板"
        >
          <X size={18} />
        </button>
      </div>
      <div className="connector-status">
        <span
          className={`status-dot ${connector?.status === "ready" ? "success" : connector?.status === "running" || connector?.status === "preparing" ? "review" : "schedule"}`}
          aria-hidden="true"
        />
        <div>
          <strong>{statusLabel}</strong>
          <p>关键词采集，或粘贴一条抖音视频链接。</p>
        </div>
      </div>
      {setupRequired ? (
        <>
          <ol className="crawler-steps" aria-label="首次采集流程">
            <li className="is-current">
              <span>01</span>
              <div>
                <strong>配置运行环境</strong>
                <p>仅首次需要，完成后可直接采集。</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>在浏览器完成登录</strong>
                <p>开始采集时按平台提示验证。</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>内容进入情报库</strong>
                <p>保留来源，供后续选题引用。</p>
              </div>
            </li>
          </ol>
          <div className="connector-empty">
            <button
              className="primary-button"
              type="button"
              onClick={() => void prepare()}
              disabled={isSubmitting || connector?.status === "preparing"}
            >
              {connector?.status === "preparing"
                ? "正在初始化"
                : "初始化运行环境"}
            </button>
            <p>将安装本地 Python 依赖，不会启动采集。</p>
          </div>
        </>
      ) : canStart ? (
        <form className="topic-form crawl-form" onSubmit={start}>
          <fieldset className="platform-picker capture-mode-picker">
            <legend>采集方式</legend>
            <div role="group" aria-label="选择采集方式">
              <button
                type="button"
                className={`platform-choice ${captureMode === "keyword" ? "is-selected" : ""}`}
                aria-pressed={captureMode === "keyword"}
                onClick={() => setCaptureMode("keyword")}
                disabled={connector?.status === "running"}
              >
                关键词采集
              </button>
              <button
                type="button"
                className={`platform-choice ${captureMode === "douyin_url" ? "is-selected" : ""}`}
                aria-pressed={captureMode === "douyin_url"}
                onClick={() => {
                  setCaptureMode("douyin_url");
                  setPlatform("dy");
                }}
                disabled={connector?.status === "running"}
              >
                粘贴抖音链接
              </button>
            </div>
          </fieldset>
          {captureMode === "keyword" ? (
            <>
          <fieldset className="platform-picker">
            <legend>采集平台</legend>
            <div role="group" aria-label="选择采集平台">
              <button
                type="button"
                className={`platform-choice ${platform === "xhs" ? "is-selected" : ""}`}
                aria-pressed={platform === "xhs"}
                onClick={() => setPlatform("xhs")}
                disabled={connector?.status === "running"}
              >
                <img
                  src={crawlerPlatformLogoSrc.xhs}
                  alt=""
                  aria-hidden="true"
                />
                小红书
              </button>
              <button
                type="button"
                className={`platform-choice ${platform === "dy" ? "is-selected" : ""}`}
                aria-pressed={platform === "dy"}
                onClick={() => setPlatform("dy")}
                disabled={connector?.status === "running"}
              >
                <img
                  src={crawlerPlatformLogoSrc.dy}
                  alt=""
                  aria-hidden="true"
                />
                抖音
              </button>
            </div>
          </fieldset>
          <label>
            关键词
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：通勤包"
              maxLength={120}
              required
              disabled={connector?.status === "running"}
            />
          </label>
          <label>
            采集数量
            <div className="quantity-field">
              <input
                type="number"
                min={1}
                max={50}
                value={maxItems}
                onChange={(event) => setMaxItems(Number(event.target.value))}
                required
                disabled={connector?.status === "running"}
              />
              <span>条</span>
            </div>
          </label>
          <label className="comment-collect-option">
            <input
              type="checkbox"
              checked={collectComments}
              onChange={(event) => setCollectComments(event.target.checked)}
              disabled={connector?.status === "running"}
            />
            <span>
              <strong>同时采集评论</strong>
              <small>会增加运行时间，默认关闭。</small>
            </span>
          </label>
          <div className="crawl-summary" aria-live="polite">
            <span>{platformLabel}</span>
            <strong>{query.trim() || "输入关键词"}</strong>
            <span>最多 {maxItems} 条</span>
            {collectComments && <span>含评论</span>}
          </div>
          <p className="connector-note">
            将打开可见浏览器完成登录或验证。仅在任务完成后写入内容情报。
          </p>
            </>
          ) : (
            <>
              <label>
                抖音视频链接
                <input
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="粘贴 v.douyin.com 短链或视频页链接"
                  maxLength={2000}
                  required
                  disabled={connector?.status === "running"}
                />
              </label>
              <label className="comment-collect-option">
                <input
                  type="checkbox"
                  checked={collectComments}
                  onChange={(event) => setCollectComments(event.target.checked)}
                  disabled={connector?.status === "running"}
                />
                <span>
                  <strong>同时采集评论</strong>
                  <small>采集后与发布文案一并进入内容情报。</small>
                </span>
              </label>
              <label className="comment-collect-option transcript-option">
                <input
                  type="checkbox"
                  checked={requestTranscript}
                  onChange={(event) => setRequestTranscript(event.target.checked)}
                  disabled={connector?.status === "running"}
                />
                <span>
                  <strong>提取口播逐字稿</strong>
                  <small>本机暂未配置转写引擎；会保留为待配置状态。</small>
                </span>
              </label>
              <div className="crawl-summary" aria-live="polite">
                <span>抖音</span>
                <strong>{sourceUrl.trim() || "粘贴视频链接"}</strong>
                <span>单条</span>
                {collectComments && <span>含评论</span>}
              </div>
              <p className="connector-note">
                可识别 v.douyin.com 短链与抖音视频页。发布文案、封面、视频地址与评论将保留来源。
              </p>
            </>
          )}
          <div className="panel-actions">
            <button
              type="button"
              className="text-button"
              onClick={onClose}
              disabled={isSubmitting}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitting || connector?.status === "running"}
            >
              {connector?.status === "running"
                ? "采集中"
                : isSubmitting
                  ? "启动中"
                  : "开始采集"}
            </button>
          </div>
        </form>
      ) : (
        <div className="connector-empty">
          <p>
            未找到 <code>integrations/MediaCrawler</code>。
          </p>
        </div>
      )}
      {runs.length > 0 && (
        <section className="crawler-history" aria-label="最近采集任务">
          <p className="eyebrow">最近任务</p>
          {runs.slice(0, 3).map((run) => (
            <div className="crawler-run" key={run.id}>
              <span
                className={`status-dot ${run.status === "succeeded" ? "success" : run.status === "running" ? "review" : "schedule"}`}
                aria-hidden="true"
              />
              <div>
                <div className="run-title">
                  <strong>{run.query}</strong>
                  <span>{runLabel(run)}</span>
                </div>
                <p>{runDetail(run)}</p>
              </div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}

function ProjectsView({
  topics,
  projects,
  onCreate,
  onConfirmTopic,
  onOpen,
}: {
  topics: Topic[];
  projects: Project[];
  onCreate: (topic: Topic | null) => void;
  onConfirmTopic: (topicId: string) => Promise<boolean>;
  onOpen: (project: Project) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"全部" | ReviewStatus | "已发布">(
    "全部",
  );
  const [confirmingTopicId, setConfirmingTopicId] = useState<string | null>(
    null,
  );
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) => {
        const matchesStatus =
          status === "全部" ||
          (status === "已发布"
            ? Boolean(project.publishedAt)
            : project.reviewStatus === status && !project.publishedAt);
        const text =
          `${project.title}\n${project.platform}\n${project.contentFormat}\n${project.reviewNote}`.toLocaleLowerCase();
        return (
          matchesStatus && (!deferredQuery || text.includes(deferredQuery))
        );
      }),
    [deferredQuery, projects, status],
  );
  const statusOptions: Array<"全部" | ReviewStatus | "已发布"> = [
    "全部",
    "草稿",
    "待审核",
    "已批准",
    "已发布",
  ];
  const statusCount = (option: typeof status) =>
    option === "全部"
      ? projects.length
      : option === "已发布"
        ? projects.filter((project) => project.publishedAt).length
        : projects.filter(
            (project) =>
              project.reviewStatus === option && !project.publishedAt,
          ).length;
  return (
    <section className="projects-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">创作项目</p>
          <h1>把选题推进成稿件</h1>
          <p className="page-summary">稿件从已确认的内容上下文开始。</p>
        </div>
        <button className="primary-button" onClick={() => onCreate(null)}>
          <Plus size={16} />
          新建草稿
        </button>
      </div>
      <section className="work-section" aria-labelledby="topic-title">
        <div className="section-heading">
          <div>
            <h2 id="topic-title">待推进选题</h2>
            <p>确认选题后创建稿件，会保留证据和内容角度。</p>
          </div>
        </div>
        <div className="topic-list">
          {topics.length ? (
            topics.map((topic) => (
              <article className="topic-row" key={topic.id}>
                <div className="topic-number">{topic.evidenceIds.length}</div>
                <div>
                  <div className="task-title-line">
                    <h3>{topic.title}</h3>
                    <span
                      className={`status-tag ${topic.status === "已确认" ? "success" : "plan"}`}
                    >
                      {topic.status}
                    </span>
                  </div>
                  <p>{topic.angle || "尚未补充内容角度。"}</p>
                  <span className="topic-evidence">
                    <Link2 size={14} />
                    {topic.evidenceIds.length} 条引用
                  </span>
                </div>
                {topic.status === "已确认" ? (
                  <button
                    className="row-action"
                    onClick={() => onCreate(topic)}
                  >
                    创建稿件
                    <ChevronRight size={15} />
                  </button>
                ) : (
                  <button
                    className="row-action"
                    disabled={confirmingTopicId === topic.id}
                    onClick={() =>
                      void (async () => {
                        setConfirmingTopicId(topic.id);
                        await onConfirmTopic(topic.id);
                        setConfirmingTopicId(null);
                      })()
                    }
                  >
                    {confirmingTopicId === topic.id ? "确认中" : "确认选题"}
                    <ChevronRight size={15} />
                  </button>
                )}
              </article>
            ))
          ) : (
            <div className="task-empty">
              从内容情报选择素材后，可以在这里创建选题。
            </div>
          )}
        </div>
      </section>
      <section
        className="work-section project-section"
        aria-labelledby="project-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="project-title">近期稿件</h2>
            <p>草稿、审核与排期状态在这里持续更新。</p>
          </div>
        </div>
        <div className="projects-toolbar">
          <label className="wide-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="搜索稿件"
              placeholder="搜索标题、格式或审核意见"
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setQuery("")}
                aria-label="清除搜索"
              >
                <X size={14} />
              </button>
            )}
          </label>
          <div className="filter-tabs" role="tablist" aria-label="稿件状态筛选">
            {statusOptions.map((option) => (
              <button
                key={option}
                role="tab"
                aria-selected={status === option}
                className={status === option ? "is-active" : ""}
                onClick={() => setStatus(option)}
              >
                <span>{option}</span>
                <span>{statusCount(option)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="project-list">
          {visibleProjects.length ? (
            visibleProjects.map((project) => (
              <article className="project-row" key={project.id}>
                <FilePenLine size={17} />
                <div>
                  <h3>{project.title}</h3>
                  <p>
                    {project.platform} · {project.contentFormat} ·{" "}
                    {project.sourceProjectId
                      ? "内容变体"
                      : project.topicId
                        ? "来自选题"
                        : "直接创建"} · 版本{" "}
                    {project.version}
                    {project.reviewNote
                      ? ` · 审核意见：${project.reviewNote}`
                      : ""}
                  </p>
                </div>
                <span
                  className={`status-tag ${project.publishedAt ? "success" : reviewTone(project.reviewStatus)}`}
                >
                  {project.publishedAt ? "已发布" : project.reviewStatus}
                </span>
                <button className="row-action" onClick={() => onOpen(project)}>
                  编辑
                  <ChevronRight size={15} />
                </button>
              </article>
            ))
          ) : (
            <div className="task-empty">
              没有匹配的稿件。
              <button
                className="text-button"
                onClick={() => {
                  setQuery("");
                  setStatus("全部");
                }}
              >
                清除筛选
              </button>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function ComposerPanel({
  topic,
  onClose,
  onSave,
}: {
  topic: Topic | null;
  onClose: () => void;
  onSave: (project: ProjectDraft) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(topic?.title ?? "");
  const [platform, setPlatform] = useState<Platform>("小红书");
  const [contentFormat, setContentFormat] = useState<ContentFormat>("图文笔记");
  const [mode, setMode] = useState<"空白稿件" | "带入选题框架">(
    topic ? "带入选题框架" : "空白稿件",
  );
  const [isSaving, setIsSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const body =
      topic && mode === "带入选题框架"
        ? buildTopicStarter(normalizedTitle, topic, contentFormat)
        : "";
    setIsSaving(true);
    await onSave({
      title: normalizedTitle,
      platform,
      contentFormat,
      topicId: topic?.id,
      body,
    });
    setIsSaving(false);
  };
  return (
    <aside className="composer-panel" aria-label="新建内容">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{topic ? "从选题创建" : "新建内容"}</p>
          <h2>{topic ? "把判断写成内容" : "从一个想法开始"}</h2>
        </div>
        <button
          className="icon-button quiet"
          onClick={onClose}
          aria-label="关闭新建内容"
        >
          <X size={18} />
        </button>
      </div>
      {topic && (
        <div className="composer-context">
          <Link2 size={15} />
          <span>{topic.evidenceIds.length} 条引用将带入稿件</span>
        </div>
      )}
      <form className="composer-form" onSubmit={submit}>
        <label>
          内容主题
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="写下一个主题、问题或链接"
            required
          />
        </label>
        <label>
          目标平台
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as Platform)}
          >
            <option>小红书</option>
            <option>公众号</option>
            <option>抖音</option>
          </select>
        </label>
        <label>
          内容格式
          <select
            value={contentFormat}
            onChange={(event) =>
              setContentFormat(event.target.value as ContentFormat)
            }
          >
            <option>图文笔记</option>
            <option>长文文章</option>
            <option>短视频脚本</option>
            <option>口播稿</option>
          </select>
        </label>
        {topic && (
          <fieldset>
            <legend>起草方式</legend>
            <div className="choice-grid">
              <button
                type="button"
                className={`choice ${mode === "空白稿件" ? "is-selected" : ""}`}
                aria-pressed={mode === "空白稿件"}
                onClick={() => setMode("空白稿件")}
              >
                <FilePenLine size={16} />
                空白稿件
              </button>
              <button
                type="button"
                className={`choice ${mode === "带入选题框架" ? "is-selected" : ""}`}
                aria-pressed={mode === "带入选题框架"}
                onClick={() => setMode("带入选题框架")}
              >
                <Link2 size={16} />
                带入选题框架
              </button>
            </div>
          </fieldset>
        )}
        {topic && mode === "带入选题框架" && (
          <p className="composer-note">
            会写入选题角度、对应格式结构和引用提示，所有内容可直接编辑。
          </p>
        )}
        <div className="panel-actions">
          <button
            type="button"
            className="text-button"
            onClick={onClose}
            disabled={isSaving}
          >
            取消
          </button>
          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? "创建中" : "创建草稿"}
          </button>
        </div>
      </form>
    </aside>
  );
}

function ProjectEditor({
  project,
  topics,
  sources,
  onClose,
  onSave,
  onCreateVariant,
}: {
  project: Project;
  topics: Topic[];
  sources: IntelligenceItem[];
  onClose: () => void;
  onSave: (project: ProjectUpdate) => Promise<Project | null>;
  onCreateVariant: (
    projectId: string,
    platform: Platform,
    contentFormat: ContentFormat,
  ) => Promise<Project | null>;
}) {
  const [title, setTitle] = useState(project.title);
  const [platform, setPlatform] = useState<Platform>(project.platform);
  const [contentFormat, setContentFormat] = useState<ContentFormat>(
    project.contentFormat,
  );
  const [body, setBody] = useState(project.body);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(
    project.reviewStatus,
  );
  const [reviewNote, setReviewNote] = useState(project.reviewNote);
  const [version, setVersion] = useState(project.version);
  const [isSaving, setIsSaving] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [variantPlatform, setVariantPlatform] = useState<Platform>(
    project.platform === "小红书" ? "公众号" : "小红书",
  );
  const [variantFormat, setVariantFormat] = useState<ContentFormat>(
    project.contentFormat,
  );
  const [isCreatingVariant, setIsCreatingVariant] = useState(false);
  const sourceTopic = project.topicId
    ? topics.find((topic) => topic.id === project.topicId)
    : null;
  const [sourceContextOpen, setSourceContextOpen] = useState(
    Boolean(sourceTopic),
  );
  const sourceItems = sourceTopic
    ? sourceTopic.evidenceIds
        .map((id) => sources.find((item) => item.id === id))
        .filter((item): item is IntelligenceItem => Boolean(item))
    : [];
  const save = async (nextReviewStatus = reviewStatus) => {
    if (!title.trim()) return;
    setIsSaving(true);
    const saved = await onSave({
      id: project.id,
      title: title.trim(),
      platform,
      contentFormat,
      reviewStatus: nextReviewStatus,
      reviewNote: reviewNote.trim(),
      body,
      version,
    });
    setIsSaving(false);
    if (saved) {
      setReviewStatus(saved.reviewStatus);
      setReviewNote(saved.reviewNote);
      setVersion(saved.version);
    }
  };
  const createVariant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !title.trim() ||
      (platform === variantPlatform && contentFormat === variantFormat)
    )
      return;
    setIsCreatingVariant(true);
    const saved = await onSave({
      id: project.id,
      title: title.trim(),
      platform,
      contentFormat,
      reviewStatus,
      reviewNote: reviewNote.trim(),
      body,
      version,
    });
    if (saved) {
      setReviewStatus(saved.reviewStatus);
      setReviewNote(saved.reviewNote);
      setVersion(saved.version);
      await onCreateVariant(saved.id, variantPlatform, variantFormat);
    }
    setIsCreatingVariant(false);
  };
  const variantControl = (
    <section className="editor-variant">
      <button
        type="button"
        className="editor-variant-toggle"
        onClick={() => setVariantOpen((current) => !current)}
        aria-expanded={variantOpen}
      >
        <span>
          <FilePenLine size={15} />
          创建内容变体
        </span>
        <ChevronDown size={16} className={variantOpen ? "is-open" : ""} />
      </button>
      {variantOpen && (
        <form
          className="editor-variant-form"
          onSubmit={(event) => void createVariant(event)}
        >
          <p>会先保存当前稿件，再复制为一份独立可编辑的草稿。</p>
          <div>
            <label>
              目标平台
              <select
                value={variantPlatform}
                onChange={(event) =>
                  setVariantPlatform(event.target.value as Platform)
                }
              >
                <option>小红书</option>
                <option>公众号</option>
                <option>抖音</option>
              </select>
            </label>
            <label>
              内容格式
              <select
                value={variantFormat}
                onChange={(event) =>
                  setVariantFormat(event.target.value as ContentFormat)
                }
              >
                <option>图文笔记</option>
                <option>长文文章</option>
                <option>短视频脚本</option>
                <option>口播稿</option>
              </select>
            </label>
          </div>
          <div className="panel-actions">
            <button
              className="text-button"
              type="button"
              disabled={isCreatingVariant}
              onClick={() => setVariantOpen(false)}
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={
                isSaving ||
                isCreatingVariant ||
                (platform === variantPlatform &&
                  contentFormat === variantFormat)
              }
            >
              {isCreatingVariant ? "创建中" : "创建变体"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
  return (
    <aside className="editor-panel" aria-label={`编辑稿件 ${project.title}`}>
      <div className="panel-header">
        <div>
          <p className="eyebrow">稿件编辑</p>
          <h2>继续写作</h2>
        </div>
        <button
          className="icon-button quiet"
          onClick={onClose}
          aria-label="关闭稿件编辑"
        >
          <X size={18} />
        </button>
      </div>
      <div className="editor-context">
        <span>
          {sourceTopic ? `来自选题：${sourceTopic.title}` : "直接创建"}
        </span>
        <span>版本 {version}</span>
      </div>
      {sourceTopic && (
        <section className="editor-source-context">
          <button
            type="button"
            className="editor-source-toggle"
            onClick={() => setSourceContextOpen((current) => !current)}
            aria-expanded={sourceContextOpen}
          >
            <span>
              <Link2 size={15} />
              引用内容 {sourceTopic.evidenceIds.length} 条
            </span>
            <ChevronDown
              size={16}
              className={sourceContextOpen ? "is-open" : ""}
            />
          </button>
          {sourceContextOpen && (
            <div className="editor-source-list">
              {sourceItems.length ? (
                sourceItems.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.summary}</p>
                      <span>
                        {item.author} · {item.platform}
                      </span>
                    </div>
                    {item.sourceUrl && (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`打开${item.title}的来源`}
                      >
                        <ArrowUpRight size={15} />
                      </a>
                    )}
                  </article>
                ))
              ) : (
                <p className="editor-source-empty">关联素材已归档或不可用。</p>
              )}
            </div>
          )}
        </section>
      )}
      {variantControl}
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          标题
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <div className="editor-fields">
          <label>
            平台
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
            >
              <option>小红书</option>
              <option>公众号</option>
              <option>抖音</option>
            </select>
          </label>
          <label>
            内容格式
            <select
              value={contentFormat}
              onChange={(event) =>
                setContentFormat(event.target.value as ContentFormat)
              }
            >
              <option>图文笔记</option>
              <option>长文文章</option>
              <option>短视频脚本</option>
              <option>口播稿</option>
            </select>
          </label>
        </div>
        <div className="editor-readonly">
          <span>状态</span>
          <strong className={`status-tag ${reviewTone(reviewStatus)}`}>
            {reviewStatus}
          </strong>
        </div>
        <label className="editor-body-label">
          正文
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="从一个明确的判断开始。"
            maxLength={60000}
          />
        </label>
        <label className="editor-review-note">
          审核意见
          <textarea
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="通过或退回时，留下下一步可执行的意见"
            maxLength={2000}
          />
        </label>
        <div className="editor-footer">
          <span>{isSaving ? "正在保存" : `${body.length} 字`}</span>
          <div className="panel-actions">
            <button className="text-button" type="submit" disabled={isSaving}>
              保存
            </button>
            {reviewStatus === "草稿" && (
              <button
                className="primary-button"
                type="button"
                disabled={isSaving}
                onClick={() => void save("待审核")}
              >
                {isSaving ? "提交中" : "提交审核"}
              </button>
            )}
            {reviewStatus === "待审核" && (
              <>
                <button
                  className="text-button"
                  type="button"
                  disabled={isSaving}
                  onClick={() => void save("草稿")}
                >
                  {isSaving ? "处理中" : "退回修改"}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={isSaving}
                  onClick={() => void save("已批准")}
                >
                  {isSaving ? "处理中" : "通过审核"}
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}

const toLocalDateTime = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const buildTopicStarter = (
  title: string,
  topic: Topic,
  contentFormat: ContentFormat,
) => {
  const structures: Record<ContentFormat, string> = {
    图文笔记: "开头钩子\n\n核心判断\n\n展开要点\n1. \n2. \n3. \n\n结尾行动",
    长文文章:
      "标题\n\n引言\n\n核心判断\n\n论证\n1. 现象与问题\n2. 原因与证据\n3. 可执行的建议\n\n结语",
    短视频脚本:
      "前 3 秒钩子\n\n镜头 1：问题\n口播：\n画面：\n\n镜头 2：判断\n口播：\n画面：\n\n镜头 3：行动\n口播：\n画面：",
    口播稿: "开场\n\n问题\n\n核心判断\n\n展开\n\n结尾与行动",
  };
  return `${title}\n\n内容格式\n${contentFormat}\n\n选题角度\n${topic.angle || "请写下你希望读者带走的明确判断。"}\n\n${structures[contentFormat]}\n\n引用上下文\n已关联 ${topic.evidenceIds.length} 条内容情报。定稿前请回看来源，确认事实与表达边界。`;
};
const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};
const startOfWeek = (date: Date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};
const formatWeekRange = (start: Date) =>
  `${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(start)} 至 ${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(addDays(start, 6))}`;
const formatEventTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));

function CalendarView({
  projects,
  onSchedule,
  onMarkPublished,
  onRecordMetrics,
}: {
  projects: Project[];
  onSchedule: (projectId: string, scheduledAt: string) => Promise<boolean>;
  onMarkPublished: (projectId: string) => Promise<boolean>;
  onRecordMetrics: (
    projectId: string,
    metrics: Pick<
      Project,
      | "publishedUrl"
      | "metricViews"
      | "metricLikes"
      | "metricComments"
      | "metricSaves"
    >,
  ) => Promise<boolean>;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const week = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const scheduledByDay = useMemo(
    () =>
      projects
        .filter((project) => project.scheduledAt)
        .reduce<Map<string, Project[]>>((groups, project) => {
          const key = dateKey(new Date(project.scheduledAt!));
          groups.set(key, [...(groups.get(key) || []), project]);
          return groups;
        }, new Map()),
    [projects],
  );
  const awaitingSchedule = projects.filter(
    (project) => project.reviewStatus === "已批准" && !project.scheduledAt,
  );
  const awaitingPublication = projects
    .filter(
      (project) =>
        project.scheduledAt &&
        !project.publishedAt &&
        new Date(project.scheduledAt) <= new Date(),
    )
    .sort((left, right) =>
      (left.scheduledAt || "").localeCompare(right.scheduledAt || ""),
    );
  const publishedProjects = projects
    .filter((project) => project.publishedAt)
    .sort((left, right) =>
      (right.publishedAt || "").localeCompare(left.publishedAt || ""),
    );
  const today = dateKey(new Date());
  return (
    <section className="calendar-view">
      <div className="page-heading">
        <div>
          <p className="eyebrow">发布日历</p>
          <h1>安排已批准的内容</h1>
          <p className="page-summary">排期仅记录计划，发布仍需人工确认。</p>
        </div>
        <div className="calendar-controls" aria-label="切换排期周">
          <button
            className="icon-button"
            onClick={() => setWeekStart((date) => addDays(date, -7))}
            aria-label="上一周"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="text-button"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            今天
          </button>
          <button
            className="icon-button"
            onClick={() => setWeekStart((date) => addDays(date, 7))}
            aria-label="下一周"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <section
        className="work-section week-calendar"
        aria-labelledby="week-calendar-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="week-calendar-title">{formatWeekRange(weekStart)}</h2>
            <p>已排期内容按发布时间展示。</p>
          </div>
        </div>
        <div className="week-calendar-grid">
          {week.map((day) => {
            const key = dateKey(day);
            const entries = (scheduledByDay.get(key) || []).sort(
              (left, right) =>
                (left.scheduledAt || "").localeCompare(right.scheduledAt || ""),
            );
            return (
              <section
                className={`calendar-day ${key === today ? "is-today" : ""}`}
                key={key}
              >
                <header>
                  <span>
                    {
                      ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][
                        week.indexOf(day)
                      ]
                    }
                  </span>
                  <strong>{day.getDate()}</strong>
                </header>
                <div className="calendar-events">
                  {entries.map((project) => (
                    <article
                      className={`calendar-event ${project.publishedAt ? "is-published" : ""}`}
                      key={project.id}
                    >
                      <time>{formatEventTime(project.scheduledAt!)}</time>
                      <strong>{project.title}</strong>
                      <span>
                        {project.platform} ·{" "}
                        {project.publishedAt ? "已发布" : "已排期"}
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>
      <section
        className="work-section pending-publication-section"
        aria-labelledby="pending-publication-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="pending-publication-title">待确认发布</h2>
            <p>仅显示已到发布时间的内容。</p>
          </div>
        </div>
        {awaitingPublication.length ? (
          <div className="schedule-list">
            {awaitingPublication.map((project) => (
              <PublicationConfirmRow
                key={project.id}
                project={project}
                onMarkPublished={onMarkPublished}
              />
            ))}
          </div>
        ) : (
          <div className="calendar-empty">暂无待确认发布内容。</div>
        )}
      </section>
      <section
        className="work-section pending-schedule-section"
        aria-labelledby="pending-schedule-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="pending-schedule-title">待排期</h2>
            <p>仅显示已批准稿件。</p>
          </div>
        </div>
        {awaitingSchedule.length ? (
          <div className="schedule-list">
            {awaitingSchedule.map((project) => (
              <ScheduleRow
                key={project.id}
                project={project}
                onSchedule={onSchedule}
              />
            ))}
          </div>
        ) : (
          <div className="calendar-empty">暂无可排期稿件。</div>
        )}
      </section>
      <section
        className="work-section published-review-section"
        aria-labelledby="published-review-title"
      >
        <div className="section-heading">
          <div>
            <h2 id="published-review-title">发布复盘</h2>
            <p>手动记录链接和表现数据，不自动读取平台指标。</p>
          </div>
        </div>
        {publishedProjects.length ? (
          <div className="published-review-list">
            {publishedProjects.map((project) => (
              <PublicationMetricsRow
                key={project.id}
                project={project}
                onSave={onRecordMetrics}
              />
            ))}
          </div>
        ) : (
          <div className="calendar-empty">确认发布后，可以在这里记录表现。</div>
        )}
      </section>
    </section>
  );
}

function PublicationConfirmRow({
  project,
  onMarkPublished,
}: {
  project: Project;
  onMarkPublished: (projectId: string) => Promise<boolean>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const confirm = async () => {
    setIsSaving(true);
    await onMarkPublished(project.id);
    setIsSaving(false);
  };
  return (
    <article className="schedule-row publication-row">
      <div>
        <h3>{project.title}</h3>
        <p>
          {project.platform} · 原定{" "}
          {new Intl.DateTimeFormat("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).format(new Date(project.scheduledAt!))}
        </p>
      </div>
      <button
        className="primary-button"
        type="button"
        disabled={isSaving}
        onClick={() => void confirm()}
      >
        {isSaving ? "确认中" : "标记已发布"}
      </button>
    </article>
  );
}

function PublicationMetricsRow({
  project,
  onSave,
}: {
  project: Project;
  onSave: (
    projectId: string,
    metrics: Pick<
      Project,
      | "publishedUrl"
      | "metricViews"
      | "metricLikes"
      | "metricComments"
      | "metricSaves"
    >,
  ) => Promise<boolean>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState(project.publishedUrl);
  const [metricViews, setMetricViews] = useState(String(project.metricViews));
  const [metricLikes, setMetricLikes] = useState(String(project.metricLikes));
  const [metricComments, setMetricComments] = useState(
    String(project.metricComments),
  );
  const [metricSaves, setMetricSaves] = useState(String(project.metricSaves));
  const recorded = Boolean(project.metricsRecordedAt);
  const metricValue = (value: string) =>
    Math.max(0, Number.parseInt(value || "0", 10) || 0);
  const cancel = () => {
    setPublishedUrl(project.publishedUrl);
    setMetricViews(String(project.metricViews));
    setMetricLikes(String(project.metricLikes));
    setMetricComments(String(project.metricComments));
    setMetricSaves(String(project.metricSaves));
    setIsEditing(false);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    const saved = await onSave(project.id, {
      publishedUrl: publishedUrl.trim(),
      metricViews: metricValue(metricViews),
      metricLikes: metricValue(metricLikes),
      metricComments: metricValue(metricComments),
      metricSaves: metricValue(metricSaves),
    });
    setIsSaving(false);
    if (saved) setIsEditing(false);
  };
  const publishedLabel = project.publishedAt
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(project.publishedAt))
    : "";
  return (
    <article
      className={`publication-metrics-row ${isEditing ? "is-editing" : ""}`}
    >
      <div className="publication-metrics-heading">
        <div>
          <div className="task-title-line">
            <h3>{project.title}</h3>
            <span className="status-tag success">已发布</span>
          </div>
          <p>
            {project.platform} · {publishedLabel}
            {recorded
              ? ` · ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(project.metricsRecordedAt!))} 已记录`
              : " · 尚未记录表现"}
          </p>
        </div>
        {!isEditing && (
          <div className="publication-metrics-actions">
            {project.publishedUrl && (
              <a
                className="text-button"
                href={project.publishedUrl}
                target="_blank"
                rel="noreferrer"
              >
                查看链接
                <ArrowUpRight size={14} />
              </a>
            )}
            <button
              className="text-button"
              type="button"
              onClick={() => setIsEditing(true)}
            >
              {recorded ? "更新表现" : "记录表现"}
            </button>
          </div>
        )}
      </div>
      {!isEditing && recorded && (
        <dl className="publication-metrics-summary">
          <div>
            <dt>阅读</dt>
            <dd>{project.metricViews.toLocaleString("zh-CN")}</dd>
          </div>
          <div>
            <dt>点赞</dt>
            <dd>{project.metricLikes.toLocaleString("zh-CN")}</dd>
          </div>
          <div>
            <dt>评论</dt>
            <dd>{project.metricComments.toLocaleString("zh-CN")}</dd>
          </div>
          <div>
            <dt>收藏</dt>
            <dd>{project.metricSaves.toLocaleString("zh-CN")}</dd>
          </div>
        </dl>
      )}
      {isEditing && (
        <form className="publication-metrics-form" onSubmit={save}>
          <label className="publication-url">
            <span>
              发布链接 <em className="field-optional">可选</em>
            </span>
            <input
              type="url"
              value={publishedUrl}
              onChange={(event) => setPublishedUrl(event.target.value)}
              placeholder="https://"
              maxLength={2000}
            />
          </label>
          <div className="publication-metric-fields">
            <label>
              阅读
              <input
                type="number"
                min="0"
                max="2147483647"
                inputMode="numeric"
                value={metricViews}
                onChange={(event) => setMetricViews(event.target.value)}
              />
            </label>
            <label>
              点赞
              <input
                type="number"
                min="0"
                max="2147483647"
                inputMode="numeric"
                value={metricLikes}
                onChange={(event) => setMetricLikes(event.target.value)}
              />
            </label>
            <label>
              评论
              <input
                type="number"
                min="0"
                max="2147483647"
                inputMode="numeric"
                value={metricComments}
                onChange={(event) => setMetricComments(event.target.value)}
              />
            </label>
            <label>
              收藏
              <input
                type="number"
                min="0"
                max="2147483647"
                inputMode="numeric"
                value={metricSaves}
                onChange={(event) => setMetricSaves(event.target.value)}
              />
            </label>
          </div>
          <div className="panel-actions">
            <button
              className="text-button"
              type="button"
              disabled={isSaving}
              onClick={cancel}
            >
              取消
            </button>
            <button className="primary-button" disabled={isSaving}>
              {isSaving ? "保存中" : "保存表现"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function ScheduleRow({
  project,
  onSchedule,
}: {
  project: Project;
  onSchedule: (projectId: string, scheduledAt: string) => Promise<boolean>;
}) {
  const [scheduledAt, setScheduledAt] = useState(
    toLocalDateTime(project.scheduledAt),
  );
  const [isSaving, setIsSaving] = useState(false);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scheduledAt) return;
    setIsSaving(true);
    await onSchedule(project.id, new Date(scheduledAt).toISOString());
    setIsSaving(false);
  };
  return (
    <article className="schedule-row">
      <div>
        <h3>{project.title}</h3>
        <p>{project.platform} · 已批准</p>
      </div>
      <form onSubmit={save}>
        <label>
          <span className="sr-only">{project.title} 的发布时间</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            required
          />
        </label>
        <button className="primary-button" disabled={isSaving}>
          {isSaving ? "保存中" : "安排"}
        </button>
      </form>
    </article>
  );
}
export default CatoWorkbench;
