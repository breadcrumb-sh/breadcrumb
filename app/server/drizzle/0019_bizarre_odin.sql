CREATE TABLE "monitor_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_item_id" uuid NOT NULL,
	"source" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitor_items" ADD COLUMN "source" varchar(16) DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitor_comments" ADD CONSTRAINT "monitor_comments_monitor_item_id_monitor_items_id_fk" FOREIGN KEY ("monitor_item_id") REFERENCES "public"."monitor_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitor_comments_item_id_idx" ON "monitor_comments" USING btree ("monitor_item_id");