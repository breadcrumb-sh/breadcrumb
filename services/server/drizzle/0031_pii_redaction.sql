CREATE TABLE IF NOT EXISTS "pii_redaction_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"phone" boolean DEFAULT true NOT NULL,
	"ssn" boolean DEFAULT true NOT NULL,
	"credit_card" boolean DEFAULT true NOT NULL,
	"ip_address" boolean DEFAULT true NOT NULL,
	"date_of_birth" boolean DEFAULT true NOT NULL,
	"us_address" boolean DEFAULT true NOT NULL,
	"api_key" boolean DEFAULT true NOT NULL,
	"url" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pii_redaction_settings" ADD CONSTRAINT "pii_redaction_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "pii_redaction_settings" ADD CONSTRAINT "pii_redaction_settings_project_id_unique" UNIQUE("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pii_custom_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"label" varchar(64) NOT NULL,
	"pattern" varchar(512) NOT NULL,
	"replacement" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pii_custom_patterns" ADD CONSTRAINT "pii_custom_patterns_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pii_custom_patterns_project_id_idx" ON "pii_custom_patterns" USING btree ("project_id");
