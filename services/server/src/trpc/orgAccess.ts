import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../db/index.js";
import { member, apiKeys } from "../db/schema.js";

/**
 * Throws FORBIDDEN unless the user is a global admin OR has one of the
 * specified org roles in the given organization.
 */
export async function requireOrgRole(
  userId: string,
  globalRole: string,
  organizationId: string,
  roles: string[]
): Promise<void> {
  if (globalRole === "admin") return;
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId))
    );
  if (!m || !roles.includes(m.role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

/**
 * Throws FORBIDDEN unless the user is a global admin OR a member of
 * the organization (any role).
 */
export async function requireOrgMember(
  userId: string,
  globalRole: string,
  organizationId: string
): Promise<void> {
  return requireOrgRole(userId, globalRole, organizationId, [
    "member",
    "admin",
    "owner",
  ]);
}

/** Resolves the organizationId for an API key, throws NOT_FOUND if missing. */
export async function getApiKeyOrg(keyId: string): Promise<string> {
  const [key] = await db
    .select({ projectId: apiKeys.projectId })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId));
  if (!key) throw new TRPCError({ code: "NOT_FOUND" });
  return key.projectId;
}

