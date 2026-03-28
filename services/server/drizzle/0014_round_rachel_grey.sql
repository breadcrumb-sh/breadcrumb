CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"auto_analyze" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "project_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "ai_providers" DROP CONSTRAINT "ai_providers_project_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_project_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "explores" DROP CONSTRAINT "explores_project_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "observation_findings" DROP CONSTRAINT "observation_findings_project_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "observation_views" DROP CONSTRAINT "observation_views_project_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "observations" DROP CONSTRAINT "observations_project_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "starred_charts" DROP CONSTRAINT "starred_charts_project_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "trace_summaries" DROP CONSTRAINT "trace_summaries_project_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "project" ("id", "organization_id", "name", "slug", "timezone", "auto_analyze", "created_at")
SELECT "id", "id", "name", "slug", COALESCE("timezone", 'UTC'), COALESCE("auto_analyze", false), "created_at"
FROM "organization";--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explores" ADD CONSTRAINT "explores_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_findings" ADD CONSTRAINT "observation_findings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_views" ADD CONSTRAINT "observation_views_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_charts" ADD CONSTRAINT "starred_charts_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_summaries" ADD CONSTRAINT "trace_summaries_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "auto_analyze";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "role";