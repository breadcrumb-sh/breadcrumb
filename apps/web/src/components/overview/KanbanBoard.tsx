import { useEffect, useRef, useState } from "react";
import { DotsThree } from "@phosphor-icons/react/DotsThree";
import { Plus } from "@phosphor-icons/react/Plus";
import { X } from "@phosphor-icons/react/X";
import { useClickOutside } from "../../hooks/useClickOutside";

// ── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = "todo" | "in_progress" | "review" | "done" | "dismissed";

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  label?: string;
  summary?: string;
  details?: string[];
  createdAt?: string;
};

type Column = {
  id: TaskStatus;
  title: string;
  description: string;
  dotColor: string;
};

// ── Mock data ────────────────────────────────────────────────────────────────

const COLUMNS: Column[] = [
  {
    id: "todo",
    title: "Todo",
    description: "Queued for investigation",
    dotColor: "bg-emerald-400",
  },
  {
    id: "in_progress",
    title: "In Progress",
    description: "Agent is investigating",
    dotColor: "bg-amber-400",
  },
  {
    id: "review",
    title: "Review",
    description: "Awaiting developer review",
    dotColor: "bg-blue-400",
  },
  {
    id: "done",
    title: "Done",
    description: "Completed investigations",
    dotColor: "bg-violet-400",
  },
  {
    id: "dismissed",
    title: "Dismissed",
    description: "Not actionable",
    dotColor: "bg-zinc-400",
  },
];

const MOCK_TASKS: Task[] = [
  {
    id: "1",
    title: "High error rate on /api/chat endpoint",
    status: "todo",
    label: "Error spike",
    summary: "Error rate jumped from 0.2% to 4.8% over the last 2 hours on the /api/chat endpoint. Mostly 500 errors with timeout signatures.",
    details: [
      "First seen: 2026-03-28 14:22 UTC",
      "Affected traces: 342 of 7,120 (4.8%)",
      "Primary error: TimeoutError after 30s",
      "Correlated with: increased payload sizes in last deployment",
    ],
    createdAt: "2h ago",
  },
  {
    id: "2",
    title: "Latency regression in embeddings pipeline",
    status: "todo",
    label: "Latency",
    summary: "P95 latency for the embeddings pipeline increased from 220ms to 680ms after the latest model version update.",
    details: [
      "First seen: 2026-03-28 10:00 UTC",
      "P50: 180ms → 340ms",
      "P95: 220ms → 680ms",
      "Model: text-embedding-3-large",
    ],
    createdAt: "6h ago",
  },
  {
    id: "3",
    title: "Token usage anomaly on summarization chain",
    status: "todo",
    label: "Cost",
    summary: "Summarization chain is consuming 3x more tokens than expected. Average input tokens jumped from 2K to 6K per call.",
    details: [
      "Avg input tokens: 2,100 → 6,340",
      "Daily cost impact: +$42.50",
      "Affected chain: document-summarizer-v2",
    ],
    createdAt: "4h ago",
  },
  {
    id: "11",
    title: "Unexpected 500s on /api/completions",
    status: "todo",
    label: "Error spike",
    summary: "Intermittent 500 errors on the completions endpoint. Appears to be related to malformed function call responses from the model.",
    details: [
      "Error count: 28 in last hour",
      "Error type: JSONDecodeError in function_call parsing",
    ],
    createdAt: "1h ago",
  },
  {
    id: "12",
    title: "Memory usage spike during batch processing",
    status: "todo",
    label: "Reliability",
    summary: "Batch processing jobs are consuming 2x expected memory, causing OOM kills on smaller instances.",
    details: [
      "Peak memory: 3.8GB (expected: 2GB)",
      "OOM kills: 4 in last 24h",
    ],
    createdAt: "8h ago",
  },
  {
    id: "13",
    title: "Prompt caching miss rate increasing",
    status: "todo",
    label: "Cost",
    summary: "Cache hit rate dropped from 78% to 41%, leading to unnecessary re-computation and higher costs.",
    details: [
      "Cache hit rate: 78% → 41%",
      "Extra cost: ~$18/day",
    ],
    createdAt: "12h ago",
  },
  {
    id: "14",
    title: "Streaming response dropped mid-generation",
    status: "todo",
    label: "Error spike",
    summary: "Some streaming responses are being terminated before completion. Users seeing truncated outputs.",
    details: [
      "Affected: ~2% of streaming calls",
      "Avg truncation point: 60% of expected output",
    ],
    createdAt: "3h ago",
  },
  {
    id: "15",
    title: "P99 latency exceeding SLA on search endpoint",
    status: "todo",
    label: "Latency",
    summary: "Search endpoint P99 is at 4.2s, well above the 2s SLA target.",
    details: [
      "P99: 4.2s (SLA: 2s)",
      "P95: 1.8s",
      "Worst traces involve multi-hop retrieval",
    ],
    createdAt: "5h ago",
  },
  {
    id: "16",
    title: "Token count mismatch between estimate and actual",
    status: "todo",
    label: "Cost",
    summary: "Token estimator is underreporting by ~30%, causing budget alerts to fire late.",
    details: [
      "Estimated vs actual gap: 30%",
      "Tokenizer version may be outdated",
    ],
    createdAt: "1d ago",
  },
  {
    id: "17",
    title: "Rate limit errors from Anthropic API",
    status: "todo",
    label: "Error spike",
    summary: "Hitting 429 rate limits on Claude API during peak hours. No retry backoff configured.",
    details: [
      "429 errors: 156 in last 4h",
      "Peak window: 14:00–16:00 UTC",
    ],
    createdAt: "4h ago",
  },
  {
    id: "18",
    title: "Cold start latency on serverless functions",
    status: "todo",
    label: "Latency",
    summary: "Lambda cold starts adding 3-5s to first request latency after idle periods.",
    details: [
      "Cold start duration: 3–5s",
      "Idle threshold: ~15 min",
    ],
    createdAt: "1d ago",
  },
  {
    id: "4",
    title: "Investigate timeout pattern in RAG retrieval",
    status: "in_progress",
    label: "Reliability",
    summary: "RAG retrieval step is timing out when document corpus exceeds 10K chunks. Agent is analyzing query patterns and index performance.",
    details: [
      "Timeout threshold: 30s",
      "Affected queries: those hitting >10K chunk corpora",
      "Investigating: index fragmentation and query planning",
    ],
    createdAt: "1d ago",
  },
  {
    id: "5",
    title: "Validate fix for duplicate tool call billing",
    status: "review",
    label: "Cost",
    summary: "Duplicate tool calls were being billed twice. A deduplication fix was applied — needs verification that billing is now correct.",
    details: [
      "Root cause: retry logic not checking for idempotency",
      "Fix: added idempotency key to tool call requests",
      "Estimated savings: $23/day",
    ],
    createdAt: "2d ago",
  },
  {
    id: "6",
    title: "Check retry logic on embedding failures",
    status: "review",
    label: "Reliability",
    summary: "Embedding API failures were not being retried. Exponential backoff was added — review the implementation and confirm error rates have dropped.",
    details: [
      "Previous failure rate: 1.2%",
      "Current failure rate: 0.1% (after fix)",
      "Retry strategy: exponential backoff, max 3 attempts",
    ],
    createdAt: "3d ago",
  },
  {
    id: "7",
    title: "Repeated 429s from OpenAI on gpt-4o calls",
    status: "done",
    label: "Error spike",
    summary: "Rate limiting was caused by a misconfigured concurrency pool. Fixed by reducing max concurrent requests from 50 to 20.",
    details: [
      "Resolution: reduced concurrency pool size",
      "429 errors eliminated after fix",
    ],
    createdAt: "5d ago",
  },
  {
    id: "8",
    title: "Cost spike from duplicate tool calls",
    status: "done",
    label: "Cost",
    summary: "Identified and fixed duplicate tool call invocations in the agent loop. Saved approximately $45/day.",
    details: [
      "Root cause: missing dedup check in tool executor",
      "Cost reduction: ~$45/day",
    ],
    createdAt: "4d ago",
  },
  {
    id: "9",
    title: "Slow first-token latency on streaming responses",
    status: "done",
    label: "Latency",
    summary: "First-token latency reduced from 2.1s to 0.4s by enabling prompt caching and pre-warming connections.",
    details: [
      "Before: 2.1s TTFT",
      "After: 0.4s TTFT",
      "Fix: prompt caching + connection pre-warming",
    ],
    createdAt: "1w ago",
  },
  {
    id: "10",
    title: "Minor latency variance within normal range",
    status: "dismissed",
    label: "Latency",
    summary: "Latency variance flagged automatically but falls within normal operating range. No action needed.",
    details: [
      "Variance: ±15ms (within 2σ)",
      "No user-facing impact detected",
    ],
    createdAt: "2d ago",
  },
];

// ── Label colors ─────────────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, string> = {
  "Error spike": "text-red-400 bg-red-400/10 border-red-400/20",
  Latency: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  Cost: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  Reliability: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
};

function labelCls(label: string): string {
  return LABEL_COLORS[label] ?? "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
}

function statusLabel(status: TaskStatus): { label: string; dotColor: string } {
  const col = COLUMNS.find((c) => c.id === status);
  return { label: col?.title ?? status, dotColor: col?.dotColor ?? "bg-zinc-400" };
}

// ── Task detail sheet ───────────────────────────────────────────────────────

function TaskSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  useClickOutside(sheetRef, onClose);
  const { label: statusText, dotColor } = statusLabel(task.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 motion-preset-fade motion-duration-150" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="relative w-full sm:w-[560px] md:w-[640px] h-full bg-zinc-950 border-l border-zinc-800 overflow-y-auto motion-preset-slide-left motion-duration-200"
      >
        {/* Header */}
        <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 px-5 py-4 flex items-start justify-between gap-4 z-10">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">{task.title}</h2>
            <div className="flex items-center gap-3 mt-2">
              {task.label && (
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${labelCls(task.label)}`}>
                  {task.label}
                </span>
              )}
              <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                <span className={`size-2 rounded-full ${dotColor}`} />
                {statusText}
              </span>
              {task.createdAt && (
                <span className="text-xs text-zinc-500">{task.createdAt}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors shrink-0"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-6">
          {/* Summary */}
          {task.summary && (
            <section>
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Summary</h3>
              <p className="text-sm text-zinc-300 leading-relaxed">{task.summary}</p>
            </section>
          )}

          {/* Details */}
          {task.details && task.details.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Details</h3>
              <ul className="space-y-1.5">
                {task.details.map((d, i) => (
                  <li key={i} className="text-sm text-zinc-300 flex items-baseline gap-2">
                    <span className="size-1 rounded-full bg-zinc-600 shrink-0 mt-1.5" />
                    {d}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function KanbanBoard({ alignRef }: { alignRef?: React.RefObject<HTMLElement | null> }) {
  const [tasks] = useState<Task[]>(MOCK_TASKS);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [padLeft, setPadLeft] = useState(20);

  useEffect(() => {
    const measure = () => {
      if (!alignRef?.current || !scrollRef.current) return;
      const pad = alignRef.current.getBoundingClientRect().left - scrollRef.current.getBoundingClientRect().left;
      setPadLeft(Math.max(0, pad));
    };
    requestAnimationFrame(() => requestAnimationFrame(measure));
    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    if (scrollRef.current) ro.observe(scrollRef.current);
    if (alignRef?.current) ro.observe(alignRef.current);
    return () => ro.disconnect();
  }, [alignRef]);

  return (
    <>
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-2 h-full min-h-0 pr-5 sm:pr-8" style={{ paddingLeft: padLeft }}>
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              className="flex flex-col min-w-[280px] w-[320px] shrink-0 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 max-h-full"
            >
              {/* Column header */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${col.dotColor}`} />
                  <span className="text-sm font-medium text-zinc-100">
                    {col.title}
                  </span>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {colTasks.length}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                    <DotsThree size={16} weight="bold" />
                  </button>
                  <button className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                    <Plus size={16} weight="bold" />
                  </button>
                </div>
              </div>

              {/* Column description */}
              <p className="text-xs text-zinc-500 mb-3">{col.description}</p>

              {/* Cards */}
              <div className="flex flex-col gap-2 overflow-y-auto min-h-0 flex-1">
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left hover:border-zinc-700 transition-colors"
                  >
                    {task.label && (
                      <span
                        className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded border mb-2 ${labelCls(task.label)}`}
                      >
                        {task.label}
                      </span>
                    )}
                    <button
                      onClick={() => setSelectedTask(task)}
                      className="text-sm text-zinc-200 hover:text-zinc-100 hover:underline transition-colors text-left"
                    >
                      {task.title}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask && (
        <TaskSheet task={selectedTask} onClose={() => setSelectedTask(null)} />
      )}
    </>
  );
}
