import type { GraphEdge, GraphNode } from './flow.js';
import type { RunTrigger } from './run.js';

export type FlowExecutionIssueCode =
  | 'missing_trigger'
  | 'multiple_triggers'
  | 'fan_in'
  | 'cycle'
  | 'missing_edge_source'
  | 'missing_edge_target';

export interface FlowExecutionIssue {
  code: FlowExecutionIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface FlowSemanticIssue {
  code:
    | 'channel_reply_missing_producer'
    | 'channel_route_missing_producer'
    | 'channel_route_missing_destination'
    | 'web_search_missing_query'
    | 'browser_missing_target'
    | 'browser_click_missing_hint'
    | 'shape_payload_missing_output_path'
    | 'exec_missing_command'
    | 'memory_write_missing_key'
    | 'invalid_cron_schedule'
    | 'invalid_cron_timezone';
  message: string;
  nodeId?: string;
}

export type EntryTriggerResolution = { node: GraphNode } | { error: string };

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getConfiguredWebhookEventName(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.eventName);
}

function getConfiguredChannelType(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.channelType);
}

function getConfiguredChannelRouteKey(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.routeKey);
}

function getConfiguredChannelMessagePattern(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.messagePattern)?.toLowerCase();
}

function getConfiguredCronSchedule(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.schedule);
}

function getConfiguredCronTimezone(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.timezone);
}

function getConfiguredHookName(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.hookName);
}

function getConfiguredHookFilter(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.filter)?.toLowerCase();
}

function getConfiguredTaskType(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.taskType);
}

function getConfiguredTaskQueue(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.taskQueue);
}

function getConfiguredTaskPriority(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.taskPriority);
}

function getConfiguredStandingOrderKey(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.standingOrderKey);
}

function getConfiguredStandingOrderScope(node: GraphNode): string | undefined {
  return readNonEmptyString(node.data.standingOrderScope);
}

function getExecutableTriggerNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.filter(
    (node) =>
      node.type === 'trigger.webhook' ||
      node.type === 'trigger.channel' ||
      node.type === 'trigger.cron' ||
      node.type === 'trigger.hook' ||
      node.type === 'trigger.task' ||
      node.type === 'trigger.standing-order',
  );
}

function getTriggerNodesByType(nodes: GraphNode[], type: GraphNode['type']): GraphNode[] {
  return nodes.filter((node) => node.type === type);
}

function buildIncomingIndex(edges: GraphEdge[]): Map<string, GraphEdge[]> {
  const incoming = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const current = incoming.get(edge.target) ?? [];
    current.push(edge);
    incoming.set(edge.target, current);
  }
  return incoming;
}

function hasUpstreamReplyProducer(
  nodeId: string,
  nodesById: Map<string, GraphNode>,
  incomingByTarget: Map<string, GraphEdge[]>,
): boolean {
  const queue = [...(incomingByTarget.get(nodeId) ?? [])];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const edge = queue.shift();
    if (!edge) continue;

    const sourceId = edge.source;
    if (visited.has(sourceId)) continue;
    visited.add(sourceId);

    const sourceNode = nodesById.get(sourceId);
    if (!sourceNode) continue;

    if (
      sourceNode.type === 'action.agent' ||
      sourceNode.type === 'action.skill' ||
      sourceNode.type === 'action.agent-send'
    ) {
      return true;
    }

    queue.push(...(incomingByTarget.get(sourceId) ?? []));
  }

  return false;
}

function getPathValue(input: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return input;

  return trimmed.split('.').reduce<unknown>((current, segment) => {
    if (!segment) return current;
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, input);
}

function getStringPathValue(input: unknown, path: string): string | undefined {
  const value = getPathValue(input, path);
  return readNonEmptyString(value);
}

function getFirstStringPathValue(input: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getStringPathValue(input, path);
    if (value) return value;
  }
  return undefined;
}

function getChannelRouteKey(trigger: RunTrigger, input: unknown): string | undefined {
  return (
    readNonEmptyString(trigger.routeKey) ??
    getFirstStringPathValue(input, ['routeKey', 'input.routeKey', 'channel.routeKey'])
  );
}

function getChannelMessageText(input: unknown): string | undefined {
  return getFirstStringPathValue(input, [
    'message',
    'text',
    'body',
    'input.message',
    'input.text',
    'input.body',
    'channel.message',
    'channel.text',
  ]);
}

function getHookFilterText(input: unknown): string {
  const messageText = getFirstStringPathValue(input, [
    'message',
    'text',
    'body',
    'title',
    'summary',
    'subject',
    'input.message',
    'input.text',
    'input.body',
    'input.title',
    'input.summary',
    'input.subject',
  ]);

  if (messageText) {
    return messageText.toLowerCase();
  }

  try {
    return JSON.stringify(input).toLowerCase();
  } catch {
    return '';
  }
}

interface CronDateParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

function parseCronNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function expandCronPart(part: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  const segments = part.split(',');

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) return null;

    const [rawBase, stepRaw] = segment.split('/');
    const base = rawBase ?? '';
    const step = stepRaw === undefined ? 1 : parseCronNumber(stepRaw, 1, max - min + 1);
    if (step === null || step <= 0) return null;

    if (base === '*') {
      for (let value = min; value <= max; value += step) {
        values.add(value);
      }
      continue;
    }

    if (base.includes('-')) {
      const [startRaw, endRaw] = base.split('-');
      const start = parseCronNumber(startRaw ?? '', min, max);
      const end = parseCronNumber(endRaw ?? '', min, max);
      if (start === null || end === null || start > end) return null;
      for (let value = start; value <= end; value += step) {
        values.add(value);
      }
      continue;
    }

    const value = parseCronNumber(base, min, max);
    if (value === null) return null;
    values.add(value);
  }

  return [...values].sort((a, b) => a - b);
}

function getCronDateParts(at: Date, timezone: string): CronDateParts | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      minute: 'numeric',
      hour: 'numeric',
      day: 'numeric',
      month: 'numeric',
      weekday: 'short',
      hour12: false,
    });

    const parts = formatter.formatToParts(at);
    const minute = parseCronNumber(
      parts.find((part) => part.type === 'minute')?.value ?? '',
      0,
      59,
    );
    const hour = parseCronNumber(parts.find((part) => part.type === 'hour')?.value ?? '', 0, 23);
    const dayOfMonth = parseCronNumber(
      parts.find((part) => part.type === 'day')?.value ?? '',
      1,
      31,
    );
    const month = parseCronNumber(parts.find((part) => part.type === 'month')?.value ?? '', 1, 12);
    const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value;
    const dayOfWeekMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dayOfWeek =
      weekdayLabel && weekdayLabel in dayOfWeekMap ? (dayOfWeekMap[weekdayLabel] ?? null) : null;

    if (
      minute === null ||
      hour === null ||
      dayOfMonth === null ||
      month === null ||
      dayOfWeek === null
    ) {
      return null;
    }

    return { minute, hour, dayOfMonth, month, dayOfWeek };
  } catch {
    return null;
  }
}

export function validateCronExpression(schedule: string): string | undefined {
  const trimmed = schedule.trim();
  if (!trimmed) {
    return 'Cron trigger requires a schedule.';
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return 'Cron schedule must have 5 fields: minute hour day month weekday.';
  }

  const ranges: Array<[number, number]> = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];

  for (const [index, part] of parts.entries()) {
    const [min, max] = ranges[index] ?? [0, 0];
    if (!expandCronPart(part, min, max)) {
      return `Cron field ${index + 1} is invalid in schedule "${trimmed}".`;
    }
  }

  return undefined;
}

export function isValidCronTimezone(timezone: string): boolean {
  return getCronDateParts(new Date(), timezone) !== null;
}

export function cronExpressionMatches(schedule: string, at: Date, timezone: string): boolean {
  const error = validateCronExpression(schedule);
  if (error) return false;

  const parts = schedule.trim().split(/\s+/);
  const dateParts = getCronDateParts(at, timezone);
  if (!dateParts || parts.length !== 5) return false;

  const expanded = [
    expandCronPart(parts[0] ?? '', 0, 59),
    expandCronPart(parts[1] ?? '', 0, 23),
    expandCronPart(parts[2] ?? '', 1, 31),
    expandCronPart(parts[3] ?? '', 1, 12),
    expandCronPart(parts[4] ?? '', 0, 6),
  ];

  if (expanded.some((values) => values === null)) {
    return false;
  }

  return (
    expanded[0]?.includes(dateParts.minute) === true &&
    expanded[1]?.includes(dateParts.hour) === true &&
    expanded[2]?.includes(dateParts.dayOfMonth) === true &&
    expanded[3]?.includes(dateParts.month) === true &&
    expanded[4]?.includes(dateParts.dayOfWeek) === true
  );
}

function channelTriggerMatches(node: GraphNode, trigger: RunTrigger, input: unknown): boolean {
  const configuredChannelType = getConfiguredChannelType(node);
  if (configuredChannelType && configuredChannelType !== readNonEmptyString(trigger.channel)) {
    return false;
  }

  const configuredRouteKey = getConfiguredChannelRouteKey(node);
  const requestedRouteKey = getChannelRouteKey(trigger, input);
  if (configuredRouteKey && configuredRouteKey !== requestedRouteKey) {
    return false;
  }

  const configuredMessagePattern = getConfiguredChannelMessagePattern(node);
  if (configuredMessagePattern) {
    const messageText = getChannelMessageText(input)?.toLowerCase() ?? '';
    if (!messageText.includes(configuredMessagePattern)) {
      return false;
    }
  }

  return true;
}

function cronTriggerMatches(node: GraphNode, trigger: RunTrigger): boolean {
  const configuredSchedule = getConfiguredCronSchedule(node);
  if (!configuredSchedule) {
    return false;
  }

  const configuredTimezone = getConfiguredCronTimezone(node) ?? 'UTC';
  const requestedSchedule = readNonEmptyString(trigger.schedule);
  const requestedTimezone = readNonEmptyString(trigger.timezone) ?? 'UTC';

  return configuredSchedule === requestedSchedule && configuredTimezone === requestedTimezone;
}

function hookTriggerMatches(node: GraphNode, trigger: RunTrigger, input: unknown): boolean {
  const configuredHookName = getConfiguredHookName(node);
  if (configuredHookName && configuredHookName !== readNonEmptyString(trigger.hookName)) {
    return false;
  }

  const configuredFilter = getConfiguredHookFilter(node);
  if (configuredFilter) {
    const filterText = getHookFilterText(input);
    if (!filterText.includes(configuredFilter)) {
      return false;
    }
  }

  return true;
}

function taskTriggerMatches(node: GraphNode, trigger: RunTrigger): boolean {
  const configuredTaskType = getConfiguredTaskType(node);
  if (configuredTaskType && configuredTaskType !== readNonEmptyString(trigger.taskType)) {
    return false;
  }

  const configuredTaskQueue = getConfiguredTaskQueue(node);
  if (configuredTaskQueue && configuredTaskQueue !== readNonEmptyString(trigger.taskQueue)) {
    return false;
  }

  const configuredTaskPriority = getConfiguredTaskPriority(node);
  if (
    configuredTaskPriority &&
    configuredTaskPriority !== readNonEmptyString(trigger.taskPriority)
  ) {
    return false;
  }

  return true;
}

function standingOrderTriggerMatches(node: GraphNode, trigger: RunTrigger): boolean {
  const configuredStandingOrderKey = getConfiguredStandingOrderKey(node);
  if (
    configuredStandingOrderKey &&
    configuredStandingOrderKey !== readNonEmptyString(trigger.standingOrderKey)
  ) {
    return false;
  }

  const configuredStandingOrderScope = getConfiguredStandingOrderScope(node);
  if (
    configuredStandingOrderScope &&
    configuredStandingOrderScope !== readNonEmptyString(trigger.standingOrderScope)
  ) {
    return false;
  }

  return true;
}

export function validateExecutableFlowGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
): FlowExecutionIssue[] {
  const issues: FlowExecutionIssue[] = [];
  const triggerNodes = getExecutableTriggerNodes(nodes);

  if (triggerNodes.length === 0) {
    issues.push({
      code: 'missing_trigger',
      message: 'Flow requires one supported trigger node before it can run.',
    });
  } else if (triggerNodes.length > 1) {
    issues.push({
      code: 'multiple_triggers',
      message: `Flow has ${triggerNodes.length} trigger nodes, but only one is supported right now.`,
    });
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const incomingCounts = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of edges) {
    const hasSource = nodeIds.has(edge.source);
    const hasTarget = nodeIds.has(edge.target);

    if (!hasSource) {
      issues.push({
        code: 'missing_edge_source',
        edgeId: edge.id,
        message: `Edge "${edge.id}" points to missing source node "${edge.source}".`,
      });
    }

    if (!hasTarget) {
      issues.push({
        code: 'missing_edge_target',
        edgeId: edge.id,
        message: `Edge "${edge.id}" points to missing target node "${edge.target}".`,
      });
    }

    if (!hasSource || !hasTarget) {
      continue;
    }

    adjacency.get(edge.source)?.push(edge.target);
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);
  }

  for (const node of nodes) {
    const incomingCount = incomingCounts.get(node.id) ?? 0;
    if (incomingCount > 1) {
      issues.push({
        code: 'fan_in',
        nodeId: node.id,
        message: `Node "${node.id}" has ${incomingCount} incoming edges, but fan-in is not supported yet.`,
      });
    }
  }

  const remainingIncoming = new Map(incomingCounts);
  const queue = nodes
    .filter((node) => (remainingIncoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  let visitedCount = 0;

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    visitedCount += 1;

    for (const nextId of adjacency.get(currentId) ?? []) {
      const nextIncoming = (remainingIncoming.get(nextId) ?? 0) - 1;
      remainingIncoming.set(nextId, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(nextId);
      }
    }
  }

  if (visitedCount !== nodes.length) {
    issues.push({
      code: 'cycle',
      message: 'Flow contains a cycle, but looping execution is not supported yet.',
    });
  }

  return issues;
}

export function validateFlowSemantics(nodes: GraphNode[], edges: GraphEdge[]): FlowSemanticIssue[] {
  const issues: FlowSemanticIssue[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = buildIncomingIndex(edges);

  for (const node of nodes) {
    if (node.type !== 'action.channel-reply' && node.type !== 'action.channel-route') continue;

    const messageTemplate =
      typeof node.data.messageTemplate === 'string' ? node.data.messageTemplate.trim() : '';

    if (!/\{\{\s*(?:input\.)?replyText\s*\}\}/.test(messageTemplate)) continue;
    if (hasUpstreamReplyProducer(node.id, nodesById, incomingByTarget)) continue;

    issues.push({
      code:
        node.type === 'action.channel-route'
          ? 'channel_route_missing_producer'
          : 'channel_reply_missing_producer',
      nodeId: node.id,
      message: `${
        node.type === 'action.channel-route' ? 'Channel Route' : 'Channel Reply'
      } uses {{replyText}}, but no upstream Run Agent, Run Skill, or Send To Agent step can produce that field.`,
    });
  }

  for (const node of nodes) {
    if (node.type !== 'action.channel-route') continue;

    const destination =
      typeof node.data.destination === 'string' ? node.data.destination.trim() : '';
    if (destination) continue;

    issues.push({
      code: 'channel_route_missing_destination',
      nodeId: node.id,
      message: 'Channel Route requires a destination channel profile or channel type.',
    });
  }

  for (const node of nodes) {
    if (node.type !== 'tool.web-search') continue;

    const query = typeof node.data.query === 'string' ? node.data.query.trim() : '';
    if (query) continue;

    issues.push({
      code: 'web_search_missing_query',
      nodeId: node.id,
      message: 'Web Search requires a query or template so it knows what to search for.',
    });
  }

  for (const node of nodes) {
    if (node.type !== 'tool.browser') continue;

    const target = typeof node.data.target === 'string' ? node.data.target.trim() : '';
    if (!target) {
      issues.push({
        code: 'browser_missing_target',
        nodeId: node.id,
        message: 'Browser requires a target URL.',
      });
    }

    const action = typeof node.data.action === 'string' ? node.data.action.trim() : 'open';
    const clickHint = typeof node.data.clickHint === 'string' ? node.data.clickHint.trim() : '';
    const waitFor = typeof node.data.waitFor === 'string' ? node.data.waitFor.trim() : '';
    if (action === 'click' && !clickHint && !waitFor) {
      issues.push({
        code: 'browser_click_missing_hint',
        nodeId: node.id,
        message: 'Browser click requires a link hint in the Click hint field.',
      });
    }
  }

  for (const node of nodes) {
    if (node.type !== 'tool.payload-template') continue;

    const outputMode =
      typeof node.data.outputMode === 'string' ? node.data.outputMode.trim() : 'replace';
    const outputPath = typeof node.data.outputPath === 'string' ? node.data.outputPath.trim() : '';
    if (outputMode === 'assign' && !outputPath) {
      issues.push({
        code: 'shape_payload_missing_output_path',
        nodeId: node.id,
        message: 'Shape Payload assign mode requires an output path.',
      });
    }
  }

  for (const node of nodes) {
    if (node.type !== 'tool.exec') continue;

    const command = typeof node.data.command === 'string' ? node.data.command.trim() : '';
    if (!command) {
      issues.push({
        code: 'exec_missing_command',
        nodeId: node.id,
        message: 'Exec requires a command to run.',
      });
    }
  }

  for (const node of nodes) {
    if (node.type !== 'context.memory-write') continue;

    const key = typeof node.data.key === 'string' ? node.data.key.trim() : '';
    if (key) continue;

    issues.push({
      code: 'memory_write_missing_key',
      nodeId: node.id,
      message: 'Write Memory requires a key so downstream steps can reference the stored value.',
    });
  }

  for (const node of nodes) {
    if (node.type !== 'trigger.cron') continue;

    const schedule = getConfiguredCronSchedule(node);
    const timezone = getConfiguredCronTimezone(node) ?? 'UTC';
    const scheduleError = validateCronExpression(schedule ?? '');
    if (scheduleError) {
      issues.push({
        code: 'invalid_cron_schedule',
        nodeId: node.id,
        message: scheduleError,
      });
    }

    if (!isValidCronTimezone(timezone)) {
      issues.push({
        code: 'invalid_cron_timezone',
        nodeId: node.id,
        message: `Cron timezone "${timezone}" is invalid.`,
      });
    }
  }

  return issues;
}

export function resolveExecutionEntryTrigger(
  nodes: GraphNode[],
  trigger: RunTrigger,
  input?: unknown,
): EntryTriggerResolution {
  const triggerNodes = getExecutableTriggerNodes(nodes);

  if (trigger.type === 'manual') {
    if (triggerNodes.length === 0) {
      return { error: 'No supported trigger node is available for this manual run.' };
    }
    if (triggerNodes.length > 1) {
      return { error: 'Multiple trigger nodes are not yet supported.' };
    }
    const manualTriggerNode = triggerNodes[0];
    if (!manualTriggerNode) {
      return { error: 'No supported trigger node is available for this manual run.' };
    }
    return { node: manualTriggerNode };
  }

  if (trigger.type === 'webhook') {
    const webhookTriggerNodes = getTriggerNodesByType(nodes, 'trigger.webhook');

    if (webhookTriggerNodes.length === 0) {
      return { error: 'No webhook trigger node is available for this request.' };
    }

    const requestedEventName = readNonEmptyString(trigger.eventName);
    const matchingNodes = webhookTriggerNodes.filter((node) => {
      const configuredEventName = getConfiguredWebhookEventName(node);
      if (!configuredEventName) return true;
      return configuredEventName === requestedEventName;
    });

    const matchingNode = matchingNodes[0];
    if (matchingNode && matchingNodes.length === 1) {
      return { node: matchingNode };
    }

    if (matchingNodes.length > 1) {
      return {
        error: 'Multiple webhook triggers matched this request, but only one is supported.',
      };
    }

    if (webhookTriggerNodes.length > 1) {
      return { error: 'Multiple webhook trigger nodes are not yet supported.' };
    }

    const configuredTriggerNode = webhookTriggerNodes[0];
    if (!configuredTriggerNode) {
      return { error: 'No webhook trigger node is available for this request.' };
    }

    const configuredEventName = getConfiguredWebhookEventName(configuredTriggerNode);
    if (configuredEventName) {
      if (!requestedEventName) {
        return {
          error: `Webhook trigger expects event "${configuredEventName}", but the request did not include x-openclaw-event.`,
        };
      }
      return {
        error: `Webhook trigger expects event "${configuredEventName}", but received "${requestedEventName}".`,
      };
    }

    return { error: 'No webhook trigger node is available for this request.' };
  }

  if (trigger.type === 'channel') {
    const channelTriggerNodes = getTriggerNodesByType(nodes, 'trigger.channel');

    if (channelTriggerNodes.length === 0) {
      return { error: 'No channel trigger node is available for this event.' };
    }

    const requestedChannel = readNonEmptyString(trigger.channel);
    const matchingNodes = channelTriggerNodes.filter((node) =>
      channelTriggerMatches(node, trigger, input),
    );

    const matchingNode = matchingNodes[0];
    if (matchingNode && matchingNodes.length === 1) {
      return { node: matchingNode };
    }

    if (matchingNodes.length > 1) {
      return {
        error: 'Multiple channel triggers matched this event, but only one is supported.',
      };
    }

    if (channelTriggerNodes.length > 1) {
      return { error: 'Multiple channel trigger nodes are not yet supported.' };
    }

    const configuredTriggerNode = channelTriggerNodes[0];
    if (!configuredTriggerNode) {
      return { error: 'No channel trigger node is available for this event.' };
    }

    const configuredChannelType = getConfiguredChannelType(configuredTriggerNode);
    if (configuredChannelType && configuredChannelType !== requestedChannel) {
      return {
        error: `Channel trigger expects channel "${configuredChannelType}", but received "${requestedChannel ?? 'unknown'}".`,
      };
    }

    const configuredRouteKey = getConfiguredChannelRouteKey(configuredTriggerNode);
    const requestedRouteKey = getChannelRouteKey(trigger, input);
    if (configuredRouteKey && configuredRouteKey !== requestedRouteKey) {
      return {
        error: `Channel trigger expects route "${configuredRouteKey}", but received "${requestedRouteKey ?? 'unknown'}".`,
      };
    }

    const configuredMessagePattern = getConfiguredChannelMessagePattern(configuredTriggerNode);
    if (configuredMessagePattern) {
      const messageText = getChannelMessageText(input);
      if (!messageText) {
        return {
          error: `Channel trigger expects a message containing "${configuredMessagePattern}", but no message text was present.`,
        };
      }
      return {
        error: `Channel trigger expects a message containing "${configuredMessagePattern}", but received "${messageText}".`,
      };
    }

    return { error: 'No channel trigger node is available for this event.' };
  }

  if (trigger.type === 'cron') {
    const cronTriggerNodes = getTriggerNodesByType(nodes, 'trigger.cron');

    if (cronTriggerNodes.length === 0) {
      return { error: 'No cron trigger node is available for this event.' };
    }

    const matchingNodes = cronTriggerNodes.filter((node) => cronTriggerMatches(node, trigger));
    const matchingNode = matchingNodes[0];
    if (matchingNode && matchingNodes.length === 1) {
      return { node: matchingNode };
    }

    if (matchingNodes.length > 1) {
      return {
        error: 'Multiple cron triggers matched this event, but only one is supported.',
      };
    }

    if (cronTriggerNodes.length > 1) {
      return { error: 'Multiple cron trigger nodes are not yet supported.' };
    }

    const configuredTriggerNode = cronTriggerNodes[0];
    if (!configuredTriggerNode) {
      return { error: 'No cron trigger node is available for this event.' };
    }

    const configuredSchedule = getConfiguredCronSchedule(configuredTriggerNode);
    const configuredTimezone = getConfiguredCronTimezone(configuredTriggerNode) ?? 'UTC';
    return {
      error: `Cron trigger expects schedule "${configuredSchedule ?? 'unknown'}" in timezone "${configuredTimezone}", but received "${trigger.schedule ?? 'unknown'}" in "${trigger.timezone ?? 'UTC'}".`,
    };
  }

  if (trigger.type === 'hook') {
    const hookTriggerNodes = getTriggerNodesByType(nodes, 'trigger.hook');

    if (hookTriggerNodes.length === 0) {
      return { error: 'No hook trigger node is available for this event.' };
    }

    const matchingNodes = hookTriggerNodes.filter((node) =>
      hookTriggerMatches(node, trigger, input),
    );
    const matchingNode = matchingNodes[0];
    if (matchingNode && matchingNodes.length === 1) {
      return { node: matchingNode };
    }

    if (matchingNodes.length > 1) {
      return {
        error: 'Multiple hook triggers matched this event, but only one is supported.',
      };
    }

    if (hookTriggerNodes.length > 1) {
      return { error: 'Multiple hook trigger nodes are not yet supported.' };
    }

    const configuredTriggerNode = hookTriggerNodes[0];
    if (!configuredTriggerNode) {
      return { error: 'No hook trigger node is available for this event.' };
    }

    const configuredHookName = getConfiguredHookName(configuredTriggerNode);
    const requestedHookName = readNonEmptyString(trigger.hookName);
    if (configuredHookName && configuredHookName !== requestedHookName) {
      return {
        error: `Hook trigger expects hook "${configuredHookName}", but received "${requestedHookName ?? 'unknown'}".`,
      };
    }

    const configuredFilter = getConfiguredHookFilter(configuredTriggerNode);
    if (configuredFilter) {
      const filterText = getHookFilterText(input);
      if (!filterText) {
        return {
          error: `Hook trigger expects payload text containing "${configuredFilter}", but the event payload was empty.`,
        };
      }
      return {
        error: `Hook trigger expects payload text containing "${configuredFilter}", but received "${filterText}".`,
      };
    }

    return { error: 'No hook trigger node is available for this event.' };
  }

  if (trigger.type === 'task') {
    const taskTriggerNodes = getTriggerNodesByType(nodes, 'trigger.task');

    if (taskTriggerNodes.length === 0) {
      return { error: 'No task trigger node is available for this event.' };
    }

    const matchingNodes = taskTriggerNodes.filter((node) => taskTriggerMatches(node, trigger));
    const matchingNode = matchingNodes[0];
    if (matchingNode && matchingNodes.length === 1) {
      return { node: matchingNode };
    }

    if (matchingNodes.length > 1) {
      return {
        error: 'Multiple task triggers matched this event, but only one is supported.',
      };
    }

    if (taskTriggerNodes.length > 1) {
      return { error: 'Multiple task trigger nodes are not yet supported.' };
    }

    const configuredTriggerNode = taskTriggerNodes[0];
    if (!configuredTriggerNode) {
      return { error: 'No task trigger node is available for this event.' };
    }

    const configuredTaskType = getConfiguredTaskType(configuredTriggerNode);
    const requestedTaskType = readNonEmptyString(trigger.taskType);
    if (configuredTaskType && configuredTaskType !== requestedTaskType) {
      return {
        error: `Task trigger expects task type "${configuredTaskType}", but received "${requestedTaskType ?? 'unknown'}".`,
      };
    }

    const configuredTaskQueue = getConfiguredTaskQueue(configuredTriggerNode);
    const requestedTaskQueue = readNonEmptyString(trigger.taskQueue);
    if (configuredTaskQueue && configuredTaskQueue !== requestedTaskQueue) {
      return {
        error: `Task trigger expects queue "${configuredTaskQueue}", but received "${requestedTaskQueue ?? 'unknown'}".`,
      };
    }

    const configuredTaskPriority = getConfiguredTaskPriority(configuredTriggerNode);
    const requestedTaskPriority = readNonEmptyString(trigger.taskPriority);
    if (configuredTaskPriority && configuredTaskPriority !== requestedTaskPriority) {
      return {
        error: `Task trigger expects priority "${configuredTaskPriority}", but received "${requestedTaskPriority ?? 'unknown'}".`,
      };
    }

    return { error: 'No task trigger node is available for this event.' };
  }

  if (trigger.type === 'standing-order') {
    const standingOrderTriggerNodes = getTriggerNodesByType(nodes, 'trigger.standing-order');

    if (standingOrderTriggerNodes.length === 0) {
      return { error: 'No standing-order trigger node is available for this event.' };
    }

    const matchingNodes = standingOrderTriggerNodes.filter((node) =>
      standingOrderTriggerMatches(node, trigger),
    );
    const matchingNode = matchingNodes[0];
    if (matchingNode && matchingNodes.length === 1) {
      return { node: matchingNode };
    }

    if (matchingNodes.length > 1) {
      return {
        error: 'Multiple standing-order triggers matched this event, but only one is supported.',
      };
    }

    if (standingOrderTriggerNodes.length > 1) {
      return { error: 'Multiple standing-order trigger nodes are not yet supported.' };
    }

    const configuredTriggerNode = standingOrderTriggerNodes[0];
    if (!configuredTriggerNode) {
      return { error: 'No standing-order trigger node is available for this event.' };
    }

    const configuredStandingOrderKey = getConfiguredStandingOrderKey(configuredTriggerNode);
    const requestedStandingOrderKey = readNonEmptyString(trigger.standingOrderKey);
    if (configuredStandingOrderKey && configuredStandingOrderKey !== requestedStandingOrderKey) {
      return {
        error: `Standing-order trigger expects key "${configuredStandingOrderKey}", but received "${requestedStandingOrderKey ?? 'unknown'}".`,
      };
    }

    const configuredStandingOrderScope = getConfiguredStandingOrderScope(configuredTriggerNode);
    const requestedStandingOrderScope = readNonEmptyString(trigger.standingOrderScope);
    if (
      configuredStandingOrderScope &&
      configuredStandingOrderScope !== requestedStandingOrderScope
    ) {
      return {
        error: `Standing-order trigger expects scope "${configuredStandingOrderScope}", but received "${requestedStandingOrderScope ?? 'unknown'}".`,
      };
    }

    return { error: 'No standing-order trigger node is available for this event.' };
  }

  return {
    error: `No supported trigger node found for trigger type "${trigger.type}".`,
  };
}
