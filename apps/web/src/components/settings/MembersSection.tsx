import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Check } from "@phosphor-icons/react/Check";
import { Copy } from "@phosphor-icons/react/Copy";
import { Link as LinkIcon } from "@phosphor-icons/react/Link";
import { Plus } from "@phosphor-icons/react/Plus";
import { Trash } from "@phosphor-icons/react/Trash";
import { X } from "@phosphor-icons/react/X";
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "./dialog-styles";

export function MembersSection({
  organizationId,
  canManage,
  myOrgRole,
}: {
  organizationId: string;
  canManage: boolean;
  myOrgRole: string | undefined;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "viewer" | "member" | "admin" | "owner"
  >("member");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const members = trpc.members.list.useQuery({ organizationId });
  const invitations = trpc.invitations.list.useQuery({
    organizationId,
  });
  const createInvitation = trpc.invitations.create.useMutation({
    onSuccess: () =>
      utils.invitations.list.invalidate({ organizationId }),
  });
  const deleteInvitation = trpc.invitations.delete.useMutation({
    onSuccess: () =>
      utils.invitations.list.invalidate({ organizationId }),
  });
  const removeMember = trpc.members.remove.useMutation({
    onSuccess: () =>
      utils.members.list.invalidate({ organizationId }),
  });

  const handleInviteOpenChange = (next: boolean) => {
    setInviteOpen(next);
    if (!next) {
      setInviteEmail("");
      setInviteRole("member");
      setInviteUrl(null);
      setCopiedInvite(false);
      setInviteError(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    try {
      const result = await createInvitation.mutateAsync({
        organizationId,
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteUrl(result.inviteUrl);
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : "Failed to create invitation",
      );
    }
  };

  const copyUrl = async (url: string, set: (v: boolean) => void) => {
    await navigator.clipboard.writeText(url);
    set(true);
    setTimeout(() => set(false), 2000);
  };

  return (
    <section className="space-y-6">
      {/* Members list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Members</h3>

          {canManage && (
            <Dialog.Root
              open={inviteOpen}
              onOpenChange={handleInviteOpenChange}
            >
              <Dialog.Trigger className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
                <Plus size={14} />
                Invite member
              </Dialog.Trigger>

              <Dialog.Portal>
                <Dialog.Backdrop className={backdropCls} />
                <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
                  <Dialog.Popup className={popupCls}>
                    <div className="flex items-start justify-between mb-5">
                      <div>
                        <Dialog.Title className="text-base font-semibold text-zinc-100">
                          {inviteUrl ? "Invitation created" : "Invite member"}
                        </Dialog.Title>
                        <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                          {inviteUrl
                            ? "Share this link with them to accept the invitation."
                            : "They'll receive a link to join this project."}
                        </Dialog.Description>
                      </div>
                      <Dialog.Close className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                        <X size={16} />
                      </Dialog.Close>
                    </div>

                    {!inviteUrl ? (
                      <form onSubmit={handleInvite} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                            Email
                          </label>
                          <input
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="colleague@example.com"
                            required
                            autoFocus
                            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                            Role
                          </label>
                          <select
                            value={inviteRole}
                            onChange={(e) =>
                              setInviteRole(
                                e.target.value as
                                  | "viewer"
                                  | "member"
                                  | "admin"
                                  | "owner",
                              )
                            }
                            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
                          >
                            <option value="viewer">Viewer</option>
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="owner">Owner</option>
                          </select>
                        </div>
                        {inviteError && (
                          <p className="text-sm text-red-400">{inviteError}</p>
                        )}
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Dialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                            Cancel
                          </Dialog.Close>
                          <button
                            type="submit"
                            disabled={createInvitation.isPending}
                            className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                          >
                            Send invite
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 p-3">
                          <code className="flex-1 text-xs text-zinc-100 break-all font-mono">
                            {inviteUrl}
                          </code>
                          <button
                            onClick={() => copyUrl(inviteUrl, setCopiedInvite)}
                            className="shrink-0 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                          >
                            {copiedInvite ? (
                              <Check
                                size={14}
                                weight="bold"
                                className="text-emerald-400"
                              />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        </div>
                        <div className="flex justify-end">
                          <Dialog.Close className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors">
                            Done
                          </Dialog.Close>
                        </div>
                      </div>
                    )}
                  </Dialog.Popup>
                </Dialog.Viewport>
              </Dialog.Portal>
            </Dialog.Root>
          )}
        </div>

        <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
          {members.data?.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  {m.name ?? m.email}
                </p>
                <p className="text-xs text-zinc-500">
                  {m.email} · {m.role}
                </p>
              </div>
              {canManage && (
                <AlertDialog.Root>
                  <AlertDialog.Trigger className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors">
                    <Trash size={16} />
                  </AlertDialog.Trigger>
                  <AlertDialog.Portal>
                    <AlertDialog.Backdrop className={backdropCls} />
                    <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
                      <AlertDialog.Popup className={popupCls}>
                        <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                          Remove member?
                        </AlertDialog.Title>
                        <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                          {m.name ?? m.email} will lose access to this project.
                        </AlertDialog.Description>
                        <div className="flex justify-end gap-2">
                          <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                            Cancel
                          </AlertDialog.Close>
                          <AlertDialog.Close
                            onClick={() =>
                              removeMember.mutate({ memberId: m.id })
                            }
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
          ))}
          {!members.data?.length && (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">
              No members yet.
            </div>
          )}
        </div>
      </div>

      {/* Pending invitations */}
      {(invitations.data?.length ?? 0) > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-4">Pending Invitations</h3>
          <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
            {invitations.data?.map((inv) => (
              <PendingInvitationRow
                key={inv.id}
                inv={inv}
                onCopy={(url) => copyUrl(url, setCopiedInvite)}
                onCancel={(id) => deleteInvitation.mutate({ invitationId: id })}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type Invitation = {
  id: string;
  email: string;
  role: string | null;
  expiresAt: Date;
  inviteUrl: string;
};

function PendingInvitationRow({
  inv,
  onCopy,
  onCancel,
}: {
  inv: Invitation;
  onCopy: (url: string) => void;
  onCancel: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy(inv.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-100 truncate">
          {inv.email}
        </p>
        <p className="text-xs text-zinc-500 capitalize">
          {inv.role ?? "member"} · expires{" "}
          {new Date(inv.expiresAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleCopy}
          title="Copy invite link"
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
        >
          {copied ? (
            <Check size={14} weight="bold" className="text-emerald-400" />
          ) : (
            <LinkIcon size={14} />
          )}
        </button>

        <AlertDialog.Root>
          <AlertDialog.Trigger
            title="Cancel invitation"
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors"
          >
            <X size={14} />
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className={backdropCls} />
            <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
              <AlertDialog.Popup className={popupCls}>
                <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                  Cancel invitation?
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                  The invitation sent to{" "}
                  <span className="text-zinc-300">{inv.email}</span> will be
                  revoked and the link will no longer work.
                </AlertDialog.Description>
                <div className="flex justify-end gap-2">
                  <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                    Keep
                  </AlertDialog.Close>
                  <AlertDialog.Close
                    onClick={() => onCancel(inv.id)}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                  >
                    Cancel invitation
                  </AlertDialog.Close>
                </div>
              </AlertDialog.Popup>
            </AlertDialog.Viewport>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </div>
  );
}
