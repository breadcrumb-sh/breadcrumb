CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" varchar(255) NOT NULL,
	"account_type" varchar(16) NOT NULL,
	"account_id" integer NOT NULL,
	"account_avatar_url" text,
	"repository_selection" varchar(16) NOT NULL,
	"suspended_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "github_tracked_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_row_id" uuid NOT NULL,
	"repo_id" integer NOT NULL,
	"owner_login" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"full_name" varchar(512) NOT NULL,
	"default_branch" varchar(255),
	"is_private" boolean NOT NULL,
	"html_url" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_tracked_repos_install_repo_uniq" UNIQUE("installation_row_id","repo_id")
);
--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_tracked_repos" ADD CONSTRAINT "github_tracked_repos_installation_row_id_github_installations_id_fk" FOREIGN KEY ("installation_row_id") REFERENCES "public"."github_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_installations_installation_idx" ON "github_installations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_tracked_repos_install_idx" ON "github_tracked_repos" USING btree ("installation_row_id");