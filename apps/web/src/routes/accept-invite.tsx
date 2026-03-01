import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Logo } from "../components/common/logo/Logo";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: z.object({ token: z.string() }),
  component: AcceptInvitePage,
});

const authPageStyle = `
  @keyframes auth-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .auth-card { animation: auth-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .auth-input { transition: border-color 0.15s ease, box-shadow 0.15s ease; }
  .auth-input:focus {
    outline: none;
    border-color: var(--color-zinc-500);
    box-shadow: 0 0 0 3px rgba(122, 117, 112, 0.12);
  }
`;

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{authPageStyle}</style>
      <div className="relative flex min-h-screen items-center justify-center bg-zinc-950 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.032) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 65% 55% at 50% 25%, rgba(175,148,100,0.07) 0%, transparent 70%)",
          }}
        />
        <div className="auth-card relative z-10 w-full max-w-sm px-4">
          <div
            className="rounded-lg border border-zinc-700 bg-zinc-900"
            style={{
              boxShadow:
                "0 8px 32px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.06) inset",
            }}
          >
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
    </>
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
  }, [token]);

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
              className="auth-input w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600"
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
              className="auth-input w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600"
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
              className="auth-input w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600"
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
