ALTER TABLE "monitor_items" ADD COLUMN "trace_names" jsonb DEFAULT '[]'::jsonb NOT NULL;
