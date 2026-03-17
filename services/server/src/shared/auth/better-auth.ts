import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/postgres.js";
import { user as userTable } from "../db/schema.js";
import { env } from "../../env.js";
import { checkSignupAllowed } from "./signup-guard.js";
import { createLogger } from "../lib/logger.js";
import { trackUserSignedUp } from "../lib/telemetry.js";

const log = createLogger("auth");

export const auth = betterAuth({
  secret: env.betterAuthSecret,
  baseURL: env.appBaseUrl,
  trustedOrigins: [
    env.appBaseUrl,
    ...(env.nodeEnv === "development"
      ? ["http://localhost:3000", "http://localhost:5173"]
      : []),
  ],
  advanced: {
    // Behind a TLS-terminating reverse proxy (e.g. Railway) the raw request
    // is HTTP. These two settings fix the resulting CSRF / cookie issues:
    // 1. useSecureCookies — force Secure flag so cookies work over HTTPS
    // 2. useSecureCookies also tells Better Auth the real protocol is HTTPS,
    //    preventing Origin (https://) vs request-URL (http://) CSRF mismatches
    ...(env.nodeEnv === "production" && { useSecureCookies: true }),
  },
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: { enabled: true },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      "/api/auth/sign-in/email": { window: 60, max: 5 },
      "/api/auth/sign-up/email": { window: 60, max: 3 },
      "/api/auth/change-password": { window: 60, max: 3 },
      "/api/auth/change-email": { window: 60, max: 3 },
    },
  },
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
    session: {
      create: {
        after: async (session) => {
          const data = session as Record<string, unknown>;
          log.info(
            { userId: data.userId, sessionId: data.id },
            "session created",
          );
        },
      },
    },
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
        after: async (user) => {
          const data = user as Record<string, unknown>;
          log.info(
            {
              userId: data.id,
              email: data.email,
              isAdmin: data.role === "admin",
            },
            "user created",
          );
          void trackUserSignedUp();
        },
      },
      update: {
        after: async (user) => {
          const data = user as Record<string, unknown>;
          log.info(
            { userId: data.id, email: data.email },
            "user updated",
          );
        },
      },
    },
  },
});
