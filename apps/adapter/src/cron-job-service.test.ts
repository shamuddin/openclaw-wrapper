import { afterEach, describe, expect, it, vi } from 'vitest';
import { cronJobRuns, cronJobs } from './db/schema.js';
import {
  normalizeCronJobState,
  processCronJobs,
  runCronJob,
  startCronJobService,
} from './cron-job-service.js';

type TestCronJob = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  agentId: string | null;
  sessionKey: string | null;
  clearAgent: boolean;
  enabled: boolean;
  deleteAfterRun: boolean;
  schedule:
    | { kind: 'every'; everyMs: number }
    | { kind: 'cron'; expr: string; tz?: string }
    | { kind: 'at'; at: string };
  sessionTarget: string;
  wakeMode: string;
  payload:
    | {
        kind: 'agentTurn';
        message: string;
        model?: string;
        thinking?: string;
        fallbacks?: string[];
        timeoutSeconds?: number;
        allowUnsafeExternalContent?: boolean;
        lightContext?: boolean;
        toolsAllow?: string[];
      }
    | { kind: 'systemEvent'; text: string };
  delivery:
    | null
    | {
        mode: 'none' | 'announce' | 'webhook';
        channel?: string;
        to?: string;
        threadId?: string | number;
        accountId?: string;
        bestEffort?: boolean;
        failureDestination?: {
          channel?: string;
          to?: string;
          accountId?: string;
          mode?: 'announce' | 'webhook';
        };
      };
  failureAlert:
    | null
    | false
    | {
        after?: number;
        channel?: string;
        to?: string;
        cooldownMs?: number;
        mode?: 'announce' | 'webhook';
        accountId?: string;
      };
  timeoutSeconds: number | null;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

function createCronJob(overrides: Partial<TestCronJob> = {}): TestCronJob {
  return {
    id: 'cron_job_1',
    workspaceId: 'workspace_1',
    name: 'Morning brief',
    description: null,
    agentId: 'main',
    sessionKey: null,
    clearAgent: false,
    enabled: true,
    deleteAfterRun: false,
    schedule: { kind: 'every', everyMs: 30 * 60 * 1000 },
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: 'Summarize overnight updates.' },
    delivery: null,
    failureAlert: null,
    timeoutSeconds: null,
    state: {},
    createdAt: new Date('2026-04-26T12:00:00.000Z'),
    updatedAt: new Date('2026-04-26T12:00:00.000Z'),
    ...overrides,
  };
}

function createDb(job: TestCronJob) {
  let currentJob = structuredClone(job) as typeof job;
  const runRows: Array<Record<string, unknown>> = [];

  return {
    getJob: () => currentJob,
    getRuns: () => runRows,
    db: {
      query: {
        cronJobs: {
          findFirst: vi.fn(async () => currentJob),
        },
      },
      update: vi.fn((table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: vi.fn(async () => {
            if (table === cronJobs) {
              currentJob = {
                ...currentJob,
                ...(values as Partial<TestCronJob>),
              };
              return;
            }
            if (table === cronJobRuns && runRows.length > 0) {
              Object.assign(runRows[runRows.length - 1]!, values);
            }
          }),
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn(async (values: Record<string, unknown>) => {
          if (table === cronJobRuns) {
            runRows.push(values);
          }
          return [];
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [currentJob]),
        })),
      })),
    } as any,
  };
}

describe('cron-job-service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('computes the next run for every schedules', () => {
    const state = normalizeCronJobState({
      job: createCronJob(),
      now: new Date('2026-04-26T12:05:00.000Z'),
    });

    expect(state.nextRunAtMs).toBe(Date.parse('2026-04-26T12:30:00.000Z'));
  });

  it('records schedule errors for invalid cron timezones', () => {
    const state = normalizeCronJobState({
      job: createCronJob({
        schedule: { kind: 'cron', expr: '0 7 * * *', tz: 'Mars/Phobos' },
      }),
      now: new Date('2026-04-26T12:05:00.000Z'),
    });

    expect(state.nextRunAtMs).toBeUndefined();
    expect(state.scheduleErrorCount).toBe(1);
    expect(state.lastError).toContain('Mars/Phobos');
  });

  it('runs due jobs and updates persisted state', async () => {
    const dueJob = createCronJob({
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      execute: vi.fn().mockResolvedValue({
        status: 'ok',
        summary: 'Ran successfully.',
      }),
    });

    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'ok',
      summary: 'Ran successfully.',
    });
    expect(store.getJob().state.lastRunStatus).toBe('ok');
    expect(store.getJob().state.runningAtMs).toBeUndefined();
    expect(store.getJob().state.nextRunAtMs).toBe(Date.parse('2026-04-26T12:30:00.000Z'));
    expect(store.getRuns()).toHaveLength(1);
    expect(store.getRuns()[0]).toMatchObject({
      cronJobId: dueJob.id,
      jobName: dueJob.name,
      triggerMode: 'due',
      status: 'ok',
      summary: 'Ran successfully.',
      deliveryStatus: 'not-requested',
      delivered: false,
    });
  });

  it('processes due jobs from the scheduler loop', async () => {
    const dueJob = createCronJob({
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);

    const count = await processCronJobs({
      db: store.db,
      at: new Date('2026-04-26T12:00:00.000Z'),
      execute: vi.fn().mockResolvedValue({
        status: 'ok',
        summary: 'processed',
      }),
    });

    expect(count).toBe(1);
    expect(store.getJob().state.lastRunStatus).toBe('ok');
  });

  it('routes named session targets through sessions.create and sessions.send', async () => {
    const dueJob = createCronJob({
      sessionTarget: 'session:ops-room',
      sessionKey: null,
      wakeMode: 'next-heartbeat',
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, key: 'ops-room' })
      .mockResolvedValueOnce({ runId: 'session_run_1', status: 'queued' });

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      'sessions.create',
      {
        key: 'ops-room',
        agentId: 'main',
      },
      {},
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'sessions.send',
      {
        key: 'ops-room',
        message: 'Summarize overnight updates.',
        idempotencyKey: 'cron:cron_job_1:1777204800000',
      },
      {},
    );
    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'ok',
      summary: 'Queued session message for "ops-room" for the next session turn.',
    });
  });

  it('runs named session targets immediately when wake mode is now', async () => {
    const dueJob = createCronJob({
      sessionTarget: 'session:ops-room',
      sessionKey: null,
      wakeMode: 'now',
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'accepted',
        runId: 'gw_run_789',
      })
      .mockResolvedValueOnce({
        runId: 'gw_run_789',
        status: 'ok',
        startedAt: 1_777_204_800_000,
        endedAt: 1_777_204_820_000,
      })
      .mockResolvedValueOnce({
        previews: [
          {
            key: 'ops-room',
            status: 'ok',
            items: [{ role: 'assistant', text: 'Named session complete.' }],
          },
        ],
      });

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      'agent',
      {
        agentId: 'main',
        sessionKey: 'ops-room',
        message: 'Summarize overnight updates.',
        deliver: false,
        idempotencyKey: 'cron:cron_job_1:1777204800000',
      },
      { signal: undefined },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'agent.wait',
      {
        runId: 'gw_run_789',
        timeoutMs: undefined,
      },
      { signal: undefined },
    );
    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'ok',
      summary: 'Named session complete.',
    });
  });

  it('keeps clear-agent session jobs queued even when wake mode is now', async () => {
    const dueJob = createCronJob({
      sessionTarget: 'session:ops-room',
      sessionKey: null,
      clearAgent: true,
      wakeMode: 'now',
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, key: 'ops-room' })
      .mockResolvedValueOnce({ ok: true, key: 'ops-room' })
      .mockResolvedValueOnce({ runId: 'session_run_2', status: 'queued' });

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      'sessions.reset',
      {
        key: 'ops-room',
        reason: 'reset',
      },
      {},
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'sessions.create',
      {
        key: 'ops-room',
      },
      {},
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      'sessions.send',
      {
        key: 'ops-room',
        message: 'Summarize overnight updates.',
        idempotencyKey: 'cron:cron_job_1:1777204800000',
      },
      {},
    );
    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'ok',
      summary: 'Queued session message for "ops-room".',
    });
  });

  it('resets isolated cron sessions before queued clear-agent sends', async () => {
    const dueJob = createCronJob({
      sessionTarget: 'isolated',
      sessionKey: null,
      clearAgent: true,
      wakeMode: 'now',
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, key: 'cron:cron_job_1' })
      .mockResolvedValueOnce({ ok: true, key: 'cron:cron_job_1' })
      .mockResolvedValueOnce({ runId: 'session_run_3', status: 'queued' });

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      'sessions.reset',
      {
        key: 'cron:cron_job_1',
        reason: 'reset',
      },
      {},
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'sessions.create',
      {
        key: 'cron:cron_job_1',
      },
      {},
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      'sessions.send',
      {
        key: 'cron:cron_job_1',
        message: 'Summarize overnight updates.',
        idempotencyKey: 'cron:cron_job_1:1777204800000',
      },
      {},
    );
    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'ok',
      summary: 'Queued session message for "cron:cron_job_1".',
    });
  });

  it('forwards agent-turn payload overrides for isolated jobs', async () => {
    const dueJob = createCronJob({
      payload: {
        kind: 'agentTurn',
        message: 'Summarize overnight updates.',
        model: 'openai/gpt-5.2',
        thinking: 'low',
        fallbacks: ['openai/gpt-5.4-mini'],
        timeoutSeconds: 45,
        allowUnsafeExternalContent: true,
        lightContext: true,
        toolsAllow: ['read', 'browser'],
      },
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'accepted',
        runId: 'gw_run_123',
      })
      .mockResolvedValueOnce({
        runId: 'gw_run_123',
        status: 'ok',
        startedAt: 1_777_204_800_000,
        endedAt: 1_777_204_845_000,
      })
      .mockResolvedValueOnce({
        previews: [
          {
            key: 'cron:cron_job_1',
            status: 'ok',
            items: [{ role: 'assistant', text: 'All set.' }],
          },
        ],
      });

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      'agent',
      {
        agentId: 'main',
        sessionKey: 'cron:cron_job_1',
        message: 'Summarize overnight updates.',
        deliver: false,
        idempotencyKey: 'cron:cron_job_1:1777204800000',
        model: 'openai/gpt-5.2',
        thinking: 'low',
        fallbacks: ['openai/gpt-5.4-mini'],
        lightContext: true,
        allowUnsafeExternalContent: true,
        toolsAllow: ['read', 'browser'],
      },
      { signal: undefined },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'agent.wait',
      {
        runId: 'gw_run_123',
        timeoutMs: 45_000,
      },
      { signal: undefined },
    );
    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'ok',
      summary: 'All set.',
    });
  });

  it('delivers cron summaries through announce delivery and records delivery state', async () => {
    const dueJob = createCronJob({
      delivery: {
        mode: 'announce',
        channel: 'telegram',
        to: '+15551234567',
      },
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi.fn().mockResolvedValueOnce({
      runId: 'send_run_1',
      messageId: 'msg_1',
      channel: 'telegram',
    });

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
      execute: vi.fn().mockResolvedValue({
        status: 'ok',
        summary: 'Done and ready.',
      }),
    });

    expect(request).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        to: '+15551234567',
        message: 'Cron job "Morning brief": Done and ready.',
        channel: 'telegram',
      }),
      {},
    );
    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'ok',
      summary: 'Done and ready.',
    });
    expect(store.getJob().state.lastDeliveryStatus).toBe('delivered');
    expect(store.getJob().state.lastDelivered).toBe(true);
    expect(store.getJob().state.lastDeliveryError).toBeUndefined();
  });

  it('fails the cron run when delivery fails and bestEffort is not enabled', async () => {
    const dueJob = createCronJob({
      delivery: {
        mode: 'announce',
        to: '+15551234567',
      },
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi.fn().mockRejectedValueOnce(new Error('telegram unavailable'));

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
      execute: vi.fn().mockResolvedValue({
        status: 'ok',
        summary: 'Done and ready.',
      }),
    });

    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'error',
      error: 'telegram unavailable',
    });
    expect(store.getJob().state.lastRunStatus).toBe('error');
    expect(store.getJob().state.lastDeliveryStatus).toBe('not-delivered');
    expect(store.getJob().state.lastDelivered).toBe(false);
    expect(store.getJob().state.lastDeliveryError).toBe('telegram unavailable');
  });

  it('keeps cron runs successful when delivery fails with bestEffort enabled', async () => {
    const dueJob = createCronJob({
      delivery: {
        mode: 'announce',
        to: '+15551234567',
        bestEffort: true,
      },
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi.fn().mockRejectedValueOnce(new Error('telegram unavailable'));

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
      execute: vi.fn().mockResolvedValue({
        status: 'ok',
        summary: 'Done and ready.',
      }),
    });

    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'ok',
      summary: 'Done and ready.',
    });
    expect(store.getJob().state.lastRunStatus).toBe('ok');
    expect(store.getJob().state.lastDeliveryStatus).toBe('not-delivered');
    expect(store.getJob().state.lastDelivered).toBe(false);
  });

  it('posts webhook delivery payloads for successful runs', async () => {
    const dueJob = createCronJob({
      delivery: {
        mode: 'webhook',
        to: 'https://example.com/hooks/cron',
      },
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      execute: vi.fn().mockResolvedValue({
        status: 'ok',
        summary: 'Webhook summary.',
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(store.getJob().state.lastDeliveryStatus).toBe('delivered');
  });

  it('sends repeated failure alerts when the threshold is reached', async () => {
    const dueJob = createCronJob({
      failureAlert: {
        after: 2,
        mode: 'announce',
        to: '+15557654321',
      },
      state: {
        consecutiveErrors: 1,
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi.fn().mockResolvedValueOnce({
      runId: 'alert_run_1',
      messageId: 'alert_msg_1',
      channel: 'default',
    });

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
      execute: vi.fn().mockResolvedValue({
        status: 'error',
        error: 'Gateway unavailable.',
      }),
    });

    expect(request).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        to: '+15557654321',
        message: 'Cron job "Morning brief" failed 2 time(s): Gateway unavailable.',
      }),
      {},
    );
    expect(result.status).toBe('error');
    expect(store.getJob().state.consecutiveErrors).toBe(2);
    expect(store.getJob().state.lastFailureAlertAtMs).toBe(
      Date.parse('2026-04-26T12:00:00.000Z'),
    );
  });

  it('sends failure alerts for thrown execution errors and records delivery as not requested', async () => {
    const dueJob = createCronJob({
      failureAlert: {
        after: 1,
        mode: 'announce',
        to: '+15557654321',
      },
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);
    const request = vi.fn().mockResolvedValueOnce({
      runId: 'alert_run_2',
      messageId: 'alert_msg_2',
      channel: 'default',
    });

    const result = await runCronJob({
      db: store.db,
      jobId: dueJob.id,
      mode: 'due',
      at: new Date('2026-04-26T12:00:00.000Z'),
      client: { request } as never,
      execute: vi.fn().mockRejectedValue(new Error('Worker crashed.')),
    });

    expect(request).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        to: '+15557654321',
        message: 'Cron job "Morning brief" failed 1 time(s): Worker crashed.',
      }),
      {},
    );
    expect(result).toMatchObject({
      jobId: dueJob.id,
      triggered: true,
      status: 'error',
      error: 'Worker crashed.',
    });
    expect(store.getJob().state.lastDeliveryStatus).toBe('not-requested');
    expect(store.getJob().state.lastDelivered).toBe(false);
    expect(store.getJob().state.lastFailureAlertAtMs).toBe(
      Date.parse('2026-04-26T12:00:00.000Z'),
    );
    expect(store.getRuns()).toHaveLength(1);
    expect(store.getRuns()[0]).toMatchObject({
      cronJobId: dueJob.id,
      status: 'error',
      error: 'Worker crashed.',
      deliveryStatus: 'not-requested',
      delivered: false,
    });
  });

  it('ticks on an interval and can be stopped cleanly', async () => {
    vi.useFakeTimers();
    const dueJob = createCronJob({
      state: {
        nextRunAtMs: Date.parse('2026-04-26T12:00:00.000Z'),
      },
    });
    const store = createDb(dueJob);

    const stop = startCronJobService({
      db: store.db,
      intervalMs: 5_000,
      now: () => new Date('2026-04-26T12:00:00.000Z'),
      logger: {},
      execute: vi.fn().mockResolvedValue({
        status: 'ok',
        summary: 'tick',
      }),
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getJob().state.lastRunStatus).toBe('ok');

    stop();
    vi.useRealTimers();
  });
});
