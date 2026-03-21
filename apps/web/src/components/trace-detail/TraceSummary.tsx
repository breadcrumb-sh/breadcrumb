import { ArrowSquareOut } from "@phosphor-icons/react/ArrowSquareOut";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Markdown } from "../common/Markdown";
import { ChatInput } from "../explore/ChatInput";
import { PartRenderer } from "../explore/ChatParts";
import type { DisplayPart, StreamEvent, ChartSpec } from "@breadcrumb/server/trpc";
import { trpc } from "../../lib/trpc";
import { skipToken } from "@tanstack/react-query";

// -- Stream event accumulator (same as explore page) --------------------------

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
    case "tool-result":
      break;
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

// -- Props --------------------------------------------------------------------

type Props = {
  markdown: string;
  onSpanClick: (spanId: string) => void;
  projectId: string;
  traceId: string;
  isViewer: boolean;
  prefillAsk?: string;
  onClearAsk?: () => void;
};

// -- Component ----------------------------------------------------------------

export function TraceSummary({
  markdown,
  onSpanClick,
  projectId,
  traceId,
  isViewer,
  prefillAsk,
  onClearAsk,
}: Props) {
  const utils = trpc.useUtils();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // -- Exploration linked to this trace --------------------------------------

  const linkedExplore = trpc.explores.getByTraceId.useQuery({
    projectId,
    traceId,
  });
  const exploreId = linkedExplore.data?.id;
  const currentExplore = trpc.explores.get.useQuery(
    { id: exploreId! },
    { enabled: !!exploreId },
  );

  const createExplore = trpc.explores.create.useMutation({
    onSuccess: () => {
      utils.explores.getByTraceId.invalidate({ projectId, traceId });
      utils.explores.list.invalidate();
    },
  });

  // -- Subscription state ----------------------------------------------------

  const [subInput, setSubInput] = useState<{
    exploreId: string;
    projectId: string;
    prompt?: string;
  } | null>(null);
  const accRef = useRef<DisplayPart[]>([]);
  const [streamParts, setStreamParts] = useState<DisplayPart[] | null>(null);
  const retryRef = useRef(0);
  const doneRef = useRef(false);
  const streaming = subInput !== null;

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefillApplied = useRef(false);

  // Prefill input from ?ask= query param, then clear it from the URL
  useEffect(() => {
    if (prefillAsk && !prefillApplied.current) {
      prefillApplied.current = true;
      setInput(prefillAsk);
      onClearAsk?.();
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }
  }, [prefillAsk, onClearAsk]);

  // Check if generation is running for auto-reconnect
  const generating = trpc.explores.isGenerating.useQuery(
    exploreId ? { exploreId, projectId } : skipToken,
  );

  useEffect(() => {
    if (generating.data?.active && exploreId && !subInput) {
      doneRef.current = false;
      accRef.current = [];
      setStreamParts([]);
      setSubInput({ exploreId, projectId });
    }
  }, [generating.data?.active, exploreId, projectId, subInput]);

  // -- tRPC subscription -----------------------------------------------------

  trpc.explores.chat.useSubscription(subInput ?? skipToken, {
    onData(event: StreamEvent) {
      retryRef.current = 0;
      applyStreamEvent(event, accRef.current);
      setStreamParts([...accRef.current]);

      if (event.type === "done") {
        doneRef.current = true;
        setStreamParts(null);
        setSubInput(null);
        accRef.current = [];
        utils.explores.get.invalidate();
        utils.explores.getByTraceId.invalidate({ projectId, traceId });
      }
    },
    onError(err) {
      if (doneRef.current) return;

      const attempt = retryRef.current;
      if (attempt < 3 && subInput) {
        retryRef.current = attempt + 1;
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
        setSubInput(null);
        accRef.current = [];
      }
    },
  });

  // -- Scroll on new content -------------------------------------------------

  const savedParts = (currentExplore.data?.messages ?? []) as DisplayPart[];

  // Only auto-scroll for streaming content, not when the view first loads
  const isStreamingRef = useRef(false);
  useEffect(() => {
    if (streamParts !== null) isStreamingRef.current = true;
    else isStreamingRef.current = false;
  }, [streamParts]);

  useEffect(() => {
    if (isStreamingRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamParts]);

  // -- Exploration messages to render ----------------------------------------

  // Skip the initial analysis text part (it's already shown above as the analysis section).
  // The first saved message is the analysis markdown stored as { type: "text" }.
  const chatParts = savedParts.length > 0 && savedParts[0].type === "text"
    ? savedParts.slice(1)
    : savedParts;

  const exploreParts: DisplayPart[] = streamParts
    ? [...chatParts, ...streamParts]
    : chatParts;

  // -- Send ------------------------------------------------------------------

  const send = useCallback(
    async (prefill?: string) => {
      const prompt = (prefill ?? input).trim();
      if (!prompt || streaming) return;
      setInput("");

      let activeId = exploreId;
      if (!activeId) {
        try {
          const created = await createExplore.mutateAsync({
            projectId,
            traceId,
            name: prompt.length > 40 ? prompt.slice(0, 37) + "..." : prompt,
            initialMessages: [{ type: "text", content: markdown }],
          });
          activeId = created.id;
        } catch {
          return;
        }
      }

      retryRef.current = 0;
      doneRef.current = false;
      accRef.current = [{ type: "user", content: prompt }];
      setStreamParts([...accRef.current]);
      setSubInput({ exploreId: activeId, projectId, prompt });
    },
    [input, exploreId, projectId, traceId, streaming, createExplore, markdown],
  );

  // -- Helpers ---------------------------------------------------------------

  const starred = trpc.explores.listStarred.useQuery({ projectId });
  const starChart = trpc.explores.starChart.useMutation({
    onSuccess: () => utils.explores.listStarred.invalidate(),
  });
  const unstarChart = trpc.explores.unstarChart.useMutation({
    onSuccess: () => utils.explores.listStarred.invalidate(),
  });

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

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href?.startsWith("#span:")) {
        e.preventDefault();
        onSpanClick(href.slice(6));
      }
    },
    [onSpanClick],
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

  // -- Render ----------------------------------------------------------------

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-5 py-2 border-b border-zinc-800 shrink-0 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Analysis
        </span>
        {exploreId && (
          <Link
            to="/projects/$projectId/explore"
            params={{ projectId }}
            search={{ id: exploreId }}
            className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Open in Explore
            <ArrowSquareOut size={11} />
          </Link>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Analysis markdown */}
        <div className="px-5 py-4" onClick={handleClick}>
          <Markdown>{markdown}</Markdown>
        </div>

        {/* Exploration messages */}
        {exploreParts.length > 0 && (
          <div className="px-5 pb-4 space-y-4">
            <div className="border-t border-zinc-800/40 mt-2 pt-6" />
            {exploreParts.map((part, i) => (
              <div key={i} className={part.type !== "user" ? "max-w-3xl" : ""}>
                <PartRenderer
                  part={part}
                  isLast={i === exploreParts.length - 1}
                  streaming={streaming}
                  isStarred={isStarred}
                  onToggleStar={toggleStar}
                  projectId={projectId}
                />
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Chat input */}
      {!isViewer && (
        <div className="px-5 py-4 shrink-0">
          <ChatInput
            ref={inputRef}
            value={input}
            onChange={onInput}
            onKeyDown={onKeyDown}
            onSend={() => send()}
            placeholder="Ask about this trace..."
            streaming={streaming}
          />
        </div>
      )}
    </div>
  );
}
