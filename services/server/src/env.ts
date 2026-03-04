import "dotenv/config";

export const env = {
  betterAuthSecret:
    process.env.BETTER_AUTH_SECRET || "dev-secret-change-in-production",
  betterAuthUrl: process.env.BETTER_AUTH_URL || "http://localhost:3100",
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/breadcrumb",
  clickhouseUrl: process.env.CLICKHOUSE_URL || "http://localhost:8123",
  clickhouseDb: process.env.CLICKHOUSE_DB || "breadcrumb",
  clickhouseUser: process.env.CLICKHOUSE_USER || "default",
  clickhousePassword: process.env.CLICKHOUSE_PASSWORD || "",
  port: Number(process.env.PORT) || 3100,
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  nodeEnv: process.env.NODE_ENV || "development",
  allowPublicViewing: process.env.ALLOW_PUBLIC_VIEWING === "true",
  isBreadcrumbDemo: process.env.IS_BREADCRUMB_DEMO === "true",
};
