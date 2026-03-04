import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Logo } from "../components/common/logo/Logo";
import { authClient } from "../lib/auth-client";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await authClient.signUp.email({ email, password, name });
      if (result.error) {
        setError(result.error.message ?? "Failed to create account");
      } else {
        navigate({ to: "/" });
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm px-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900">
          {/* Brand header */}
          <div className="flex flex-col items-center gap-3 border-b border-zinc-800 px-8 py-8">
            <Logo className="size-5" />
            <span
              className="text-xs font-medium text-zinc-400"
              style={{ letterSpacing: "0.16em" }}
            >
              Breadcrumb
            </span>
          </div>

          {/* Form body */}
          <div className="px-8 py-8">
            <div className="mb-6">
              <h1 className="text-base font-semibold text-zinc-100">
                Create your account
              </h1>
              <p className="mt-0.5 text-sm text-zinc-500">
                Get started with LLM tracing
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                {loading ? "Creating account…" : "Create account"}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="border-t border-zinc-800 px-8 py-5">
            <p className="text-center text-xs text-zinc-500">
              Already have an account?{" "}
              <Link
                to="/login"
                className="text-zinc-300 underline underline-offset-4 transition-colors hover:text-zinc-100"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
