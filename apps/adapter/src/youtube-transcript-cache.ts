import { and, eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { youtubeTranscriptCache } from './db/schema.js';
import type { YouTubeTranscriptResult } from './youtube-transcript.js';

type TranscriptCacheResult = YouTubeTranscriptResult & {
  cacheHit: boolean;
};

function normalizeSegments(
  segments: YouTubeTranscriptResult['segments'] | null | undefined,
): YouTubeTranscriptResult['segments'] {
  return (segments ?? [])
    .map((segment) => ({
      text: String(segment.text ?? '').trim(),
      start: Number(segment.start ?? 0),
      duration: Number(segment.duration ?? 0),
    }))
    .filter((segment) => segment.text.length > 0);
}

export async function loadCachedYouTubeTranscript(
  db: Db,
  input: {
    workspaceId: string;
    videoId: string;
  },
): Promise<TranscriptCacheResult | undefined> {
  const [row] = await db
    .select()
    .from(youtubeTranscriptCache)
    .where(
      and(
        eq(youtubeTranscriptCache.workspaceId, input.workspaceId),
        eq(youtubeTranscriptCache.videoId, input.videoId),
      ),
    )
    .limit(1);

  if (!row) return undefined;

  const now = new Date();
  await db
    .update(youtubeTranscriptCache)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(youtubeTranscriptCache.id, row.id));

  const segments = normalizeSegments(row.segments);
  return {
    videoId: row.videoId,
    videoUrl: row.videoUrl,
    provider: row.provider,
    ...(row.title ? { title: row.title } : {}),
    ...(row.duration ? { duration: row.duration } : {}),
    ...(row.language ? { language: row.language } : {}),
    transcript: row.transcript,
    segments,
    segmentCount: row.segmentCount || segments.length,
    characterCount: row.characterCount || row.transcript.length,
    cacheHit: true,
  };
}

export async function saveCachedYouTubeTranscript(
  db: Db,
  input: {
    workspaceId: string;
    transcript: YouTubeTranscriptResult;
  },
): Promise<void> {
  const now = new Date();
  const segments = normalizeSegments(input.transcript.segments);
  await db
    .insert(youtubeTranscriptCache)
    .values({
      workspaceId: input.workspaceId,
      videoId: input.transcript.videoId,
      videoUrl: input.transcript.videoUrl,
      provider: input.transcript.provider ?? 'transcriptapi',
      title: input.transcript.title,
      duration: input.transcript.duration,
      language: input.transcript.language,
      transcript: input.transcript.transcript,
      segments,
      segmentCount: input.transcript.segmentCount,
      characterCount: input.transcript.characterCount,
      fetchedAt: now,
      lastUsedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [youtubeTranscriptCache.workspaceId, youtubeTranscriptCache.videoId],
      set: {
        videoUrl: input.transcript.videoUrl,
        provider: input.transcript.provider ?? 'transcriptapi',
        title: input.transcript.title,
        duration: input.transcript.duration,
        language: input.transcript.language,
        transcript: input.transcript.transcript,
        segments,
        segmentCount: input.transcript.segmentCount,
        characterCount: input.transcript.characterCount,
        fetchedAt: now,
        lastUsedAt: now,
        updatedAt: now,
      },
    });
}
