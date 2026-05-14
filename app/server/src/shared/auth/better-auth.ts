import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/postgres.js";
import { env } from "../../env.js";
import { checkSignupAllowed, autoJoinOpenSignupOrgs } from "./signup-guard.js";
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
        },
        after: async (user) => {
          const data = user as Record<string, unknown>;
          log.info(
            { userId: data.id, email: data.email },
            "user created",
          );
          void trackUserSignedUp();
          // Auto-join open signup orgs as viewer
          if (typeof data.id === "string") {
            void autoJoinOpenSignupOrgs(data.id);
          }
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
