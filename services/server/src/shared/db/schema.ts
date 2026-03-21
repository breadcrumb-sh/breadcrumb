import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  boolean,
  unique,
  jsonb,
  index,
  integer,
} from "drizzle-orm/pg-core";

// ── Instance settings (KV) ───────────────────────────────────────────

export const instanceSettings = pgTable("instance_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// ── Better Auth core tables ──────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  role: text("role").notNull().default("user"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

// ── Better Auth organization plugin tables ───────────────────────────

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull(),
  metadata: text("metadata"),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  autoAnalyze: boolean("auto_analyze").notNull().default(false),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [unique("member_org_user_unique").on(t.organizationId, t.userId)]
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// ── Application tables ───────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  apiKeyMask: varchar("api_key_mask", { length: 64 }).notNull(),
  modelId: varchar("model_id", { length: 255 }).notNull(),
  baseUrl: text("base_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const cache = pgTable(
  "cache",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("cache_expires_at_idx").on(t.expiresAt)]
);

export const mcpKeys = pgTable("mcp_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Explores (conversation-based) ───────────────────────────────────

export const explores = pgTable("explores", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  traceId: text("trace_id"),
  messages: jsonb("messages").default([]).notNull(), // AI SDK CoreMessage[]
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
},
  (t) => [
    index("explores_project_id_idx").on(t.projectId),
    index("explores_trace_id_idx").on(t.traceId),
  ],
);

export const observations = pgTable(
  "observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    traceNames: jsonb("trace_names").$type<string[]>().default([]).notNull(),
    samplingRate: integer("sampling_rate").notNull().default(100), // 1-100
    traceLimit: integer("trace_limit"), // optional stop-after-N-traces
    tracesEvaluated: integer("traces_evaluated").notNull().default(0),
    heuristics: text("heuristics"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("observations_project_id_idx").on(t.projectId)],
);

export const observationViews = pgTable("observation_views", {
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  lastViewedAt: timestamp("last_viewed_at").notNull(),
}, (t) => [
  { name: "observation_views_pkey", columns: [t.userId, t.projectId] },
]);

export const observationFindings = pgTable(
  "observation_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    observationId: uuid("observation_id")
      .references(() => observations.id, { onDelete: "set null" }),
    projectId: text("project_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    referenceTraceId: text("reference_trace_id").notNull(),
    impact: varchar("impact", { length: 16 }).notNull(), // 'low' | 'medium' | 'high'
    title: text("title").notNull(),
    description: text("description").notNull(),
    suggestion: text("suggestion"),
    dismissed: boolean("dismissed").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("findings_project_id_idx").on(t.projectId),
    index("findings_observation_id_idx").on(t.observationId),
  ],
);

export const traceSummaries = pgTable(
  "trace_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    traceId: text("trace_id").notNull(),
    markdown: text("markdown").notNull().default(""),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | running | done | error
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("trace_summaries_project_trace_unique").on(t.projectId, t.traceId),
    index("trace_summaries_project_id_idx").on(t.projectId),
  ],
);

export const starredCharts = pgTable("starred_charts", {
  id: uuid("id").primaryKey().defaultRandom(),
  exploreId: uuid("explore_id")
    .notNull()
    .references(() => explores.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }),
  chartType: varchar("chart_type", { length: 32 }),
  sql: text("sql"),
  xKey: varchar("x_key", { length: 64 }),
  yKeys: jsonb("y_keys"),
  legend: jsonb("legend"),
  /** Default lookback window in days (7, 30, or 90) set by the AI. Users can override on the dashboard. */
  defaultDays: integer("default_days"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
},
  (t) => [index("starred_charts_project_id_idx").on(t.projectId)],
);
