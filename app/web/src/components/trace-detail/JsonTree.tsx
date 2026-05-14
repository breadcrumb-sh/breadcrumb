import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { useCallback, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

// ── Constants ──────────────────────────────────────────────────────────────

/** Auto-expand nodes up to this depth */
const AUTO_EXPAND_DEPTH = 2;

/** Max string length before truncating inline */
const MAX_INLINE_STRING = 120;

// ── Value rendering ────────────────────────────────────────────────────────

function StringValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > MAX_INLINE_STRING;
  const display = isLong && !expanded ? value.slice(0, MAX_INLINE_STRING) : value;

  return (
    <span className="text-emerald-400">
      &quot;
      <span className="whitespace-pre-wrap break-all">{display}</span>
      {isLong && !expanded && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="text-zinc-500 hover:text-zinc-300 ml-1 text-[11px]"
        >
          …{value.length} chars
        </button>
      )}
      &quot;
    </span>
  );
}

function PrimitiveValue({ value }: { value: JsonPrimitive }) {
  if (value === null) {
    return <span className="text-zinc-500 italic">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-amber-400">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-blue-400">{String(value)}</span>;
  }
  return <StringValue value={value} />;
}

// ── Collection summary (collapsed preview) ─────────────────────────────────

function collapsedSummary(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length <= 3) {
      return `{ ${keys.join(", ")} }`;
    }
    return `{${keys.length} keys}`;
  }
  return "";
}

// ── Tree node ──────────────────────────────────────────────────────────────

function JsonNode({
  keyName,
  value,
  depth,
  isLast,
}: {
  keyName?: string;
  value: JsonValue;
  depth: number;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(depth < AUTO_EXPAND_DEPTH);

  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isCollection = isObject || isArray;
  const isEmpty = isCollection && (isArray ? value.length === 0 : Object.keys(value as JsonObject).length === 0);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  // Primitive values
  if (!isCollection) {
    return (
      <div className="flex items-baseline leading-relaxed" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-purple-300/80 shrink-0">{keyName}:&nbsp;</span>
        )}
        <PrimitiveValue value={value as JsonPrimitive} />
        {!isLast && <span className="text-zinc-600">,</span>}
      </div>
    );
  }

  // Empty collection
  if (isEmpty) {
    return (
      <div className="flex items-baseline leading-relaxed" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-purple-300/80 shrink-0">{keyName}:&nbsp;</span>
        )}
        <span className="text-zinc-500">{isArray ? "[]" : "{}"}</span>
        {!isLast && <span className="text-zinc-600">,</span>}
      </div>
    );
  }

  const entries = isArray
    ? (value as JsonArray).map((v, i) => [String(i), v] as const)
    : Object.entries(value as JsonObject);

  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";

  return (
    <div>
      {/* Header line with toggle */}
      <div
        className="flex items-center gap-0.5 leading-relaxed cursor-pointer group"
        style={{ paddingLeft: depth * 16 }}
        onClick={toggle}
      >
        <span className="shrink-0 w-3.5 flex items-center justify-center text-zinc-600 group-hover:text-zinc-400 transition-colors">
          {open ? <CaretDown size={9} /> : <CaretRight size={9} />}
        </span>
        {keyName !== undefined && (
          <span className="text-purple-300/80 shrink-0">{keyName}:&nbsp;</span>
        )}
        {open ? (
          <span className="text-zinc-500">{openBracket}</span>
        ) : (
          <>
            <span className="text-zinc-600">
              {openBracket}
              <span className="text-zinc-500 text-[11px] mx-1">{collapsedSummary(value)}</span>
              {closeBracket}
            </span>
            {!isLast && <span className="text-zinc-600">,</span>}
          </>
        )}
      </div>

      {/* Children */}
      {open && (
        <>
          {entries.map(([k, v], i) => (
            <JsonNode
              key={k}
              keyName={isArray ? undefined : k}
              value={v}
              depth={depth + 1}
              isLast={i === entries.length - 1}
            />
          ))}
          <div className="leading-relaxed" style={{ paddingLeft: depth * 16 + 14 }}>
            <span className="text-zinc-500">{closeBracket}</span>
            {!isLast && <span className="text-zinc-600">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function JsonTree({ content }: { content: string }) {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(content) as JsonValue;
  } catch {
    // Not valid JSON — fall back to plain text
    return (
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
        {content}
      </pre>
    );
  }

  return (
    <div className="text-xs font-mono leading-relaxed select-text">
      <JsonNode value={parsed} depth={0} isLast />
    </div>
  );
}
