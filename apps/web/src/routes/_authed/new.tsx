import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Copy } from "@phosphor-icons/react/Copy";
import { Check } from "@phosphor-icons/react/Check";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { trpc } from "../../lib/trpc";
import { StepIndicator } from "../../components/common/StepIndicator";
import { AppHeader } from "../../components/layout/AppHeader";

export const Route = createFileRoute("/_authed/new")({
  component: NewProjectPage,
});

const STEPS = [
  { label: "Name your project" },
  { label: "Copy your API key" },
];

function NewProjectPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const utils = trpc.useUtils();
  const createProject = trpc.projects.create.useMutation();
  const createApiKey = trpc.apiKeys.create.useMutation();

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const project = await createProject.mutateAsync({ name: projectName });
    const key = await createApiKey.mutateAsync({
      projectId: project.id,
      name: "Default",
    });
    utils.apiKeys.list.invalidate({ projectId: project.id });
    setProjectId(project.id);
    setCreatedKey(key.rawKey);
    setStep(1);
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
    <AppHeader />
    <div className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex items-center gap-4">
          <StepIndicator steps={STEPS} current={step} />
        </div>

        {step === 0 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Name your project</h2>
              <p className="text-sm text-zinc-400">
                Projects group your LLM traces together.
              </p>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  Project name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="My App"
                  required
                  autoFocus
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                />
              </div>
              <button
                type="submit"
                disabled={createProject.isPending || createApiKey.isPending}
                className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                Continue
              </button>
            </form>
          </div>
        )}

        {step === 1 && createdKey && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Your API key</h2>
              <p className="text-sm text-zinc-400">
                Copy this now — you won't be able to see it again.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 p-3">
              <code className="flex-1 text-sm text-zinc-100 break-all font-mono">
                {createdKey}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
              >
                {copied ? (
                  <Check size={16} weight="bold" className="text-emerald-400" />
                ) : (
                  <Copy size={16} />
                )}
              </button>
            </div>

            <button
              onClick={() =>
                navigate({ to: "/projects/$projectId", params: { projectId } })
              }
              className="flex w-full items-center justify-center gap-2 rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors"
            >
              Go to project
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
