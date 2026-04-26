import { type Static, Type } from '@sinclair/typebox';
import './formats.js';

export const RunStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('waiting'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);
export type RunStatus = Static<typeof RunStatus>;

export const DelegatedRunStatus = Type.Union([
  Type.Literal('running'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);
export type DelegatedRunStatus = Static<typeof DelegatedRunStatus>;

export const RunTriggerType = Type.Union([
  Type.Literal('manual'),
  Type.Literal('webhook'),
  Type.Literal('channel'),
  Type.Literal('cron'),
  Type.Literal('hook'),
  Type.Literal('task'),
  Type.Literal('standing-order'),
]);
export type RunTriggerType = Static<typeof RunTriggerType>;

export const RunTrigger = Type.Object({
  type: RunTriggerType,
  label: Type.Optional(Type.String()),
  channel: Type.Optional(Type.String()),
  accountId: Type.Optional(Type.String()),
  eventName: Type.Optional(Type.String()),
  hookName: Type.Optional(Type.String()),
  filter: Type.Optional(Type.String()),
  routeKey: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
  taskType: Type.Optional(Type.String()),
  taskQueue: Type.Optional(Type.String()),
  taskPriority: Type.Optional(Type.String()),
  standingOrderKey: Type.Optional(Type.String()),
  standingOrderScope: Type.Optional(Type.String()),
  sourceId: Type.Optional(Type.String()),
});
export type RunTrigger = Static<typeof RunTrigger>;

export const ApprovalDecision = Type.Union([Type.Literal('approved'), Type.Literal('rejected')]);
export type ApprovalDecision = Static<typeof ApprovalDecision>;

export const RunApprovalRequestStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('cancelled'),
  Type.Literal('timed_out'),
]);
export type RunApprovalRequestStatus = Static<typeof RunApprovalRequestStatus>;

export const RunApprovalRequestType = Type.Union([Type.Literal('control'), Type.Literal('exec')]);
export type RunApprovalRequestType = Static<typeof RunApprovalRequestType>;

export const Run = Type.Object({
  id: Type.String({ minLength: 1 }),
  flowId: Type.String({ minLength: 1 }),
  flowVersion: Type.Integer({ minimum: 1 }),
  status: RunStatus,
  trigger: RunTrigger,
  input: Type.Optional(Type.Unknown()),
  output: Type.Optional(Type.Unknown()),
  pendingApproval: Type.Optional(
    Type.Object({
      kind: Type.Optional(RunApprovalRequestType),
      nodeId: Type.String({ minLength: 1 }),
      reason: Type.Optional(Type.String()),
      command: Type.Optional(Type.String()),
      approvalMode: Type.Optional(
        Type.Union([Type.Literal('ask'), Type.Literal('elevated'), Type.Literal('trusted')]),
      ),
      requestedAt: Type.String({ format: 'date-time' }),
      timeoutAt: Type.Optional(Type.String({ format: 'date-time' })),
    }),
  ),
  createdAt: Type.String({ format: 'date-time' }),
  startedAt: Type.Optional(Type.String({ format: 'date-time' })),
  resumeAt: Type.Optional(Type.String({ format: 'date-time' })),
  finishedAt: Type.Optional(Type.String({ format: 'date-time' })),
  error: Type.Optional(Type.String()),
});
export type Run = Static<typeof Run>;

const Isoish = Type.String({ format: 'date-time' });

export const RunEventType = Type.Union([
  Type.Literal('run.queued'),
  Type.Literal('run.started'),
  Type.Literal('run.delegated'),
  Type.Literal('run.approval.requested'),
  Type.Literal('run.approval.recorded'),
  Type.Literal('run.waiting'),
  Type.Literal('run.resumed'),
  Type.Literal('node.started'),
  Type.Literal('node.finished'),
  Type.Literal('node.failed'),
  Type.Literal('run.log'),
  Type.Literal('run.finished'),
]);
export type RunEventType = Static<typeof RunEventType>;

export const RunQueuedEvent = Type.Object({
  type: Type.Literal('run.queued'),
  runId: Type.String(),
  flowId: Type.String(),
  flowVersion: Type.Integer({ minimum: 1 }),
  trigger: RunTrigger,
  at: Isoish,
});
export type RunQueuedEvent = Static<typeof RunQueuedEvent>;

export const RunStartedEvent = Type.Object({
  type: Type.Literal('run.started'),
  runId: Type.String(),
  flowId: Type.String(),
  flowVersion: Type.Integer({ minimum: 1 }),
  at: Isoish,
});
export type RunStartedEvent = Static<typeof RunStartedEvent>;

export const RunDelegatedEvent = Type.Object({
  type: Type.Literal('run.delegated'),
  runId: Type.String(),
  nodeId: Type.String(),
  at: Isoish,
  delegationKind: Type.Literal('agent-send'),
  targetAgent: Type.String({ minLength: 1 }),
  sessionKey: Type.String({ minLength: 1 }),
  gatewayRunId: Type.Optional(Type.String()),
  handoffReason: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
});
export type RunDelegatedEvent = Static<typeof RunDelegatedEvent>;

export const RunApprovalRequestedEvent = Type.Object({
  type: Type.Literal('run.approval.requested'),
  runId: Type.String(),
  nodeId: Type.String(),
  at: Isoish,
  reason: Type.Optional(Type.String()),
  timeoutAt: Type.Optional(Isoish),
});
export type RunApprovalRequestedEvent = Static<typeof RunApprovalRequestedEvent>;

export const RunApprovalRecordedEvent = Type.Object({
  type: Type.Literal('run.approval.recorded'),
  runId: Type.String(),
  nodeId: Type.String(),
  at: Isoish,
  decision: ApprovalDecision,
  note: Type.Optional(Type.String()),
});
export type RunApprovalRecordedEvent = Static<typeof RunApprovalRecordedEvent>;

export const RunWaitingEvent = Type.Object({
  type: Type.Literal('run.waiting'),
  runId: Type.String(),
  nodeId: Type.String(),
  at: Isoish,
  resumeAt: Isoish,
  durationSeconds: Type.Integer({ minimum: 1 }),
});
export type RunWaitingEvent = Static<typeof RunWaitingEvent>;

export const RunResumedEvent = Type.Object({
  type: Type.Literal('run.resumed'),
  runId: Type.String(),
  at: Isoish,
});
export type RunResumedEvent = Static<typeof RunResumedEvent>;

export const NodeStartedEvent = Type.Object({
  type: Type.Literal('node.started'),
  runId: Type.String(),
  nodeId: Type.String(),
  at: Isoish,
});
export type NodeStartedEvent = Static<typeof NodeStartedEvent>;

export const NodeFinishedEvent = Type.Object({
  type: Type.Literal('node.finished'),
  runId: Type.String(),
  nodeId: Type.String(),
  at: Isoish,
  result: Type.Unknown(),
});
export type NodeFinishedEvent = Static<typeof NodeFinishedEvent>;

export const NodeFailedEvent = Type.Object({
  type: Type.Literal('node.failed'),
  runId: Type.String(),
  nodeId: Type.String(),
  at: Isoish,
  error: Type.String(),
});
export type NodeFailedEvent = Static<typeof NodeFailedEvent>;

export const RunLogLevel = Type.Union([
  Type.Literal('debug'),
  Type.Literal('info'),
  Type.Literal('warn'),
  Type.Literal('error'),
]);
export type RunLogLevel = Static<typeof RunLogLevel>;

export const RunLogEvent = Type.Object({
  type: Type.Literal('run.log'),
  runId: Type.String(),
  at: Isoish,
  level: RunLogLevel,
  message: Type.String({ minLength: 1 }),
  nodeId: Type.Optional(Type.String()),
  data: Type.Optional(Type.Unknown()),
});
export type RunLogEvent = Static<typeof RunLogEvent>;

export const RunFinishedEvent = Type.Object({
  type: Type.Literal('run.finished'),
  runId: Type.String(),
  at: Isoish,
  status: Type.Union([
    Type.Literal('succeeded'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
  ]),
  error: Type.Optional(Type.String()),
});
export type RunFinishedEvent = Static<typeof RunFinishedEvent>;

export const RunEvent = Type.Union([
  RunQueuedEvent,
  RunStartedEvent,
  RunDelegatedEvent,
  RunApprovalRequestedEvent,
  RunApprovalRecordedEvent,
  RunWaitingEvent,
  RunResumedEvent,
  NodeStartedEvent,
  NodeFinishedEvent,
  NodeFailedEvent,
  RunLogEvent,
  RunFinishedEvent,
]);
export type RunEvent = Static<typeof RunEvent>;

export interface RunContinuationQueueItem {
  nodeId: string;
  input: unknown;
  pathNodeIds?: string[];
  execApproval?: {
    nodeId: string;
    command: string;
    approvalMode: 'ask' | 'elevated' | 'trusted';
  };
}

export interface RunContinuationWaitingTimer {
  kind: 'timer';
  nodeId: string;
  resumeAt: string;
  durationSeconds: number;
}

export interface RunContinuationWaitingApproval {
  kind: 'approval';
  nodeId: string;
  requestType?: RunApprovalRequestType;
  requestedAt: string;
  timeoutAt?: string;
  timeoutSeconds: number;
  reason?: string;
  command?: string;
  approvalMode?: 'ask' | 'elevated' | 'trusted';
  rejectionError?: string;
  timeoutError?: string;
  approvedQueue: RunContinuationQueueItem[];
  rejectedQueue: RunContinuationQueueItem[];
}

export interface RunContinuationState {
  queue: RunContinuationQueueItem[];
  visitedNodeIds: string[];
  lastOutput?: unknown;
  waiting?: RunContinuationWaitingTimer | RunContinuationWaitingApproval;
}

export const RunEventRecord = Type.Object({
  id: Type.String({ minLength: 1 }),
  runId: Type.String({ minLength: 1 }),
  sequence: Type.Integer({ minimum: 1 }),
  eventType: RunEventType,
  event: RunEvent,
  createdAt: Type.String({ format: 'date-time' }),
});
export type RunEventRecord = Static<typeof RunEventRecord>;

export const RunApprovalRequest = Type.Object({
  id: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  runId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  flowId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  flowName: Type.String({ minLength: 1 }),
  nodeId: Type.String({ minLength: 1 }),
  requestType: RunApprovalRequestType,
  status: RunApprovalRequestStatus,
  reason: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
  approvalMode: Type.Optional(
    Type.Union([Type.Literal('ask'), Type.Literal('elevated'), Type.Literal('trusted')]),
  ),
  requestedAt: Type.String({ format: 'date-time' }),
  timeoutAt: Type.Optional(Type.String({ format: 'date-time' })),
  decidedAt: Type.Optional(Type.String({ format: 'date-time' })),
  decidedByUserId: Type.Optional(Type.String({ format: 'uuid', minLength: 36, maxLength: 36 })),
  decision: Type.Optional(ApprovalDecision),
  note: Type.Optional(Type.String()),
});
export type RunApprovalRequest = Static<typeof RunApprovalRequest>;

export const DelegatedRunRecord = Type.Object({
  id: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  parentRunId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  parentNodeId: Type.String({ minLength: 1 }),
  delegationKind: Type.Literal('agent-send'),
  depth: Type.Integer({ minimum: 1 }),
  targetAgent: Type.String({ minLength: 1 }),
  sessionKey: Type.String({ minLength: 1 }),
  gatewayRunId: Type.Optional(Type.String()),
  handoffReason: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  status: DelegatedRunStatus,
  replyText: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  createdAt: Type.String({ format: 'date-time' }),
  startedAt: Type.Optional(Type.String({ format: 'date-time' })),
  finishedAt: Type.Optional(Type.String({ format: 'date-time' })),
});
export type DelegatedRunRecord = Static<typeof DelegatedRunRecord>;

export const RunLineage = Type.Object({
  runId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  delegatedChildren: Type.Array(DelegatedRunRecord),
  maxDelegationDepth: Type.Integer({ minimum: 0 }),
});
export type RunLineage = Static<typeof RunLineage>;
