CREATE TABLE "observation_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"reference_trace_id" text NOT NULL,
	"impact" varchar(16) NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"suggestion" text,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "observation_findings" ADD CONSTRAINT "observation_findings_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_findings" ADD CONSTRAINT "observation_findings_project_id_organization_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_project_id_idx" ON "observation_findings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "findings_observation_id_idx" ON "observation_findings" USING btree ("observation_id");
