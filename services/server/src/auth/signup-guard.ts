import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { user as userTable, invitation } from "../db/schema.js";

/**
 * Throws if the given email is not allowed to create a new account.
 *
 * The very first user (who becomes global admin) is always allowed through.
 * Every subsequent signup requires a valid, non-expired pending invitation.
 */
export async function checkSignupAllowed(email: string): Promise<void> {
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .limit(1);

  if (!existing) return; // first user — no restriction

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
