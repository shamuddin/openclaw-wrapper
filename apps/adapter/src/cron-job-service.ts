import {
  cronExpressionMatches,
  isValidCronTimezone,
  type CronDeliveryStatus,
  type CronJobState,
  type CronPayload,
  type CronSchedule,
  type CronSessionTarget,
  validateCronExpression,
} from '@openclaw-wrapper/schemas';
import { and, eq } from 'drizzle-orm';
import type { OpenClawClient } from '@openclaw-wrapper/openclaw-client';
import type { Db } from './db/client.js';
import { cronJobRuns, cronJobs, type CronJobRow } from './db/schema.js';
import { executeRunInBackground, startPublishedFlowRun } from './run-service.js';
import { getOpenClawClient, runOpenClawAgent } from './openclaw.js';
import { isFlowManagedCronJob } from './flow-cron-jobs.js';

interface BridgeLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface CronSchedulerStatus {
  enabledJobs: number;
  totalJobs: number;
  runningJobs: number;
  dueJobs: number;
  nextWakeAt?: string;
}

export interface CronJobRunResult {
  jobId: string;
  triggered: boolean;
  status: 'ok' | 'error' | 'skipped';
  summary?: string;
  error?: string;
  nextRunAt?: string;
}

interface CronExecutionResult {
  status: 'ok' | 'error' | 'skipped';
  summary?: string;
  error?: string;
}

interface CronDeliveryAttempt {
  attempted: boolean;
  delivered: boolean;
  status: CronDeliveryStatus;
  error?: string;
}

interface CronFailureAlertAttempt {
  attempted: boolean;
  sent: boolean;
  atMs?: number;
  error?: string;
}

type CronExecutor = (params: {
  db: Db;
  job: CronJobRow;
  now: Date;
  client?: OpenClawClient;
  logger?: BridgeLogger;
}) => Promise<CronExecutionResult>;

function readCronJobState(job: Pick<CronJobRow, 'state'>): CronJobState {
  return job.state ?? {};
}

function mergeCronJobState(
  current: CronJobState | undefined,
  patch: Partial<CronJobState>,
): CronJobState {
  return {
    ...(current ?? {}),
    ...patch,
  };
}

function floorToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseAtTimestamp(value: string): number | undefined {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function computeEveryNextRunMs(params: {
  schedule: Extract<CronSchedule, { kind: 'every' }>;
  createdAtMs: number;
  nowMs: number;
  lastRunAtMs?: number;
}): number {
  const anchorMs = params.schedule.anchorMs ?? params.createdAtMs;
  if (params.lastRunAtMs !== undefined && params.lastRunAtMs >= anchorMs) {
    return params.lastRunAtMs + params.schedule.everyMs;
  }
  if (anchorMs >= params.nowMs) {
    return anchorMs;
  }
  const elapsed = params.nowMs - anchorMs;
  return anchorMs + (Math.floor(elapsed / params.schedule.everyMs) + 1) * params.schedule.everyMs;
}

function findNextCronOccurrenceMs(params: {
  expr: string;
  timezone: string;
  afterMs: number;
  maxMinutes?: number;
}): number | undefined {
  const rounded = floorToMinute(params.afterMs) + 60_000;
  const maxMinutes = params.maxMinutes ?? 366 * 24 * 60;
  for (let offset = 0; offset < maxMinutes; offset += 1) {
    const candidateMs = rounded + offset * 60_000;
    if (cronExpressionMatches(params.expr, new Date(candidateMs), params.timezone)) {
      return candidateMs;
    }
  }
  return undefined;
}

function validateSchedule(schedule: CronSchedule): string | undefined {
  if (schedule.kind === 'at') {
    return parseAtTimestamp(schedule.at) === undefined ? 'Cron at schedule requires a valid timestamp.' : undefined;
  }
  if (schedule.kind === 'every') {
    return schedule.everyMs < 1 ? 'Cron every schedule requires everyMs >= 1.' : undefined;
  }
  const exprError = validateCronExpression(schedule.expr);
  if (exprError) return exprError;
  if (schedule.tz && !isValidCronTimezone(schedule.tz)) {
    return `Cron timezone "${schedule.tz}" is invalid.`;
  }
  return undefined;
}

function describeCronSchedule(schedule: CronSchedule): { schedule: string; timezone?: string } {
  if (schedule.kind === 'cron') {
    return {
      schedule: schedule.expr,
      timezone: schedule.tz ?? 'UTC',
    };
  }

  if (schedule.kind === 'at') {
    return {
      schedule: `at ${schedule.at}`,
    };
  }

  const seconds = schedule.everyMs / 1000;
  if (seconds % 86_400 === 0) {
    return { schedule: `every ${seconds / 86_400} day(s)` };
  }
  if (seconds % 3_600 === 0) {
    return { schedule: `every ${seconds / 3_600} hour(s)` };
  }
  if (seconds % 60 === 0) {
    return { schedule: `every ${seconds / 60} minute(s)` };
  }
  return { schedule: `every ${schedule.everyMs} ms` };
}

function computeNextRunAtMs(params: {
  job: Pick<CronJobRow, 'schedule' | 'createdAt' | 'state' | 'enabled'>;
  nowMs: number;
}): { nextRunAtMs?: number; scheduleError?: string } {
  if (!params.job.enabled) {
    return {};
  }

  const scheduleError = validateSchedule(params.job.schedule);
  if (scheduleError) {
    return { scheduleError };
  }

  const state = readCronJobState(params.job);
  if (params.job.schedule.kind === 'at') {
    const atMs = parseAtTimestamp(params.job.schedule.at);
    if (atMs === undefined) {
      return { scheduleError: 'Cron at schedule requires a valid timestamp.' };
    }
    if (state.lastRunAtMs !== undefined && state.lastRunAtMs >= atMs) {
      return {};
    }
    return { nextRunAtMs: atMs };
  }

  if (params.job.schedule.kind === 'every') {
    return {
      nextRunAtMs: computeEveryNextRunMs({
        schedule: params.job.schedule,
        createdAtMs: params.job.createdAt.getTime(),
        nowMs: params.nowMs,
        lastRunAtMs: state.lastRunAtMs,
      }),
    };
  }

  return {
    nextRunAtMs: findNextCronOccurrenceMs({
      expr: params.job.schedule.expr,
      timezone: params.job.schedule.tz ?? 'UTC',
      afterMs: params.nowMs,
    }),
  };
}

function computeNextRunAfterScheduledTick(params: {
  schedule: CronSchedule;
  createdAtMs: number;
  scheduledAtMs?: number;
  executedAtMs: number;
}): number | undefined {
  if (params.schedule.kind === 'at') {
    return undefined;
  }

  if (params.schedule.kind === 'every') {
    const baseMs = params.scheduledAtMs ?? params.executedAtMs;
    let nextRunAtMs = baseMs + params.schedule.everyMs;
    if (nextRunAtMs <= params.executedAtMs) {
      nextRunAtMs = computeEveryNextRunMs({
        schedule: params.schedule,
        createdAtMs: params.createdAtMs,
        nowMs: params.executedAtMs,
        lastRunAtMs: baseMs,
      });
    }
    return nextRunAtMs;
  }

  return findNextCronOccurrenceMs({
    expr: params.schedule.expr,
    timezone: params.schedule.tz ?? 'UTC',
    afterMs: params.scheduledAtMs ?? params.executedAtMs,
  });
}

function buildAgentSessionKey(params: {
  jobId: string;
  sessionTarget: CronSessionTarget;
  sessionKey?: string | null;
}): string | undefined {
  const explicitSessionKey = normalizeOptionalString(params.sessionKey);
  if (explicitSessionKey) {
    return explicitSessionKey;
  }
  if (params.sessionTarget === 'isolated') {
    return `cron:${params.jobId}`;
  }
  if (params.sessionTarget.startsWith('session:')) {
    return normalizeOptionalString(params.sessionTarget.slice('session:'.length));
  }
  return undefined;
}

function getCronJobTimeoutMs(job: Pick<CronJobRow, 'timeoutSeconds' | 'payload'>): number | undefined {
  const payloadTimeoutSeconds =
    job.payload.kind === 'agentTurn' ? job.payload.timeoutSeconds : undefined;
  const timeoutSeconds =
    typeof payloadTimeoutSeconds === 'number' && payloadTimeoutSeconds > 0
      ? payloadTimeoutSeconds
      : typeof job.timeoutSeconds === 'number' && job.timeoutSeconds > 0
        ? job.timeoutSeconds
        : undefined;
  return timeoutSeconds ? timeoutSeconds * 1000 : undefined;
}

function shouldAwaitAgentTurn(job: Pick<CronJobRow, 'sessionTarget' | 'wakeMode' | 'clearAgent'>): boolean {
  if (job.wakeMode !== 'now') {
    return false;
  }
  if (job.clearAgent) {
    return false;
  }
  return job.sessionTarget === 'isolated' || job.sessionTarget.startsWith('session:');
}

function shouldResetAgentTurnSession(job: Pick<CronJobRow, 'clearAgent'>): boolean {
  return job.clearAgent;
}

function buildCronExecutionSummaryText(params: {
  job: Pick<CronJobRow, 'id' | 'name'>;
  execution: CronExecutionResult;
}): string | undefined {
  const summary = params.execution.summary?.trim();
  if (summary) {
    return `Cron job "${params.job.name}": ${summary}`;
  }
  if (params.execution.status === 'error' && params.execution.error?.trim()) {
    return `Cron job "${params.job.name}" failed: ${params.execution.error.trim()}`;
  }
  if (params.execution.status === 'skipped' && params.execution.error?.trim()) {
    return `Cron job "${params.job.name}" was skipped: ${params.execution.error.trim()}`;
  }
  return undefined;
}

function buildCronWebhookPayload(params: {
  job: Pick<CronJobRow, 'id' | 'name' | 'workspaceId' | 'sessionTarget' | 'wakeMode'>;
  execution: CronExecutionResult;
  sentAt: Date;
}): Record<string, unknown> {
  return {
    type: 'cron.result',
    jobId: params.job.id,
    workspaceId: params.job.workspaceId,
    jobName: params.job.name,
    status: params.execution.status,
    sessionTarget: params.job.sessionTarget,
    wakeMode: params.job.wakeMode,
    ...(params.execution.summary ? { summary: params.execution.summary } : {}),
    ...(params.execution.error ? { error: params.execution.error } : {}),
    sentAt: params.sentAt.toISOString(),
  };
}

async function postCronWebhook(params: {
  url: string;
  payload: unknown;
}): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(params.url);
  } catch {
    throw new Error('Cron webhook delivery requires a valid URL.');
  }

  const response = await fetch(parsed, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(params.payload),
  });

  if (!response.ok) {
    throw new Error(`Cron webhook delivery failed with HTTP ${response.status}.`);
  }
}

async function sendCronAnnouncement(params: {
  client: OpenClawClient;
  job: Pick<CronJobRow, 'id' | 'agentId'>;
  text: string;
  delivery: NonNullable<CronJobRow['delivery']>;
  sessionKey?: string;
  at: Date;
}): Promise<void> {
  const to = normalizeOptionalString(params.delivery.to);
  if (!to) {
    throw new Error('Cron announce delivery requires delivery.to.');
  }

  await params.client.request(
    'send',
    {
      to,
      message: params.text,
      ...(normalizeOptionalString(params.delivery.channel)
        ? { channel: normalizeOptionalString(params.delivery.channel) }
        : {}),
      ...(normalizeOptionalString(params.delivery.accountId)
        ? { accountId: normalizeOptionalString(params.delivery.accountId) }
        : {}),
      ...(params.delivery.threadId !== undefined ? { threadId: params.delivery.threadId } : {}),
      ...(normalizeOptionalString(params.job.agentId) ? { agentId: normalizeOptionalString(params.job.agentId) } : {}),
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      idempotencyKey: `cron:delivery:${params.job.id}:${params.at.getTime()}`,
    },
    {},
  );
}

async function deliverCronExecutionResult(params: {
  client: OpenClawClient;
  job: Pick<
    CronJobRow,
    'id' | 'name' | 'workspaceId' | 'agentId' | 'delivery' | 'sessionTarget' | 'wakeMode'
  >;
  execution: CronExecutionResult;
  sessionKey?: string;
  at: Date;
}): Promise<CronDeliveryAttempt> {
  if (!params.job.delivery || params.job.delivery.mode === 'none' || params.execution.status !== 'ok') {
    return {
      attempted: false,
      delivered: false,
      status: 'not-requested',
    };
  }

  const text = buildCronExecutionSummaryText({
    job: params.job,
    execution: params.execution,
  });

  if (!text) {
    return {
      attempted: false,
      delivered: false,
      status: 'not-requested',
    };
  }

  try {
    if (params.job.delivery.mode === 'announce') {
      await sendCronAnnouncement({
        client: params.client,
        job: params.job,
        text,
        delivery: params.job.delivery,
        sessionKey: params.sessionKey,
        at: params.at,
      });
    } else if (params.job.delivery.mode === 'webhook') {
      const url = normalizeOptionalString(params.job.delivery.to);
      if (!url) {
        throw new Error('Cron webhook delivery requires delivery.to.');
      }
      await postCronWebhook({
        url,
        payload: buildCronWebhookPayload({
          job: params.job,
          execution: params.execution,
          sentAt: params.at,
        }),
      });
    }

    return {
      attempted: true,
      delivered: true,
      status: 'delivered',
    };
  } catch (error) {
    return {
      attempted: true,
      delivered: false,
      status: 'not-delivered',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveFailureAlertTarget(job: Pick<CronJobRow, 'delivery' | 'failureAlert'>): {
  mode?: 'announce' | 'webhook';
  channel?: string;
  to?: string;
  accountId?: string;
  after: number;
  cooldownMs: number;
} | null {
  if (job.failureAlert === false) {
    return null;
  }

  const deliveryFailureTarget = job.delivery?.failureDestination;
  const baseFailureAlert = job.failureAlert === null || job.failureAlert === undefined ? null : job.failureAlert;

  const inheritedPrimaryTarget: {
    mode: 'announce' | 'webhook';
    channel?: string;
    to?: string;
    accountId?: string;
  } | null =
    job.delivery && job.delivery.mode !== 'none'
      ? {
          mode: job.delivery.mode === 'webhook' ? 'webhook' : 'announce',
          channel: normalizeOptionalString(job.delivery.channel),
          to: normalizeOptionalString(job.delivery.to),
          accountId: normalizeOptionalString(job.delivery.accountId),
        }
      : null;

  const mode: 'announce' | 'webhook' =
    deliveryFailureTarget?.mode ??
    baseFailureAlert?.mode ??
    inheritedPrimaryTarget?.mode ??
    'announce';
  const channel =
    normalizeOptionalString(deliveryFailureTarget?.channel) ??
    normalizeOptionalString(baseFailureAlert?.channel) ??
    inheritedPrimaryTarget?.channel;
  const to =
    normalizeOptionalString(deliveryFailureTarget?.to) ??
    normalizeOptionalString(baseFailureAlert?.to) ??
    inheritedPrimaryTarget?.to;
  const accountId =
    normalizeOptionalString(deliveryFailureTarget?.accountId) ??
    normalizeOptionalString(baseFailureAlert?.accountId) ??
    inheritedPrimaryTarget?.accountId;

  return {
    mode,
    channel,
    to,
    accountId,
    after: Math.max(1, baseFailureAlert?.after ?? 1),
    cooldownMs: Math.max(0, baseFailureAlert?.cooldownMs ?? 0),
  };
}

function buildCronFailureAlertText(params: {
  job: Pick<CronJobRow, 'name'>;
  execution: CronExecutionResult;
  consecutiveErrors: number;
}): string {
  const detail = params.execution.error?.trim() || params.execution.summary?.trim() || 'No details.';
  return `Cron job "${params.job.name}" failed ${params.consecutiveErrors} time(s): ${detail}`;
}

async function maybeSendCronFailureAlert(params: {
  client: OpenClawClient;
  job: Pick<CronJobRow, 'id' | 'name' | 'agentId' | 'delivery' | 'failureAlert'>;
  execution: CronExecutionResult;
  consecutiveErrors: number;
  currentState: CronJobState;
  at: Date;
  sessionKey?: string;
  logger?: BridgeLogger;
}): Promise<CronFailureAlertAttempt> {
  if (params.execution.status === 'ok') {
    return { attempted: false, sent: false };
  }

  const target = resolveFailureAlertTarget(params.job);
  if (!target) {
    return { attempted: false, sent: false };
  }
  if (params.consecutiveErrors < target.after) {
    return { attempted: false, sent: false };
  }
  if (
    target.cooldownMs > 0 &&
    typeof params.currentState.lastFailureAlertAtMs === 'number' &&
    params.currentState.lastFailureAlertAtMs + target.cooldownMs > params.at.getTime()
  ) {
    return { attempted: false, sent: false };
  }

  const text = buildCronFailureAlertText({
    job: params.job,
    execution: params.execution,
    consecutiveErrors: params.consecutiveErrors,
  });

  try {
    if (target.mode === 'webhook') {
      if (!target.to) {
        throw new Error('Cron failure alert webhook requires a destination URL.');
      }
      await postCronWebhook({
        url: target.to,
        payload: {
          type: 'cron.failure-alert',
          jobId: params.job.id,
          jobName: params.job.name,
          status: params.execution.status,
          consecutiveErrors: params.consecutiveErrors,
          ...(params.execution.summary ? { summary: params.execution.summary } : {}),
          ...(params.execution.error ? { error: params.execution.error } : {}),
          sentAt: params.at.toISOString(),
        },
      });
    } else {
      await sendCronAnnouncement({
        client: params.client,
        job: params.job,
        text,
        delivery: {
          mode: 'announce',
          ...(target.channel ? { channel: target.channel } : {}),
          ...(target.to ? { to: target.to } : {}),
          ...(target.accountId ? { accountId: target.accountId } : {}),
        },
        sessionKey: params.sessionKey,
        at: params.at,
      });
    }

    return {
      attempted: true,
      sent: true,
      atMs: params.at.getTime(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.logger?.warn?.('[cron-job-service] failure alert delivery failed', {
      jobId: params.job.id,
      error: message,
    });
    return {
      attempted: true,
      sent: false,
      error: message,
    };
  }
}

async function executeCronJob(params: {
  db: Db;
  job: CronJobRow;
  now: Date;
  client?: OpenClawClient;
  logger?: BridgeLogger;
}): Promise<CronExecutionResult> {
  const client = params.client ?? getOpenClawClient({ eagerConnect: false });
  const payload = params.job.payload;

  if (payload.kind === 'flowTrigger') {
    if (!isFlowManagedCronJob(params.job) || !params.job.sourceFlowId) {
      return {
        status: 'error',
        error: 'Flow-backed cron job is missing its published flow source metadata.',
      };
    }

    const scheduleMetadata = describeCronSchedule(params.job.schedule);
    const run = await startPublishedFlowRun(params.db, {
      flowId: params.job.sourceFlowId,
      workspaceId: params.job.workspaceId,
      trigger: {
        type: 'cron',
        label: params.job.name,
        schedule: scheduleMetadata.schedule,
        ...(scheduleMetadata.timezone ? { timezone: scheduleMetadata.timezone } : {}),
        sourceId: `cron-job:${params.job.id}:${params.now.getTime()}`,
      },
      input: {
        scheduledAt: params.now.toISOString(),
        schedule: scheduleMetadata.schedule,
        scheduleKind: params.job.schedule.kind,
        ...(scheduleMetadata.timezone ? { timezone: scheduleMetadata.timezone } : {}),
        source: 'cron-job-service',
        cronJobId: params.job.id,
        sourceFlowId: params.job.sourceFlowId,
        sourceNodeId: params.job.sourceNodeId,
      },
    });

    executeRunInBackground(params.db, run.id, {
      error: (...args: unknown[]) => {
        params.logger?.error?.(...args);
      },
    });

    return {
      status: 'ok',
      summary: `Queued published flow run for "${params.job.name}".`,
    };
  }

  if (payload.kind === 'systemEvent') {
    const text = payload.text.trim();
    if (!text) {
      return {
        status: 'skipped',
        error: 'System-event cron job has no text to send.',
      };
    }

    await client.request(
      'cron.wake',
      {
        mode: params.job.wakeMode,
        text,
      },
      {},
    );

    return {
      status: 'ok',
      summary: `Queued system event for ${params.job.wakeMode}.`,
    };
  }

  const message = payload.message.trim();
  if (!message) {
    return {
      status: 'skipped',
      error: 'Agent-turn cron job has no message to send.',
    };
  }

  const sessionKey = buildAgentSessionKey({
    jobId: params.job.id,
    sessionTarget: params.job.sessionTarget,
    sessionKey: params.job.sessionKey,
  });

  if (!sessionKey) {
    return {
      status: 'skipped',
      error: `Cron job "${params.job.name}" needs a session key for session target "${params.job.sessionTarget}".`,
    };
  }

  const timeoutMs = getCronJobTimeoutMs(params.job);
  const idempotencyKey = `cron:${params.job.id}:${params.now.getTime()}`;

  if (shouldAwaitAgentTurn(params.job)) {
    const result = await runOpenClawAgent(
      {
        agentId: params.job.agentId?.trim() || 'main',
        sessionKey,
        message,
        model: payload.model,
        thinking: payload.thinking,
        fallbacks: payload.fallbacks,
        lightContext: payload.lightContext,
        allowUnsafeExternalContent: payload.allowUnsafeExternalContent,
        toolsAllow: payload.toolsAllow,
        idempotencyKey,
        timeoutMs,
      },
      client,
    );

    return {
      status: 'ok',
      summary: result.replyText?.trim() || `Agent run completed in session "${result.sessionKey}".`,
    };
  }

  if (shouldResetAgentTurnSession(params.job)) {
    await client.request(
      'sessions.reset',
      {
        key: sessionKey,
        reason: 'reset',
      },
      {},
    );
  }

  await client.request(
    'sessions.create',
    {
      key: sessionKey,
      ...(params.job.clearAgent
        ? {}
        : params.job.agentId?.trim()
          ? { agentId: params.job.agentId.trim() }
          : {}),
      ...(payload.model ? { model: payload.model } : {}),
    },
    {},
  );

  await client.request(
    'sessions.send',
    {
      key: sessionKey,
      message,
      ...(payload.thinking ? { thinking: payload.thinking } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      idempotencyKey,
    },
    {},
  );

  return {
    status: 'ok',
    summary:
      params.job.wakeMode === 'next-heartbeat'
        ? `Queued session message for "${sessionKey}" for the next session turn.`
        : `Queued session message for "${sessionKey}".`,
  };
}

async function persistCronJobState(params: {
  db: Db;
  jobId: string;
  state: CronJobState;
  enabled?: boolean;
  logger?: BridgeLogger;
}) {
  await params.db
    .update(cronJobs)
    .set({
      state: params.state,
      ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(cronJobs.id, params.jobId));
  params.logger?.info?.('[cron-job-service] updated cron job state', {
    jobId: params.jobId,
    ...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
  });
}

async function recordCronJobRun(params: {
  db: Db;
  job: Pick<CronJobRow, 'id' | 'workspaceId' | 'name'>;
  triggerMode: 'force' | 'due';
  execution: CronExecutionResult;
  deliveryStatus: CronDeliveryStatus;
  deliveryError?: string;
  delivered?: boolean;
  sessionKey?: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
}) {
  await params.db.insert(cronJobRuns).values({
    workspaceId: params.job.workspaceId,
    cronJobId: params.job.id,
    jobName: params.job.name,
    triggerMode: params.triggerMode,
    status: params.execution.status,
    ...(params.execution.summary ? { summary: params.execution.summary } : {}),
    ...(params.execution.error ? { error: params.execution.error } : {}),
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    deliveryStatus: params.deliveryStatus,
    ...(params.deliveryError ? { deliveryError: params.deliveryError } : {}),
    ...(params.delivered !== undefined ? { delivered: params.delivered } : {}),
    startedAt: params.startedAt,
    ...(params.finishedAt ? { finishedAt: params.finishedAt } : {}),
    ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
  });
}

export function normalizeCronJobState(params: {
  job: Pick<CronJobRow, 'schedule' | 'createdAt' | 'enabled'> & { state?: CronJobState };
  now?: Date;
}): CronJobState {
  const nowMs = (params.now ?? new Date()).getTime();
  const current = params.job.state ?? {};
  const resolved = computeNextRunAtMs({
    job: {
      ...params.job,
      state: current,
    },
    nowMs,
  });

  if (resolved.scheduleError) {
    return mergeCronJobState(current, {
      nextRunAtMs: undefined,
      runningAtMs: undefined,
      scheduleErrorCount: (current.scheduleErrorCount ?? 0) + 1,
      lastError: resolved.scheduleError,
    });
  }

  return mergeCronJobState(current, {
    nextRunAtMs: resolved.nextRunAtMs,
    ...(current.runningAtMs !== undefined ? { runningAtMs: current.runningAtMs } : {}),
  });
}

export async function getCronSchedulerStatus(
  db: Db,
  at: Date = new Date(),
  workspaceId?: string,
): Promise<CronSchedulerStatus> {
  const rows = workspaceId
    ? await db.select().from(cronJobs).where(eq(cronJobs.workspaceId, workspaceId))
    : await db.select().from(cronJobs);
  const nowMs = at.getTime();

  let enabledJobs = 0;
  let runningJobs = 0;
  let dueJobs = 0;
  let nextWakeAtMs: number | undefined;

  for (const row of rows) {
    if (!row.enabled) continue;
    enabledJobs += 1;
    const state = normalizeCronJobState({ job: row, now: at });
    if (state.runningAtMs !== undefined) {
      runningJobs += 1;
    }
    if (state.nextRunAtMs !== undefined) {
      if (state.nextRunAtMs <= nowMs) {
        dueJobs += 1;
      }
      if (nextWakeAtMs === undefined || state.nextRunAtMs < nextWakeAtMs) {
        nextWakeAtMs = state.nextRunAtMs;
      }
    }
  }

  return {
    enabledJobs,
    totalJobs: rows.length,
    runningJobs,
    dueJobs,
    ...(nextWakeAtMs !== undefined ? { nextWakeAt: new Date(nextWakeAtMs).toISOString() } : {}),
  };
}

export async function runCronJob(params: {
  db: Db;
  jobId: string;
  workspaceId?: string;
  mode?: 'force' | 'due';
  at?: Date;
  client?: OpenClawClient;
  logger?: BridgeLogger;
  execute?: CronExecutor;
}): Promise<CronJobRunResult> {
  const mode = params.mode ?? 'force';
  const at = params.at ?? new Date();
  const nowMs = at.getTime();
  const logger = params.logger ?? console;
  const execute = params.execute ?? executeCronJob;

  const job = await params.db.query.cronJobs.findFirst({
    where: (table, operators) =>
      params.workspaceId
        ? operators.and(
            operators.eq(table.id, params.jobId),
            operators.eq(table.workspaceId, params.workspaceId),
          )
        : operators.eq(table.id, params.jobId),
  });

  if (!job) {
    throw new Error('cron job not found');
  }

  if (!job.enabled) {
    return {
      jobId: job.id,
      triggered: false,
      status: 'skipped',
      error: 'Cron job is disabled.',
      ...(readCronJobState(job).nextRunAtMs !== undefined
        ? { nextRunAt: new Date(readCronJobState(job).nextRunAtMs as number).toISOString() }
        : {}),
    };
  }

  const normalizedState = normalizeCronJobState({ job, now: at });
  const dueAtMs = normalizedState.nextRunAtMs;
  if (mode === 'due' && (dueAtMs === undefined || dueAtMs > nowMs)) {
    return {
      jobId: job.id,
      triggered: false,
      status: 'skipped',
      error: 'Cron job is not due yet.',
      ...(dueAtMs !== undefined ? { nextRunAt: new Date(dueAtMs).toISOString() } : {}),
    };
  }

  if (normalizedState.runningAtMs !== undefined) {
    return {
      jobId: job.id,
      triggered: false,
      status: 'skipped',
      error: 'Cron job is already running.',
      ...(dueAtMs !== undefined ? { nextRunAt: new Date(dueAtMs).toISOString() } : {}),
    };
  }

  const startedState = mergeCronJobState(normalizedState, {
    runningAtMs: nowMs,
    ...(dueAtMs !== undefined ? { nextRunAtMs: dueAtMs } : {}),
  });
  await persistCronJobState({
    db: params.db,
    jobId: job.id,
    state: startedState,
  });

  const startedAtMs = Date.now();
  const sessionKey =
    job.payload.kind === 'agentTurn'
      ? buildAgentSessionKey({
          jobId: job.id,
          sessionTarget: job.sessionTarget,
          sessionKey: job.sessionKey,
        })
      : undefined;
  try {
    const execution = await execute({
      db: params.db,
      job,
      now: at,
      client: params.client,
      logger,
    });
    const client = params.client ?? getOpenClawClient({ eagerConnect: false });
    const deliveryAttempt = await deliverCronExecutionResult({
      client,
      job,
      execution,
      sessionKey,
      at,
    });
    const bestEffortDelivery = job.delivery?.bestEffort === true;
    const finalExecution =
      execution.status === 'ok' &&
      deliveryAttempt.attempted &&
      !deliveryAttempt.delivered &&
      !bestEffortDelivery
        ? {
            status: 'error' as const,
            summary: execution.summary,
            error: deliveryAttempt.error ?? 'Cron result delivery failed.',
          }
        : execution;
    const finalConsecutiveErrors =
      finalExecution.status === 'ok' ? 0 : (startedState.consecutiveErrors ?? 0) + 1;
    const failureAlertAttempt = await maybeSendCronFailureAlert({
      client,
      job,
      execution: finalExecution,
      consecutiveErrors: finalConsecutiveErrors,
      currentState: startedState,
      at,
      sessionKey,
      logger,
    });
    const endedAtMs = Date.now();
    const finishedAt = new Date(endedAtMs);
    const durationMs = Math.max(0, endedAtMs - startedAtMs);
    const nextRunAtMs =
      mode === 'force' && dueAtMs !== undefined && dueAtMs > nowMs
        ? dueAtMs
        : computeNextRunAfterScheduledTick({
            schedule: job.schedule,
            createdAtMs: job.createdAt.getTime(),
            scheduledAtMs: dueAtMs,
            executedAtMs: nowMs,
          });

    const nextState = mergeCronJobState(startedState, {
      runningAtMs: undefined,
      nextRunAtMs,
      lastRunAtMs: nowMs,
      lastRunStatus: finalExecution.status,
      lastError:
        finalExecution.status === 'error' || finalExecution.status === 'skipped'
          ? finalExecution.error
          : undefined,
      lastDurationMs: durationMs,
      consecutiveErrors: finalConsecutiveErrors,
      lastDeliveryStatus: deliveryAttempt.status,
      lastDeliveryError: deliveryAttempt.error,
      lastDelivered: deliveryAttempt.delivered,
      ...(failureAlertAttempt.sent && failureAlertAttempt.atMs !== undefined
        ? { lastFailureAlertAtMs: failureAlertAttempt.atMs }
        : {}),
    });

    const disableAfterRun =
      finalExecution.status === 'ok' && (job.deleteAfterRun || job.schedule.kind === 'at');
    await persistCronJobState({
      db: params.db,
      jobId: job.id,
      state: nextState,
      ...(disableAfterRun ? { enabled: false } : {}),
    });
    await recordCronJobRun({
      db: params.db,
      job,
      triggerMode: mode,
      execution: finalExecution,
      deliveryStatus: deliveryAttempt.status,
      deliveryError: deliveryAttempt.error,
      delivered: deliveryAttempt.delivered,
      sessionKey,
      startedAt: new Date(startedAtMs),
      finishedAt,
      durationMs,
    });

    return {
      jobId: job.id,
      triggered: true,
      status: finalExecution.status,
      ...(finalExecution.summary ? { summary: finalExecution.summary } : {}),
      ...(finalExecution.error ? { error: finalExecution.error } : {}),
      ...(nextRunAtMs !== undefined ? { nextRunAt: new Date(nextRunAtMs).toISOString() } : {}),
    };
  } catch (error) {
    const endedAtMs = Date.now();
    const finishedAt = new Date(endedAtMs);
    const durationMs = Math.max(0, endedAtMs - startedAtMs);
    const message = error instanceof Error ? error.message : String(error);
    logger.warn?.('[cron-job-service] cron execution failed', {
      jobId: job.id,
      error: message,
    });
    const client = params.client ?? getOpenClawClient({ eagerConnect: false });

    const nextRunAtMs =
      mode === 'force' && dueAtMs !== undefined && dueAtMs > nowMs
        ? dueAtMs
        : computeNextRunAfterScheduledTick({
            schedule: job.schedule,
            createdAtMs: job.createdAt.getTime(),
            scheduledAtMs: dueAtMs,
            executedAtMs: nowMs,
          });
    const consecutiveErrors = (startedState.consecutiveErrors ?? 0) + 1;
    const failedExecution: CronExecutionResult = {
      status: 'error',
      error: message,
    };
    const failureAlertAttempt = await maybeSendCronFailureAlert({
      client,
      job,
      execution: failedExecution,
      consecutiveErrors,
      currentState: startedState,
      at,
      sessionKey,
      logger,
    });

    const failedState = mergeCronJobState(startedState, {
      runningAtMs: undefined,
      nextRunAtMs,
      lastRunAtMs: nowMs,
      lastRunStatus: 'error',
      lastError: message,
      lastDurationMs: durationMs,
      consecutiveErrors,
      lastDeliveryStatus: 'not-requested',
      lastDeliveryError: undefined,
      lastDelivered: false,
      ...(failureAlertAttempt.sent && failureAlertAttempt.atMs !== undefined
        ? { lastFailureAlertAtMs: failureAlertAttempt.atMs }
        : {}),
    });
    await persistCronJobState({
      db: params.db,
      jobId: job.id,
      state: failedState,
    });
    await recordCronJobRun({
      db: params.db,
      job,
      triggerMode: mode,
      execution: failedExecution,
      deliveryStatus: 'not-requested',
      delivered: false,
      sessionKey,
      startedAt: new Date(startedAtMs),
      finishedAt,
      durationMs,
    });

    return {
      jobId: job.id,
      triggered: true,
      status: 'error',
      error: message,
      ...(nextRunAtMs !== undefined ? { nextRunAt: new Date(nextRunAtMs).toISOString() } : {}),
    };
  }
}

export async function processCronJobs(params: {
  db: Db;
  at?: Date;
  logger?: BridgeLogger;
  client?: OpenClawClient;
  execute?: CronExecutor;
}): Promise<number> {
  const at = params.at ?? new Date();
  const nowMs = at.getTime();
  const logger = params.logger ?? console;

  const rows = await params.db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.enabled, true));

  let triggered = 0;

  for (const row of rows) {
    const normalizedState = normalizeCronJobState({ job: row, now: at });
    const stateChanged =
      normalizedState.nextRunAtMs !== readCronJobState(row).nextRunAtMs ||
      normalizedState.lastError !== readCronJobState(row).lastError ||
      normalizedState.scheduleErrorCount !== readCronJobState(row).scheduleErrorCount;

    if (stateChanged) {
      await persistCronJobState({
        db: params.db,
        jobId: row.id,
        state: normalizedState,
      });
    }

    if (normalizedState.runningAtMs !== undefined) {
      continue;
    }
    if (normalizedState.nextRunAtMs === undefined || normalizedState.nextRunAtMs > nowMs) {
      continue;
    }

    const result = await runCronJob({
      db: params.db,
      jobId: row.id,
      at,
      mode: 'due',
      client: params.client,
      logger,
      execute: params.execute,
    });
    if (result.triggered) {
      triggered += 1;
    }
  }

  return triggered;
}

export function startCronJobService(params: {
  db: Db;
  intervalMs?: number;
  logger?: BridgeLogger;
  now?: () => Date;
  client?: OpenClawClient;
  execute?: CronExecutor;
}): () => void {
  const logger = params.logger ?? console;
  const intervalMs = params.intervalMs ?? 15_000;
  const now = params.now ?? (() => new Date());
  let closed = false;

  const tick = () => {
    if (closed) return;
    void processCronJobs({
      db: params.db,
      at: now(),
      logger,
      client: params.client,
      execute: params.execute,
    }).catch((error) => {
      logger.error?.('[cron-job-service] cron tick failed', error);
    });
  };

  tick();
  const handle = setInterval(tick, intervalMs);

  return () => {
    closed = true;
    clearInterval(handle);
  };
}
