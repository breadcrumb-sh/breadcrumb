CREATE TABLE "trace_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trace_summaries_project_trace_unique" UNIQUE("project_id","trace_id")
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "auto_analyze" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trace_summaries" ADD CONSTRAINT "trace_summaries_project_id_organization_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trace_summaries_project_id_idx" ON "trace_summaries" USING btree ("project_id");