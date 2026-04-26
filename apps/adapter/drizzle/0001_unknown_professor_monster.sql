CREATE TABLE "cron_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"agent_id" text,
	"session_key" text,
	"clear_agent" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"delete_after_run" boolean DEFAULT false NOT NULL,
	"schedule" jsonb NOT NULL,
	"session_target" text NOT NULL,
	"wake_mode" text NOT NULL,
	"payload" jsonb NOT NULL,
	"delivery" jsonb,
	"failure_alert" jsonb,
	"timeout_seconds" integer,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cron_jobs_workspace_updated_at_idx" ON "cron_jobs" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "cron_jobs_workspace_enabled_updated_at_idx" ON "cron_jobs" USING btree ("workspace_id","enabled","updated_at");--> statement-breakpoint
CREATE INDEX "cron_jobs_workspace_created_at_idx" ON "cron_jobs" USING btree ("workspace_id","created_at");