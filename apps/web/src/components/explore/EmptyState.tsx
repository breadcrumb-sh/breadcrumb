const EXAMPLES = [
  {
    label: "Trace volume",
    prompt: "Show me daily trace volume over the last 30 days",
  },
  {
    label: "Slowest spans",
    prompt: "What are the top 10 slowest spans by p95 duration?",
  },
  {
    label: "Error breakdown",
    prompt: "Show error rate by trace name as a bar chart",
  },
  {
    label: "Cost trends",
    prompt: "Chart my daily LLM cost over the past 2 weeks",
  },
  {
    label: "Architecture",
    prompt: "Draw a mermaid diagram of my most common trace flow",
  },
  {
    label: "Model usage",
    prompt: "Compare token usage across different models",
  },
];

export function EmptyState({ onSend }: { onSend: (prompt: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-lg mx-auto gap-8 py-12">
      <div className="text-center space-y-2">
        <h2 className="text-base font-medium text-zinc-200">
          Explore your traces
        </h2>
        <p className="text-sm text-zinc-500 leading-relaxed">
          Ask questions in plain English. Query your data, generate charts, or visualize architecture with mermaid diagrams.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 w-full">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => onSend(ex.prompt)}
            className="text-left px-3 py-2.5 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/30 transition-colors group"
          >
            <span className="text-xs font-medium text-zinc-300 group-hover:text-zinc-100">
              {ex.label}
            </span>
            <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-1">
              {ex.prompt}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
