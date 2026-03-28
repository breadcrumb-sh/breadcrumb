import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/postgres.js";
import { user as userTable, invitation, member } from "../db/schema.js";
import { env } from "../../env.js";

/**
 * Throws if the given email is not allowed to create a new account.
 *
 * The very first user is always allowed through (bootstrap).
 * If ALLOW_OPEN_SIGNUP lists org IDs, anyone can sign up.
 * Otherwise, signup requires a valid, non-expired pending invitation.
 */
export async function checkSignupAllowed(email: string): Promise<void> {
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .limit(1);

  if (!existing) return; // first user — no restriction

  // Open signup enabled — anyone can sign up
  if (env.allowOpenSignupOrgIds.length > 0) return;

  const [inv] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.email, email),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      )
    )
    .limit(1);

  if (!inv) {
    throw new Error("Sign-up requires a valid invitation.");
  }
}

/**
 * After a user is created via open signup, auto-add them as viewer
 * to each org listed in ALLOW_OPEN_SIGNUP.
 */
export async function autoJoinOpenSignupOrgs(userId: string): Promise<void> {
  if (env.allowOpenSignupOrgIds.length === 0) return;

  for (const orgId of env.allowOpenSignupOrgIds) {
    await db
      .insert(member)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId,
        role: "viewer",
        createdAt: new Date(),
      })
      .onConflictDoNothing();
  }
}
