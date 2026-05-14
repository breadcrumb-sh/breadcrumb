ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "agent_monthly_cost_limit_cents" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "agent_scan_interval_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN IF EXISTS "agent_daily_token_limit";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "month" varchar(7) NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cost_cents" integer DEFAULT 0 NOT NULL,
  "calls" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "agent_usage_project_month" UNIQUE("project_id", "month")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_usage_project_id_idx" ON "agent_usage" ("project_id");
