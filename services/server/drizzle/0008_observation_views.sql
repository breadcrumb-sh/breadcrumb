CREATE TABLE "observation_views" (
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"last_viewed_at" timestamp NOT NULL,
	CONSTRAINT "observation_views_pkey" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "observation_views" ADD CONSTRAINT "observation_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observation_views" ADD CONSTRAINT "observation_views_project_id_organization_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
