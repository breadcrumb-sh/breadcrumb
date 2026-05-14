ALTER TABLE "observation_findings" DROP CONSTRAINT "observation_findings_observation_id_observations_id_fk";--> statement-breakpoint
ALTER TABLE "observation_findings" ALTER COLUMN "observation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "observation_findings" ADD CONSTRAINT "observation_findings_observation_id_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."observations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
