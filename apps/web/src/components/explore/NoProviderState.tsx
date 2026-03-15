import { Brain } from "@phosphor-icons/react/Brain";
import { Link } from "@tanstack/react-router";

export function NoProviderState({ projectId }: { projectId: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto gap-5 py-12">
      <div className="flex items-center justify-center w-12 h-12 rounded-full border border-zinc-800 bg-zinc-900">
        <Brain size={22} className="text-zinc-500" />
      </div>
      <div className="text-center space-y-1.5">
        <h2 className="text-base font-medium text-zinc-200">
          AI provider not configured
        </h2>
        <p className="text-sm text-zinc-500 leading-relaxed">
          Set up an AI provider in your project settings to start exploring traces with natural language.
        </p>
      </div>
      <Link
        to="/projects/$projectId/settings"
        params={{ projectId }}
        search={{ tab: "ai" }}
        className="text-sm text-zinc-400 underline hover:text-zinc-200 transition-colors"
      >
        Configure AI provider
      </Link>
    </div>
  );
}
