import { useEffect, useState } from "react";
import { Plus } from "@phosphor-icons/react/Plus";
import { Trash } from "@phosphor-icons/react/Trash";
import { trpc } from "../../lib/trpc";

type BuiltInType = {
  key: string;
  label: string;
  description: string;
};

const BUILT_IN_TYPES: BuiltInType[] = [
  { key: "email", label: "Email addresses", description: "user@example.com" },
  { key: "phone", label: "Phone numbers", description: "+1 (555) 123-4567" },
  { key: "ssn", label: "Social Security Numbers", description: "123-45-6789" },
  { key: "creditCard", label: "Credit card numbers", description: "4111 1111 1111 1111" },
  { key: "ipAddress", label: "IP addresses", description: "192.168.1.1" },
  { key: "dateOfBirth", label: "Dates of birth", description: "03/15/1990" },
  { key: "usAddress", label: "US street addresses", description: "123 Main Street" },
  { key: "apiKey", label: "API keys & tokens", description: "sk-..., AKIA..., ghp_..." },
  { key: "url", label: "URLs", description: "https://..." },
];

type CustomPattern = {
  label: string;
  pattern: string;
  replacement: string;
  enabled: boolean;
};

function emptyPattern(): CustomPattern {
  return { label: "", pattern: "", replacement: "", enabled: true };
}

type Toggles = Record<string, boolean>;

function defaultToggles(): Toggles {
  const t: Toggles = {};
  for (const bt of BUILT_IN_TYPES) t[bt.key] = bt.key !== "url";
  return t;
}

export function PiiRedactionSection({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const existing = trpc.piiRedaction.get.useQuery({ projectId });
  const upsert = trpc.piiRedaction.upsert.useMutation({
    onSuccess: () => utils.piiRedaction.get.invalidate({ projectId }),
  });

  const [toggles, setToggles] = useState<Toggles>(defaultToggles);
  const [customPatterns, setCustomPatterns] = useState<CustomPattern[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Seed from server
  useEffect(() => {
    if (!existing.data) return;
    const s = existing.data.settings;
    if (s) {
      const t: Toggles = {};
      for (const bt of BUILT_IN_TYPES) {
        t[bt.key] = (s as Record<string, unknown>)[bt.key] as boolean;
      }
      setToggles(t);
    }
    if (existing.data.customPatterns.length > 0) {
      setCustomPatterns(
        existing.data.customPatterns.map((cp) => ({
          label: cp.label,
          pattern: cp.pattern,
          replacement: cp.replacement,
          enabled: cp.enabled,
        })),
      );
    }
  }, [existing.data]);

  const hasAnyEnabled =
    Object.values(toggles).some(Boolean) ||
    customPatterns.some((cp) => cp.enabled && cp.pattern);

  const handleSave = async () => {
    setError(null);
    // Validate custom patterns
    for (const cp of customPatterns) {
      if (!cp.pattern) continue;
      try {
        new RegExp(cp.pattern, "g");
      } catch {
        setError(`Invalid regex for "${cp.label || "unnamed"}": ${cp.pattern}`);
        return;
      }
    }

    try {
      await upsert.mutateAsync({
        projectId,
        ...toggles as Record<string, boolean>,
        customPatterns: customPatterns.filter((cp) => cp.pattern),
      } as Parameters<typeof upsert.mutateAsync>[0]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const addPattern = () => {
    setCustomPatterns((prev) => [...prev, emptyPattern()]);
  };

  const removePattern = (idx: number) => {
    setCustomPatterns((prev) => prev.filter((_, i) => i !== idx));
  };

  const updatePattern = (idx: number, patch: Partial<CustomPattern>) => {
    setCustomPatterns((prev) =>
      prev.map((cp, i) => (i === idx ? { ...cp, ...patch } : cp)),
    );
  };

  return (
    <section className="space-y-6 max-w-lg">
      <div>
        <h3 className="text-sm font-semibold mb-1">PII Redaction</h3>
        <p className="text-xs text-zinc-500">
          Automatically redact personally identifiable information from traces
          and spans at ingestion time. Redacted data is replaced before storage
          and cannot be recovered.
        </p>
      </div>

      {/* Built-in patterns */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
          Built-in patterns
        </h4>
        <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 divide-y divide-zinc-800/50">
          {BUILT_IN_TYPES.map((bt) => (
            <label
              key={bt.key}
              className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-zinc-800/30 transition-colors"
            >
              <div className="min-w-0">
                <span className="text-sm text-zinc-200">{bt.label}</span>
                <span className="text-xs text-zinc-600 ml-2">{bt.description}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setToggles((prev) => ({ ...prev, [bt.key]: !prev[bt.key] }))
                }
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                  toggles[bt.key] ? "bg-zinc-100" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block size-4 rounded-full shadow-sm transition-transform ${
                    toggles[bt.key]
                      ? "translate-x-4 bg-zinc-900"
                      : "translate-x-0 bg-zinc-400"
                  }`}
                />
              </button>
            </label>
          ))}
        </div>
      </div>

      {/* Custom patterns */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            Custom patterns
          </h4>
          <button
            type="button"
            onClick={addPattern}
            className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Plus size={12} />
            Add
          </button>
        </div>

        {customPatterns.length === 0 && (
          <p className="text-xs text-zinc-600 py-2">
            No custom patterns. Add regex patterns to redact domain-specific PII.
          </p>
        )}

        {customPatterns.map((cp, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <input
                type="text"
                value={cp.label}
                onChange={(e) => updatePattern(idx, { label: e.target.value })}
                placeholder="Label (e.g. Internal IDs)"
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
              />
              <div className="flex items-center gap-2 ml-2">
                <button
                  type="button"
                  onClick={() =>
                    updatePattern(idx, { enabled: !cp.enabled })
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                    cp.enabled ? "bg-zinc-100" : "bg-zinc-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block size-4 rounded-full shadow-sm transition-transform ${
                      cp.enabled
                        ? "translate-x-4 bg-zinc-900"
                        : "translate-x-0 bg-zinc-400"
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => removePattern(idx)}
                  className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                >
                  <Trash size={14} />
                </button>
              </div>
            </div>
            <input
              type="text"
              value={cp.pattern}
              onChange={(e) => updatePattern(idx, { pattern: e.target.value })}
              placeholder="Regex pattern (e.g. CUST-\d{6})"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm font-mono text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
            />
            <input
              type="text"
              value={cp.replacement}
              onChange={(e) =>
                updatePattern(idx, { replacement: e.target.value })
              }
              placeholder="Replacement (e.g. [CUSTOMER_ID_REDACTED])"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
            />
          </div>
        ))}
      </div>

      {!hasAnyEnabled && (
        <p className="text-xs text-zinc-500">
          No patterns enabled. Enable at least one pattern to activate redaction.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={upsert.isPending}
        className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:pointer-events-none"
      >
        {upsert.isPending ? "Saving…" : "Save"}
      </button>
    </section>
  );
}
