import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CLICKHOUSE_URL: z.string().default("http://localhost:8123"),
  CLICKHOUSE_DB: z.string().default("breadcrumb"),
  CLICKHOUSE_USER: z.string().default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(""),
  CLICKHOUSE_READONLY_USER: z.string().optional(),
  CLICKHOUSE_READONLY_PASSWORD: z.string().optional(),
  PORT: z.coerce.number().default(3100),
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required"),
  NODE_ENV: z.string().default("development"),
  ALLOW_OPEN_SIGNUP: z.string().default(""),
  ALLOW_ORG_CREATION: z.string().default("true"),
  IS_BREADCRUMB_DEMO: z.string().default("false"),
  DISABLE_TELEMETRY: z.string().default("false"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const p = parsed.data;

export const env = {
  betterAuthSecret: p.BETTER_AUTH_SECRET,
  appBaseUrl: p.APP_BASE_URL,
  databaseUrl: p.DATABASE_URL,
  clickhouseUrl: p.CLICKHOUSE_URL,
  clickhouseDb: p.CLICKHOUSE_DB,
  clickhouseUser: p.CLICKHOUSE_USER,
  clickhousePassword: p.CLICKHOUSE_PASSWORD,
  clickhouseReadonlyUser: p.CLICKHOUSE_READONLY_USER,
  clickhouseReadonlyPassword: p.CLICKHOUSE_READONLY_PASSWORD,
  port: p.PORT,
  encryptionKey: p.ENCRYPTION_KEY,
  nodeEnv: p.NODE_ENV,
  allowOpenSignupOrgIds: p.ALLOW_OPEN_SIGNUP
    ? p.ALLOW_OPEN_SIGNUP.split(",").map((s) => s.trim()).filter(Boolean)
    : [],
  allowOrgCreation: p.ALLOW_ORG_CREATION === "true",
  isBreadcrumbDemo: p.IS_BREADCRUMB_DEMO === "true",
  disableTelemetry: p.DISABLE_TELEMETRY === "true",
};
