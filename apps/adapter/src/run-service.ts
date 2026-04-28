import {
  resolveExecutionEntryTrigger,
  validateExecutableFlowGraph,
  validateFlowSemantics,
} from '@openclaw-wrapper/schemas';
import type {
  ApprovalDecision,
  AutomationTaskFlowStatus,
  AutomationTaskRole,
  Run,
  RunApprovalRequest,
  RunApprovalRequestStatus,
  RunContinuationState,
  RunEventRecord,
  RunTrigger,
} from '@openclaw-wrapper/schemas';
import type { DelegatedRunRecord, RunLineage } from '@openclaw-wrapper/schemas/run';
import { and, asc, desc, eq } from 'drizzle-orm';
import { syncAutomationRunState, trackAutomationRunStarted } from './automation-service.js';
import { getChannelExecutionProfile, loadTranscriptApiProfileSettings } from './channel-profiles.js';
import type { Db } from './db/client.js';
import {
  automationTaskFlows,
  automationTasks,
  flowVersions,
  flows,
  runApprovalRequests,
  runDelegations,
  runEvents,
  runs,
  workspaceAuditEvents,
  workspaces,
} from './db/schema.js';
import {
  executeChannelReplyNodeWithProfile,
  executeChannelRouteNodeWithProfile,
  executeDefaultYouTubeTranscriptNode,
  executeDefaultTranscriptApiNode,
  executeDefaultThreadBindNode,
  executeMemoryWriteNodeWithPersistence,
  executePublishedFlow,
} from './flow-executor.js';
import type { PendingDelegatedRun } from './flow-executor.js';
import {
  loadPersistedMemory,
  mergePersistedMemoryIntoInput,
  persistMemoryWrite,
  queryPersistedMemory,
} from './memory-store.js';
import {
  loadCachedYouTubeTranscript,
  saveCachedYouTubeTranscript,
} from './youtube-transcript-cache.js';
import { extractYouTubeVideoId, type YouTubeTranscriptResult } from './youtube-transcript.js';

type ApprovalRequestDb = Pick<Db, 'insert' | 'select' | 'update'>;

function getPathValue(input: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  let current = input;
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function getStringPathValue(input: unknown, path: string): string | undefined {
  const value = getPathValue(input, path);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function renderRuntimeTemplate(template: string, input: unknown): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, rawPath: string) => {
    const value = rawPath === 'input' ? input : getPathValue(input, rawPath);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  });
}

function resolveTranscriptSource(params: {
  nodeInput: unknown;
  nodeData: Record<string, unknown>;
  defaultPath: string;
  fallbackPaths: string[];
}): string | undefined {
  const explicitVideo =
    typeof params.nodeData.video === 'string'
      ? renderRuntimeTemplate(params.nodeData.video, params.nodeInput).trim()
      : '';
  if (explicitVideo) return explicitVideo;

  const configuredPath =
    typeof params.nodeData.videoPath === 'string' && params.nodeData.videoPath.trim()
      ? params.nodeData.videoPath.trim()
      : params.defaultPath;
  return (
    getStringPathValue(params.nodeInput, configuredPath) ??
    params.fallbackPaths
      .map((path) => getStringPathValue(params.nodeInput, path))
      .find((value): value is string => !!value)
  );
}

function mergeObjectOutput(
  input: unknown,
  additions: Record<string, unknown>,
): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? { ...(input as Record<string, unknown>), ...additions }
    : { input, ...additions };
}

function buildCachedTranscriptExecution(params: {
  nodeInput: unknown;
  outputMode: string;
  includeSegments: boolean;
  transcript: YouTubeTranscriptResult & { cacheHit?: boolean };
  cacheLabel: string;
}): {
  output: unknown;
  result: unknown;
  logs: Array<{ level: 'debug' | 'info' | 'warn' | 'error'; message: string; data?: unknown }>;
} {
  const envelope = {
    ...params.transcript,
    ...(params.includeSegments ? {} : { segments: undefined }),
    input: params.nodeInput,
    cacheHit: true,
  };
  const output =
    params.outputMode === 'transcript-only'
      ? params.transcript.transcript
      : params.outputMode === 'replace'
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
        message: `Reused cached ${params.cacheLabel} transcript for "${params.transcript.videoId}"`,
        data: {
          videoId: params.transcript.videoId,
          provider: params.transcript.provider,
          segmentCount: params.transcript.segmentCount,
          characterCount: params.transcript.characterCount,
          outputMode: params.outputMode,
          cacheHit: true,
        },
      },
    ],
  };
}

function readTranscriptExecutionResult(value: unknown): YouTubeTranscriptResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.videoId !== 'string' ||
    typeof record.videoUrl !== 'string' ||
    typeof record.transcript !== 'string'
  ) {
    return undefined;
  }
  const segments = Array.isArray(record.segments)
    ? record.segments
        .map((segment) =>
          segment && typeof segment === 'object' && !Array.isArray(segment)
            ? {
                text: String((segment as Record<string, unknown>).text ?? '').trim(),
                start: Number((segment as Record<string, unknown>).start ?? 0),
                duration: Number((segment as Record<string, unknown>).duration ?? 0),
              }
            : undefined,
        )
        .filter((segment): segment is { text: string; start: number; duration: number } =>
          Boolean(segment?.text),
        )
    : [];

  return {
    videoId: record.videoId,
    videoUrl: record.videoUrl,
    provider: typeof record.provider === 'string' ? record.provider : 'transcriptapi',
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.duration === 'string' ? { duration: record.duration } : {}),
    ...(typeof record.language === 'string' ? { language: record.language } : {}),
    transcript: record.transcript,
    segments,
    segmentCount:
      typeof record.segmentCount === 'number' ? record.segmentCount : segments.length,
    characterCount:
      typeof record.characterCount === 'number' ? record.characterCount : record.transcript.length,
  };
}

const RUN_ROW = {
  id: runs.id,
  workspaceId: runs.workspaceId,
  flowId: runs.flowId,
  flowVersionId: runs.flowVersionId,
  flowVersion: runs.flowVersion,
  status: runs.status,
  trigger: runs.trigger,
  input: runs.input,
  output: runs.output,
  continuation: runs.continuation,
  createdAt: runs.createdAt,
  startedAt: runs.startedAt,
  resumeAt: runs.resumeAt,
  finishedAt: runs.finishedAt,
  error: runs.error,
};

const RUN_EVENT_ROW = {
  id: runEvents.id,
  runId: runEvents.runId,
  sequence: runEvents.sequence,
  eventType: runEvents.eventType,
  event: runEvents.event,
  createdAt: runEvents.createdAt,
};

const RUN_DELEGATION_ROW = {
  id: runDelegations.id,
  parentRunId: runDelegations.parentRunId,
  parentNodeId: runDelegations.parentNodeId,
  delegationKind: runDelegations.delegationKind,
  depth: runDelegations.depth,
  targetAgent: runDelegations.targetAgent,
  sessionKey: runDelegations.sessionKey,
  gatewayRunId: runDelegations.gatewayRunId,
  handoffReason: runDelegations.handoffReason,
  model: runDelegations.model,
  status: runDelegations.status,
  replyText: runDelegations.replyText,
  error: runDelegations.error,
  createdAt: runDelegations.createdAt,
  startedAt: runDelegations.startedAt,
  finishedAt: runDelegations.finishedAt,
};

const RUN_APPROVAL_REQUEST_ROW = {
  id: runApprovalRequests.id,
  runId: runApprovalRequests.runId,
  flowId: runApprovalRequests.flowId,
  nodeId: runApprovalRequests.nodeId,
  requestType: runApprovalRequests.requestType,
  status: runApprovalRequests.status,
  reason: runApprovalRequests.reason,
  command: runApprovalRequests.command,
  approvalMode: runApprovalRequests.approvalMode,
  requestedAt: runApprovalRequests.requestedAt,
  timeoutAt: runApprovalRequests.timeoutAt,
  decidedAt: runApprovalRequests.decidedAt,
  decidedByUserId: runApprovalRequests.decidedByUserId,
  decisionNote: runApprovalRequests.decisionNote,
};

type RunRowShape = {
  id: string;
  workspaceId: string;
  flowId: string;
  flowVersionId?: string;
  flowVersion: number;
  status: Run['status'];
  trigger: RunTrigger;
  input: unknown;
  output: unknown;
  continuation: unknown;
  createdAt: Date;
  startedAt: Date | null;
  resumeAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
};

type RunEventRowShape = {
  id: string;
  runId: string;
  sequence: number;
  eventType: RunEventRecord['eventType'];
  event: RunEventRecord['event'];
  createdAt: Date;
};

type RunEventInsertRow = {
  runId: string;
  sequence: number;
  eventType: RunEventRecord['eventType'];
  event: RunEventRecord['event'];
  createdAt: Date;
};

type RunDelegationRowShape = {
  id: string;
  parentRunId: string;
  parentNodeId: string;
  delegationKind: string;
  depth: number;
  targetAgent: string;
  sessionKey: string;
  gatewayRunId: string | null;
  handoffReason: string | null;
  model: string | null;
  status: DelegatedRunRecord['status'];
  replyText: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

type RunApprovalRequestRowShape = {
  id: string;
  runId: string;
  flowId: string;
  flowName: string;
  nodeId: string;
  requestType: 'control' | 'exec';
  status: RunApprovalRequestStatus;
  reason: string | null;
  command: string | null;
  approvalMode: string | null;
  requestedAt: Date;
  timeoutAt: Date | null;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
};

export class RunLaunchError extends Error {
  constructor(
    readonly code:
      | 'FLOW_NOT_FOUND'
      | 'FLOW_NOT_PUBLISHED'
      | 'PUBLISHED_VERSION_MISSING'
      | 'FLOW_NOT_RUNNABLE'
      | 'TRIGGER_NOT_MATCHED'
      | 'RUN_INSERT_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'RunLaunchError';
  }
}

export class ApprovalDecisionError extends Error {
  constructor(
    readonly code: 'RUN_NOT_FOUND' | 'RUN_NOT_WAITING' | 'APPROVAL_NOT_PENDING',
    message: string,
  ) {
    super(message);
    this.name = 'ApprovalDecisionError';
  }
}

export class AutomationTaskFlowError extends Error {
  constructor(
    readonly code:
      | 'TASK_FLOW_NOT_FOUND'
      | 'TASK_FLOW_CANCELLED'
      | 'TASK_FLOW_COMPLETED'
      | 'TASK_NOT_FOUND'
      | 'TASK_NOT_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AutomationTaskFlowError';
  }
}

export function assertAutomationTaskFlowCanAcceptNewRun(status: AutomationTaskFlowStatus): void {
  if (status === 'cancelled') {
    throw new AutomationTaskFlowError(
      'TASK_FLOW_CANCELLED',
      'task flow is cancelled and will not accept new managed work',
    );
  }

  if (status === 'succeeded') {
    throw new AutomationTaskFlowError(
      'TASK_FLOW_COMPLETED',
      'task flow already succeeded; create a new revision instead of launching more managed work',
    );
  }
}

export function getRunLaunchErrorHttpStatus(error: RunLaunchError): number {
  switch (error.code) {
    case 'FLOW_NOT_FOUND':
      return 404;
    case 'FLOW_NOT_PUBLISHED':
    case 'PUBLISHED_VERSION_MISSING':
    case 'FLOW_NOT_RUNNABLE':
    case 'TRIGGER_NOT_MATCHED':
      return 412;
    case 'RUN_INSERT_FAILED':
      return 500;
  }
}

export interface StartRunInput {
  flowId: string;
  trigger: RunTrigger;
  input?: unknown;
  workspaceId?: string;
  automation?: {
    taskFlowId?: string;
    parentTaskId?: string;
    sourceTaskId?: string;
    role?: AutomationTaskRole;
    summary?: string;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatExecutionIssues(issues: Array<{ message: string }>): string {
  return issues.map((issue) => issue.message).join(' ');
}

function readContinuationState(value: unknown): RunContinuationState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as RunContinuationState;
}

function readStringPathValue(input: unknown, path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed) return undefined;

  const resolved = trimmed.split('.').reduce<unknown>((current, segment) => {
    if (!segment) return current;
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, input);

  if (typeof resolved !== 'string') return undefined;
  const normalized = resolved.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function getMemoryScopeIds(input: unknown): { sessionKey?: string; threadId?: string } {
  return {
    sessionKey:
      readStringPathValue(input, 'sessionKey') ?? readStringPathValue(input, 'input.sessionKey'),
    threadId:
      readStringPathValue(input, 'threadId') ??
      readStringPathValue(input, 'originatingThreadId') ??
      readStringPathValue(input, 'input.threadId') ??
      readStringPathValue(input, 'input.originatingThreadId'),
  };
}

function createRunAbortController(
  db: Db,
  runId: string,
): {
  controller: AbortController;
  stop: () => void;
} {
  const controller = new AbortController();
  const timer = setInterval(() => {
    void db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1)
      .then((rows) => {
        if (rows[0]?.status === 'cancelled' && !controller.signal.aborted) {
          const error = new Error('Run cancelled');
          error.name = 'AbortError';
          controller.abort(error);
        }
      })
      .catch(() => {
        // Ignore polling errors here; normal execution and finalization still own run state.
      });
  }, 250);
  timer.unref?.();

  return {
    controller,
    stop: () => clearInterval(timer),
  };
}

function isTerminalRunStatus(status: Run['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

export function serializeRun(row: RunRowShape): Run {
  const continuation = readContinuationState(row.continuation);
  const pendingApproval =
    row.status === 'waiting' && continuation?.waiting?.kind === 'approval'
      ? {
          kind: continuation.waiting.requestType ?? 'control',
          nodeId: continuation.waiting.nodeId,
          reason: continuation.waiting.reason,
          command: continuation.waiting.command,
          approvalMode: continuation.waiting.approvalMode,
          requestedAt: continuation.waiting.requestedAt,
          timeoutAt: continuation.waiting.timeoutAt,
        }
      : undefined;

  return {
    id: row.id,
    flowId: row.flowId,
    flowVersion: row.flowVersion,
    status: row.status,
    trigger: row.trigger,
    input: row.input ?? undefined,
    output: row.output ?? undefined,
    pendingApproval,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    resumeAt: row.resumeAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    error: row.error ?? undefined,
  };
}

function toAutomationTrackedRun(row: RunRowShape): {
  id: string;
  workspaceId: string;
  flowId: string;
  status: Run['status'];
  trigger: RunTrigger;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
} {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    flowId: row.flowId,
    status: row.status,
    trigger: row.trigger,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function serializeRunEventRecord(row: RunEventRowShape): RunEventRecord {
  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    eventType: row.eventType,
    event: row.event,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeDelegatedRunRecord(row: RunDelegationRowShape): DelegatedRunRecord {
  return {
    id: row.id,
    parentRunId: row.parentRunId,
    parentNodeId: row.parentNodeId,
    delegationKind: 'agent-send',
    depth: row.depth,
    targetAgent: row.targetAgent,
    sessionKey: row.sessionKey,
    gatewayRunId: row.gatewayRunId ?? undefined,
    handoffReason: row.handoffReason ?? undefined,
    model: row.model ?? undefined,
    status: row.status,
    replyText: row.replyText ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
  };
}

export function serializeRunLineage(runId: string, rows: RunDelegationRowShape[]): RunLineage {
  const delegatedChildren = rows.map((row) => serializeDelegatedRunRecord(row));
  const maxDelegationDepth = delegatedChildren.reduce(
    (max, child) => Math.max(max, child.depth),
    0,
  );

  return {
    runId,
    delegatedChildren,
    maxDelegationDepth,
  };
}

export function serializeRunApprovalRequest(row: RunApprovalRequestRowShape): RunApprovalRequest {
  return {
    id: row.id,
    runId: row.runId,
    flowId: row.flowId,
    flowName: row.flowName,
    nodeId: row.nodeId,
    requestType: row.requestType,
    status: row.status,
    reason: row.reason ?? undefined,
    command: row.command ?? undefined,
    approvalMode:
      row.approvalMode === 'ask' ||
      row.approvalMode === 'elevated' ||
      row.approvalMode === 'trusted'
        ? row.approvalMode
        : undefined,
    requestedAt: row.requestedAt.toISOString(),
    timeoutAt: row.timeoutAt?.toISOString(),
    decidedAt: row.decidedAt?.toISOString(),
    decidedByUserId: row.decidedByUserId ?? undefined,
    decision: row.status === 'approved' || row.status === 'rejected' ? row.status : undefined,
    note: row.decisionNote ?? undefined,
  };
}

function toDateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function readRemoteCancelRelayDetails(event: unknown):
  | {
      relayMethod: string;
      sessionKey: string;
      gatewayRunId?: string;
      fallbackFrom?: string;
    }
  | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const entry = event as {
    type?: string;
    data?: {
      kind?: string;
      relayMethod?: unknown;
      sessionKey?: unknown;
      gatewayRunId?: unknown;
      fallbackFrom?: unknown;
    };
  };

  if (entry.type !== 'run.log' || !entry.data || entry.data.kind !== 'remote-cancel-relay') {
    return undefined;
  }

  if (typeof entry.data.relayMethod !== 'string' || typeof entry.data.sessionKey !== 'string') {
    return undefined;
  }

  return {
    relayMethod: entry.data.relayMethod,
    sessionKey: entry.data.sessionKey,
    ...(typeof entry.data.gatewayRunId === 'string'
      ? { gatewayRunId: entry.data.gatewayRunId }
      : {}),
    ...(typeof entry.data.fallbackFrom === 'string'
      ? { fallbackFrom: entry.data.fallbackFrom }
      : {}),
  };
}

export function aggregateRemoteCancelRelayAudit(input: {
  runId: string;
  entries: Array<{
    createdAt: Date;
    details: {
      relayMethod: string;
      sessionKey: string;
      gatewayRunId?: string;
      fallbackFrom?: string;
    };
  }>;
}):
  | {
      createdAt: Date;
      summary: string;
      details: Record<string, unknown>;
    }
  | undefined {
  if (input.entries.length === 0) {
    return undefined;
  }

  const orderedEntries = [...input.entries].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  const finalEntry = orderedEntries[orderedEntries.length - 1];
  if (!finalEntry) {
    return undefined;
  }

  const relayMethods = Array.from(
    new Set(orderedEntries.map((entry) => entry.details.relayMethod)),
  );
  const sessionKeys = Array.from(new Set(orderedEntries.map((entry) => entry.details.sessionKey)));
  const fallbackFrom = orderedEntries.findLast((entry) => entry.details.fallbackFrom)?.details
    .fallbackFrom;
  const gatewayRunId = orderedEntries.findLast((entry) => entry.details.gatewayRunId)?.details
    .gatewayRunId;

  const summary = fallbackFrom
    ? `Relayed run cancellation upstream via ${finalEntry.details.relayMethod} after ${fallbackFrom} fallback`
    : `Relayed run cancellation upstream via ${finalEntry.details.relayMethod}`;

  return {
    createdAt: finalEntry.createdAt,
    summary,
    details: {
      runId: input.runId,
      relayMethod: finalEntry.details.relayMethod,
      relayMethods,
      ...(sessionKeys.length === 1 ? { sessionKey: sessionKeys[0] } : { sessionKeys }),
      ...(gatewayRunId ? { gatewayRunId } : {}),
      ...(fallbackFrom ? { fallbackFrom } : {}),
    },
  };
}

async function appendRunAuditEvent(
  db: Pick<Db, 'insert'>,
  params: {
    workspaceId: string;
    actorUserId?: string | null;
    eventType: string;
    targetId: string;
    summary: string;
    details?: Record<string, unknown>;
    createdAt: Date;
  },
): Promise<void> {
  await db.insert(workspaceAuditEvents).values({
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId ?? null,
    eventType: params.eventType,
    targetType: 'run',
    targetId: params.targetId,
    summary: params.summary,
    details: params.details ?? null,
    createdAt: params.createdAt,
  });
}

export function buildRunStartEvents(input: {
  runId: string;
  flowId: string;
  flowVersion: number;
  trigger: RunTrigger;
  queuedAt: Date;
  startedAt: Date;
}) {
  const queuedEvent = {
    type: 'run.queued' as const,
    runId: input.runId,
    flowId: input.flowId,
    flowVersion: input.flowVersion,
    trigger: input.trigger,
    at: input.queuedAt.toISOString(),
  };

  const startedEvent = {
    type: 'run.started' as const,
    runId: input.runId,
    flowId: input.flowId,
    flowVersion: input.flowVersion,
    at: input.startedAt.toISOString(),
  };

  return [
    {
      sequence: 1,
      eventType: queuedEvent.type,
      event: queuedEvent,
      createdAt: input.queuedAt,
    },
    {
      sequence: 2,
      eventType: startedEvent.type,
      event: startedEvent,
      createdAt: input.startedAt,
    },
  ] as const;
}

export function buildRunResumedEvent(input: { runId: string; resumedAt: Date }) {
  return {
    eventType: 'run.resumed' as const,
    event: {
      type: 'run.resumed' as const,
      runId: input.runId,
      at: input.resumedAt.toISOString(),
    },
    createdAt: input.resumedAt,
  };
}

export function buildRunApprovalRecordedEvent(input: {
  runId: string;
  nodeId: string;
  decision: ApprovalDecision;
  decidedAt: Date;
  note?: string;
}) {
  return {
    eventType: 'run.approval.recorded' as const,
    event: {
      type: 'run.approval.recorded' as const,
      runId: input.runId,
      nodeId: input.nodeId,
      decision: input.decision,
      at: input.decidedAt.toISOString(),
      ...(input.note ? { note: input.note } : {}),
    },
    createdAt: input.decidedAt,
  };
}

async function createPendingApprovalRequest(
  db: ApprovalRequestDb,
  input: {
    workspaceId: string;
    runId: string;
    flowId: string;
    nodeId: string;
    requestType: 'control' | 'exec';
    requestedAt: string;
    timeoutAt?: string;
    reason?: string;
    command?: string;
    approvalMode?: string;
  },
): Promise<void> {
  const requestedAt = toDateOrNull(input.requestedAt) ?? new Date();
  const timeoutAt = toDateOrNull(input.timeoutAt);

  await db.insert(runApprovalRequests).values({
    workspaceId: input.workspaceId,
    runId: input.runId,
    flowId: input.flowId,
    nodeId: input.nodeId,
    requestType: input.requestType,
    status: 'pending',
    reason: input.reason,
    command: input.command,
    approvalMode: input.approvalMode,
    requestedAt,
    timeoutAt,
    createdAt: requestedAt,
    updatedAt: requestedAt,
  });
}

async function updatePendingApprovalRequest(
  db: ApprovalRequestDb,
  input: {
    runId: string;
    nodeId: string;
    status: Exclude<RunApprovalRequestStatus, 'pending'>;
    decidedAt: Date;
    decidedByUserId?: string;
    note?: string;
  },
): Promise<void> {
  const [pendingRequest] = await db
    .select({ id: runApprovalRequests.id })
    .from(runApprovalRequests)
    .where(
      and(
        eq(runApprovalRequests.runId, input.runId),
        eq(runApprovalRequests.nodeId, input.nodeId),
        eq(runApprovalRequests.status, 'pending'),
      ),
    )
    .orderBy(desc(runApprovalRequests.requestedAt))
    .limit(1);

  if (!pendingRequest) {
    return;
  }

  await db
    .update(runApprovalRequests)
    .set({
      status: input.status,
      decidedAt: input.decidedAt,
      decidedByUserId: input.decidedByUserId ?? null,
      decisionNote: input.note ?? null,
      updatedAt: input.decidedAt,
    })
    .where(eq(runApprovalRequests.id, pendingRequest.id));
}

export async function startPublishedFlowRun(db: Db, input: StartRunInput): Promise<Run> {
  const runningRun = await db.transaction(async (tx) => {
    const draft = await tx.query.flows.findFirst({
      columns: { id: true, workspaceId: true, name: true, publishedVersion: true },
      where: (flows, { and, eq }) =>
        and(
          eq(flows.id, input.flowId),
          ...(input.workspaceId ? [eq(flows.workspaceId, input.workspaceId)] : []),
        ),
    });

    if (!draft) {
      throw new RunLaunchError('FLOW_NOT_FOUND', 'flow not found');
    }

    if (draft.publishedVersion === null) {
      throw new RunLaunchError('FLOW_NOT_PUBLISHED', 'flow has not been published');
    }

    const snapshot = await tx.query.flowVersions.findFirst({
      columns: { id: true, flowId: true, version: true, nodes: true, edges: true },
      where: and(
        eq(flowVersions.flowId, draft.id),
        eq(flowVersions.version, draft.publishedVersion),
      ),
    });

    if (!snapshot) {
      throw new RunLaunchError(
        'PUBLISHED_VERSION_MISSING',
        `published flow version ${draft.publishedVersion} is missing`,
      );
    }

    if (input.automation?.taskFlowId) {
      const taskFlow = await tx.query.automationTaskFlows.findFirst({
        columns: {
          id: true,
          status: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.id, input.automation?.taskFlowId ?? ''),
            eq(table.workspaceId, draft.workspaceId),
            eq(table.flowId, draft.id),
          ),
      });

      if (!taskFlow) {
        throw new AutomationTaskFlowError('TASK_FLOW_NOT_FOUND', 'task flow not found');
      }

      assertAutomationTaskFlowCanAcceptNewRun(taskFlow.status);
    }

    const graphIssues = [
      ...validateExecutableFlowGraph(snapshot.nodes, snapshot.edges),
      ...validateFlowSemantics(snapshot.nodes, snapshot.edges),
    ];
    if (graphIssues.length > 0) {
      throw new RunLaunchError('FLOW_NOT_RUNNABLE', formatExecutionIssues(graphIssues));
    }

    const entryResolution = resolveExecutionEntryTrigger(
      snapshot.nodes,
      input.trigger,
      input.input,
    );
    if ('error' in entryResolution) {
      throw new RunLaunchError('TRIGGER_NOT_MATCHED', entryResolution.error);
    }

    const queuedAt = new Date();
    const startedAt = new Date();

    const [pendingRun] = await tx
      .insert(runs)
      .values({
        workspaceId: draft.workspaceId,
        flowId: snapshot.flowId,
        flowVersionId: snapshot.id,
        flowVersion: snapshot.version,
        status: 'pending',
        trigger: input.trigger,
        input: input.input,
        createdAt: queuedAt,
      })
      .returning(RUN_ROW);

    if (!pendingRun) {
      throw new RunLaunchError('RUN_INSERT_FAILED', 'run insert failed');
    }

    const events = buildRunStartEvents({
      runId: pendingRun.id,
      flowId: pendingRun.flowId,
      flowVersion: pendingRun.flowVersion,
      trigger: pendingRun.trigger,
      queuedAt,
      startedAt,
    });

    await tx.insert(runEvents).values(
      events.map((event) => ({
        runId: pendingRun.id,
        sequence: event.sequence,
        eventType: event.eventType,
        event: event.event,
        createdAt: event.createdAt,
      })),
    );

    const [runningRun] = await tx
      .update(runs)
      .set({ status: 'running', startedAt })
      .where(eq(runs.id, pendingRun.id))
      .returning(RUN_ROW);

    if (!runningRun) {
      throw new RunLaunchError('RUN_INSERT_FAILED', 'run start update failed');
    }

    await trackAutomationRunStarted(tx, {
      flowName: draft.name,
      run: toAutomationTrackedRun(runningRun),
      automation: input.automation,
    });

    return runningRun;
  });

  return serializeRun(runningRun);
}

function buildManagedTrigger(input: {
  taskFlow: {
    id: string;
    triggerType: 'task' | 'standing-order';
    triggerKey: string;
    scopeKey: string | null;
  };
  sourceTrigger?: RunTrigger;
  role: AutomationTaskRole;
}): RunTrigger {
  const baseLabel =
    input.role === 'retry'
      ? 'Managed retry'
      : input.role === 'child'
        ? 'Managed child task'
        : 'Managed task';

  if (input.taskFlow.triggerType === 'task') {
    return {
      type: 'task',
      label: baseLabel,
      sourceId: `automation:${input.taskFlow.id}`,
      taskType: input.taskFlow.triggerKey,
      taskQueue: input.sourceTrigger?.taskQueue ?? input.taskFlow.scopeKey ?? undefined,
      taskPriority: input.sourceTrigger?.taskPriority,
    };
  }

  return {
    type: 'standing-order',
    label: baseLabel,
    sourceId: `automation:${input.taskFlow.id}`,
    standingOrderKey: input.taskFlow.triggerKey,
    standingOrderScope:
      input.sourceTrigger?.standingOrderScope ?? input.taskFlow.scopeKey ?? undefined,
  };
}

export async function spawnAutomationTaskRun(
  db: Db,
  input: {
    workspaceId: string;
    taskFlowId: string;
    parentTaskId?: string;
    sourceTaskId?: string;
    summary?: string;
    taskInput?: unknown;
  },
): Promise<Run> {
  const taskFlow = await db.query.automationTaskFlows.findFirst({
    columns: {
      id: true,
      flowId: true,
      workspaceId: true,
      status: true,
      triggerType: true,
      triggerKey: true,
      scopeKey: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.taskFlowId), eq(table.workspaceId, input.workspaceId)),
  });

  if (!taskFlow) {
    throw new AutomationTaskFlowError('TASK_FLOW_NOT_FOUND', 'task flow not found');
  }

  assertAutomationTaskFlowCanAcceptNewRun(taskFlow.status);

  let sourceTask:
    | {
        id: string;
        summary: string;
        runId: string;
        trigger: RunTrigger;
        runInput: unknown;
        runOutput: unknown;
      }
    | undefined;
  const sourceTaskId = input.sourceTaskId?.trim();
  if (sourceTaskId) {
    const row = await db
      .select({
        taskId: automationTasks.id,
        summary: automationTasks.summary,
        runId: automationTasks.runId,
        trigger: automationTasks.trigger,
        runInput: runs.input,
        runOutput: runs.output,
      })
      .from(automationTasks)
      .innerJoin(runs, eq(automationTasks.runId, runs.id))
      .where(and(eq(automationTasks.id, sourceTaskId), eq(automationTasks.taskFlowId, taskFlow.id)))
      .limit(1);

    const sourceRow = row[0];
    if (!sourceRow) {
      throw new AutomationTaskFlowError('TASK_NOT_FOUND', 'source task not found');
    }

    sourceTask = {
      id: sourceRow.taskId,
      summary: sourceRow.summary,
      runId: sourceRow.runId,
      trigger: sourceRow.trigger,
      runInput: sourceRow.runInput,
      runOutput: sourceRow.runOutput,
    };
  }

  const role: AutomationTaskRole = 'child';
  const parentTaskId = input.parentTaskId?.trim() || sourceTask?.id;
  const taskInput = input.taskInput ?? sourceTask?.runOutput ?? sourceTask?.runInput;

  return startPublishedFlowRun(db, {
    flowId: taskFlow.flowId,
    workspaceId: input.workspaceId,
    trigger: buildManagedTrigger({
      taskFlow,
      sourceTrigger: sourceTask?.trigger,
      role,
    }),
    input: taskInput,
    automation: {
      taskFlowId: taskFlow.id,
      parentTaskId,
      sourceTaskId: sourceTask?.id,
      role,
      summary: input.summary,
    },
  });
}

export async function retryAutomationTaskRun(
  db: Db,
  input: {
    workspaceId: string;
    taskId: string;
    summary?: string;
    taskInput?: unknown;
  },
): Promise<Run> {
  const rows = await db
    .select({
      taskId: automationTasks.id,
      taskFlowId: automationTasks.taskFlowId,
      flowId: automationTasks.flowId,
      status: automationTasks.status,
      summary: automationTasks.summary,
      trigger: automationTasks.trigger,
      taskFlowStatus: automationTaskFlows.status,
      taskFlowTriggerType: automationTaskFlows.triggerType,
      taskFlowTriggerKey: automationTaskFlows.triggerKey,
      taskFlowScopeKey: automationTaskFlows.scopeKey,
      parentTaskId: automationTasks.parentTaskId,
      runInput: runs.input,
    })
    .from(automationTasks)
    .innerJoin(automationTaskFlows, eq(automationTasks.taskFlowId, automationTaskFlows.id))
    .innerJoin(runs, eq(automationTasks.runId, runs.id))
    .where(
      and(eq(automationTasks.id, input.taskId), eq(automationTasks.workspaceId, input.workspaceId)),
    )
    .limit(1);

  const task = rows[0];
  if (!task) {
    throw new AutomationTaskFlowError('TASK_NOT_FOUND', 'task not found');
  }

  if (task.status !== 'failed') {
    throw new AutomationTaskFlowError(
      'TASK_NOT_FAILED',
      `task is ${task.status}; only failed tasks can be retried`,
    );
  }

  if (task.taskFlowStatus === 'cancelled' || task.taskFlowStatus === 'succeeded') {
    assertAutomationTaskFlowCanAcceptNewRun(task.taskFlowStatus);
  }

  return startPublishedFlowRun(db, {
    flowId: task.flowId,
    workspaceId: input.workspaceId,
    trigger: buildManagedTrigger({
      taskFlow: {
        id: task.taskFlowId,
        triggerType: task.taskFlowTriggerType,
        triggerKey: task.taskFlowTriggerKey,
        scopeKey: task.taskFlowScopeKey,
      },
      sourceTrigger: task.trigger,
      role: 'retry',
    }),
    input: input.taskInput ?? task.runInput,
    automation: {
      taskFlowId: task.taskFlowId,
      parentTaskId: task.parentTaskId ?? undefined,
      sourceTaskId: task.taskId,
      role: 'retry',
      summary: input.summary ?? task.summary,
    },
  });
}

export async function markRunExecutionFailed(
  db: Db,
  runId: string,
  message: string,
): Promise<Run | null> {
  const finishedAt = new Date();

  const finalizedRun = await db.transaction(async (tx) => {
    const [currentRun] = await tx.select(RUN_ROW).from(runs).where(eq(runs.id, runId)).limit(1);
    if (!currentRun) return null;

    if (currentRun.status !== 'pending' && currentRun.status !== 'running') {
      return serializeRun(currentRun);
    }

    const [lastEvent] = await tx
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    const nextSequence = (lastEvent?.sequence ?? 0) + 1;

    await tx.insert(runEvents).values({
      runId,
      sequence: nextSequence,
      eventType: 'run.finished',
      event: {
        type: 'run.finished',
        runId,
        at: finishedAt.toISOString(),
        status: 'failed',
        error: message,
      },
      createdAt: finishedAt,
    });

    const [updatedRun] = await tx
      .update(runs)
      .set({
        status: 'failed',
        error: message,
        continuation: null,
        resumeAt: null,
        finishedAt,
      })
      .where(and(eq(runs.id, runId), eq(runs.status, currentRun.status)))
      .returning(RUN_ROW);

    if (updatedRun) {
      await syncAutomationRunState(tx, toAutomationTrackedRun(updatedRun));
      return serializeRun(updatedRun);
    }

    const [latestRun] = await tx.select(RUN_ROW).from(runs).where(eq(runs.id, runId)).limit(1);
    return latestRun ? serializeRun(latestRun) : null;
  });

  return finalizedRun;
}

export async function cancelRun(
  db: Db,
  input: {
    runId: string;
    workspaceId?: string;
    note?: string;
    cancelledByUserId?: string;
  },
): Promise<Run | null> {
  const cancelledAt = new Date();

  const cancelledRun = await db.transaction(async (tx) => {
    const [currentRun] = await tx
      .select(RUN_ROW)
      .from(runs)
      .where(
        and(
          eq(runs.id, input.runId),
          ...(input.workspaceId ? [eq(runs.workspaceId, input.workspaceId)] : []),
        ),
      )
      .limit(1);

    if (!currentRun) return null;
    if (isTerminalRunStatus(currentRun.status)) {
      return serializeRun(currentRun);
    }

    const continuation = readContinuationState(currentRun.continuation);
    const [lastEvent] = await tx
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, input.runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    await tx.insert(runEvents).values({
      runId: input.runId,
      sequence: (lastEvent?.sequence ?? 0) + 1,
      eventType: 'run.finished',
      event: {
        type: 'run.finished',
        runId: input.runId,
        at: cancelledAt.toISOString(),
        status: 'cancelled',
      },
      createdAt: cancelledAt,
    });

    if (continuation?.waiting?.kind === 'approval') {
      await updatePendingApprovalRequest(tx, {
        runId: input.runId,
        nodeId: continuation.waiting.nodeId,
        status: 'cancelled',
        decidedAt: cancelledAt,
        decidedByUserId: input.cancelledByUserId,
        note: input.note ?? 'Run cancelled.',
      });
    }

    const [updatedRun] = await tx
      .update(runs)
      .set({
        status: 'cancelled',
        continuation: null,
        resumeAt: null,
        finishedAt: cancelledAt,
      })
      .where(and(eq(runs.id, input.runId), eq(runs.status, currentRun.status)))
      .returning(RUN_ROW);

    if (updatedRun) {
      await appendRunAuditEvent(tx, {
        workspaceId: currentRun.workspaceId,
        actorUserId: input.cancelledByUserId,
        eventType: 'run.cancel.requested',
        targetId: input.runId,
        summary: `Cancelled run ${input.runId.slice(0, 8)} locally`,
        details: {
          runId: input.runId,
          status: 'cancelled',
          ...(input.note ? { note: input.note } : {}),
        },
        createdAt: cancelledAt,
      });
      await syncAutomationRunState(tx, toAutomationTrackedRun(updatedRun));
      return serializeRun(updatedRun);
    }

    const [latestRun] = await tx
      .select(RUN_ROW)
      .from(runs)
      .where(eq(runs.id, input.runId))
      .limit(1);
    return latestRun ? serializeRun(latestRun) : null;
  });

  return cancelledRun;
}

export async function executeRunToCompletion(db: Db, runId: string): Promise<Run | null> {
  const [row] = await db
    .select({
      run: RUN_ROW,
      nodes: flowVersions.nodes,
      edges: flowVersions.edges,
      execPolicy: workspaces.execPolicy,
    })
    .from(runs)
    .innerJoin(flowVersions, eq(runs.flowVersionId, flowVersions.id))
    .innerJoin(workspaces, eq(runs.workspaceId, workspaces.id))
    .where(eq(runs.id, runId))
    .limit(1);

  if (!row) return null;
  if (row.run.status !== 'running') return serializeRun(row.run);

  const hydratedInput = mergePersistedMemoryIntoInput(
    row.run.input,
    await loadPersistedMemory(db, {
      workspaceId: row.run.workspaceId,
      flowId: row.run.flowId,
      ...getMemoryScopeIds(row.run.input),
    }),
  );

  const runAbort = createRunAbortController(db, runId);
  const execution = await executePublishedFlow({
    runId: row.run.id,
    flowId: row.run.flowId,
    flowVersion: row.run.flowVersion,
    trigger: row.run.trigger,
    nodes: row.nodes,
    edges: row.edges,
    input: hydratedInput,
    resumeState: readContinuationState(row.run.continuation),
    executeChannelReplyNode: async (params) => {
      const rawProfileId = params.node.data.channelProfileId;
      const profileId = typeof rawProfileId === 'string' ? rawProfileId.trim() : '';
      const profile = profileId
        ? await getChannelExecutionProfile(db, profileId, row.run.workspaceId)
        : null;
      if (profileId && !profile) {
        throw new Error(`channel profile "${profileId}" was not found`);
      }
      return executeChannelReplyNodeWithProfile({
        ...params,
        ...(profile ? { profile } : {}),
      });
    },
    executeChannelRouteNode: async (params) => {
      const rawDestination = params.node.data.destination;
      const destination = typeof rawDestination === 'string' ? rawDestination.trim() : '';
      const profile = destination
        ? await getChannelExecutionProfile(db, destination, row.run.workspaceId)
        : null;
      return executeChannelRouteNodeWithProfile({
        ...params,
        ...(profile ? { profile } : {}),
      });
    },
    executeMemoryWriteNode: async (params) =>
      executeMemoryWriteNodeWithPersistence({
        ...params,
        persistWrite: async (write) => {
          await persistMemoryWrite(db, {
            workspaceId: row.run.workspaceId,
            flowId: params.flowId,
            runId: params.runId,
            namespace: write.namespace,
            scopeId: write.scopeId,
            key: write.key,
            value: write.value,
          });
        },
      }),
    executeMemoryQueryNode: async (params) => {
      const rawNamespace = params.node.data.namespace;
      const namespace =
        typeof rawNamespace === 'string' && rawNamespace.trim() ? rawNamespace.trim() : 'session';
      const rawKeyPrefix = params.node.data.keyPrefix;
      const keyPrefix =
        typeof rawKeyPrefix === 'string' && rawKeyPrefix.trim() ? rawKeyPrefix.trim() : undefined;
      const rawQuery = params.node.data.query;
      const query = typeof rawQuery === 'string' && rawQuery.trim() ? rawQuery.trim() : undefined;
      const rawLimit = params.node.data.limit;
      const parsedLimit =
        typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : Number(rawLimit);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
      const result = await queryPersistedMemory(db, {
        workspaceId: row.run.workspaceId,
        flowId: params.flowId,
        ...getMemoryScopeIds(params.nodeInput),
        namespace:
          namespace === 'session' ||
          namespace === 'memory' ||
          namespace === 'thread' ||
          namespace === 'all'
            ? namespace
            : 'session',
        ...(keyPrefix ? { keyPrefix } : {}),
        ...(query ? { query } : {}),
        limit,
      });
      const output =
        params.nodeInput && typeof params.nodeInput === 'object' && !Array.isArray(params.nodeInput)
          ? {
              ...(params.nodeInput as Record<string, unknown>),
              memoryQuery: result,
            }
          : {
              input: params.nodeInput,
              memoryQuery: result,
            };

      return {
        output,
        result,
        logs: [
          {
            level: 'info' as const,
            message: `Memory query returned ${result.matches.length} of ${result.totalMatches} persisted matches`,
            data: {
              namespace: result.namespace,
              totalMatches: result.totalMatches,
            },
          },
        ],
      };
    },
    executeThreadBindNode: async (params) => {
      const bindResult = await executeDefaultThreadBindNode(params);
      const scopeIds = getMemoryScopeIds(bindResult.output);
      const hydratedOutput = mergePersistedMemoryIntoInput(
        bindResult.output,
        await loadPersistedMemory(db, {
          workspaceId: row.run.workspaceId,
          flowId: params.flowId,
          ...scopeIds,
        }),
      );

      return {
        ...bindResult,
        output: hydratedOutput,
        result: hydratedOutput,
        logs:
          hydratedOutput === bindResult.output
            ? bindResult.logs
            : [
                ...bindResult.logs,
                {
                  level: 'info' as const,
                  message: 'Hydrated persisted memory for the bound context',
                  data: scopeIds,
                },
              ],
      };
    },
    executeYouTubeTranscriptNode: async (params) => {
      const provider =
        typeof params.node.data.provider === 'string'
          ? params.node.data.provider.trim().toLowerCase()
          : 'transcriptapi';
      if (provider !== 'transcriptapi') {
        return executeDefaultYouTubeTranscriptNode(params);
      }

      const rawProfileId = params.node.data.profileId;
      const profileId = typeof rawProfileId === 'string' ? rawProfileId.trim() : undefined;
      const settings = await loadTranscriptApiProfileSettings(
        db,
        row.run.workspaceId,
        profileId || undefined,
      );
      const source = resolveTranscriptSource({
        nodeInput: params.nodeInput,
        nodeData: params.node.data,
        defaultPath: 'videoId',
        fallbackPaths: ['videoId', 'videoUrl', 'url', 'input.videoId', 'input.url'],
      });
      const videoId = source ? extractYouTubeVideoId(source) : undefined;
      const includeSegments =
        params.node.data.includeSegments === false || params.node.data.includeSegments === 'false'
          ? false
          : true;
      const outputMode =
        typeof params.node.data.outputMode === 'string' && params.node.data.outputMode.trim()
          ? params.node.data.outputMode.trim()
          : 'merge';

      if (videoId) {
        const cached = await loadCachedYouTubeTranscript(db, {
          workspaceId: row.run.workspaceId,
          videoId,
        });
        if (cached) {
          return buildCachedTranscriptExecution({
            nodeInput: params.nodeInput,
            outputMode,
            includeSegments,
            transcript: cached,
            cacheLabel: 'YouTube',
          });
        }
      }

      const execution = await executeDefaultYouTubeTranscriptNode({
        ...params,
        transcriptApiKey: settings.apiKey,
        ...(settings.baseUrl ? { transcriptApiBaseUrl: settings.baseUrl } : {}),
      });
      const transcript = readTranscriptExecutionResult(execution.result);
      if (transcript) {
        await saveCachedYouTubeTranscript(db, {
          workspaceId: row.run.workspaceId,
          transcript,
        });
      }
      return execution;
    },
    executeTranscriptApiNode: async (params) => {
      const rawProfileId = params.node.data.profileId;
      const profileId = typeof rawProfileId === 'string' ? rawProfileId.trim() : undefined;
      const settings = await loadTranscriptApiProfileSettings(
        db,
        row.run.workspaceId,
        profileId || undefined,
      );
      const source = resolveTranscriptSource({
        nodeInput: params.nodeInput,
        nodeData: params.node.data,
        defaultPath: 'url',
        fallbackPaths: ['url', 'videoUrl', 'videoId', 'input.url', 'input.videoUrl', 'input.videoId'],
      });
      const videoId = source ? extractYouTubeVideoId(source) : undefined;
      const includeSegments =
        params.node.data.includeSegments === false || params.node.data.includeSegments === 'false'
          ? false
          : true;
      const outputMode =
        typeof params.node.data.outputMode === 'string' && params.node.data.outputMode.trim()
          ? params.node.data.outputMode.trim()
          : 'merge';

      if (videoId) {
        const cached = await loadCachedYouTubeTranscript(db, {
          workspaceId: row.run.workspaceId,
          videoId,
        });
        if (cached) {
          return buildCachedTranscriptExecution({
            nodeInput: params.nodeInput,
            outputMode,
            includeSegments,
            transcript: cached,
            cacheLabel: 'TranscriptAPI',
          });
        }
      }

      const execution = await executeDefaultTranscriptApiNode({
        ...params,
        transcriptApiKey: settings.apiKey,
        ...(settings.baseUrl ? { transcriptApiBaseUrl: settings.baseUrl } : {}),
      });
      const transcript = readTranscriptExecutionResult(execution.result);
      if (transcript) {
        await saveCachedYouTubeTranscript(db, {
          workspaceId: row.run.workspaceId,
          transcript,
        });
      }
      return execution;
    },
    execPolicy: row.execPolicy,
    checkCancellation: async () => runAbort.controller.signal.aborted,
    abortSignal: runAbort.controller.signal,
  }).finally(() => {
    runAbort.stop();
  });

  const finishedAt = new Date();

  const finalizedRun = await db.transaction(async (tx) => {
    const [currentRun] = await tx.select(RUN_ROW).from(runs).where(eq(runs.id, runId)).limit(1);
    if (!currentRun) return null;
    if (currentRun.status !== 'running') {
      return serializeRun(currentRun);
    }

    const [lastEvent] = await tx
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    let nextSequence = (lastEvent?.sequence ?? 0) + 1;
    if (execution.events.length > 0) {
      await tx.insert(runEvents).values(
        execution.events.map((event) => ({
          runId,
          sequence: nextSequence++,
          eventType: event.eventType,
          event: event.event,
          createdAt: event.createdAt,
        })),
      );
    }

    if (execution.delegatedRuns.length > 0) {
      await tx.insert(runDelegations).values(
        execution.delegatedRuns.map((delegatedRun: PendingDelegatedRun) => ({
          workspaceId: row.run.workspaceId,
          parentRunId: delegatedRun.parentRunId,
          parentNodeId: delegatedRun.parentNodeId,
          delegationKind: delegatedRun.delegationKind,
          depth: delegatedRun.depth,
          targetAgent: delegatedRun.targetAgent,
          sessionKey: delegatedRun.sessionKey,
          gatewayRunId: delegatedRun.gatewayRunId ?? null,
          handoffReason: delegatedRun.handoffReason ?? null,
          model: delegatedRun.model ?? null,
          status: delegatedRun.status,
          replyText: delegatedRun.replyText ?? null,
          error: delegatedRun.error ?? null,
          createdAt: delegatedRun.createdAt,
          startedAt: delegatedRun.startedAt ?? null,
          finishedAt: delegatedRun.finishedAt ?? null,
        })),
      );
    }

    const remoteCancelRelayEvents = execution.events
      .map((entry) => ({
        createdAt: entry.createdAt,
        details: readRemoteCancelRelayDetails(entry.event),
      }))
      .filter(
        (
          entry,
        ): entry is {
          createdAt: Date;
          details: {
            relayMethod: string;
            sessionKey: string;
            gatewayRunId?: string;
            fallbackFrom?: string;
          };
        } => entry.details !== undefined,
      );

    const [updatedRun] =
      execution.status === 'waiting'
        ? await tx
            .update(runs)
            .set({
              status: 'waiting',
              output: execution.output,
              error: null,
              continuation: execution.continuation,
              resumeAt: execution.resumeAt,
              finishedAt: null,
            })
            .where(and(eq(runs.id, runId), eq(runs.status, 'running')))
            .returning(RUN_ROW)
        : await tx
            .update(runs)
            .set({
              status: execution.status,
              output: execution.output,
              error: execution.error,
              continuation: null,
              resumeAt: null,
              finishedAt,
            })
            .where(and(eq(runs.id, runId), eq(runs.status, 'running')))
            .returning(RUN_ROW);

    if (
      updatedRun &&
      execution.status === 'waiting' &&
      execution.continuation?.waiting?.kind === 'approval'
    ) {
      await createPendingApprovalRequest(tx, {
        workspaceId: row.run.workspaceId,
        runId,
        flowId: row.run.flowId,
        nodeId: execution.continuation.waiting.nodeId,
        requestType: execution.continuation.waiting.requestType ?? 'control',
        requestedAt: execution.continuation.waiting.requestedAt,
        timeoutAt: execution.continuation.waiting.timeoutAt,
        reason: execution.continuation.waiting.reason,
        command: execution.continuation.waiting.command,
        approvalMode: execution.continuation.waiting.approvalMode,
      });
    }

    if (updatedRun) {
      const remoteCancelRelayAudit = aggregateRemoteCancelRelayAudit({
        runId,
        entries: remoteCancelRelayEvents,
      });
      if (remoteCancelRelayAudit) {
        await appendRunAuditEvent(tx, {
          workspaceId: row.run.workspaceId,
          eventType: 'run.cancel.relayed',
          targetId: runId,
          summary: remoteCancelRelayAudit.summary,
          details: remoteCancelRelayAudit.details,
          createdAt: remoteCancelRelayAudit.createdAt,
        });
      }
      await syncAutomationRunState(tx, toAutomationTrackedRun(updatedRun));
      return serializeRun(updatedRun);
    }

    const [latestRun] = await tx.select(RUN_ROW).from(runs).where(eq(runs.id, runId)).limit(1);
    return latestRun ? serializeRun(latestRun) : null;
  });

  return finalizedRun;
}

export async function resumeWaitingRun(db: Db, runId: string): Promise<Run | null> {
  const resumedAt = new Date();

  const resumedRun = await db.transaction(async (tx) => {
    const [currentRun] = await tx.select(RUN_ROW).from(runs).where(eq(runs.id, runId)).limit(1);
    if (!currentRun) return null;
    if (currentRun.status !== 'waiting') {
      return serializeRun(currentRun);
    }
    const continuation = readContinuationState(currentRun.continuation);

    const [lastEvent] = await tx
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    const eventsToInsert: RunEventInsertRow[] = [];
    let nextSequence = (lastEvent?.sequence ?? 0) + 1;
    let nextContinuation = continuation;

    if (continuation?.waiting?.kind === 'approval') {
      const approvalEvent = buildRunApprovalRecordedEvent({
        runId,
        nodeId: continuation.waiting.nodeId,
        decision: 'rejected',
        decidedAt: resumedAt,
        note: 'Timed out waiting for approval.',
      });
      eventsToInsert.push({
        runId,
        sequence: nextSequence++,
        eventType: approvalEvent.eventType,
        event: approvalEvent.event,
        createdAt: approvalEvent.createdAt,
      });
      await updatePendingApprovalRequest(tx, {
        runId,
        nodeId: continuation.waiting.nodeId,
        status: 'timed_out',
        decidedAt: resumedAt,
        note: 'Timed out waiting for approval.',
      });
      if (continuation.waiting.timeoutError || continuation.waiting.rejectionError) {
        const error =
          continuation.waiting.timeoutError ??
          continuation.waiting.rejectionError ??
          'Approval timed out.';
        eventsToInsert.push({
          runId,
          sequence: nextSequence++,
          eventType: 'run.finished',
          event: {
            type: 'run.finished',
            runId,
            at: resumedAt.toISOString(),
            status: 'failed',
            error,
          },
          createdAt: resumedAt,
        });
        await tx.insert(runEvents).values(eventsToInsert);

        const [failedRun] = await tx
          .update(runs)
          .set({
            status: 'failed',
            error,
            resumeAt: null,
            continuation: null,
            finishedAt: resumedAt,
          })
          .where(and(eq(runs.id, runId), eq(runs.status, 'waiting')))
          .returning(RUN_ROW);

        if (failedRun) {
          await syncAutomationRunState(tx, toAutomationTrackedRun(failedRun));
          return serializeRun(failedRun);
        }

        const [latestRun] = await tx.select(RUN_ROW).from(runs).where(eq(runs.id, runId)).limit(1);
        return latestRun ? serializeRun(latestRun) : null;
      }
      nextContinuation = {
        queue: continuation.waiting.rejectedQueue,
        visitedNodeIds: continuation.visitedNodeIds,
        lastOutput: continuation.lastOutput,
      };
    } else if (continuation?.waiting?.kind === 'timer') {
      nextContinuation = {
        queue: continuation.queue,
        visitedNodeIds: continuation.visitedNodeIds,
        lastOutput: continuation.lastOutput,
      };
    }

    const resumedEvent = buildRunResumedEvent({ runId, resumedAt });
    eventsToInsert.push({
      runId,
      sequence: nextSequence,
      eventType: resumedEvent.eventType,
      event: resumedEvent.event,
      createdAt: resumedEvent.createdAt,
    });

    await tx.insert(runEvents).values(eventsToInsert);

    const [runningRun] = await tx
      .update(runs)
      .set({
        status: 'running',
        error: null,
        resumeAt: null,
        continuation: nextContinuation ?? null,
      })
      .where(and(eq(runs.id, runId), eq(runs.status, 'waiting')))
      .returning(RUN_ROW);

    if (runningRun) {
      await syncAutomationRunState(tx, toAutomationTrackedRun(runningRun));
      return serializeRun(runningRun);
    }

    const [latestRun] = await tx.select(RUN_ROW).from(runs).where(eq(runs.id, runId)).limit(1);
    return latestRun ? serializeRun(latestRun) : null;
  });

  return resumedRun;
}

export async function recordApprovalDecision(
  db: Db,
  input: {
    runId: string;
    decision: ApprovalDecision;
    note?: string;
    decidedByUserId?: string;
    workspaceId?: string;
  },
): Promise<Run | null> {
  const decidedAt = new Date();

  const updatedRun = await db.transaction(async (tx) => {
    const [currentRun] = await tx
      .select(RUN_ROW)
      .from(runs)
      .where(
        and(
          eq(runs.id, input.runId),
          ...(input.workspaceId ? [eq(runs.workspaceId, input.workspaceId)] : []),
        ),
      )
      .limit(1);
    if (!currentRun) {
      throw new ApprovalDecisionError('RUN_NOT_FOUND', 'run not found');
    }
    if (currentRun.status !== 'waiting') {
      throw new ApprovalDecisionError(
        'RUN_NOT_WAITING',
        `run is already ${currentRun.status}; approval can only be recorded while it is waiting`,
      );
    }
    const continuation = readContinuationState(currentRun.continuation);
    if (continuation?.waiting?.kind !== 'approval') {
      throw new ApprovalDecisionError(
        'APPROVAL_NOT_PENDING',
        'run is waiting on a timer, not on an approval decision',
      );
    }

    const [lastEvent] = await tx
      .select({ sequence: runEvents.sequence })
      .from(runEvents)
      .where(eq(runEvents.runId, input.runId))
      .orderBy(desc(runEvents.sequence))
      .limit(1);

    const approvalEvent = buildRunApprovalRecordedEvent({
      runId: input.runId,
      nodeId: continuation.waiting.nodeId,
      decision: input.decision,
      decidedAt,
      note: input.note,
    });
    const nextSequence = (lastEvent?.sequence ?? 0) + 1;
    const eventsToInsert: RunEventInsertRow[] = [
      {
        runId: input.runId,
        sequence: nextSequence,
        eventType: approvalEvent.eventType,
        event: approvalEvent.event,
        createdAt: approvalEvent.createdAt,
      },
    ];
    await updatePendingApprovalRequest(tx, {
      runId: input.runId,
      nodeId: continuation.waiting.nodeId,
      status: input.decision,
      decidedAt,
      decidedByUserId: input.decidedByUserId,
      note: input.note,
    });

    if (
      input.decision === 'rejected' &&
      (continuation.waiting.rejectionError || continuation.waiting.timeoutError)
    ) {
      const error =
        continuation.waiting.rejectionError ??
        continuation.waiting.timeoutError ??
        'Approval was rejected.';
      eventsToInsert.push({
        runId: input.runId,
        sequence: nextSequence + 1,
        eventType: 'run.finished',
        event: {
          type: 'run.finished',
          runId: input.runId,
          at: decidedAt.toISOString(),
          status: 'failed',
          error,
        },
        createdAt: decidedAt,
      });
      await tx.insert(runEvents).values(eventsToInsert);

      const [failedRun] = await tx
        .update(runs)
        .set({
          status: 'failed',
          error,
          resumeAt: null,
          continuation: null,
          finishedAt: decidedAt,
        })
        .where(and(eq(runs.id, input.runId), eq(runs.status, 'waiting')))
        .returning(RUN_ROW);

      if (failedRun) {
        await syncAutomationRunState(tx, toAutomationTrackedRun(failedRun));
        return serializeRun(failedRun);
      }

      const [latestRun] = await tx
        .select(RUN_ROW)
        .from(runs)
        .where(eq(runs.id, input.runId))
        .limit(1);
      return latestRun ? serializeRun(latestRun) : null;
    }

    const resumedEvent = buildRunResumedEvent({ runId: input.runId, resumedAt: decidedAt });
    eventsToInsert.push({
      runId: input.runId,
      sequence: nextSequence + 1,
      eventType: resumedEvent.eventType,
      event: resumedEvent.event,
      createdAt: resumedEvent.createdAt,
    });
    await tx.insert(runEvents).values(eventsToInsert);

    const nextQueue =
      input.decision === 'approved'
        ? continuation.waiting.approvedQueue
        : continuation.waiting.rejectedQueue;

    const [runningRun] = await tx
      .update(runs)
      .set({
        status: 'running',
        error: null,
        resumeAt: null,
        continuation: {
          queue: nextQueue,
          visitedNodeIds: continuation.visitedNodeIds,
          lastOutput: continuation.lastOutput,
        },
      })
      .where(and(eq(runs.id, input.runId), eq(runs.status, 'waiting')))
      .returning(RUN_ROW);

    if (runningRun) {
      await syncAutomationRunState(tx, toAutomationTrackedRun(runningRun));
      return serializeRun(runningRun);
    }

    const [latestRun] = await tx
      .select(RUN_ROW)
      .from(runs)
      .where(eq(runs.id, input.runId))
      .limit(1);
    return latestRun ? serializeRun(latestRun) : null;
  });

  return updatedRun;
}

export function executeRunInBackground(
  db: Db,
  runId: string,
  logger: Pick<Console, 'error'> = console,
  execute: typeof executeRunToCompletion = executeRunToCompletion,
  recover: typeof markRunExecutionFailed = markRunExecutionFailed,
): void {
  queueMicrotask(() => {
    void execute(db, runId).catch(async (error) => {
      logger.error('[run-service] background execution failed', error);
      try {
        await recover(db, runId, `background execution failed: ${errorMessage(error)}`);
      } catch (recoveryError) {
        logger.error('[run-service] failed to mark run as failed', recoveryError);
      }
    });
  });
}

export async function listRuns(
  db: Db,
  input: {
    workspaceId: string;
    flowId?: string;
    limit?: number;
  },
): Promise<Run[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const rows = input.flowId
    ? await db
        .select(RUN_ROW)
        .from(runs)
        .where(and(eq(runs.workspaceId, input.workspaceId), eq(runs.flowId, input.flowId)))
        .orderBy(desc(runs.createdAt))
        .limit(limit)
    : await db
        .select(RUN_ROW)
        .from(runs)
        .where(eq(runs.workspaceId, input.workspaceId))
        .orderBy(desc(runs.createdAt))
        .limit(limit);
  return rows.map(serializeRun);
}

export async function listApprovalRequests(
  db: Db,
  input: {
    workspaceId: string;
    status?: RunApprovalRequestStatus;
    limit?: number;
  },
): Promise<RunApprovalRequest[]> {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const rows = await db
    .select({
      request: RUN_APPROVAL_REQUEST_ROW,
      flowName: flows.name,
    })
    .from(runApprovalRequests)
    .innerJoin(flows, eq(runApprovalRequests.flowId, flows.id))
    .where(
      and(
        eq(runApprovalRequests.workspaceId, input.workspaceId),
        ...(input.status ? [eq(runApprovalRequests.status, input.status)] : []),
      ),
    )
    .orderBy(desc(runApprovalRequests.requestedAt), desc(runApprovalRequests.createdAt))
    .limit(limit);

  return rows.map((row) =>
    serializeRunApprovalRequest({
      ...row.request,
      flowName: row.flowName,
    }),
  );
}

export async function getRun(db: Db, id: string, workspaceId: string): Promise<Run | null> {
  const [row] = await db
    .select(RUN_ROW)
    .from(runs)
    .where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  return row ? serializeRun(row) : null;
}

export async function listRunEvents(
  db: Db,
  runId: string,
  workspaceId: string,
): Promise<RunEventRecord[]> {
  const rows = await db
    .select({ event: RUN_EVENT_ROW })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(and(eq(runEvents.runId, runId), eq(runs.workspaceId, workspaceId)))
    .orderBy(asc(runEvents.sequence), asc(runEvents.createdAt));
  return rows.map((row) => serializeRunEventRecord(row.event));
}

export async function getRunLineage(
  db: Db,
  runId: string,
  workspaceId: string,
): Promise<RunLineage | null> {
  const [runRow] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)))
    .limit(1);

  if (!runRow) {
    return null;
  }

  const rows = await db
    .select(RUN_DELEGATION_ROW)
    .from(runDelegations)
    .where(and(eq(runDelegations.parentRunId, runId), eq(runDelegations.workspaceId, workspaceId)))
    .orderBy(asc(runDelegations.createdAt), asc(runDelegations.depth));

  return serializeRunLineage(runId, rows);
}
