import type {
  NodeAvailability,
  NodeCatalog,
  NodeCategory,
  NodeCategoryDescriptor,
  NodeConfigFieldDescriptor,
  NodeConfigVisibilityRule,
  NodeTypeDescriptor,
} from '@openclaw-wrapper/schemas';

export type NodeConfigField = NodeConfigFieldDescriptor;
export const GATEWAY_UNAVAILABLE_CAPABILITY_LABEL = 'Gateway connection currently unavailable';

const FALLBACK_AVAILABILITY: NodeAvailability = { status: 'supported' };
const FALLBACK_ACCENT = 'oklch(0.68 0.02 260)';

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  return typeof value === 'boolean' ? value : fallback;
}

function matchesVisibilityRule(
  rule: NodeConfigVisibilityRule,
  data: Record<string, unknown>,
): boolean {
  const current = data[rule.key];
  const currentString = typeof current === 'string' ? current : '';

  switch (rule.operator) {
    case 'equals':
      return currentString === (rule.value ?? '');
    case 'notEquals':
      return currentString !== (rule.value ?? '');
    case 'in':
      return (rule.values ?? []).includes(currentString);
    default:
      return true;
  }
}

function filterSummary(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

function isBlankValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0)
  );
}

type SummaryBuilder = (data: Record<string, unknown>) => string[];

const SUMMARY_BUILDERS: Record<string, SummaryBuilder> = {
  'trigger.webhook': (data) => {
    const eventName = readString(data, 'eventName');
    return filterSummary([eventName ? `event: ${eventName}` : 'accepts any JSON payload']);
  },
  'trigger.channel': (data) => {
    const channelType = readString(data, 'channelType') || 'channel';
    const routeKey = readString(data, 'routeKey');
    return filterSummary([`inbound ${channelType}`, routeKey ? `route: ${routeKey}` : '']);
  },
  'trigger.cron': (data) => {
    const schedule = readString(data, 'schedule');
    const timezone = readString(data, 'timezone');
    return filterSummary([schedule ? `cron: ${schedule}` : '', timezone ? timezone : '']);
  },
  'trigger.hook': (data) => {
    const hookName = readString(data, 'hookName');
    const filter = readString(data, 'filter');
    return filterSummary([hookName ? `hook: ${hookName}` : 'hook entrypoint', filter]);
  },
  'trigger.task': (data) => {
    const taskType = readString(data, 'taskType');
    const taskQueue = readString(data, 'taskQueue');
    const taskPriority = readString(data, 'taskPriority');
    return filterSummary([
      taskType ? `task: ${taskType}` : 'task entrypoint',
      taskQueue ? `queue: ${taskQueue}` : '',
      taskPriority ? `priority: ${taskPriority}` : '',
    ]);
  },
  'trigger.standing-order': (data) => {
    const standingOrderKey = readString(data, 'standingOrderKey');
    const standingOrderScope = readString(data, 'standingOrderScope');
    return filterSummary([
      standingOrderKey ? `order: ${standingOrderKey}` : 'standing-order entrypoint',
      standingOrderScope ? `scope: ${standingOrderScope}` : '',
    ]);
  },
  'action.agent': (data) => {
    const agentId = readString(data, 'agentId');
    const modelProvider = readString(data, 'modelProvider');
    const modelOverride = readString(data, 'modelOverride');
    const sessionKey = readString(data, 'sessionKey');
    return filterSummary([
      agentId ? `agent: ${agentId}` : 'select agent',
      modelProvider ? `provider: ${modelProvider}` : '',
      modelOverride,
      sessionKey ? `session: ${sessionKey}` : 'run-scoped session',
    ]);
  },
  'action.skill': (data) => {
    const skillName = readString(data, 'skillName');
    const agentId = readString(data, 'agentId');
    const modelProvider = readString(data, 'modelProvider');
    const modelOverride = readString(data, 'modelOverride');
    const sessionKey = readString(data, 'sessionKey');
    return filterSummary([
      skillName ? `skill: ${skillName}` : 'select skill',
      agentId ? `agent: ${agentId}` : '',
      modelProvider ? `provider: ${modelProvider}` : '',
      modelOverride,
      sessionKey ? `session: ${sessionKey}` : 'run-scoped session',
    ]);
  },
  'action.agent-send': (data) => {
    const targetAgent = readString(data, 'targetAgent');
    const sessionKey = readString(data, 'sessionKey');
    const modelProvider = readString(data, 'modelProvider');
    const modelOverride = readString(data, 'modelOverride');
    return filterSummary([
      targetAgent ? `handoff to ${targetAgent}` : 'delegate to agent',
      modelProvider ? `provider: ${modelProvider}` : '',
      modelOverride,
      sessionKey ? `session: ${sessionKey}` : 'run-scoped handoff',
    ]);
  },
  'action.http': (data) => {
    const method = readString(data, 'method') || 'GET';
    const url = readString(data, 'url');
    const responseMode = readString(data, 'responseMode');
    const timeoutMs = readString(data, 'timeoutMs');
    return filterSummary([
      `${method} ${url || '(configure URL)'}`,
      responseMode ? `parse: ${responseMode}` : '',
      timeoutMs ? `${timeoutMs}ms timeout` : '',
    ]);
  },
  'tool.browser': (data) => {
    const action = readString(data, 'action') || 'open';
    const target = readString(data, 'target');
    const extractMode = readString(data, 'extractMode') || readString(data, 'waitFor');
    const clickHint = readString(data, 'clickHint') || readString(data, 'waitFor');
    return filterSummary([
      `${action}: ${target || '(target URL)'}`,
      action === 'extract'
        ? extractMode
          ? extractMode === 'metadata'
            ? 'extract: metadata bundle'
            : `extract: ${extractMode}`
          : 'extract: text'
        : action === 'click'
          ? clickHint
            ? `click hint: ${clickHint}`
            : 'click hint required'
          : '',
    ]);
  },
  'tool.web-search': (data) => {
    const provider = readString(data, 'provider') || 'provider';
    const query = readString(data, 'query');
    const limit = readString(data, 'limit');
    const outputMode = readString(data, 'outputMode');
    return filterSummary([
      provider,
      query || 'search query',
      limit ? `${limit} results` : '',
      outputMode ? `mode: ${outputMode}` : '',
    ]);
  },
  'tool.exec': (data) => {
    const command = readString(data, 'command');
    const approvalMode = readString(data, 'approvalMode');
    const timeoutMs = readString(data, 'timeoutMs');
    return filterSummary([
      command || 'shell command',
      approvalMode
        ? approvalMode === 'elevated'
          ? 'approval: require elevated intent'
          : `approval: ${approvalMode}`
        : '',
      timeoutMs ? `${timeoutMs}ms timeout` : '',
    ]);
  },
  'tool.payload-template': (data) => {
    const outputMode = readString(data, 'outputMode') || 'replace';
    const outputPath = readString(data, 'outputPath');
    return filterSummary([
      outputMode === 'assign'
        ? outputPath
          ? `assign: ${outputPath}`
          : 'assign path required'
        : outputMode === 'merge'
          ? 'merge into payload'
          : 'replace payload',
    ]);
  },
  'action.channel-reply': (data) => {
    const channelProfileId = readString(data, 'channelProfileId');
    const channelType = readString(data, 'channelType');
    const messageTemplate = readString(data, 'messageTemplate');
    return filterSummary([
      channelProfileId
        ? `profile: ${channelProfileId.slice(0, 8)}`
        : channelType
          ? `reply via ${channelType}`
          : 'reply via gateway default',
      messageTemplate || 'compose reply',
    ]);
  },
  'action.channel-route': (data) => {
    const destination = readString(data, 'destination');
    const threading = readString(data, 'threading');
    return filterSummary([
      destination ? `route to ${destination}` : 'select destination',
      threading ? `threading: ${threading}` : '',
    ]);
  },
  'logic.branch': (data) => {
    const mode = readString(data, 'branchMode') || 'auto';
    const fieldPath = readString(data, 'fieldPath');
    const equalsValue = readString(data, 'equalsValue');
    if (mode === 'path_equals' && fieldPath) {
      return [`if ${fieldPath} == ${equalsValue || '(value)'}`];
    }
    if (mode === 'path_truthy' && fieldPath) {
      return [`if ${fieldPath} is truthy`];
    }
    return ['auto truthy detection'];
  },
  'control.approval': (data) => {
    const timeoutSeconds = readString(data, 'timeoutSeconds');
    return filterSummary(['approval required', timeoutSeconds ? `${timeoutSeconds}s timeout` : '']);
  },
  'control.wait': (data) => {
    const durationSeconds = readString(data, 'durationSeconds');
    return filterSummary([durationSeconds ? `wait ${durationSeconds}s` : 'wait']);
  },
  'context.memory-write': (data) => {
    const namespace = readString(data, 'namespace');
    const key = readString(data, 'key');
    return filterSummary([
      namespace ? `${namespace} memory` : 'write memory',
      key ? `key: ${key}` : 'set key',
    ]);
  },
  'context.memory-query': (data) => {
    const namespace = readString(data, 'namespace');
    const keyPrefix = readString(data, 'keyPrefix');
    const query = readString(data, 'query');
    return filterSummary([
      namespace ? `${namespace} memory` : 'query memory',
      keyPrefix ? `prefix: ${keyPrefix}` : '',
      query ? `query: ${query}` : '',
    ]);
  },
  'context.thread-bind': (data) => {
    const bindingKey = readString(data, 'bindingKey');
    const strategy = readString(data, 'strategy');
    return filterSummary([
      bindingKey ? `bind ${bindingKey}` : 'bind thread',
      strategy ? `strategy: ${strategy}` : '',
    ]);
  },
  'action.log': (data) => {
    const level = readString(data, 'logLevel') || 'info';
    const message = readString(data, 'message');
    const includeInput = readBoolean(data, 'includeInput', true);
    return filterSummary([
      level,
      message || 'logs incoming payload',
      includeInput ? 'with payload' : 'message only',
    ]);
  },
  'ops.usage': (data) => {
    const scope = readString(data, 'metricScope');
    return filterSummary([scope ? `scope: ${scope}` : 'usage snapshot']);
  },
};

export function getNodeType(
  catalog: NodeCatalog | null | undefined,
  type: string,
): NodeTypeDescriptor | undefined {
  return catalog?.nodes.find((nodeType) => nodeType.type === type);
}

export function getNodeCategoryDescriptor(
  catalog: NodeCatalog | null | undefined,
  category: NodeCategory,
): NodeCategoryDescriptor | undefined {
  return catalog?.categories.find((entry) => entry.key === category);
}

export function getNodeAccent(
  catalog: NodeCatalog | null | undefined,
  category: NodeCategory,
): string {
  return getNodeCategoryDescriptor(catalog, category)?.accent ?? FALLBACK_ACCENT;
}

export function getNodeDefaults(
  catalog: NodeCatalog | null | undefined,
  type: string,
): Record<string, unknown> {
  const descriptor = getNodeType(catalog, type);
  return {
    label: descriptor?.label ?? type,
    ...((descriptor?.defaults as Record<string, unknown> | undefined) ?? {}),
  };
}

export function mergeNodeDataWithDefaults<T extends Record<string, unknown>>(
  catalog: NodeCatalog | null | undefined,
  type: string,
  data: T,
): T & { nodeType: string; label: string } {
  const defaults = getNodeDefaults(catalog, type);
  const descriptor = getNodeType(catalog, type);
  const merged: Record<string, unknown> = { ...data };

  for (const [key, value] of Object.entries(defaults)) {
    if (isBlankValue(merged[key])) {
      merged[key] = value;
    }
  }

  const currentLabel =
    typeof data.label === 'string' && data.label.trim().length > 0 ? data.label : undefined;

  return {
    ...merged,
    nodeType: type,
    label:
      currentLabel ??
      (typeof merged.label === 'string' && merged.label.trim().length > 0
        ? merged.label
        : (descriptor?.label ?? type)),
  } as T & { nodeType: string; label: string };
}

export function getNodeConfigFields(
  catalog: NodeCatalog | null | undefined,
  type: string,
  data: Record<string, unknown>,
): NodeConfigField[] {
  const descriptor = getNodeType(catalog, type);
  const commonFields: NodeConfigField[] = [
    {
      key: 'label',
      label: 'Label',
      type: 'text',
      placeholder: 'Visible node label',
    },
  ];
  const descriptorFields = descriptor?.fields ?? [];
  return [...commonFields, ...descriptorFields].filter((field) =>
    (field.visibleWhen ?? []).every((rule) => matchesVisibilityRule(rule, data)),
  );
}

export function getNodeQuickConfigFields(
  catalog: NodeCatalog | null | undefined,
  type: string,
  data: Record<string, unknown>,
): NodeConfigField[] {
  return getNodeConfigFields(catalog, type, data)
    .filter((field) => field.key !== 'label' && field.type === 'select')
    .slice(0, 2);
}

export function getNodeExecutionSupport(
  catalog: NodeCatalog | null | undefined,
  type: string,
): NodeAvailability {
  return getNodeType(catalog, type)?.availability ?? FALLBACK_AVAILABILITY;
}

export function isGatewayUnavailableNodeType(
  nodeType: NodeTypeDescriptor | null | undefined,
): boolean {
  return (
    nodeType?.capabilities?.some(
      (capability) => capability.label === GATEWAY_UNAVAILABLE_CAPABILITY_LABEL,
    ) ?? false
  );
}

export function getNodeSummary(type: string, data: Record<string, unknown>): string[] {
  const builder = SUMMARY_BUILDERS[type];
  if (!builder) return [];
  return filterSummary(builder(data));
}

export function canAddNode(catalog: NodeCatalog | null | undefined, type: string): boolean {
  return getNodeExecutionSupport(catalog, type).status === 'supported';
}
