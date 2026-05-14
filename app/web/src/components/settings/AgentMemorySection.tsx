import { useState, useEffect } from "react";
import { trpc } from "../../lib/trpc";
import { Markdown } from "../common/Markdown";

export function AgentMemorySection({ projectId }: { projectId: string }) {
  const memory = trpc.monitor.getMemory.useQuery({ projectId });
  const utils = trpc.useUtils();
  const updateMemory = trpc.monitor.updateMemory.useMutation({
    onSuccess: () => {
      utils.monitor.getMemory.invalidate({ projectId });
      setEditing(false);
    },
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (memory.data !== undefined) setDraft(memory.data);
  }, [memory.data]);

  const content = memory.data ?? "";

  return (
    <section className="space-y-4 max-w-2xl">
      <div>
        <h3 className="text-sm font-semibold mb-1">Agent Memory</h3>
        <p className="text-xs text-zinc-400">
          Project knowledge built by the monitoring agent across investigations. The agent uses this to understand your project's agents, their behavior, and common patterns.
        </p>
      </div>

      {editing ? (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            rows={20}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 resize-y font-mono"
            placeholder="The agent will populate this as it investigates traces..."
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateMemory.mutate({ projectId, content: draft })}
              disabled={updateMemory.isPending}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {updateMemory.isPending ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => { setDraft(content); setEditing(false); }}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {content ? (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4">
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-zinc-800 p-6 text-center">
              <p className="text-sm text-zinc-500">
                No project knowledge yet. The agent will build this as it investigates tickets.
              </p>
            </div>
          )}
          <button
            onClick={() => setEditing(true)}
            className="mt-3 rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
          >
            Edit manually
          </button>
        </div>
      )}
    </section>
  );
}
