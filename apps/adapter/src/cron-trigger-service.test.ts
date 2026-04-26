import { describe, expect, it, vi } from 'vitest';
import {
  listPublishedCronTriggerFlows,
  processCronTriggers,
  startCronTriggerService,
} from './cron-trigger-service.js';
import { RunLaunchError } from './run-service.js';

describe('cron-trigger-service', () => {
  it('extracts published cron triggers from flow snapshots', async () => {
    const result = await listPublishedCronTriggerFlows({
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => [
              {
                flowId: 'flow_1',
                flowName: 'Morning digest',
                nodes: [
                  {
                    id: 'cron',
                    type: 'trigger.cron',
                    position: { x: 0, y: 0 },
                    data: { schedule: '0 9 * * 1-5', timezone: 'Asia/Kolkata' },
                  },
                ],
              },
            ],
          }),
        }),
      }),
    } as never);

    expect(result).toEqual([
      {
        flowId: 'flow_1',
        flowName: 'Morning digest',
        schedule: '0 9 * * 1-5',
        timezone: 'Asia/Kolkata',
      },
    ]);
  });

  it('launches matching cron flows once per minute tick', async () => {
    const launchRun = vi
      .fn()
      .mockResolvedValueOnce({ id: 'run_cron_1' })
      .mockRejectedValueOnce(
        new RunLaunchError('TRIGGER_NOT_MATCHED', 'cron trigger does not match this event'),
      );
    const executeRun = vi.fn();
    const recentTicks = {
      seen: new Set<string>(),
      has(key: string) {
        return this.seen.has(key);
      },
      add(key: string) {
        this.seen.add(key);
      },
    } as const;

    const count = await processCronTriggers({
      db: {} as never,
      at: new Date('2026-04-20T03:30:00.000Z'),
      listFlows: vi.fn().mockResolvedValue([
        {
          flowId: 'flow_1',
          flowName: 'Morning digest',
          schedule: '0 9 * * 1-5',
          timezone: 'Asia/Kolkata',
        },
        {
          flowId: 'flow_2',
          flowName: 'Hourly sync',
          schedule: '0 * * * *',
          timezone: 'UTC',
        },
      ]),
      launchRun,
      executeRun,
      recentTicks,
    });

    expect(count).toBe(1);
    expect(launchRun).toHaveBeenNthCalledWith(1, {} as never, {
      flowId: 'flow_1',
      trigger: {
        type: 'cron',
        label: 'Cron schedule',
        schedule: '0 9 * * 1-5',
        timezone: 'Asia/Kolkata',
        sourceId: 'flow_1:0 9 * * 1-5:Asia/Kolkata:2026-04-20T09:00',
      },
      input: {
        scheduledAt: '2026-04-20T03:30:00.000Z',
        schedule: '0 9 * * 1-5',
        timezone: 'Asia/Kolkata',
        flowName: 'Morning digest',
      },
    });
    expect(executeRun).toHaveBeenCalledWith({} as never, 'run_cron_1', expect.any(Object));

    const secondCount = await processCronTriggers({
      db: {} as never,
      at: new Date('2026-04-20T03:30:10.000Z'),
      listFlows: vi.fn().mockResolvedValue([
        {
          flowId: 'flow_1',
          flowName: 'Morning digest',
          schedule: '0 9 * * 1-5',
          timezone: 'Asia/Kolkata',
        },
      ]),
      launchRun,
      executeRun,
      recentTicks,
    });

    expect(secondCount).toBe(0);
    expect(launchRun).toHaveBeenCalledTimes(1);
  });

  it('ticks on an interval and can be stopped cleanly', async () => {
    vi.useFakeTimers();
    const launchRun = vi.fn().mockResolvedValue({ id: 'run_cron_1' });
    const executeRun = vi.fn();

    const stop = startCronTriggerService({
      db: {} as never,
      intervalMs: 5_000,
      now: () => new Date('2026-04-20T03:30:00.000Z'),
      listFlows: vi.fn().mockResolvedValue([
        {
          flowId: 'flow_1',
          flowName: 'Morning digest',
          schedule: '0 9 * * 1-5',
          timezone: 'Asia/Kolkata',
        },
      ]),
      launchRun,
      executeRun,
      logger: {},
    });

    await vi.runAllTicks();
    expect(launchRun).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(launchRun).toHaveBeenCalledTimes(1);

    stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(launchRun).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
