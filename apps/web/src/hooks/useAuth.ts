import { authClient } from "../lib/auth-client";
import { trpc } from "../lib/trpc";

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();
  const { data: config } = trpc.config.publicViewing.useQuery();

  const user = session?.user ?? null;
  // Better Auth returns additionalFields on the user object
  const role = (user as { role?: string } | null)?.role ?? "user";

  const isViewer = !user && !!config?.enabled;

  return {
    user,
    authenticated: !!user,
    isLoading: isPending,
    login: (email: string, password: string) =>
      authClient.signIn.email({ email, password }),
    logout: () => authClient.signOut(),
    role,
    isAdmin: role === "admin",
    isViewer,
  };
}
