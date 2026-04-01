ALTER TABLE "project" ADD COLUMN "agent_monthly_cost_limit_cents" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "agent_scan_interval_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN IF EXISTS "agent_daily_token_limit";--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "cost_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_usage" RENAME COLUMN "date" TO "month";--> statement-breakpoint
ALTER TABLE "agent_usage" DROP CONSTRAINT "agent_usage_project_date";--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_project_month" UNIQUE("project_id", "month");
