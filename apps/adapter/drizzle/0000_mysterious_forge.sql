CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_task_flow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_flow_id" uuid NOT NULL,
	"task_id" uuid,
	"run_id" uuid,
	"step_type" text NOT NULL,
	"status" text,
	"summary" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_task_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lookup_key" text NOT NULL,
	"sync_mode" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_key" text NOT NULL,
	"scope_key" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"latest_run_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_flow_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"role" text DEFAULT 'root' NOT NULL,
	"parent_task_id" uuid,
	"source_task_id" uuid,
	"sequence" integer DEFAULT 1 NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"channel_type" text NOT NULL,
	"agent_id" text,
	"account_id" text,
	"route_key" text,
	"default_target" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"namespace" text NOT NULL,
	"scope_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"source_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text,
	"template" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "flow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"published_version" integer,
	"trigger_secret_encrypted" text,
	"trigger_secret_hash" text,
	"trigger_secret_rotated_at" timestamp with time zone,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"request_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"command" text,
	"approval_mode" text,
	"timeout_at" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_run_id" uuid NOT NULL,
	"parent_node_id" text NOT NULL,
	"delegation_kind" text DEFAULT 'agent-send' NOT NULL,
	"depth" integer NOT NULL,
	"target_agent" text NOT NULL,
	"session_key" text NOT NULL,
	"gateway_run_id" text,
	"handoff_reason" text,
	"model" text,
	"status" text NOT NULL,
	"reply_text" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"flow_version_id" uuid NOT NULL,
	"flow_version" integer NOT NULL,
	"status" text NOT NULL,
	"trigger" jsonb NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"continuation" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"resume_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"event_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"summary" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"exec_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_task_flow_steps" ADD CONSTRAINT "automation_task_flow_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_task_flow_steps" ADD CONSTRAINT "automation_task_flow_steps_task_flow_id_automation_task_flows_id_fk" FOREIGN KEY ("task_flow_id") REFERENCES "public"."automation_task_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_task_flow_steps" ADD CONSTRAINT "automation_task_flow_steps_task_id_automation_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."automation_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_task_flow_steps" ADD CONSTRAINT "automation_task_flow_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_task_flows" ADD CONSTRAINT "automation_task_flows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_task_flows" ADD CONSTRAINT "automation_task_flows_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_task_flows" ADD CONSTRAINT "automation_task_flows_latest_run_id_runs_id_fk" FOREIGN KEY ("latest_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_task_flow_id_automation_task_flows_id_fk" FOREIGN KEY ("task_flow_id") REFERENCES "public"."automation_task_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_parent_task_id_automation_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."automation_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_source_task_id_automation_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."automation_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_profiles" ADD CONSTRAINT "channel_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_memory_entries" ADD CONSTRAINT "context_memory_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_memory_entries" ADD CONSTRAINT "context_memory_entries_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_memory_entries" ADD CONSTRAINT "context_memory_entries_source_run_id_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_approval_requests" ADD CONSTRAINT "run_approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_approval_requests" ADD CONSTRAINT "run_approval_requests_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_approval_requests" ADD CONSTRAINT "run_approval_requests_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_approval_requests" ADD CONSTRAINT "run_approval_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_delegations" ADD CONSTRAINT "run_delegations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_delegations" ADD CONSTRAINT "run_delegations_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_flow_version_id_flow_versions_id_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."flow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_idx" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_updated_at_idx" ON "auth_sessions" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "automation_task_flow_steps_task_flow_created_at_idx" ON "automation_task_flow_steps" USING btree ("task_flow_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_task_flow_steps_workspace_created_at_idx" ON "automation_task_flow_steps" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_task_flow_steps_run_created_at_idx" ON "automation_task_flow_steps" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_task_flow_steps_task_created_at_idx" ON "automation_task_flow_steps" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_task_flow_steps_step_type_created_at_idx" ON "automation_task_flow_steps" USING btree ("step_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_task_flows_lookup_revision_idx" ON "automation_task_flows" USING btree ("workspace_id","flow_id","lookup_key","revision");--> statement-breakpoint
CREATE INDEX "automation_task_flows_workspace_updated_at_idx" ON "automation_task_flows" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "automation_task_flows_workspace_status_updated_at_idx" ON "automation_task_flows" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "automation_task_flows_flow_lookup_updated_at_idx" ON "automation_task_flows" USING btree ("flow_id","lookup_key","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_tasks_run_id_idx" ON "automation_tasks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "automation_tasks_task_flow_updated_at_idx" ON "automation_tasks" USING btree ("task_flow_id","updated_at");--> statement-breakpoint
CREATE INDEX "automation_tasks_workspace_status_updated_at_idx" ON "automation_tasks" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "automation_tasks_flow_created_at_idx" ON "automation_tasks" USING btree ("flow_id","created_at");--> statement-breakpoint
CREATE INDEX "automation_tasks_task_flow_sequence_idx" ON "automation_tasks" USING btree ("task_flow_id","sequence");--> statement-breakpoint
CREATE INDEX "automation_tasks_parent_updated_at_idx" ON "automation_tasks" USING btree ("parent_task_id","updated_at");--> statement-breakpoint
CREATE INDEX "automation_tasks_source_updated_at_idx" ON "automation_tasks" USING btree ("source_task_id","updated_at");--> statement-breakpoint
CREATE INDEX "channel_profiles_updated_at_idx" ON "channel_profiles" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "channel_profiles_workspace_updated_at_idx" ON "channel_profiles" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "channel_profiles_channel_type_updated_at_idx" ON "channel_profiles" USING btree ("channel_type","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "context_memory_entries_flow_scope_key_idx" ON "context_memory_entries" USING btree ("flow_id","namespace","scope_id","key");--> statement-breakpoint
CREATE INDEX "context_memory_entries_workspace_namespace_idx" ON "context_memory_entries" USING btree ("workspace_id","namespace");--> statement-breakpoint
CREATE INDEX "context_memory_entries_flow_namespace_idx" ON "context_memory_entries" USING btree ("flow_id","namespace");--> statement-breakpoint
CREATE INDEX "context_memory_entries_scope_updated_at_idx" ON "context_memory_entries" USING btree ("namespace","scope_id","updated_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_to_created_at_idx" ON "email_deliveries" USING btree ("to_email","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_status_created_at_idx" ON "email_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_template_created_at_idx" ON "email_deliveries" USING btree ("template","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_versions_flow_id_version_idx" ON "flow_versions" USING btree ("flow_id","version");--> statement-breakpoint
CREATE INDEX "flow_versions_flow_id_published_at_idx" ON "flow_versions" USING btree ("flow_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_updated_at_idx" ON "password_reset_tokens" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "run_approval_requests_workspace_status_requested_at_idx" ON "run_approval_requests" USING btree ("workspace_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "run_approval_requests_run_status_requested_at_idx" ON "run_approval_requests" USING btree ("run_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "run_approval_requests_flow_status_requested_at_idx" ON "run_approval_requests" USING btree ("flow_id","status","requested_at");--> statement-breakpoint
CREATE INDEX "run_delegations_workspace_created_at_idx" ON "run_delegations" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "run_delegations_parent_run_created_at_idx" ON "run_delegations" USING btree ("parent_run_id","created_at");--> statement-breakpoint
CREATE INDEX "run_delegations_parent_run_depth_idx" ON "run_delegations" USING btree ("parent_run_id","depth");--> statement-breakpoint
CREATE INDEX "run_delegations_status_created_at_idx" ON "run_delegations" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_id_sequence_idx" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "run_events_run_id_created_at_idx" ON "run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_event_type_created_at_idx" ON "run_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_created_at_idx" ON "runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_flow_id_created_at_idx" ON "runs" USING btree ("flow_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_created_at_idx" ON "runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "runs_status_resume_at_idx" ON "runs" USING btree ("status","resume_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_idx" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "workspace_audit_events_workspace_created_at_idx" ON "workspace_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_audit_events_actor_created_at_idx" ON "workspace_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_audit_events_event_type_created_at_idx" ON "workspace_audit_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invites_token_hash_idx" ON "workspace_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "workspace_invites_workspace_updated_at_idx" ON "workspace_invites" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "workspace_invites_email_expires_at_idx" ON "workspace_invites" USING btree ("email_normalized","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_memberships_workspace_user_idx" ON "workspace_memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_updated_at_idx" ON "workspace_memberships" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "workspace_memberships_workspace_updated_at_idx" ON "workspace_memberships" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workspaces_updated_at_idx" ON "workspaces" USING btree ("updated_at");