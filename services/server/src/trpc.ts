import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "./shared/db/postgres.js";
import { member, project } from "./shared/db/schema.js";
import { trackSlowTrpcRequest, trackEvent } from "./shared/lib/telemetry.js";

export type TRPCContext = {
  user: {
    id: string;
    email: string;
    name: string;
  } | null;
  session: { id: string; userId: string } | null;
};

const t = initTRPC.context<TRPCContext>().create({ transformer: superjson });

export const router = t.router;

const EXPECTED_CODES = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "CONFLICT"]);

const timingMiddleware = t.middleware(async ({ path, next }) => {
  const start = performance.now();
  const result = await next();
  const durationMs = performance.now() - start;
  trackSlowTrpcRequest(path, durationMs, result.ok);
  if (!result.ok) {
    const code = result.error.code ?? "INTERNAL_SERVER_ERROR";
    if (!EXPECTED_CODES.has(code)) {
      trackEvent("server_error", { procedure: path, error_code: code });
    }
  }
  return result;
});

export const procedure = t.procedure.use(timingMiddleware);

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ── Org-scoped middleware ─────────────────────────────────────────────────────
// These expect the input to contain `organizationId`.
// They resolve the org ID, check membership, and put `organizationId` on ctx.

const orgIdInput = z.object({
  organizationId: z.string(),
});

export async function checkOrgRole(
  userId: string,
  organizationId: string,
  roles: string[],
): Promise<void> {
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

/** Requires the caller to be any member of the org. */
export const orgMemberProcedure = authedProcedure
  .input(orgIdInput)
  .use(async ({ ctx, input, next }) => {
    await checkOrgRole(ctx.user.id, input.organizationId, [
      "member",
      "admin",
      "owner",
    ]);
    return next({ ctx: { ...ctx, organizationId: input.organizationId } });
  });

/** Requires the caller to be an admin or owner of the org. */
export const orgAdminProcedure = authedProcedure
  .input(orgIdInput)
  .use(async ({ ctx, input, next }) => {
    await checkOrgRole(ctx.user.id, input.organizationId, [
      "admin",
      "owner",
    ]);
    return next({ ctx: { ...ctx, organizationId: input.organizationId } });
  });

/** Requires the caller to be at least a viewer of the org. */
export const orgViewerProcedure = authedProcedure
  .input(orgIdInput)
  .use(async ({ ctx, input, next }) => {
    await checkOrgRole(ctx.user.id, input.organizationId, [
      "viewer",
      "member",
      "admin",
      "owner",
    ]);
    return next({ ctx: { ...ctx, organizationId: input.organizationId } });
  });

// ── Project-scoped middleware ─────────────────────────────────────────────────
// These expect the input to contain `projectId`.
// They resolve the project's org, check membership, and put both IDs on ctx.

const projectIdInput = z.object({ projectId: z.string() });

async function resolveProject(projectId: string): Promise<{ organizationId: string }> {
  const [p] = await db
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, projectId));
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  return p;
}

/** Requires the caller to be any member of the project's org. */
export const projectMemberProcedure = authedProcedure
  .input(projectIdInput)
  .use(async ({ ctx, input, next }) => {
    const { organizationId } = await resolveProject(input.projectId);
    await checkOrgRole(ctx.user.id, organizationId, ["member", "admin", "owner"]);
    return next({ ctx: { ...ctx, organizationId, projectId: input.projectId } });
  });

/** Requires the caller to be an admin or owner of the project's org. */
export const projectAdminProcedure = authedProcedure
  .input(projectIdInput)
  .use(async ({ ctx, input, next }) => {
    const { organizationId } = await resolveProject(input.projectId);
    await checkOrgRole(ctx.user.id, organizationId, ["admin", "owner"]);
    return next({ ctx: { ...ctx, organizationId, projectId: input.projectId } });
  });

/** Requires the caller to be at least a viewer of the project's org. */
export const projectViewerProcedure = authedProcedure
  .input(projectIdInput)
  .use(async ({ ctx, input, next }) => {
    const { organizationId } = await resolveProject(input.projectId);
    await checkOrgRole(ctx.user.id, organizationId, ["viewer", "member", "admin", "owner"]);
    return next({ ctx: { ...ctx, organizationId, projectId: input.projectId } });
  });
