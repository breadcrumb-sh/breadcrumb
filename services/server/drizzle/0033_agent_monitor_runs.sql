CREATE TABLE "monitor_scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"tickets_created" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "monitor_scan_runs" ADD CONSTRAINT "monitor_scan_runs_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitor_scan_runs_project_idx" ON "monitor_scan_runs" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "agent_last_scan_at";