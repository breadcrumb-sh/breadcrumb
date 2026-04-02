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

// ── Projects (child of organization) ────────────────────────────────

export const project = pgTable("project", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  agentMemory: text("agent_memory").notNull().default(""),
  agentMonthlyCostLimitCents: integer("agent_monthly_cost_limit_cents").notNull().default(1000), // stored in cents, default $10
  agentScanIntervalSeconds: integer("agent_scan_interval_seconds").notNull().default(3600), // minimum seconds between auto scans, default 60 min
  createdAt: timestamp("created_at").notNull(),
});

// ── Agent scan runs ─────────────────────────────────────────────────

export const monitorScanRuns = pgTable(
  "monitor_scan_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).notNull(), // running | success | empty | skipped | error
    ticketsCreated: integer("tickets_created").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("monitor_scan_runs_project_idx").on(t.projectId)],
);

// ── Agent usage tracking ────────────────────────────────────────────

export const agentUsage = pgTable(
  "agent_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    month: varchar("month", { length: 7 }).notNull(), // YYYY-MM
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0), // cost in cents
    calls: integer("calls").notNull().default(0),
  },
  (t) => [
    unique("agent_usage_project_month").on(t.projectId, t.month),
    index("agent_usage_project_id_idx").on(t.projectId),
  ],
);

// ── Application tables ───────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
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
    .references(() => project.id, { onDelete: "cascade" }),
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



// ── PII redaction settings ─────────────────────────────────────────

export const piiRedactionSettings = pgTable("pii_redaction_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: text("project_id")
    .notNull()
    .unique()
    .references(() => project.id, { onDelete: "cascade" }),
  email: boolean("email").notNull().default(true),
  phone: boolean("phone").notNull().default(true),
  ssn: boolean("ssn").notNull().default(true),
  creditCard: boolean("credit_card").notNull().default(true),
  ipAddress: boolean("ip_address").notNull().default(true),
  dateOfBirth: boolean("date_of_birth").notNull().default(true),
  usAddress: boolean("us_address").notNull().default(true),
  apiKey: boolean("api_key").notNull().default(true),
  url: boolean("url").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const piiCustomPatterns = pgTable(
  "pii_custom_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 64 }).notNull(),
    pattern: varchar("pattern", { length: 512 }).notNull(),
    replacement: varchar("replacement", { length: 64 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("pii_custom_patterns_project_id_idx").on(t.projectId)],
);

// ── Monitor items (agent kanban) ────────────────────────────────────

export const monitorItems = pgTable(
  "monitor_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    source: varchar("source", { length: 16 }).notNull().default("user"), // user | agent
    status: varchar("status", { length: 32 }).notNull().default("queue"), // queue | investigating | review | done
    priority: varchar("priority", { length: 16 }).notNull().default("none"), // none | low | medium | high | critical
    traceNames: jsonb("trace_names").$type<string[]>().notNull().default([]), // linked trace name identifiers
    note: text("note").notNull().default(""), // agent's working scratchpad
    processing: boolean("processing").notNull().default(false),
    read: boolean("read").notNull().default(true),
    dismissed: boolean("dismissed").notNull().default(false),
    createdById: text("created_by_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("monitor_items_project_id_idx").on(t.projectId)],
);

export const monitorComments = pgTable(
  "monitor_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorItemId: uuid("monitor_item_id")
      .notNull()
      .references(() => monitorItems.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 16 }).notNull(), // user | agent
    authorId: text("author_id"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("monitor_comments_item_id_idx").on(t.monitorItemId)],
);

// ── Monitor labels ─────────────────────────────────────────────────

export const monitorLabels = pgTable(
  "monitor_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 64 }).notNull(),
    color: varchar("color", { length: 7 }).notNull(), // hex e.g. #ef4444
  },
  (t) => [index("monitor_labels_project_id_idx").on(t.projectId)],
);

export const monitorItemLabels = pgTable(
  "monitor_item_labels",
  {
    monitorItemId: uuid("monitor_item_id")
      .notNull()
      .references(() => monitorItems.id, { onDelete: "cascade" }),
    monitorLabelId: uuid("monitor_label_id")
      .notNull()
      .references(() => monitorLabels.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("monitor_item_labels_item_idx").on(t.monitorItemId),
    index("monitor_item_labels_label_idx").on(t.monitorLabelId),
  ],
);

// ── Monitor activity ──────────────────────────────────────────────

export const monitorActivity = pgTable(
  "monitor_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorItemId: uuid("monitor_item_id")
      .notNull()
      .references(() => monitorItems.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(), // created | status_change | processing_started | processing_finished | dismissed
    fromStatus: varchar("from_status", { length: 32 }),
    toStatus: varchar("to_status", { length: 32 }),
    actor: varchar("actor", { length: 16 }).notNull().default("system"), // user | agent | system
    actorId: text("actor_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("monitor_activity_item_id_idx").on(t.monitorItemId)],
);

// ── Webhook integrations ────────────────────────────────────────────

export const webhookIntegrations = pgTable(
  "webhook_integration",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 16 }).notNull(), // slack | discord
    url: text("url").notNull(),
    minPriority: varchar("min_priority", { length: 16 }).notNull().default("all"), // all | low | medium | high | critical
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("webhook_integration_project_channel_uniq").on(t.projectId, t.channel),
    index("webhook_integration_project_idx").on(t.projectId),
  ],
);

