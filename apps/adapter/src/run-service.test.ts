import { describe, expect, it, vi } from 'vitest';
import {
  aggregateRemoteCancelRelayAudit,
  assertAutomationTaskFlowCanAcceptNewRun,
  buildRunApprovalRecordedEvent,
  buildRunResumedEvent,
  buildRunStartEvents,
  cancelRun,
  executeRunInBackground,
  recordApprovalDecision,
  serializeDelegatedRunRecord,
  serializeRun,
  serializeRunEventRecord,
  serializeRunLineage,
} from './run-service.js';
import type { ApprovalDecisionError } from './run-service.js';

describe('run-service', () => {
  it('builds queued and started events with deterministic ordering', () => {
    const queuedAt = new Date('2026-04-18T10:00:00.000Z');
    const startedAt = new Date('2026-04-18T10:00:02.000Z');

    const events = buildRunStartEvents({
      runId: 'run_1',
      flowId: 'flow_1',
      flowVersion: 3,
      trigger: { type: 'webhook', label: 'Inbound lead' },
      queuedAt,
      startedAt,
    });

    expect(events).toEqual([
      {
        sequence: 1,
        eventType: 'run.queued',
        event: {
          type: 'run.queued',
          runId: 'run_1',
          flowId: 'flow_1',
          flowVersion: 3,
          trigger: { type: 'webhook', label: 'Inbound lead' },
          at: '2026-04-18T10:00:00.000Z',
        },
        createdAt: queuedAt,
      },
      {
        sequence: 2,
        eventType: 'run.started',
        event: {
          type: 'run.started',
          runId: 'run_1',
          flowId: 'flow_1',
          flowVersion: 3,
          at: '2026-04-18T10:00:02.000Z',
        },
        createdAt: startedAt,
      },
    ]);
  });

  it('serializes run rows and persisted event records into API shapes', () => {
    const run = serializeRun({
      id: 'run_1',
      workspaceId: 'ws_default',
      flowId: 'flow_1',
      flowVersion: 3,
      status: 'running',
      trigger: { type: 'manual', label: 'Manual test' },
      input: { customerId: 'cust_1' },
      output: null,
      continuation: null,
      createdAt: new Date('2026-04-18T10:00:00.000Z'),
      startedAt: new Date('2026-04-18T10:00:02.000Z'),
      resumeAt: new Date('2026-04-18T10:01:02.000Z'),
      finishedAt: null,
      error: null,
    });

    const eventRecord = serializeRunEventRecord({
      id: 'evt_1',
      runId: 'run_1',
      sequence: 1,
      eventType: 'run.log',
      event: {
        type: 'run.log',
        runId: 'run_1',
        at: '2026-04-18T10:00:02.000Z',
        level: 'info',
        message: 'Starting flow',
      },
      createdAt: new Date('2026-04-18T10:00:02.000Z'),
    });

    expect(run).toEqual({
      id: 'run_1',
      flowId: 'flow_1',
      flowVersion: 3,
      status: 'running',
      trigger: { type: 'manual', label: 'Manual test' },
      input: { customerId: 'cust_1' },
      output: undefined,
      createdAt: '2026-04-18T10:00:00.000Z',
      startedAt: '2026-04-18T10:00:02.000Z',
      resumeAt: '2026-04-18T10:01:02.000Z',
      finishedAt: undefined,
      error: undefined,
    });

    expect(eventRecord).toEqual({
      id: 'evt_1',
      runId: 'run_1',
      sequence: 1,
      eventType: 'run.log',
      event: {
        type: 'run.log',
        runId: 'run_1',
        at: '2026-04-18T10:00:02.000Z',
        level: 'info',
        message: 'Starting flow',
      },
      createdAt: '2026-04-18T10:00:02.000Z',
    });
  });

  it('serializes delegated child runs and lineage summaries into API shapes', () => {
    const delegatedChild = serializeDelegatedRunRecord({
      id: '33333333-3333-3333-3333-333333333333',
      parentRunId: 'run_1',
      parentNodeId: 'handoff',
      delegationKind: 'agent-send',
      depth: 2,
      targetAgent: 'finance',
      sessionKey: 'agent:finance:flow:flow_1:run:run_1:node:handoff',
      gatewayRunId: 'gw_run_1',
      handoffReason: 'Finance review required',
      model: 'openai/gpt-5.4-mini',
      status: 'succeeded',
      replyText: 'Accepted',
      error: null,
      createdAt: new Date('2026-04-25T10:00:00.000Z'),
      startedAt: new Date('2026-04-25T10:00:01.000Z'),
      finishedAt: new Date('2026-04-25T10:00:05.000Z'),
    });

    expect(delegatedChild).toEqual({
      id: '33333333-3333-3333-3333-333333333333',
      parentRunId: 'run_1',
      parentNodeId: 'handoff',
      delegationKind: 'agent-send',
      depth: 2,
      targetAgent: 'finance',
      sessionKey: 'agent:finance:flow:flow_1:run:run_1:node:handoff',
      gatewayRunId: 'gw_run_1',
      handoffReason: 'Finance review required',
      model: 'openai/gpt-5.4-mini',
      status: 'succeeded',
      replyText: 'Accepted',
      error: undefined,
      createdAt: '2026-04-25T10:00:00.000Z',
      startedAt: '2026-04-25T10:00:01.000Z',
      finishedAt: '2026-04-25T10:00:05.000Z',
    });

    expect(
      serializeRunLineage('run_1', [
        {
          id: '33333333-3333-3333-3333-333333333333',
          parentRunId: 'run_1',
          parentNodeId: 'handoff',
          delegationKind: 'agent-send',
          depth: 2,
          targetAgent: 'finance',
          sessionKey: 'agent:finance:flow:flow_1:run:run_1:node:handoff',
          gatewayRunId: 'gw_run_1',
          handoffReason: 'Finance review required',
          model: 'openai/gpt-5.4-mini',
          status: 'succeeded',
          replyText: 'Accepted',
          error: null,
          createdAt: new Date('2026-04-25T10:00:00.000Z'),
          startedAt: new Date('2026-04-25T10:00:01.000Z'),
          finishedAt: new Date('2026-04-25T10:00:05.000Z'),
        },
      ]),
    ).toEqual({
      runId: 'run_1',
      delegatedChildren: [delegatedChild],
      maxDelegationDepth: 2,
    });
  });

  it('builds a resumed event when a waiting run is picked back up', () => {
    const resumedAt = new Date('2026-04-21T10:01:00.000Z');
    expect(buildRunResumedEvent({ runId: 'run_wait_1', resumedAt })).toEqual({
      eventType: 'run.resumed',
      event: {
        type: 'run.resumed',
        runId: 'run_wait_1',
        at: '2026-04-21T10:01:00.000Z',
      },
      createdAt: resumedAt,
    });
  });

  it('builds an approval-recorded event when a reviewer makes a decision', () => {
    const decidedAt = new Date('2026-04-21T11:05:00.000Z');
    expect(
      buildRunApprovalRecordedEvent({
        runId: 'run_approval_1',
        nodeId: 'approval',
        decision: 'approved',
        decidedAt,
        note: 'Approved by finance lead',
      }),
    ).toEqual({
      eventType: 'run.approval.recorded',
      event: {
        type: 'run.approval.recorded',
        runId: 'run_approval_1',
        nodeId: 'approval',
        decision: 'approved',
        at: '2026-04-21T11:05:00.000Z',
        note: 'Approved by finance lead',
      },
      createdAt: decidedAt,
    });
  });

  it('blocks new managed runs for cancelled or already-succeeded task flows', () => {
    expect(() => assertAutomationTaskFlowCanAcceptNewRun('cancelled')).toThrowError(
      /will not accept new managed work/i,
    );
    expect(() => assertAutomationTaskFlowCanAcceptNewRun('succeeded')).toThrowError(
      /create a new revision/i,
    );
    expect(() => assertAutomationTaskFlowCanAcceptNewRun('blocked')).not.toThrow();
    expect(() => assertAutomationTaskFlowCanAcceptNewRun('partial')).not.toThrow();
  });

  it('collapses repeated upstream cancel relays into one audit summary', () => {
    const aggregated = aggregateRemoteCancelRelayAudit({
      runId: 'run_cancel_1',
      entries: [
        {
          createdAt: new Date('2026-04-25T12:00:01.000Z'),
          details: {
            relayMethod: 'chat.abort',
            sessionKey: 'agent:main:test',
            gatewayRunId: 'gw_run_1',
          },
        },
        {
          createdAt: new Date('2026-04-25T12:00:02.000Z'),
          details: {
            relayMethod: 'sessions.abort',
            sessionKey: 'agent:main:test',
            gatewayRunId: 'gw_run_1',
            fallbackFrom: 'chat.abort',
          },
        },
      ],
    });

    expect(aggregated).toEqual({
      createdAt: new Date('2026-04-25T12:00:02.000Z'),
      summary: 'Relayed run cancellation upstream via sessions.abort after chat.abort fallback',
      details: {
        runId: 'run_cancel_1',
        relayMethod: 'sessions.abort',
        relayMethods: ['chat.abort', 'sessions.abort'],
        sessionKey: 'agent:main:test',
        gatewayRunId: 'gw_run_1',
        fallbackFrom: 'chat.abort',
      },
    });
  });

  it('attempts to mark the run as failed when background execution crashes', async () => {
    const recovered: Array<{ runId: string; message: string }> = [];
    const loggerCalls: unknown[][] = [];

    executeRunInBackground(
      {} as never,
      'run_99',
      {
        error(...args: unknown[]) {
          loggerCalls.push(args);
        },
      },
      async () => {
        throw new Error('adapter lost database connection');
      },
      async (_db, runId, message) => {
        recovered.push({ runId, message });
        return null;
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recovered).toEqual([
      {
        runId: 'run_99',
        message: 'background execution failed: adapter lost database connection',
      },
    ]);
    expect(loggerCalls).toHaveLength(1);
    expect(loggerCalls[0]?.[0]).toBe('[run-service] background execution failed');
  });

  it('rejects stale approval decisions after the run has already resumed', async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        id: 'run_approval_1',
        flowId: 'flow_1',
        flowVersion: 2,
        status: 'running',
        trigger: { type: 'manual' },
        input: undefined,
        output: undefined,
        continuation: null,
        createdAt: new Date('2026-04-21T10:00:00.000Z'),
        startedAt: new Date('2026-04-21T10:00:05.000Z'),
        resumeAt: null,
        finishedAt: null,
        error: null,
      },
    ]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const transaction = vi.fn(async (callback) =>
      callback({
        select,
      }),
    );

    await expect(
      recordApprovalDecision(
        {
          transaction,
        } as never,
        {
          runId: 'run_approval_1',
          decision: 'approved',
        },
      ),
    ).rejects.toMatchObject({
      code: 'RUN_NOT_WAITING',
      message: 'run is already running; approval can only be recorded while it is waiting',
    } satisfies Partial<ApprovalDecisionError>);
  });

  it('rejects approval decisions for timer waits', async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'run_wait_1',
          flowId: 'flow_1',
          flowVersion: 2,
          status: 'waiting',
          trigger: { type: 'manual' },
          input: undefined,
          output: undefined,
          continuation: {
            queue: [],
            visitedNodeIds: ['wait'],
            lastOutput: { ok: true },
            waiting: {
              kind: 'timer',
              nodeId: 'wait',
              resumeAt: '2026-04-21T10:05:00.000Z',
              durationSeconds: 60,
            },
          },
          createdAt: new Date('2026-04-21T10:00:00.000Z'),
          startedAt: new Date('2026-04-21T10:00:05.000Z'),
          resumeAt: new Date('2026-04-21T10:05:00.000Z'),
          finishedAt: null,
          error: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const transaction = vi.fn(async (callback) =>
      callback({
        select,
      }),
    );

    await expect(
      recordApprovalDecision(
        {
          transaction,
        } as never,
        {
          runId: 'run_wait_1',
          decision: 'rejected',
        },
      ),
    ).rejects.toMatchObject({
      code: 'APPROVAL_NOT_PENDING',
      message: 'run is waiting on a timer, not on an approval decision',
    } satisfies Partial<ApprovalDecisionError>);
  });

  it('returns terminal runs unchanged when cancellation is requested again', async () => {
    const cancelledRunRow = {
      id: 'run_cancelled_1',
      workspaceId: 'ws_default',
      flowId: 'flow_1',
      flowVersion: 2,
      status: 'cancelled' as const,
      trigger: { type: 'manual' as const },
      input: undefined,
      output: { ok: false },
      continuation: null,
      createdAt: new Date('2026-04-22T08:00:00.000Z'),
      startedAt: new Date('2026-04-22T08:00:01.000Z'),
      resumeAt: null,
      finishedAt: new Date('2026-04-22T08:01:00.000Z'),
      error: null,
    };

    const limit = vi.fn().mockResolvedValue([cancelledRunRow]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const transaction = vi.fn(async (callback) =>
      callback({
        select,
      }),
    );

    await expect(
      cancelRun(
        {
          transaction,
        } as never,
        {
          runId: 'run_cancelled_1',
        },
      ),
    ).resolves.toEqual({
      id: 'run_cancelled_1',
      flowId: 'flow_1',
      flowVersion: 2,
      status: 'cancelled',
      trigger: { type: 'manual' },
      input: undefined,
      output: { ok: false },
      pendingApproval: undefined,
      createdAt: '2026-04-22T08:00:00.000Z',
      startedAt: '2026-04-22T08:00:01.000Z',
      resumeAt: undefined,
      finishedAt: '2026-04-22T08:01:00.000Z',
      error: undefined,
    });
  });

  it('cancels waiting approval runs and clears the pending approval request', async () => {
    const selectResults = [
      [
        {
          id: 'run_wait_approval_1',
          workspaceId: 'ws_default',
          flowId: 'flow_1',
          flowVersion: 2,
          status: 'waiting' as const,
          trigger: { type: 'manual' as const },
          input: undefined,
          output: undefined,
          continuation: {
            queue: [],
            visitedNodeIds: ['exec'],
            waiting: {
              kind: 'approval' as const,
              nodeId: 'exec',
              requestType: 'exec' as const,
              requestedAt: '2026-04-22T09:00:00.000Z',
              timeoutSeconds: 300,
              command: 'pnpm test',
              approvalMode: 'ask' as const,
              approvedQueue: [],
              rejectedQueue: [],
            },
          },
          createdAt: new Date('2026-04-22T09:00:00.000Z'),
          startedAt: new Date('2026-04-22T09:00:01.000Z'),
          resumeAt: null,
          finishedAt: null,
          error: null,
        },
      ],
      [{ sequence: 4 }],
      [{ id: 'approval_1' }],
      [
        {
          id: 'run_wait_approval_1',
          workspaceId: 'ws_default',
          flowId: 'flow_1',
          flowVersion: 2,
          status: 'cancelled' as const,
          trigger: { type: 'manual' as const },
          input: undefined,
          output: undefined,
          continuation: null,
          createdAt: new Date('2026-04-22T09:00:00.000Z'),
          startedAt: new Date('2026-04-22T09:00:01.000Z'),
          resumeAt: null,
          finishedAt: new Date('2026-04-22T09:02:00.000Z'),
          error: null,
        },
      ],
    ];

    const setCalls: unknown[] = [];
    const insertCalls: unknown[] = [];
    const updatePlans = [
      { returningResult: undefined },
      {
        returningResult: [
          {
            id: 'run_wait_approval_1',
            workspaceId: 'ws_default',
            flowId: 'flow_1',
            flowVersion: 2,
            status: 'cancelled' as const,
            trigger: { type: 'manual' as const },
            input: undefined,
            output: undefined,
            continuation: null,
            createdAt: new Date('2026-04-22T09:00:00.000Z'),
            startedAt: new Date('2026-04-22T09:00:01.000Z'),
            resumeAt: null,
            finishedAt: new Date('2026-04-22T09:02:00.000Z'),
            error: null,
          },
        ],
      },
    ];

    const select = vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const limit = vi.fn().mockResolvedValue(result);
      const orderBy = vi.fn(() => ({ limit }));
      const where = vi.fn(() => ({ limit, orderBy }));
      const from = vi.fn(() => ({ where, orderBy, limit }));
      return { from };
    });
    const insert = vi.fn(() => ({
      values: vi.fn((values) => {
        insertCalls.push(values);
        return Promise.resolve();
      }),
    }));
    const update = vi.fn(() => {
      const plan = updatePlans.shift() ?? { returningResult: undefined };
      const returning = vi.fn().mockResolvedValue(plan.returningResult ?? []);
      const where = vi.fn(() =>
        plan.returningResult === undefined ? Promise.resolve() : { returning },
      );
      return {
        set: vi.fn((values) => {
          setCalls.push(values);
          return { where, returning };
        }),
      };
    });
    const transaction = vi.fn(async (callback) =>
      callback({
        select,
        insert,
        update,
      }),
    );

    await expect(
      cancelRun(
        {
          transaction,
        } as never,
        {
          runId: 'run_wait_approval_1',
          note: 'Operator stopped the task flow.',
        },
      ),
    ).resolves.toMatchObject({
      id: 'run_wait_approval_1',
      status: 'cancelled',
      finishedAt: '2026-04-22T09:02:00.000Z',
    });

    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0]).toMatchObject({
      runId: 'run_wait_approval_1',
      eventType: 'run.finished',
      event: expect.objectContaining({
        type: 'run.finished',
        runId: 'run_wait_approval_1',
        status: 'cancelled',
      }),
    });
    expect(insertCalls[1]).toMatchObject({
      workspaceId: 'ws_default',
      actorUserId: null,
      eventType: 'run.cancel.requested',
      targetType: 'run',
      targetId: 'run_wait_approval_1',
      summary: 'Cancelled run run_wait locally',
      details: {
        runId: 'run_wait_approval_1',
        status: 'cancelled',
        note: 'Operator stopped the task flow.',
      },
    });
    expect(setCalls[0]).toMatchObject({
      status: 'cancelled',
      decisionNote: 'Operator stopped the task flow.',
    });
    expect(setCalls[1]).toMatchObject({
      status: 'cancelled',
      continuation: null,
      resumeAt: null,
    });
  });
});
