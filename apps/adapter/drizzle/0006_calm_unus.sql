CREATE TABLE "youtube_transcript_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"video_url" text NOT NULL,
	"provider" text DEFAULT 'transcriptapi' NOT NULL,
	"title" text,
	"duration" text,
	"language" text,
	"transcript" text NOT NULL,
	"segments" jsonb,
	"segment_count" integer DEFAULT 0 NOT NULL,
	"character_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "youtube_transcript_cache" ADD CONSTRAINT "youtube_transcript_cache_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_transcript_cache_workspace_video_idx" ON "youtube_transcript_cache" USING btree ("workspace_id","video_id");--> statement-breakpoint
CREATE INDEX "youtube_transcript_cache_workspace_last_used_idx" ON "youtube_transcript_cache" USING btree ("workspace_id","last_used_at");