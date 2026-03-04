CREATE TABLE "explores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "starred_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"explore_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"title" varchar(255),
	"chart_type" varchar(32),
	"sql" text,
	"x_key" varchar(64),
	"y_keys" jsonb,
	"legend" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "explores" ADD CONSTRAINT "explores_project_id_organization_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_charts" ADD CONSTRAINT "starred_charts_explore_id_explores_id_fk" FOREIGN KEY ("explore_id") REFERENCES "public"."explores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "starred_charts" ADD CONSTRAINT "starred_charts_project_id_organization_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;