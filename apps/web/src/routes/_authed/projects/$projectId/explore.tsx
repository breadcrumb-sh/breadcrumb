import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { List } from "@phosphor-icons/react/List";
import { X } from "@phosphor-icons/react/X";
import { skipToken } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useAuth } from "../../../../hooks/useAuth";
import { usePageView } from "../../../../hooks/usePageView";
import { capture } from "../../../../lib/telemetry";
import { trpc } from "../../../../lib/trpc";
import { useRegisterSubMenuAction } from "../../../../components/layout/SubMenuContext";
import { ChatInput } from "../../../../components/explore/ChatInput";
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
  const { authenticated } = useAuth();
  const isViewer = false; // All users are authenticated; org role check is server-side

  const utils = trpc.useUtils();
  const aiProvider = trpc.aiProviders.get.useQuery({ projectId }, {
    enabled: authenticated,
  });
  const explores = trpc.explores.list.useQuery({ projectId });
  const currentExplore = trpc.explores.get.useQuery(
    { id: exploreId! },
    { enabled: !!exploreId },
  );
  const linkedTraceId = currentExplore.data?.traceId as string | undefined;
  const linkedTrace = trpc.traces.get.useQuery(
    { projectId, traceId: linkedTraceId! },
    { enabled: !!linkedTraceId },
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
  const doneRef = useRef(false);
  const [reconnecting, setReconnecting] = useState(false);
  const streaming = subInput !== null;

  // Auto-reconnect to a running generation on mount/navigation
  useEffect(() => {
    if (generating.data?.active && exploreId && !subInput) {
      doneRef.current = false;
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
        // Clear streaming state immediately — don't wait for invalidation.
        // Deferring cleanup to .then() creates a race where the subscription
        // can close/error before subInput is cleared, causing infinite retries.
        doneRef.current = true;
        setStreamParts(null);
        setSubInput(null);
        accRef.current = [];
        if (event.name) utils.explores.list.invalidate();
        utils.explores.get.invalidate();
      }
    },
    onError(err) {
      // Don't retry if we already received the done event — the subscription
      // closing after done is expected, not an error.
      if (doneRef.current) return;

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
        setSubInput(null);
        accRef.current = [];
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
    doneRef.current = false;
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
          defaultDays: spec.defaultDays,
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
              {linkedTraceId && (
                <Link
                  to="/projects/$projectId/trace/$traceId"
                  params={{ projectId, traceId: linkedTraceId }}
                  className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors w-fit"
                >
                  <ArrowSquareOut size={11} />
                  {linkedTrace.data?.name ?? "View trace"}
                </Link>
              )}
              {parts.map((part, i) => (
                <PartRenderer
                  key={i}
                  part={part}
                  isLast={i === parts.length - 1}
                  streaming={streaming}
                  isStarred={isStarred}
                  onToggleStar={toggleStar}
                  projectId={projectId}
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
            <ChatInput
              value={input}
              onChange={onInput}
              onKeyDown={onKeyDown}
              onSend={() => send()}
              placeholder="Ask about your traces..."
              streaming={streaming}
              className="max-w-3xl mx-auto"
            />
          </div>
        )}
      </div>
    </main>
  );
}
