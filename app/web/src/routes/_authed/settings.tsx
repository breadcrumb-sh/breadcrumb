import { Check } from "@phosphor-icons/react/Check";
import { Select } from "@base-ui/react/select";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { createFileRoute } from "@tanstack/react-router";
import { usePageView } from "../../hooks/usePageView";
import { AppHeader } from "../../components/layout/AppHeader";
import { useTheme, type ThemePreference } from "../../hooks/useTheme";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  usePageView("global_settings");
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <AppHeader />
      <main className="px-4 py-6 sm:px-6 page-container-small">
        <h1 className="text-lg font-semibold mb-8">Settings</h1>
        <div className="space-y-10">
          <ThemeSection />
        </div>
      </main>
    </div>
  );
}

// ── Theme Section ───────────────────────────────────────────────────

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function ThemeSection() {
  const { preference, setTheme } = useTheme();

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Appearance</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Choose how Breadcrumb looks to you.
        </p>
      </div>

      <Select.Root
        value={preference}
        onValueChange={(v) => v && setTheme(v as ThemePreference)}
      >
        <Select.Trigger className="h-[30px] flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-400 outline-none hover:border-zinc-700 focus:border-zinc-600 cursor-pointer transition-colors min-w-[120px]">
          <Select.Value className="truncate flex-1 text-left">
            {themeOptions.find((o) => o.value === preference)?.label}
          </Select.Value>
          <Select.Icon>
            <CaretDown size={12} className="text-zinc-500" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner sideOffset={4} className="z-[100]">
            <Select.Popup className="rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl max-h-[240px] overflow-y-auto min-w-[var(--anchor-width)] motion-preset-fade motion-preset-slide-down-sm motion-duration-150">
              {themeOptions.map((opt) => (
                <Select.Item
                  key={opt.value}
                  value={opt.value}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 outline-none cursor-default data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100 transition-colors"
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
    </section>
  );
}
