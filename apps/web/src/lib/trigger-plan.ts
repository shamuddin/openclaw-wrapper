'use client';

import type { GraphNode } from '@openclaw-wrapper/schemas';

export type TriggerPlan = {
  kind: 'webhook' | 'channel' | 'cron' | 'hook' | 'task' | 'standing-order' | 'manual';
  eventName?: string;
  channel?: string;
  routeKey?: string;
  accountId?: string;
  schedule?: string;
  timezone?: string;
  hookName?: string;
  filter?: string;
  taskType?: string;
  taskQueue?: string;
  taskPriority?: string;
  standingOrderKey?: string;
  standingOrderScope?: string;
  payload: Record<string, unknown>;
  title: string;
  description: string;
  meta: string[];
  runLabel: string;
};

function readNodeString(node: GraphNode | undefined, key: string): string {
  const value = node?.data?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getPrimaryTriggerNode(nodes: GraphNode[]): GraphNode | undefined {
  return nodes.find((node) =>
    [
      'trigger.webhook',
      'trigger.channel',
      'trigger.cron',
      'trigger.hook',
      'trigger.task',
      'trigger.standing-order',
    ].includes(node.type),
  );
}

export function buildTriggerPlan(nodes: GraphNode[], flowName: string): TriggerPlan {
  const triggerNode = getPrimaryTriggerNode(nodes);
  const nowIso = new Date().toISOString();

  if (!triggerNode || triggerNode.type === 'trigger.webhook') {
    const eventName = readNodeString(triggerNode, 'eventName') || undefined;
    return {
      kind: 'webhook',
      eventName,
      title: 'Webhook sample',
      description: 'Runs the published webhook flow with a sample JSON body.',
      meta: [
        eventName ? `Event: ${eventName}` : 'Event: any webhook payload',
        'Trigger path: webhook',
      ],
      runLabel: 'Run webhook sample',
      payload: {
        customerId: 'cust_demo_001',
        orderId: '42',
        message: 'Customer says order 42 needs a refund',
        priority: 'normal',
        createdAt: nowIso,
      },
    };
  }

  if (triggerNode.type === 'trigger.channel') {
    const channel = readNodeString(triggerNode, 'channelType') || 'whatsapp';
    const routeKey = readNodeString(triggerNode, 'routeKey') || undefined;
    const messagePattern = readNodeString(triggerNode, 'messagePattern');
    const message = messagePattern
      ? `Customer says order 42 needs a refund ${messagePattern}`
      : 'Customer says order 42 needs a refund';
    return {
      kind: 'channel',
      channel,
      routeKey,
      accountId: 'default',
      title: 'Channel message sample',
      description: 'Runs the published channel flow with a representative inbound message.',
      meta: [`Channel: ${channel}`, routeKey ? `Route: ${routeKey}` : 'Route: any route'],
      runLabel: 'Run channel sample',
      payload: {
        channel,
        channelType: channel,
        from: 'customer:+919999999999',
        to: 'support',
        accountId: 'default',
        routeKey,
        threadId: 'thread_demo_42',
        sessionKey: `agent:main:${channel}:direct:customer-demo`,
        message,
        receivedAt: nowIso,
      },
    };
  }

  if (triggerNode.type === 'trigger.cron') {
    const schedule = readNodeString(triggerNode, 'schedule') || '0 * * * *';
    const timezone = readNodeString(triggerNode, 'timezone') || 'UTC';
    return {
      kind: 'cron',
      schedule,
      timezone,
      title: 'Cron sample',
      description: 'Runs the published cron flow with a sample scheduled event payload.',
      meta: [`Schedule: ${schedule}`, `Timezone: ${timezone}`],
      runLabel: 'Run cron sample',
      payload: { scheduledAt: nowIso, schedule, timezone, flowName },
    };
  }

  const hookName = readNodeString(triggerNode, 'hookName') || 'hook.sample.received';
  const filter = readNodeString(triggerNode, 'filter') || undefined;
  if (triggerNode.type === 'trigger.hook') {
    return {
      kind: 'hook',
      hookName,
      filter,
      title: 'Hook sample',
      description: 'Runs the published hook flow with a sample OpenClaw hook event payload.',
      meta: [filter ? `Filter: ${filter}` : 'Filter: none', `Hook: ${hookName}`],
      runLabel: 'Run hook sample',
      payload: {
        subject: filter ? `Support event ${filter}` : 'Support event received',
        body: filter
          ? `Hook payload matched ${filter} for flow ${flowName}.`
          : `Hook payload received for flow ${flowName}.`,
        source: 'inspector',
        createdAt: nowIso,
      },
    };
  }

  if (triggerNode.type === 'trigger.task') {
    const taskType = readNodeString(triggerNode, 'taskType') || 'inbox-triage';
    const taskQueue = readNodeString(triggerNode, 'taskQueue') || undefined;
    const taskPriority = readNodeString(triggerNode, 'taskPriority') || 'normal';
    return {
      kind: 'task',
      taskType,
      taskQueue,
      taskPriority,
      title: 'Task sample',
      description: 'Runs the published task flow with a representative queued work item.',
      meta: [
        `Task: ${taskType}`,
        taskQueue ? `Queue: ${taskQueue}` : 'Queue: default',
        `Priority: ${taskPriority}`,
      ],
      runLabel: 'Run task sample',
      payload: {
        taskId: 'task_demo_42',
        taskType,
        queue: taskQueue ?? 'default',
        priority: taskPriority,
        subject: `Review inbox backlog for ${flowName}`,
        instructions: 'Classify inbound messages, summarize urgent items, and escalate blockers.',
        createdAt: nowIso,
      },
    };
  }

  const standingOrderKey = readNodeString(triggerNode, 'standingOrderKey') || 'daily-inbox-triage';
  const standingOrderScope = readNodeString(triggerNode, 'standingOrderScope') || undefined;
  return {
    kind: 'standing-order',
    standingOrderKey,
    standingOrderScope,
    title: 'Standing-order sample',
    description:
      'Runs the published standing-order flow with a recurring delegate instruction payload.',
    meta: [
      `Order: ${standingOrderKey}`,
      standingOrderScope ? `Scope: ${standingOrderScope}` : 'Scope: global',
    ],
    runLabel: 'Run standing-order sample',
    payload: {
      standingOrderRunId: 'so_demo_42',
      standingOrderKey,
      scope: standingOrderScope ?? 'global',
      summary: `Execute ${standingOrderKey} for ${flowName}.`,
      instructions:
        'Check new items, apply the standing-order policy, and report outcomes with clear escalation notes.',
      scheduledAt: nowIso,
    },
  };
}
