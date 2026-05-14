import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { Logo } from "../../components/common/logo/Logo";
import { AppHeader } from "../../components/layout/AppHeader";
import { OrgSwitcher } from "../../components/layout/OrgSwitcher";

export const Route = createFileRoute("/_authed/new-org")({
  component: NewOrgPage,
});

function NewOrgPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");

  const utils = trpc.useUtils();
  const createOrg = trpc.organizations.create.useMutation({
    onSuccess: (org) => {
      utils.organizations.list.invalidate();
      navigate({ to: "/org/$orgId", params: { orgId: org.id } });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createOrg.mutate({ name });
  };

  return (
    <div className="flex h-screen flex-col">
      <AppHeader>
        <Link to="/" className="flex items-center hover:opacity-80 transition-opacity shrink-0">
          <Logo className="size-5" />
        </Link>
        <OrgSwitcher currentOrgName="New organization" />
      </AppHeader>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Create an organization</h2>
            <p className="text-sm text-zinc-400">
              Organizations contain your projects and team members.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Organization name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Company"
                required
                autoFocus
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>
            {createOrg.error && (
              <p className="text-sm text-red-400">{createOrg.error.message}</p>
            )}
            <button
              type="submit"
              disabled={createOrg.isPending}
              className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {createOrg.isPending ? "Creating…" : "Create organization"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
