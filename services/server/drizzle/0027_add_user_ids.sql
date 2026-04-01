ALTER TABLE "monitor_items" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "monitor_comments" ADD COLUMN "author_id" text;--> statement-breakpoint
ALTER TABLE "monitor_activity" ADD COLUMN "actor_id" text;
