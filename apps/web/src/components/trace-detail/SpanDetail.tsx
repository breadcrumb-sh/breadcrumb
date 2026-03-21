import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ChatsCircle } from "@phosphor-icons/react/ChatsCircle";
import { XCircle } from "@phosphor-icons/react/XCircle";
import { useMemo, useRef, useState } from "react";
import {
  formatCost,
  type SpanData,
} from "../../lib/span-utils";

const TYPE_TEXT_COLOR: Record<string, string> = {
  llm: "text-purple-400/70",
  tool: "text-blue-400/70",
  retrieval: "text-emerald-400/70",
};
import { fmtMs, spanDurationMs, formatTime } from "./helpers";
import { JsonTree } from "./JsonTree";
import { SpanOutline, buildOutlineSections } from "./SpanOutline";
import { Markdown } from "../common/Markdown";

// ── Chat message types ──────────────────────────────────────────────────────

type ChatMessage = { role: string; content: unknown };
type ToolCallPart = Record<string, unknown> & { type: "tool-call"; toolCallId: string; toolName: string };
type ToolResultPart = Record<string, unknown> & { type: "tool-result"; toolCallId: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

function isMessageArray(data: unknown): data is ChatMessage[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof (data[0] as Record<string, unknown>)?.role === "string"
  );
}

function extractChatMessages(data: unknown): ChatMessage[] | null {
  if (isMessageArray(data)) return data;
  if (
    data != null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    isMessageArray((data as Record<string, unknown>).messages)
  ) {
    return (data as Record<string, unknown>).messages as ChatMessage[];
  }
  return null;
}

function isPureToolCalls(msg: ChatMessage): boolean {
  return (
    msg.role === "assistant" &&
    Array.isArray(msg.content) &&
    (msg.content as Array<Record<string, unknown>>).every((p) => p.type === "tool-call")
  );
}

function isPureToolResults(msg: ChatMessage): boolean {
  return (
    msg.role === "tool" &&
    Array.isArray(msg.content) &&
    (msg.content as Array<Record<string, unknown>>).every((p) => p.type === "tool-result")
  );
}

// ── Text truncation ─────────────────────────────────────────────────────────

const TRUNCATE_LINES = 12;
const TRUNCATE_CHARS = 1500;

/** Find the truncation point: first limit hit wins. Returns null if no truncation needed. */
function truncationPoint(text: string): number | null {
  let nlCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (i >= TRUNCATE_CHARS) return i;
    if (text[i] === "\n") {
      nlCount++;
      if (nlCount >= TRUNCATE_LINES) return i;
    }
  }
  return null;
}

function TruncatedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const cutoff = truncationPoint(text);
  const [expanded, setExpanded] = useState(false);

  if (cutoff === null || expanded) {
    return (
      <div>
        <pre className={className}>
          {text}
        </pre>
        {cutoff !== null && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    );
  }

  const remaining = text.length - cutoff;
  const remainingLines = text.slice(cutoff).split("\n").length - 1;

  return (
    <div>
      <pre className={className}>
        {text.slice(0, cutoff)}
        <span className="text-zinc-500">…</span>
      </pre>
      <button
        onClick={() => setExpanded(true)}
        className="mt-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        Show more{remainingLines > 0 ? ` (${remainingLines} more lines)` : ` (${remaining.toLocaleString()} more chars)`}
      </button>
    </div>
  );
}

function TruncatedMarkdown({ text }: { text: string }) {
  const cutoff = truncationPoint(text);
  const [expanded, setExpanded] = useState(false);

  if (cutoff === null || expanded) {
    return (
      <div>
        <Markdown className="text-xs">{text}</Markdown>
        {cutoff !== null && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    );
  }

  const remaining = text.length - cutoff;
  const remainingLines = text.slice(cutoff).split("\n").length - 1;

  return (
    <div>
      <Markdown className="text-xs">{text.slice(0, cutoff) + "…"}</Markdown>
      <button
        onClick={() => setExpanded(true)}
        className="mt-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        Show more{remainingLines > 0 ? ` (${remainingLines} more lines)` : ` (${remaining.toLocaleString()} more chars)`}
      </button>
    </div>
  );
}

// ── Constants ───────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<
  string,
  { labelCls: string; borderCls: string; bgCls: string }
> = {
  system: {
    labelCls: "text-amber-400",
    borderCls: "border-amber-500/20",
    bgCls: "bg-amber-500/5",
  },
  user: {
    labelCls: "text-zinc-300",
    borderCls: "border-zinc-700",
    bgCls: "bg-zinc-800/40",
  },
  assistant: {
    labelCls: "text-purple-400",
    borderCls: "border-purple-500/20",
    bgCls: "bg-purple-500/5",
  },
  tool: {
    labelCls: "text-blue-400",
    borderCls: "border-blue-500/20",
    bgCls: "bg-blue-500/5",
  },
};

const SECTION_STORAGE_KEY = "bc:span-section-collapsed";

// ── Hooks ───────────────────────────────────────────────────────────────────

function useSectionCollapsed(label: string): [boolean, () => void] {
  const key = label.toLowerCase();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(SECTION_STORAGE_KEY);
      const map: Record<string, boolean> = stored ? JSON.parse(stored) : {};
      return map[key] ?? false;
    } catch {
      return false;
    }
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        const stored = localStorage.getItem(SECTION_STORAGE_KEY);
        const map: Record<string, boolean> = stored ? JSON.parse(stored) : {};
        map[key] = next;
        localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(map));
      } catch { /* ignore */ }
      return next;
    });
  }

  return [collapsed, toggle];
}

// ── Sub-components ──────────────────────────────────────────────────────────

const TEXT_CLS = "text-xs text-zinc-300 whitespace-pre-wrap break-words font-mono leading-relaxed";

function MessageContent({ content }: { content: unknown }) {
  if (typeof content === "string") {
    return <TruncatedMarkdown text={content} />;
  }
  if (Array.isArray(content)) {
    return (
      <div className="space-y-1">
        {(content as Array<Record<string, unknown>>).map((part, i) => {
          if (part.type === "text" && typeof part.text === "string") {
            return <TruncatedMarkdown key={i} text={part.text} />;
          }
          if (part.type === "tool-call") {
            const argsStr = JSON.stringify(part.input ?? part.args, null, 2);
            return (
              <div
                key={i}
                className="text-xs font-mono text-blue-300 bg-blue-500/10 rounded px-2 py-1"
              >
                <span className="text-blue-400 font-semibold">
                  tool_call:{" "}
                </span>
                <TruncatedText
                  text={`${String(part.toolName)}(${argsStr})`}
                  className="text-xs text-blue-300 whitespace-pre-wrap break-words font-mono leading-relaxed inline"
                />
              </div>
            );
          }
          if (part.type === "tool-result") {
            const resultValue = (part.output as Record<string, unknown>)?.value ?? part.output ?? part.result;
            const resultStr = JSON.stringify(resultValue, null, 2);
            return (
              <div
                key={i}
                className="text-xs font-mono text-emerald-300 bg-emerald-500/10 rounded px-2 py-1"
              >
                <span className="text-emerald-400 font-semibold">
                  {String(part.toolName ?? "tool_result")}:{" "}
                </span>
                <TruncatedText
                  text={resultStr}
                  className="text-xs text-emerald-300 whitespace-pre-wrap break-words font-mono leading-relaxed inline"
                />
              </div>
            );
          }
          return (
            <TruncatedText
              key={i}
              text={JSON.stringify(part, null, 2)}
              className="text-xs text-zinc-400 whitespace-pre-wrap break-words font-mono leading-relaxed"
            />
          );
        })}
      </div>
    );
  }
  return (
    <TruncatedText
      text={JSON.stringify(content, null, 2)}
      className={TEXT_CLS}
    />
  );
}

function ToolInteractionView({ calls, results }: { calls: ToolCallPart[]; results: ToolResultPart[] }) {
  const resultMap = new Map(results.map((r) => [r.toolCallId, r]));
  return (
    <div className="space-y-1.5">
      {calls.map((call, i) => {
        const result = resultMap.get(call.toolCallId);
        const resultValue = result
          ? ((result.output as Record<string, unknown>)?.value ?? result.output ?? result.result)
          : undefined;
        const argsStr = JSON.stringify(call.input ?? call.args, null, 2);
        return (
          <div key={i} className="rounded border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 space-y-1.5">
            <div className="text-xs font-mono text-blue-300">
              <span className="text-blue-400 font-semibold">tool_call: </span>
              <TruncatedText
                text={`${String(call.toolName)}(${argsStr})`}
                className="text-xs text-blue-300 whitespace-pre-wrap break-words font-mono leading-relaxed inline"
              />
            </div>
            {resultValue !== undefined && (
              <div className="text-xs font-mono text-emerald-300">
                <span className="text-emerald-400 font-semibold">result: </span>
                <TruncatedText
                  text={JSON.stringify(resultValue, null, 2)}
                  className="text-xs text-emerald-300 whitespace-pre-wrap break-words font-mono leading-relaxed inline"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChatMessagesView({ messages, idPrefix }: { messages: ChatMessage[]; idPrefix: string }) {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let blockIdx = 0;
  while (i < messages.length) {
    const msg = messages[i];
    const next = messages[i + 1];
    const blockId = `${idPrefix}-${blockIdx++}`;
    if (isPureToolCalls(msg) && next && isPureToolResults(next)) {
      nodes.push(
        <div key={i} data-minimap-id={blockId}>
          <ToolInteractionView
            calls={msg.content as ToolCallPart[]}
            results={next.content as ToolResultPart[]}
          />
        </div>
      );
      i += 2;
    } else {
      const styles = ROLE_STYLES[msg.role] ?? ROLE_STYLES.user;
      nodes.push(
        <div
          key={i}
          data-minimap-id={blockId}
          className={`rounded border ${styles.borderCls} ${styles.bgCls} px-3 py-2.5`}
        >
          <div
            className={`text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${styles.labelCls}`}
          >
            {msg.role}
          </div>
          <MessageContent content={msg.content} />
        </div>
      );
      i++;
    }
  }
  return <div className="space-y-2">{nodes}</div>;
}

function Section({ label, content, collapsible = false }: { label: string; content: string; collapsible?: boolean }) {
  const [collapsed, toggle] = useSectionCollapsed(label);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    /* not JSON */
  }

  const messages = extractChatMessages(parsed);
  const toolCallsOutput =
    !messages &&
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    typeof (parsed[0] as Record<string, unknown>)?.toolName === "string"
      ? (parsed as Array<Record<string, unknown>>)
      : null;
  const isOpen = !collapsible || !collapsed;

  const sectionId = label.toLowerCase();

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        onClick={collapsible ? toggle : undefined}
        className={`w-full flex items-center justify-between px-5 py-3 ${collapsible ? "cursor-pointer hover:bg-zinc-900/50 transition-colors" : "cursor-default"}`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        {collapsible && (
          <CaretDown
            size={11}
            className={`text-zinc-600 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
          />
        )}
      </button>
      {isOpen && (
        <div className="px-5 pb-4">
          {messages ? (
            <ChatMessagesView messages={messages} idPrefix={sectionId} />
          ) : toolCallsOutput ? (
            <div className="space-y-1" data-minimap-id={`${sectionId}-0`}>
              {toolCallsOutput.map((call, i) => {
                const argsStr = JSON.stringify(call.input ?? call.args, null, 2);
                return (
                  <div key={i} className="text-xs font-mono text-blue-300 bg-blue-500/10 rounded px-2 py-1">
                    <span className="text-blue-400 font-semibold">tool_call: </span>
                    <TruncatedText
                      text={`${String(call.toolName)}(${argsStr})`}
                      className="text-xs text-blue-300 whitespace-pre-wrap break-words font-mono leading-relaxed inline"
                    />
                  </div>
                );
              })}
            </div>
          ) : typeof parsed === "string" ? (
            <div data-minimap-id={`${sectionId}-0`}>
              <TruncatedMarkdown text={parsed} />
            </div>
          ) : (
            <div data-minimap-id={`${sectionId}-0`}>
              <JsonTree content={content} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function SpanDetail({ span, onAsk }: { span: SpanData; onAsk?: () => void }) {
  const dur = fmtMs(spanDurationMs(span.startTime, span.endTime));
  const totalCost = span.inputCostUsd + span.outputCostUsd;
  const scrollRef = useRef<HTMLDivElement>(null);

  const outlineSections = useMemo(() => buildOutlineSections(span), [span]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Span header */}
      <div className="px-5 py-3 border-b border-zinc-800 shrink-0 flex items-center gap-3 min-w-0">
        {/* Left: name + status icon */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-zinc-100 truncate">
            {span.name}
          </span>
          {span.status === "error" ? (
            <XCircle size={13} weight="fill" className="shrink-0 text-red-400" />
          ) : (
            <CheckCircle size={13} weight="fill" className="shrink-0 text-emerald-400" />
          )}
        </div>

        {/* Right: metadata + ask button */}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500 shrink-0">
          {span.type !== "custom" && (
            <span className={`font-medium ${TYPE_TEXT_COLOR[span.type] ?? "text-zinc-400/70"}`}>
              {span.type}
            </span>
          )}
          {span.model && <span className="font-mono">{span.model}</span>}
          <span>{dur}</span>
          {span.inputTokens > 0 && (
            <span>
              {span.inputTokens.toLocaleString()} in / {span.outputTokens.toLocaleString()} out
            </span>
          )}
          {totalCost > 0 && <span>{formatCost(totalCost)}</span>}
          <span className="font-mono">{formatTime(span.startTime)}</span>
          {onAsk && (
            <button
              onClick={onAsk}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
            >
              <ChatsCircle size={11} />
              Ask
            </button>
          )}
        </div>
      </div>
      {span.status === "error" && span.statusMessage && (
        <div className="px-5 py-2 border-b border-zinc-800 text-xs text-red-400 shrink-0">{span.statusMessage}</div>
      )}

      {/* Input / Output / Metadata + Outline */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={scrollRef} className="absolute inset-0 overflow-y-auto pr-8">
          {span.input && <Section label={span.type === "tool" ? "Arguments" : "Input"} content={span.input} collapsible />}
          {span.output && <Section label={span.type === "tool" ? "Result" : "Output"} content={span.output} collapsible />}
          {span.metadata &&
            span.metadata !== "{}" &&
            span.metadata !== "null" && (
              <Section label="Metadata" content={span.metadata} />
            )}
          {!span.input && !span.output && (
            <div className="flex items-center justify-center py-12 text-xs text-zinc-500">
              No input or output recorded
            </div>
          )}
        </div>
        <SpanOutline sections={outlineSections} scrollRef={scrollRef} />
      </div>
    </div>
  );
}
