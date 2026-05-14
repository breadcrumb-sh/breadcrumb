ALTER TABLE "explores" ADD COLUMN "trace_id" text;--> statement-breakpoint
CREATE INDEX "explores_trace_id_idx" ON "explores" USING btree ("trace_id");