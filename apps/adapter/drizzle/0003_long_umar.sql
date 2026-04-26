ALTER TABLE "cron_jobs" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN "source_flow_id" uuid;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN "source_flow_version" integer;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN "source_node_id" text;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_source_flow_id_flows_id_fk" FOREIGN KEY ("source_flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_jobs_source_flow_idx" ON "cron_jobs" USING btree ("source_flow_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cron_jobs_source_flow_node_idx" ON "cron_jobs" USING btree ("source_flow_id","source_node_id");