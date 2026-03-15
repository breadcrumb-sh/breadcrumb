import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "./dialog-styles";

const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
] as const;

export function AiProviderSection({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const existing = trpc.aiProviders.get.useQuery({ projectId });
  const upsert = trpc.aiProviders.upsert.useMutation({
    onSuccess: () => utils.aiProviders.get.invalidate({ projectId }),
  });
  const remove = trpc.aiProviders.delete.useMutation({
    onSuccess: () => utils.aiProviders.get.invalidate({ projectId }),
  });

  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // Populate form when existing config loads
  useEffect(() => {
    if (existing.data) {
      setProvider(existing.data.provider);
      setModelId(existing.data.modelId);
      setBaseUrl(existing.data.baseUrl ?? "");
      setApiKey("");
    }
  }, [existing.data]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await upsert.mutateAsync({
      projectId,
      provider: provider as "openai" | "anthropic" | "openrouter" | "custom",
      ...(apiKey ? { apiKey } : {}),
      modelId,
      baseUrl: provider === "custom" ? baseUrl : undefined,
    });
    setApiKey("");
  };

  const handleRemove = async () => {
    await remove.mutateAsync({ projectId });
    setProvider("openai");
    setApiKey("");
    setModelId("");
    setBaseUrl("");
  };

  return (
    <section className="space-y-6 max-w-md">
      <div>
        <h3 className="text-sm font-semibold mb-1">AI Provider</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Configure an AI provider to enable intelligent features like NLP trace
          search.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={existing.data?.apiKeyMask ?? "Enter API key"}
              required={!existing.data}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Model ID
            </label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="e.g. gpt-4o, claude-sonnet-4-20250514"
              required
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
            />
          </div>

          {provider === "custom" && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Base URL
              </label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                required
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={upsert.isPending}
              className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {existing.data ? "Update" : "Save"}
            </button>

            {existing.data && (
              <AlertDialog.Root>
                <AlertDialog.Trigger className="rounded-md border border-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Remove
                </AlertDialog.Trigger>
                <AlertDialog.Portal>
                  <AlertDialog.Backdrop className={backdropCls} />
                  <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
                    <AlertDialog.Popup className={popupCls}>
                      <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                        Remove AI provider?
                      </AlertDialog.Title>
                      <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                        AI-powered features will be disabled until a new
                        provider is configured.
                      </AlertDialog.Description>
                      <div className="flex justify-end gap-2">
                        <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                          Cancel
                        </AlertDialog.Close>
                        <AlertDialog.Close
                          onClick={handleRemove}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                        >
                          Remove
                        </AlertDialog.Close>
                      </div>
                    </AlertDialog.Popup>
                  </AlertDialog.Viewport>
                </AlertDialog.Portal>
              </AlertDialog.Root>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
