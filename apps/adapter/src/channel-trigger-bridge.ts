import type { OpenClawClient, OpenClawGatewayEvent } from '@openclaw-wrapper/openclaw-client';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { flowVersions, flows } from './db/schema.js';
import { getOpenClawClient } from './openclaw.js';
import { RunLaunchError, executeRunInBackground, startPublishedFlowRun } from './run-service.js';

interface GatewayTranscriptMessage {
  role?: unknown;
  content?: unknown;
  text?: unknown;
}

interface GatewaySessionMessagePayload {
  sessionKey?: unknown;
  message?: GatewayTranscriptMessage;
  messageId?: unknown;
  messageSeq?: unknown;
  lastChannel?: unknown;
  lastTo?: unknown;
  lastAccountId?: unknown;
  lastThreadId?: unknown;
  deliveryContext?: unknown;
  origin?: unknown;
}

export interface InboundChannelSessionEvent {
  channel: string;
  sessionKey: string;
  sourceId: string;
  message?: string;
  messageId?: string;
  messageSeq?: number;
  to?: string;
  accountId?: string;
  routeKey?: string;
  threadId?: string;
  raw: GatewaySessionMessagePayload;
}

interface BridgeLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

type CandidateFlowLister = (db: Db) => Promise<string[]>;
type RunLauncher = typeof startPublishedFlowRun;
type BackgroundExecutor = typeof executeRunInBackground;
type RecentEventStore = Pick<RecentEventCache, 'has' | 'add'>;

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getNestedValue(record: unknown, path: string[]): unknown {
  let current = record;
  for (const segment of path) {
    if (
      !current ||
      typeof current !== 'object' ||
      !(segment in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function getNestedString(record: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = normalizeOptionalString(getNestedValue(record, path));
    if (value) return value;
  }
  return undefined;
}

export function extractFirstTextBlock(message: unknown): string | undefined {
  const directText = normalizeOptionalString((message as { text?: unknown } | undefined)?.text);
  if (directText) return directText;

  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;

  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const type = normalizeOptionalString((block as { type?: unknown }).type);
    const text = normalizeOptionalString((block as { text?: unknown }).text);
    if ((type === 'text' || !type) && text) {
      return text;
    }
  }

  return undefined;
}

function normalizeThreadId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return normalizeOptionalString(value);
}

export function normalizeInboundChannelSessionEvent(
  payload: unknown,
): InboundChannelSessionEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as GatewaySessionMessagePayload;
  const sessionKey = normalizeOptionalString(raw.sessionKey);
  const role = normalizeOptionalString(raw.message?.role);
  const channel =
    normalizeOptionalString(raw.lastChannel) ??
    getNestedString(raw, [
      ['deliveryContext', 'channel'],
      ['origin', 'channel'],
      ['origin', 'provider'],
    ]);

  if (!sessionKey || role !== 'user' || !channel) {
    return null;
  }

  const messageId = normalizeOptionalString(raw.messageId);
  const messageSeq =
    typeof raw.messageSeq === 'number' && Number.isFinite(raw.messageSeq)
      ? raw.messageSeq
      : undefined;
  const sourceId = messageId ?? `${sessionKey}:${messageSeq ?? 'live'}`;
  const to =
    normalizeOptionalString(raw.lastTo) ??
    getNestedString(raw, [
      ['deliveryContext', 'to'],
      ['origin', 'to'],
      ['origin', 'chatId'],
      ['origin', 'recipientId'],
    ]);
  const accountId =
    normalizeOptionalString(raw.lastAccountId) ??
    getNestedString(raw, [
      ['deliveryContext', 'accountId'],
      ['origin', 'accountId'],
    ]);
  const routeKey = getNestedString(raw, [
    ['deliveryContext', 'routeKey'],
    ['origin', 'routeKey'],
  ]);
  const threadId =
    normalizeThreadId(raw.lastThreadId) ??
    normalizeThreadId(getNestedValue(raw, ['deliveryContext', 'threadId'])) ??
    normalizeThreadId(getNestedValue(raw, ['origin', 'threadId']));

  return {
    channel,
    sessionKey,
    sourceId,
    ...(messageId ? { messageId } : {}),
    ...(messageSeq !== undefined ? { messageSeq } : {}),
    ...(extractFirstTextBlock(raw.message) ? { message: extractFirstTextBlock(raw.message) } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
    ...(routeKey ? { routeKey } : {}),
    ...(threadId ? { threadId } : {}),
    raw,
  };
}

export async function listPublishedChannelTriggerFlowIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({
      flowId: flows.id,
      nodes: flowVersions.nodes,
    })
    .from(flows)
    .innerJoin(
      flowVersions,
      and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)),
    )
    .where(isNotNull(flows.publishedVersion));

  return rows
    .filter((row) => row.nodes.some((node) => node.type === 'trigger.channel'))
    .map((row) => row.flowId);
}

class RecentEventCache {
  private readonly seen = new Map<string, number>();

  has(key: string): boolean {
    this.gc();
    return this.seen.has(key);
  }

  add(key: string): void {
    this.gc();
    this.seen.set(key, Date.now());
  }

  private gc(): void {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, at] of this.seen) {
      if (at < cutoff) {
        this.seen.delete(key);
      }
    }
  }
}

export async function handleInboundChannelSessionMessage(params: {
  db: Db;
  payload: unknown;
  logger?: BridgeLogger;
  listCandidateFlowIds?: CandidateFlowLister;
  launchRun?: RunLauncher;
  executeRun?: BackgroundExecutor;
  recentEvents?: RecentEventStore;
}): Promise<number> {
  const normalized = normalizeInboundChannelSessionEvent(params.payload);
  if (!normalized) return 0;

  const recentEvents = params.recentEvents ?? new RecentEventCache();
  const dedupeKey =
    normalized.messageId !== undefined
      ? `${normalized.sessionKey}:message:${normalized.messageId}`
      : normalized.messageSeq !== undefined
        ? `${normalized.sessionKey}:seq:${normalized.messageSeq}`
        : null;
  if (dedupeKey && recentEvents.has(dedupeKey)) {
    return 0;
  }
  if (dedupeKey) {
    recentEvents.add(dedupeKey);
  }

  const listCandidateFlowIds = params.listCandidateFlowIds ?? listPublishedChannelTriggerFlowIds;
  const launchRun = params.launchRun ?? startPublishedFlowRun;
  const executeRun = params.executeRun ?? executeRunInBackground;
  const logger = params.logger ?? console;

  const candidateFlowIds = await listCandidateFlowIds(params.db);
  let launched = 0;

  for (const flowId of candidateFlowIds) {
    try {
      const run = await launchRun(params.db, {
        flowId,
        trigger: {
          type: 'channel',
          label: `${normalized.channel} inbound`,
          channel: normalized.channel,
          sourceId: normalized.sourceId,
          ...(normalized.accountId ? { accountId: normalized.accountId } : {}),
          ...(normalized.routeKey ? { routeKey: normalized.routeKey } : {}),
        },
        input: {
          channelType: normalized.channel,
          sessionKey: normalized.sessionKey,
          sourceId: normalized.sourceId,
          ...(normalized.message ? { message: normalized.message } : {}),
          ...(normalized.messageId ? { messageId: normalized.messageId } : {}),
          ...(normalized.messageSeq !== undefined ? { messageSeq: normalized.messageSeq } : {}),
          ...(normalized.to ? { to: normalized.to } : {}),
          ...(normalized.accountId ? { accountId: normalized.accountId } : {}),
          ...(normalized.routeKey ? { routeKey: normalized.routeKey } : {}),
          ...(normalized.threadId ? { threadId: normalized.threadId } : {}),
          rawMessage: normalized.raw.message,
          deliveryContext:
            typeof normalized.raw.deliveryContext === 'object'
              ? normalized.raw.deliveryContext
              : undefined,
          origin: typeof normalized.raw.origin === 'object' ? normalized.raw.origin : undefined,
        },
      });
      executeRun(params.db, run.id, {
        error: (...args: unknown[]) => {
          logger.error?.(...args);
        },
      });
      launched += 1;
    } catch (error) {
      if (error instanceof RunLaunchError && error.code === 'TRIGGER_NOT_MATCHED') {
        continue;
      }
      logger.warn?.('[channel-trigger-bridge] failed to launch flow for inbound event', {
        flowId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return launched;
}

export function startLiveChannelTriggerBridge(params: {
  db: Db;
  client?: OpenClawClient;
  logger?: BridgeLogger;
  listCandidateFlowIds?: CandidateFlowLister;
  launchRun?: RunLauncher;
  executeRun?: BackgroundExecutor;
}): () => void {
  const client = params.client ?? getOpenClawClient({ eagerConnect: false });
  const logger = params.logger ?? console;
  const recentEvents = new RecentEventCache();
  let closed = false;

  const ensureSubscribed = () => {
    if (closed) return;
    void client
      .request('sessions.subscribe', {})
      .then(() => {
        logger.info?.('[channel-trigger-bridge] subscribed to session.message events');
      })
      .catch((error) => {
        logger.warn?.(
          '[channel-trigger-bridge] failed to subscribe to session events',
          error instanceof Error ? error.message : String(error),
        );
      });
  };

  const unsubscribeConnected = client.onConnected(() => {
    ensureSubscribed();
  });

  const unsubscribeEvents = client.onEvent((event: OpenClawGatewayEvent) => {
    if (event.event !== 'session.message') return;
    void handleInboundChannelSessionMessage({
      db: params.db,
      payload: event.payload,
      logger,
      listCandidateFlowIds: params.listCandidateFlowIds,
      launchRun: params.launchRun,
      executeRun: params.executeRun,
      recentEvents,
    });
  });

  if (client.isConnected()) {
    ensureSubscribed();
  } else {
    queueMicrotask(() => {
      if (closed || client.isConnected()) return;
      void client.connect().catch((error) => {
        logger.warn?.(
          '[channel-trigger-bridge] deferred gateway connect failed',
          error instanceof Error ? error.message : String(error),
        );
      });
    });
  }

  return () => {
    closed = true;
    unsubscribeConnected();
    unsubscribeEvents();
  };
}
