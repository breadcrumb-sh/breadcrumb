import {
  Brain,
  ChartBar,
  Check,
  CircleNotch,
  Code,
  Copy,
  Database,
  List,
  PaperPlaneTilt,
  Plus,
  Star,
  X,
} from "@phosphor-icons/react";
import { renderMermaidSVG } from "beautiful-mermaid";
import { createCodePlugin } from "@streamdown/code";
import { codeToHtml } from "shiki";
import { skipToken } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Streamdown } from "streamdown";
import { z } from "zod";
import { ExplorationChart, VIZ_COLORS } from "../../../../components/traces/ExplorationChart";
import { useAuth } from "../../../../hooks/useAuth";
import { useTheme } from "../../../../hooks/useTheme";
import { trpc } from "../../../../lib/trpc";
import { useRegisterSubMenuAction } from "../../../../components/SubMenuContext";
import type {
  ChartSpec,
  DisplayPart,
  StreamEvent,
} from "@breadcrumb/server/trpc";

// ── Route ──────────────────────────────────────────────────────────────────────

const searchSchema = z.object({ id: z.string().optional() });

export const Route = createFileRoute("/_authed/projects/$projectId/explore")({
  validateSearch: searchSchema,
  component: ExplorePage,
});

const codePlugin = createCodePlugin({
  themes: ["github-light", "github-dark"],
});

const plugins = { code: codePlugin };

// ── Date grouping helper ────────────────────────────────────────────────────

function groupByDate<T extends { updatedAt: Date | string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const last7 = new Date(todayStart);
  last7.setDate(last7.getDate() - 7);
  const last30 = new Date(todayStart);
  last30.setDate(last30.getDate() - 30);

  const buckets: Record<string, T[]> = {};
  const order = ["Today", "Yesterday", "Last 7 days", "Last 30 days", "Older"];
  for (const label of order) buckets[label] = [];

  for (const item of items) {
    const d =
      item.updatedAt instanceof Date
        ? item.updatedAt
        : new Date(item.updatedAt);
    if (d >= todayStart) buckets["Today"].push(item);
    else if (d >= yesterdayStart) buckets["Yesterday"].push(item);
    else if (d >= last7) buckets["Last 7 days"].push(item);
    else if (d >= last30) buckets["Last 30 days"].push(item);
    else buckets["Older"].push(item);
  }

  return order
    .filter((label) => buckets[label].length > 0)
    .map((label) => ({ label, items: buckets[label] }));
}

// ── Custom Streamdown components ────────────────────────────────────────────

const MERMAID_THEMES = {
  dark: {
    bg: "transparent", fg: "#e9e9ea", line: "#909091", accent: "#58508d",
    muted: "#6c6c6d", surface: "#282829", border: "#363637",
  },
  light: {
    bg: "transparent", fg: "#1d1d1e", line: "#909091", accent: "#58508d",
    muted: "#6c6c6d", surface: "#f0f0f0", border: "#c5c5c6",
  },
} as const;

function useHighlightedHtml(code: string, lang: string) {
  const { theme } = useTheme();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    codeToHtml(code, {
      lang,
      theme: theme === "light" ? "github-light" : "github-dark",
    }).then(setHtml);
  }, [code, lang, theme]);

  return html;
}

function MermaidDiagram({ code }: { code: string }) {
  const { theme } = useTheme();
  const svg = useMemo(
    () => {
      try {
        return renderMermaidSVG(code, {
          ...MERMAID_THEMES[theme],
          font: "Geist, system-ui, sans-serif",
          transparent: true,
          padding: 24,
        });
      } catch {
        return null;
      }
    },
    [code, theme],
  );

  if (!svg) {
    return (
      <div className="my-3 rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 px-4 py-6 text-xs text-zinc-500">
        Failed to render diagram
      </div>
    );
  }

  // Parse SVG dimensions to decide layout
  const widthMatch = svg.match(/width="(\d+(?:\.\d+)?)"/);
  const heightMatch = svg.match(/height="(\d+(?:\.\d+)?)"/);
  const svgWidth = widthMatch ? parseFloat(widthMatch[1]) : 0;
  const svgHeight = heightMatch ? parseFloat(heightMatch[1]) : 0;
  const isWide = svgWidth > 0 && svgHeight > 0 && svgWidth / svgHeight > 2.5;

  return (
    <div
      className={
        isWide
          ? "my-3 overflow-x-auto [&_svg]:h-auto [&_svg]:min-w-[600px]"
          : "my-3 flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
      }
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function CodeBlock({ language, children }: { language: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  const html = useHighlightedHtml(text, language || "text");

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-4 border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/60 border-b border-zinc-800">
        <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
          {language || "code"}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {html ? (
        <div
          className="overflow-x-auto px-3 py-3 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_code]:!bg-transparent"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto px-3 py-3 text-[13px] font-mono text-zinc-300 leading-relaxed">
          <code>{children}</code>
        </pre>
      )}
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  return "";
}

const sdComponents = {
  code: ({ className, children, ...rest }: React.ComponentProps<"code"> & { "data-block"?: boolean }) => {
    const isBlock = "data-block" in rest;
    const lang = className?.match(/language-(\S+)/)?.[1] ?? "";

    if (isBlock) {
      if (lang === "mermaid") {
        return <MermaidDiagram code={extractText(children)} />;
      }
      return <CodeBlock language={lang}>{children}</CodeBlock>;
    }

    return (
      <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[13px] font-mono text-viz-7">
        {children}
      </code>
    );
  },
  table: (p: React.ComponentProps<"table">) => (
    <div className="my-4 overflow-x-auto border border-zinc-800 bg-zinc-900/50">
      <table className="w-full text-xs" {...p} />
    </div>
  ),
  thead: (p: React.ComponentProps<"thead">) => (
    <thead className="bg-zinc-800/60" {...p} />
  ),
  th: (p: React.ComponentProps<"th">) => (
    <th
      className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium tracking-wide text-zinc-400 uppercase border-b border-zinc-800"
      {...p}
    />
  ),
  td: (p: React.ComponentProps<"td">) => (
    <td
      className="whitespace-nowrap px-3 py-1.5 text-zinc-300 border-b border-zinc-800/50 tabular-nums"
      {...p}
    />
  ),
  tr: (p: React.ComponentProps<"tr">) => (
    <tr className="hover:bg-zinc-800/30 transition-colors" {...p} />
  ),
};

// ── Stream event → DisplayPart accumulator ──────────────────────────────────

function applyStreamEvent(event: StreamEvent, parts: DisplayPart[]) {
  switch (event.type) {
    case "text-delta": {
      const last = parts[parts.length - 1];
      if (last?.type === "text") {
        last.content += event.content;
      } else {
        if (last?.type === "tool-loading") parts.pop();
        parts.push({ type: "text", content: event.content });
      }
      break;
    }
    case "tool-call": {
      if (parts[parts.length - 1]?.type === "tool-loading") parts.pop();
      parts.push({ type: "tool-loading", toolName: event.toolName });
      break;
    }
    case "tool-result": {
      // Don't remove tool-loading here — let the next text-delta, tool-call,
      // or chart event remove it so the spinner stays visible until real
      // content replaces it.
      break;
    }
    case "chart": {
      if (parts[parts.length - 1]?.type === "tool-loading") parts.pop();
      parts.push({ type: "chart", spec: event.spec, data: event.data });
      break;
    }
    case "error": {
      if (parts[parts.length - 1]?.type === "tool-loading") parts.pop();
      parts.push({ type: "text", content: `Error: ${event.message}` });
      break;
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

function ExplorePage() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const exploreId = Route.useSearch().id;
  const { isViewer } = useAuth();

  const utils = trpc.useUtils();
  const aiProvider = trpc.aiProviders.get.useQuery({ projectId });
  const explores = trpc.explores.list.useQuery({ projectId });
  const currentExplore = trpc.explores.get.useQuery(
    { id: exploreId! },
    { enabled: !!exploreId },
  );
  const starred = trpc.explores.listStarred.useQuery({ projectId });
  const generating = trpc.explores.isGenerating.useQuery(
    exploreId ? { exploreId, projectId } : skipToken,
  );

  const createExplore = trpc.explores.create.useMutation({
    onSuccess: (d) => {
      utils.explores.list.invalidate();
      navigate({ search: { id: d.id } });
    },
  });
  const deleteExplore = trpc.explores.delete.useMutation({
    onSuccess: () => {
      utils.explores.list.invalidate();
      navigate({ search: {} });
    },
  });
  const starChart = trpc.explores.starChart.useMutation({
    onSuccess: () => utils.explores.listStarred.invalidate(),
  });
  const unstarChart = trpc.explores.unstarChart.useMutation({
    onSuccess: () => utils.explores.listStarred.invalidate(),
  });

  // ── Subscription state ──────────────────────────────────────────────────────

  const [subInput, setSubInput] = useState<{
    exploreId: string;
    projectId: string;
    prompt?: string;
  } | null>(null);
  const accRef = useRef<DisplayPart[]>([]);
  const [streamParts, setStreamParts] = useState<DisplayPart[] | null>(null);
  const retryRef = useRef(0);
  const [reconnecting, setReconnecting] = useState(false);
  const streaming = subInput !== null;

  // Auto-reconnect to a running generation on mount/navigation
  useEffect(() => {
    if (generating.data?.active && exploreId && !subInput) {
      accRef.current = [];
      setStreamParts([]);
      setSubInput({ exploreId, projectId });
    }
  }, [generating.data?.active, exploreId, projectId, subInput]);

  const [input, setInput] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const drawerIcon = useMemo<ReactNode>(() => <List size={14} />, []);
  useRegisterSubMenuAction("Chats", openDrawer, drawerIcon);
  const bottomRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(
    () => groupByDate(explores.data ?? []),
    [explores.data],
  );

  // ── tRPC subscription ─────────────────────────────────────────────────────
  // The server runs AI generation as a background job. This subscription is
  // a thin consumer that replays past events and tails new ones. On disconnect
  // and reconnect, the server replays what was missed.

  const MAX_RETRIES = 3;

  trpc.explores.chat.useSubscription(subInput ?? skipToken, {
    onData(event: StreamEvent) {
      retryRef.current = 0;
      setReconnecting(false);
      applyStreamEvent(event, accRef.current);
      setStreamParts([...accRef.current]);

      if (event.type === "done") {
        if (event.name) utils.explores.list.invalidate();
        utils.explores.get.invalidate().then(() => {
          setStreamParts(null);
          setSubInput(null);
          accRef.current = [];
        });
      }
    },
    onError(err) {
      const attempt = retryRef.current;

      if (attempt < MAX_RETRIES && subInput) {
        retryRef.current = attempt + 1;
        setReconnecting(true);
        // Reset accumulator — the server replays all events on reconnect
        accRef.current = [];
        setStreamParts([]);
        const prev = subInput;
        setSubInput(null);
        setTimeout(() => setSubInput(prev), 1000 + attempt * 1000);
      } else {
        accRef.current.push({
          type: "text",
          content: `Error: ${err.message}`,
        });
        setStreamParts([...accRef.current]);
        setReconnecting(false);
        setTimeout(() => {
          setSubInput(null);
          accRef.current = [];
        }, 0);
      }
    },
  });

  // Scroll on any change to the rendered parts
  const savedParts = (currentExplore.data?.messages ?? []) as DisplayPart[];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [savedParts, streamParts]);

  // ── What to render ─────────────────────────────────────────────────────────

  const parts: DisplayPart[] = streamParts
    ? [...savedParts, ...streamParts]
    : savedParts;

  // ── Send message ───────────────────────────────────────────────────────────

  const send = useCallback(async (prefill?: string) => {
    const prompt = (prefill ?? input).trim();
    if (!prompt || streaming) return;

    setInput("");

    // Auto-create explore if none selected
    let activeId = exploreId;
    if (!activeId) {
      try {
        const created = await createExplore.mutateAsync({ projectId });
        activeId = created.id;
        navigate({ search: { id: activeId } });
      } catch {
        return;
      }
    }

    // Init accumulator with user message and start subscription
    retryRef.current = 0;
    accRef.current = [{ type: "user", content: prompt }];
    setStreamParts([...accRef.current]);
    setSubInput({ exploreId: activeId, projectId, prompt });
  }, [input, exploreId, projectId, streaming, createExplore, navigate]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const isStarred = useCallback(
    (sql: string) => starred.data?.some((s) => s.sql === sql) ?? false,
    [starred.data],
  );

  const toggleStar = useCallback(
    (spec: ChartSpec) => {
      if (!exploreId) return;
      const existing = starred.data?.find((s) => s.sql === spec.sql);
      if (existing) {
        unstarChart.mutate({ id: existing.id });
      } else {
        starChart.mutate({
          exploreId,
          projectId,
          title: spec.title,
          chartType: spec.chartType,
          sql: spec.sql,
          xKey: spec.xKey,
          yKeys: spec.yKeys,
          legend: spec.legend,
        });
      }
    },
    [exploreId, projectId, starred.data, starChart, unstarChart],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const sidebarContent = (
    <>
      {!isViewer && (
        <div className="p-3">
          <button
            onClick={() => {
              navigate({ search: {} });
              setDrawerOpen(false);
            }}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Plus size={14} />
            New chat
          </button>
        </div>
      )}
      <nav className="px-2 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-2 pt-3 pb-1 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
              {group.label}
            </p>
            {group.items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  navigate({ search: { id: item.id } });
                  setDrawerOpen(false);
                }}
                className={`group flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm transition-colors ${
                  item.id === exploreId
                    ? "bg-zinc-800/50 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200"
                }`}
              >
                <span className="truncate">{item.name}</span>
                {!isViewer && (
                  <X
                    size={14}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteExplore.mutate({ id: item.id });
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <main className="flex min-h-[calc(100vh-101px)] overflow-x-clip">
      {/* Desktop sidebar */}
      <aside className="hidden sm:block w-56 shrink-0 sticky top-[101px] h-[calc(100vh-101px)] overflow-y-auto border-r border-zinc-800 bg-zinc-950">
        {sidebarContent}
      </aside>

      {/* Mobile drawer backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 sm:hidden transition-opacity duration-300 ${
          drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* Mobile drawer panel */}
      <div
        className={`fixed left-0 top-0 z-50 h-full w-72 overflow-y-auto border-r border-zinc-800 bg-zinc-950 sm:hidden transition-transform duration-300 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-3 pt-3">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Chats</span>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {sidebarContent}
      </div>

      {/* Chat area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-[calc(100vh-101px)]">
        {/* Messages */}
        <div className="flex-1 flex flex-col px-5 sm:px-8">
          {parts.length === 0 && !streaming && aiProvider.data === null ? (
            <NoProviderState projectId={projectId} />
          ) : parts.length === 0 && !streaming ? (
            <EmptyState onSend={send} />
          ) : (
            <div className="max-w-3xl w-full mx-auto py-6 space-y-5">
              {parts.map((part, i) => (
                <PartRenderer
                  key={i}
                  part={part}
                  isLast={i === parts.length - 1}
                  streaming={streaming}
                  isStarred={isStarred}
                  onToggleStar={toggleStar}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {!isViewer && aiProvider.data !== null && (
          <div className="sticky bottom-0 z-10 bg-zinc-950 px-5 sm:px-8 py-3">
            {reconnecting && (
              <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 text-xs text-zinc-500">
                <CircleNotch size={12} className="animate-spin" />
                Reconnecting...
              </div>
            )}
            <div className="max-w-3xl mx-auto relative">
              <textarea
                value={input}
                onChange={onInput}
                onKeyDown={onKeyDown}
                placeholder="Ask about your traces..."
                disabled={streaming}
                rows={1}
                className="w-full resize-none overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 pr-12 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 disabled:opacity-50 transition-colors"
              />
              <button
                onClick={() => send()}
                disabled={streaming || !input.trim()}
                className="absolute right-2 bottom-2 p-2 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {streaming ? (
                  <CircleNotch size={18} className="animate-spin" />
                ) : (
                  <PaperPlaneTilt size={18} />
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// ── No provider state ────────────────────────────────────────────────────────

function NoProviderState({ projectId }: { projectId: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto gap-5 py-12">
      <div className="flex items-center justify-center w-12 h-12 rounded-full border border-zinc-800 bg-zinc-900">
        <Brain size={22} className="text-zinc-500" />
      </div>
      <div className="text-center space-y-1.5">
        <h2 className="text-base font-medium text-zinc-200">
          AI provider not configured
        </h2>
        <p className="text-sm text-zinc-500 leading-relaxed">
          Set up an AI provider in your project settings to start exploring traces with natural language.
        </p>
      </div>
      <Link
        to="/projects/$projectId/settings"
        params={{ projectId }}
        search={{ tab: "ai" }}
        className="text-sm text-zinc-400 underline hover:text-zinc-200 transition-colors"
      >
        Configure AI provider
      </Link>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    label: "Trace volume",
    prompt: "Show me daily trace volume over the last 30 days",
  },
  {
    label: "Slowest spans",
    prompt: "What are the top 10 slowest spans by p95 duration?",
  },
  {
    label: "Error breakdown",
    prompt: "Show error rate by trace name as a bar chart",
  },
  {
    label: "Cost trends",
    prompt: "Chart my daily LLM cost over the past 2 weeks",
  },
  {
    label: "Architecture",
    prompt: "Draw a mermaid diagram of my most common trace flow",
  },
  {
    label: "Model usage",
    prompt: "Compare token usage across different models",
  },
];

function EmptyState({ onSend }: { onSend: (prompt: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-lg mx-auto gap-8 py-12">
      <div className="text-center space-y-2">
        <h2 className="text-base font-medium text-zinc-200">
          Explore your traces
        </h2>
        <p className="text-sm text-zinc-500 leading-relaxed">
          Ask questions in plain English. Query your data, generate charts, or visualize architecture with mermaid diagrams.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 w-full">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => onSend(ex.prompt)}
            className="text-left px-3 py-2.5 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/30 transition-colors group"
          >
            <span className="text-xs font-medium text-zinc-300 group-hover:text-zinc-100">
              {ex.label}
            </span>
            <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-1">
              {ex.prompt}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Chart part with SQL modal ────────────────────────────────────────────────

function ChartPart({
  spec,
  data,
  isStarred: starred,
  onToggleStar,
}: {
  spec: ChartSpec;
  data: Record<string, unknown>[];
  isStarred: boolean;
  onToggleStar: () => void;
}) {
  const [showSql, setShowSql] = useState(false);

  return (
    <>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <ChartBar size={14} className="text-zinc-500" />
            {spec.title}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setShowSql(true)}
              className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors"
              title="View SQL"
            >
              <Code size={14} className="text-zinc-500 hover:text-zinc-300" />
            </button>
            <button
              onClick={onToggleStar}
              className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors"
              title={starred ? "Remove star" : "Star chart"}
            >
              <Star
                size={14}
                weight={starred ? "fill" : "regular"}
                className={
                  starred ? "text-amber-400" : "text-zinc-500 hover:text-zinc-300"
                }
              />
            </button>
          </div>
        </div>
        {spec.yKeys.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {spec.yKeys.map((key, i) => {
              const label = spec.legend?.find((l) => l.key === key)?.label ?? key;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400"
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: VIZ_COLORS[i % VIZ_COLORS.length] }}
                  />
                  {label}
                </span>
              );
            })}
          </div>
        )}
        {data.length > 0 ? (
          <ExplorationChart
            chartType={spec.chartType}
            xKey={spec.xKey}
            yKeys={spec.yKeys}
            legend={spec.legend}
            data={data}
          />
        ) : (
          <div className="flex items-center justify-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 py-12">
            <p className="text-xs text-zinc-500">No data returned by query</p>
          </div>
        )}
      </div>

      {showSql && <SqlModal sql={spec.sql} onClose={() => setShowSql(false)} />}
    </>
  );
}

function SqlModal({ sql, onClose }: { sql: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const html = useHighlightedHtml(sql.trim(), "sql");

  const copy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 border border-zinc-800 bg-zinc-900 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800/60 border-b border-zinc-800">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
            SQL
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={onClose}
              className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        {html ? (
          <div
            className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="overflow-x-auto px-4 py-4 text-[13px] font-mono text-zinc-300 leading-relaxed">
            <code>{sql.trim()}</code>
          </pre>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Part renderer ──────────────────────────────────────────────────────────────

function PartRenderer({
  part,
  isLast,
  streaming,
  isStarred,
  onToggleStar,
}: {
  part: DisplayPart;
  isLast: boolean;
  streaming: boolean;
  isStarred: (sql: string) => boolean;
  onToggleStar: (spec: ChartSpec) => void;
}) {
  switch (part.type) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-700/50 px-4 py-2.5 text-sm text-zinc-100 whitespace-pre-wrap">
            {part.content}
          </div>
        </div>
      );

    case "text":
      return (
        <div className="text-sm text-zinc-300 [&_h1]:text-zinc-100 [&_h2]:text-zinc-100 [&_h3]:text-zinc-100 [&_h4]:text-zinc-100 [&_strong]:text-zinc-200">
          <Streamdown
            mode={isLast && streaming ? "streaming" : "static"}
            plugins={plugins}
            components={sdComponents}
          >
            {part.content}
          </Streamdown>
        </div>
      );

    case "chart":
      return (
        <ChartPart
          spec={part.spec}
          data={part.data}
          isStarred={isStarred(part.spec.sql)}
          onToggleStar={() => onToggleStar(part.spec)}
        />
      );

    case "tool-loading":
      return (
        <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
          <CircleNotch size={12} className="animate-spin" />
          <Database size={12} />
          {part.toolName === "display_chart"
            ? "Generating chart..."
            : "Running query..."}
        </div>
      );
  }
}
