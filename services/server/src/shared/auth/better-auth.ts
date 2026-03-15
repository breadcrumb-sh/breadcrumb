import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/postgres.js";
import { user as userTable } from "../db/schema.js";
import { env } from "../../env.js";
import { checkSignupAllowed } from "./signup-guard.js";

export const auth = betterAuth({
  secret: env.betterAuthSecret,
  baseURL: env.appBaseUrl,
  trustedOrigins: [
    env.appBaseUrl,
    ...(env.nodeEnv === "development"
      ? ["http://localhost:3000", "http://localhost:5173"]
      : []),
  ],
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
          // First user to sign up becomes admin — checked before creation
          // so the role is set correctly when the session is established.
          const existing = await db
            .select({ id: userTable.id })
            .from(userTable)
            .limit(1);
          if (existing.length === 0) {
            return { data: { ...user, role: "admin" } };
          }
        },
      },
    },
  },
});
