CREATE TABLE IF NOT EXISTS "webhook_integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"channel" varchar(16) NOT NULL,
	"url" text NOT NULL,
	"min_priority" varchar(16) DEFAULT 'all' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_integration" ADD CONSTRAINT "webhook_integration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "webhook_integration" ADD CONSTRAINT "webhook_integration_project_channel_uniq" UNIQUE("project_id", "channel");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_integration_project_idx" ON "webhook_integration" USING btree ("project_id");
