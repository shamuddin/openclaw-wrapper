import { describe, expect, it, vi } from 'vitest';
import { processWaitingRuns, startWaitResumeService } from './wait-resume-service.js';

describe('wait-resume-service', () => {
  it('resumes due waiting runs and dispatches them back into background execution', async () => {
    const executeRun = vi.fn();
    const resumedIds: string[] = [];

    const resumedCount = await processWaitingRuns({
      db: {} as never,
      at: new Date('2026-04-21T10:01:00.000Z'),
      listRuns: async () => ['run_wait_1', 'run_wait_2'],
      resumeRun: async (_db, runId) => {
        resumedIds.push(runId);
        return {
          id: runId,
          flowId: 'flow_1',
          flowVersion: 1,
          status: 'running',
          trigger: { type: 'manual' },
          createdAt: '2026-04-21T10:00:00.000Z',
          startedAt: '2026-04-21T10:00:01.000Z',
        };
      },
      executeRun,
    });

    expect(resumedCount).toBe(2);
    expect(resumedIds).toEqual(['run_wait_1', 'run_wait_2']);
    expect(executeRun).toHaveBeenCalledTimes(2);
  });

  it('starts a polling loop that checks for due waiting runs', async () => {
    vi.useFakeTimers();
    const listRuns = vi.fn(async () => []);

    const stop = startWaitResumeService({
      db: {} as never,
      intervalMs: 1000,
      now: () => new Date('2026-04-21T10:01:00.000Z'),
      listRuns,
      resumeRun: async () => null,
      executeRun: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2500);
    stop();
    vi.useRealTimers();

    expect(listRuns).toHaveBeenCalledTimes(3);
  });
});
