import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";

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

  const current = project.data?.find((p) => p.id === projectId);
  const [name, setName] = useState(current?.name ?? "");

  useEffect(() => {
    if (current?.name !== undefined) setName(current.name);
  }, [current?.name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await rename.mutateAsync({ id: projectId, name });
  };

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
          <button
            type="submit"
            disabled={!canRename || rename.isPending || name === current?.name}
            className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            Save
          </button>
        </form>
      </div>
    </section>
  );
}
