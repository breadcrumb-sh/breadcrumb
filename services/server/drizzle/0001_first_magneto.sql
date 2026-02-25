CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"provider" varchar(32) NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"api_key_mask" varchar(64) NOT NULL,
	"model_id" varchar(255) NOT NULL,
	"base_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_project_id_organization_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;