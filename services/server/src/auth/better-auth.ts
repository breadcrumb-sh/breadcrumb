import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { user as userTable } from "../db/schema.js";
import { env } from "../env.js";
import { checkSignupAllowed } from "./signup-guard.js";

export const auth = betterAuth({
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  trustedOrigins: [env.appBaseUrl, "http://localhost:3000", "http://localhost:5173"],
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: { enabled: true },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // cache for 5 minutes, then re-validate from DB
    },
  },
  plugins: [
    organization({
      sendInvitationEmail: async () => {
        // No-op: invitation URLs are surfaced via tRPC instead
      },
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          await checkSignupAllowed(user.email);
        },
        after: async (user) => {
          // First user becomes global admin
          const count = await db
            .select({ id: userTable.id })
            .from(userTable)
            .limit(2);
          if (count.length === 1) {
            await db
              .update(userTable)
              .set({ role: "admin" })
              .where(eq(userTable.id, user.id));
          }
        },
      },
    },
  },
});
