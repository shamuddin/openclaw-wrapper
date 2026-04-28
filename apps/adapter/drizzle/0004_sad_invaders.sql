CREATE TABLE "youtube_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_profile_id" uuid,
	"channel_id" text NOT NULL,
	"channel_handle" text,
	"channel_title" text,
	"topic_url" text NOT NULL,
	"callback_url" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"last_notification_at" timestamp with time zone,
	"last_renewed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "youtube_video_ingestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subscription_id" uuid,
	"channel_id" text NOT NULL,
	"channel_title" text,
	"video_id" text NOT NULL,
	"video_url" text NOT NULL,
	"title" text,
	"published_at" timestamp with time zone,
	"status" text DEFAULT 'detected' NOT NULL,
	"transcript_status" text DEFAULT 'pending' NOT NULL,
	"article_status" text DEFAULT 'pending' NOT NULL,
	"run_id" uuid,
	"error" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "youtube_subscriptions" ADD CONSTRAINT "youtube_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_subscriptions" ADD CONSTRAINT "youtube_subscriptions_channel_profile_id_channel_profiles_id_fk" FOREIGN KEY ("channel_profile_id") REFERENCES "public"."channel_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_video_ingestions" ADD CONSTRAINT "youtube_video_ingestions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_video_ingestions" ADD CONSTRAINT "youtube_video_ingestions_subscription_id_youtube_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."youtube_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_video_ingestions" ADD CONSTRAINT "youtube_video_ingestions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_subscriptions_workspace_channel_idx" ON "youtube_subscriptions" USING btree ("workspace_id","channel_id");--> statement-breakpoint
CREATE INDEX "youtube_subscriptions_workspace_updated_at_idx" ON "youtube_subscriptions" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "youtube_subscriptions_status_lease_idx" ON "youtube_subscriptions" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_video_ingestions_workspace_video_idx" ON "youtube_video_ingestions" USING btree ("workspace_id","video_id");--> statement-breakpoint
CREATE INDEX "youtube_video_ingestions_workspace_detected_at_idx" ON "youtube_video_ingestions" USING btree ("workspace_id","detected_at");--> statement-breakpoint
CREATE INDEX "youtube_video_ingestions_status_updated_at_idx" ON "youtube_video_ingestions" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "youtube_video_ingestions_run_idx" ON "youtube_video_ingestions" USING btree ("run_id");