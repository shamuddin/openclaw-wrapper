import { and, eq, lte } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { runs } from './db/schema.js';
import { executeRunInBackground, resumeWaitingRun } from './run-service.js';

interface WaitLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

type WaitingRunLister = (db: Db, at: Date) => Promise<string[]>;
type WaitingRunResumer = typeof resumeWaitingRun;
type BackgroundExecutor = typeof executeRunInBackground;

export async function listDueWaitingRunIds(db: Db, at: Date): Promise<string[]> {
  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.status, 'waiting'), lte(runs.resumeAt, at)))
    .orderBy(runs.resumeAt);

  return rows.map((row) => row.id);
}

export async function processWaitingRuns(params: {
  db: Db;
  at?: Date;
  logger?: WaitLogger;
  listRuns?: WaitingRunLister;
  resumeRun?: WaitingRunResumer;
  executeRun?: BackgroundExecutor;
}): Promise<number> {
  const at = params.at ?? new Date();
  const logger = params.logger ?? console;
  const listRuns = params.listRuns ?? listDueWaitingRunIds;
  const resumeRun = params.resumeRun ?? resumeWaitingRun;
  const executeRun = params.executeRun ?? executeRunInBackground;

  const dueRunIds = await listRuns(params.db, at);
  let resumed = 0;

  for (const runId of dueRunIds) {
    try {
      const run = await resumeRun(params.db, runId);
      if (!run || run.status !== 'running') {
        continue;
      }
      executeRun(params.db, run.id, {
        error: (...args: unknown[]) => {
          logger.error?.(...args);
        },
      });
      resumed += 1;
    } catch (error) {
      logger.warn?.('[wait-resume-service] failed to resume waiting run', {
        runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return resumed;
}

export function startWaitResumeService(params: {
  db: Db;
  intervalMs?: number;
  logger?: WaitLogger;
  listRuns?: WaitingRunLister;
  resumeRun?: WaitingRunResumer;
  executeRun?: BackgroundExecutor;
  now?: () => Date;
}): () => void {
  const logger = params.logger ?? console;
  const now = params.now ?? (() => new Date());
  const intervalMs = params.intervalMs ?? 5_000;

  let closed = false;

  const tick = () => {
    if (closed) return;
    void processWaitingRuns({
      db: params.db,
      at: now(),
      logger,
      listRuns: params.listRuns,
      resumeRun: params.resumeRun,
      executeRun: params.executeRun,
    });
  };

  tick();
  const handle = setInterval(tick, intervalMs);

  return () => {
    closed = true;
    clearInterval(handle);
  };
}
