import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  Run,
  YouTubeOverview,
  YouTubeSubscription,
  YouTubeVideoIngestion,
} from '@openclaw-wrapper/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import type { ChannelProfileRow, YouTubeSubscriptionRow, YouTubeVideoIngestionRow } from './db/schema.js';
import {
  channelProfiles,
  flows,
  runApprovalRequests,
  runs,
  youtubeSubscriptions,
  youtubeVideoIngestions,
} from './db/schema.js';
import { env } from './env.js';
import {
  RunLaunchError,
  executeRunInBackground,
  executeRunToCompletion,
  markRunExecutionFailed,
  startPublishedFlowRun,
} from './run-service.js';
import { decryptSecretValue } from './secret-store.js';
import { extractYouTubeVideoId } from './youtube-transcript.js';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_WEBSUB_HUB = 'https://pubsubhubbub.appspot.com/subscribe';
const YOUTUBE_TOPIC_BASE = 'https://www.youtube.com/xml/feeds/videos.xml';
const DEFAULT_TEST_CHANNEL_ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const MAX_CHANNELS_PER_CONTEXT = 5;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;
const DEFAULT_WEBSUB_LEASE_SECONDS = 432_000;

interface YouTubeApiErrorPayload {
  error?: {
    message?: string;
    status?: string;
  };
}

interface YouTubeChannelListResponse {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      description?: string;
    };
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
      hiddenSubscriberCount?: boolean;
    };
  }>;
}

interface YouTubeSearchResponse {
  items?: Array<{
    id?: {
      videoId?: string;
    };
    snippet?: {
      title?: string;
      publishedAt?: string;
      channelTitle?: string;
      description?: string;
    };
  }>;
}

interface YouTubeProfileSettings {
  profile: ChannelProfileRow;
  apiKey: string;
  channelRefs: string[];
  maxResults: number;
  includeStatistics: boolean;
}

export class YouTubeWebSubError extends Error {
  constructor(
    readonly code:
      | 'SUBSCRIPTION_NOT_FOUND'
      | 'CHANNEL_NOT_FOUND'
      | 'HUB_REJECTED'
      | 'TOPIC_MISMATCH'
      | 'MISSING_CHALLENGE'
      | 'INVALID_SIGNATURE'
      | 'FLOW_NOT_FOUND'
      | 'FLOW_NOT_PUBLISHED'
      | 'INVALID_VIDEO',
    message: string,
  ) {
    super(message);
    this.name = 'YouTubeWebSubError';
  }
}

export interface YouTubeSubscribeInput {
  profileId: string;
  channelRef: string;
  leaseSeconds?: number;
}

export interface YouTubeLinkFlowInput {
  subscriptionId: string;
  flowId?: string;
}

export interface YouTubeManualRunInput {
  flowId: string;
  videoUrl: string;
}

export interface YouTubeNotificationResult {
  ok: true;
  subscriptionId: string;
  videoCount: number;
  videoIds: string[];
}

export interface YouTubeNotificationOptions {
  launchLinkedFlow?: boolean;
  logger?: Pick<Console, 'error'>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function parseChannelRefs(value: unknown): string[] {
  const raw = readString(value);
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_CHANNELS_PER_CONTEXT);
}

function parseMaxResults(value: unknown): number {
  const parsed = Number(readString(value) ?? DEFAULT_MAX_RESULTS);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_RESULTS_LIMIT);
}

function normalizeLeaseSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_WEBSUB_LEASE_SECONDS;
  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_WEBSUB_LEASE_SECONDS), 3_600), 864_000);
}

function buildYouTubeTopicUrl(channelId: string): string {
  const url = new URL(YOUTUBE_TOPIC_BASE);
  url.searchParams.set('channel_id', channelId);
  return url.toString();
}

function buildYouTubeCallbackUrl(subscriptionId: string): string {
  return `${env.ADAPTER_BASE_URL.replace(/\/+$/u, '')}/webhooks/youtube/${subscriptionId}`;
}

function readHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const direct = headers[name];
  if (typeof direct === 'string') return direct;

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function normalizeXmlText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .trim();
  return normalized.length > 0 ? normalized : undefined;
}

function extractXmlTag(block: string, tagName: string): string | undefined {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'iu').exec(
    block,
  );
  return normalizeXmlText(match?.[1]);
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

interface ParsedYouTubeNotificationEntry {
  videoId: string;
  channelId: string;
  title?: string;
  channelTitle?: string;
  publishedAt?: Date;
}

function parseYouTubeNotificationEntries(xml: string): ParsedYouTubeNotificationEntry[] {
  const blocks = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/giu) ?? [];

  return blocks
    .map((block): ParsedYouTubeNotificationEntry | undefined => {
      const videoId = extractXmlTag(block, 'yt:videoId');
      const channelId = extractXmlTag(block, 'yt:channelId');
      if (!videoId || !channelId) return undefined;
      const title = extractXmlTag(block, 'title');
      const channelTitle = extractXmlTag(block, 'name');
      const publishedAt = parseDate(extractXmlTag(block, 'published'));

      return {
        videoId,
        channelId,
        ...(title ? { title } : {}),
        ...(channelTitle ? { channelTitle } : {}),
        ...(publishedAt ? { publishedAt } : {}),
      };
    })
    .filter((entry): entry is ParsedYouTubeNotificationEntry => entry !== undefined);
}

function assertValidWebSubSignature(
  body: string,
  headers: Record<string, unknown>,
  secret: string | undefined,
): void {
  if (!secret) return;

  const signature =
    readHeader(headers, 'x-hub-signature') ?? readHeader(headers, 'x-hub-signature-256');
  if (!signature) {
    throw new YouTubeWebSubError(
      'INVALID_SIGNATURE',
      'YouTube WebSub notification is missing an HMAC signature.',
    );
  }

  const [algorithm, digest] = signature.split('=', 2);
  const normalizedAlgorithm = algorithm?.toLowerCase() === 'sha256' ? 'sha256' : 'sha1';
  const expected = createHmac(normalizedAlgorithm, secret).update(body).digest('hex');
  const actualBuffer = Buffer.from(digest ?? '', 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new YouTubeWebSubError(
      'INVALID_SIGNATURE',
      'YouTube WebSub notification signature did not match.',
    );
  }
}

function formatCompactNumber(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return value;
  return new Intl.NumberFormat('en', { notation: 'compact' }).format(numberValue);
}

async function youtubeRequest<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(`${YOUTUBE_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const payload = (await response.json()) as YouTubeApiErrorPayload;
      detail = payload.error?.message ?? payload.error?.status ?? detail;
    } catch {
      // Keep the HTTP status text when YouTube does not return JSON.
    }
    throw new Error(`YouTube API request failed (${response.status}): ${detail}`);
  }

  return (await response.json()) as T;
}

async function postWebSubSubscription(params: {
  topicUrl: string;
  callbackUrl: string;
  mode: 'subscribe' | 'unsubscribe';
  leaseSeconds?: number;
}): Promise<void> {
  const body = new URLSearchParams({
    'hub.mode': params.mode,
    'hub.topic': params.topicUrl,
    'hub.callback': params.callbackUrl,
    'hub.verify': 'async',
  });

  if (params.mode === 'subscribe') {
    body.set('hub.lease_seconds', String(normalizeLeaseSeconds(params.leaseSeconds)));
  }

  if (env.YOUTUBE_WEBSUB_SECRET) {
    body.set('hub.secret', env.YOUTUBE_WEBSUB_SECRET);
  }

  const response = await fetch(YOUTUBE_WEBSUB_HUB, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new YouTubeWebSubError(
      'HUB_REJECTED',
      `YouTube WebSub hub rejected the ${params.mode} request (${response.status}): ${
        detail || response.statusText
      }`,
    );
  }
}

async function loadYouTubeProfileSettings(
  db: Db,
  workspaceId: string,
  profileId?: string,
): Promise<YouTubeProfileSettings> {
  const profile = profileId
    ? await db.query.channelProfiles.findFirst({
        where: (profiles, { and: andOp, eq: eqOp }) =>
          andOp(
            eqOp(profiles.id, profileId),
            eqOp(profiles.workspaceId, workspaceId),
            eqOp(profiles.templateId, 'youtube-data-api'),
          ),
      })
    : (
        await db
          .select()
          .from(channelProfiles)
          .where(
            and(
              eq(channelProfiles.workspaceId, workspaceId),
              eq(channelProfiles.templateId, 'youtube-data-api'),
            ),
          )
          .orderBy(desc(channelProfiles.appliedAt), desc(channelProfiles.updatedAt))
          .limit(1)
      )[0];

  if (!profile) {
    throw new Error('Create and save a YouTube Data API channel profile before using YouTube cron context.');
  }

  const encryptedApiKey = readString(profile.secrets?.apiKey);
  if (!encryptedApiKey) {
    throw new Error('YouTube API key is missing from the selected channel profile.');
  }

  return {
    profile,
    apiKey: decryptSecretValue(encryptedApiKey),
    channelRefs: parseChannelRefs(profile.config?.channelIds),
    maxResults: parseMaxResults(profile.config?.maxResults),
    includeStatistics: readBoolean(profile.config?.includeStatistics, true),
  };
}

async function resolveChannel(
  apiKey: string,
  channelRef: string,
  includeStatistics: boolean,
): Promise<NonNullable<YouTubeChannelListResponse['items']>[number] | null> {
  const normalized = channelRef.trim();
  const part = includeStatistics ? 'snippet,statistics' : 'snippet';
  const params = normalized.startsWith('@')
    ? { part, forHandle: normalized.slice(1), key: apiKey }
    : { part, id: normalized, key: apiKey };
  const response = await youtubeRequest<YouTubeChannelListResponse>('channels', params);
  return response.items?.[0] ?? null;
}

async function fetchRecentVideos(
  apiKey: string,
  channelId: string,
  maxResults: number,
): Promise<NonNullable<YouTubeSearchResponse['items']>> {
  const response = await youtubeRequest<YouTubeSearchResponse>('search', {
    part: 'snippet',
    channelId,
    order: 'date',
    type: 'video',
    maxResults,
    key: apiKey,
  });
  return response.items ?? [];
}

export async function testYouTubeProfile(
  db: Db,
  profileId: string,
  workspaceId: string,
): Promise<{
  ok: true;
  profileId: string;
  profileName: string;
  channelCount: number;
  sampleChannelTitle?: string;
  checkedAt: string;
}> {
  const settings = await loadYouTubeProfileSettings(db, workspaceId, profileId);
  const refs = settings.channelRefs.length > 0 ? settings.channelRefs : [DEFAULT_TEST_CHANNEL_ID];
  const channels = await Promise.all(
    refs.map((ref) => resolveChannel(settings.apiKey, ref, settings.includeStatistics)),
  );
  const resolvedChannels = channels.filter((channel) => channel?.id);

  if (resolvedChannels.length === 0) {
    throw new Error('YouTube API key works, but none of the configured channel IDs or handles resolved.');
  }

  const sampleChannelTitle = resolvedChannels[0]?.snippet?.title;
  return {
    ok: true,
    profileId,
    profileName: settings.profile.name,
    channelCount: resolvedChannels.length,
    ...(sampleChannelTitle ? { sampleChannelTitle } : {}),
    checkedAt: new Date().toISOString(),
  };
}

export async function subscribeYouTubeChannel(
  db: Db,
  workspaceId: string,
  input: YouTubeSubscribeInput,
): Promise<YouTubeSubscription> {
  const settings = await loadYouTubeProfileSettings(db, workspaceId, input.profileId);
  const channel = await resolveChannel(settings.apiKey, input.channelRef, settings.includeStatistics);
  if (!channel?.id) {
    throw new YouTubeWebSubError(
      'CHANNEL_NOT_FOUND',
      `YouTube channel "${input.channelRef}" was not found or is not accessible.`,
    );
  }

  const now = new Date();
  const existing = await db.query.youtubeSubscriptions.findFirst({
    where: (subscriptions, { and: andOp, eq: eqOp }) =>
      andOp(
        eqOp(subscriptions.workspaceId, workspaceId),
        eqOp(subscriptions.channelId, channel.id ?? ''),
      ),
  });
  const subscriptionId = existing?.id ?? randomUUID();
  const topicUrl = buildYouTubeTopicUrl(channel.id);
  const callbackUrl = buildYouTubeCallbackUrl(subscriptionId);
  const leaseSeconds = normalizeLeaseSeconds(input.leaseSeconds);

  const [saved] = existing
    ? await db
        .update(youtubeSubscriptions)
        .set({
          channelProfileId: settings.profile.id,
          channelHandle: input.channelRef.startsWith('@') ? input.channelRef : existing.channelHandle,
          channelTitle: channel.snippet?.title ?? existing.channelTitle,
          topicUrl,
          callbackUrl,
          status: 'draft',
          lastError: null,
          updatedAt: now,
        })
        .where(eq(youtubeSubscriptions.id, existing.id))
        .returning()
    : await db
        .insert(youtubeSubscriptions)
        .values({
          id: subscriptionId,
          workspaceId,
          channelProfileId: settings.profile.id,
          channelId: channel.id,
          channelHandle: input.channelRef.startsWith('@') ? input.channelRef : undefined,
          channelTitle: channel.snippet?.title,
          topicUrl,
          callbackUrl,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        })
        .returning();

  if (!saved) {
    throw new Error('YouTube subscription save failed');
  }

  try {
    await postWebSubSubscription({
      topicUrl,
      callbackUrl,
      mode: 'subscribe',
      leaseSeconds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [failed] = await db
      .update(youtubeSubscriptions)
      .set({ status: 'failed', lastError: message, updatedAt: new Date() })
      .where(eq(youtubeSubscriptions.id, subscriptionId))
      .returning();
    if (failed) return serializeSubscription(failed);
    throw error;
  }

  const [updated] = await db
    .update(youtubeSubscriptions)
    .set({
      status: 'subscribed',
      leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000),
      lastRenewedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(youtubeSubscriptions.id, subscriptionId))
    .returning();

  return serializeSubscription(updated ?? saved);
}

export async function unsubscribeYouTubeChannel(
  db: Db,
  workspaceId: string,
  subscriptionId: string,
): Promise<YouTubeSubscription> {
  const subscription = await db.query.youtubeSubscriptions.findFirst({
    where: (subscriptions, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(subscriptions.id, subscriptionId), eqOp(subscriptions.workspaceId, workspaceId)),
  });
  if (!subscription) {
    throw new YouTubeWebSubError('SUBSCRIPTION_NOT_FOUND', 'YouTube subscription not found.');
  }

  try {
    await postWebSubSubscription({
      topicUrl: subscription.topicUrl,
      callbackUrl: subscription.callbackUrl,
      mode: 'unsubscribe',
    });
  } catch {
    // Keep local disable available even if the hub cannot be reached.
  }

  const [updated] = await db
    .update(youtubeSubscriptions)
    .set({
      status: 'disabled',
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(youtubeSubscriptions.id, subscription.id))
    .returning();

  return serializeSubscription(updated ?? subscription);
}

export async function setYouTubeSubscriptionFlow(
  db: Db,
  workspaceId: string,
  input: YouTubeLinkFlowInput,
): Promise<YouTubeSubscription> {
  const subscription = await db.query.youtubeSubscriptions.findFirst({
    where: (subscriptions, { and: andOp, eq: eqOp }) =>
      andOp(
        eqOp(subscriptions.id, input.subscriptionId),
        eqOp(subscriptions.workspaceId, workspaceId),
      ),
  });
  if (!subscription) {
    throw new YouTubeWebSubError('SUBSCRIPTION_NOT_FOUND', 'YouTube subscription not found.');
  }

  if (input.flowId) {
    const [flow] = await db
      .select({
        id: flows.id,
        publishedVersion: flows.publishedVersion,
      })
      .from(flows)
      .where(and(eq(flows.id, input.flowId), eq(flows.workspaceId, workspaceId)))
      .limit(1);

    if (!flow) {
      throw new YouTubeWebSubError('FLOW_NOT_FOUND', 'Published flow not found.');
    }
    if (flow.publishedVersion === null) {
      throw new YouTubeWebSubError(
        'FLOW_NOT_PUBLISHED',
        'Publish the flow before linking it to a YouTube subscription.',
      );
    }
  }

  const [updated] = await db
    .update(youtubeSubscriptions)
    .set({
      flowId: input.flowId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(youtubeSubscriptions.id, subscription.id))
    .returning();

  return serializeSubscription(updated ?? subscription);
}

export function toolsAllowRequestsYouTube(toolsAllow: string[] | undefined): boolean {
  return (toolsAllow ?? []).some((tool) => tool.trim().toLowerCase().startsWith('youtube.'));
}

export async function verifyYouTubeWebSubChallenge(
  db: Db,
  subscriptionId: string,
  query: Record<string, unknown>,
): Promise<string> {
  const subscription = await db.query.youtubeSubscriptions.findFirst({
    where: (subscriptions, { eq: eqOp }) => eqOp(subscriptions.id, subscriptionId),
  });
  if (!subscription) {
    throw new YouTubeWebSubError('SUBSCRIPTION_NOT_FOUND', 'YouTube subscription not found.');
  }

  const challenge = typeof query['hub.challenge'] === 'string' ? query['hub.challenge'] : undefined;
  if (!challenge) {
    throw new YouTubeWebSubError('MISSING_CHALLENGE', 'YouTube WebSub challenge is missing.');
  }

  const topic = typeof query['hub.topic'] === 'string' ? query['hub.topic'] : undefined;
  if (topic && topic !== subscription.topicUrl) {
    throw new YouTubeWebSubError(
      'TOPIC_MISMATCH',
      'YouTube WebSub challenge topic did not match this subscription.',
    );
  }

  const mode = typeof query['hub.mode'] === 'string' ? query['hub.mode'] : 'subscribe';
  const leaseSeconds =
    typeof query['hub.lease_seconds'] === 'string'
      ? Number.parseInt(query['hub.lease_seconds'], 10)
      : undefined;
  const now = new Date();
  const leaseExpiresAt =
    mode === 'subscribe' && Number.isFinite(leaseSeconds)
      ? new Date(now.getTime() + Number(leaseSeconds) * 1000)
      : subscription.leaseExpiresAt;

  await db
    .update(youtubeSubscriptions)
    .set({
      status: mode === 'unsubscribe' ? 'disabled' : 'subscribed',
      leaseExpiresAt: mode === 'unsubscribe' ? null : leaseExpiresAt,
      lastRenewedAt: mode === 'unsubscribe' ? subscription.lastRenewedAt : now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(youtubeSubscriptions.id, subscription.id));

  return challenge;
}

export async function processYouTubeWebSubNotification(
  db: Db,
  subscriptionId: string,
  body: string,
  headers: Record<string, unknown>,
  options: YouTubeNotificationOptions = {},
): Promise<YouTubeNotificationResult> {
  const subscription = await db.query.youtubeSubscriptions.findFirst({
    where: (subscriptions, { eq: eqOp }) => eqOp(subscriptions.id, subscriptionId),
  });
  if (!subscription) {
    throw new YouTubeWebSubError('SUBSCRIPTION_NOT_FOUND', 'YouTube subscription not found.');
  }

  assertValidWebSubSignature(body, headers, env.YOUTUBE_WEBSUB_SECRET);
  const entries = parseYouTubeNotificationEntries(body).filter(
    (entry) => entry.channelId === subscription.channelId,
  );
  const now = new Date();
  const videoIds: string[] = [];
  const videosToLaunch: YouTubeVideoIngestionRow[] = [];

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      videoIds.push(entry.videoId);
      const [video] = await tx
        .insert(youtubeVideoIngestions)
        .values({
          workspaceId: subscription.workspaceId,
          subscriptionId: subscription.id,
          channelId: entry.channelId,
          channelTitle: entry.channelTitle ?? subscription.channelTitle,
          videoId: entry.videoId,
          videoUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
          title: entry.title,
          publishedAt: entry.publishedAt,
          status: subscription.flowId ? 'queued' : 'detected',
          transcriptStatus: 'pending',
          articleStatus: 'pending',
          detectedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [youtubeVideoIngestions.workspaceId, youtubeVideoIngestions.videoId],
          set: {
            subscriptionId: subscription.id,
            channelTitle: entry.channelTitle ?? subscription.channelTitle,
            title: entry.title,
            publishedAt: entry.publishedAt,
            updatedAt: now,
          },
        })
        .returning();

      if (video && subscription.flowId && !video.runId) {
        videosToLaunch.push(video);
      }
    }

    await tx
      .update(youtubeSubscriptions)
      .set({
        lastNotificationAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(youtubeSubscriptions.id, subscription.id));
  });

  if (options.launchLinkedFlow !== false && subscription.flowId) {
    for (const video of videosToLaunch) {
      await launchYouTubeFlowForVideo(db, subscription, video, options.logger);
    }
  }

  return {
    ok: true,
    subscriptionId,
    videoCount: videoIds.length,
    videoIds,
  };
}

function hasTranscriptOutput(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((entry) => hasTranscriptOutput(entry, depth + 1));
  }

  const record = value as Record<string, unknown>;
  if (record.youtubeTranscript && typeof record.youtubeTranscript === 'object') return true;
  if (
    typeof record.transcript === 'string' &&
    record.transcript.trim().length > 0 &&
    (typeof record.videoId === 'string' || typeof record.videoUrl === 'string')
  ) {
    return true;
  }

  return Object.values(record).some((entry) => hasTranscriptOutput(entry, depth + 1));
}

export async function syncYouTubeIngestionFromRun(db: Db, runId: string): Promise<void> {
  const [row] = await db
    .select({
      run: runs,
      ingestion: youtubeVideoIngestions,
      approvedCount: sql<number>`count(${runApprovalRequests.id}) filter (where ${runApprovalRequests.status} = 'approved')`,
    })
    .from(youtubeVideoIngestions)
    .innerJoin(runs, eq(youtubeVideoIngestions.runId, runs.id))
    .leftJoin(runApprovalRequests, eq(runApprovalRequests.runId, runs.id))
    .where(eq(runs.id, runId))
    .groupBy(youtubeVideoIngestions.id, runs.id)
    .limit(1);

  if (!row) return;

  const now = new Date();
  const hasTranscript = hasTranscriptOutput(row.run.output);
  const approvedCount = readCount(row.approvedCount);
  const patch: Partial<typeof youtubeVideoIngestions.$inferInsert> = { updatedAt: now };

  switch (row.run.status) {
    case 'pending':
    case 'running':
      patch.status = 'running';
      if (hasTranscript) patch.transcriptStatus = 'ready';
      break;
    case 'waiting':
      patch.status = 'article_drafted';
      patch.transcriptStatus = 'ready';
      patch.articleStatus = 'drafted';
      patch.error = null;
      break;
    case 'succeeded':
      patch.status = approvedCount > 0 ? 'approved' : 'article_drafted';
      patch.transcriptStatus = 'ready';
      patch.articleStatus = approvedCount > 0 ? 'approved' : 'drafted';
      patch.error = null;
      break;
    case 'failed':
    case 'cancelled':
      patch.status = 'failed';
      patch.transcriptStatus = hasTranscript ? 'ready' : 'failed';
      patch.articleStatus = 'failed';
      patch.error = row.run.error ?? `Run ${row.run.status}`;
      break;
  }

  await db
    .update(youtubeVideoIngestions)
    .set(patch)
    .where(eq(youtubeVideoIngestions.id, row.ingestion.id));
}

export function executeYouTubeLinkedRunInBackground(
  db: Db,
  runId: string,
  logger: Pick<Console, 'error'> = console,
): void {
  executeRunInBackground(
    db,
    runId,
    logger,
    async (innerDb, innerRunId): Promise<Run | null> => {
      const run = await executeRunToCompletion(innerDb, innerRunId);
      await syncYouTubeIngestionFromRun(innerDb, innerRunId);
      return run;
    },
    async (innerDb, innerRunId, message): Promise<Run | null> => {
      const run = await markRunExecutionFailed(innerDb, innerRunId, message);
      await syncYouTubeIngestionFromRun(innerDb, innerRunId);
      return run;
    },
  );
}

export async function startYouTubeVideoArticleRun(
  db: Db,
  workspaceId: string,
  input: YouTubeManualRunInput,
  logger: Pick<Console, 'error'> = console,
): Promise<YouTubeVideoIngestion> {
  const videoId = extractYouTubeVideoId(input.videoUrl);
  if (!videoId) {
    throw new YouTubeWebSubError(
      'INVALID_VIDEO',
      'Enter a valid YouTube video URL or 11-character video ID.',
    );
  }

  const now = new Date();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const [video] = await db
    .insert(youtubeVideoIngestions)
    .values({
      workspaceId,
      channelId: 'manual',
      channelTitle: 'Manual URL',
      videoId,
      videoUrl,
      status: 'queued',
      transcriptStatus: 'pending',
      articleStatus: 'pending',
      detectedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [youtubeVideoIngestions.workspaceId, youtubeVideoIngestions.videoId],
      set: {
        subscriptionId: null,
        channelId: 'manual',
        channelTitle: 'Manual URL',
        videoUrl,
        status: 'queued',
        transcriptStatus: 'pending',
        articleStatus: 'pending',
        error: null,
        detectedAt: now,
        updatedAt: now,
      },
    })
    .returning();

  if (!video) {
    throw new Error('YouTube manual video ingestion save failed');
  }

  try {
    const run = await startPublishedFlowRun(db, {
      flowId: input.flowId,
      workspaceId,
      trigger: {
        type: 'webhook',
        label: 'YouTube video URL',
        eventName: 'youtube.video.article',
        sourceId: videoId,
      },
      input: {
        source: 'youtube-manual-url',
        videoId,
        videoUrl,
        url: videoUrl,
        detectedAt: now.toISOString(),
      },
    });

    const [updated] = await db
      .update(youtubeVideoIngestions)
      .set({
        runId: run.id,
        status: 'running',
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(youtubeVideoIngestions.id, video.id))
      .returning();

    executeYouTubeLinkedRunInBackground(db, run.id, logger);
    return serializeVideoIngestion(updated ?? video);
  } catch (error) {
    const message =
      error instanceof RunLaunchError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    const [failed] = await db
      .update(youtubeVideoIngestions)
      .set({
        status: 'failed',
        articleStatus: 'failed',
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(youtubeVideoIngestions.id, video.id))
      .returning();

    if (error instanceof RunLaunchError) {
      if (error.code === 'FLOW_NOT_FOUND') {
        throw new YouTubeWebSubError('FLOW_NOT_FOUND', error.message);
      }
      if (
        error.code === 'FLOW_NOT_PUBLISHED' ||
        error.code === 'PUBLISHED_VERSION_MISSING' ||
        error.code === 'FLOW_NOT_RUNNABLE' ||
        error.code === 'TRIGGER_NOT_MATCHED'
      ) {
        throw new YouTubeWebSubError('FLOW_NOT_PUBLISHED', error.message);
      }
    }

    if (failed) return serializeVideoIngestion(failed);
    throw error;
  }
}

async function launchYouTubeFlowForVideo(
  db: Db,
  subscription: YouTubeSubscriptionRow,
  video: YouTubeVideoIngestionRow,
  logger: Pick<Console, 'error'> | undefined,
): Promise<void> {
  if (!subscription.flowId) return;

  try {
    const run = await startPublishedFlowRun(db, {
      flowId: subscription.flowId,
      workspaceId: subscription.workspaceId,
      trigger: {
        type: 'webhook',
        label: 'YouTube upload',
        eventName: 'youtube.video.published',
        sourceId: video.videoId,
      },
      input: {
        source: 'youtube-websub',
        subscriptionId: subscription.id,
        channelId: video.channelId,
        channelTitle: video.channelTitle,
        videoId: video.videoId,
        videoUrl: video.videoUrl,
        title: video.title,
        publishedAt: iso(video.publishedAt),
        detectedAt: video.detectedAt.toISOString(),
      },
    });

    await db
      .update(youtubeVideoIngestions)
      .set({
        runId: run.id,
        status: 'running',
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(youtubeVideoIngestions.id, video.id));

    executeYouTubeLinkedRunInBackground(db, run.id, logger ?? console);
  } catch (error) {
    const message =
      error instanceof RunLaunchError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    await db
      .update(youtubeVideoIngestions)
      .set({
        status: 'failed',
        articleStatus: 'failed',
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(youtubeVideoIngestions.id, video.id));

    await db
      .update(youtubeSubscriptions)
      .set({
        lastError: message,
        updatedAt: new Date(),
      })
      .where(eq(youtubeSubscriptions.id, subscription.id));
  }
}

export async function buildYouTubeCronContext(db: Db, workspaceId: string): Promise<string> {
  const settings = await loadYouTubeProfileSettings(db, workspaceId);
  if (settings.channelRefs.length === 0) {
    return [
      'YouTube context:',
      `- Profile "${settings.profile.name}" is configured with an encrypted API key.`,
      '- No channel IDs or handles are configured yet, so ask the user to add channels in Channels -> YouTube Data API.',
      '- Access mode: read-only public YouTube Data API metadata. Do not claim private account access.',
    ].join('\n');
  }

  const blocks: string[] = [
    `YouTube context from wrapper profile "${settings.profile.name}" (read-only public Data API):`,
  ];

  for (const ref of settings.channelRefs) {
    const channel = await resolveChannel(settings.apiKey, ref, settings.includeStatistics);
    if (!channel?.id) {
      blocks.push(`Channel ${ref}: not found or not accessible with the configured API key.`);
      continue;
    }

    const stats = channel.statistics;
    const statParts = settings.includeStatistics
      ? [
          stats?.hiddenSubscriberCount
            ? undefined
            : formatCompactNumber(stats?.subscriberCount)
              ? `subscribers ${formatCompactNumber(stats?.subscriberCount)}`
              : undefined,
          formatCompactNumber(stats?.videoCount)
            ? `videos ${formatCompactNumber(stats?.videoCount)}`
            : undefined,
          formatCompactNumber(stats?.viewCount)
            ? `views ${formatCompactNumber(stats?.viewCount)}`
            : undefined,
        ].filter(Boolean)
      : [];
    const channelHeader = [
      `Channel: ${channel.snippet?.title ?? ref}`,
      `id ${channel.id}`,
      statParts.length ? statParts.join(', ') : undefined,
    ]
      .filter(Boolean)
      .join(' | ');

    blocks.push(channelHeader);

    const videos = await fetchRecentVideos(settings.apiKey, channel.id, settings.maxResults);
    if (videos.length === 0) {
      blocks.push('- No recent public videos returned.');
      continue;
    }

    for (const video of videos) {
      const videoId = video.id?.videoId;
      const title = video.snippet?.title ?? 'Untitled video';
      const publishedAt = video.snippet?.publishedAt ?? 'unknown date';
      const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : 'missing video URL';
      blocks.push(`- ${title} | published ${publishedAt} | ${url}`);
    }
  }

  blocks.push(
    'Use this YouTube data only as read-only public context. Do not expose API keys or imply private OAuth access.',
  );
  return blocks.join('\n');
}

function iso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function serializeSubscription(
  row: typeof youtubeSubscriptions.$inferSelect,
): YouTubeSubscription {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelProfileId: row.channelProfileId ?? undefined,
    channelId: row.channelId,
    channelHandle: row.channelHandle ?? undefined,
    channelTitle: row.channelTitle ?? undefined,
    flowId: row.flowId ?? undefined,
    topicUrl: row.topicUrl,
    callbackUrl: row.callbackUrl,
    status: row.status,
    leaseExpiresAt: iso(row.leaseExpiresAt),
    lastNotificationAt: iso(row.lastNotificationAt),
    lastRenewedAt: iso(row.lastRenewedAt),
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeVideoIngestion(
  row: typeof youtubeVideoIngestions.$inferSelect,
): YouTubeVideoIngestion {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    subscriptionId: row.subscriptionId ?? undefined,
    channelId: row.channelId,
    channelTitle: row.channelTitle ?? undefined,
    videoId: row.videoId,
    videoUrl: row.videoUrl,
    title: row.title ?? undefined,
    publishedAt: iso(row.publishedAt),
    status: row.status,
    transcriptStatus: row.transcriptStatus,
    articleStatus: row.articleStatus,
    runId: row.runId ?? undefined,
    error: row.error ?? undefined,
    detectedAt: row.detectedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function readCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function getYouTubeOverview(db: Db, workspaceId: string): Promise<YouTubeOverview> {
  const [profiles, subscriptionRows, videoRows, subscriptionTotals, videoTotals] =
    await Promise.all([
      db
        .select({
          id: channelProfiles.id,
          name: channelProfiles.name,
          appliedAt: channelProfiles.appliedAt,
          updatedAt: channelProfiles.updatedAt,
        })
        .from(channelProfiles)
        .where(
          and(
            eq(channelProfiles.workspaceId, workspaceId),
            eq(channelProfiles.templateId, 'youtube-data-api'),
          ),
        )
        .orderBy(desc(channelProfiles.appliedAt), desc(channelProfiles.updatedAt)),
      db
        .select()
        .from(youtubeSubscriptions)
        .where(eq(youtubeSubscriptions.workspaceId, workspaceId))
        .orderBy(desc(youtubeSubscriptions.updatedAt))
        .limit(25),
      db
        .select()
        .from(youtubeVideoIngestions)
        .where(eq(youtubeVideoIngestions.workspaceId, workspaceId))
        .orderBy(desc(youtubeVideoIngestions.detectedAt))
        .limit(25),
      db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${youtubeSubscriptions.status} in ('subscribed', 'renewal_due'))`,
        })
        .from(youtubeSubscriptions)
        .where(eq(youtubeSubscriptions.workspaceId, workspaceId)),
      db
        .select({
          total: sql<number>`count(*)`,
          pending: sql<number>`count(*) filter (where ${youtubeVideoIngestions.status} in ('detected', 'queued', 'running', 'transcript_ready', 'article_drafted'))`,
          failed: sql<number>`count(*) filter (where ${youtubeVideoIngestions.status} = 'failed')`,
        })
        .from(youtubeVideoIngestions)
        .where(eq(youtubeVideoIngestions.workspaceId, workspaceId)),
    ]);

  return {
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      appliedAt: iso(profile.appliedAt),
      updatedAt: profile.updatedAt.toISOString(),
    })),
    totals: {
      subscriptions: readCount(subscriptionTotals[0]?.total),
      activeSubscriptions: readCount(subscriptionTotals[0]?.active),
      videos: readCount(videoTotals[0]?.total),
      pendingVideos: readCount(videoTotals[0]?.pending),
      failedVideos: readCount(videoTotals[0]?.failed),
    },
    subscriptions: subscriptionRows.map(serializeSubscription),
    recentVideos: videoRows.map(serializeVideoIngestion),
  };
}
