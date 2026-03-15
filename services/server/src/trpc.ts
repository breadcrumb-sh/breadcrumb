import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "./shared/db/postgres.js";
import { member } from "./shared/db/schema.js";
import { env } from "./env.js";

export type TRPCContext = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  } | null;
  session: { id: string; userId: string } | null;
};

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson });

export const router = t.router;
export const procedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

// ── Org-scoped middleware ─────────────────────────────────────────────────────
// These expect the input to contain `projectId` (or `organizationId`).
// They resolve the org ID, check membership, and put `organizationId` on ctx.

const orgIdInput = z.object({
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
});

function resolveOrgId(input: z.infer<typeof orgIdInput>): string {
  const orgId = input.projectId ?? input.organizationId;
  if (!orgId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "projectId or organizationId is required",
    });
  }
  return orgId;
}

export async function checkOrgRole(
  userId: string,
  globalRole: string,
  organizationId: string,
  roles: string[],
): Promise<void> {
  if (globalRole === "admin") return;
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    );
  if (!m || !roles.includes(m.role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

/** Requires the caller to be any member of the org (or global admin). */
export const orgMemberProcedure = authedProcedure
  .input(orgIdInput)
  .use(async ({ ctx, input, next }) => {
    const organizationId = resolveOrgId(input);
    await checkOrgRole(ctx.user.id, ctx.user.role, organizationId, [
      "member",
      "admin",
      "owner",
    ]);
    return next({ ctx: { ...ctx, organizationId } });
  });

/** Requires the caller to be an admin or owner of the org (or global admin). */
export const orgAdminProcedure = authedProcedure
  .input(orgIdInput)
  .use(async ({ ctx, input, next }) => {
    const organizationId = resolveOrgId(input);
    await checkOrgRole(ctx.user.id, ctx.user.role, organizationId, [
      "admin",
      "owner",
    ]);
    return next({ ctx: { ...ctx, organizationId } });
  });

/**
 * Read-only org access. When ALLOW_PUBLIC_VIEWING is enabled, unauthenticated
 * users are treated as implicit viewers. Otherwise requires org membership.
 */
export const orgViewerProcedure = procedure
  .input(orgIdInput)
  .use(async ({ ctx, input, next }) => {
    const organizationId = resolveOrgId(input);
    if (!ctx.user) {
      if (env.allowPublicViewing) {
        return next({ ctx: { ...ctx, organizationId } });
      }
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    await checkOrgRole(ctx.user.id, ctx.user.role, organizationId, [
      "viewer",
      "member",
      "admin",
      "owner",
    ]);
    return next({ ctx: { ...ctx, organizationId } });
  });
