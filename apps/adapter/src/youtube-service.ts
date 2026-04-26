import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import type { ChannelProfileRow } from './db/schema.js';
import { channelProfiles } from './db/schema.js';
import { decryptSecretValue } from './secret-store.js';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TEST_CHANNEL_ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
const MAX_CHANNELS_PER_CONTEXT = 5;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;

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

export function toolsAllowRequestsYouTube(toolsAllow: string[] | undefined): boolean {
  return (toolsAllow ?? []).some((tool) => tool.trim().toLowerCase().startsWith('youtube.'));
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
