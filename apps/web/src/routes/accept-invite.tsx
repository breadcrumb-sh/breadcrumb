import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Logo } from "../components/common/logo/Logo";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: z.object({ token: z.string() }),
  component: AcceptInvitePage,
});

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm px-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900">
          <div className="flex flex-col items-center gap-3 border-b border-zinc-800 px-8 py-8">
            <Logo className="size-5" />
            <span
              className="text-xs font-medium text-zinc-400"
              style={{ letterSpacing: "0.16em" }}
            >
              Breadcrumb
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function AutoAccept({ token }: { token: string }) {
  const navigate = useNavigate();
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    authClient.organization
      .acceptInvitation({ invitationId: token })
      .finally(() => navigate({ to: "/" }));
  }, [token, navigate]);

  return null;
}

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const { data: session, isPending } = authClient.useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (isPending) return null;

  // Already signed in — auto-accept on mount, no button needed
  if (session) {
    return <AutoAccept token={token} />;
  }

  // Not signed in — show signup form
  // After signup/signin succeeds the session updates, the component re-renders,
  // and AutoAccept handles the single acceptance call.
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const signUpResult = await authClient.signUp.email({
        email,
        password,
        name,
      });
      if (signUpResult.error) {
        // Account may already exist — try signing in instead
        const signInResult = await authClient.signIn.email({ email, password });
        if (signInResult.error) {
          setError(signInResult.error.message ?? "Failed to sign in");
        }
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="px-8 py-8">
        <div className="mb-6">
          <h1 className="text-base font-semibold text-zinc-100">
            You&apos;re invited
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Create an account to accept your invitation.
          </p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              autoFocus
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-400">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={8}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500"
            />
          </div>

          {error && (
            <p className="rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200 disabled:opacity-40"
          >
            {loading ? "Creating account…" : "Create account & accept"}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
