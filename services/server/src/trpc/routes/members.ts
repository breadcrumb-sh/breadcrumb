import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, orgMemberProcedure, checkOrgRole } from "../trpc.js";
import { db } from "../../db/index.js";
import { member, user } from "../../db/schema.js";

export const membersRouter = router({
  list: orgMemberProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: member.id,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          email: user.email,
          name: user.name,
        })
        .from(member)
        .leftJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, input.organizationId));
    }),

  remove: authedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [m] = await db
        .select()
        .from(member)
        .where(eq(member.id, input.memberId));
      if (!m) throw new TRPCError({ code: "NOT_FOUND" });
      await checkOrgRole(ctx.user.id, ctx.user.role, m.organizationId, [
        "owner",
        "admin",
      ]);
      await db.delete(member).where(eq(member.id, input.memberId));
    }),
});
