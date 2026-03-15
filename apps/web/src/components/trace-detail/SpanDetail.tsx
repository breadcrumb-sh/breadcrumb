import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { XCircle } from "@phosphor-icons/react/XCircle";
import { useState } from "react";
import {
  typeClass,
  formatCost,
  tryPrettyJson,
  type SpanData,
} from "../../lib/span-utils";
import { fmtMs, spanDurationMs, formatTime } from "./helpers";
import { JsonHighlight } from "./JsonHighlight";

// ── Chat message types ──────────────────────────────────────────────────────

type ChatMessage = { role: string; content: unknown };
type ToolCallPart = Record<string, unknown> & { type: "tool-call"; toolCallId: string; toolName: string };
type ToolResultPart = Record<string, unknown> & { type: "tool-result"; toolCallId: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

function isChatMessages(data: unknown): data is ChatMessage[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof (data[0] as Record<string, unknown>)?.role === "string"
  );
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

function MessageContent({ content }: { content: unknown }) {
  if (typeof content === "string") {
    return (
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
        {content}
      </pre>
    );
  }
  if (Array.isArray(content)) {
    return (
      <div className="space-y-1">
        {(content as Array<Record<string, unknown>>).map((part, i) => {
          if (part.type === "text" && typeof part.text === "string") {
            return (
              <pre
                key={i}
                className="text-xs text-zinc-300 whitespace-pre-wrap break-words font-mono leading-relaxed"
              >
                {part.text}
              </pre>
            );
          }
          if (part.type === "tool-call") {
            return (
              <div
                key={i}
                className="text-xs font-mono text-blue-300 bg-blue-500/10 rounded px-2 py-1"
              >
                <span className="text-blue-400 font-semibold">
                  tool_call:{" "}
                </span>
                {String(part.toolName)}(
                {JSON.stringify(part.input ?? part.args, null, 2)})
              </div>
            );
          }
          if (part.type === "tool-result") {
            const resultValue = (part.output as Record<string, unknown>)?.value ?? part.output ?? part.result;
            return (
              <div
                key={i}
                className="text-xs font-mono text-emerald-300 bg-emerald-500/10 rounded px-2 py-1"
              >
                <span className="text-emerald-400 font-semibold">
                  {String(part.toolName ?? "tool_result")}:{" "}
                </span>
                {JSON.stringify(resultValue, null, 2)}
              </div>
            );
          }
          return (
            <pre
              key={i}
              className="text-xs text-zinc-400 whitespace-pre-wrap break-words font-mono leading-relaxed"
            >
              {JSON.stringify(part, null, 2)}
            </pre>
          );
        })}
      </div>
    );
  }
  return (
    <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
      {JSON.stringify(content, null, 2)}
    </pre>
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
        return (
          <div key={i} className="rounded border border-blue-500/20 bg-blue-500/5 px-3 py-2.5 space-y-1.5">
            <div className="text-xs font-mono text-blue-300">
              <span className="text-blue-400 font-semibold">tool_call: </span>
              {String(call.toolName)}({JSON.stringify(call.input ?? call.args, null, 2)})
            </div>
            {resultValue !== undefined && (
              <div className="text-xs font-mono text-emerald-300">
                <span className="text-emerald-400 font-semibold">result: </span>
                {JSON.stringify(resultValue, null, 2)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChatMessagesView({ messages }: { messages: ChatMessage[] }) {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    const next = messages[i + 1];
    if (isPureToolCalls(msg) && next && isPureToolResults(next)) {
      nodes.push(
        <ToolInteractionView
          key={i}
          calls={msg.content as ToolCallPart[]}
          results={next.content as ToolResultPart[]}
        />
      );
      i += 2;
    } else {
      const styles = ROLE_STYLES[msg.role] ?? ROLE_STYLES.user;
      nodes.push(
        <div
          key={i}
          className={`rounded border ${styles.borderCls} ${styles.bgCls} px-3 py-2.5`}
        >
          <div
            className={`text-[10px] font-semibold uppercase tracking-widest mb-1.5 ${styles.labelCls}`}
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

  const messages = isChatMessages(parsed) ? parsed : null;
  const toolCallsOutput =
    !messages &&
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    typeof (parsed[0] as Record<string, unknown>)?.toolName === "string"
      ? (parsed as Array<Record<string, unknown>>)
      : null;
  const isOpen = !collapsible || !collapsed;

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        onClick={collapsible ? toggle : undefined}
        className={`w-full flex items-center justify-between px-5 py-3 ${collapsible ? "cursor-pointer hover:bg-zinc-900/50 transition-colors" : "cursor-default"}`}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
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
            <ChatMessagesView messages={messages} />
          ) : toolCallsOutput ? (
            <div className="space-y-1">
              {toolCallsOutput.map((call, i) => (
                <div key={i} className="text-xs font-mono text-blue-300 bg-blue-500/10 rounded px-2 py-1">
                  <span className="text-blue-400 font-semibold">tool_call: </span>
                  {String(call.toolName)}({JSON.stringify(call.input ?? call.args, null, 2)})
                </div>
              ))}
            </div>
          ) : typeof parsed === "string" ? (
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
              {parsed}
            </pre>
          ) : (
            <JsonHighlight content={tryPrettyJson(content)} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function SpanDetail({ span }: { span: SpanData }) {
  const dur = fmtMs(spanDurationMs(span.startTime, span.endTime));
  const totalCost = span.inputCostUsd + span.outputCostUsd;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Span header */}
      <div className="px-5 py-4 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-semibold text-zinc-100">
            {span.name}
          </span>
          {span.type !== "custom" && (
            <span
              className={`inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${typeClass(span.type)}`}
            >
              {span.type}
            </span>
          )}
          {span.status === "error" ? (
            <span className="inline-flex items-center gap-1 text-xs text-red-400">
              <XCircle size={12} weight="fill" /> error
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle size={12} weight="fill" /> ok
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-[11px] text-zinc-500 flex-wrap">
          {span.model && <span className="font-mono">{span.model}</span>}
          <span>{dur}</span>
          {span.inputTokens > 0 && (
            <span>
              {span.inputTokens.toLocaleString()} in /{" "}
              {span.outputTokens.toLocaleString()} out
            </span>
          )}
          {totalCost > 0 && <span>{formatCost(totalCost)}</span>}
        </div>
        <div className="mt-1.5 text-[10px] text-zinc-600 font-mono">
          {formatTime(span.startTime)}
        </div>
        {span.status === "error" && span.statusMessage && (
          <div className="mt-2 text-xs text-red-400">{span.statusMessage}</div>
        )}
      </div>

      {/* Input / Output / Metadata */}
      <div className="flex-1 overflow-y-auto">
        {span.input && <Section label={span.type === "tool" ? "Arguments" : "Input"} content={span.input} collapsible />}
        {span.output && <Section label={span.type === "tool" ? "Result" : "Output"} content={span.output} collapsible />}
        {span.metadata &&
          span.metadata !== "{}" &&
          span.metadata !== "null" && (
            <Section label="Metadata" content={span.metadata} />
          )}
        {!span.input && !span.output && (
          <div className="flex items-center justify-center py-12 text-xs text-zinc-600">
            No input or output recorded
          </div>
        )}
      </div>
    </div>
  );
}
