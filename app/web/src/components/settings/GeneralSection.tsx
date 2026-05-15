import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { TimezoneSelect } from "../common/TimezoneSelect";

export function GeneralSection({
  projectId,
  canRename,
}: {
  projectId: string;
  canRename: boolean;
}) {
  const utils = trpc.useUtils();
  const project = trpc.projects.get.useQuery({ projectId });
  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => utils.projects.get.invalidate({ projectId }),
  });

  const current = project.data;
  const [name, setName] = useState(current?.name ?? "");
  const [timezone, setTimezone] = useState(current?.timezone ?? "UTC");

  useEffect(() => {
    if (current?.name !== undefined) setName(current.name);
  }, [current?.name]);

  useEffect(() => {
    if (current?.timezone !== undefined) setTimezone(current.timezone);
  }, [current?.timezone]);

  const isDirty = name !== current?.name || timezone !== current?.timezone;
  const isSaving = updateProject.isPending;

  const handleSave = async () => {
    if (!isDirty) return;
    await updateProject.mutateAsync({
      projectId,
      ...(name !== current?.name && { name }),
      ...(timezone !== current?.timezone && { timezone }),
    });
  };

  return (
    <section className="space-y-4 max-w-md">
      <h3 className="text-sm font-semibold">General</h3>
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Project name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Timezone
        </label>
        <p className="text-xs text-zinc-500 mb-1.5">
          Used for grouping data by day in charts and dashboards.
        </p>
        <TimezoneSelect value={timezone} onChange={setTimezone} />
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={!canRename || isSaving || !isDirty}
        className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:pointer-events-none"
      >
        {isSaving ? "Saving…" : "Save"}
      </button>
    </section>
  );
}
