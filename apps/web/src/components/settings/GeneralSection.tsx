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
  const project = trpc.projects.list.useQuery();
  const rename = trpc.projects.rename.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      utils.projects.get.invalidate({ id: projectId });
    },
  });
  const updateTimezone = trpc.projects.updateTimezone.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      utils.projects.get.invalidate({ id: projectId });
    },
  });

  const current = project.data?.find((p) => p.id === projectId);
  const [name, setName] = useState(current?.name ?? "");
  const [timezone, setTimezone] = useState(current?.timezone ?? "UTC");

  useEffect(() => {
    if (current?.name !== undefined) setName(current.name);
  }, [current?.name]);

  useEffect(() => {
    if (current?.timezone !== undefined) setTimezone(current.timezone);
  }, [current?.timezone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const promises: Promise<unknown>[] = [];
    if (name !== current?.name) {
      promises.push(rename.mutateAsync({ id: projectId, name }));
    }
    if (timezone !== current?.timezone) {
      promises.push(updateTimezone.mutateAsync({ id: projectId, timezone }));
    }
    await Promise.all(promises);
  };

  const isDirty = name !== current?.name || timezone !== current?.timezone;

  return (
    <section className="space-y-6 max-w-md">
      <div>
        <h3 className="text-sm font-semibold mb-4">General</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            type="submit"
            disabled={!canRename || rename.isPending || updateTimezone.isPending || !isDirty}
            className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            Save
          </button>
        </form>
      </div>
    </section>
  );
}
