import { trpc } from "../lib/trpc";
import { useAuth } from "./useAuth";

export function useOrgRole(organizationId: string) {
  const { user } = useAuth();
  const members = trpc.members.list.useQuery({ organizationId });

  const myRole = members.data?.find((m) => m.userId === user?.id)?.role;

  return {
    role: myRole,
    isOwner: myRole === "owner",
    isAdmin: myRole === "admin" || myRole === "owner",
    isMember:
      myRole === "member" || myRole === "admin" || myRole === "owner",
    isViewer:
      myRole === "viewer" ||
      myRole === "member" ||
      myRole === "admin" ||
      myRole === "owner",
    isLoading: members.isLoading,
  };
}
