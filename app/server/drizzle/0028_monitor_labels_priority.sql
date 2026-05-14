ALTER TABLE "monitor_items" ADD COLUMN "priority" varchar(16) DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monitor_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(64) NOT NULL,
	"color" varchar(7) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monitor_item_labels" (
	"monitor_item_id" uuid NOT NULL,
	"monitor_label_id" uuid NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "monitor_labels" ADD CONSTRAINT "monitor_labels_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "monitor_item_labels" ADD CONSTRAINT "monitor_item_labels_monitor_item_id_monitor_items_id_fk" FOREIGN KEY ("monitor_item_id") REFERENCES "public"."monitor_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "monitor_item_labels" ADD CONSTRAINT "monitor_item_labels_monitor_label_id_monitor_labels_id_fk" FOREIGN KEY ("monitor_label_id") REFERENCES "public"."monitor_labels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitor_labels_project_id_idx" ON "monitor_labels" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitor_item_labels_item_idx" ON "monitor_item_labels" USING btree ("monitor_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "monitor_item_labels_label_idx" ON "monitor_item_labels" USING btree ("monitor_label_id");
