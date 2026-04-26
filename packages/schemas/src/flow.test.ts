import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  ChannelCatalog,
  ChannelPairingState,
  ChannelProfile,
  ChannelProfileTemplate,
  ChannelRuntimeStatus,
} from './channel.js';
import {
  cronExpressionMatches,
  resolveExecutionEntryTrigger,
  validateCronExpression,
  validateExecutableFlowGraph,
  validateFlowSemantics,
} from './execution.js';
import {
  DraftFlow,
  FlowGraph,
  FlowLifecycle,
  GraphEdge,
  GraphNode,
  PublishedFlowVersion,
} from './flow.js';
import { MemoryQueryInput, MemoryQueryResult, MemoryStatus } from './memory.js';
import { NodeCatalog, NodeTypeDescriptor, PortDescriptor } from './node-type.js';
import { Run, RunEvent, RunEventRecord, RunLineage } from './run.js';

describe('FlowGraph', () => {
  it('accepts a valid two-node graph', () => {
    const graph = {
      id: 'flow_1',
      name: 'Demo',
      version: 1,
      nodes: [
        { id: 'n1', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        { id: 'n2', type: 'action.log', position: { x: 200, y: 0 }, data: { level: 'info' } },
      ],
      edges: [{ id: 'e1', source: 'n1', sourcePort: 'out', target: 'n2', targetPort: 'in' }],
      createdAt: '2026-04-18T10:00:00.000Z',
      updatedAt: '2026-04-18T10:00:00.000Z',
    };
    expect(Value.Check(FlowGraph, graph)).toBe(true);
  });

  it('accepts a draft flow with publish metadata', () => {
    const draft = {
      id: 'flow_1',
      name: 'Refund triage',
      version: 3,
      publishedVersion: 2,
      nodes: [],
      edges: [],
      createdAt: '2026-04-18T10:00:00.000Z',
      updatedAt: '2026-04-18T10:05:00.000Z',
    };
    expect(Value.Check(DraftFlow, draft)).toBe(true);
  });

  it('accepts a published flow snapshot', () => {
    const published = {
      id: 'pub_1',
      flowId: 'flow_1',
      version: 2,
      name: 'Refund triage',
      nodes: [],
      edges: [],
      publishedAt: '2026-04-18T10:05:00.000Z',
    };
    expect(Value.Check(PublishedFlowVersion, published)).toBe(true);
  });

  it('accepts a flow lifecycle summary', () => {
    const lifecycle = {
      id: 'flow_1',
      name: 'Refund triage',
      draftVersion: 3,
      publishedVersion: 2,
      createdAt: '2026-04-18T10:00:00.000Z',
      updatedAt: '2026-04-18T10:05:00.000Z',
    };
    expect(Value.Check(FlowLifecycle, lifecycle)).toBe(true);
  });

  it('rejects a graph missing required edge fields', () => {
    const bad = { id: 'e1', source: 'n1', target: 'n2' };
    expect(Value.Check(GraphEdge, bad)).toBe(false);
  });

  it('rejects an empty string for node id', () => {
    const bad = { id: '', type: 't', position: { x: 0, y: 0 }, data: {} };
    expect(Value.Check(GraphNode, bad)).toBe(false);
  });

  it('reports executable graph issues for unsupported runtime shapes', () => {
    const issues = validateExecutableFlowGraph(
      [
        { id: 'trigger_a', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        { id: 'trigger_b', type: 'trigger.channel', position: { x: 0, y: 80 }, data: {} },
        { id: 'branch', type: 'logic.branch', position: { x: 160, y: 0 }, data: {} },
      ],
      [
        {
          id: 'edge_a',
          source: 'trigger_a',
          sourcePort: 'out',
          target: 'branch',
          targetPort: 'in',
        },
        {
          id: 'edge_b',
          source: 'trigger_b',
          sourcePort: 'out',
          target: 'branch',
          targetPort: 'in',
        },
        {
          id: 'edge_c',
          source: 'branch',
          sourcePort: 'true',
          target: 'trigger_a',
          targetPort: 'in',
        },
      ],
    );

    expect(issues.map((issue) => issue.code)).toEqual(['multiple_triggers', 'fan_in', 'cycle']);
  });

  it('matches webhook triggers against configured event names', () => {
    const match = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { eventName: 'customer.message.received' },
        },
      ],
      { type: 'webhook', eventName: 'customer.message.received' },
    );
    const mismatch = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.webhook',
          position: { x: 0, y: 0 },
          data: { eventName: 'customer.message.received' },
        },
      ],
      { type: 'webhook', eventName: 'refund.requested' },
    );

    expect(match).toEqual({
      node: {
        id: 'trigger_1',
        type: 'trigger.webhook',
        position: { x: 0, y: 0 },
        data: { eventName: 'customer.message.received' },
      },
    });
    expect(mismatch).toEqual({
      error:
        'Webhook trigger expects event "customer.message.received", but received "refund.requested".',
    });
  });

  it('matches channel triggers against channel, route, and message filters', () => {
    const match = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.channel',
          position: { x: 0, y: 0 },
          data: {
            channelType: 'whatsapp',
            routeKey: 'support.inbox',
            messagePattern: 'refund',
          },
        },
      ],
      {
        type: 'channel',
        channel: 'whatsapp',
        routeKey: 'support.inbox',
      },
      {
        to: '919999999999',
        message: 'Customer is asking for a refund on order 42',
      },
    );

    const routeMismatch = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.channel',
          position: { x: 0, y: 0 },
          data: {
            channelType: 'whatsapp',
            routeKey: 'support.inbox',
          },
        },
      ],
      {
        type: 'channel',
        channel: 'whatsapp',
        routeKey: 'sales.inbox',
      },
      {
        message: 'Need help with my order',
      },
    );

    const messageMismatch = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.channel',
          position: { x: 0, y: 0 },
          data: {
            channelType: 'whatsapp',
            messagePattern: 'refund',
          },
        },
      ],
      {
        type: 'channel',
        channel: 'whatsapp',
      },
      {
        message: 'Need help with delivery status',
      },
    );

    expect(match).toEqual({
      node: {
        id: 'trigger_1',
        type: 'trigger.channel',
        position: { x: 0, y: 0 },
        data: {
          channelType: 'whatsapp',
          routeKey: 'support.inbox',
          messagePattern: 'refund',
        },
      },
    });
    expect(routeMismatch).toEqual({
      error: 'Channel trigger expects route "support.inbox", but received "sales.inbox".',
    });
    expect(messageMismatch).toEqual({
      error:
        'Channel trigger expects a message containing "refund", but received "Need help with delivery status".',
    });
  });

  it('matches cron triggers against schedule and timezone', () => {
    const match = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.cron',
          position: { x: 0, y: 0 },
          data: { schedule: '0 9 * * 1-5', timezone: 'Asia/Kolkata' },
        },
      ],
      { type: 'cron', schedule: '0 9 * * 1-5', timezone: 'Asia/Kolkata' },
    );

    const mismatch = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.cron',
          position: { x: 0, y: 0 },
          data: { schedule: '0 9 * * 1-5', timezone: 'Asia/Kolkata' },
        },
      ],
      { type: 'cron', schedule: '*/15 * * * *', timezone: 'UTC' },
    );

    expect(match).toEqual({
      node: {
        id: 'trigger_1',
        type: 'trigger.cron',
        position: { x: 0, y: 0 },
        data: { schedule: '0 9 * * 1-5', timezone: 'Asia/Kolkata' },
      },
    });
    expect(mismatch).toEqual({
      error:
        'Cron trigger expects schedule "0 9 * * 1-5" in timezone "Asia/Kolkata", but received "*/15 * * * *" in "UTC".',
    });
  });

  it('matches hook triggers against hook name and payload filters', () => {
    const match = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.hook',
          position: { x: 0, y: 0 },
          data: { hookName: 'gmail.message.received', filter: 'refund' },
        },
      ],
      { type: 'hook', hookName: 'gmail.message.received' },
      {
        subject: 'Refund request for order 42',
      },
    );

    const nameMismatch = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.hook',
          position: { x: 0, y: 0 },
          data: { hookName: 'gmail.message.received' },
        },
      ],
      { type: 'hook', hookName: 'calendar.event.created' },
      {
        subject: 'Meeting invite',
      },
    );

    const filterMismatch = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.hook',
          position: { x: 0, y: 0 },
          data: { hookName: 'gmail.message.received', filter: 'refund' },
        },
      ],
      { type: 'hook', hookName: 'gmail.message.received' },
      {
        subject: 'Meeting invite',
      },
    );

    expect(match).toEqual({
      node: {
        id: 'trigger_1',
        type: 'trigger.hook',
        position: { x: 0, y: 0 },
        data: { hookName: 'gmail.message.received', filter: 'refund' },
      },
    });
    expect(nameMismatch).toEqual({
      error:
        'Hook trigger expects hook "gmail.message.received", but received "calendar.event.created".',
    });
    expect(filterMismatch).toEqual({
      error:
        'Hook trigger expects payload text containing "refund", but received "meeting invite".',
    });
  });

  it('matches task triggers against task type, queue, and priority', () => {
    const match = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.task',
          position: { x: 0, y: 0 },
          data: {
            taskType: 'inbox-triage',
            taskQueue: 'ops',
            taskPriority: 'high',
          },
        },
      ],
      {
        type: 'task',
        taskType: 'inbox-triage',
        taskQueue: 'ops',
        taskPriority: 'high',
      },
    );

    const queueMismatch = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.task',
          position: { x: 0, y: 0 },
          data: {
            taskType: 'inbox-triage',
            taskQueue: 'ops',
          },
        },
      ],
      {
        type: 'task',
        taskType: 'inbox-triage',
        taskQueue: 'finance',
      },
    );

    expect(match).toEqual({
      node: {
        id: 'trigger_1',
        type: 'trigger.task',
        position: { x: 0, y: 0 },
        data: {
          taskType: 'inbox-triage',
          taskQueue: 'ops',
          taskPriority: 'high',
        },
      },
    });
    expect(queueMismatch).toEqual({
      error: 'Task trigger expects queue "ops", but received "finance".',
    });
  });

  it('matches standing-order triggers against order key and scope', () => {
    const match = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.standing-order',
          position: { x: 0, y: 0 },
          data: {
            standingOrderKey: 'daily-inbox-triage',
            standingOrderScope: 'support',
          },
        },
      ],
      {
        type: 'standing-order',
        standingOrderKey: 'daily-inbox-triage',
        standingOrderScope: 'support',
      },
    );

    const scopeMismatch = resolveExecutionEntryTrigger(
      [
        {
          id: 'trigger_1',
          type: 'trigger.standing-order',
          position: { x: 0, y: 0 },
          data: {
            standingOrderKey: 'daily-inbox-triage',
            standingOrderScope: 'support',
          },
        },
      ],
      {
        type: 'standing-order',
        standingOrderKey: 'daily-inbox-triage',
        standingOrderScope: 'finance',
      },
    );

    expect(match).toEqual({
      node: {
        id: 'trigger_1',
        type: 'trigger.standing-order',
        position: { x: 0, y: 0 },
        data: {
          standingOrderKey: 'daily-inbox-triage',
          standingOrderScope: 'support',
        },
      },
    });
    expect(scopeMismatch).toEqual({
      error: 'Standing-order trigger expects scope "support", but received "finance".',
    });
  });

  it('reports semantic issues for channel replies that expect replyText without an upstream producer', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'reply',
          type: 'action.channel-reply',
          position: { x: 160, y: 0 },
          data: { messageTemplate: '{{replyText}}' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'reply',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'channel_reply_missing_producer',
        nodeId: 'reply',
        message:
          'Channel Reply uses {{replyText}}, but no upstream Run Agent, Run Skill, or Send To Agent step can produce that field.',
      },
    ]);
  });

  it('reports semantic issues for channel routes that are missing a destination', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'route',
          type: 'action.channel-route',
          position: { x: 160, y: 0 },
          data: {},
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'route',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'channel_route_missing_destination',
        nodeId: 'route',
        message: 'Channel Route requires a destination channel profile or channel type.',
      },
    ]);
  });

  it('reports semantic issues for channel routes that expect replyText without an upstream producer', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'route',
          type: 'action.channel-route',
          position: { x: 160, y: 0 },
          data: { destination: 'ops.inbox', messageTemplate: '{{replyText}}' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'route',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'channel_route_missing_producer',
        nodeId: 'route',
        message:
          'Channel Route uses {{replyText}}, but no upstream Run Agent, Run Skill, or Send To Agent step can produce that field.',
      },
    ]);
  });

  it('accepts replyText on channel replies when the upstream node is Send To Agent', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'handoff',
          type: 'action.agent-send',
          position: { x: 160, y: 0 },
          data: { targetAgent: 'finance' },
        },
        {
          id: 'reply',
          type: 'action.channel-reply',
          position: { x: 320, y: 0 },
          data: { messageTemplate: '{{replyText}}' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'handoff',
          targetPort: 'in',
        },
        {
          id: 'edge_2',
          source: 'handoff',
          sourcePort: 'out',
          target: 'reply',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([]);
  });

  it('reports semantic issues for invalid cron schedules and timezones', () => {
    const issues = validateFlowSemantics(
      [
        {
          id: 'cron',
          type: 'trigger.cron',
          position: { x: 0, y: 0 },
          data: { schedule: 'bad cron', timezone: 'Mars/Phobos' },
        },
      ],
      [],
    );

    expect(issues).toEqual([
      {
        code: 'invalid_cron_schedule',
        nodeId: 'cron',
        message: 'Cron schedule must have 5 fields: minute hour day month weekday.',
      },
      {
        code: 'invalid_cron_timezone',
        nodeId: 'cron',
        message: 'Cron timezone "Mars/Phobos" is invalid.',
      },
    ]);
  });

  it('reports semantic issues for memory writes that do not define a key', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'memory',
          type: 'context.memory-write',
          position: { x: 160, y: 0 },
          data: { namespace: 'session' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'memory',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'memory_write_missing_key',
        nodeId: 'memory',
        message: 'Write Memory requires a key so downstream steps can reference the stored value.',
      },
    ]);
  });

  it('reports semantic issues for web search nodes without a query', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'search',
          type: 'tool.web-search',
          position: { x: 160, y: 0 },
          data: { provider: 'duckduckgo' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'search',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'web_search_missing_query',
        nodeId: 'search',
        message: 'Web Search requires a query or template so it knows what to search for.',
      },
    ]);
  });

  it('reports semantic issues for browser nodes without a target', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'browser',
          type: 'tool.browser',
          position: { x: 160, y: 0 },
          data: { action: 'open' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'browser',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'browser_missing_target',
        nodeId: 'browser',
        message: 'Browser requires a target URL.',
      },
    ]);
  });

  it('reports semantic issues for browser click nodes without a link hint', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'browser',
          type: 'tool.browser',
          position: { x: 160, y: 0 },
          data: { action: 'click', target: 'https://example.com' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'browser',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'browser_click_missing_hint',
        nodeId: 'browser',
        message: 'Browser click requires a link hint in the Click hint field.',
      },
    ]);
  });

  it('accepts browser click nodes when a clickHint is configured', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'browser',
          type: 'tool.browser',
          position: { x: 160, y: 0 },
          data: {
            action: 'click',
            target: 'https://example.com',
            clickHint: 'text:Docs',
          },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'browser',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([]);
  });

  it('reports semantic issues for exec nodes without a command', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'exec',
          type: 'tool.exec',
          position: { x: 160, y: 0 },
          data: { approvalMode: 'trusted' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'exec',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'exec_missing_command',
        nodeId: 'exec',
        message: 'Exec requires a command to run.',
      },
    ]);
  });

  it('reports semantic issues for shape payload nodes in assign mode without an output path', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'shape',
          type: 'tool.payload-template',
          position: { x: 160, y: 0 },
          data: { template: '{{input}}', outputMode: 'assign' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'shape',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([
      {
        code: 'shape_payload_missing_output_path',
        nodeId: 'shape',
        message: 'Shape Payload assign mode requires an output path.',
      },
    ]);
  });

  it('accepts exec nodes in ask mode without requiring an upstream approval gate', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'exec',
          type: 'tool.exec',
          position: { x: 160, y: 0 },
          data: { command: 'pnpm test', approvalMode: 'ask' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'exec',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([]);
  });

  it('still accepts exec nodes in ask mode when they are downstream of an approved Approval branch', () => {
    const issues = validateFlowSemantics(
      [
        { id: 'trigger', type: 'trigger.webhook', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'approval',
          type: 'control.approval',
          position: { x: 160, y: 0 },
          data: { reason: 'Approve the refund script.' },
        },
        {
          id: 'exec',
          type: 'tool.exec',
          position: { x: 320, y: 0 },
          data: { command: 'pnpm test', approvalMode: 'ask' },
        },
      ],
      [
        {
          id: 'edge_1',
          source: 'trigger',
          sourcePort: 'out',
          target: 'approval',
          targetPort: 'in',
        },
        {
          id: 'edge_2',
          source: 'approval',
          sourcePort: 'approved',
          target: 'exec',
          targetPort: 'in',
        },
      ],
    );

    expect(issues).toEqual([]);
  });

  it('validates cron expressions and matches schedule ticks', () => {
    expect(validateCronExpression('*/15 9-17 * * 1-5')).toBeUndefined();
    expect(validateCronExpression('61 * * * *')).toBe(
      'Cron field 1 is invalid in schedule "61 * * * *".',
    );
    expect(
      cronExpressionMatches('0 9 * * 1-5', new Date('2026-04-20T03:30:00.000Z'), 'Asia/Kolkata'),
    ).toBe(true);
    expect(
      cronExpressionMatches('0 9 * * 1-5', new Date('2026-04-20T03:31:00.000Z'), 'Asia/Kolkata'),
    ).toBe(false);
  });
});

describe('ChannelProfile', () => {
  it('accepts a channel template with mixed field types', () => {
    const template = {
      id: 'telegram-bot',
      label: 'Telegram Bot',
      channelType: 'telegram',
      pairingMode: 'none',
      supportsTestSend: true,
      fields: [
        { key: 'botToken', label: 'Bot token', type: 'password', required: true },
        { key: 'defaultChatId', label: 'Default chat', type: 'text' },
      ],
    };
    expect(Value.Check(ChannelProfileTemplate, template)).toBe(true);
  });

  it('accepts runtime channel status and saved profile summaries', () => {
    const runtime = {
      channelType: 'whatsapp',
      label: 'WhatsApp',
      available: true,
      configured: true,
      connected: true,
      accounts: [{ accountId: 'default', connected: true, configured: true }],
    };
    const profile = {
      id: 'profile_1',
      name: 'Support WhatsApp',
      templateId: 'whatsapp-web',
      channelType: 'whatsapp',
      agentId: 'main',
      accountId: 'default',
      routeKey: 'support.inbox',
      defaultTarget: '+919999999999',
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z',
      config: {
        dmPolicy: 'pairing',
      },
      secretState: [{ key: 'verifyToken', configured: true, preview: '****1234' }],
      runtime,
    };

    expect(Value.Check(ChannelRuntimeStatus, runtime)).toBe(true);
    expect(Value.Check(ChannelProfile, profile)).toBe(true);
  });

  it('accepts a channel catalog and pairing state payload', () => {
    const catalog = {
      templates: [
        {
          id: 'whatsapp-web',
          label: 'WhatsApp Web',
          channelType: 'whatsapp',
          pairingMode: 'qr',
          fields: [],
        },
      ],
      runtime: [],
    };
    const pairing = {
      message: 'Scan the QR code in WhatsApp.',
      qrDataUrl: 'data:image/png;base64,abc123',
      connected: false,
    };

    expect(Value.Check(ChannelCatalog, catalog)).toBe(true);
    expect(Value.Check(ChannelPairingState, pairing)).toBe(true);
  });
});

describe('NodeTypeDescriptor', () => {
  it('accepts a descriptor with typed ports and config metadata', () => {
    const desc = {
      type: 'trigger.webhook',
      label: 'Webhook',
      category: 'triggers',
      source: 'wrapper-core',
      availability: { status: 'supported' },
      capabilities: [
        {
          label: 'HTTP entrypoint',
          detail: 'Receives JSON payloads from the adapter webhook endpoint.',
          tone: 'supported',
        },
      ],
      inputs: [],
      outputs: [{ name: 'out', label: 'Payload', dataType: 'object', required: true }],
      defaults: { eventName: '' },
      fields: [
        {
          key: 'eventName',
          label: 'Event name',
          type: 'text',
        },
      ],
    };
    expect(Value.Check(NodeTypeDescriptor, desc)).toBe(true);
  });

  it('rejects an unknown category', () => {
    const desc = {
      type: 't',
      label: 'T',
      category: 'not-a-category',
      inputs: [],
      outputs: [],
    };
    expect(Value.Check(NodeTypeDescriptor, desc)).toBe(false);
  });

  it('rejects an unknown dataType on a port', () => {
    const port = { name: 'x', label: 'X', dataType: 'uuid' };
    expect(Value.Check(PortDescriptor, port)).toBe(false);
  });

  it('accepts a node catalog shaped for registry-driven UIs', () => {
    const catalog = {
      categories: [
        {
          key: 'triggers',
          label: 'Triggers',
          accent: 'oklch(0.72 0.18 30)',
        },
      ],
      nodes: [
        {
          type: 'trigger.webhook',
          label: 'Webhook',
          category: 'triggers',
          inputs: [],
          outputs: [{ name: 'out', label: 'Payload', dataType: 'object' }],
        },
        {
          type: 'tool.refund-check',
          label: 'Refund Check',
          category: 'tools',
          source: 'external-plugin',
          inputs: [],
          outputs: [{ name: 'out', label: 'Payload', dataType: 'object' }],
        },
      ],
    };
    expect(Value.Check(NodeCatalog, catalog)).toBe(true);
  });
});

describe('Memory schemas', () => {
  it('accepts memory query input, results, and status payloads', () => {
    const input = {
      namespace: 'all',
      query: 'refund',
      limit: 10,
    };
    const result = {
      namespace: 'all',
      query: 'refund',
      limit: 10,
      totalMatches: 1,
      matches: [
        {
          namespace: 'session',
          scopeId: 'session_1',
          key: 'customer.intent',
          value: 'refund',
          score: 2,
          matchedOn: ['value'],
          updatedAt: '2026-04-22T10:00:00.000Z',
        },
      ],
    };
    const status = {
      flowId: 'flow_1',
      sessionKey: 'session_1',
      totalEntries: 2,
      countsByNamespace: {
        memory: 1,
        session: 1,
        thread: 0,
      },
      latestUpdatedAt: '2026-04-22T10:00:00.000Z',
    };

    expect(Value.Check(MemoryQueryInput, input)).toBe(true);
    expect(Value.Check(MemoryQueryResult, result)).toBe(true);
    expect(Value.Check(MemoryStatus, status)).toBe(true);
  });
});

describe('RunEvent', () => {
  it('accepts a run with trigger metadata before execution starts', () => {
    const run = {
      id: 'r1',
      flowId: 'f1',
      flowVersion: 2,
      status: 'pending',
      trigger: { type: 'webhook', label: 'Inbound lead' },
      input: { customerId: 'c1' },
      createdAt: '2026-04-18T10:00:00.000Z',
    };
    expect(Value.Check(Run, run)).toBe(true);
  });

  it('accepts a waiting run with a resume timestamp', () => {
    const run = {
      id: 'r_wait',
      flowId: 'f_wait',
      flowVersion: 2,
      status: 'waiting',
      trigger: { type: 'manual', label: 'Manual wait test' },
      input: { customerId: 'c1' },
      createdAt: '2026-04-21T10:00:00.000Z',
      startedAt: '2026-04-21T10:00:01.000Z',
      resumeAt: '2026-04-21T10:01:01.000Z',
    };
    expect(Value.Check(Run, run)).toBe(true);
  });

  it('accepts a waiting run with pending approval metadata', () => {
    const run = {
      id: 'r_approval',
      flowId: 'f_approval',
      flowVersion: 2,
      status: 'waiting',
      trigger: { type: 'manual', label: 'Manual approval test' },
      pendingApproval: {
        nodeId: 'approval_1',
        reason: 'Refund exceeds threshold',
        requestedAt: '2026-04-21T11:00:00.000Z',
        timeoutAt: '2026-04-21T11:05:00.000Z',
      },
      createdAt: '2026-04-21T10:59:00.000Z',
    };
    expect(Value.Check(Run, run)).toBe(true);
  });

  it('discriminates run.started vs node.finished by type tag', () => {
    const started = {
      type: 'run.started',
      runId: 'r1',
      flowId: 'f1',
      flowVersion: 1,
      at: '2026-04-18T10:00:00.000Z',
    };
    const finished = {
      type: 'node.finished',
      runId: 'r1',
      nodeId: 'n1',
      at: '2026-04-18T10:00:01.000Z',
      result: { ok: true },
    };
    expect(Value.Check(RunEvent, started)).toBe(true);
    expect(Value.Check(RunEvent, finished)).toBe(true);
  });

  it('accepts queued and log events in the run event stream', () => {
    const queued = {
      type: 'run.queued',
      runId: 'r1',
      flowId: 'f1',
      flowVersion: 2,
      trigger: { type: 'channel', channel: 'whatsapp' },
      at: '2026-04-18T10:00:00.000Z',
    };
    const log = {
      type: 'run.log',
      runId: 'r1',
      level: 'info',
      message: 'Agent selected refund path',
      at: '2026-04-18T10:00:01.000Z',
      nodeId: 'n1',
    };
    expect(Value.Check(RunEvent, queued)).toBe(true);
    expect(Value.Check(RunEvent, log)).toBe(true);
  });

  it('accepts waiting and resumed events in the run event stream', () => {
    const waiting = {
      type: 'run.waiting',
      runId: 'r_wait',
      nodeId: 'wait_1',
      at: '2026-04-21T10:00:30.000Z',
      resumeAt: '2026-04-21T10:01:30.000Z',
      durationSeconds: 60,
    };
    const resumed = {
      type: 'run.resumed',
      runId: 'r_wait',
      at: '2026-04-21T10:01:30.000Z',
    };
    expect(Value.Check(RunEvent, waiting)).toBe(true);
    expect(Value.Check(RunEvent, resumed)).toBe(true);
  });

  it('accepts delegated agent events in the run event stream', () => {
    const delegated = {
      type: 'run.delegated',
      runId: 'r_delegate',
      nodeId: 'handoff_1',
      at: '2026-04-25T10:01:00.000Z',
      delegationKind: 'agent-send',
      targetAgent: 'finance',
      sessionKey: 'agent:finance:flow:flow_1:run:r_delegate:node:handoff_1',
      gatewayRunId: 'gw_run_123',
      handoffReason: 'Refund request needs finance review.',
      model: 'openai/gpt-5.4-mini',
    };
    expect(Value.Check(RunEvent, delegated)).toBe(true);
  });

  it('accepts delegated child lineage records', () => {
    const lineage = {
      runId: '11111111-1111-4111-8111-111111111111',
      delegatedChildren: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          parentRunId: '11111111-1111-4111-8111-111111111111',
          parentNodeId: 'handoff_1',
          delegationKind: 'agent-send',
          depth: 1,
          targetAgent: 'finance',
          sessionKey: 'agent:finance:flow:flow_1:run:r_delegate:node:handoff_1',
          gatewayRunId: 'gw_run_123',
          handoffReason: 'Refund request needs finance review.',
          model: 'openai/gpt-5.4-mini',
          status: 'succeeded',
          replyText: 'Finance accepted the handoff.',
          createdAt: '2026-04-25T10:01:00.000Z',
          startedAt: '2026-04-25T10:01:00.000Z',
          finishedAt: '2026-04-25T10:01:05.000Z',
        },
      ],
      maxDelegationDepth: 1,
    };

    expect(Value.Check(RunLineage, lineage)).toBe(true);
  });

  it('accepts approval request and approval recorded events in the run event stream', () => {
    const requested = {
      type: 'run.approval.requested',
      runId: 'r_approval',
      nodeId: 'approval_1',
      at: '2026-04-21T11:00:00.000Z',
      reason: 'Refund exceeds threshold',
      timeoutAt: '2026-04-21T11:05:00.000Z',
    };
    const recorded = {
      type: 'run.approval.recorded',
      runId: 'r_approval',
      nodeId: 'approval_1',
      at: '2026-04-21T11:01:00.000Z',
      decision: 'approved',
      note: 'Approved by finance lead',
    };
    expect(Value.Check(RunEvent, requested)).toBe(true);
    expect(Value.Check(RunEvent, recorded)).toBe(true);
  });

  it('accepts channel trigger metadata on the run envelope', () => {
    const run = {
      id: 'r2',
      flowId: 'f2',
      flowVersion: 1,
      status: 'pending',
      trigger: {
        type: 'channel',
        channel: 'whatsapp',
        accountId: 'default',
        routeKey: 'support.inbox',
        sourceId: 'sender:+919999999999',
      },
      input: { message: 'hello' },
      createdAt: '2026-04-18T10:00:00.000Z',
    };

    expect(Value.Check(Run, run)).toBe(true);
  });

  it('accepts hook trigger metadata on the run envelope', () => {
    const run = {
      id: 'r_hook',
      flowId: 'f_hook',
      flowVersion: 1,
      status: 'pending',
      trigger: {
        type: 'hook',
        hookName: 'gmail.message.received',
        filter: 'refund',
        sourceId: 'hook:event:42',
      },
      input: { subject: 'Refund request' },
      createdAt: '2026-04-21T10:00:00.000Z',
    };

    expect(Value.Check(Run, run)).toBe(true);
  });

  it('accepts a persisted run event record envelope', () => {
    const eventRecord = {
      id: 'evt_1',
      runId: 'r1',
      sequence: 1,
      eventType: 'run.started',
      event: {
        type: 'run.started',
        runId: 'r1',
        flowId: 'f1',
        flowVersion: 2,
        at: '2026-04-18T10:00:00.000Z',
      },
      createdAt: '2026-04-18T10:00:00.000Z',
    };
    expect(Value.Check(RunEventRecord, eventRecord)).toBe(true);
  });

  it('rejects a run-finished event with an unknown status', () => {
    const bad = {
      type: 'run.finished',
      runId: 'r1',
      at: '2026-04-18T10:00:01.000Z',
      status: 'aborted',
    };
    expect(Value.Check(RunEvent, bad)).toBe(false);
  });
});
