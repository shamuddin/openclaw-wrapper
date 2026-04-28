import type {
  AutomationTaskFlowStatus,
  AutomationTaskFlowStepType,
  AutomationTaskFlowSyncMode,
  AutomationTaskKind,
  AutomationTaskRole,
  ChannelProfile,
  CronDelivery,
  CronDeliveryStatus,
  CronFailureAlert,
  CronJobSource,
  CronJobState,
  CronRunStatus,
  CronPayload,
  CronRunTriggerMode,
  CronSchedule,
  CronSessionTarget,
  CronWakeMode,
  GraphEdge,
  GraphNode,
  RunApprovalRequestStatus,
  RunApprovalRequestType,
  RunContinuationState,
  RunEvent,
  RunEventType,
  RunStatus,
  RunTrigger,
  WorkspaceExecPolicy,
  YouTubeArticleStatus,
  YouTubeSubscriptionStatus,
  YouTubeTranscriptStatus,
  YouTubeVideoIngestionStatus,
} from '@openclaw-wrapper/schemas';
import type { DelegatedRunStatus } from '@openclaw-wrapper/schemas/run';
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_normalized_idx').on(table.emailNormalized),
    index('users_updated_at_idx').on(table.updatedAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export const flows = pgTable('flows', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  publishedVersion: integer('published_version'),
  triggerSecretEncrypted: text('trigger_secret_encrypted'),
  triggerSecretHash: text('trigger_secret_hash'),
  triggerSecretRotatedAt: timestamp('trigger_secret_rotated_at', { withTimezone: true }),
  nodes: jsonb('nodes').$type<GraphNode[]>().notNull().default(sql`'[]'::jsonb`),
  edges: jsonb('edges').$type<GraphEdge[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FlowRow = typeof flows.$inferSelect;
export type NewFlowRow = typeof flows.$inferInsert;

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    execPolicy: jsonb('exec_policy')
      .$type<WorkspaceExecPolicy>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspaces_slug_idx').on(table.slug),
    index('workspaces_updated_at_idx').on(table.updatedAt),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;

export const workspaceMemberships = pgTable(
  'workspace_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_memberships_workspace_user_idx').on(table.workspaceId, table.userId),
    index('workspace_memberships_user_updated_at_idx').on(table.userId, table.updatedAt),
    index('workspace_memberships_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
  ],
);

export type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;
export type NewWorkspaceMembershipRow = typeof workspaceMemberships.$inferInsert;

export const workspaceMembershipsRelations = relations(workspaceMemberships, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMemberships.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMemberships.userId],
    references: [users.id],
  }),
}));

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull(),
    role: text('role').notNull().default('member'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_invites_token_hash_idx').on(table.tokenHash),
    index('workspace_invites_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('workspace_invites_email_expires_at_idx').on(table.emailNormalized, table.expiresAt),
  ],
);

export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type NewWorkspaceInviteRow = typeof workspaceInvites.$inferInsert;

export const workspaceInvitesRelations = relations(workspaceInvites, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceInvites.workspaceId],
    references: [workspaces.id],
  }),
  createdByUser: one(users, {
    fields: [workspaceInvites.createdByUserId],
    references: [users.id],
    relationName: 'workspaceInviteCreatedBy',
  }),
  acceptedByUser: one(users, {
    fields: [workspaceInvites.acceptedByUserId],
    references: [users.id],
    relationName: 'workspaceInviteAcceptedBy',
  }),
}));

export const workspaceAuditEvents = pgTable(
  'workspace_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    summary: text('summary').notNull(),
    details: jsonb('details').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workspace_audit_events_workspace_created_at_idx').on(table.workspaceId, table.createdAt),
    index('workspace_audit_events_actor_created_at_idx').on(table.actorUserId, table.createdAt),
    index('workspace_audit_events_event_type_created_at_idx').on(table.eventType, table.createdAt),
  ],
);

export type WorkspaceAuditEventRow = typeof workspaceAuditEvents.$inferSelect;
export type NewWorkspaceAuditEventRow = typeof workspaceAuditEvents.$inferInsert;

export const workspaceAuditEventsRelations = relations(workspaceAuditEvents, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceAuditEvents.workspaceId],
    references: [workspaces.id],
  }),
  actorUser: one(users, {
    fields: [workspaceAuditEvents.actorUserId],
    references: [users.id],
    relationName: 'workspaceAuditActor',
  }),
}));

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_hash_idx').on(table.tokenHash),
    index('auth_sessions_user_updated_at_idx').on(table.userId, table.updatedAt),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export type AuthSessionRow = typeof authSessions.$inferSelect;
export type NewAuthSessionRow = typeof authSessions.$inferInsert;

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('password_reset_tokens_token_hash_idx').on(table.tokenHash),
    index('password_reset_tokens_user_updated_at_idx').on(table.userId, table.updatedAt),
    index('password_reset_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export type PasswordResetTokenRow = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetTokenRow = typeof passwordResetTokens.$inferInsert;

export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    textBody: text('text_body').notNull(),
    htmlBody: text('html_body'),
    template: text('template').notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    index('email_deliveries_to_created_at_idx').on(table.toEmail, table.createdAt),
    index('email_deliveries_status_created_at_idx').on(table.status, table.createdAt),
    index('email_deliveries_template_created_at_idx').on(table.template, table.createdAt),
  ],
);

export type EmailDeliveryRow = typeof emailDeliveries.$inferSelect;
export type NewEmailDeliveryRow = typeof emailDeliveries.$inferInsert;

export const channelProfiles = pgTable(
  'channel_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    templateId: text('template_id').notNull(),
    channelType: text('channel_type').notNull(),
    agentId: text('agent_id'),
    accountId: text('account_id'),
    routeKey: text('route_key'),
    defaultTarget: text('default_target'),
    config: jsonb('config').$type<ChannelProfile['config']>().notNull().default(sql`'{}'::jsonb`),
    secrets: jsonb('secrets').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('channel_profiles_updated_at_idx').on(table.updatedAt),
    index('channel_profiles_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('channel_profiles_channel_type_updated_at_idx').on(table.channelType, table.updatedAt),
  ],
);

export type ChannelProfileRow = typeof channelProfiles.$inferSelect;
export type NewChannelProfileRow = typeof channelProfiles.$inferInsert;

export const flowVersions = pgTable(
  'flow_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    nodes: jsonb('nodes').$type<GraphNode[]>().notNull().default(sql`'[]'::jsonb`),
    edges: jsonb('edges').$type<GraphEdge[]>().notNull().default(sql`'[]'::jsonb`),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('flow_versions_flow_id_version_idx').on(table.flowId, table.version),
    index('flow_versions_flow_id_published_at_idx').on(table.flowId, table.publishedAt),
  ],
);

export type FlowVersionRow = typeof flowVersions.$inferSelect;
export type NewFlowVersionRow = typeof flowVersions.$inferInsert;

export const cronJobs = pgTable(
  'cron_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    agentId: text('agent_id'),
    sessionKey: text('session_key'),
    clearAgent: boolean('clear_agent').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    deleteAfterRun: boolean('delete_after_run').notNull().default(false),
    sourceType: text('source_type').$type<CronJobSource['kind'] | null>(),
    sourceFlowId: uuid('source_flow_id').references(() => flows.id, { onDelete: 'cascade' }),
    sourceFlowVersion: integer('source_flow_version'),
    sourceNodeId: text('source_node_id'),
    schedule: jsonb('schedule').$type<CronSchedule>().notNull(),
    sessionTarget: text('session_target').$type<CronSessionTarget>().notNull(),
    wakeMode: text('wake_mode').$type<CronWakeMode>().notNull(),
    payload: jsonb('payload').$type<CronPayload>().notNull(),
    delivery: jsonb('delivery').$type<CronDelivery | null>(),
    failureAlert: jsonb('failure_alert').$type<CronFailureAlert | false | null>(),
    timeoutSeconds: integer('timeout_seconds'),
    state: jsonb('state').$type<CronJobState>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cron_jobs_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('cron_jobs_workspace_enabled_updated_at_idx').on(
      table.workspaceId,
      table.enabled,
      table.updatedAt,
    ),
    index('cron_jobs_workspace_created_at_idx').on(table.workspaceId, table.createdAt),
    index('cron_jobs_source_flow_idx').on(table.sourceFlowId, table.updatedAt),
    uniqueIndex('cron_jobs_source_flow_node_idx').on(table.sourceFlowId, table.sourceNodeId),
  ],
);

export type CronJobRow = typeof cronJobs.$inferSelect;
export type NewCronJobRow = typeof cronJobs.$inferInsert;

export const cronJobRuns = pgTable(
  'cron_job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    cronJobId: uuid('cron_job_id').references(() => cronJobs.id, { onDelete: 'set null' }),
    jobName: text('job_name').notNull(),
    triggerMode: text('trigger_mode').$type<CronRunTriggerMode>().notNull(),
    status: text('status').$type<CronRunStatus>().notNull(),
    summary: text('summary'),
    error: text('error'),
    sessionKey: text('session_key'),
    deliveryStatus: text('delivery_status').$type<CronDeliveryStatus>(),
    deliveryError: text('delivery_error'),
    delivered: boolean('delivered'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cron_job_runs_workspace_created_at_idx').on(table.workspaceId, table.createdAt),
    index('cron_job_runs_job_created_at_idx').on(table.cronJobId, table.createdAt),
    index('cron_job_runs_status_created_at_idx').on(table.status, table.createdAt),
  ],
);

export type CronJobRunRow = typeof cronJobRuns.$inferSelect;
export type NewCronJobRunRow = typeof cronJobRuns.$inferInsert;

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    flowVersionId: uuid('flow_version_id')
      .notNull()
      .references(() => flowVersions.id, { onDelete: 'restrict' }),
    flowVersion: integer('flow_version').notNull(),
    status: text('status').$type<RunStatus>().notNull(),
    trigger: jsonb('trigger').$type<RunTrigger>().notNull(),
    input: jsonb('input').$type<unknown>(),
    output: jsonb('output').$type<unknown>(),
    continuation: jsonb('continuation').$type<RunContinuationState>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    resumeAt: timestamp('resume_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('runs_workspace_created_at_idx').on(table.workspaceId, table.createdAt),
    index('runs_flow_id_created_at_idx').on(table.flowId, table.createdAt),
    index('runs_status_created_at_idx').on(table.status, table.createdAt),
    index('runs_status_resume_at_idx').on(table.status, table.resumeAt),
  ],
);

export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;

export const runDelegations = pgTable(
  'run_delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentRunId: uuid('parent_run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    parentNodeId: text('parent_node_id').notNull(),
    delegationKind: text('delegation_kind').notNull().default('agent-send'),
    depth: integer('depth').notNull(),
    targetAgent: text('target_agent').notNull(),
    sessionKey: text('session_key').notNull(),
    gatewayRunId: text('gateway_run_id'),
    handoffReason: text('handoff_reason'),
    model: text('model'),
    status: text('status').$type<DelegatedRunStatus>().notNull(),
    replyText: text('reply_text'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('run_delegations_workspace_created_at_idx').on(table.workspaceId, table.createdAt),
    index('run_delegations_parent_run_created_at_idx').on(table.parentRunId, table.createdAt),
    index('run_delegations_parent_run_depth_idx').on(table.parentRunId, table.depth),
    index('run_delegations_status_created_at_idx').on(table.status, table.createdAt),
  ],
);

export type RunDelegationRow = typeof runDelegations.$inferSelect;
export type NewRunDelegationRow = typeof runDelegations.$inferInsert;

export const youtubeSubscriptions = pgTable(
  'youtube_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelProfileId: uuid('channel_profile_id').references(() => channelProfiles.id, {
      onDelete: 'set null',
    }),
    channelId: text('channel_id').notNull(),
    channelHandle: text('channel_handle'),
    channelTitle: text('channel_title'),
    flowId: uuid('flow_id').references(() => flows.id, { onDelete: 'set null' }),
    topicUrl: text('topic_url').notNull(),
    callbackUrl: text('callback_url').notNull(),
    status: text('status').$type<YouTubeSubscriptionStatus>().notNull().default('draft'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    lastNotificationAt: timestamp('last_notification_at', { withTimezone: true }),
    lastRenewedAt: timestamp('last_renewed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('youtube_subscriptions_workspace_channel_idx').on(
      table.workspaceId,
      table.channelId,
    ),
    index('youtube_subscriptions_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('youtube_subscriptions_status_lease_idx').on(table.status, table.leaseExpiresAt),
    index('youtube_subscriptions_flow_idx').on(table.flowId),
  ],
);

export type YouTubeSubscriptionRow = typeof youtubeSubscriptions.$inferSelect;
export type NewYouTubeSubscriptionRow = typeof youtubeSubscriptions.$inferInsert;

export const youtubeVideoIngestions = pgTable(
  'youtube_video_ingestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => youtubeSubscriptions.id, {
      onDelete: 'set null',
    }),
    channelId: text('channel_id').notNull(),
    channelTitle: text('channel_title'),
    videoId: text('video_id').notNull(),
    videoUrl: text('video_url').notNull(),
    title: text('title'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    status: text('status').$type<YouTubeVideoIngestionStatus>().notNull().default('detected'),
    transcriptStatus: text('transcript_status')
      .$type<YouTubeTranscriptStatus>()
      .notNull()
      .default('pending'),
    articleStatus: text('article_status')
      .$type<YouTubeArticleStatus>()
      .notNull()
      .default('pending'),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
    error: text('error'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('youtube_video_ingestions_workspace_video_idx').on(
      table.workspaceId,
      table.videoId,
    ),
    index('youtube_video_ingestions_workspace_detected_at_idx').on(
      table.workspaceId,
      table.detectedAt,
    ),
    index('youtube_video_ingestions_status_updated_at_idx').on(table.status, table.updatedAt),
    index('youtube_video_ingestions_run_idx').on(table.runId),
  ],
);

export type YouTubeVideoIngestionRow = typeof youtubeVideoIngestions.$inferSelect;
export type NewYouTubeVideoIngestionRow = typeof youtubeVideoIngestions.$inferInsert;

export const youtubeTranscriptCache = pgTable(
  'youtube_transcript_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    videoId: text('video_id').notNull(),
    videoUrl: text('video_url').notNull(),
    provider: text('provider').notNull().default('transcriptapi'),
    title: text('title'),
    duration: text('duration'),
    language: text('language'),
    transcript: text('transcript').notNull(),
    segments: jsonb('segments').$type<Array<{ text: string; start: number; duration: number }>>(),
    segmentCount: integer('segment_count').notNull().default(0),
    characterCount: integer('character_count').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('youtube_transcript_cache_workspace_video_idx').on(
      table.workspaceId,
      table.videoId,
    ),
    index('youtube_transcript_cache_workspace_last_used_idx').on(
      table.workspaceId,
      table.lastUsedAt,
    ),
  ],
);

export type YouTubeTranscriptCacheRow = typeof youtubeTranscriptCache.$inferSelect;
export type NewYouTubeTranscriptCacheRow = typeof youtubeTranscriptCache.$inferInsert;

export const runApprovalRequests = pgTable(
  'run_approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    requestType: text('request_type').$type<RunApprovalRequestType>().notNull(),
    status: text('status').$type<RunApprovalRequestStatus>().notNull().default('pending'),
    reason: text('reason'),
    command: text('command'),
    approvalMode: text('approval_mode'),
    timeoutAt: timestamp('timeout_at', { withTimezone: true }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('run_approval_requests_workspace_status_requested_at_idx').on(
      table.workspaceId,
      table.status,
      table.requestedAt,
    ),
    index('run_approval_requests_run_status_requested_at_idx').on(
      table.runId,
      table.status,
      table.requestedAt,
    ),
    index('run_approval_requests_flow_status_requested_at_idx').on(
      table.flowId,
      table.status,
      table.requestedAt,
    ),
  ],
);

export type RunApprovalRequestRow = typeof runApprovalRequests.$inferSelect;
export type NewRunApprovalRequestRow = typeof runApprovalRequests.$inferInsert;

export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    eventType: text('event_type').$type<RunEventType>().notNull(),
    event: jsonb('event').$type<RunEvent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('run_events_run_id_sequence_idx').on(table.runId, table.sequence),
    index('run_events_run_id_created_at_idx').on(table.runId, table.createdAt),
    index('run_events_event_type_created_at_idx').on(table.eventType, table.createdAt),
  ],
);

export type RunEventRow = typeof runEvents.$inferSelect;
export type NewRunEventRow = typeof runEvents.$inferInsert;

export const automationTaskFlows = pgTable(
  'automation_task_flows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    lookupKey: text('lookup_key').notNull(),
    syncMode: text('sync_mode').$type<AutomationTaskFlowSyncMode>().notNull(),
    triggerType: text('trigger_type').$type<AutomationTaskKind>().notNull(),
    triggerKey: text('trigger_key').notNull(),
    scopeKey: text('scope_key'),
    revision: integer('revision').notNull().default(1),
    status: text('status').$type<AutomationTaskFlowStatus>().notNull().default('pending'),
    latestRunId: uuid('latest_run_id').references(() => runs.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('automation_task_flows_lookup_revision_idx').on(
      table.workspaceId,
      table.flowId,
      table.lookupKey,
      table.revision,
    ),
    index('automation_task_flows_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
    index('automation_task_flows_workspace_status_updated_at_idx').on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index('automation_task_flows_flow_lookup_updated_at_idx').on(
      table.flowId,
      table.lookupKey,
      table.updatedAt,
    ),
  ],
);

export type AutomationTaskFlowRow = typeof automationTaskFlows.$inferSelect;
export type NewAutomationTaskFlowRow = typeof automationTaskFlows.$inferInsert;

export const automationTasks = pgTable(
  'automation_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskFlowId: uuid('task_flow_id')
      .notNull()
      .references(() => automationTaskFlows.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    role: text('role').$type<AutomationTaskRole>().notNull().default('root'),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => automationTasks.id, {
      onDelete: 'set null',
    }),
    sourceTaskId: uuid('source_task_id').references((): AnyPgColumn => automationTasks.id, {
      onDelete: 'set null',
    }),
    sequence: integer('sequence').notNull().default(1),
    attempt: integer('attempt').notNull().default(1),
    kind: text('kind').$type<AutomationTaskKind>().notNull(),
    summary: text('summary').notNull(),
    status: text('status').$type<AutomationTaskFlowStatus>().notNull().default('pending'),
    trigger: jsonb('trigger').$type<RunTrigger>().notNull(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('automation_tasks_run_id_idx').on(table.runId),
    index('automation_tasks_task_flow_updated_at_idx').on(table.taskFlowId, table.updatedAt),
    index('automation_tasks_workspace_status_updated_at_idx').on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index('automation_tasks_flow_created_at_idx').on(table.flowId, table.createdAt),
    index('automation_tasks_task_flow_sequence_idx').on(table.taskFlowId, table.sequence),
    index('automation_tasks_parent_updated_at_idx').on(table.parentTaskId, table.updatedAt),
    index('automation_tasks_source_updated_at_idx').on(table.sourceTaskId, table.updatedAt),
  ],
);

export type AutomationTaskRow = typeof automationTasks.$inferSelect;
export type NewAutomationTaskRow = typeof automationTasks.$inferInsert;

export const automationTaskFlowSteps = pgTable(
  'automation_task_flow_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskFlowId: uuid('task_flow_id')
      .notNull()
      .references(() => automationTaskFlows.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => automationTasks.id, { onDelete: 'set null' }),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
    stepType: text('step_type').$type<AutomationTaskFlowStepType>().notNull(),
    status: text('status').$type<AutomationTaskFlowStatus>(),
    summary: text('summary').notNull(),
    details: jsonb('details').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('automation_task_flow_steps_task_flow_created_at_idx').on(
      table.taskFlowId,
      table.createdAt,
    ),
    index('automation_task_flow_steps_workspace_created_at_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    index('automation_task_flow_steps_run_created_at_idx').on(table.runId, table.createdAt),
    index('automation_task_flow_steps_task_created_at_idx').on(table.taskId, table.createdAt),
    index('automation_task_flow_steps_step_type_created_at_idx').on(
      table.stepType,
      table.createdAt,
    ),
  ],
);

export type AutomationTaskFlowStepRow = typeof automationTaskFlowSteps.$inferSelect;
export type NewAutomationTaskFlowStepRow = typeof automationTaskFlowSteps.$inferInsert;

export const contextMemoryEntries = pgTable(
  'context_memory_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    namespace: text('namespace').notNull(),
    scopeId: text('scope_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>(),
    sourceRunId: uuid('source_run_id').references(() => runs.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('context_memory_entries_flow_scope_key_idx').on(
      table.flowId,
      table.namespace,
      table.scopeId,
      table.key,
    ),
    index('context_memory_entries_workspace_namespace_idx').on(table.workspaceId, table.namespace),
    index('context_memory_entries_flow_namespace_idx').on(table.flowId, table.namespace),
    index('context_memory_entries_scope_updated_at_idx').on(
      table.namespace,
      table.scopeId,
      table.updatedAt,
    ),
  ],
);

export type ContextMemoryEntryRow = typeof contextMemoryEntries.$inferSelect;
export type NewContextMemoryEntryRow = typeof contextMemoryEntries.$inferInsert;
