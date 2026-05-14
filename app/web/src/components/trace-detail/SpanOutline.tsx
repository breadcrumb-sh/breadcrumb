import { useCallback, useEffect, useRef } from "react";
import type { SpanData } from "../../lib/span-utils";

// ── Types ──────────────────────────────────────────────────────────────────

export type OutlineEntry = {
  id: string;
  section: string; // "input" | "output" | "metadata" etc.
  role: string;    // "system" | "user" | "assistant" | "tool" | "json" | "text"
  label: string;   // display label — role name, tool name, or section name
  preview: string; // first ~60 chars of content for context
};

export type OutlineSection = {
  name: string;
  entries: OutlineEntry[];
};

// ── Role colors (dot + active text) ────────────────────────────────────────

const ROLE_DOT: Record<string, string> = {
  system: "bg-amber-500",
  user: "bg-zinc-400",
  assistant: "bg-purple-500",
  tool: "bg-blue-500",
  json: "bg-zinc-500",
  text: "bg-zinc-500",
};

// ── Helpers ────────────────────────────────────────────────────────────────

type ChatMessage = { role: string; content: unknown };
type ToolCallPart = Record<string, unknown> & { type: "tool-call"; toolCallId: string; toolName: string };

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

const MAX_PREVIEW = 50;

function extractPreview(content: unknown): string {
  if (typeof content === "string") {
    return content.replace(/\s+/g, " ").trim().slice(0, MAX_PREVIEW);
  }
  if (Array.isArray(content)) {
    for (const part of content as Array<Record<string, unknown>>) {
      if (part.type === "text" && typeof part.text === "string") {
        return (part.text as string).replace(/\s+/g, " ").trim().slice(0, MAX_PREVIEW);
      }
    }
  }
  const str = JSON.stringify(content);
  return str.replace(/\s+/g, " ").trim().slice(0, MAX_PREVIEW);
}

// ── Build outline from span data ──────────────────────────────────────────

export function buildOutlineSections(span: SpanData): OutlineSection[] {
  const sections: OutlineSection[] = [];

  function addSection(sectionName: string, content: string) {
    const entries: OutlineEntry[] = [];
    let idx = 0;
    const sectionId = sectionName.toLowerCase();

    let parsed: unknown = null;
    try { parsed = JSON.parse(content); } catch { /* not JSON */ }

    const messages = extractChatMessages(parsed);
    if (messages) {
      let i = 0;
      while (i < messages.length) {
        const msg = messages[i];
        const next = messages[i + 1];
        if (isPureToolCalls(msg) && next && isPureToolResults(next)) {
          const calls = msg.content as ToolCallPart[];
          const names = calls.map((c) => c.toolName);
          entries.push({
            id: `${sectionId}-${idx++}`,
            section: sectionId,
            role: "tool",
            label: names.length === 1 ? names[0] : `${names.length} tools`,
            preview: names.join(", "),
          });
          i += 2;
        } else {
          entries.push({
            id: `${sectionId}-${idx++}`,
            section: sectionId,
            role: msg.role,
            label: msg.role,
            preview: extractPreview(msg.content),
          });
          i++;
        }
      }
    } else {
      entries.push({
        id: `${sectionId}-${idx++}`,
        section: sectionId,
        role: parsed ? "json" : "text",
        label: sectionName,
        preview: extractPreview(parsed ?? content),
      });
    }

    sections.push({ name: sectionName, entries });
  }

  if (span.input) {
    addSection(span.type === "tool" ? "Arguments" : "Input", span.input);
  }
  if (span.output) {
    addSection(span.type === "tool" ? "Result" : "Output", span.output);
  }
  if (span.metadata && span.metadata !== "{}" && span.metadata !== "null") {
    addSection("Metadata", span.metadata);
  }

  return sections;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SpanOutline({
  sections,
  scrollRef,
}: {
  sections: OutlineSection[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const outlineRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);

  const totalEntries = sections.reduce((s, sec) => s + sec.entries.length, 0);

  // Track scroll position and highlight active entry via DOM
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    function onScroll() {
      const el = scrollRef.current;
      const outline = outlineRef.current;
      if (!el || !outline) return;

      const { scrollTop, clientHeight } = el;
      const mid = scrollTop + clientHeight / 2;

      let closest: string | null = null;
      let closestDist = Infinity;
      const blockEls = el.querySelectorAll("[data-minimap-id]");
      for (const blockEl of blockEls) {
        const rect = blockEl.getBoundingClientRect();
        const containerRect = el.getBoundingClientRect();
        const blockMid = rect.top - containerRect.top + scrollTop + rect.height / 2;
        const dist = Math.abs(blockMid - mid);
        if (dist < closestDist) {
          closestDist = dist;
          closest = blockEl.getAttribute("data-minimap-id");
        }
      }

      if (closest !== activeIdRef.current) {
        const prev = activeIdRef.current;
        activeIdRef.current = closest;
        if (prev) {
          const prevEl = outline.querySelector(`[data-outline-id="${prev}"]`);
          prevEl?.setAttribute("data-active", "false");
        }
        if (closest) {
          const nextEl = outline.querySelector(`[data-outline-id="${closest}"]`);
          nextEl?.setAttribute("data-active", "true");
        }
      }
    }

    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [scrollRef, sections]);

  const handleClick = useCallback(
    (entryId: string) => {
      const container = scrollRef.current;
      if (!container) return;
      const el = container.querySelector(`[data-minimap-id="${entryId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [scrollRef],
  );

  // Don't render if there's only 1 entry total — nothing to navigate
  if (totalEntries <= 1) return null;

  return (
    <div
      ref={outlineRef}
      className="group/outline absolute top-0 right-0 h-full z-10"
    >
      {/* Dark overlay — visible only when expanded, outside the clipped container */}
      <div className="absolute inset-y-0 right-full w-screen pointer-events-none bg-black/0 group-hover/outline:bg-black/20 transition-colors duration-150" />

      {/* Clipped container — controls the visible width */}
      <div className="h-full w-8 group-hover/outline:w-[130px] overflow-hidden transition-[width] duration-150 ease-out">
        {/* Outline rail — always 130px, parent clips it */}
        <div className="h-full w-[130px] border-l border-zinc-800/60 bg-zinc-950 overflow-y-auto overflow-x-hidden py-2">
        {sections.map((section, si) => (
          <div key={section.name} className={si > 0 ? "mt-1.5" : ""}>
            {/* Section header — text fades in, height stays constant */}
            <button
              onClick={() => section.entries[0] && handleClick(section.entries[0].id)}
              className="w-full text-left px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors whitespace-nowrap opacity-0 group-hover/outline:opacity-100 transition-opacity duration-150"
            >
              {section.name}
            </button>

            {/* Entries */}
            {section.entries.map((entry) => (
              <button
                key={entry.id}
                data-outline-id={entry.id}
                data-active="false"
                onClick={() => handleClick(entry.id)}
                className="group w-full text-left flex items-center gap-1.5 px-3 py-1 hover:bg-zinc-800/40 transition-colors rounded-sm whitespace-nowrap"
              >
                {/* Role dot */}
                <span
                  className={`shrink-0 size-1.5 rounded-full transition-opacity ${ROLE_DOT[entry.role] ?? ROLE_DOT.text} opacity-40 group-data-[active=true]:opacity-100`}
                />
                {/* Label + preview — fades in when expanded */}
                <span className="min-w-0 flex-1 opacity-0 group-hover/outline:opacity-100 transition-opacity duration-150">
                  <span className="block text-[11px] font-medium text-zinc-500 group-data-[active=true]:text-zinc-200 transition-colors leading-tight truncate">
                    {entry.label}
                  </span>
                  {entry.preview && (
                    <span className="block text-[11px] text-zinc-700 group-data-[active=true]:text-zinc-500 leading-tight truncate transition-colors">
                      {entry.preview}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
