CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"trace_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sampling_rate" integer DEFAULT 100 NOT NULL,
	"heuristics" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_project_id_organization_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "observations_project_id_idx" ON "observations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "explores_project_id_idx" ON "explores" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "starred_charts_project_id_idx" ON "starred_charts" USING btree ("project_id");