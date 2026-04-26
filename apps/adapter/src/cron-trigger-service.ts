import { cronExpressionMatches } from '@openclaw-wrapper/schemas';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { flowVersions, flows } from './db/schema.js';
import {
  RunLaunchError,
  executeRunInBackground,
  getRunLaunchErrorHttpStatus,
  startPublishedFlowRun,
} from './run-service.js';

interface BridgeLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

interface PublishedCronTriggerFlow {
  flowId: string;
  flowName: string;
  schedule: string;
  timezone: string;
}

type FlowLister = (db: Db) => Promise<PublishedCronTriggerFlow[]>;
type RunLauncher = typeof startPublishedFlowRun;
type BackgroundExecutor = typeof executeRunInBackground;

function getCurrentTickKey(at: Date, timezone: string): string | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(at);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const year = lookup.year;
    const month = lookup.month;
    const day = lookup.day;
    const hour = lookup.hour;
    const minute = lookup.minute;
    if (!year || !month || !day || !hour || !minute) {
      return null;
    }
    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    return null;
  }
}

class RecentCronTickCache {
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
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [key, at] of this.seen) {
      if (at < cutoff) {
        this.seen.delete(key);
      }
    }
  }
}

export async function listPublishedCronTriggerFlows(db: Db): Promise<PublishedCronTriggerFlow[]> {
  const rows = await db
    .select({
      flowId: flows.id,
      flowName: flows.name,
      nodes: flowVersions.nodes,
    })
    .from(flows)
    .innerJoin(
      flowVersions,
      and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)),
    )
    .where(isNotNull(flows.publishedVersion));

  return rows.flatMap((row) =>
    row.nodes
      .filter((node) => node.type === 'trigger.cron')
      .map((node) => ({
        flowId: row.flowId,
        flowName: row.flowName,
        schedule: typeof node.data.schedule === 'string' ? node.data.schedule.trim() : '',
        timezone:
          typeof node.data.timezone === 'string' && node.data.timezone.trim().length > 0
            ? node.data.timezone.trim()
            : 'UTC',
      }))
      .filter((entry) => entry.schedule.length > 0),
  );
}

export async function processCronTriggers(params: {
  db: Db;
  at?: Date;
  logger?: BridgeLogger;
  listFlows?: FlowLister;
  launchRun?: RunLauncher;
  executeRun?: BackgroundExecutor;
  recentTicks?: Pick<RecentCronTickCache, 'has' | 'add'>;
}): Promise<number> {
  const at = params.at ?? new Date();
  const logger = params.logger ?? console;
  const listFlows = params.listFlows ?? listPublishedCronTriggerFlows;
  const launchRun = params.launchRun ?? startPublishedFlowRun;
  const executeRun = params.executeRun ?? executeRunInBackground;
  const recentTicks = params.recentTicks ?? new RecentCronTickCache();

  const flowsWithCron = await listFlows(params.db);
  let launched = 0;

  for (const flow of flowsWithCron) {
    if (!cronExpressionMatches(flow.schedule, at, flow.timezone)) {
      continue;
    }

    const tickKey = getCurrentTickKey(at, flow.timezone);
    if (!tickKey) {
      logger.warn?.('[cron-trigger-service] failed to compute tick key', {
        flowId: flow.flowId,
        timezone: flow.timezone,
      });
      continue;
    }

    const dedupeKey = `${flow.flowId}:${flow.schedule}:${flow.timezone}:${tickKey}`;
    if (recentTicks.has(dedupeKey)) {
      continue;
    }
    recentTicks.add(dedupeKey);

    try {
      const run = await launchRun(params.db, {
        flowId: flow.flowId,
        trigger: {
          type: 'cron',
          label: 'Cron schedule',
          schedule: flow.schedule,
          timezone: flow.timezone,
          sourceId: dedupeKey,
        },
        input: {
          scheduledAt: at.toISOString(),
          schedule: flow.schedule,
          timezone: flow.timezone,
          flowName: flow.flowName,
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
      logger.warn?.('[cron-trigger-service] failed to launch cron flow', {
        flowId: flow.flowId,
        status: error instanceof RunLaunchError ? getRunLaunchErrorHttpStatus(error) : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return launched;
}

export function startCronTriggerService(params: {
  db: Db;
  intervalMs?: number;
  logger?: BridgeLogger;
  listFlows?: FlowLister;
  launchRun?: RunLauncher;
  executeRun?: BackgroundExecutor;
  now?: () => Date;
}): () => void {
  const logger = params.logger ?? console;
  const now = params.now ?? (() => new Date());
  const intervalMs = params.intervalMs ?? 15_000;
  const recentTicks = new RecentCronTickCache();

  let closed = false;

  const tick = () => {
    if (closed) return;
    void processCronTriggers({
      db: params.db,
      at: now(),
      logger,
      listFlows: params.listFlows,
      launchRun: params.launchRun,
      executeRun: params.executeRun,
      recentTicks,
    });
  };

  tick();
  const handle = setInterval(tick, intervalMs);

  return () => {
    closed = true;
    clearInterval(handle);
  };
}
