import { type Static, Type } from '@sinclair/typebox';

export const YouTubeSubscriptionStatus = Type.Union([
  Type.Literal('draft'),
  Type.Literal('subscribed'),
  Type.Literal('renewal_due'),
  Type.Literal('expired'),
  Type.Literal('failed'),
  Type.Literal('disabled'),
]);
export type YouTubeSubscriptionStatus = Static<typeof YouTubeSubscriptionStatus>;

export const YouTubeVideoIngestionStatus = Type.Union([
  Type.Literal('detected'),
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('transcript_ready'),
  Type.Literal('article_drafted'),
  Type.Literal('approved'),
  Type.Literal('published'),
  Type.Literal('failed'),
  Type.Literal('ignored'),
]);
export type YouTubeVideoIngestionStatus = Static<typeof YouTubeVideoIngestionStatus>;

export const YouTubeTranscriptStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('ready'),
  Type.Literal('unavailable'),
  Type.Literal('failed'),
]);
export type YouTubeTranscriptStatus = Static<typeof YouTubeTranscriptStatus>;

export const YouTubeArticleStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('drafted'),
  Type.Literal('approved'),
  Type.Literal('published'),
  Type.Literal('failed'),
]);
export type YouTubeArticleStatus = Static<typeof YouTubeArticleStatus>;

export const YouTubeSubscription = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  channelProfileId: Type.Optional(Type.String({ format: 'uuid' })),
  channelId: Type.String({ minLength: 1 }),
  channelHandle: Type.Optional(Type.String()),
  channelTitle: Type.Optional(Type.String()),
  flowId: Type.Optional(Type.String({ format: 'uuid' })),
  topicUrl: Type.String({ minLength: 1 }),
  callbackUrl: Type.String({ minLength: 1 }),
  status: YouTubeSubscriptionStatus,
  leaseExpiresAt: Type.Optional(Type.String({ format: 'date-time' })),
  lastNotificationAt: Type.Optional(Type.String({ format: 'date-time' })),
  lastRenewedAt: Type.Optional(Type.String({ format: 'date-time' })),
  lastError: Type.Optional(Type.String()),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});
export type YouTubeSubscription = Static<typeof YouTubeSubscription>;

export const YouTubeVideoIngestion = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  subscriptionId: Type.Optional(Type.String({ format: 'uuid' })),
  channelId: Type.String({ minLength: 1 }),
  channelTitle: Type.Optional(Type.String()),
  videoId: Type.String({ minLength: 1 }),
  videoUrl: Type.String({ minLength: 1 }),
  title: Type.Optional(Type.String()),
  publishedAt: Type.Optional(Type.String({ format: 'date-time' })),
  status: YouTubeVideoIngestionStatus,
  transcriptStatus: YouTubeTranscriptStatus,
  articleStatus: YouTubeArticleStatus,
  runId: Type.Optional(Type.String({ format: 'uuid' })),
  error: Type.Optional(Type.String()),
  detectedAt: Type.String({ format: 'date-time' }),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});
export type YouTubeVideoIngestion = Static<typeof YouTubeVideoIngestion>;

export const YouTubeOverview = Type.Object({
  profiles: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      name: Type.String(),
      appliedAt: Type.Optional(Type.String({ format: 'date-time' })),
      updatedAt: Type.String({ format: 'date-time' }),
    }),
  ),
  totals: Type.Object({
    subscriptions: Type.Number(),
    activeSubscriptions: Type.Number(),
    videos: Type.Number(),
    pendingVideos: Type.Number(),
    failedVideos: Type.Number(),
  }),
  subscriptions: Type.Array(YouTubeSubscription),
  recentVideos: Type.Array(YouTubeVideoIngestion),
});
export type YouTubeOverview = Static<typeof YouTubeOverview>;
