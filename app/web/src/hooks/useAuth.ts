import { authClient } from "../lib/auth-client";
import { trpc } from "../lib/trpc";

export function useAuth() {
  const { data: session, isPending } = authClient.useSession();
  const { data: config } = trpc.config.instance.useQuery();

  const user = session?.user ?? null;

  return {
    user,
    authenticated: !!user,
    isLoading: isPending,
    login: (email: string, password: string) =>
      authClient.signIn.email({ email, password }),
    logout: () => authClient.signOut(),
    allowOrgCreation: config?.allowOrgCreation ?? true,
    allowOpenSignup: config?.allowOpenSignup ?? false,
    isDemo: config?.isDemo ?? false,
  };
}
