ALTER TABLE "observations" ADD COLUMN "trace_limit" integer;--> statement-breakpoint
ALTER TABLE "observations" ADD COLUMN "traces_evaluated" integer DEFAULT 0 NOT NULL;
