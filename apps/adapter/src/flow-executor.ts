import { flattenMemoryState, queryMemoryEntries } from '@openclaw-wrapper/memory-sdk';
import type {
  GraphEdge,
  GraphNode,
  MemoryQueryResult,
  RunContinuationState,
  RunContinuationWaitingApproval,
  RunEvent,
  RunEventType,
  RunTrigger,
  WorkspaceExecPolicy,
} from '@openclaw-wrapper/schemas';
import { resolveExecutionEntryTrigger } from '@openclaw-wrapper/schemas';
import { runAdapterBrowser } from './browser-tool.js';
import {
  buildFlowAgentSessionKey,
  buildFlowSkillSessionKey,
  readRemoteAbortRelayLogs,
  runOpenClawAgent,
  runOpenClawSkill,
  sendOpenClawChannelReply,
} from './openclaw.js';
import { runAdapterExec } from './system-exec.js';
import { runAdapterWebSearch } from './web-search.js';
import {
  fetchTranscriptApiYouTubeTranscript,
  fetchYouTubeTranscript,
} from './youtube-transcript.js';

export interface ExecuteFlowInput {
  runId: string;
  flowId: string;
  flowVersion: number;
  trigger: RunTrigger;
  nodes: GraphNode[];
  edges: GraphEdge[];
  input?: unknown;
  now?: () => Date;
  executeAgentNode?: ExecuteAgentNode;
  executeAgentSendNode?: ExecuteAgentSendNode;
  executeSkillNode?: ExecuteSkillNode;
  executeHttpNode?: ExecuteHttpNode;
  executeBrowserNode?: ExecuteBrowserNode;
  executeWebSearchNode?: ExecuteWebSearchNode;
  executeYouTubeTranscriptNode?: ExecuteYouTubeTranscriptNode;
  executeTranscriptApiNode?: ExecuteTranscriptApiNode;
  executeShapePayloadNode?: ExecuteShapePayloadNode;
  executeExecNode?: ExecuteExecNode;
  executeChannelReplyNode?: ExecuteChannelReplyNode;
  executeChannelRouteNode?: ExecuteChannelRouteNode;
  executeThreadBindNode?: ExecuteThreadBindNode;
  executeMemoryWriteNode?: ExecuteMemoryWriteNode;
  executeMemoryQueryNode?: ExecuteMemoryQueryNode;
  resumeState?: RunContinuationState;
  execPolicy?: WorkspaceExecPolicy;
  checkCancellation?: () => Promise<boolean>;
  abortSignal?: AbortSignal;
}

export interface PendingRunEvent {
  eventType: RunEventType;
  event: RunEvent;
  createdAt: Date;
}

export interface PendingDelegatedRun {
  parentRunId: string;
  parentNodeId: string;
  delegationKind: 'agent-send';
  depth: number;
  targetAgent: string;
  sessionKey: string;
  gatewayRunId?: string;
  handoffReason?: string;
  model?: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  replyText?: string;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface ExecuteFlowResult {
  status: 'succeeded' | 'failed' | 'waiting' | 'cancelled';
  output?: unknown;
  error?: string;
  events: PendingRunEvent[];
  delegatedRuns: PendingDelegatedRun[];
  continuation?: RunContinuationState;
  resumeAt?: Date;
}

export type ExecuteAgentNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteSkillNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteAgentSendNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteHttpNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteBrowserNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteWebSearchNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteYouTubeTranscriptNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  transcriptApiKey?: string;
  transcriptApiBaseUrl?: string;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteTranscriptApiNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  transcriptApiKey?: string;
  transcriptApiBaseUrl?: string;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteExecNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  now: () => Date;
  execPolicy?: WorkspaceExecPolicy;
  execApproval?: ExecutionQueueItem['execApproval'];
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
  waitUntil?: Date;
  approvalRequest?: {
    requestType: 'control' | 'exec';
    reason?: string;
    timeoutSeconds: number;
    command?: string;
    approvalMode?: 'ask' | 'elevated' | 'trusted';
    rejectionError?: string;
    timeoutError?: string;
  };
  emitFinishedEvent?: boolean;
  approvedQueue?: ExecutionQueueItem[];
  rejectedQueue?: ExecutionQueueItem[];
}>;

export type ExecuteShapePayloadNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteChannelReplyNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteChannelRouteNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export interface ResolvedMemoryWrite {
  namespace: 'session' | 'memory' | 'thread';
  scopeId: string;
  key: string;
  value: unknown;
}

export type ExecuteMemoryWriteNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
}) => Promise<{
  output: unknown;
  result: unknown;
  write: ResolvedMemoryWrite;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteMemoryQueryNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
}) => Promise<{
  output: unknown;
  result: MemoryQueryResult;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export type ExecuteThreadBindNode = (params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
}) => Promise<{
  output: unknown;
  result: unknown;
  logs?: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}>;

export interface ResolvedChannelReplyProfile {
  id: string;
  name: string;
  channelType: string;
  agentId?: string;
  accountId?: string;
  routeKey?: string;
  defaultTarget?: string;
  config: Record<string, unknown>;
}

interface UsageSnapshot {
  nodeId: string;
  metricScope: 'run' | 'node';
  source: 'payload' | 'agent' | 'skill' | 'channel' | 'http';
  payloadBytes: number;
  textSegmentCount: number;
  textCharacters: number;
  estimatedTokens: number;
  previewItemCount: number;
  messageCharacters: number;
  replyTextCharacters: number;
  observedPromptTokens?: number;
  observedCompletionTokens?: number;
  observedTotalTokens?: number;
  observedCostUsd?: number;
}

interface UsageAggregate {
  nodeCount: number;
  payloadBytes: number;
  textSegmentCount: number;
  textCharacters: number;
  estimatedTokens: number;
  previewItemCount: number;
  messageCharacters: number;
  replyTextCharacters: number;
  observedPromptTokens?: number;
  observedCompletionTokens?: number;
  observedTotalTokens?: number;
  observedCostUsd?: number;
}

interface NodeExecutionResult {
  output: unknown;
  nextPorts: string[];
  extraEvents?: PendingRunEvent[];
  delegatedRuns?: PendingDelegatedRun[];
  result: unknown;
  waitUntil?: Date;
  waitDurationSeconds?: number;
  emitFinishedEvent?: boolean;
  approvedQueue?: ExecutionQueueItem[];
  rejectedQueue?: ExecutionQueueItem[];
  approvalRequest?: {
    requestType: 'control' | 'exec';
    reason?: string;
    timeoutSeconds: number;
    command?: string;
    approvalMode?: 'ask' | 'elevated' | 'trusted';
    rejectionError?: string;
    timeoutError?: string;
  };
}

interface ExecutionQueueItem {
  nodeId: string;
  input: unknown;
  pathNodeIds?: string[];
  execApproval?: {
    nodeId: string;
    command: string;
    approvalMode: 'ask' | 'elevated' | 'trusted';
  };
}

function cloneQueueItem(item: ExecutionQueueItem): ExecutionQueueItem {
  return {
    ...item,
    ...(item.pathNodeIds ? { pathNodeIds: [...item.pathNodeIds] } : {}),
    ...(item.execApproval ? { execApproval: { ...item.execApproval } } : {}),
  };
}

function normalizeQueueItem(item: ExecutionQueueItem): ExecutionQueueItem {
  return {
    ...cloneQueueItem(item),
    pathNodeIds:
      item.pathNodeIds && item.pathNodeIds.length > 0 ? [...item.pathNodeIds] : [item.nodeId],
  };
}

function buildQueuedEdgeItems(params: {
  current: ExecutionQueueItem;
  nextEdges: GraphEdge[];
  output: unknown;
}): { items: ExecutionQueueItem[] } | { error: string } {
  const currentPath =
    params.current.pathNodeIds && params.current.pathNodeIds.length > 0
      ? params.current.pathNodeIds
      : [params.current.nodeId];

  const items: ExecutionQueueItem[] = [];
  for (const edge of params.nextEdges) {
    if (currentPath.includes(edge.target)) {
      return {
        error: `node "${edge.target}" would re-enter the same execution path; cycles are not supported yet`,
      };
    }

    items.push({
      nodeId: edge.target,
      input: params.output,
      pathNodeIds: [...currentPath, edge.target],
    });
  }

  return { items };
}

function attachQueuePathDefaults(
  items: ExecutionQueueItem[] | undefined,
  fallbackPathNodeIds: string[],
): ExecutionQueueItem[] {
  return (items ?? []).map((item) => ({
    ...cloneQueueItem(item),
    pathNodeIds:
      item.pathNodeIds && item.pathNodeIds.length > 0
        ? [...item.pathNodeIds]
        : [...fallbackPathNodeIds],
  }));
}

function pushEvent(
  events: PendingRunEvent[],
  eventType: RunEventType,
  event: RunEvent,
  createdAt: Date,
): void {
  events.push({ eventType, event, createdAt });
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable value]';
  }
}

function mergeObjectOutput(
  input: unknown,
  additions: Record<string, unknown>,
): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return {
      ...(input as Record<string, unknown>),
      ...additions,
    };
  }

  return {
    input,
    ...additions,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isGatewayConnectivityFailure(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('gateway_unreachable') ||
    message.includes('connection closed') ||
    message.includes('connect challenge timeout') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('not_paired') ||
    message.includes('pairing required') ||
    message.includes('device identity required') ||
    message.includes('gateway is unreachable')
  );
}

function buildOfflineFallbackReplyText(target: string, action: string): string {
  return `[offline fallback] ${action} for "${target}" was simulated because the OpenClaw gateway is unavailable.`;
}

function createAbortError(message = 'Run cancelled'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function appendAbortRelayEvents(params: {
  events: PendingRunEvent[];
  runId: string;
  nodeId: string;
  error: unknown;
}): void {
  for (const relayLog of readRemoteAbortRelayLogs(params.error)) {
    const createdAt = new Date(relayLog.at);
    params.events.push({
      eventType: 'run.log',
      event: {
        type: 'run.log',
        runId: params.runId,
        at: relayLog.at,
        level: relayLog.level,
        nodeId: params.nodeId,
        message: relayLog.message,
        data: relayLog.data,
      },
      createdAt: Number.isNaN(createdAt.valueOf()) ? new Date() : createdAt,
    });
  }
}

function parseDelegationTimestamp(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function readDelegationDepth(input: unknown): number {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 0;
  }

  const value = input as Record<string, unknown>;
  const direct = value.delegationDepth;
  if (typeof direct === 'number' && Number.isInteger(direct) && direct >= 0) {
    return direct;
  }
  if (typeof direct === 'string') {
    const parsed = Number.parseInt(direct, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const coordination = value.coordination;
  if (!coordination || typeof coordination !== 'object' || Array.isArray(coordination)) {
    return 0;
  }

  const nested = (coordination as Record<string, unknown>).delegationDepth;
  if (typeof nested === 'number' && Number.isInteger(nested) && nested >= 0) {
    return nested;
  }
  if (typeof nested === 'string') {
    const parsed = Number.parseInt(nested, 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

function readDelegatedRunStatus(value: unknown): PendingDelegatedRun['status'] {
  switch (value) {
    case 'running':
    case 'succeeded':
    case 'failed':
    case 'cancelled':
      return value;
    case 'ok':
      return 'succeeded';
    default:
      return 'succeeded';
  }
}

function buildDelegatedRunRecord(params: {
  runId: string;
  nodeId: string;
  node: GraphNode;
  handoffExecution: {
    output: unknown;
  };
  createdAt: Date;
}): PendingDelegatedRun | undefined {
  const output =
    params.handoffExecution.output &&
    typeof params.handoffExecution.output === 'object' &&
    !Array.isArray(params.handoffExecution.output)
      ? (params.handoffExecution.output as Record<string, unknown>)
      : undefined;

  const targetAgent =
    (typeof output?.targetAgent === 'string' ? output.targetAgent.trim() : '') ||
    getStringConfig(params.node, 'targetAgent').trim();
  const sessionKey = typeof output?.sessionKey === 'string' ? output.sessionKey.trim() : '';
  if (!targetAgent || !sessionKey) {
    return undefined;
  }

  const gatewayRunId =
    typeof output?.gatewayRunId === 'string' && output.gatewayRunId.trim().length > 0
      ? output.gatewayRunId.trim()
      : undefined;
  const handoffReason =
    typeof output?.handoffReason === 'string' && output.handoffReason.trim().length > 0
      ? output.handoffReason.trim()
      : getStringConfig(params.node, 'handoffReason').trim() || undefined;
  const model =
    typeof output?.model === 'string' && output.model.trim().length > 0
      ? output.model.trim()
      : getStringConfig(params.node, 'modelOverride').trim() || undefined;
  const replyText =
    typeof output?.replyText === 'string' && output.replyText.trim().length > 0
      ? output.replyText
      : undefined;
  const error =
    typeof output?.error === 'string' && output.error.trim().length > 0
      ? output.error.trim()
      : undefined;

  return {
    parentRunId: params.runId,
    parentNodeId: params.nodeId,
    delegationKind: 'agent-send',
    depth: Math.max(readDelegationDepth(output), 1),
    targetAgent,
    sessionKey,
    ...(gatewayRunId ? { gatewayRunId } : {}),
    ...(handoffReason ? { handoffReason } : {}),
    ...(model ? { model } : {}),
    status: readDelegatedRunStatus(output?.delegatedRunStatus ?? output?.status),
    ...(replyText ? { replyText } : {}),
    ...(error ? { error } : {}),
    createdAt: params.createdAt,
    ...(parseDelegationTimestamp(output?.startedAt)
      ? { startedAt: parseDelegationTimestamp(output?.startedAt) }
      : {}),
    ...(parseDelegationTimestamp(output?.endedAt)
      ? { finishedAt: parseDelegationTimestamp(output?.endedAt) }
      : {}),
  };
}
function buildAgentSendDelegationEvent(params: {
  runId: string;
  nodeId: string;
  node: GraphNode;
  handoffExecution: {
    output: unknown;
  };
  createdAt: Date;
}): PendingRunEvent | undefined {
  const output =
    params.handoffExecution.output &&
    typeof params.handoffExecution.output === 'object' &&
    !Array.isArray(params.handoffExecution.output)
      ? (params.handoffExecution.output as Record<string, unknown>)
      : undefined;

  const targetAgent =
    (typeof output?.targetAgent === 'string' ? output.targetAgent.trim() : '') ||
    getStringConfig(params.node, 'targetAgent').trim();
  const sessionKey = typeof output?.sessionKey === 'string' ? output.sessionKey.trim() : '';
  if (!targetAgent || !sessionKey) {
    return undefined;
  }

  const gatewayRunId =
    typeof output?.gatewayRunId === 'string' && output.gatewayRunId.trim().length > 0
      ? output.gatewayRunId.trim()
      : undefined;
  const handoffReason =
    typeof output?.handoffReason === 'string' && output.handoffReason.trim().length > 0
      ? output.handoffReason.trim()
      : getStringConfig(params.node, 'handoffReason').trim() || undefined;
  const model =
    typeof output?.model === 'string' && output.model.trim().length > 0
      ? output.model.trim()
      : getStringConfig(params.node, 'modelOverride').trim() || undefined;

  return {
    eventType: 'run.delegated',
    event: {
      type: 'run.delegated',
      runId: params.runId,
      nodeId: params.nodeId,
      at: params.createdAt.toISOString(),
      delegationKind: 'agent-send',
      targetAgent,
      sessionKey,
      ...(gatewayRunId ? { gatewayRunId } : {}),
      ...(handoffReason ? { handoffReason } : {}),
      ...(model ? { model } : {}),
    },
    createdAt: params.createdAt,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getStringConfig(node: GraphNode, key: string, fallback = ''): string {
  const value = node.data[key];
  return typeof value === 'string' ? value : fallback;
}

function getBooleanConfig(node: GraphNode, key: string, fallback: boolean): boolean {
  const value = node.data[key];
  return typeof value === 'boolean' ? value : fallback;
}

function parsePositiveIntegerConfig(
  node: GraphNode,
  key: string,
  fallback: number,
  label: string,
): number {
  const value = node.data[key];
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
    throw new Error(`${label} must be a positive integer`);
  }
  return fallback;
}

function getPathCandidates(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) return [];

  const candidates = [trimmed];
  if (trimmed === 'input') {
    candidates.push('');
  } else if (trimmed.startsWith('input.')) {
    candidates.push(trimmed.slice('input.'.length));
  } else {
    candidates.push(`input.${trimmed}`);
  }

  return candidates.filter((candidate, index, all) => all.indexOf(candidate) === index);
}

function getPathValue(input: unknown, path: string): unknown {
  const candidates = getPathCandidates(path);
  if (candidates.length === 0) return input;

  for (const candidate of candidates) {
    if (!candidate) return input;

    const resolved = candidate.split('.').reduce<unknown>((current, segment) => {
      if (!segment) return current;
      if (
        current &&
        typeof current === 'object' &&
        segment in (current as Record<string, unknown>)
      ) {
        return (current as Record<string, unknown>)[segment];
      }
      return undefined;
    }, input);

    if (resolved !== undefined) {
      return resolved;
    }
  }

  return undefined;
}

function getStringPathValue(input: unknown, path: string): string | undefined {
  const value = getPathValue(input, path);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getFirstStringPathValue(input: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = getStringPathValue(input, path);
    if (value) return value;
  }
  return undefined;
}

function getRecordString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function comparePathValue(actual: unknown, expected: string): boolean {
  if (typeof actual === 'string') return actual === expected;
  if (typeof actual === 'number' || typeof actual === 'boolean') return String(actual) === expected;
  if (actual === null || actual === undefined) return false;
  try {
    return JSON.stringify(actual) === expected;
  } catch {
    return false;
  }
}

function toBooleanBranch(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1', 'success'].includes(normalized)) return true;
    if (['false', 'no', '0', '', 'failure'].includes(normalized)) return false;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['branch', 'ok', 'pass', 'success', 'shouldContinue']) {
      if (typeof record[key] === 'boolean') return record[key];
    }
    for (const key of ['route', 'branch', 'decision', 'status']) {
      if (typeof record[key] === 'string') return toBooleanBranch(record[key]);
    }
  }
  return false;
}

function formatAgentMessage(nodeInput: unknown, inputTemplate = ''): string {
  const trimmedTemplate = inputTemplate.trim();
  if (trimmedTemplate.length > 0) {
    const rendered = renderInputTemplate(trimmedTemplate, nodeInput).trim();
    if (rendered.length > 0) {
      return rendered;
    }
  }

  if (typeof nodeInput === 'string') {
    const trimmed = nodeInput.trim();
    if (trimmed.length > 0) return trimmed;
  }

  try {
    return `Workflow input JSON:\n${JSON.stringify(nodeInput, null, 2)}`;
  } catch {
    return `Workflow input:\n${stringifyValue(nodeInput)}`;
  }
}

function renderInputTemplate(template: string, input: unknown): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, rawPath: string) => {
    let value = rawPath === 'input' ? input : getPathValue(input, rawPath);
    if (
      value === undefined &&
      typeof input === 'string' &&
      rawPath.split('.').at(-1)?.toLowerCase() === 'transcript'
    ) {
      value = input;
    }
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : stringifyValue(value);
  });
}

function hasApprovedExecGrant(
  queueItem: Pick<ExecutionQueueItem, 'execApproval'> | undefined,
  params: {
    nodeId: string;
    command: string;
    approvalMode: 'ask' | 'elevated' | 'trusted';
  },
): boolean {
  return (
    queueItem?.execApproval?.nodeId === params.nodeId &&
    queueItem.execApproval.command === params.command &&
    queueItem.execApproval.approvalMode === params.approvalMode
  );
}

function sanitizeBindingSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'binding';
}

function setNestedValue(
  target: Record<string, unknown>,
  keyPath: string,
  value: unknown,
): Record<string, unknown> {
  const segments = keyPath
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return target;
  }

  let current: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const leafKey = segments[segments.length - 1];
  if (leafKey) {
    current[leafKey] = value;
  }

  return target;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return structuredClone(value as Record<string, unknown>);
  }
  return {};
}

function getNumberPathValue(input: unknown, path: string): number | undefined {
  const value = getPathValue(input, path);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function getFirstNumberPathValue(input: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getNumberPathValue(input, path);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function createUsagePayloadCandidate(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }

  const record = { ...(input as Record<string, unknown>) };
  record.usage = undefined;
  record.usageSnapshot = undefined;
  return record;
}

function collectTextMetrics(
  value: unknown,
  seen = new Set<object>(),
): { textSegmentCount: number; textCharacters: number } {
  if (typeof value === 'string') {
    return {
      textSegmentCount: value.length > 0 ? 1 : 0,
      textCharacters: value.length,
    };
  }

  if (Array.isArray(value)) {
    return value.reduce(
      (totals, entry) => {
        const next = collectTextMetrics(entry, seen);
        return {
          textSegmentCount: totals.textSegmentCount + next.textSegmentCount,
          textCharacters: totals.textCharacters + next.textCharacters,
        };
      },
      { textSegmentCount: 0, textCharacters: 0 },
    );
  }

  if (value && typeof value === 'object') {
    if (seen.has(value as object)) {
      return { textSegmentCount: 0, textCharacters: 0 };
    }
    seen.add(value as object);

    return Object.values(value as Record<string, unknown>).reduce<{
      textSegmentCount: number;
      textCharacters: number;
    }>(
      (totals, entry) => {
        const next = collectTextMetrics(entry, seen);
        return {
          textSegmentCount: totals.textSegmentCount + next.textSegmentCount,
          textCharacters: totals.textCharacters + next.textCharacters,
        };
      },
      { textSegmentCount: 0, textCharacters: 0 },
    );
  }

  return { textSegmentCount: 0, textCharacters: 0 };
}

function safePayloadBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return new TextEncoder().encode(stringifyValue(value)).length;
  }
}

function detectUsageSource(input: unknown): UsageSnapshot['source'] {
  const record =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : undefined;

  if (typeof record?.gatewayRunId === 'string' && typeof record?.skillName === 'string') {
    return 'skill';
  }
  if (typeof record?.gatewayRunId === 'string' && typeof record?.targetAgent === 'string') {
    return 'agent';
  }
  if (typeof record?.gatewayRunId === 'string' && typeof record?.agentId === 'string') {
    return 'agent';
  }
  if (typeof record?.messageId === 'string' && typeof record?.channel === 'string') {
    return 'channel';
  }
  if (
    typeof record?.status === 'number' &&
    typeof (record as Record<string, unknown>).request === 'object'
  ) {
    return 'http';
  }
  return 'payload';
}

function buildUsageSnapshot(
  nodeId: string,
  metricScope: 'run' | 'node',
  nodeInput: unknown,
): UsageSnapshot {
  const candidate = createUsagePayloadCandidate(nodeInput);
  const { textSegmentCount, textCharacters } = collectTextMetrics(candidate);
  const previewItems = getPathValue(nodeInput, 'previewItems');
  const previewItemCount = Array.isArray(previewItems) ? previewItems.length : 0;
  const message = getFirstStringPathValue(nodeInput, ['message', 'input.message']) ?? '';
  const replyText = getFirstStringPathValue(nodeInput, ['replyText', 'input.replyText']) ?? '';
  const observedPromptTokens = getFirstNumberPathValue(nodeInput, [
    'usage.promptTokens',
    'usage.inputTokens',
    'metrics.promptTokens',
    'promptTokens',
    'inputTokens',
  ]);
  const observedCompletionTokens = getFirstNumberPathValue(nodeInput, [
    'usage.completionTokens',
    'usage.outputTokens',
    'metrics.completionTokens',
    'completionTokens',
    'outputTokens',
  ]);
  const observedTotalTokens = getFirstNumberPathValue(nodeInput, [
    'usage.totalTokens',
    'metrics.totalTokens',
    'totalTokens',
  ]);
  const observedCostUsd = getFirstNumberPathValue(nodeInput, [
    'usage.costUsd',
    'metrics.costUsd',
    'costUsd',
  ]);

  return {
    nodeId,
    metricScope,
    source: detectUsageSource(nodeInput),
    payloadBytes: safePayloadBytes(candidate),
    textSegmentCount,
    textCharacters,
    estimatedTokens: Math.ceil(textCharacters / 4),
    previewItemCount,
    messageCharacters: message.length,
    replyTextCharacters: replyText.length,
    ...(observedPromptTokens !== undefined ? { observedPromptTokens } : {}),
    ...(observedCompletionTokens !== undefined ? { observedCompletionTokens } : {}),
    ...(observedTotalTokens !== undefined ? { observedTotalTokens } : {}),
    ...(observedCostUsd !== undefined ? { observedCostUsd } : {}),
  };
}

function readUsageByNode(value: unknown): Record<string, UsageSnapshot> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => {
      return Boolean(entry && typeof entry === 'object' && !Array.isArray(entry));
    }),
  ) as Record<string, UsageSnapshot>;
}

function aggregateUsageSnapshots(snapshots: UsageSnapshot[]): UsageAggregate {
  const aggregated = snapshots.reduce<UsageAggregate>(
    (totals, snapshot) => {
      totals.nodeCount += 1;
      totals.payloadBytes += snapshot.payloadBytes;
      totals.textSegmentCount += snapshot.textSegmentCount;
      totals.textCharacters += snapshot.textCharacters;
      totals.estimatedTokens += snapshot.estimatedTokens;
      totals.previewItemCount += snapshot.previewItemCount;
      totals.messageCharacters += snapshot.messageCharacters;
      totals.replyTextCharacters += snapshot.replyTextCharacters;
      if (snapshot.observedPromptTokens !== undefined) {
        totals.observedPromptTokens =
          (totals.observedPromptTokens ?? 0) + snapshot.observedPromptTokens;
      }
      if (snapshot.observedCompletionTokens !== undefined) {
        totals.observedCompletionTokens =
          (totals.observedCompletionTokens ?? 0) + snapshot.observedCompletionTokens;
      }
      if (snapshot.observedTotalTokens !== undefined) {
        totals.observedTotalTokens =
          (totals.observedTotalTokens ?? 0) + snapshot.observedTotalTokens;
      }
      if (snapshot.observedCostUsd !== undefined) {
        totals.observedCostUsd = (totals.observedCostUsd ?? 0) + snapshot.observedCostUsd;
      }
      return totals;
    },
    {
      nodeCount: 0,
      payloadBytes: 0,
      textSegmentCount: 0,
      textCharacters: 0,
      estimatedTokens: 0,
      previewItemCount: 0,
      messageCharacters: 0,
      replyTextCharacters: 0,
    },
  );

  return aggregated;
}

function buildUsageOutput(input: unknown, current: UsageSnapshot): Record<string, unknown> {
  const output = mergeObjectOutput(input, {});
  const existingUsageRoot = cloneRecord(output.usage);
  const existingByNode = readUsageByNode(existingUsageRoot.byNode);
  const byNode = {
    ...existingByNode,
    [current.nodeId]: current,
  };
  const run = aggregateUsageSnapshots(Object.values(byNode));

  output.usage = {
    ...existingUsageRoot,
    current,
    byNode,
    run,
  };
  output.usageSnapshot = current.metricScope === 'node' ? current : run;
  return output;
}

function resolveTemplateValue(template: string, input: unknown): unknown {
  const trimmedTemplate = template.trim();
  if (!trimmedTemplate) {
    return input;
  }

  const exactPathMatch = trimmedTemplate.match(/^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/);
  if (exactPathMatch?.[1]) {
    const rawPath = exactPathMatch[1];
    const resolved = rawPath === 'input' ? input : getPathValue(input, rawPath);
    if (resolved === undefined) {
      throw new Error(`memory write node could not resolve "${rawPath}" from the current payload`);
    }
    return resolved;
  }

  const rendered = renderInputTemplate(trimmedTemplate, input);
  if (!rendered.trim()) {
    return '';
  }

  try {
    return JSON.parse(rendered);
  } catch {
    return rendered;
  }
}

function buildMemoryWriteOutput(
  input: unknown,
  write: ResolvedMemoryWrite,
): Record<string, unknown> {
  const output = mergeObjectOutput(input, {});
  const memoryRoot = cloneRecord(output.memory);
  const namespaceRoot = cloneRecord(memoryRoot[write.namespace]);
  setNestedValue(namespaceRoot, write.key, write.value);
  memoryRoot[write.namespace] = namespaceRoot;
  output.memory = memoryRoot;
  output.memoryWrite = {
    namespace: write.namespace,
    scopeId: write.scopeId,
    key: write.key,
    value: write.value,
  };
  return output;
}

function buildMemoryQueryOutput(
  input: unknown,
  result: MemoryQueryResult,
): Record<string, unknown> {
  const output = mergeObjectOutput(input, {});
  output.memoryQuery = result;
  return output;
}

function buildShapePayloadOutput(
  input: unknown,
  mode: string,
  outputPath: string,
  resolved: unknown,
): unknown {
  if (mode === 'replace') {
    return resolved;
  }

  if (mode === 'merge') {
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
      throw new Error(
        'Shape Payload merge mode requires the template to resolve to a JSON object.',
      );
    }
    return mergeObjectOutput(input, resolved as Record<string, unknown>);
  }

  if (mode === 'assign') {
    if (!outputPath.trim()) {
      throw new Error('Shape Payload assign mode requires an output path.');
    }
    const output = mergeObjectOutput(input, {});
    setNestedValue(output, outputPath, resolved);
    return output;
  }

  throw new Error(`Shape Payload output mode "${mode}" is not supported.`);
}

function formatSkillMessage(nodeInput: unknown, inputTemplate: string): string {
  const trimmedTemplate = inputTemplate.trim();
  if (trimmedTemplate.length > 0) {
    return renderInputTemplate(trimmedTemplate, nodeInput).trim();
  }

  if (typeof nodeInput === 'string') {
    const trimmed = nodeInput.trim();
    if (trimmed.length > 0) return trimmed;
  }

  try {
    return JSON.stringify(nodeInput, null, 2);
  } catch {
    return stringifyValue(nodeInput);
  }
}

function formatChannelReplyMessage(nodeInput: unknown, messageTemplate: string): string {
  const trimmedTemplate = messageTemplate.trim();
  if (trimmedTemplate.length > 0) {
    const rendered = renderInputTemplate(trimmedTemplate, nodeInput).trim();
    if (rendered.length > 0) {
      return rendered;
    }
    throw new Error(
      'channel reply message template resolved to an empty value. The previous step did not produce the expected reply field.',
    );
  }

  const replyText = getFirstStringPathValue(nodeInput, [
    'replyText',
    'text',
    'message',
    'input.replyText',
    'input.text',
    'input.message',
  ]);
  if (replyText) {
    return replyText;
  }

  return stringifyValue(nodeInput);
}

function formatAgentSendMessage(
  nodeInput: unknown,
  targetAgent: string,
  handoffReason: string,
  inputTemplate: string,
): string {
  const renderedInput = formatSkillMessage(nodeInput, inputTemplate);
  const sections = [`Workflow handoff to agent "${targetAgent}".`];

  const trimmedReason = handoffReason.trim();
  if (trimmedReason.length > 0) {
    sections.push(`Reason: ${trimmedReason}`);
  }

  sections.push('Current payload:');
  sections.push(renderedInput);
  return sections.join('\n\n');
}

function normalizeHttpMethod(node: GraphNode): string {
  const method = getStringConfig(node, 'method', 'GET').trim().toUpperCase();
  return method || 'GET';
}

function parseTemplateRecord(
  template: string,
  nodeInput: unknown,
  label: string,
): Record<string, string> {
  const trimmedTemplate = template.trim();
  if (!trimmedTemplate) {
    return {};
  }

  const rendered = renderInputTemplate(trimmedTemplate, nodeInput).trim();
  if (!rendered) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rendered);
  } catch (error) {
    throw new Error(`${label} must be valid JSON after template rendering: ${errorMessage(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must render to a JSON object`);
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : stringifyValue(value),
    ]),
  );
}

function buildHttpRequestBody(
  nodeInput: unknown,
  bodyTemplate: string,
): {
  body?: string;
  bodyPreview?: unknown;
  inferredJson: boolean;
} {
  const trimmedTemplate = bodyTemplate.trim();
  if (!trimmedTemplate) {
    return { inferredJson: false };
  }

  const rendered = renderInputTemplate(trimmedTemplate, nodeInput).trim();
  if (!rendered) {
    return { inferredJson: false };
  }

  try {
    const parsed = JSON.parse(rendered);
    return {
      body: JSON.stringify(parsed),
      bodyPreview: parsed,
      inferredJson: true,
    };
  } catch {
    return {
      body: rendered,
      bodyPreview: rendered,
      inferredJson: false,
    };
  }
}

function normalizeHttpResponseHeaders(headers: Headers): Record<string, string> {
  const normalized: Record<string, string> = {};
  headers.forEach((value, key) => {
    normalized[key] = value;
  });
  return normalized;
}

async function parseHttpResponseBody(
  response: Response,
  responseMode: string,
): Promise<{
  body: unknown;
  text?: string;
  json?: unknown;
}> {
  const rawText = await response.text();
  const normalizedMode = responseMode.trim().toLowerCase() || 'auto';
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const shouldParseJson =
    normalizedMode === 'json' ||
    (normalizedMode === 'auto' &&
      (contentType.includes('application/json') || contentType.includes('+json')));

  if (shouldParseJson) {
    if (!rawText.trim()) {
      return { body: undefined, text: rawText };
    }

    try {
      const json = JSON.parse(rawText);
      return { body: json, text: rawText, json };
    } catch (error) {
      throw new Error(`HTTP response body was not valid JSON: ${errorMessage(error)}`);
    }
  }

  return { body: rawText, text: rawText };
}

export async function executeChannelReplyNodeWithProfile(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  profile?: ResolvedChannelReplyProfile;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const profileDefaultTarget =
    params.profile?.defaultTarget ??
    getRecordString(params.profile?.config, 'defaultChatId') ??
    getRecordString(params.profile?.config, 'defaultChannelId');
  const configuredChannel = getStringConfig(params.node, 'channelType').trim();
  const channel =
    params.profile?.channelType ||
    configuredChannel ||
    getFirstStringPathValue(params.nodeInput, [
      'channel',
      'channelType',
      'originatingChannel',
      'input.channel',
      'input.channelType',
      'input.originatingChannel',
    ]);

  const configuredToPath = getStringConfig(params.node, 'toPath').trim();
  const to =
    (configuredToPath ? getStringPathValue(params.nodeInput, configuredToPath) : undefined) ||
    getFirstStringPathValue(params.nodeInput, [
      'to',
      'recipient',
      'recipientId',
      'originatingTo',
      'channelId',
      'chatId',
      'conversationId',
      'toJid',
      'input.to',
      'input.recipient',
      'input.recipientId',
      'input.originatingTo',
      'input.channelId',
      'input.chatId',
      'input.conversationId',
      'input.toJid',
    ]) ||
    profileDefaultTarget;
  if (!to) {
    throw new Error('channel reply node could not resolve a reply target');
  }

  const configuredThreadPath = getStringConfig(params.node, 'threadIdPath').trim();
  const threadId =
    (configuredThreadPath
      ? getStringPathValue(params.nodeInput, configuredThreadPath)
      : undefined) ||
    getFirstStringPathValue(params.nodeInput, [
      'threadId',
      'originatingThreadId',
      'input.threadId',
      'input.originatingThreadId',
    ]);

  const configuredAccountPath = getStringConfig(params.node, 'accountIdPath').trim();
  const accountId =
    params.profile?.accountId ||
    (configuredAccountPath
      ? getStringPathValue(params.nodeInput, configuredAccountPath)
      : undefined) ||
    getFirstStringPathValue(params.nodeInput, [
      'accountId',
      'originatingAccountId',
      'input.accountId',
      'input.originatingAccountId',
    ]);

  const configuredSessionPath = getStringConfig(params.node, 'sessionKeyPath').trim();
  const sessionKey =
    (configuredSessionPath
      ? getStringPathValue(params.nodeInput, configuredSessionPath)
      : undefined) || getFirstStringPathValue(params.nodeInput, ['sessionKey', 'input.sessionKey']);

  const agentId =
    params.profile?.agentId ||
    getStringConfig(params.node, 'agentId').trim() ||
    getFirstStringPathValue(params.nodeInput, ['agentId', 'input.agentId']);

  const message = formatChannelReplyMessage(
    params.nodeInput,
    getStringConfig(params.node, 'messageTemplate'),
  );
  if (!message) {
    throw new Error('channel reply node requires a message');
  }

  try {
    const deliveryResult = await sendOpenClawChannelReply({
      ...(channel ? { channel } : {}),
      to,
      message,
      idempotencyKey: `${params.runId}:${params.node.id}`,
      ...(accountId ? { accountId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });

    const output = {
      ...deliveryResult,
      message,
      input: params.nodeInput,
    };

    return {
      output,
      result: output,
      logs: [
        {
          level: 'info',
          message: `Channel reply delivered via "${deliveryResult.channel}"`,
          data: {
            profileId: params.profile?.id,
            profileName: params.profile?.name,
            to,
            messageId: deliveryResult.messageId,
            threadId,
            sessionKey,
          },
        },
      ],
    };
  } catch (error) {
    if (!isGatewayConnectivityFailure(error)) {
      throw error;
    }

    const offlineReason = errorMessage(error);
    const output = {
      channel: channel ?? params.profile?.channelType ?? 'offline',
      to,
      accountId,
      agentId,
      threadId,
      sessionKey,
      message,
      deliveryStatus: 'offline_fallback',
      offlineFallback: true,
      offlineReason,
      input: params.nodeInput,
    };

    return {
      output,
      result: output,
      logs: [
        {
          level: 'warn',
          message:
            'Channel reply used an offline fallback because the OpenClaw gateway is unavailable',
          data: {
            profileId: params.profile?.id,
            profileName: params.profile?.name,
            channel: output.channel,
            to,
            error: offlineReason,
          },
        },
      ],
    };
  }
}

async function executeDefaultChannelReplyNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  return executeChannelReplyNodeWithProfile(params);
}

export async function executeChannelRouteNodeWithProfile(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  profile?: ResolvedChannelReplyProfile;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const destination =
    params.profile?.id || getStringConfig(params.node, 'destination').trim() || undefined;
  if (!destination) {
    throw new Error('channel route node requires a destination');
  }

  const destinationChannel =
    params.profile?.channelType ||
    getStringConfig(params.node, 'destination').trim() ||
    getFirstStringPathValue(params.nodeInput, [
      'channel',
      'channelType',
      'originatingChannel',
      'input.channel',
      'input.channelType',
      'input.originatingChannel',
    ]);
  if (!destinationChannel) {
    throw new Error('channel route node could not resolve a destination channel');
  }

  const profileDefaultTarget =
    params.profile?.defaultTarget ??
    getRecordString(params.profile?.config, 'defaultChatId') ??
    getRecordString(params.profile?.config, 'defaultChannelId');
  const to =
    getFirstStringPathValue(params.nodeInput, [
      'routeTo',
      'target',
      'to',
      'recipient',
      'recipientId',
      'channelId',
      'chatId',
      'conversationId',
      'toJid',
      'input.routeTo',
      'input.target',
      'input.to',
      'input.recipient',
      'input.recipientId',
      'input.channelId',
      'input.chatId',
      'input.conversationId',
      'input.toJid',
    ]) || profileDefaultTarget;
  if (!to) {
    throw new Error('channel route node could not resolve a delivery target');
  }

  const threading = getStringConfig(params.node, 'threading', 'preserve').trim() || 'preserve';
  const preserveThread = threading !== 'new';
  const accountId =
    params.profile?.accountId ||
    getFirstStringPathValue(params.nodeInput, [
      'accountId',
      'originatingAccountId',
      'input.accountId',
      'input.originatingAccountId',
    ]);
  const agentId =
    params.profile?.agentId ||
    getFirstStringPathValue(params.nodeInput, ['agentId', 'input.agentId']);
  const threadId = preserveThread
    ? getFirstStringPathValue(params.nodeInput, [
        'threadId',
        'originatingThreadId',
        'input.threadId',
        'input.originatingThreadId',
      ])
    : undefined;
  const sessionKey = preserveThread
    ? getFirstStringPathValue(params.nodeInput, ['sessionKey', 'input.sessionKey'])
    : undefined;
  const message = formatChannelReplyMessage(
    params.nodeInput,
    getStringConfig(params.node, 'messageTemplate'),
  );
  if (!message) {
    throw new Error('channel route node requires a message');
  }

  const destinationLabel = params.profile?.name
    ? `profile "${params.profile.name}"`
    : `channel "${destinationChannel}"`;

  try {
    const deliveryResult = await sendOpenClawChannelReply({
      channel: destinationChannel,
      to,
      message,
      idempotencyKey: `${params.runId}:${params.node.id}`,
      ...(accountId ? { accountId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });

    const output = {
      ...deliveryResult,
      destination,
      destinationProfileId: params.profile?.id,
      destinationProfileName: params.profile?.name,
      routeKey: params.profile?.routeKey,
      threading,
      message,
      input: params.nodeInput,
    };

    return {
      output,
      result: output,
      logs: [
        {
          level: 'info',
          message: `Routed message via "${deliveryResult.channel}" to ${destinationLabel}`,
          data: {
            destination,
            destinationProfileId: params.profile?.id,
            destinationProfileName: params.profile?.name,
            routeKey: params.profile?.routeKey,
            to,
            threading,
            messageId: deliveryResult.messageId,
            threadId,
            sessionKey,
          },
        },
      ],
    };
  } catch (error) {
    if (!isGatewayConnectivityFailure(error)) {
      throw error;
    }

    const offlineReason = errorMessage(error);
    const output = {
      channel: destinationChannel,
      to,
      accountId,
      agentId,
      threadId,
      sessionKey,
      destination,
      destinationProfileId: params.profile?.id,
      destinationProfileName: params.profile?.name,
      routeKey: params.profile?.routeKey,
      threading,
      message,
      deliveryStatus: 'offline_fallback',
      offlineFallback: true,
      offlineReason,
      input: params.nodeInput,
    };

    return {
      output,
      result: output,
      logs: [
        {
          level: 'warn',
          message: `Channel route to ${destinationLabel} used an offline fallback because the OpenClaw gateway is unavailable`,
          data: {
            destination,
            routeKey: params.profile?.routeKey,
            to,
            threading,
            error: offlineReason,
          },
        },
      ],
    };
  }
}

async function executeDefaultChannelRouteNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  return executeChannelRouteNodeWithProfile(params);
}

async function executeDefaultWaitNode(params: {
  node: GraphNode;
  nodeInput: unknown;
  now: () => Date;
}): Promise<{
  output: unknown;
  result: unknown;
  waitUntil: Date;
  waitDurationSeconds: number;
}> {
  const durationSeconds = parsePositiveIntegerConfig(
    params.node,
    'durationSeconds',
    60,
    'Wait duration',
  );
  const waitUntil = new Date(params.now().getTime() + durationSeconds * 1000);
  return {
    output: params.nodeInput,
    result: {
      output: params.nodeInput,
      durationSeconds,
      waitUntil: waitUntil.toISOString(),
      nextPorts: ['out'],
    },
    waitUntil,
    waitDurationSeconds: durationSeconds,
  };
}

async function executeDefaultApprovalNode(params: {
  node: GraphNode;
  nodeInput: unknown;
  now: () => Date;
}): Promise<{
  output: unknown;
  result: unknown;
  waitUntil?: Date;
  approvalRequest?: {
    requestType: 'control' | 'exec';
    reason?: string;
    timeoutSeconds: number;
    command?: string;
    approvalMode?: 'ask' | 'elevated' | 'trusted';
  };
}> {
  if (params.node.data.enabled === false || params.node.data.enabled === 'false') {
    return {
      output: params.nodeInput,
      result: {
        output: params.nodeInput,
        approved: true,
        skipped: true,
        nextPorts: ['approved'],
      },
    };
  }

  const timeoutSeconds = parsePositiveIntegerConfig(
    params.node,
    'timeoutSeconds',
    300,
    'Approval timeout',
  );
  const reason = getStringConfig(params.node, 'reason').trim() || undefined;
  const waitUntil = new Date(params.now().getTime() + timeoutSeconds * 1000);
  return {
    output: params.nodeInput,
    result: {
      output: params.nodeInput,
      timeoutSeconds,
      reason,
      waitUntil: waitUntil.toISOString(),
      nextPorts: ['approved', 'rejected'],
    },
    waitUntil,
    approvalRequest: {
      requestType: 'control',
      reason,
      timeoutSeconds,
    },
  };
}

export async function executeDefaultThreadBindNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const bindingPath = getStringConfig(params.node, 'bindingKey').trim();
  if (!bindingPath) {
    throw new Error('thread bind node requires a binding key path');
  }

  const bindingValue = getFirstStringPathValue(params.nodeInput, [
    bindingPath,
    `input.${bindingPath}`,
  ]);
  if (!bindingValue) {
    throw new Error(`thread bind node could not resolve "${bindingPath}" from the current payload`);
  }

  const strategy = getStringConfig(params.node, 'strategy', 'reuse').trim() || 'reuse';
  const existingThreadId = getFirstStringPathValue(params.nodeInput, [
    'threadId',
    'originatingThreadId',
    'input.threadId',
    'input.originatingThreadId',
  ]);
  const existingSessionKey = getFirstStringPathValue(params.nodeInput, [
    'sessionKey',
    'input.sessionKey',
  ]);

  if (strategy === 'reuse' && !existingThreadId && !existingSessionKey) {
    throw new Error('thread bind node could not find an existing thread or session to reuse');
  }

  const channel =
    getFirstStringPathValue(params.nodeInput, [
      'channel',
      'channelType',
      'originatingChannel',
      'input.channel',
      'input.channelType',
      'input.originatingChannel',
    ]) ?? 'channel';
  const agentId = getFirstStringPathValue(params.nodeInput, ['agentId', 'input.agentId']) ?? 'main';
  const threadId = existingThreadId || bindingValue;
  const sessionKey =
    existingSessionKey ||
    `agent:${sanitizeBindingSegment(agentId)}:${sanitizeBindingSegment(channel)}:bound:${sanitizeBindingSegment(bindingValue)}`;

  const output = mergeObjectOutput(params.nodeInput, {
    threadId,
    sessionKey,
    threadBinding: {
      key: bindingPath,
      value: bindingValue,
      strategy,
      reused: Boolean(existingThreadId || existingSessionKey),
    },
  });

  return {
    output,
    result: output,
    logs: [
      {
        level: 'info',
        message:
          strategy === 'reuse'
            ? `Thread binding reused existing context for "${bindingValue}"`
            : `Thread binding created context for "${bindingValue}"`,
        data: {
          bindingKey: bindingPath,
          bindingValue,
          strategy,
          threadId,
          sessionKey,
        },
      },
    ],
  };
}

export async function executeMemoryWriteNodeWithPersistence(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  persistWrite?: (write: ResolvedMemoryWrite) => Promise<void>;
}): Promise<{
  output: unknown;
  result: unknown;
  write: ResolvedMemoryWrite;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const key = getStringConfig(params.node, 'key').trim();
  if (!key) {
    throw new Error('memory write node requires a key');
  }

  const namespaceConfig = getStringConfig(params.node, 'namespace', 'session').trim() || 'session';
  if (
    namespaceConfig !== 'session' &&
    namespaceConfig !== 'memory' &&
    namespaceConfig !== 'thread'
  ) {
    throw new Error(`memory write node does not support namespace "${namespaceConfig}"`);
  }

  const namespace = namespaceConfig;
  const scopeId =
    namespace === 'memory'
      ? params.flowId
      : namespace === 'session'
        ? getFirstStringPathValue(params.nodeInput, ['sessionKey', 'input.sessionKey'])
        : getFirstStringPathValue(params.nodeInput, [
            'threadId',
            'originatingThreadId',
            'input.threadId',
            'input.originatingThreadId',
          ]);

  if (!scopeId) {
    throw new Error(
      namespace === 'session'
        ? 'memory write node requires a sessionKey in the current payload when using the session namespace'
        : namespace === 'thread'
          ? 'memory write node requires a threadId in the current payload when using the thread namespace'
          : 'memory write node could not resolve a scope id',
    );
  }

  const value = resolveTemplateValue(
    getStringConfig(params.node, 'valueTemplate'),
    params.nodeInput,
  );
  const write: ResolvedMemoryWrite = {
    namespace,
    scopeId,
    key,
    value,
  };

  if (params.persistWrite) {
    await params.persistWrite(write);
  }

  const output = buildMemoryWriteOutput(params.nodeInput, write);

  return {
    output,
    result: output,
    write,
    logs: [
      {
        level: 'info',
        message: `Memory write stored "${key}" in ${namespace} scope`,
        data: {
          namespace,
          scopeId,
          key,
          value,
        },
      },
    ],
  };
}

async function executeDefaultMemoryWriteNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
}): Promise<{
  output: unknown;
  result: unknown;
  write: ResolvedMemoryWrite;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  return executeMemoryWriteNodeWithPersistence(params);
}

async function executeDefaultMemoryQueryNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
}): Promise<{
  output: unknown;
  result: MemoryQueryResult;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const namespace = getStringConfig(params.node, 'namespace', 'session').trim() || 'session';
  if (
    namespace !== 'session' &&
    namespace !== 'memory' &&
    namespace !== 'thread' &&
    namespace !== 'all'
  ) {
    throw new Error(`memory query node does not support namespace "${namespace}"`);
  }

  const keyPrefix = getStringConfig(params.node, 'keyPrefix').trim();
  const query = getStringConfig(params.node, 'query').trim();
  const limit = parsePositiveIntegerConfig(params.node, 'limit', 10, 'Memory query result limit');
  const inputRecord =
    params.nodeInput && typeof params.nodeInput === 'object' && !Array.isArray(params.nodeInput)
      ? (params.nodeInput as Record<string, unknown>)
      : {};
  const memoryState =
    inputRecord.memory &&
    typeof inputRecord.memory === 'object' &&
    !Array.isArray(inputRecord.memory)
      ? inputRecord.memory
      : {};
  const entries = flattenMemoryState(memoryState, {
    flowId: params.flowId,
    sessionKey: getFirstStringPathValue(params.nodeInput, ['sessionKey', 'input.sessionKey']),
    threadId: getFirstStringPathValue(params.nodeInput, [
      'threadId',
      'originatingThreadId',
      'input.threadId',
      'input.originatingThreadId',
    ]),
  });
  const result = queryMemoryEntries(entries, {
    namespace,
    ...(keyPrefix ? { keyPrefix } : {}),
    ...(query ? { query } : {}),
    limit,
  });
  const output = buildMemoryQueryOutput(params.nodeInput, result);

  return {
    output,
    result,
    logs: [
      {
        level: 'info',
        message: `Memory query returned ${result.matches.length} of ${result.totalMatches} matching entr${result.totalMatches === 1 ? 'y' : 'ies'}`,
        data: {
          namespace: result.namespace,
          keyPrefix: result.keyPrefix,
          query: result.query,
          totalMatches: result.totalMatches,
        },
      },
    ],
  };
}

async function executeDefaultUsageNode(params: {
  node: GraphNode;
  nodeInput: unknown;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const configuredScope = getStringConfig(params.node, 'metricScope', 'run').trim() || 'run';
  if (configuredScope !== 'run' && configuredScope !== 'node') {
    throw new Error(`usage snapshot node does not support scope "${configuredScope}"`);
  }

  const snapshot = buildUsageSnapshot(params.node.id, configuredScope, params.nodeInput);
  const output = buildUsageOutput(params.nodeInput, snapshot);
  const usageRoot = cloneRecord((output as Record<string, unknown>).usage);
  const byNode = readUsageByNode(usageRoot.byNode);
  const runSummary = usageRoot.run;
  const result = configuredScope === 'node' ? snapshot : runSummary;

  return {
    output,
    result,
    logs: [
      {
        level: 'info',
        message:
          configuredScope === 'node'
            ? `Captured node usage snapshot for "${snapshot.source}"`
            : `Captured run usage snapshot from ${Object.keys(byNode).length} usage node(s)`,
        data: result,
      },
    ],
  };
}

async function executeDefaultAgentNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const agentId = getStringConfig(params.node, 'agentId').trim();
  if (!agentId) {
    throw new Error('agent node requires an Agent ID');
  }

  const configuredSessionKey = getStringConfig(params.node, 'sessionKey').trim();
  const sessionKey =
    configuredSessionKey ||
    buildFlowAgentSessionKey({
      agentId,
      flowId: params.flowId,
      runId: params.runId,
      nodeId: params.node.id,
    });
  const instructions = getStringConfig(params.node, 'instructions').trim();
  const inputTemplate = getStringConfig(params.node, 'inputTemplate');
  const modelOverride = getStringConfig(params.node, 'modelOverride').trim();
  const waitTimeoutMs = parsePositiveIntegerConfig(
    params.node,
    'waitTimeoutMs',
    30_000,
    'Agent wait timeout',
  );

  let agentResult: Awaited<ReturnType<typeof runOpenClawAgent>>;
  try {
    agentResult = await runOpenClawAgent({
      agentId,
      sessionKey,
      message: formatAgentMessage(params.nodeInput, inputTemplate),
      timeoutMs: waitTimeoutMs,
      idempotencyKey: `${params.runId}:${params.node.id}`,
      ...(instructions ? { extraSystemPrompt: instructions } : {}),
      ...(modelOverride ? { model: modelOverride } : {}),
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });
  } catch (error) {
    if (!isGatewayConnectivityFailure(error)) {
      if (errorMessage(error).trim().toLowerCase() === 'timeout') {
        throw new Error(
          `Agent "${agentId}" timed out after ${waitTimeoutMs}ms. Increase this node's wait timeout or reduce the input payload.`,
        );
      }
      throw error;
    }

    const offlineReason = errorMessage(error);
    const replyText = buildOfflineFallbackReplyText(agentId, 'Agent execution');
    const output = {
      agentId,
      sessionKey,
      status: 'offline_fallback',
      replyText,
      previewItems: [{ role: 'system', text: replyText }],
      previewStatus: 'offline_fallback',
      offlineFallback: true,
      offlineReason,
      input: params.nodeInput,
    };

    return {
      output,
      result: output,
      logs: [
        {
          level: 'warn',
          message: `Agent "${agentId}" used an offline fallback because the OpenClaw gateway is unavailable`,
          data: {
            sessionKey,
            error: offlineReason,
          },
        },
      ],
    };
  }

  const output = {
    agentId,
    gatewayRunId: agentResult.runId,
    sessionKey: agentResult.sessionKey,
    status: agentResult.status,
    replyText: agentResult.replyText,
    previewItems: agentResult.previewItems,
    previewStatus: agentResult.previewStatus,
    startedAt: agentResult.startedAt,
    endedAt: agentResult.endedAt,
    input: params.nodeInput,
  };

  const logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }> = [
    {
      level: 'info',
      message: `Agent "${agentId}" completed via OpenClaw`,
      data: {
        runId: agentResult.runId,
        sessionKey: agentResult.sessionKey,
        replyText: agentResult.replyText,
      },
    },
  ];

  if (agentResult.previewError) {
    logs.push({
      level: 'warn',
      message: `Agent "${agentId}" completed, but transcript preview could not be loaded`,
      data: {
        error: agentResult.previewError,
        sessionKey: agentResult.sessionKey,
      },
    });
  }

  return {
    output,
    result: output,
    logs,
  };
}

async function executeDefaultAgentSendNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const targetAgent = getStringConfig(params.node, 'targetAgent').trim();
  if (!targetAgent) {
    throw new Error('agent handoff node requires a target agent');
  }

  const currentDelegationDepth = readDelegationDepth(params.nodeInput);
  const maxDelegationDepth = parsePositiveIntegerConfig(
    params.node,
    'maxDelegationDepth',
    2,
    'Max delegation depth',
  );
  const nextDelegationDepth = currentDelegationDepth + 1;
  if (nextDelegationDepth > maxDelegationDepth) {
    throw new Error(
      `agent handoff node exceeded the max delegation depth of ${maxDelegationDepth}`,
    );
  }

  const configuredSessionKey = getStringConfig(params.node, 'sessionKey').trim();
  const sessionKey =
    configuredSessionKey ||
    buildFlowAgentSessionKey({
      agentId: targetAgent,
      flowId: params.flowId,
      runId: params.runId,
      nodeId: params.node.id,
    });
  const handoffReason = getStringConfig(params.node, 'handoffReason');
  const inputTemplate = getStringConfig(params.node, 'inputTemplate');
  const modelOverride = getStringConfig(params.node, 'modelOverride').trim();
  const waitTimeoutMs = parsePositiveIntegerConfig(
    params.node,
    'waitTimeoutMs',
    30_000,
    'Agent handoff wait timeout',
  );

  let agentResult: Awaited<ReturnType<typeof runOpenClawAgent>>;
  try {
    agentResult = await runOpenClawAgent({
      agentId: targetAgent,
      sessionKey,
      message: formatAgentSendMessage(params.nodeInput, targetAgent, handoffReason, inputTemplate),
      timeoutMs: waitTimeoutMs,
      idempotencyKey: `${params.runId}:${params.node.id}`,
      ...(handoffReason.trim().length > 0
        ? { extraSystemPrompt: `Treat this as a workflow handoff. ${handoffReason.trim()}` }
        : {}),
      ...(modelOverride ? { model: modelOverride } : {}),
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });
  } catch (error) {
    if (!isGatewayConnectivityFailure(error)) {
      throw error;
    }

    const offlineReason = errorMessage(error);
    const replyText = buildOfflineFallbackReplyText(targetAgent, 'Agent handoff');
    const output = {
      targetAgent,
      sessionKey,
      status: 'offline_fallback',
      delegatedRunStatus: 'succeeded' as const,
      handoffReason: handoffReason.trim() || undefined,
      model: modelOverride || undefined,
      delegationDepth: nextDelegationDepth,
      maxDelegationDepth,
      replyText,
      previewItems: [{ role: 'system', text: replyText }],
      previewStatus: 'offline_fallback',
      offlineFallback: true,
      offlineReason,
      coordination: {
        delegationDepth: nextDelegationDepth,
        maxDelegationDepth,
        parentRunId: params.runId,
        parentNodeId: params.node.id,
      },
      input: params.nodeInput,
    };

    return {
      output,
      result: output,
      logs: [
        {
          level: 'warn',
          message: `Delegation to agent "${targetAgent}" used an offline fallback because the OpenClaw gateway is unavailable`,
          data: {
            sessionKey,
            error: offlineReason,
            delegationDepth: nextDelegationDepth,
            maxDelegationDepth,
          },
        },
      ],
    };
  }

  const output = {
    targetAgent,
    gatewayRunId: agentResult.runId,
    sessionKey: agentResult.sessionKey,
    status: agentResult.status,
    delegatedRunStatus: 'succeeded' as const,
    handoffReason: handoffReason.trim() || undefined,
    model: modelOverride || undefined,
    delegationDepth: nextDelegationDepth,
    maxDelegationDepth,
    replyText: agentResult.replyText,
    previewItems: agentResult.previewItems,
    previewStatus: agentResult.previewStatus,
    startedAt: agentResult.startedAt,
    endedAt: agentResult.endedAt,
    coordination: {
      delegationDepth: nextDelegationDepth,
      maxDelegationDepth,
      parentRunId: params.runId,
      parentNodeId: params.node.id,
    },
    input: params.nodeInput,
  };

  const logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }> = [
    {
      level: 'info',
      message: `Delegated to agent "${targetAgent}" via OpenClaw`,
      data: {
        runId: agentResult.runId,
        sessionKey: agentResult.sessionKey,
        handoffReason: handoffReason.trim() || undefined,
        replyText: agentResult.replyText,
        delegationDepth: nextDelegationDepth,
        maxDelegationDepth,
      },
    },
  ];

  if (agentResult.previewError) {
    logs.push({
      level: 'warn',
      message: `Delegated agent "${targetAgent}" completed, but transcript preview could not be loaded`,
      data: {
        error: agentResult.previewError,
        sessionKey: agentResult.sessionKey,
      },
    });
  }

  return {
    output,
    result: output,
    logs,
  };
}

async function executeDefaultSkillNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const skillName = getStringConfig(params.node, 'skillName').trim();
  if (!skillName) {
    throw new Error('skill node requires a Skill name');
  }

  const agentId = getStringConfig(params.node, 'agentId').trim();
  const configuredSessionKey = getStringConfig(params.node, 'sessionKey').trim();
  const sessionKey =
    configuredSessionKey ||
    buildFlowSkillSessionKey({
      skillName,
      flowId: params.flowId,
      runId: params.runId,
      nodeId: params.node.id,
      ...(agentId ? { agentId } : {}),
    });
  const inputTemplate = getStringConfig(params.node, 'inputTemplate');
  const modelOverride = getStringConfig(params.node, 'modelOverride').trim();
  const waitTimeoutMs = parsePositiveIntegerConfig(
    params.node,
    'waitTimeoutMs',
    30_000,
    'Skill wait timeout',
  );

  let skillResult: Awaited<ReturnType<typeof runOpenClawSkill>>;
  try {
    skillResult = await runOpenClawSkill({
      skillName,
      sessionKey,
      message: formatSkillMessage(params.nodeInput, inputTemplate),
      timeoutMs: waitTimeoutMs,
      idempotencyKey: `${params.runId}:${params.node.id}`,
      ...(agentId ? { agentId } : {}),
      ...(modelOverride ? { model: modelOverride } : {}),
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });
  } catch (error) {
    if (!isGatewayConnectivityFailure(error)) {
      throw error;
    }

    const offlineReason = errorMessage(error);
    const replyText = buildOfflineFallbackReplyText(skillName, 'Skill execution');
    const output = {
      skillName,
      commandName: skillName,
      sessionKey,
      status: 'offline_fallback',
      sendStatus: 'offline_fallback',
      replyText,
      previewItems: [{ role: 'system', text: replyText }],
      previewStatus: 'offline_fallback',
      offlineFallback: true,
      offlineReason,
      input: params.nodeInput,
    };

    return {
      output,
      result: output,
      logs: [
        {
          level: 'warn',
          message: `Skill "${skillName}" used an offline fallback because the OpenClaw gateway is unavailable`,
          data: {
            sessionKey,
            agentId: agentId || undefined,
            error: offlineReason,
          },
        },
      ],
    };
  }

  const output = {
    skillName: skillResult.skillName,
    commandName: skillResult.commandName,
    sessionKey: skillResult.sessionKey,
    sessionId: skillResult.sessionId,
    gatewayRunId: skillResult.runId,
    status: skillResult.status,
    sendStatus: skillResult.sendStatus,
    replyText: skillResult.replyText,
    previewItems: skillResult.previewItems,
    previewStatus: skillResult.previewStatus,
    input: params.nodeInput,
  };

  const logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }> = [
    {
      level: 'info',
      message: `Skill "${skillResult.skillName}" completed via OpenClaw`,
      data: {
        commandName: skillResult.commandName,
        runId: skillResult.runId,
        sessionKey: skillResult.sessionKey,
        replyText: skillResult.replyText,
      },
    },
  ];

  if (skillResult.previewError) {
    logs.push({
      level: 'warn',
      message: `Skill "${skillResult.skillName}" completed, but transcript preview could not be loaded`,
      data: {
        error: skillResult.previewError,
        sessionKey: skillResult.sessionKey,
      },
    });
  }

  return {
    output,
    result: output,
    logs,
  };
}

async function executeDefaultHttpNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const method = normalizeHttpMethod(params.node);
  const rawUrl = getStringConfig(params.node, 'url');
  const url = renderInputTemplate(rawUrl, params.nodeInput).trim();
  if (!url) {
    throw new Error('HTTP request node requires a URL');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error(`HTTP request URL is invalid: ${errorMessage(error)}`);
  }

  const headers = parseTemplateRecord(
    getStringConfig(params.node, 'headersTemplate'),
    params.nodeInput,
    'HTTP headers',
  );
  const { body, bodyPreview, inferredJson } = buildHttpRequestBody(
    params.nodeInput,
    getStringConfig(params.node, 'bodyTemplate'),
  );
  const timeoutMs = parsePositiveIntegerConfig(params.node, 'timeoutMs', 30_000, 'HTTP timeout');
  const responseMode = getStringConfig(params.node, 'responseMode', 'auto').trim() || 'auto';
  const failOnHttpError = getBooleanConfig(params.node, 'failOnHttpError', true);

  if (
    body &&
    inferredJson &&
    !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')
  ) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const abortHandler = () => {
    controller.abort(params.abortSignal?.reason);
  };
  if (params.abortSignal?.aborted) {
    abortHandler();
  } else {
    params.abortSignal?.addEventListener('abort', abortHandler, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(parsedUrl, {
      method,
      headers,
      ...(body ? { body } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (params.abortSignal?.aborted) {
      throw createAbortError();
    }
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `HTTP request timed out after ${timeoutMs}ms`
        : `HTTP request failed: ${errorMessage(error)}`;
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
    params.abortSignal?.removeEventListener('abort', abortHandler);
  }

  if (params.abortSignal?.aborted) {
    throw createAbortError();
  }

  const responseHeaders = normalizeHttpResponseHeaders(response.headers);
  const parsedResponse = await parseHttpResponseBody(response, responseMode);

  const output = {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url || parsedUrl.toString(),
    method,
    headers: responseHeaders,
    body: parsedResponse.body,
    text: parsedResponse.text,
    json: parsedResponse.json,
    request: {
      method,
      url: parsedUrl.toString(),
      headers,
      body: bodyPreview,
    },
    input: params.nodeInput,
  };

  if (failOnHttpError && !response.ok) {
    throw new Error(
      `HTTP request failed with status ${response.status} ${response.statusText}`.trim(),
    );
  }

  return {
    output,
    result: output,
    logs: [
      {
        level: response.ok ? 'info' : 'warn',
        message: `HTTP ${method} ${parsedUrl.toString()} -> ${response.status}`,
        data: {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
        },
      },
    ],
  };
}

async function executeDefaultBrowserNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const action = getStringConfig(params.node, 'action', 'open').trim() || 'open';
  const rawTarget = getStringConfig(params.node, 'target');
  const target = renderInputTemplate(rawTarget, params.nodeInput).trim();
  const rawSelector =
    action === 'extract'
      ? getStringConfig(params.node, 'extractMode') || getStringConfig(params.node, 'waitFor')
      : action === 'click'
        ? getStringConfig(params.node, 'clickHint') || getStringConfig(params.node, 'waitFor')
        : '';
  const selector = renderInputTemplate(rawSelector, params.nodeInput).trim();
  const timeoutMs = parsePositiveIntegerConfig(params.node, 'timeoutMs', 30_000, 'Browser timeout');

  const browserResult = await runAdapterBrowser({
    action: action as 'open' | 'extract' | 'click',
    target,
    selector,
    timeoutMs,
    ...(params.abortSignal ? { signal: params.abortSignal } : {}),
  });

  const output = {
    ...browserResult,
    input: params.nodeInput,
  };

  return {
    output,
    result: output,
    logs: [
      {
        level: 'info',
        message: `Browser ${browserResult.action} completed with status ${browserResult.status}`,
        data: {
          finalUrl: browserResult.finalUrl,
          clickedTarget: browserResult.clickedTarget,
        },
      },
    ],
  };
}

async function executeDefaultWebSearchNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const provider = getStringConfig(params.node, 'provider', 'duckduckgo').trim() || 'duckduckgo';
  const rawQueryTemplate = getStringConfig(params.node, 'query');
  const query = renderInputTemplate(rawQueryTemplate, params.nodeInput).trim();
  const limit = parsePositiveIntegerConfig(params.node, 'limit', 5, 'Web search result limit');
  const outputMode = getStringConfig(params.node, 'outputMode', 'results').trim() || 'results';

  const searchResult = await runAdapterWebSearch({
    provider,
    query,
    limit,
    ...(params.abortSignal ? { signal: params.abortSignal } : {}),
  });

  const topResult = searchResult.results[0];
  const topResultUrl = topResult?.url;
  const envelope = {
    provider: searchResult.provider,
    query: searchResult.query,
    resultCount: searchResult.resultCount,
    answer: searchResult.answer,
    results: searchResult.results,
    topResult,
    topResultUrl,
    outputMode,
    input: params.nodeInput,
  };
  const output =
    outputMode === 'top-result-url'
      ? (topResultUrl ?? '')
      : outputMode === 'top-result'
        ? (topResult ?? null)
        : envelope;

  return {
    output,
    result: envelope,
    logs: [
      {
        level: 'info',
        message: `Web search returned ${searchResult.resultCount} result${searchResult.resultCount === 1 ? '' : 's'} from "${searchResult.provider}" in ${outputMode} mode`,
        data: {
          provider: searchResult.provider,
          query: searchResult.query,
          resultCount: searchResult.resultCount,
          outputMode,
          topResultUrl,
        },
      },
    ],
  };
}

async function executeDefaultShapePayloadNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const template = getStringConfig(params.node, 'template', '{{input}}');
  const outputMode = getStringConfig(params.node, 'outputMode', 'replace').trim() || 'replace';
  const outputPath = getStringConfig(params.node, 'outputPath');
  const resolved = resolveTemplateValue(template, params.nodeInput);
  const output = buildShapePayloadOutput(params.nodeInput, outputMode, outputPath, resolved);

  return {
    output,
    result: {
      outputMode,
      outputPath: outputPath.trim() || undefined,
      resolved,
      output,
    },
    logs: [
      {
        level: 'info',
        message:
          outputMode === 'assign'
            ? `Shape Payload assigned a value to "${outputPath.trim()}"`
            : `Shape Payload applied ${outputMode} mode`,
        data: {
          outputMode,
          outputPath: outputPath.trim() || undefined,
        },
      },
    ],
  };
}

export async function executeDefaultYouTubeTranscriptNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  transcriptApiKey?: string;
  transcriptApiBaseUrl?: string;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const explicitVideo = renderInputTemplate(getStringConfig(params.node, 'video'), params.nodeInput)
    .trim();
  const videoPath = getStringConfig(params.node, 'videoPath', 'videoId').trim() || 'videoId';
  const source =
    explicitVideo ||
    getStringPathValue(params.nodeInput, videoPath) ||
    getFirstStringPathValue(params.nodeInput, ['videoId', 'videoUrl', 'url', 'input.videoId', 'input.url']);
  if (!source) {
    throw new Error('YouTube Transcript could not resolve a video ID or URL from the payload.');
  }

  const languageConfig = getStringConfig(params.node, 'languages', 'en');
  const languages = languageConfig
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const provider =
    getStringConfig(params.node, 'provider', 'transcriptapi').trim() || 'transcriptapi';
  const preserveFormatting = getBooleanConfig(params.node, 'preserveFormatting', false);
  const includeSegments = getBooleanConfig(params.node, 'includeSegments', true);
  const outputMode = getStringConfig(params.node, 'outputMode', 'merge').trim() || 'merge';
  const transcript =
    provider === 'youtube-transcript-api' || provider === 'captions'
      ? await fetchYouTubeTranscript({
          videoIdOrUrl: source,
          languages,
          preserveFormatting,
          ...(params.abortSignal ? { signal: params.abortSignal } : {}),
        })
      : await fetchTranscriptApiYouTubeTranscript({
          videoIdOrUrl: source,
          format: outputMode === 'transcript-only' ? 'text' : 'json',
          includeTimestamp: outputMode === 'transcript-only' ? false : includeSegments,
          sendMetadata: true,
          ...(params.transcriptApiKey ? { apiKey: params.transcriptApiKey } : {}),
          ...(params.transcriptApiBaseUrl ? { baseUrl: params.transcriptApiBaseUrl } : {}),
          ...(params.abortSignal ? { signal: params.abortSignal } : {}),
        });
  const envelope = {
    ...transcript,
    ...(includeSegments ? {} : { segments: undefined }),
    requestedLanguages: languages.length > 0 ? languages : ['en'],
    input: params.nodeInput,
  };
  const output =
    outputMode === 'transcript-only'
      ? transcript.transcript
      : outputMode === 'replace'
        ? envelope
        : mergeObjectOutput(params.nodeInput, {
            youtube: {
              transcript: envelope,
            },
            youtubeTranscript: envelope,
          });

  return {
    output,
    result: {
      ...envelope,
      output,
    },
    logs: [
      {
        level: 'info',
        message: `Fetched YouTube transcript for "${transcript.videoId}" with ${transcript.segmentCount} segment${transcript.segmentCount === 1 ? '' : 's'}`,
        data: {
          videoId: transcript.videoId,
          provider: transcript.provider ?? provider,
          language: transcript.language,
          segmentCount: transcript.segmentCount,
          characterCount: transcript.characterCount,
          outputMode,
        },
      },
    ],
  };
}

export async function executeDefaultTranscriptApiNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  transcriptApiKey?: string;
  transcriptApiBaseUrl?: string;
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
}> {
  const explicitVideo = renderInputTemplate(getStringConfig(params.node, 'video'), params.nodeInput)
    .trim();
  const videoPath = getStringConfig(params.node, 'videoPath', 'url').trim() || 'url';
  const source =
    explicitVideo ||
    getStringPathValue(params.nodeInput, videoPath) ||
    getFirstStringPathValue(params.nodeInput, ['url', 'videoUrl', 'videoId', 'input.url', 'input.videoUrl', 'input.videoId']);
  if (!source) {
    throw new Error('TranscriptAPI node could not resolve a YouTube URL or video ID from the payload.');
  }

  const includeSegments = getBooleanConfig(params.node, 'includeSegments', true);
  const outputMode = getStringConfig(params.node, 'outputMode', 'merge').trim() || 'merge';
  const transcript = await fetchTranscriptApiYouTubeTranscript({
    videoIdOrUrl: source,
    format: outputMode === 'transcript-only' ? 'text' : 'json',
    includeTimestamp: outputMode === 'transcript-only' ? false : includeSegments,
    sendMetadata: true,
    ...(params.transcriptApiKey ? { apiKey: params.transcriptApiKey } : {}),
    ...(params.transcriptApiBaseUrl ? { baseUrl: params.transcriptApiBaseUrl } : {}),
    ...(params.abortSignal ? { signal: params.abortSignal } : {}),
  });
  const envelope = {
    ...transcript,
    ...(includeSegments ? {} : { segments: undefined }),
    input: params.nodeInput,
  };
  const output =
    outputMode === 'transcript-only'
      ? transcript.transcript
      : outputMode === 'replace'
        ? envelope
        : mergeObjectOutput(params.nodeInput, {
            transcriptapi: envelope,
            youtube: {
              transcript: envelope,
            },
            youtubeTranscript: envelope,
          });

  return {
    output,
    result: {
      ...envelope,
      output,
    },
    logs: [
      {
        level: 'info',
        message: `Fetched TranscriptAPI transcript for "${transcript.videoId}" with ${transcript.segmentCount} segment${transcript.segmentCount === 1 ? '' : 's'}`,
        data: {
          videoId: transcript.videoId,
          provider: transcript.provider,
          title: transcript.title,
          duration: transcript.duration,
          segmentCount: transcript.segmentCount,
          characterCount: transcript.characterCount,
          outputMode,
        },
      },
    ],
  };
}

async function executeDefaultExecNode(params: {
  runId: string;
  flowId: string;
  flowVersion: number;
  node: GraphNode;
  nodeInput: unknown;
  now: () => Date;
  execPolicy?: WorkspaceExecPolicy;
  execApproval?: ExecutionQueueItem['execApproval'];
  abortSignal?: AbortSignal;
}): Promise<{
  output: unknown;
  result: unknown;
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }>;
  waitUntil?: Date;
  approvalRequest?: {
    requestType: 'control' | 'exec';
    reason?: string;
    timeoutSeconds: number;
    command?: string;
    approvalMode?: 'ask' | 'elevated' | 'trusted';
    rejectionError?: string;
    timeoutError?: string;
  };
  emitFinishedEvent?: boolean;
  approvedQueue?: ExecutionQueueItem[];
  rejectedQueue?: ExecutionQueueItem[];
}> {
  const rawCommand = getStringConfig(params.node, 'command');
  const command = renderInputTemplate(rawCommand, params.nodeInput).trim();
  if (!command) {
    throw new Error('exec node requires a command');
  }

  const approvalMode = getStringConfig(params.node, 'approvalMode', 'ask').trim() || 'ask';
  const normalizedApprovalMode =
    approvalMode === 'trusted' || approvalMode === 'elevated' ? approvalMode : 'ask';
  if (
    normalizedApprovalMode !== 'trusted' &&
    !hasApprovedExecGrant(params, {
      nodeId: params.node.id,
      command,
      approvalMode: normalizedApprovalMode,
    })
  ) {
    const timeoutSeconds = parsePositiveIntegerConfig(
      params.node,
      'approvalTimeoutSeconds',
      300,
      'Exec approval timeout',
    );
    const waitUntil = new Date(params.now().getTime() + timeoutSeconds * 1000);
    const modeLabel =
      normalizedApprovalMode === 'elevated' ? 'Require elevated' : 'Ask before execution';
    const reason =
      getStringConfig(params.node, 'approvalReason').trim() || `${modeLabel}: ${command}`;

    return {
      output: params.nodeInput,
      result: {
        pendingApproval: true,
        command,
        approvalMode: normalizedApprovalMode,
        timeoutSeconds,
        waitUntil: waitUntil.toISOString(),
      },
      logs: [
        {
          level: normalizedApprovalMode === 'elevated' ? 'warn' : 'info',
          message: 'Exec command is waiting for approval before execution.',
          data: {
            command,
            approvalMode: normalizedApprovalMode,
            timeoutSeconds,
          },
        },
      ],
      waitUntil,
      emitFinishedEvent: false,
      approvedQueue: [
        {
          nodeId: params.node.id,
          input: params.nodeInput,
          execApproval: {
            nodeId: params.node.id,
            command,
            approvalMode: normalizedApprovalMode,
          },
        },
      ],
      rejectedQueue: [],
      approvalRequest: {
        requestType: 'exec',
        reason,
        timeoutSeconds,
        command,
        approvalMode: normalizedApprovalMode,
        rejectionError: `Exec command "${command}" was rejected and did not run.`,
        timeoutError: `Exec approval timed out before command "${command}" could run.`,
      },
    };
  }

  const timeoutMs = parsePositiveIntegerConfig(params.node, 'timeoutMs', 30_000, 'Exec timeout');
  const execResult = await runAdapterExec(
    {
      command,
      approvalMode: normalizedApprovalMode,
      timeoutMs,
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    },
    params.execPolicy,
  );

  const output = {
    ok: true,
    command: execResult.command,
    approvalMode: execResult.approvalMode,
    shell: execResult.shell,
    cwd: execResult.cwd,
    timeoutMs: execResult.timeoutMs,
    durationMs: execResult.durationMs,
    exitCode: execResult.exitCode,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    elevatedRequested: execResult.elevatedRequested,
    input: params.nodeInput,
  };

  const logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    data?: unknown;
  }> = [
    {
      level: 'info',
      message: `Exec command completed with exit code ${execResult.exitCode}`,
      data: {
        shell: execResult.shell,
        durationMs: execResult.durationMs,
        approvalMode: execResult.approvalMode,
      },
    },
  ];

  if (execResult.elevatedRequested) {
    logs.push({
      level: 'warn',
      message:
        'Exec node requested elevated mode, but the wrapper executed under the adapter account without OS privilege escalation.',
    });
  }

  return {
    output,
    result: output,
    logs,
  };
}

async function executeNode(
  input: ExecuteFlowInput,
  node: GraphNode,
  current: ExecutionQueueItem,
  now: () => Date,
): Promise<NodeExecutionResult> {
  const nodeInput = current.input;
  switch (node.type) {
    case 'trigger.webhook':
    case 'trigger.channel':
    case 'trigger.cron':
    case 'trigger.hook':
    case 'trigger.task':
    case 'trigger.standing-order':
      return {
        output: nodeInput,
        nextPorts: ['out'],
        result: { output: nodeInput, nextPorts: ['out'] },
      };

    case 'logic.branch': {
      const branchMode = getStringConfig(node, 'branchMode', 'auto');
      const fieldPath = getStringConfig(node, 'fieldPath');
      const equalsValue = getStringConfig(node, 'equalsValue');

      let branchInput = nodeInput;
      let branch: 'true' | 'false';

      if (branchMode === 'path_truthy') {
        if (!fieldPath.trim()) {
          throw new Error('branch node requires a field path when using "Check field is truthy"');
        }
        branchInput = getPathValue(nodeInput, fieldPath);
        branch = toBooleanBranch(branchInput) ? 'true' : 'false';
      } else if (branchMode === 'path_equals') {
        if (!fieldPath.trim()) {
          throw new Error('branch node requires a field path when using "Field equals value"');
        }
        branchInput = getPathValue(nodeInput, fieldPath);
        branch = comparePathValue(branchInput, equalsValue) ? 'true' : 'false';
      } else {
        branch = toBooleanBranch(nodeInput) ? 'true' : 'false';
      }

      const branchAt = now();
      return {
        output: nodeInput,
        nextPorts: [branch],
        extraEvents: [
          {
            eventType: 'run.log',
            event: {
              type: 'run.log',
              runId: input.runId,
              at: branchAt.toISOString(),
              level: 'info',
              nodeId: node.id,
              message: `Branch selected "${branch}"`,
              data: {
                branch,
                mode: branchMode,
                fieldPath: fieldPath || undefined,
                evaluatedValue: branchInput,
                input: nodeInput,
              },
            },
            createdAt: branchAt,
          },
        ],
        result: {
          output: nodeInput,
          branch,
          mode: branchMode,
          fieldPath: fieldPath || undefined,
          evaluatedValue: branchInput,
          nextPorts: [branch],
        },
      };
    }

    case 'action.agent': {
      const executeAgentNode = input.executeAgentNode ?? executeDefaultAgentNode;
      const agentExecution = await executeAgentNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of agentExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: agentExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: agentExecution.result,
      };
    }

    case 'action.agent-send': {
      const executeAgentSendNode = input.executeAgentSendNode ?? executeDefaultAgentSendNode;
      const handoffExecution = await executeAgentSendNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      const delegationAt = now();
      const delegationEvent = buildAgentSendDelegationEvent({
        runId: input.runId,
        nodeId: node.id,
        node,
        handoffExecution,
        createdAt: delegationAt,
      });
      if (delegationEvent) {
        extraEvents.push(delegationEvent);
      }
      const delegatedRun = buildDelegatedRunRecord({
        runId: input.runId,
        nodeId: node.id,
        node,
        handoffExecution,
        createdAt: delegationAt,
      });
      for (const log of handoffExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: handoffExecution.output,
        nextPorts: ['out'],
        extraEvents,
        ...(delegatedRun ? { delegatedRuns: [delegatedRun] } : {}),
        result: handoffExecution.result,
      };
    }

    case 'action.skill': {
      const executeSkillNode = input.executeSkillNode ?? executeDefaultSkillNode;
      const skillExecution = await executeSkillNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of skillExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: skillExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: skillExecution.result,
      };
    }

    case 'action.http': {
      const executeHttpNode = input.executeHttpNode ?? executeDefaultHttpNode;
      const httpExecution = await executeHttpNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of httpExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: httpExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: httpExecution.result,
      };
    }

    case 'tool.browser': {
      const executeBrowserNode = input.executeBrowserNode ?? executeDefaultBrowserNode;
      const browserExecution = await executeBrowserNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of browserExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: browserExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: browserExecution.result,
      };
    }

    case 'tool.web-search': {
      const executeWebSearchNode = input.executeWebSearchNode ?? executeDefaultWebSearchNode;
      const searchExecution = await executeWebSearchNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of searchExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: searchExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: searchExecution.result,
      };
    }

    case 'tool.youtube-transcript': {
      const executeYouTubeTranscriptNode =
        input.executeYouTubeTranscriptNode ?? executeDefaultYouTubeTranscriptNode;
      const transcriptExecution = await executeYouTubeTranscriptNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of transcriptExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: transcriptExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: transcriptExecution.result,
      };
    }

    case 'tool.transcriptapi': {
      const executeTranscriptApiNode =
        input.executeTranscriptApiNode ?? executeDefaultTranscriptApiNode;
      const transcriptExecution = await executeTranscriptApiNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of transcriptExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: transcriptExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: transcriptExecution.result,
      };
    }

    case 'tool.exec': {
      const executeExecNode = input.executeExecNode ?? executeDefaultExecNode;
      const execExecution = await executeExecNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        now,
        execPolicy: input.execPolicy,
        execApproval: current.execApproval,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of execExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: execExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: execExecution.result,
        waitUntil: execExecution.waitUntil,
        emitFinishedEvent: execExecution.emitFinishedEvent,
        approvedQueue: execExecution.approvedQueue,
        rejectedQueue: execExecution.rejectedQueue,
        approvalRequest: execExecution.approvalRequest,
      };
    }

    case 'tool.payload-template': {
      const executeShapePayloadNode =
        input.executeShapePayloadNode ?? executeDefaultShapePayloadNode;
      const shapeExecution = await executeShapePayloadNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of shapeExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: shapeExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: shapeExecution.result,
      };
    }

    case 'action.channel-reply': {
      const executeChannelReplyNode =
        input.executeChannelReplyNode ?? executeDefaultChannelReplyNode;
      const channelReplyExecution = await executeChannelReplyNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of channelReplyExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: channelReplyExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: channelReplyExecution.result,
      };
    }

    case 'action.channel-route': {
      const executeChannelRouteNode =
        input.executeChannelRouteNode ?? executeDefaultChannelRouteNode;
      const channelRouteExecution = await executeChannelRouteNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
        abortSignal: input.abortSignal,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of channelRouteExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: channelRouteExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: channelRouteExecution.result,
      };
    }

    case 'action.log': {
      const logAt = now();
      const logLevel = getStringConfig(node, 'logLevel', 'info');
      const message = getStringConfig(node, 'message').trim();
      const includeInput = getBooleanConfig(node, 'includeInput', true);
      const label =
        typeof node.data.label === 'string' && node.data.label.trim().length > 0
          ? node.data.label
          : 'Log';
      const prefix = message || label;
      const logMessage = includeInput ? `${prefix}: ${stringifyValue(nodeInput)}` : prefix;

      return {
        output: nodeInput,
        nextPorts: [],
        extraEvents: [
          {
            eventType: 'run.log',
            event: {
              type: 'run.log',
              runId: input.runId,
              at: logAt.toISOString(),
              level:
                logLevel === 'debug' || logLevel === 'warn' || logLevel === 'error'
                  ? logLevel
                  : 'info',
              nodeId: node.id,
              message: logMessage,
              data: includeInput ? nodeInput : undefined,
            },
            createdAt: logAt,
          },
        ],
        result: {
          output: nodeInput,
          logged: true,
          level: logLevel,
          message: logMessage,
          includeInput,
          nextPorts: [],
        },
      };
    }

    case 'ops.usage': {
      const usageExecution = await executeDefaultUsageNode({
        node,
        nodeInput,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of usageExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: usageExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: usageExecution.result,
      };
    }

    case 'control.wait': {
      const waitExecution = await executeDefaultWaitNode({ node, nodeInput, now });
      return {
        output: waitExecution.output,
        nextPorts: ['out'],
        result: waitExecution.result,
        waitUntil: waitExecution.waitUntil,
        waitDurationSeconds: waitExecution.waitDurationSeconds,
      };
    }

    case 'control.approval': {
      const approvalExecution = await executeDefaultApprovalNode({ node, nodeInput, now });
      return {
        output: approvalExecution.output,
        nextPorts: ['approved', 'rejected'],
        result: approvalExecution.result,
        waitUntil: approvalExecution.waitUntil,
        approvalRequest: approvalExecution.approvalRequest,
      };
    }

    case 'context.thread-bind': {
      const executeThreadBindNode = input.executeThreadBindNode ?? executeDefaultThreadBindNode;
      const bindExecution = await executeThreadBindNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of bindExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: bindExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: bindExecution.result,
      };
    }

    case 'context.memory-write': {
      const executeMemoryWriteNode = input.executeMemoryWriteNode ?? executeDefaultMemoryWriteNode;
      const memoryWriteExecution = await executeMemoryWriteNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of memoryWriteExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: memoryWriteExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: memoryWriteExecution.result,
      };
    }

    case 'context.memory-query': {
      const executeMemoryQueryNode = input.executeMemoryQueryNode ?? executeDefaultMemoryQueryNode;
      const memoryQueryExecution = await executeMemoryQueryNode({
        runId: input.runId,
        flowId: input.flowId,
        flowVersion: input.flowVersion,
        node,
        nodeInput,
      });

      const extraEvents: PendingRunEvent[] = [];
      for (const log of memoryQueryExecution.logs ?? []) {
        const logAt = now();
        extraEvents.push({
          eventType: 'run.log',
          event: {
            type: 'run.log',
            runId: input.runId,
            at: logAt.toISOString(),
            level: log.level,
            nodeId: node.id,
            message: log.message,
            data: log.data,
          },
          createdAt: logAt,
        });
      }

      return {
        output: memoryQueryExecution.output,
        nextPorts: ['out'],
        extraEvents,
        result: memoryQueryExecution.result,
      };
    }

    default:
      throw new Error(`unsupported node type: ${node.type}`);
  }
}

export async function executePublishedFlow(input: ExecuteFlowInput): Promise<ExecuteFlowResult> {
  const now = input.now ?? (() => new Date());
  const events: PendingRunEvent[] = [];
  const delegatedRuns: PendingDelegatedRun[] = [];
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const outgoingByNodeId = new Map<string, GraphEdge[]>();
  for (const edge of input.edges) {
    const bucket = outgoingByNodeId.get(edge.source) ?? [];
    bucket.push(edge);
    outgoingByNodeId.set(edge.source, bucket);
  }

  let queue: ExecutionQueueItem[];
  let visited: Set<string>;
  let lastOutput: unknown;

  const returnCancelled = (): ExecuteFlowResult => ({
    status: 'cancelled',
    output: lastOutput,
    events,
    delegatedRuns,
  });

  const wasCancelled = async (): Promise<boolean> => {
    if (input.abortSignal?.aborted) return true;
    if (!input.checkCancellation) return false;
    return input.checkCancellation();
  };

  if (input.resumeState) {
    queue = input.resumeState.queue.map((item) => normalizeQueueItem(item));
    visited = new Set(input.resumeState.visitedNodeIds);
    lastOutput = input.resumeState.lastOutput;
  } else {
    const entryResolution = resolveExecutionEntryTrigger(input.nodes, input.trigger, input.input);
    if ('error' in entryResolution) {
      const finishedAt = now();
      const error = entryResolution.error;
      pushEvent(
        events,
        'run.finished',
        {
          type: 'run.finished',
          runId: input.runId,
          at: finishedAt.toISOString(),
          status: 'failed',
          error,
        },
        finishedAt,
      );
      return { status: 'failed', error, events, delegatedRuns };
    }

    const entryNode = entryResolution.node;
    queue = [{ nodeId: entryNode.id, input: input.input, pathNodeIds: [entryNode.id] }];
    visited = new Set<string>();
    lastOutput = input.input;
  }

  while (queue.length > 0) {
    if (await wasCancelled()) {
      return returnCancelled();
    }

    const current = queue.shift();
    if (!current) break;

    const node = nodesById.get(current.nodeId);
    if (!node) {
      const failedAt = now();
      const error = `node "${current.nodeId}" not found in published flow`;
      pushEvent(
        events,
        'run.finished',
        {
          type: 'run.finished',
          runId: input.runId,
          at: failedAt.toISOString(),
          status: 'failed',
          error,
        },
        failedAt,
      );
      return { status: 'failed', error, events, delegatedRuns, output: lastOutput };
    }

    visited.add(node.id);

    const startedAt = now();
    pushEvent(
      events,
      'node.started',
      {
        type: 'node.started',
        runId: input.runId,
        nodeId: node.id,
        at: startedAt.toISOString(),
      },
      startedAt,
    );

    try {
      const result = await executeNode(input, node, current, now);
      if (result.extraEvents) events.push(...result.extraEvents);
      if (result.delegatedRuns) delegatedRuns.push(...result.delegatedRuns);

      if (result.emitFinishedEvent !== false) {
        const finishedAt = now();
        pushEvent(
          events,
          'node.finished',
          {
            type: 'node.finished',
            runId: input.runId,
            nodeId: node.id,
            at: finishedAt.toISOString(),
            result: result.result,
          },
          finishedAt,
        );
      }

      lastOutput = result.output;

      if (await wasCancelled()) {
        return returnCancelled();
      }

      const outgoingEdges = outgoingByNodeId.get(node.id) ?? [];
      const nextEdges = outgoingEdges.filter((edge) => result.nextPorts.includes(edge.sourcePort));
      const nextQueueResolution = buildQueuedEdgeItems({
        current,
        nextEdges,
        output: result.output,
      });
      if ('error' in nextQueueResolution) {
        const failedAt = now();
        pushEvent(
          events,
          'run.finished',
          {
            type: 'run.finished',
            runId: input.runId,
            at: failedAt.toISOString(),
            status: 'failed',
            error: nextQueueResolution.error,
          },
          failedAt,
        );
        return {
          status: 'failed',
          error: nextQueueResolution.error,
          events,
          delegatedRuns,
          output: lastOutput,
        };
      }
      const nextQueueItems = nextQueueResolution.items;
      if (result.waitUntil && result.waitDurationSeconds) {
        for (const item of nextQueueItems) {
          queue.push(item);
        }
        const waitingAt = now();
        pushEvent(
          events,
          'run.waiting',
          {
            type: 'run.waiting',
            runId: input.runId,
            nodeId: node.id,
            at: waitingAt.toISOString(),
            resumeAt: result.waitUntil.toISOString(),
            durationSeconds: result.waitDurationSeconds,
          },
          waitingAt,
        );
        return {
          status: 'waiting',
          output: lastOutput,
          events,
          delegatedRuns,
          resumeAt: result.waitUntil,
          continuation: {
            queue: queue.map((item) => cloneQueueItem(item)),
            visitedNodeIds: [...visited],
            lastOutput,
            waiting: {
              kind: 'timer',
              nodeId: node.id,
              resumeAt: result.waitUntil.toISOString(),
              durationSeconds: result.waitDurationSeconds,
            },
          },
        };
      }
      if (result.waitUntil && result.approvalRequest) {
        const requestedAt = now();
        const timeoutAt = result.waitUntil.toISOString();
        pushEvent(
          events,
          'run.approval.requested',
          {
            type: 'run.approval.requested',
            runId: input.runId,
            nodeId: node.id,
            at: requestedAt.toISOString(),
            reason: result.approvalRequest.reason,
            timeoutAt,
          },
          requestedAt,
        );
        pushEvent(
          events,
          'run.waiting',
          {
            type: 'run.waiting',
            runId: input.runId,
            nodeId: node.id,
            at: requestedAt.toISOString(),
            resumeAt: timeoutAt,
            durationSeconds: result.approvalRequest.timeoutSeconds,
          },
          requestedAt,
        );

        const approvedQueue =
          result.approvedQueue ??
          (() => {
            const approvedResolution = buildQueuedEdgeItems({
              current,
              nextEdges: outgoingEdges.filter((edge) => edge.sourcePort === 'approved'),
              output: result.output,
            });
            if ('error' in approvedResolution) {
              throw new Error(approvedResolution.error);
            }
            return approvedResolution.items;
          })();
        const rejectedQueue =
          result.rejectedQueue ??
          (() => {
            const rejectedResolution = buildQueuedEdgeItems({
              current,
              nextEdges: outgoingEdges.filter((edge) => edge.sourcePort === 'rejected'),
              output: result.output,
            });
            if ('error' in rejectedResolution) {
              throw new Error(rejectedResolution.error);
            }
            return rejectedResolution.items;
          })();
        const visitedNodeIds =
          result.emitFinishedEvent === false
            ? [...visited].filter((visitedNodeId) => visitedNodeId !== node.id)
            : [...visited];
        const resumedPathNodeIds = current.pathNodeIds ?? [current.nodeId];

        const waiting: RunContinuationWaitingApproval = {
          kind: 'approval',
          nodeId: node.id,
          requestType: result.approvalRequest.requestType,
          requestedAt: requestedAt.toISOString(),
          timeoutAt,
          timeoutSeconds: result.approvalRequest.timeoutSeconds,
          reason: result.approvalRequest.reason,
          command: result.approvalRequest.command,
          approvalMode: result.approvalRequest.approvalMode,
          rejectionError: result.approvalRequest.rejectionError,
          timeoutError: result.approvalRequest.timeoutError,
          approvedQueue: attachQueuePathDefaults(approvedQueue, resumedPathNodeIds),
          rejectedQueue: attachQueuePathDefaults(rejectedQueue, resumedPathNodeIds),
        };

        return {
          status: 'waiting',
          output: result.output,
          events,
          delegatedRuns,
          resumeAt: result.waitUntil,
          continuation: {
            queue: [],
            visitedNodeIds,
            lastOutput: result.output,
            waiting,
          },
        };
      }
      for (const item of nextQueueItems) {
        queue.push(item);
      }
    } catch (error) {
      if (isAbortError(error) || input.abortSignal?.aborted) {
        appendAbortRelayEvents({
          events,
          runId: input.runId,
          nodeId: node.id,
          error,
        });
        return returnCancelled();
      }

      const message = error instanceof Error ? error.message : String(error);
      const failedAt = now();
      pushEvent(
        events,
        'node.failed',
        {
          type: 'node.failed',
          runId: input.runId,
          nodeId: node.id,
          at: failedAt.toISOString(),
          error: message,
        },
        failedAt,
      );
      pushEvent(
        events,
        'run.finished',
        {
          type: 'run.finished',
          runId: input.runId,
          at: failedAt.toISOString(),
          status: 'failed',
          error: message,
        },
        failedAt,
      );
      return { status: 'failed', error: message, events, delegatedRuns, output: lastOutput };
    }
  }

  if (await wasCancelled()) {
    return returnCancelled();
  }

  const finishedAt = now();
  pushEvent(
    events,
    'run.finished',
    {
      type: 'run.finished',
      runId: input.runId,
      at: finishedAt.toISOString(),
      status: 'succeeded',
    },
    finishedAt,
  );
  return { status: 'succeeded', output: lastOutput, events, delegatedRuns };
}
