import { Link } from "@tanstack/react-router";

type Finding = {
  id: string;
  impact: string;
  observationName: string | null;
  title: string;
  description: string;
};

export function NewFindingsCards({
  findings,
  projectId,
}: {
  findings: Finding[];
  projectId: string;
}) {
  if (findings.length === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      {findings.map((f) => {
        const impactStyles =
          f.impact === "high"
            ? { badge: "border-red-600/30 bg-red-500/10 text-red-400", bar: "bg-red-500" }
            : f.impact === "medium"
              ? { badge: "border-amber-600/30 bg-amber-500/10 text-amber-400", bar: "bg-amber-500" }
              : { badge: "border-zinc-600 bg-zinc-800/50 text-zinc-400", bar: "bg-zinc-500" };
        return (
          <div
            key={f.id}
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden min-w-0 flex flex-col"
          >
            <div className={`h-0.5 ${impactStyles.bar}`} />
            <div className="px-5 pt-4 pb-4 flex flex-col flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className={`shrink-0 inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${impactStyles.badge}`}>
                  {f.impact}
                </span>
                {f.observationName && (
                  <span className="text-[10px] text-zinc-500 truncate">{f.observationName}</span>
                )}
              </div>
              <p className="text-sm font-medium text-zinc-100 leading-snug">{f.title}</p>
              <p className="text-xs text-zinc-500 mt-1.5 line-clamp-2 flex-1">{f.description}</p>
              <Link
                to="/projects/$projectId/traces"
                params={{ projectId }}
                search={{ tab: "observations" }}
                className="mt-3 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors self-start"
              >
                See more →
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
