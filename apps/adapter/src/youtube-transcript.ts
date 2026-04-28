import { spawn } from 'node:child_process';
import { env } from './env.js';

export interface YouTubeTranscriptSegment {
  text: string;
  start: number;
  duration: number;
}

export interface YouTubeTranscriptResult {
  videoId: string;
  videoUrl: string;
  provider?: string;
  title?: string;
  duration?: string;
  language?: string;
  transcript: string;
  segments: YouTubeTranscriptSegment[];
  segmentCount: number;
  characterCount: number;
}

export function extractYouTubeVideoId(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (/^[a-zA-Z0-9_-]{11}$/u.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./u, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/u.test(id) ? id : undefined;
    }
    if (host.endsWith('youtube.com')) {
      const watchId = url.searchParams.get('v');
      if (watchId && /^[a-zA-Z0-9_-]{11}$/u.test(watchId)) return watchId;
      const parts = url.pathname.split('/').filter(Boolean);
      const candidate =
        parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live'
          ? parts[1]
          : undefined;
      return candidate && /^[a-zA-Z0-9_-]{11}$/u.test(candidate) ? candidate : undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizeLanguages(languages: string[] | undefined): string[] {
  const normalized = (languages ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : ['en'];
}

export async function fetchYouTubeTranscript(input: {
  videoIdOrUrl: string;
  languages?: string[];
  preserveFormatting?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<YouTubeTranscriptResult> {
  const videoId = extractYouTubeVideoId(input.videoIdOrUrl);
  if (!videoId) {
    throw new Error('YouTube transcript requires a valid video ID or YouTube URL.');
  }

  const languages = normalizeLanguages(input.languages);
  const script = `
import json
import sys
from youtube_transcript_api import YouTubeTranscriptApi

video_id = sys.argv[1]
languages = json.loads(sys.argv[2])
preserve_formatting = sys.argv[3].lower() == "true"
segments = YouTubeTranscriptApi.get_transcript(
    video_id,
    languages=languages,
    preserve_formatting=preserve_formatting,
)
print(json.dumps({"segments": segments}, ensure_ascii=False))
`;

  const timeoutMs = Math.max(1_000, input.timeoutMs ?? env.YOUTUBE_TRANSCRIPT_TIMEOUT_MS);
  const childEnv = {
    ...process.env,
    ...(env.YOUTUBE_TRANSCRIPT_HTTP_PROXY ? { HTTP_PROXY: env.YOUTUBE_TRANSCRIPT_HTTP_PROXY } : {}),
    ...(env.YOUTUBE_TRANSCRIPT_HTTPS_PROXY
      ? { HTTPS_PROXY: env.YOUTUBE_TRANSCRIPT_HTTPS_PROXY }
      : {}),
  };

  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      env.YOUTUBE_TRANSCRIPT_PYTHON,
      ['-c', script, videoId, JSON.stringify(languages), String(input.preserveFormatting ?? false)],
      { env: childEnv, windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`YouTube transcript timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const abortHandler = () => {
      child.kill('SIGTERM');
      reject(new Error('YouTube transcript extraction was cancelled'));
    };
    input.signal?.addEventListener('abort', abortHandler, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abortHandler);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abortHandler);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `youtube-transcript-api exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });

  const parsed = JSON.parse(raw) as { segments?: YouTubeTranscriptSegment[] };
  const segments = (parsed.segments ?? []).map((segment) => ({
    text: String(segment.text ?? '').trim(),
    start: Number(segment.start ?? 0),
    duration: Number(segment.duration ?? 0),
  }));
  const transcript = segments.map((segment) => segment.text).filter(Boolean).join('\n');
  if (!transcript) {
    throw new Error(`No transcript text was returned for YouTube video "${videoId}".`);
  }

  return {
    videoId,
    videoUrl: buildVideoUrl(videoId),
    provider: 'youtube-transcript-api',
    language: languages[0],
    transcript,
    segments,
    segmentCount: segments.length,
    characterCount: transcript.length,
  };
}

interface TranscriptApiSegment {
  start?: number | string;
  duration?: number | string;
  text?: string;
}

interface TranscriptApiResponse {
  video_id?: string;
  language?: string;
  title?: string;
  duration?: string;
  metadata?: {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
  };
  segments?: TranscriptApiSegment[];
  transcript?: string | TranscriptApiSegment[];
  text?: string;
  detail?: string;
  error?: string;
  message?: string;
}

export async function fetchTranscriptApiYouTubeTranscript(input: {
  videoIdOrUrl: string;
  apiKey?: string;
  baseUrl?: string;
  format?: 'json' | 'text';
  includeTimestamp?: boolean;
  sendMetadata?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<YouTubeTranscriptResult> {
  const apiKey = input.apiKey ?? env.TRANSCRIPT_API_KEY;
  if (!apiKey) {
    throw new Error('Save a TranscriptAPI.com profile or set TRANSCRIPT_API_KEY to use the TranscriptAPI provider.');
  }

  const videoId = extractYouTubeVideoId(input.videoIdOrUrl);
  if (!videoId) {
    throw new Error('TranscriptAPI requires a valid YouTube video ID or URL.');
  }

  const baseUrl = (input.baseUrl ?? env.TRANSCRIPT_API_BASE_URL).replace(/\/+$/u, '');
  const url = new URL(`${baseUrl}/youtube/transcript`);
  url.searchParams.set('video_url', buildVideoUrl(videoId));
  url.searchParams.set('format', input.format ?? 'json');
  url.searchParams.set('include_timestamp', String(input.includeTimestamp ?? true));
  if (input.sendMetadata) {
    url.searchParams.set('send_metadata', 'true');
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? env.YOUTUBE_TRANSCRIPT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortHandler = () => controller.abort();
  input.signal?.addEventListener('abort', abortHandler, { once: true });

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`TranscriptAPI request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abortHandler);
  }

  const raw = await response.text();
  let payload: TranscriptApiResponse;
  try {
    payload = raw ? (JSON.parse(raw) as TranscriptApiResponse) : {};
  } catch {
    payload = { message: raw };
  }

  if (!response.ok) {
    const detail = payload.detail ?? payload.error ?? payload.message ?? response.statusText;
    throw new Error(`TranscriptAPI request failed (${response.status}): ${detail}`);
  }

  const rawSegments = Array.isArray(payload.transcript) ? payload.transcript : payload.segments;
  const segments = (rawSegments ?? [])
    .map((segment) => ({
      text: String(segment.text ?? '').trim(),
      start: Number(segment.start ?? 0),
      duration: Number(segment.duration ?? 0),
    }))
    .filter((segment) => segment.text.length > 0);
  const transcript =
    segments.length > 0
      ? segments.map((segment) => segment.text).join('\n')
      : typeof payload.transcript === 'string'
        ? payload.transcript.trim()
        : String(payload.text ?? '').trim();

  if (!transcript) {
    throw new Error(`TranscriptAPI did not return transcript text for YouTube video "${videoId}".`);
  }

  return {
    videoId: payload.video_id ?? videoId,
    videoUrl: buildVideoUrl(videoId),
    provider: 'transcriptapi',
    ...(payload.title ?? payload.metadata?.title
      ? { title: payload.title ?? payload.metadata?.title }
      : {}),
    ...(payload.duration ? { duration: payload.duration } : {}),
    ...(payload.language ? { language: payload.language } : {}),
    transcript,
    segments,
    segmentCount: segments.length,
    characterCount: transcript.length,
  };
}
