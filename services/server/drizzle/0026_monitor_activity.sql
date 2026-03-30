CREATE TABLE IF NOT EXISTS "monitor_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_item_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"from_status" varchar(32),
	"to_status" varchar(32),
	"actor" varchar(16) DEFAULT 'system' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "monitor_activity" ADD CONSTRAINT "monitor_activity_monitor_item_id_monitor_items_id_fk" FOREIGN KEY ("monitor_item_id") REFERENCES "public"."monitor_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitor_activity_item_id_idx" ON "monitor_activity" USING btree ("monitor_item_id");
