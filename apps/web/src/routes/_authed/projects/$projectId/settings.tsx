import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import {
  Brain,
  Check,
  Copy,
  Eye,
  Gear,
  Key,
  Link as LinkIcon,
  Plus,
  Trash,
  Users,
  Warning,
  X,
} from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useRegisterSubMenu } from "../../../../components/SubMenuContext";
import { useAuth } from "../../../../hooks/useAuth";
import { trpc } from "../../../../lib/trpc";

type Section = "general" | "api-keys" | "members" | "ai" | "observations" | "danger";

const searchSchema = z.object({
  tab: z.enum(["general", "api-keys", "members", "ai", "observations", "danger"]).optional(),
});

export const Route = createFileRoute("/_authed/projects/$projectId/settings")({
  validateSearch: searchSchema,
  component: SettingsPage,
});

function SettingsPage() {
  const { projectId } = Route.useParams();
  const { user, isAdmin: isGlobalAdmin } = useAuth();

  // Determine the current user's org-level role for this project.
  const members = trpc.members.list.useQuery({ organizationId: projectId });
  const myOrgRole = members.data?.find((m) => m.userId === user?.id)?.role;
  const isOrgOwner = myOrgRole === "owner";
  const isOrgAdmin = myOrgRole === "admin" || isOrgOwner;

  // General: only admins/owners can rename — members don't see it at all
  const canSeeGeneral = isGlobalAdmin || isOrgAdmin;
  // API Keys: all members can view, but only admin/owner can create/delete
  const canManageApiKeys = isGlobalAdmin || isOrgAdmin;
  // Members: all members
  const canManageMembers = isGlobalAdmin || isOrgAdmin;
  // Danger: global admin only
  const canDeleteProject = isGlobalAdmin;

  const visibleSections: {
    id: Section;
    label: string;
    icon: React.ReactNode;
  }[] = [
    ...(canSeeGeneral
      ? [
          {
            id: "general" as Section,
            label: "General",
            icon: <Gear size={16} />,
          },
        ]
      : []),
    { id: "api-keys" as Section, label: "API Keys", icon: <Key size={16} /> },
    { id: "members" as Section, label: "Members", icon: <Users size={16} /> },
    ...(isGlobalAdmin || isOrgAdmin
      ? [
          {
            id: "ai" as Section,
            label: "AI Provider",
            icon: <Brain size={16} />,
          },
        ]
      : []),
    {
      id: "observations" as Section,
      label: "Observations",
      icon: <Eye size={16} />,
    },
    ...(canDeleteProject
      ? [
          {
            id: "danger" as Section,
            label: "Danger",
            icon: <Warning size={16} />,
          },
        ]
      : []),
  ];

  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const defaultSection: Section = canSeeGeneral ? "general" : "api-keys";
  const section: Section =
    tab && visibleSections.some((s) => s.id === tab) ? tab : defaultSection;

  const setSection = useCallback(
    (next: string) => {
      navigate({
        search: { tab: next as Section },
        replace: true,
      });
    },
    [navigate],
  );

  const subMenuItems = useMemo(
    () => visibleSections.map(({ id, label, icon }) => ({ id, label, icon })),
    [visibleSections],
  );

  useRegisterSubMenu(subMenuItems, section, setSection);

  return (
    <main className="px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex gap-8">
        <nav className="hidden sm:block w-44 shrink-0 space-y-0.5 sticky top-32 self-start">
          {visibleSections.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                section === item.id
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {section === "general" && (
            <GeneralSection
              projectId={projectId}
              canRename={isGlobalAdmin || isOrgAdmin}
            />
          )}
          {section === "api-keys" && (
            <ApiKeysSection
              projectId={projectId}
              canManage={canManageApiKeys}
            />
          )}
          {section === "ai" && <AiProviderSection projectId={projectId} />}
          {section === "observations" && (
            <ObservationsSection projectId={projectId} />
          )}
          {section === "members" && (
            <MembersSection
              projectId={projectId}
              canManage={canManageMembers}
              myOrgRole={myOrgRole}
            />
          )}
          {section === "danger" && (
            <DangerSection projectId={projectId} canDelete={canDeleteProject} />
          )}
        </div>
      </div>
    </main>
  );
}

// ── Shared dialog styles ────────────────────────────────────────────

const backdropCls =
  "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";

const popupCls =
  "w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95";

// ── General ─────────────────────────────────────────────────────────

function GeneralSection({
  projectId,
  canRename,
}: {
  projectId: string;
  canRename: boolean;
}) {
  const utils = trpc.useUtils();
  const project = trpc.projects.list.useQuery();
  const rename = trpc.projects.rename.useMutation({
    onSuccess: () => utils.projects.list.invalidate(),
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

// ── API Keys ─────────────────────────────────────────────────────────

function ApiKeysSection({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const utils = trpc.useUtils();
  const apiKeys = trpc.apiKeys.list.useQuery({ projectId });
  const createKey = trpc.apiKeys.create.useMutation({
    onSuccess: () => utils.apiKeys.list.invalidate({ projectId }),
  });
  const deleteKey = trpc.apiKeys.delete.useMutation({
    onSuccess: () => utils.apiKeys.list.invalidate({ projectId }),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await createKey.mutateAsync({ projectId, name: keyName });
    setCreatedKey(result.rawKey);
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setKeyName("");
      setCreatedKey(null);
      setCopied(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">API Keys</h3>

        <Dialog.Root open={open} onOpenChange={handleOpenChange}>
          {canManage && (
            <Dialog.Trigger className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
              <Plus size={14} />
              New key
            </Dialog.Trigger>
          )}

          <Dialog.Portal>
            <Dialog.Backdrop className={backdropCls} />
            <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
              <Dialog.Popup className={popupCls}>
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-zinc-100">
                      {createdKey ? "Your API key" : "New API key"}
                    </Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                      {createdKey
                        ? "Copy this now — you won't be able to see it again."
                        : "Give this key a name to identify where it's used."}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                    <X size={16} />
                  </Dialog.Close>
                </div>

                {!createdKey ? (
                  <form onSubmit={handleCreate} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                        Key name
                      </label>
                      <input
                        type="text"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        placeholder="e.g. Production, Development"
                        required
                        autoFocus
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Dialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                        Cancel
                      </Dialog.Close>
                      <button
                        type="submit"
                        disabled={createKey.isPending}
                        className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                      >
                        Create key
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 p-3">
                      <code className="flex-1 text-sm text-zinc-100 break-all font-mono">
                        {createdKey}
                      </code>
                      <button
                        onClick={handleCopy}
                        className="shrink-0 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                      >
                        {copied ? (
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
      </div>

      <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
        {apiKeys.data?.map((key) => (
          <div
            key={key.id}
            className="flex items-center justify-between px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-zinc-100">{key.name}</p>
              <p className="text-xs text-zinc-500 font-mono">{key.keyPrefix}</p>
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
                        Delete API key?
                      </AlertDialog.Title>
                      <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                        Any application using{" "}
                        <span className="font-mono text-zinc-300">
                          {key.keyPrefix}
                        </span>{" "}
                        will stop working immediately.
                      </AlertDialog.Description>
                      <div className="flex justify-end gap-2">
                        <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                          Cancel
                        </AlertDialog.Close>
                        <AlertDialog.Close
                          onClick={() => deleteKey.mutate({ id: key.id })}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                        >
                          Delete
                        </AlertDialog.Close>
                      </div>
                    </AlertDialog.Popup>
                  </AlertDialog.Viewport>
                </AlertDialog.Portal>
              </AlertDialog.Root>
            )}
          </div>
        ))}
        {!apiKeys.data?.length && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            No API keys yet.
          </div>
        )}
      </div>
    </section>
  );
}

// ── Members ───────────────────────────────────────────────────────────

function MembersSection({
  projectId,
  canManage,
  myOrgRole,
}: {
  projectId: string;
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
  const members = trpc.members.list.useQuery({ organizationId: projectId });
  const invitations = trpc.invitations.list.useQuery({
    organizationId: projectId,
  });
  const createInvitation = trpc.invitations.create.useMutation({
    onSuccess: () =>
      utils.invitations.list.invalidate({ organizationId: projectId }),
  });
  const deleteInvitation = trpc.invitations.delete.useMutation({
    onSuccess: () =>
      utils.invitations.list.invalidate({ organizationId: projectId }),
  });
  const removeMember = trpc.members.remove.useMutation({
    onSuccess: () =>
      utils.members.list.invalidate({ organizationId: projectId }),
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
        organizationId: projectId,
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

// ── AI Provider ──────────────────────────────────────────────────────

const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "custom", label: "Custom (OpenAI-compatible)" },
] as const;

function AiProviderSection({ projectId }: { projectId: string }) {
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

// ── Observations ─────────────────────────────────────────────────────

type ObservationFormValues = {
  name: string;
  traceNames: string[];
  samplingRate: number;
  traceLimit: number | null;
  heuristics: string;
};

function ObservationsSection({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const aiProvider = trpc.aiProviders.get.useQuery({ projectId });
  const list = trpc.observations.list.useQuery({ projectId });
  const create = trpc.observations.create.useMutation({
    onSuccess: () => utils.observations.list.invalidate({ projectId }),
  });
  const setEnabled = trpc.observations.setEnabled.useMutation({
    onSuccess: () => utils.observations.list.invalidate({ projectId }),
  });
  const remove = trpc.observations.delete.useMutation({
    onSuccess: () => utils.observations.list.invalidate({ projectId }),
  });

  const handleCreate = async (values: ObservationFormValues) => {
    await create.mutateAsync({
      projectId,
      name: values.name,
      traceNames: values.traceNames,
      samplingRate: values.samplingRate,
      traceLimit: values.traceLimit ?? undefined,
      heuristics: values.heuristics || undefined,
    });
    setOpen(false);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Observations</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            AI monitors new traces against each observation and surfaces issues automatically.
          </p>
        </div>

        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
            <Plus size={14} />
            New observation
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Backdrop className={backdropCls} />
            <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4 py-8 overflow-y-auto">
              <Dialog.Popup className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-zinc-100">
                      New observation
                    </Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                      Define what the AI should watch for across incoming traces.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                    <X size={16} />
                  </Dialog.Close>
                </div>

                <ObservationForm
                  onSubmit={handleCreate}
                  onCancel={() => setOpen(false)}
                  isPending={create.isPending}
                  projectId={projectId}
                />
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {aiProvider.data === null && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-5 flex items-start gap-3">
          <Brain size={18} className="text-zinc-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm text-zinc-300 font-medium">AI provider not configured</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Observations are defined here, but evaluations won't run until an AI provider is set up.{" "}
              <Link
                to="/projects/$projectId/settings"
                params={{ projectId }}
                search={{ tab: "ai" }}
                className="underline hover:text-zinc-300 transition-colors"
              >
                Configure AI provider
              </Link>
            </p>
          </div>
        </div>
      )}

      <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
        {list.data?.map((obs) => (
          <ObservationRow
            key={obs.id}
            obs={obs}
            projectId={projectId}
            onDelete={() => remove.mutate({ projectId, id: obs.id })}
            onToggle={() =>
              setEnabled.mutate({ projectId, id: obs.id, enabled: !obs.enabled })
            }
          />
        ))}
        {list.data?.length === 0 && (
          <div className="px-4 py-10 text-center">
            <Eye size={28} className="mx-auto mb-2 text-zinc-700" />
            <p className="text-sm text-zinc-500">No observations yet.</p>
            <p className="text-xs text-zinc-600 mt-0.5">
              Create one to start monitoring traces automatically.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

type ObservationRow = {
  id: string;
  name: string;
  traceNames: string[] | null;
  samplingRate: number;
  traceLimit: number | null;
  tracesEvaluated: number;
  heuristics: string | null;
  enabled: boolean;
};

function ObservationRow({
  obs,
  projectId,
  onDelete,
  onToggle,
}: {
  obs: ObservationRow;
  projectId: string;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const stats = trpc.observations.queueStats.useQuery(
    { projectId, observationId: obs.id },
    { refetchInterval: 10_000 },
  );

  const { queued = 0, active = 0, completed = 0 } = stats.data ?? {};
  const inFlight = queued + active;

  return (
    <div className="flex items-start justify-between px-4 py-3 gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-100 truncate">{obs.name}</p>
          <span
            className={`shrink-0 inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none ${
              obs.enabled
                ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-600"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-500"
            }`}
          >
            {obs.enabled ? "active" : "paused"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
          {(obs.traceNames ?? []).length > 0 ? (
            <p className="text-xs text-zinc-500">
              Traces:{" "}
              {(obs.traceNames ?? []).slice(0, 3).map((n, i) => (
                <span key={n}>
                  <span className="text-zinc-400 font-mono">{n}</span>
                  {i < Math.min((obs.traceNames ?? []).length, 3) - 1 && ", "}
                </span>
              ))}
              {(obs.traceNames ?? []).length > 3 && (
                <span className="text-zinc-600"> +{(obs.traceNames ?? []).length - 3} more</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-zinc-500">All traces</p>
          )}
          <p className="text-xs text-zinc-500">
            Sampling: <span className="text-zinc-400">{obs.samplingRate}%</span>
          </p>
          {obs.traceLimit !== null && (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400">{obs.tracesEvaluated}</span>
              {" / "}
              <span className="text-zinc-400">{obs.traceLimit}</span>
              {" traces"}
            </p>
          )}
          {stats.data && (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400">{completed}</span> processed
              {inFlight > 0 && (
                <>
                  {" · "}
                  <span className="text-zinc-400">{inFlight}</span> queued
                </>
              )}
            </p>
          )}
        </div>
        {obs.heuristics && (
          <p className="text-xs text-zinc-600 mt-1 line-clamp-1">{obs.heuristics}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggle}
          title={obs.enabled ? "Pause" : "Resume"}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors text-xs"
        >
          {obs.enabled ? "Pause" : "Resume"}
        </button>

        <AlertDialog.Root>
          <AlertDialog.Trigger className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors">
            <Trash size={16} />
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className={backdropCls} />
            <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
              <AlertDialog.Popup className={popupCls}>
                <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                  Delete observation?
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                  <span className="text-zinc-300">{obs.name}</span> will stop monitoring new traces.
                </AlertDialog.Description>
                <div className="flex justify-end gap-2">
                  <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                    Cancel
                  </AlertDialog.Close>
                  <AlertDialog.Close
                    onClick={onDelete}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                  >
                    Delete
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

function ObservationForm({
  onSubmit,
  onCancel,
  isPending,
  projectId,
}: {
  onSubmit: (values: ObservationFormValues) => void;
  onCancel: () => void;
  isPending?: boolean;
  projectId: string;
}) {
  const [name, setName] = useState("");
  const [traceNames, setTraceNames] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [samplingRate, setSamplingRate] = useState(100);
  const [traceLimit, setTraceLimit] = useState<string>("");
  const [heuristics, setHeuristics] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const availableNames = trpc.traces.names.useQuery({ projectId });

  const filtered = (availableNames.data ?? []).filter(
    (n) => n.toLowerCase().includes(filter.toLowerCase()) && !traceNames.includes(n),
  );

  const toggle = (n: string) => {
    setTraceNames((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    );
  };

  const remove = (n: string) => setTraceNames((prev) => prev.filter((x) => x !== n));

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLimit = traceLimit ? parseInt(traceLimit, 10) : null;
    onSubmit({ name, traceNames, samplingRate, traceLimit: parsedLimit, heuristics });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Detect hallucinations, High latency spikes"
          required
          autoFocus
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
      </div>

      {/* Trace multiselect */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Traces
        </label>
        <p className="text-xs text-zinc-500 mb-1.5">
          Limit to specific trace names. Leave empty to monitor all traces.
        </p>

        {/* Selected tags */}
        {traceNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {traceNames.map((n) => (
              <span
                key={n}
                className="flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 pl-2 pr-1 py-0.5 text-xs text-zinc-200 font-mono"
              >
                {n}
                <button
                  type="button"
                  onClick={() => remove(n)}
                  className="rounded text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  <X size={10} weight="bold" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Dropdown trigger */}
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setDropdownOpen((v) => !v);
              setTimeout(() => filterRef.current?.focus(), 0);
            }}
            className="flex items-center justify-between w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-left transition-colors hover:border-zinc-600 focus:outline-none focus:border-zinc-500"
          >
            <span className={traceNames.length === 0 ? "text-zinc-500" : "text-zinc-100"}>
              {traceNames.length === 0
                ? "Select traces…"
                : `${traceNames.length} selected`}
            </span>
            <svg
              className={`w-4 h-4 text-zinc-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
              <div className="p-1.5 border-b border-zinc-800">
                <input
                  ref={filterRef}
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter traces…"
                  className="w-full bg-zinc-800 rounded px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
                />
              </div>
              <ul className="max-h-48 overflow-y-auto py-1">
                {availableNames.isLoading && (
                  <li className="px-3 py-2 text-xs text-zinc-500">Loading…</li>
                )}
                {!availableNames.isLoading && filtered.length === 0 && (
                  <li className="px-3 py-2 text-xs text-zinc-500">No traces found.</li>
                )}
                {filtered.map((n) => (
                  <li key={n}>
                    <button
                      type="button"
                      onClick={() => toggle(n)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left hover:bg-zinc-800 transition-colors"
                    >
                      <span
                        className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          traceNames.includes(n)
                            ? "border-zinc-400 bg-zinc-400"
                            : "border-zinc-600"
                        }`}
                      >
                        {traceNames.includes(n) && (
                          <Check size={10} weight="bold" className="text-zinc-900" />
                        )}
                      </span>
                      <span className="font-mono text-zinc-200 truncate">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Sampling rate */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-zinc-300">
            Sampling rate
          </label>
          <span className="text-sm font-mono text-zinc-400">{samplingRate}%</span>
        </div>
        <p className="text-xs text-zinc-500 mb-2">
          Percentage of matching traces the AI will analyze.
        </p>
        <input
          type="range"
          min={1}
          max={100}
          value={samplingRate}
          onChange={(e) => setSamplingRate(Number(e.target.value))}
          className="w-full accent-zinc-100 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
          <span>1%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Trace limit */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Stop after{" "}
          <span className="text-zinc-500 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-zinc-500 mb-1.5">
          Automatically pause this observation after evaluating this many traces.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={traceLimit}
            onChange={(e) => setTraceLimit(e.target.value)}
            placeholder="e.g. 100"
            className="w-32 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <span className="text-sm text-zinc-500">traces</span>
        </div>
      </div>

      {/* Heuristics */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Heuristics & context{" "}
          <span className="text-zinc-500 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-zinc-500 mb-1.5">
          Describe what to look for. Supports markdown. The AI uses this as guidance.
        </p>
        <textarea
          value={heuristics}
          onChange={(e) => setHeuristics(e.target.value)}
          placeholder={`## What to watch for\n- Unexpected refusals\n- Hallucinated facts\n- Unusually high token usage`}
          rows={5}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 font-mono resize-y"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          Create observation
        </button>
      </div>
    </form>
  );
}

// ── Danger ───────────────────────────────────────────────────────────

function DangerSection({
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
