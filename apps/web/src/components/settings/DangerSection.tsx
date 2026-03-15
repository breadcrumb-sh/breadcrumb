import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "./dialog-styles";

export function DangerSection({
  projectId,
  canDelete,
}: {
  projectId: string;
  canDelete: boolean;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      navigate({ to: "/" });
    },
  });

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Danger Zone</h3>

      <div className="rounded-md border border-red-900/50 p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-100">
            Delete this project
          </p>
          <p className="text-xs text-zinc-400 mt-0.5">
            Permanently deletes all traces and API keys. This cannot be undone.
          </p>
        </div>

        <AlertDialog.Root>
          <AlertDialog.Trigger className="shrink-0 rounded-md border border-red-800 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-950 transition-colors">
            Delete project
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className={backdropCls} />
            <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
              <AlertDialog.Popup className={popupCls}>
                <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                  Delete project?
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                  All traces and API keys will be permanently deleted. This
                  action cannot be undone.
                </AlertDialog.Description>
                <div className="flex justify-end gap-2">
                  <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                    Cancel
                  </AlertDialog.Close>
                  <AlertDialog.Close
                    onClick={() => deleteProject.mutate({ id: projectId })}
                    disabled={deleteProject.isPending}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    Delete project
                  </AlertDialog.Close>
                </div>
              </AlertDialog.Popup>
            </AlertDialog.Viewport>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </section>
  );
}
