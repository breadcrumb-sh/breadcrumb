CREATE TABLE "model_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"model" varchar(255) NOT NULL,
	"provider" varchar(32),
	"input_per_million_usd" numeric DEFAULT '0' NOT NULL,
	"output_per_million_usd" numeric DEFAULT '0' NOT NULL,
	"cache_read_per_million_usd" numeric,
	"cache_write_per_million_usd" numeric,
	"reasoning_per_million_usd" numeric,
	"source" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_rates_project_model_uniq" UNIQUE("project_id","model")
);
--> statement-breakpoint
ALTER TABLE "model_rates" ADD CONSTRAINT "model_rates_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_rates_project_idx" ON "model_rates" USING btree ("project_id");