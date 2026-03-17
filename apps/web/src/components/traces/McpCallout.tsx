import { X } from "@phosphor-icons/react/X";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { trpc } from "../../lib/trpc";

const DISMISS_KEY = "breadcrumb_mcp_callout_dismissed";

export function McpCallout() {
  const { authenticated } = useAuth();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "true",
  );
  const mcpKeys = trpc.mcpKeys.list.useQuery(undefined, {
    enabled: authenticated,
  });

  // Hide for unauthenticated users or when dismissed/keys exist
  if (!authenticated || dismissed || !mcpKeys.data || mcpKeys.data.length > 0) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="mb-6 flex items-start gap-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
      <p className="flex-1 text-sm text-zinc-300">
        Chat directly with your coding agent about these traces to debug issues and improve
        your prompts faster.{" "}
        <Link
          to="/settings"
          className="text-indigo-400 underline-offset-2 hover:underline"
        >
          Set up the MCP integration
        </Link>{" "}
        to get started.
      </p>
      <button
        onClick={dismiss}
        className="mt-0.5 shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
