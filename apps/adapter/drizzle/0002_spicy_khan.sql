CREATE TABLE "cron_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"cron_job_id" uuid,
	"job_name" text NOT NULL,
	"trigger_mode" text NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"error" text,
	"session_key" text,
	"delivery_status" text,
	"delivery_error" text,
	"delivered" boolean,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cron_job_runs" ADD CONSTRAINT "cron_job_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_job_runs" ADD CONSTRAINT "cron_job_runs_cron_job_id_cron_jobs_id_fk" FOREIGN KEY ("cron_job_id") REFERENCES "public"."cron_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_job_runs_workspace_created_at_idx" ON "cron_job_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "cron_job_runs_job_created_at_idx" ON "cron_job_runs" USING btree ("cron_job_id","created_at");--> statement-breakpoint
CREATE INDEX "cron_job_runs_status_created_at_idx" ON "cron_job_runs" USING btree ("status","created_at");