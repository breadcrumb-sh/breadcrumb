import { type MouseEvent, useEffect, useState } from "react";
import { Accordion } from "@base-ui/react/accordion";
import { Select } from "@base-ui/react/select";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { SlackLogo } from "@phosphor-icons/react/SlackLogo";
import { DiscordLogo } from "@phosphor-icons/react/DiscordLogo";
import type { Icon } from "@phosphor-icons/react";
import { trpc } from "../../lib/trpc";

type MinPriority = "all" | "low" | "medium" | "high" | "critical";

const PRIORITY_OPTIONS: { value: MinPriority; label: string }[] = [
  { value: "all", label: "All" },
  { value: "low", label: "Low and above" },
  { value: "medium", label: "Medium and above" },
  { value: "high", label: "High and above" },
  { value: "critical", label: "Critical only" },
];

type WebhookConfig = {
  url: string;
  minPriority: MinPriority;
  enabled: boolean;
};

const CHANNELS: { key: string; label: string; icon: Icon; placeholder: string }[] = [
  { key: "slack", label: "Slack", icon: SlackLogo, placeholder: "https://hooks.slack.com/services/..." },
  { key: "discord", label: "Discord", icon: DiscordLogo, placeholder: "https://discord.com/api/webhooks/..." },
];

function defaultConfig(): WebhookConfig {
  return { url: "", minPriority: "all", enabled: false };
}

/* ── Main section ─────────────────────────────────── */

export function IntegrationsSection({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const existing = trpc.integrations.list.useQuery({ projectId });
  const upsert = trpc.integrations.upsert.useMutation({
    onSuccess: () => utils.integrations.list.invalidate({ projectId }),
  });
  const test = trpc.integrations.test.useMutation();

  const [configs, setConfigs] = useState<Record<string, WebhookConfig>>({
    slack: defaultConfig(),
    discord: defaultConfig(),
  });

  // Seed local state from server data
  useEffect(() => {
    if (existing.data) {
      setConfigs((prev) => {
        const next = { ...prev };
        for (const row of existing.data) {
          next[row.channel] = {
            url: row.url,
            minPriority: row.minPriority as MinPriority,
            enabled: row.enabled,
          };
        }
        return next;
      });
    }
  }, [existing.data]);

  const update = (key: string, patch: Partial<WebhookConfig>) => {
    setConfigs((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const toggleEnabled = (key: string, e: MouseEvent) => {
    e.stopPropagation();
    update(key, { enabled: !configs[key].enabled });
  };

  // Dirty check: compare local state to server data
  const isDirty = CHANNELS.some((ch) => {
    const local = configs[ch.key];
    const remote = existing.data?.find((r) => r.channel === ch.key);
    if (!remote) return local.url !== "" || local.enabled || local.minPriority !== "all";
    return (
      local.url !== remote.url ||
      local.minPriority !== remote.minPriority ||
      local.enabled !== remote.enabled
    );
  });

  const isSaving = upsert.isPending;

  const handleSave = async () => {
    const mutations = CHANNELS
      .filter((ch) => {
        const local = configs[ch.key];
        // Only upsert channels that have a URL configured
        return local.url;
      })
      .map((ch) => {
        const local = configs[ch.key];
        return upsert.mutateAsync({
          projectId,
          channel: ch.key as "slack" | "discord",
          url: local.url,
          minPriority: local.minPriority,
          enabled: local.enabled,
        });
      });
    await Promise.all(mutations);
  };

  return (
    <section className="space-y-4 max-w-md">
      <div>
        <h3 className="text-sm font-semibold mb-1">Integrations</h3>
        <p className="text-xs text-zinc-500">
          Get notified when the monitor agent finds issues.
        </p>
      </div>

      <Accordion.Root className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 divide-y divide-zinc-800/50">
        {CHANNELS.map((channel) => {
          const config = configs[channel.key];
          const Icon = channel.icon;
          return (
            <Accordion.Item key={channel.key} value={channel.key}>
              <Accordion.Header>
                <Accordion.Trigger className="flex w-full items-center justify-between px-4 py-3 text-left group">
                  <div className="flex items-center gap-2.5">
                    <Icon size={18} weight="fill" className="text-zinc-100" />
                    <span className="text-sm font-medium text-zinc-200">
                      {channel.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={(e) => toggleEnabled(channel.key, e)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                        config.enabled ? "bg-zinc-100" : "bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block size-4 rounded-full shadow-sm transition-transform ${
                          config.enabled
                            ? "translate-x-4 bg-zinc-900"
                            : "translate-x-0 bg-zinc-400"
                        }`}
                      />
                    </button>
                    <CaretDown
                      size={14}
                      className="text-zinc-500 transition-transform duration-200 group-data-[panel-open]:rotate-180"
                    />
                  </div>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Panel className="px-4 pb-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Webhook URL
                  </label>
                  <input
                    type="url"
                    value={config.url}
                    onChange={(e) => update(channel.key, { url: e.target.value })}
                    placeholder={channel.placeholder}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                    Minimum priority
                  </label>
                  <p className="text-xs text-zinc-500 mb-1.5">
                    Notifies when a ticket is moved to needs review, filtered by priority.
                  </p>
                  <Select.Root
                    value={config.minPriority}
                    onValueChange={(v) => v && update(channel.key, { minPriority: v as MinPriority })}
                  >
                    <Select.Trigger className="h-[34px] w-full flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none hover:border-zinc-600 focus:border-zinc-500 cursor-pointer transition-colors">
                      <Select.Value className="truncate flex-1 text-left">
                        {PRIORITY_OPTIONS.find((o) => o.value === config.minPriority)?.label}
                      </Select.Value>
                      <Select.Icon>
                        <CaretDown size={12} className="text-zinc-500" />
                      </Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Positioner sideOffset={4} className="z-[100]">
                        <Select.Popup className="rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl max-h-[240px] overflow-y-auto min-w-[var(--anchor-width)] motion-preset-fade motion-preset-slide-down-sm motion-duration-150">
                          {PRIORITY_OPTIONS.map((opt) => (
                            <Select.Item
                              key={opt.value}
                              value={opt.value}
                              className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-400 outline-none cursor-default data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100 transition-colors"
                            >
                              <Select.ItemIndicator className="w-3">
                                <Check size={10} />
                              </Select.ItemIndicator>
                              <Select.ItemText>{opt.label}</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.Popup>
                      </Select.Positioner>
                    </Select.Portal>
                  </Select.Root>
                </div>

                <button
                  type="button"
                  disabled={!config.url || test.isPending}
                  onClick={() => test.mutate({ projectId, channel: channel.key as "slack" | "discord", url: config.url })}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                >
                  {test.isPending ? "Sending…" : "Send test"}
                </button>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion.Root>

      <button
        type="button"
        onClick={handleSave}
        disabled={!isDirty || isSaving}
        className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:pointer-events-none"
      >
        {isSaving ? "Saving…" : "Save"}
      </button>
    </section>
  );
}
