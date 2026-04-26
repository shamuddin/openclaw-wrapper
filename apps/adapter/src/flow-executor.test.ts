import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runOpenClawAgentMock, runOpenClawSkillMock, sendOpenClawChannelReplyMock } = vi.hoisted(
  () => ({
    runOpenClawAgentMock: vi.fn(),
    runOpenClawSkillMock: vi.fn(),
    sendOpenClawChannelReplyMock: vi.fn(),
  }),
);

vi.mock('./openclaw.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./openclaw.js')>();
  return {
    ...actual,
    runOpenClawAgent: runOpenClawAgentMock,
    runOpenClawSkill: runOpenClawSkillMock,
    sendOpenClawChannelReply: sendOpenClawChannelReplyMock,
  };
});

import {
  executeChannelReplyNodeWithProfile,
  executeChannelRouteNodeWithProfile,
  executePublishedFlow,
} from './flow-executor.js';

function makeClock(...timestamps: string[]) {
  let index = 0;
  return () => {
    const fallback = timestamps[timestamps.length - 1] ?? '2026-04-18T00:00:00.000Z';
    const value = timestamps[Math.min(index++, timestamps.length - 1)] ?? fallback;
    return new Date(value);
  };
}

describe('executePublishedFlow', () => {
  beforeEach(() => {
    runOpenClawAgentMock.mockReset();
    runOpenClawSkillMock.mockReset();
    sendOpenClawChannelReplyMock.mockReset();
  });

  it('maps channel reply fields consistently across root payloads and input-prefixed paths', async () => {
    sendOpenClawChannelReplyMock.mockResolvedValueOnce({
      channel: 'whatsapp',
      to: '916383935822',
      accountId: 'primary',
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
      messageId: 'msg_1',
      toJid: '916383935822@s.whatsapp.net',
    });

    const result = await executeChannelReplyNodeWithProfile({
      runId: 'run_mapping',
      flowId: 'flow_mapping',
      flowVersion: 1,
      node: {
        id: 'reply',
        type: 'action.channel-reply',
        position: { x: 0, y: 0 },
        data: {
          label: 'Reply to WhatsApp',
          channelType: 'whatsapp',
          toPath: 'input.to',
          accountIdPath: 'input.accountId',
          sessionKeyPath: 'input.sessionKey',
          threadIdPath: 'input.threadId',
          messageTemplate: '{{message}}',
        },
      },
      nodeInput: {
        to: '916383935822',
        message: 'Customer says order 42 needs a refund',
        accountId: 'primary',
        sessionKey: 'agent:main:whatsapp:direct:916383935822',
      },
    });

    expect(sendOpenClawChannelReplyMock).toHaveBeenCalledWith({
      channel: 'whatsapp',
      to: '916383935822',
      message: 'Customer says order 42 needs a refund',
      idempotencyKey: 'run_mapping:reply',
      accountId: 'primary',
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
    });
    expect(result.output).toMatchObject({
      channel: 'whatsapp',
      to: '916383935822',
      accountId: 'primary',
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
      message: 'Customer says order 42 needs a refund',
    });
  });

  it('routes a message through a saved channel profile and preserves threading by default', async () => {
    sendOpenClawChannelReplyMock.mockResolvedValueOnce({
      channel: 'telegram',
      to: '@opsdesk',
      accountId: 'ops_primary',
      sessionKey: 'agent:ops:telegram:thread:123',
      messageId: 'msg_route_1',
      toJid: '@opsdesk',
    });

    const result = await executeChannelRouteNodeWithProfile({
      runId: 'run_route_profile',
      flowId: 'flow_route_profile',
      flowVersion: 1,
      node: {
        id: 'route',
        type: 'action.channel-route',
        position: { x: 0, y: 0 },
        data: {
          label: 'Route to ops desk',
          destination: 'profile_ops',
          threading: 'preserve',
          messageTemplate: '{{message}}',
        },
      },
      nodeInput: {
        to: '@opsdesk',
        message: 'Refund order 42 manually.',
        threadId: 'thread_123',
        sessionKey: 'agent:ops:telegram:thread:123',
      },
      profile: {
        id: 'profile_ops',
        name: 'Ops Desk',
        channelType: 'telegram',
        agentId: 'ops',
        accountId: 'ops_primary',
        routeKey: 'ops.inbox',
        defaultTarget: '@opsdesk',
        config: {},
      },
    });

    expect(sendOpenClawChannelReplyMock).toHaveBeenCalledWith({
      channel: 'telegram',
      to: '@opsdesk',
      message: 'Refund order 42 manually.',
      idempotencyKey: 'run_route_profile:route',
      accountId: 'ops_primary',
      agentId: 'ops',
      threadId: 'thread_123',
      sessionKey: 'agent:ops:telegram:thread:123',
    });
    expect(result.output).toMatchObject({
      channel: 'telegram',
      destination: 'profile_ops',
      destinationProfileId: 'profile_ops',
      destinationProfileName: 'Ops Desk',
      routeKey: 'ops.inbox',
      threading: 'preserve',
      message: 'Refund order 42 manually.',
    });
  });

  it('routes a message directly to a raw channel and can start a new thread', async () => {
    sendOpenClawChannelReplyMock.mockResolvedValueOnce({
      channel: 'whatsapp',
      to: '916383935822',
      accountId: 'primary',
      sessionKey: undefined,
      messageId: 'msg_route_2',
      toJid: '916383935822@s.whatsapp.net',
    });

    const result = await executeChannelRouteNodeWithProfile({
      runId: 'run_route_raw',
      flowId: 'flow_route_raw',
      flowVersion: 1,
      node: {
        id: 'route_raw',
        type: 'action.channel-route',
        position: { x: 0, y: 0 },
        data: {
          label: 'Route to WhatsApp',
          destination: 'whatsapp',
          threading: 'new',
          messageTemplate: '{{message}}',
        },
      },
      nodeInput: {
        to: '916383935822',
        message: 'Starting a fresh support thread.',
        accountId: 'primary',
        threadId: 'thread_old',
        sessionKey: 'session_old',
      },
    });

    expect(sendOpenClawChannelReplyMock).toHaveBeenCalledWith({
      channel: 'whatsapp',
      to: '916383935822',
      message: 'Starting a fresh support thread.',
      idempotencyKey: 'run_route_raw:route_raw',
      accountId: 'primary',
    });
    expect(result.output).toMatchObject({
      channel: 'whatsapp',
      destination: 'whatsapp',
      threading: 'new',
      message: 'Starting a fresh support thread.',
    });
  });

  it('returns an offline-fallback delivery result when channel send cannot reach the gateway', async () => {
    sendOpenClawChannelReplyMock.mockRejectedValueOnce(new Error('gateway_unreachable'));

    const result = await executeChannelReplyNodeWithProfile({
      runId: 'run_reply_offline',
      flowId: 'flow_reply_offline',
      flowVersion: 1,
      node: {
        id: 'reply',
        type: 'action.channel-reply',
        position: { x: 0, y: 0 },
        data: {
          label: 'Reply to WhatsApp',
          channelType: 'whatsapp',
          messageTemplate: '{{message}}',
        },
      },
      nodeInput: {
        to: '916383935822',
        message: 'We are still reviewing your refund.',
      },
    });

    expect(result.output).toMatchObject({
      channel: 'whatsapp',
      to: '916383935822',
      message: 'We are still reviewing your refund.',
      deliveryStatus: 'offline_fallback',
      offlineFallback: true,
      offlineReason: 'gateway_unreachable',
    });
    expect(result.logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('offline fallback'),
        }),
      ]),
    );
  });

  it('executes a webhook-to-log flow and finishes successfully', async () => {
    const payload = { customerId: 'cust_1', issue: 'refund' };
    const result = await executePublishedFlow({
      runId: 'run_1',
      flowId: 'flow_1',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      now: makeClock(
        '2026-04-18T10:00:00.000Z',
        '2026-04-18T10:00:01.000Z',
        '2026-04-18T10:00:02.000Z',
        '2026-04-18T10:00:03.000Z',
        '2026-04-18T10:00:04.000Z',
        '2026-04-18T10:00:05.000Z',
      ),
      nodes: [
        {
          id: 'n1',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'n2',
          type: 'action.log',
          position: { x: 160, y: 0 },
          data: {
            label: 'Log customer issue',
            logLevel: 'warn',
            message: 'Escalate to refunds queue',
            includeInput: false,
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n1',
          sourcePort: 'out',
          target: 'n2',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual(payload);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
    expect(result.events[3]?.event).toMatchObject({
      type: 'run.log',
      nodeId: 'n2',
      level: 'warn',
      message: 'Escalate to refunds queue',
    });
  });

  it('keeps an agent node testable offline by returning a clearly marked fallback result', async () => {
    runOpenClawAgentMock.mockRejectedValueOnce(new Error('gateway_unreachable'));

    const result = await executePublishedFlow({
      runId: 'run_agent_offline',
      flowId: 'flow_agent_offline',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: { topic: 'refund policy' },
      now: makeClock(
        '2026-04-21T10:00:00.000Z',
        '2026-04-21T10:00:01.000Z',
        '2026-04-21T10:00:02.000Z',
        '2026-04-21T10:00:03.000Z',
        '2026-04-21T10:00:04.000Z',
        '2026-04-21T10:00:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'agent',
          type: 'action.agent',
          position: { x: 160, y: 0 },
          data: {
            agentId: 'main',
          },
        },
      ],
      edges: [
        {
          id: 'edge',
          source: 'trigger',
          sourcePort: 'out',
          target: 'agent',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      agentId: 'main',
      status: 'offline_fallback',
      offlineFallback: true,
      offlineReason: 'gateway_unreachable',
    });
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'run.log',
          event: expect.objectContaining({
            level: 'warn',
            nodeId: 'agent',
            message: expect.stringContaining('offline fallback'),
          }),
        }),
      ]),
    );
  });

  it('keeps a skill node testable offline by returning a clearly marked fallback result', async () => {
    runOpenClawSkillMock.mockRejectedValueOnce(new Error('connection closed'));

    const result = await executePublishedFlow({
      runId: 'run_skill_offline',
      flowId: 'flow_skill_offline',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: { message: 'Draft a short reply' },
      now: makeClock(
        '2026-04-21T11:00:00.000Z',
        '2026-04-21T11:00:01.000Z',
        '2026-04-21T11:00:02.000Z',
        '2026-04-21T11:00:03.000Z',
        '2026-04-21T11:00:04.000Z',
        '2026-04-21T11:00:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'skill',
          type: 'action.skill',
          position: { x: 160, y: 0 },
          data: {
            skillName: 'draft_reply',
          },
        },
      ],
      edges: [
        {
          id: 'edge',
          source: 'trigger',
          sourcePort: 'out',
          target: 'skill',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      skillName: 'draft_reply',
      status: 'offline_fallback',
      sendStatus: 'offline_fallback',
      offlineFallback: true,
      offlineReason: 'connection closed',
    });
  });

  it('executes a hook-to-log flow and finishes successfully', async () => {
    const payload = { subject: 'Refund request', body: 'Customer wants a refund for order 42' };
    const result = await executePublishedFlow({
      runId: 'run_hook_1',
      flowId: 'flow_hook_1',
      flowVersion: 1,
      trigger: { type: 'hook', hookName: 'gmail.message.received', sourceId: 'hook:msg:42' },
      input: payload,
      now: makeClock(
        '2026-04-21T16:00:00.000Z',
        '2026-04-21T16:00:01.000Z',
        '2026-04-21T16:00:02.000Z',
        '2026-04-21T16:00:03.000Z',
        '2026-04-21T16:00:04.000Z',
        '2026-04-21T16:00:05.000Z',
      ),
      nodes: [
        {
          id: 'hook',
          type: 'trigger.hook',
          position: { x: 0, y: 0 },
          data: { label: 'Gmail hook', hookName: 'gmail.message.received', filter: 'refund' },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 160, y: 0 },
          data: {
            label: 'Log refund email',
            logLevel: 'info',
            message: 'Inbound refund hook',
            includeInput: false,
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'hook',
          sourcePort: 'out',
          target: 'log',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual(payload);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
  });

  it('cooperatively cancels after the current node before scheduling more work', async () => {
    const payload = { customerId: 'cust_cancel_1' };
    const checkCancellation = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await executePublishedFlow({
      runId: 'run_cancel_mid_1',
      flowId: 'flow_cancel_mid_1',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      checkCancellation,
      now: makeClock(
        '2026-04-25T10:00:00.000Z',
        '2026-04-25T10:00:01.000Z',
        '2026-04-25T10:00:02.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'wait',
          type: 'control.wait',
          position: { x: 160, y: 0 },
          data: { label: 'Wait 60s', durationSeconds: '60' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'wait',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('cancelled');
    expect(result.output).toEqual(payload);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
    ]);
    expect(checkCancellation).toHaveBeenCalledTimes(2);
  });

  it('skips resumed work when cancellation is already requested', async () => {
    const payload = { customerId: 'cust_cancel_resume_1' };

    const result = await executePublishedFlow({
      runId: 'run_cancel_resume_1',
      flowId: 'flow_cancel_resume_1',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      resumeState: {
        queue: [{ nodeId: 'log', input: payload }],
        visitedNodeIds: ['trigger', 'wait'],
        lastOutput: payload,
      },
      checkCancellation: async () => true,
      now: makeClock('2026-04-25T10:05:00.000Z'),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 160, y: 0 },
          data: { label: 'Log', includeInput: false, message: 'Should not run' },
        },
      ],
      edges: [],
    });

    expect(result.status).toBe('cancelled');
    expect(result.output).toEqual(payload);
    expect(result.events).toEqual([]);
  });

  it('treats an in-flight abortable node as cancelled instead of failed', async () => {
    const payload = { customerId: 'cust_abort_1' };
    const controller = new AbortController();

    const result = await executePublishedFlow({
      runId: 'run_abort_1',
      flowId: 'flow_abort_1',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      abortSignal: controller.signal,
      now: makeClock('2026-04-25T11:00:00.000Z', '2026-04-25T11:00:01.000Z'),
      executeHttpNode: async ({ abortSignal }) =>
        new Promise((resolve, reject) => {
          const onAbort = () => {
            const error = new Error('request aborted');
            error.name = 'AbortError';
            reject(error);
          };

          if (abortSignal?.aborted) {
            onAbort();
            return;
          }

          abortSignal?.addEventListener('abort', onAbort, { once: true });
          setTimeout(() => controller.abort(), 0);

          setTimeout(() => {
            abortSignal?.removeEventListener('abort', onAbort);
            resolve({
              output: { ok: true },
              result: { ok: true },
              logs: [],
            });
          }, 50);
        }),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'http',
          type: 'action.http',
          position: { x: 160, y: 0 },
          data: {
            label: 'HTTP',
            method: 'GET',
            url: 'https://example.com',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'http',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('cancelled');
    expect(result.output).toEqual(payload);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
    ]);
  });

  it('preserves upstream cancellation relay logs when an abortable node is cancelled', async () => {
    const payload = { customerId: 'cust_abort_gateway_1' };
    const controller = new AbortController();

    const result = await executePublishedFlow({
      runId: 'run_abort_gateway_1',
      flowId: 'flow_abort_gateway_1',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      abortSignal: controller.signal,
      now: makeClock(
        '2026-04-25T11:10:00.000Z',
        '2026-04-25T11:10:01.000Z',
        '2026-04-25T11:10:02.000Z',
      ),
      executeAgentNode: async ({ abortSignal }) =>
        new Promise((_, reject) => {
          const onAbort = () => {
            const error = new Error('request aborted') as Error & {
              remoteAbortRelayLogs?: Array<{
                level: 'info';
                message: string;
                at: string;
                data: {
                  kind: 'remote-cancel-relay';
                  provider: 'openclaw';
                  relayMethod: 'chat.abort';
                  sessionKey: string;
                  gatewayRunId: string;
                };
              }>;
            };
            error.name = 'AbortError';
            error.remoteAbortRelayLogs = [
              {
                level: 'info',
                message:
                  'Requested upstream cancellation via chat.abort for session "agent:main:test"',
                at: '2026-04-25T11:10:02.000Z',
                data: {
                  kind: 'remote-cancel-relay',
                  provider: 'openclaw',
                  relayMethod: 'chat.abort',
                  sessionKey: 'agent:main:test',
                  gatewayRunId: 'gw_run_abort_1',
                },
              },
            ];
            reject(error);
          };

          if (abortSignal?.aborted) {
            onAbort();
            return;
          }

          abortSignal?.addEventListener('abort', onAbort, { once: true });
          setTimeout(() => controller.abort(), 0);
        }),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'agent',
          type: 'action.agent',
          position: { x: 160, y: 0 },
          data: {
            label: 'Agent',
            agentId: 'main',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'agent',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('cancelled');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
    ]);
    expect(result.events[3]?.event).toMatchObject({
      type: 'run.log',
      nodeId: 'agent',
      message: 'Requested upstream cancellation via chat.abort for session "agent:main:test"',
      data: {
        kind: 'remote-cancel-relay',
        relayMethod: 'chat.abort',
        sessionKey: 'agent:main:test',
        gatewayRunId: 'gw_run_abort_1',
      },
    });
  });

  it('suspends a run when a wait node is reached', async () => {
    const payload = { customerId: 'cust_wait_1' };
    const result = await executePublishedFlow({
      runId: 'run_wait_1',
      flowId: 'flow_wait_1',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      now: makeClock(
        '2026-04-21T10:00:00.000Z',
        '2026-04-21T10:00:01.000Z',
        '2026-04-21T10:00:02.000Z',
        '2026-04-21T10:00:03.000Z',
        '2026-04-21T10:00:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'wait',
          type: 'control.wait',
          position: { x: 160, y: 0 },
          data: { label: 'Wait 60s', durationSeconds: '60' },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 320, y: 0 },
          data: { label: 'Log after wait', includeInput: false, message: 'Resumed' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'wait',
          targetPort: 'in',
        },
        {
          id: 'e2',
          source: 'wait',
          sourcePort: 'out',
          target: 'log',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('waiting');
    expect(result.output).toEqual(payload);
    expect(result.resumeAt?.toISOString()).toBe('2026-04-21T10:01:03.000Z');
    expect(result.continuation).toEqual({
      queue: [{ nodeId: 'log', input: payload, pathNodeIds: ['trigger', 'wait', 'log'] }],
      visitedNodeIds: ['trigger', 'wait'],
      lastOutput: payload,
      waiting: {
        kind: 'timer',
        nodeId: 'wait',
        resumeAt: '2026-04-21T10:01:03.000Z',
        durationSeconds: 60,
      },
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'node.finished',
      'run.waiting',
    ]);
  });

  it('resumes a waiting run from stored continuation state', async () => {
    const payload = { customerId: 'cust_wait_2' };
    const result = await executePublishedFlow({
      runId: 'run_wait_2',
      flowId: 'flow_wait_2',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      resumeState: {
        queue: [{ nodeId: 'log', input: payload }],
        visitedNodeIds: ['trigger', 'wait'],
        lastOutput: payload,
      },
      now: makeClock(
        '2026-04-21T10:01:03.000Z',
        '2026-04-21T10:01:04.000Z',
        '2026-04-21T10:01:05.000Z',
        '2026-04-21T10:01:06.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'wait',
          type: 'control.wait',
          position: { x: 160, y: 0 },
          data: { label: 'Wait 60s', durationSeconds: '60' },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 320, y: 0 },
          data: { label: 'Log after wait', includeInput: false, message: 'Resumed' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'wait',
          targetPort: 'in',
        },
        {
          id: 'e2',
          source: 'wait',
          sourcePort: 'out',
          target: 'log',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual(payload);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
  });

  it('suspends a run when an approval node is reached', async () => {
    const payload = { orderId: '42', amount: 1200 };
    const result = await executePublishedFlow({
      runId: 'run_approval_1',
      flowId: 'flow_approval_1',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Approval test' },
      input: payload,
      now: makeClock(
        '2026-04-21T11:00:00.000Z',
        '2026-04-21T11:00:01.000Z',
        '2026-04-21T11:00:02.000Z',
        '2026-04-21T11:00:03.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'approval',
          type: 'control.approval',
          position: { x: 160, y: 0 },
          data: {
            label: 'Manager approval',
            reason: 'Refund exceeds threshold',
            timeoutSeconds: '300',
          },
        },
        {
          id: 'approvedLog',
          type: 'action.log',
          position: { x: 320, y: -40 },
          data: { label: 'Approved path', includeInput: false, message: 'Approved' },
        },
        {
          id: 'rejectedLog',
          type: 'action.log',
          position: { x: 320, y: 40 },
          data: { label: 'Rejected path', includeInput: false, message: 'Rejected' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourcePort: 'out', target: 'approval', targetPort: 'in' },
        {
          id: 'e2',
          source: 'approval',
          sourcePort: 'approved',
          target: 'approvedLog',
          targetPort: 'in',
        },
        {
          id: 'e3',
          source: 'approval',
          sourcePort: 'rejected',
          target: 'rejectedLog',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('waiting');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'node.finished',
      'run.approval.requested',
      'run.waiting',
    ]);
    expect(result.continuation).toMatchObject({
      queue: [],
      visitedNodeIds: ['trigger', 'approval'],
      lastOutput: payload,
      waiting: {
        kind: 'approval',
        nodeId: 'approval',
        reason: 'Refund exceeds threshold',
        timeoutSeconds: 300,
        approvedQueue: [{ nodeId: 'approvedLog', input: payload }],
        rejectedQueue: [{ nodeId: 'rejectedLog', input: payload }],
      },
    });
  });

  it('executes a channel-triggered flow when the inbound event matches the trigger config', async () => {
    const payload = {
      channelType: 'whatsapp',
      routeKey: 'support.inbox',
      message: 'Customer asked for refund on order 42',
    };

    const result = await executePublishedFlow({
      runId: 'run_channel_1',
      flowId: 'flow_channel_1',
      flowVersion: 1,
      trigger: {
        type: 'channel',
        channel: 'whatsapp',
        routeKey: 'support.inbox',
        sourceId: 'sender:+919999999999',
      },
      input: payload,
      now: makeClock(
        '2026-04-20T12:00:00.000Z',
        '2026-04-20T12:00:01.000Z',
        '2026-04-20T12:00:02.000Z',
        '2026-04-20T12:00:03.000Z',
        '2026-04-20T12:00:04.000Z',
        '2026-04-20T12:00:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.channel',
          position: { x: 0, y: 0 },
          data: {
            label: 'Inbound channel',
            channelType: 'whatsapp',
            routeKey: 'support.inbox',
            messagePattern: 'refund',
          },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 160, y: 0 },
          data: { label: 'Matched channel event', includeInput: false, message: 'Channel matched' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'log',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual(payload);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
  });

  it('executes a cron-triggered flow when the schedule matches', async () => {
    const payload = {
      scheduledAt: '2026-04-20T03:30:00.000Z',
      schedule: '0 9 * * 1-5',
      timezone: 'Asia/Kolkata',
    };

    const result = await executePublishedFlow({
      runId: 'run_cron_1',
      flowId: 'flow_cron_1',
      flowVersion: 1,
      trigger: {
        type: 'cron',
        schedule: '0 9 * * 1-5',
        timezone: 'Asia/Kolkata',
        sourceId: 'flow_cron_1:0 9 * * 1-5:Asia/Kolkata:2026-04-20T09:00',
      },
      input: payload,
      now: makeClock(
        '2026-04-20T03:30:00.000Z',
        '2026-04-20T03:30:01.000Z',
        '2026-04-20T03:30:02.000Z',
        '2026-04-20T03:30:03.000Z',
        '2026-04-20T03:30:04.000Z',
        '2026-04-20T03:30:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.cron',
          position: { x: 0, y: 0 },
          data: {
            label: 'Weekday 9 AM',
            schedule: '0 9 * * 1-5',
            timezone: 'Asia/Kolkata',
          },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 160, y: 0 },
          data: { label: 'Cron matched', includeInput: false, message: 'Cron fired' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'log',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual(payload);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
  });

  it('routes a branch flow down the true port', async () => {
    const result = await executePublishedFlow({
      runId: 'run_2',
      flowId: 'flow_2',
      flowVersion: 2,
      trigger: { type: 'manual', label: 'Manual test' },
      input: { branch: true, customerId: 'cust_2' },
      now: makeClock(
        '2026-04-18T11:00:00.000Z',
        '2026-04-18T11:00:01.000Z',
        '2026-04-18T11:00:02.000Z',
        '2026-04-18T11:00:03.000Z',
        '2026-04-18T11:00:04.000Z',
        '2026-04-18T11:00:05.000Z',
        '2026-04-18T11:00:06.000Z',
        '2026-04-18T11:00:07.000Z',
        '2026-04-18T11:00:08.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'branch',
          type: 'logic.branch',
          position: { x: 140, y: 0 },
          data: {
            label: 'Branch',
            branchMode: 'path_equals',
            fieldPath: 'branch',
            equalsValue: 'true',
          },
        },
        {
          id: 'log_true',
          type: 'action.log',
          position: { x: 280, y: -60 },
          data: { label: 'True path' },
        },
        {
          id: 'log_false',
          type: 'action.log',
          position: { x: 280, y: 60 },
          data: { label: 'False path' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'branch',
          targetPort: 'in',
        },
        {
          id: 'e2',
          source: 'branch',
          sourcePort: 'true',
          target: 'log_true',
          targetPort: 'in',
        },
        {
          id: 'e3',
          source: 'branch',
          sourcePort: 'false',
          target: 'log_false',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(
      result.events
        .filter((event) => event.eventType === 'node.started')
        .map((event) => {
          const payload = event.event;
          return 'nodeId' in payload ? payload.nodeId : undefined;
        }),
    ).toEqual(['trigger', 'branch', 'log_true']);
    expect(result.events.some((event) => JSON.stringify(event.event).includes('log_false'))).toBe(
      false,
    );
    expect(
      result.events.some((event) => JSON.stringify(event.event).includes('"mode":"path_equals"')),
    ).toBe(true);
  });

  it('executes an OpenClaw agent node and carries its output forward', async () => {
    const executeAgentNode = vi.fn(async ({ nodeInput }) => ({
      output: {
        agentId: 'intake-agent',
        gatewayRunId: 'gw_run_1',
        sessionKey: 'agent:intake-agent:flow:flow_5:run:run_5:node:agent',
        status: 'ok' as const,
        replyText: 'refund',
      },
      result: {
        gatewayRunId: 'gw_run_1',
        replyText: 'refund',
      },
      logs: [
        {
          level: 'info' as const,
          message: 'Agent "intake-agent" completed via OpenClaw',
          data: { observedInput: nodeInput },
        },
      ],
    }));

    const payload = { message: 'Customer asked for refund' };
    const result = await executePublishedFlow({
      runId: 'run_5',
      flowId: 'flow_5',
      flowVersion: 6,
      trigger: { type: 'webhook', eventName: 'customer.message.received' },
      input: payload,
      executeAgentNode,
      now: makeClock(
        '2026-04-18T14:00:00.000Z',
        '2026-04-18T14:00:01.000Z',
        '2026-04-18T14:00:02.000Z',
        '2026-04-18T14:00:03.000Z',
        '2026-04-18T14:00:04.000Z',
        '2026-04-18T14:00:05.000Z',
        '2026-04-18T14:00:06.000Z',
        '2026-04-18T14:00:07.000Z',
        '2026-04-18T14:00:08.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook', eventName: 'customer.message.received' },
        },
        {
          id: 'agent',
          type: 'action.agent',
          position: { x: 160, y: 0 },
          data: {
            label: 'Run intake agent',
            agentId: 'intake-agent',
            instructions: 'Classify the customer request.',
          },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 320, y: 0 },
          data: { label: 'Log result', includeInput: false, message: 'Agent finished' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'agent',
          targetPort: 'in',
        },
        {
          id: 'e2',
          source: 'agent',
          sourcePort: 'out',
          target: 'log',
          targetPort: 'in',
        },
      ],
    });

    expect(executeAgentNode).toHaveBeenCalledWith({
      runId: 'run_5',
      flowId: 'flow_5',
      flowVersion: 6,
      node: expect.objectContaining({ id: 'agent', type: 'action.agent' }),
      nodeInput: payload,
    });
    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      agentId: 'intake-agent',
      gatewayRunId: 'gw_run_1',
      replyText: 'refund',
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
    expect(result.events[3]?.event).toMatchObject({
      type: 'run.log',
      nodeId: 'agent',
      level: 'info',
      message: 'Agent "intake-agent" completed via OpenClaw',
    });
  });

  it('binds thread context by reusing existing thread and session values', async () => {
    const payload = {
      customer: { phone: '+916383935822' },
      threadId: 'thread_existing',
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
    };

    const result = await executePublishedFlow({
      runId: 'run_bind_reuse',
      flowId: 'flow_bind_reuse',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Bind thread' },
      input: payload,
      now: makeClock(
        '2026-04-21T12:00:00.000Z',
        '2026-04-21T12:00:01.000Z',
        '2026-04-21T12:00:02.000Z',
        '2026-04-21T12:00:03.000Z',
        '2026-04-21T12:00:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'bind',
          type: 'context.thread-bind',
          position: { x: 160, y: 0 },
          data: { label: 'Bind thread', bindingKey: 'customer.phone', strategy: 'reuse' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'bind',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      threadId: 'thread_existing',
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
      threadBinding: {
        key: 'customer.phone',
        value: '+916383935822',
        strategy: 'reuse',
        reused: true,
      },
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
  });

  it('binds thread context by creating a new session when missing', async () => {
    const payload = {
      customer: { phone: '+916383935822' },
      channelType: 'whatsapp',
      agentId: 'main',
    };

    const result = await executePublishedFlow({
      runId: 'run_bind_create',
      flowId: 'flow_bind_create',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Bind thread' },
      input: payload,
      now: makeClock(
        '2026-04-21T12:10:00.000Z',
        '2026-04-21T12:10:01.000Z',
        '2026-04-21T12:10:02.000Z',
        '2026-04-21T12:10:03.000Z',
        '2026-04-21T12:10:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'bind',
          type: 'context.thread-bind',
          position: { x: 160, y: 0 },
          data: { label: 'Bind thread', bindingKey: 'customer.phone', strategy: 'create' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'bind',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      threadId: '+916383935822',
      sessionKey: 'agent:main:whatsapp:bound:916383935822',
      threadBinding: {
        key: 'customer.phone',
        value: '+916383935822',
        strategy: 'create',
        reused: false,
      },
    });
  });

  it('writes session memory and exposes it to downstream nodes', async () => {
    const payload = {
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
      intent: 'refund',
    };

    const result = await executePublishedFlow({
      runId: 'run_memory_session',
      flowId: 'flow_memory_session',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Write memory' },
      input: payload,
      now: makeClock(
        '2026-04-21T12:20:00.000Z',
        '2026-04-21T12:20:01.000Z',
        '2026-04-21T12:20:02.000Z',
        '2026-04-21T12:20:03.000Z',
        '2026-04-21T12:20:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'memory',
          type: 'context.memory-write',
          position: { x: 160, y: 0 },
          data: {
            label: 'Store intent',
            namespace: 'session',
            key: 'customer.intent',
            valueTemplate: '{{intent}}',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'memory',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
      memory: {
        session: {
          customer: {
            intent: 'refund',
          },
        },
      },
      memoryWrite: {
        namespace: 'session',
        scopeId: 'agent:main:whatsapp:direct:916383935822',
        key: 'customer.intent',
        value: 'refund',
      },
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
  });

  it('writes structured values into flow memory when the template resolves to an object', async () => {
    const payload = {
      customer: {
        id: 'cust_42',
        plan: 'gold',
      },
    };

    const result = await executePublishedFlow({
      runId: 'run_memory_flow',
      flowId: 'flow_memory_flow',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Write memory' },
      input: payload,
      now: makeClock(
        '2026-04-21T12:30:00.000Z',
        '2026-04-21T12:30:01.000Z',
        '2026-04-21T12:30:02.000Z',
        '2026-04-21T12:30:03.000Z',
        '2026-04-21T12:30:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'memory',
          type: 'context.memory-write',
          position: { x: 160, y: 0 },
          data: {
            label: 'Store profile',
            namespace: 'memory',
            key: 'customer.profile',
            valueTemplate: '{{customer}}',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'memory',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      memory: {
        memory: {
          customer: {
            profile: {
              id: 'cust_42',
              plan: 'gold',
            },
          },
        },
      },
      memoryWrite: {
        namespace: 'memory',
        scopeId: 'flow_memory_flow',
        key: 'customer.profile',
        value: {
          id: 'cust_42',
          plan: 'gold',
        },
      },
    });
  });

  it('queries hydrated memory and returns matching entries to downstream steps', async () => {
    const result = await executePublishedFlow({
      runId: 'run_memory_query',
      flowId: 'flow_memory_query',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Query memory' },
      input: {
        sessionKey: 'session_42',
        memory: {
          session: {
            customer: {
              intent: 'refund',
              sentiment: 'frustrated',
            },
          },
          memory: {
            customer: {
              tier: 'gold',
            },
          },
        },
      },
      now: makeClock(
        '2026-04-21T12:40:00.000Z',
        '2026-04-21T12:40:01.000Z',
        '2026-04-21T12:40:02.000Z',
        '2026-04-21T12:40:03.000Z',
        '2026-04-21T12:40:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'query',
          type: 'context.memory-query',
          position: { x: 160, y: 0 },
          data: {
            label: 'Find refund memory',
            namespace: 'session',
            query: 'refund',
            limit: '5',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'query',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      memoryQuery: {
        namespace: 'session',
        query: 'refund',
        limit: 5,
        totalMatches: 1,
        matches: [
          {
            namespace: 'session',
            scopeId: 'session_42',
            key: 'customer.intent',
            value: 'refund',
          },
        ],
      },
    });
  });

  it('captures a node-scoped usage snapshot with observed token metrics when present', async () => {
    const payload = {
      message: 'Customer says order 42 needs a refund',
      replyText: 'Refund request acknowledged',
      previewItems: [
        { role: 'user', text: 'Customer says order 42 needs a refund' },
        { role: 'assistant', text: 'Refund request acknowledged' },
      ],
      usage: {
        promptTokens: 24,
        completionTokens: 11,
        totalTokens: 35,
        costUsd: 0.0021,
      },
    };

    const result = await executePublishedFlow({
      runId: 'run_usage_node',
      flowId: 'flow_usage_node',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Usage snapshot' },
      input: payload,
      now: makeClock(
        '2026-04-21T12:40:00.000Z',
        '2026-04-21T12:40:01.000Z',
        '2026-04-21T12:40:02.000Z',
        '2026-04-21T12:40:03.000Z',
        '2026-04-21T12:40:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'usage',
          type: 'ops.usage',
          position: { x: 160, y: 0 },
          data: { label: 'Usage snapshot', metricScope: 'node' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'usage',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      usageSnapshot: {
        nodeId: 'usage',
        metricScope: 'node',
        source: 'payload',
        previewItemCount: 2,
        messageCharacters: 'Customer says order 42 needs a refund'.length,
        replyTextCharacters: 'Refund request acknowledged'.length,
        observedPromptTokens: 24,
        observedCompletionTokens: 11,
        observedTotalTokens: 35,
        observedCostUsd: 0.0021,
      },
      usage: {
        current: {
          nodeId: 'usage',
        },
        byNode: {
          usage: {
            nodeId: 'usage',
          },
        },
        run: {
          nodeCount: 1,
          observedTotalTokens: 35,
        },
      },
    });
  });

  it('captures a cumulative run usage snapshot across multiple usage nodes', async () => {
    const payload = {
      gatewayRunId: 'gw_run_usage',
      agentId: 'main',
      message: 'Refund order 42',
      replyText: 'Refund approved',
      previewItems: [{ role: 'assistant', text: 'Refund approved' }],
    };

    const result = await executePublishedFlow({
      runId: 'run_usage_run',
      flowId: 'flow_usage_run',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Usage snapshot' },
      input: payload,
      now: makeClock(
        '2026-04-21T12:50:00.000Z',
        '2026-04-21T12:50:01.000Z',
        '2026-04-21T12:50:02.000Z',
        '2026-04-21T12:50:03.000Z',
        '2026-04-21T12:50:04.000Z',
        '2026-04-21T12:50:05.000Z',
        '2026-04-21T12:50:06.000Z',
        '2026-04-21T12:50:07.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'usage_node',
          type: 'ops.usage',
          position: { x: 160, y: 0 },
          data: { label: 'Node usage', metricScope: 'node' },
        },
        {
          id: 'usage_run',
          type: 'ops.usage',
          position: { x: 320, y: 0 },
          data: { label: 'Run usage', metricScope: 'run' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'usage_node',
          targetPort: 'in',
        },
        {
          id: 'e2',
          source: 'usage_node',
          sourcePort: 'out',
          target: 'usage_run',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      usageSnapshot: {
        nodeCount: 2,
      },
      usage: {
        run: {
          nodeCount: 2,
          previewItemCount: 2,
          messageCharacters: 'Refund order 42'.length * 2,
          replyTextCharacters: 'Refund approved'.length * 2,
        },
        byNode: {
          usage_node: {
            source: 'agent',
          },
          usage_run: {
            source: 'agent',
          },
        },
      },
    });
  });

  it('executes an OpenClaw skill node and carries its output forward', async () => {
    const executeSkillNode = vi.fn(async ({ nodeInput }) => ({
      output: {
        skillName: 'finance/refund-triage',
        commandName: 'refund_triage',
        gatewayRunId: 'client_run_2',
        sessionKey: 'skill:main:refund_triage:flow:flow_6:run:run_6:node:skill',
        status: 'ok' as const,
        replyText: 'finance',
      },
      result: {
        commandName: 'refund_triage',
        replyText: 'finance',
      },
      logs: [
        {
          level: 'info' as const,
          message: 'Skill "finance/refund-triage" completed via OpenClaw',
          data: { observedInput: nodeInput },
        },
      ],
    }));

    const payload = { message: 'Please refund order 42' };
    const result = await executePublishedFlow({
      runId: 'run_6',
      flowId: 'flow_6',
      flowVersion: 7,
      trigger: { type: 'webhook', eventName: 'customer.message.received' },
      input: payload,
      executeSkillNode,
      now: makeClock(
        '2026-04-18T15:00:00.000Z',
        '2026-04-18T15:00:01.000Z',
        '2026-04-18T15:00:02.000Z',
        '2026-04-18T15:00:03.000Z',
        '2026-04-18T15:00:04.000Z',
        '2026-04-18T15:00:05.000Z',
        '2026-04-18T15:00:06.000Z',
        '2026-04-18T15:00:07.000Z',
        '2026-04-18T15:00:08.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook', eventName: 'customer.message.received' },
        },
        {
          id: 'skill',
          type: 'action.skill',
          position: { x: 160, y: 0 },
          data: {
            label: 'Run refund skill',
            skillName: 'finance/refund-triage',
          },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 320, y: 0 },
          data: { label: 'Log result', includeInput: false, message: 'Skill finished' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'skill',
          targetPort: 'in',
        },
        {
          id: 'e2',
          source: 'skill',
          sourcePort: 'out',
          target: 'log',
          targetPort: 'in',
        },
      ],
    });

    expect(executeSkillNode).toHaveBeenCalledWith({
      runId: 'run_6',
      flowId: 'flow_6',
      flowVersion: 7,
      node: expect.objectContaining({ id: 'skill', type: 'action.skill' }),
      nodeInput: payload,
    });
    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      skillName: 'finance/refund-triage',
      commandName: 'refund_triage',
      gatewayRunId: 'client_run_2',
      replyText: 'finance',
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
    expect(result.events[3]?.event).toMatchObject({
      type: 'run.log',
      nodeId: 'skill',
      level: 'info',
      message: 'Skill "finance/refund-triage" completed via OpenClaw',
    });
  });

  it('executes an agent handoff node and carries its delegated output forward', async () => {
    const executeAgentSendNode = vi.fn(async ({ nodeInput }) => ({
      output: {
        targetAgent: 'finance',
        gatewayRunId: 'gw_handoff_1',
        sessionKey: 'agent:finance:flow:flow_6b:run:run_6b:node:handoff',
        status: 'ok' as const,
        handoffReason: 'Refund request needs finance review.',
        replyText: 'Finance agent accepted the handoff.',
        input: nodeInput,
      },
      result: {
        gatewayRunId: 'gw_handoff_1',
        replyText: 'Finance agent accepted the handoff.',
      },
      logs: [
        {
          level: 'info' as const,
          message: 'Delegated to agent "finance" via OpenClaw',
          data: { observedInput: nodeInput },
        },
      ],
    }));

    const payload = { orderId: '42', message: 'Customer wants a refund' };
    const result = await executePublishedFlow({
      runId: 'run_6b',
      flowId: 'flow_6b',
      flowVersion: 8,
      trigger: { type: 'webhook', eventName: 'customer.message.received' },
      input: payload,
      executeAgentSendNode,
      now: makeClock(
        '2026-04-18T15:30:00.000Z',
        '2026-04-18T15:30:01.000Z',
        '2026-04-18T15:30:02.000Z',
        '2026-04-18T15:30:03.000Z',
        '2026-04-18T15:30:04.000Z',
        '2026-04-18T15:30:05.000Z',
        '2026-04-18T15:30:06.000Z',
        '2026-04-18T15:30:07.000Z',
        '2026-04-18T15:30:08.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook', eventName: 'customer.message.received' },
        },
        {
          id: 'handoff',
          type: 'action.agent-send',
          position: { x: 160, y: 0 },
          data: {
            label: 'Send to finance',
            targetAgent: 'finance',
            handoffReason: 'Refund request needs finance review.',
          },
        },
        {
          id: 'log',
          type: 'action.log',
          position: { x: 320, y: 0 },
          data: { label: 'Log result', includeInput: false, message: 'Handoff finished' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'handoff',
          targetPort: 'in',
        },
        {
          id: 'e2',
          source: 'handoff',
          sourcePort: 'out',
          target: 'log',
          targetPort: 'in',
        },
      ],
    });

    expect(executeAgentSendNode).toHaveBeenCalledWith({
      runId: 'run_6b',
      flowId: 'flow_6b',
      flowVersion: 8,
      node: expect.objectContaining({ id: 'handoff', type: 'action.agent-send' }),
      nodeInput: payload,
    });
    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      targetAgent: 'finance',
      gatewayRunId: 'gw_handoff_1',
      replyText: 'Finance agent accepted the handoff.',
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.delegated',
      'run.log',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
    expect(result.events[3]?.event).toMatchObject({
      type: 'run.delegated',
      nodeId: 'handoff',
      delegationKind: 'agent-send',
      targetAgent: 'finance',
      sessionKey: 'agent:finance:flow:flow_6b:run:run_6b:node:handoff',
      gatewayRunId: 'gw_handoff_1',
      handoffReason: 'Refund request needs finance review.',
    });
    expect(result.events[4]?.event).toMatchObject({
      type: 'run.log',
      nodeId: 'handoff',
      level: 'info',
      message: 'Delegated to agent "finance" via OpenClaw',
    });
    expect(result.delegatedRuns).toEqual([
      expect.objectContaining({
        parentRunId: 'run_6b',
        parentNodeId: 'handoff',
        delegationKind: 'agent-send',
        depth: 1,
        targetAgent: 'finance',
        sessionKey: 'agent:finance:flow:flow_6b:run:run_6b:node:handoff',
        gatewayRunId: 'gw_handoff_1',
        handoffReason: 'Refund request needs finance review.',
        status: 'succeeded',
      }),
    ]);
  });

  it('blocks nested agent handoffs beyond the configured delegation depth', async () => {
    const payload = {
      delegationDepth: 1,
      customerId: 'cust_nested',
      message: 'Escalate to a deeper specialist',
    };

    const result = await executePublishedFlow({
      runId: 'run_depth_limit',
      flowId: 'flow_depth_limit',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Depth limit' },
      input: payload,
      now: makeClock(
        '2026-04-25T11:00:00.000Z',
        '2026-04-25T11:00:01.000Z',
        '2026-04-25T11:00:02.000Z',
        '2026-04-25T11:00:03.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'handoff',
          type: 'action.agent-send',
          position: { x: 160, y: 0 },
          data: {
            label: 'Nested handoff',
            targetAgent: 'finance',
            maxDelegationDepth: '1',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'handoff',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/max delegation depth/i);
    expect(result.delegatedRuns).toEqual([]);
  });

  it('executes a channel reply node and records delivery logs', async () => {
    const executeChannelReplyNode = vi.fn(async ({ nodeInput }) => ({
      output: {
        channel: 'whatsapp',
        to: '919999999999',
        messageId: 'msg_42',
        message: 'We have received your refund request.',
        input: nodeInput,
      },
      result: {
        channel: 'whatsapp',
        messageId: 'msg_42',
      },
      logs: [
        {
          level: 'info' as const,
          message: 'Channel reply delivered via "whatsapp"',
          data: { to: '919999999999', messageId: 'msg_42' },
        },
      ],
    }));

    const payload = {
      replyText: 'We have received your refund request.',
      input: {
        to: '919999999999',
        accountId: 'primary',
      },
    };
    const result = await executePublishedFlow({
      runId: 'run_7',
      flowId: 'flow_7',
      flowVersion: 8,
      trigger: { type: 'manual', label: 'Manual reply' },
      input: payload,
      executeChannelReplyNode,
      now: makeClock(
        '2026-04-18T16:00:00.000Z',
        '2026-04-18T16:00:01.000Z',
        '2026-04-18T16:00:02.000Z',
        '2026-04-18T16:00:03.000Z',
        '2026-04-18T16:00:04.000Z',
        '2026-04-18T16:00:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'reply',
          type: 'action.channel-reply',
          position: { x: 160, y: 0 },
          data: {
            label: 'Reply to customer',
            channelType: 'whatsapp',
            messageTemplate: '{{input.replyText}}',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'reply',
          targetPort: 'in',
        },
      ],
    });

    expect(executeChannelReplyNode).toHaveBeenCalledWith({
      runId: 'run_7',
      flowId: 'flow_7',
      flowVersion: 8,
      node: expect.objectContaining({ id: 'reply', type: 'action.channel-reply' }),
      nodeInput: payload,
    });
    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      channel: 'whatsapp',
      to: '919999999999',
      messageId: 'msg_42',
      message: 'We have received your refund request.',
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
    expect(result.events[3]?.event).toMatchObject({
      type: 'run.log',
      nodeId: 'reply',
      level: 'info',
      message: 'Channel reply delivered via "whatsapp"',
    });
  });

  it('executes a channel route node and records routing logs', async () => {
    const executeChannelRouteNode = vi.fn(async ({ nodeInput }) => ({
      output: {
        channel: 'telegram',
        to: '@opsdesk',
        messageId: 'msg_route_42',
        destination: 'profile_ops',
        destinationProfileName: 'Ops Desk',
        threading: 'preserve',
        message: 'Escalating to ops desk.',
        input: nodeInput,
      },
      result: {
        channel: 'telegram',
        messageId: 'msg_route_42',
      },
      logs: [
        {
          level: 'info' as const,
          message: 'Routed message via "telegram" to profile "Ops Desk"',
          data: { to: '@opsdesk', messageId: 'msg_route_42' },
        },
      ],
    }));

    const payload = {
      to: '@opsdesk',
      message: 'Escalating to ops desk.',
      accountId: 'ops_primary',
    };
    const result = await executePublishedFlow({
      runId: 'run_route_flow',
      flowId: 'flow_route_flow',
      flowVersion: 9,
      trigger: { type: 'manual', label: 'Manual route' },
      input: payload,
      executeChannelRouteNode,
      now: makeClock(
        '2026-04-21T06:00:00.000Z',
        '2026-04-21T06:00:01.000Z',
        '2026-04-21T06:00:02.000Z',
        '2026-04-21T06:00:03.000Z',
        '2026-04-21T06:00:04.000Z',
        '2026-04-21T06:00:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'route',
          type: 'action.channel-route',
          position: { x: 160, y: 0 },
          data: {
            label: 'Route to ops',
            destination: 'profile_ops',
            threading: 'preserve',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'route',
          targetPort: 'in',
        },
      ],
    });

    expect(executeChannelRouteNode).toHaveBeenCalledWith({
      runId: 'run_route_flow',
      flowId: 'flow_route_flow',
      flowVersion: 9,
      node: expect.objectContaining({ id: 'route', type: 'action.channel-route' }),
      nodeInput: payload,
    });
    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      channel: 'telegram',
      to: '@opsdesk',
      messageId: 'msg_route_42',
      destination: 'profile_ops',
      message: 'Escalating to ops desk.',
    });
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
    expect(result.events[3]?.event).toMatchObject({
      type: 'run.log',
      nodeId: 'route',
      level: 'info',
      message: 'Routed message via "telegram" to profile "Ops Desk"',
    });
  });

  it('executes an HTTP request node and carries the parsed response forward', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ orderId: '42', status: 'refunded' }), {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_42',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_http_1',
        flowId: 'flow_http_1',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { orderId: '42', token: 'secret' },
        now: makeClock(
          '2026-04-21T01:00:00.000Z',
          '2026-04-21T01:00:01.000Z',
          '2026-04-21T01:00:02.000Z',
          '2026-04-21T01:00:03.000Z',
          '2026-04-21T01:00:04.000Z',
          '2026-04-21T01:00:05.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'http',
            type: 'action.http',
            position: { x: 160, y: 0 },
            data: {
              label: 'Fetch order',
              method: 'POST',
              url: 'https://api.example.com/orders/{{input.orderId}}',
              headersTemplate: '{"Authorization":"Bearer {{token}}"}',
              bodyTemplate: '{"orderId":"{{input.orderId}}"}',
              responseMode: 'auto',
              timeoutMs: '5000',
              failOnHttpError: true,
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'http',
            targetPort: 'in',
          },
        ],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        new URL('https://api.example.com/orders/42'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer secret',
            'Content-Type': 'application/json',
          },
          body: '{"orderId":"42"}',
          signal: expect.any(AbortSignal),
        }),
      );
      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({
        ok: true,
        status: 200,
        method: 'POST',
        body: { orderId: '42', status: 'refunded' },
        json: { orderId: '42', status: 'refunded' },
        request: {
          method: 'POST',
          url: 'https://api.example.com/orders/42',
          headers: {
            Authorization: 'Bearer secret',
            'Content-Type': 'application/json',
          },
          body: { orderId: '42' },
        },
      });
      expect(result.events.map((event) => event.eventType)).toEqual([
        'node.started',
        'node.finished',
        'node.started',
        'run.log',
        'node.finished',
        'run.finished',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails an HTTP request node on non-2xx responses when failOnHttpError is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('upstream unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'content-type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_http_2',
        flowId: 'flow_http_2',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { orderId: '42' },
        now: makeClock(
          '2026-04-21T02:00:00.000Z',
          '2026-04-21T02:00:01.000Z',
          '2026-04-21T02:00:02.000Z',
          '2026-04-21T02:00:03.000Z',
          '2026-04-21T02:00:04.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'http',
            type: 'action.http',
            position: { x: 160, y: 0 },
            data: {
              label: 'Call upstream',
              method: 'GET',
              url: 'https://api.example.com/orders/{{orderId}}',
              failOnHttpError: true,
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'http',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('failed');
      expect(result.error).toBe('HTTP request failed with status 503 Service Unavailable');
      expect(result.events.map((event) => event.eventType)).toEqual([
        'node.started',
        'node.finished',
        'node.started',
        'node.failed',
        'run.finished',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('executes a web search node and carries normalized results forward', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          AbstractText: 'Refunds are usually processed within 5 business days.',
          AbstractURL: 'https://example.com/refunds',
          AbstractSource: 'Example Docs',
          RelatedTopics: [
            {
              Text: 'Refund policy - Learn more about timelines and exceptions',
              FirstURL: 'https://example.com/refund-policy',
            },
          ],
        }),
        {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_search_1',
        flowId: 'flow_search_1',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { orderId: '42' },
        now: makeClock(
          '2026-04-21T03:00:00.000Z',
          '2026-04-21T03:00:01.000Z',
          '2026-04-21T03:00:02.000Z',
          '2026-04-21T03:00:03.000Z',
          '2026-04-21T03:00:04.000Z',
          '2026-04-21T03:00:05.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'search',
            type: 'tool.web-search',
            position: { x: 160, y: 0 },
            data: {
              label: 'Search refunds',
              provider: 'duckduckgo',
              query: 'refund status for order {{orderId}}',
              limit: '3',
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'search',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({
        provider: 'duckduckgo',
        query: 'refund status for order 42',
        resultCount: 2,
      });
      expect((result.output as { results?: Array<{ url: string }> }).results).toEqual([
        expect.objectContaining({ url: 'https://example.com/refunds' }),
        expect.objectContaining({ url: 'https://example.com/refund-policy' }),
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining(
            'https://api.duckduckgo.com/?q=refund+status+for+order+42&format=json',
          ),
        }),
        expect.objectContaining({
          headers: {
            Accept: 'application/json',
          },
        }),
      );
      expect(result.events.map((event) => event.eventType)).toEqual([
        'node.started',
        'node.finished',
        'node.started',
        'run.log',
        'node.finished',
        'run.finished',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('can hand a top result URL from web search directly into browser lite', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Results: [
              {
                Text: 'Refund docs - Example',
                FirstURL: 'https://example.com/refunds',
              },
            ],
            RelatedTopics: [],
          }),
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><head><title>Refund Docs</title><meta name="description" content="Refund policy details" /></head><body>Policy text</body></html>',
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/html' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_search_chain_1',
        flowId: 'flow_search_chain_1',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { topic: 'refund docs' },
        now: makeClock(
          '2026-04-21T03:10:00.000Z',
          '2026-04-21T03:10:01.000Z',
          '2026-04-21T03:10:02.000Z',
          '2026-04-21T03:10:03.000Z',
          '2026-04-21T03:10:04.000Z',
          '2026-04-21T03:10:05.000Z',
          '2026-04-21T03:10:06.000Z',
          '2026-04-21T03:10:07.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'search',
            type: 'tool.web-search',
            position: { x: 160, y: 0 },
            data: {
              label: 'Search refunds',
              provider: 'duckduckgo',
              query: '{{topic}}',
              limit: '3',
              outputMode: 'top-result-url',
            },
          },
          {
            id: 'browser',
            type: 'tool.browser',
            position: { x: 320, y: 0 },
            data: {
              label: 'Open top result',
              action: 'open',
              target: '{{input}}',
              timeoutMs: '5000',
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'search',
            targetPort: 'in',
          },
          {
            id: 'e2',
            source: 'search',
            sourcePort: 'out',
            target: 'browser',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({
        action: 'open',
        finalUrl: 'https://example.com/refunds',
        title: 'Refund Docs',
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ href: 'https://example.com/refunds' }),
        expect.objectContaining({
          headers: {
            Accept: 'text/html,application/xhtml+xml',
          },
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails a web search node when the selected provider is not configured', async () => {
    const originalKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = undefined;

    try {
      const result = await executePublishedFlow({
        runId: 'run_search_2',
        flowId: 'flow_search_2',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { topic: 'refund policy' },
        now: makeClock(
          '2026-04-21T04:00:00.000Z',
          '2026-04-21T04:00:01.000Z',
          '2026-04-21T04:00:02.000Z',
          '2026-04-21T04:00:03.000Z',
          '2026-04-21T04:00:04.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'search',
            type: 'tool.web-search',
            position: { x: 160, y: 0 },
            data: {
              label: 'Search with Brave',
              provider: 'brave',
              query: '{{topic}}',
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'search',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('failed');
      expect(result.error).toBe(
        'web search provider "brave" requires BRAVE_API_KEY in the adapter environment.',
      );
      expect(result.events.map((event) => event.eventType)).toEqual([
        'node.started',
        'node.finished',
        'node.started',
        'node.failed',
        'run.finished',
      ]);
    } finally {
      if (originalKey) {
        process.env.BRAVE_API_KEY = originalKey;
      } else {
        process.env.BRAVE_API_KEY = undefined;
      }
    }
  });

  it('executes an exec node and carries stdout forward', async () => {
    const command = process.platform === 'win32' ? "Write-Output 'exec-ok'" : "printf 'exec-ok\\n'";

    const result = await executePublishedFlow({
      runId: 'run_exec_1',
      flowId: 'flow_exec_1',
      flowVersion: 1,
      trigger: { type: 'webhook' },
      input: { topic: 'refund' },
      now: makeClock(
        '2026-04-21T05:00:00.000Z',
        '2026-04-21T05:00:01.000Z',
        '2026-04-21T05:00:02.000Z',
        '2026-04-21T05:00:03.000Z',
        '2026-04-21T05:00:04.000Z',
        '2026-04-21T05:00:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'exec',
          type: 'tool.exec',
          position: { x: 160, y: 0 },
          data: {
            label: 'Run command',
            command,
            approvalMode: 'trusted',
            timeoutMs: '5000',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'exec',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({
      ok: true,
      approvalMode: 'trusted',
      exitCode: 0,
    });
    expect((result.output as { stdout?: string }).stdout?.trim()).toBe('exec-ok');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
  });

  it('suspends an ask-mode exec node until approval is granted', async () => {
    const command = process.platform === 'win32' ? "Write-Output 'exec-ok'" : "printf 'exec-ok\\n'";

    const result = await executePublishedFlow({
      runId: 'run_exec_approval_1',
      flowId: 'flow_exec_approval_1',
      flowVersion: 1,
      trigger: { type: 'webhook' },
      input: { topic: 'refund' },
      now: makeClock(
        '2026-04-21T05:10:00.000Z',
        '2026-04-21T05:10:01.000Z',
        '2026-04-21T05:10:02.000Z',
        '2026-04-21T05:10:03.000Z',
        '2026-04-21T05:10:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'exec',
          type: 'tool.exec',
          position: { x: 160, y: 0 },
          data: {
            label: 'Run command',
            command,
            approvalMode: 'ask',
            approvalTimeoutSeconds: '120',
            timeoutMs: '5000',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'exec',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('waiting');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'run.log',
      'run.approval.requested',
      'run.waiting',
    ]);
    expect(result.continuation).toMatchObject({
      queue: [],
      visitedNodeIds: ['trigger'],
      waiting: {
        kind: 'approval',
        requestType: 'exec',
        nodeId: 'exec',
        approvalMode: 'ask',
        command,
        timeoutSeconds: 120,
      },
    });
    expect(result.continuation?.waiting?.kind).toBe('approval');
    if (result.continuation?.waiting?.kind === 'approval') {
      expect(result.continuation.waiting.approvedQueue[0]).toMatchObject({
        nodeId: 'exec',
        execApproval: {
          nodeId: 'exec',
          command,
          approvalMode: 'ask',
        },
      });
    }
  });

  it('resumes an approved exec node and executes the command', async () => {
    const command = process.platform === 'win32' ? "Write-Output 'exec-ok'" : "printf 'exec-ok\\n'";

    const result = await executePublishedFlow({
      runId: 'run_exec_approval_2',
      flowId: 'flow_exec_approval_2',
      flowVersion: 1,
      trigger: { type: 'webhook' },
      input: { topic: 'refund' },
      resumeState: {
        queue: [
          {
            nodeId: 'exec',
            input: { topic: 'refund' },
            execApproval: {
              nodeId: 'exec',
              command,
              approvalMode: 'ask',
            },
          },
        ],
        visitedNodeIds: ['trigger'],
        lastOutput: { topic: 'refund' },
      },
      now: makeClock(
        '2026-04-21T05:12:00.000Z',
        '2026-04-21T05:12:01.000Z',
        '2026-04-21T05:12:02.000Z',
        '2026-04-21T05:12:03.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'exec',
          type: 'tool.exec',
          position: { x: 160, y: 0 },
          data: {
            label: 'Run command',
            command,
            approvalMode: 'ask',
            timeoutMs: '5000',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'exec',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect((result.output as { stdout?: string }).stdout?.trim()).toBe('exec-ok');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'run.log',
      'node.finished',
      'run.finished',
    ]);
  });

  it('fails an exec node when the command exits non-zero', async () => {
    const command =
      process.platform === 'win32'
        ? "Write-Error 'exec boom'; exit 7"
        : "echo 'exec boom' 1>&2; exit 7";

    const result = await executePublishedFlow({
      runId: 'run_exec_2',
      flowId: 'flow_exec_2',
      flowVersion: 1,
      trigger: { type: 'webhook' },
      input: { topic: 'refund' },
      now: makeClock(
        '2026-04-21T06:00:00.000Z',
        '2026-04-21T06:00:01.000Z',
        '2026-04-21T06:00:02.000Z',
        '2026-04-21T06:00:03.000Z',
        '2026-04-21T06:00:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'exec',
          type: 'tool.exec',
          position: { x: 160, y: 0 },
          data: {
            label: 'Run failing command',
            command,
            approvalMode: 'trusted',
            timeoutMs: '5000',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'exec',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('exec command failed with exit code 7');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'node.failed',
      'run.finished',
    ]);
  });

  it('supports fan-in by allowing different branches to converge on the same node', async () => {
    const payload = { customerId: 'cust_fanin_1' };

    const result = await executePublishedFlow({
      runId: 'run_fanin_1',
      flowId: 'flow_fanin_1',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      now: makeClock(
        '2026-04-26T09:00:00.000Z',
        '2026-04-26T09:00:01.000Z',
        '2026-04-26T09:00:02.000Z',
        '2026-04-26T09:00:03.000Z',
        '2026-04-26T09:00:04.000Z',
        '2026-04-26T09:00:05.000Z',
        '2026-04-26T09:00:06.000Z',
        '2026-04-26T09:00:07.000Z',
        '2026-04-26T09:00:08.000Z',
        '2026-04-26T09:00:09.000Z',
        '2026-04-26T09:00:10.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'left',
          type: 'tool.payload-template',
          position: { x: 160, y: -40 },
          data: { label: 'Left branch', template: '{{input}}', outputMode: 'replace' },
        },
        {
          id: 'right',
          type: 'tool.payload-template',
          position: { x: 160, y: 40 },
          data: { label: 'Right branch', template: '{{input}}', outputMode: 'replace' },
        },
        {
          id: 'join',
          type: 'tool.payload-template',
          position: { x: 320, y: 0 },
          data: { label: 'Join', template: '{{input}}', outputMode: 'replace' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourcePort: 'out', target: 'left', targetPort: 'in' },
        { id: 'e2', source: 'trigger', sourcePort: 'out', target: 'right', targetPort: 'in' },
        { id: 'e3', source: 'left', sourcePort: 'out', target: 'join', targetPort: 'in' },
        { id: 'e4', source: 'right', sourcePort: 'out', target: 'join', targetPort: 'in' },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual(payload);

    const joinStarts = result.events.filter(
      (event) =>
        event.eventType === 'node.started' &&
        event.event.type === 'node.started' &&
        event.event.nodeId === 'join',
    );
    const joinFinishes = result.events.filter(
      (event) =>
        event.eventType === 'node.finished' &&
        event.event.type === 'node.finished' &&
        event.event.nodeId === 'join',
    );

    expect(joinStarts).toHaveLength(2);
    expect(joinFinishes).toHaveLength(2);
  });

  it('still fails when a branch re-enters the same execution path in a cycle', async () => {
    const payload = { customerId: 'cust_cycle_1' };

    const result = await executePublishedFlow({
      runId: 'run_cycle_1',
      flowId: 'flow_cycle_1',
      flowVersion: 1,
      trigger: { type: 'webhook', label: 'Inbound webhook' },
      input: payload,
      now: makeClock(
        '2026-04-26T09:10:00.000Z',
        '2026-04-26T09:10:01.000Z',
        '2026-04-26T09:10:02.000Z',
        '2026-04-26T09:10:03.000Z',
        '2026-04-26T09:10:04.000Z',
        '2026-04-26T09:10:05.000Z',
        '2026-04-26T09:10:06.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'a',
          type: 'tool.payload-template',
          position: { x: 160, y: 0 },
          data: { label: 'A', template: '{{input}}', outputMode: 'replace' },
        },
        {
          id: 'b',
          type: 'tool.payload-template',
          position: { x: 320, y: 0 },
          data: { label: 'B', template: '{{input}}', outputMode: 'replace' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourcePort: 'out', target: 'a', targetPort: 'in' },
        { id: 'e2', source: 'a', sourcePort: 'out', target: 'b', targetPort: 'in' },
        { id: 'e3', source: 'b', sourcePort: 'out', target: 'a', targetPort: 'in' },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('re-enter the same execution path');

    const aStarts = result.events.filter(
      (event) =>
        event.eventType === 'node.started' &&
        event.event.type === 'node.started' &&
        event.event.nodeId === 'a',
    );
    expect(aStarts).toHaveLength(1);
  });

  it('executes a browser open node and extracts page metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><head><title>Refund Policy</title><meta name="description" content="Refund policy details"></head><body><a href="/docs">Docs</a><p>Refunds take 5 days.</p></body></html>',
        {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'text/html',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_browser_1',
        flowId: 'flow_browser_1',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { pageUrl: 'https://example.com/refunds' },
        now: makeClock(
          '2026-04-21T07:00:00.000Z',
          '2026-04-21T07:00:01.000Z',
          '2026-04-21T07:00:02.000Z',
          '2026-04-21T07:00:03.000Z',
          '2026-04-21T07:00:04.000Z',
          '2026-04-21T07:00:05.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'browser',
            type: 'tool.browser',
            position: { x: 160, y: 0 },
            data: {
              label: 'Open page',
              action: 'open',
              target: '{{pageUrl}}',
              timeoutMs: '5000',
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'browser',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({
        action: 'open',
        title: 'Refund Policy',
        description: 'Refund policy details',
        status: 200,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({ href: 'https://example.com/refunds' }),
        expect.objectContaining({
          headers: {
            Accept: 'text/html,application/xhtml+xml',
          },
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('executes a browser click node and follows the matching link', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<html><head><title>Home</title></head><body><a href="/docs/refunds">Refund docs</a></body></html>',
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/html' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><head><title>Refund Docs</title></head><body>Policy text</body></html>',
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/html' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_browser_2',
        flowId: 'flow_browser_2',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { pageUrl: 'https://example.com' },
        now: makeClock(
          '2026-04-21T08:00:00.000Z',
          '2026-04-21T08:00:01.000Z',
          '2026-04-21T08:00:02.000Z',
          '2026-04-21T08:00:03.000Z',
          '2026-04-21T08:00:04.000Z',
          '2026-04-21T08:00:05.000Z',
          '2026-04-21T08:00:06.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'browser',
            type: 'tool.browser',
            position: { x: 160, y: 0 },
            data: {
              label: 'Follow docs',
              action: 'click',
              target: '{{pageUrl}}',
              clickHint: 'text:refund docs',
              timeoutMs: '5000',
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'browser',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({
        action: 'click',
        clickedTarget: 'https://example.com/docs/refunds',
        title: 'Refund Docs',
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ href: 'https://example.com/docs/refunds' }),
        expect.any(Object),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('executes a browser extract node using the explicit extract mode field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><head><title>Refund Policy</title><meta name="description" content="Refund details" /></head><body>Policy text</body></html>',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_browser_3',
        flowId: 'flow_browser_3',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { pageUrl: 'https://example.com/refunds' },
        now: makeClock(
          '2026-04-21T09:00:00.000Z',
          '2026-04-21T09:00:01.000Z',
          '2026-04-21T09:00:02.000Z',
          '2026-04-21T09:00:03.000Z',
          '2026-04-21T09:00:04.000Z',
          '2026-04-21T09:00:05.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'browser',
            type: 'tool.browser',
            position: { x: 160, y: 0 },
            data: {
              label: 'Extract description',
              action: 'extract',
              target: '{{pageUrl}}',
              extractMode: 'meta:description',
              timeoutMs: '5000',
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'browser',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({
        action: 'extract',
        extracted: 'Refund details',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('executes a browser extract node with metadata bundle mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><head><title>Refund Policy</title><meta name="description" content="Refund details" /><meta property="og:title" content="Refund OG Title" /><meta property="og:description" content="Refund OG Description" /></head><body>Policy text</body></html>',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_browser_metadata',
        flowId: 'flow_browser_metadata',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { pageUrl: 'https://example.com/refunds' },
        now: makeClock(
          '2026-04-21T09:02:00.000Z',
          '2026-04-21T09:02:01.000Z',
          '2026-04-21T09:02:02.000Z',
          '2026-04-21T09:02:03.000Z',
          '2026-04-21T09:02:04.000Z',
          '2026-04-21T09:02:05.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'browser',
            type: 'tool.browser',
            position: { x: 160, y: 0 },
            data: {
              label: 'Extract metadata',
              action: 'extract',
              target: '{{pageUrl}}',
              extractMode: 'metadata',
              timeoutMs: '5000',
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'browser',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({
        action: 'extract',
        extracted: {
          title: 'Refund Policy',
          description: 'Refund details',
          ogTitle: 'Refund OG Title',
          ogDescription: 'Refund OG Description',
          finalUrl: 'https://example.com/refunds',
          status: 200,
          statusText: 'OK',
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shapes a payload in replace mode from nested search and browser data', async () => {
    const result = await executePublishedFlow({
      runId: 'run_shape_replace',
      flowId: 'flow_shape_replace',
      flowVersion: 1,
      trigger: { type: 'webhook' },
      input: {
        topResult: {
          title: 'Refund Docs',
          url: 'https://example.com/refunds',
        },
        browser: {
          extracted: {
            description: 'Refund policy details',
          },
        },
      },
      now: makeClock(
        '2026-04-21T09:03:00.000Z',
        '2026-04-21T09:03:01.000Z',
        '2026-04-21T09:03:02.000Z',
        '2026-04-21T09:03:03.000Z',
        '2026-04-21T09:03:04.000Z',
        '2026-04-21T09:03:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'shape',
          type: 'tool.payload-template',
          position: { x: 160, y: 0 },
          data: {
            label: 'Shape handoff payload',
            outputMode: 'replace',
            template:
              '{"title":"{{topResult.title}}","url":"{{topResult.url}}","summary":"{{browser.extracted.description}}"}',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'shape',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual({
      title: 'Refund Docs',
      url: 'https://example.com/refunds',
      summary: 'Refund policy details',
    });
  });

  it('shapes a payload in assign mode and preserves the existing payload', async () => {
    const result = await executePublishedFlow({
      runId: 'run_shape_assign',
      flowId: 'flow_shape_assign',
      flowVersion: 1,
      trigger: { type: 'webhook' },
      input: {
        topResultUrl: 'https://example.com/refunds',
        customerId: 'cust_42',
      },
      now: makeClock(
        '2026-04-21T09:04:00.000Z',
        '2026-04-21T09:04:01.000Z',
        '2026-04-21T09:04:02.000Z',
        '2026-04-21T09:04:03.000Z',
        '2026-04-21T09:04:04.000Z',
        '2026-04-21T09:04:05.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'shape',
          type: 'tool.payload-template',
          position: { x: 160, y: 0 },
          data: {
            label: 'Assign browser target',
            outputMode: 'assign',
            outputPath: 'browser.targetUrl',
            template: '{{topResultUrl}}',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'shape',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('succeeded');
    expect(result.output).toEqual({
      topResultUrl: 'https://example.com/refunds',
      customerId: 'cust_42',
      browser: {
        targetUrl: 'https://example.com/refunds',
      },
    });
  });

  it('keeps browser legacy waitFor support for older click flows', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<html><body><a href="/docs/refunds">Refund docs</a></body></html>', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          '<html><head><title>Refund Docs</title></head><body>Policy text</body></html>',
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/html' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await executePublishedFlow({
        runId: 'run_browser_legacy',
        flowId: 'flow_browser_legacy',
        flowVersion: 1,
        trigger: { type: 'webhook' },
        input: { pageUrl: 'https://example.com' },
        now: makeClock(
          '2026-04-21T09:05:00.000Z',
          '2026-04-21T09:05:01.000Z',
          '2026-04-21T09:05:02.000Z',
          '2026-04-21T09:05:03.000Z',
          '2026-04-21T09:05:04.000Z',
          '2026-04-21T09:05:05.000Z',
          '2026-04-21T09:05:06.000Z',
        ),
        nodes: [
          {
            id: 'trigger',
            type: 'trigger.webhook',
            position: { x: 0, y: 0 },
            data: { label: 'Webhook' },
          },
          {
            id: 'browser',
            type: 'tool.browser',
            position: { x: 160, y: 0 },
            data: {
              label: 'Follow docs',
              action: 'click',
              target: '{{pageUrl}}',
              waitFor: 'text:refund docs',
              timeoutMs: '5000',
            },
          },
        ],
        edges: [
          {
            id: 'e1',
            source: 'trigger',
            sourcePort: 'out',
            target: 'browser',
            targetPort: 'in',
          },
        ],
      });

      expect(result.status).toBe('succeeded');
      expect(result.output).toMatchObject({
        action: 'click',
        clickedTarget: 'https://example.com/docs/refunds',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails the run when it encounters an unsupported node type', async () => {
    const result = await executePublishedFlow({
      runId: 'run_3',
      flowId: 'flow_3',
      flowVersion: 1,
      trigger: { type: 'webhook' },
      input: { customerId: 'cust_3' },
      now: makeClock(
        '2026-04-18T12:00:00.000Z',
        '2026-04-18T12:00:01.000Z',
        '2026-04-18T12:00:02.000Z',
        '2026-04-18T12:00:03.000Z',
        '2026-04-18T12:00:04.000Z',
      ),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: 'http',
          type: 'tool.unimplemented',
          position: { x: 160, y: 0 },
          data: { label: 'Browser step' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'http',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('unsupported node type: tool.unimplemented');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'node.started',
      'node.finished',
      'node.started',
      'node.failed',
      'run.finished',
    ]);
  });

  it('fails webhook execution when the incoming event does not match the trigger config', async () => {
    const result = await executePublishedFlow({
      runId: 'run_4',
      flowId: 'flow_4',
      flowVersion: 1,
      trigger: { type: 'webhook', eventName: 'refund.requested' },
      input: { customerId: 'cust_4' },
      now: makeClock('2026-04-18T13:00:00.000Z'),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { eventName: 'customer.message.received' },
        },
      ],
      edges: [],
    });

    expect(result).toMatchObject({
      status: 'failed',
      error:
        'Webhook trigger expects event "customer.message.received", but received "refund.requested".',
    });
    expect(result.events.map((event) => event.eventType)).toEqual(['run.finished']);
  });

  it('fails clearly when a channel reply template points at a missing reply field', async () => {
    const payload = {
      input: {
        to: '919999999999',
        message: 'Customer says order 42 needs a refund',
      },
      status: 'ok',
      agentId: 'main',
      previewItems: [
        {
          role: 'user',
          text: 'Workflow input JSON:\n{"to":"919999999999","message":"Customer says order 42 needs a refund"}',
        },
      ],
    };

    const result = await executePublishedFlow({
      runId: 'run_missing_reply',
      flowId: 'flow_missing_reply',
      flowVersion: 1,
      trigger: { type: 'manual', label: 'Manual run' },
      input: payload,
      now: makeClock(
        '2026-04-20T10:00:00.000Z',
        '2026-04-20T10:00:01.000Z',
        '2026-04-20T10:00:02.000Z',
        '2026-04-20T10:00:03.000Z',
      ),
      executeAgentNode: vi.fn(async () => ({
        output: payload,
        result: payload,
        logs: [],
      })),
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { label: 'Webhook' },
        },
        {
          id: 'reply',
          type: 'action.channel-reply',
          position: { x: 160, y: 0 },
          data: {
            label: 'Reply to customer',
            channelType: 'whatsapp',
            messageTemplate: '{{input.replyText}}',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'reply',
          targetPort: 'in',
        },
      ],
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('channel reply message template resolved to an empty value');
  });
});
