import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { List } from "@phosphor-icons/react/List";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { X } from "@phosphor-icons/react/X";
import { createCodePlugin } from "@streamdown/code";
import { skipToken } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "../../../../hooks/useAuth";
import { usePageView } from "../../../../hooks/usePageView";
import { capture } from "../../../../lib/telemetry";
import { trpc } from "../../../../lib/trpc";
import { useRegisterSubMenuAction } from "../../../../components/layout/SubMenuContext";
import { PartRenderer } from "../../../../components/explore/ChatParts";
import { EmptyState } from "../../../../components/explore/EmptyState";
import { NoProviderState } from "../../../../components/explore/NoProviderState";
import { ExploreSidebar, groupByDate } from "../../../../components/explore/ExploreSidebar";
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
  usePageView("explore");
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const exploreId = Route.useSearch().id;
  const { isViewer, authenticated } = useAuth();

  const utils = trpc.useUtils();
  const aiProvider = trpc.aiProviders.get.useQuery({ projectId }, {
    enabled: authenticated,
  });
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
        capture("explore_created");
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

  // ── Sidebar callbacks ─────────────────────────────────────────────────────

  const onNewChat = useCallback(() => {
    navigate({ search: {} });
    setDrawerOpen(false);
  }, [navigate]);

  const onSelectChat = useCallback((id: string) => {
    navigate({ search: { id } });
    setDrawerOpen(false);
  }, [navigate]);

  const onDeleteChat = useCallback((id: string) => {
    deleteExplore.mutate({ id });
  }, [deleteExplore]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const sidebarContent = (
    <ExploreSidebar
      groups={groups}
      currentExploreId={exploreId}
      onNewChat={onNewChat}
      onSelectChat={onSelectChat}
      onDeleteChat={onDeleteChat}
      isViewer={isViewer}
    />
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
                  plugins={plugins}
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
