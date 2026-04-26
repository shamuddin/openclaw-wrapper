import { type Static, Type } from '@sinclair/typebox';

export const CronSchedule = Type.Union([
  Type.Object({
    kind: Type.Literal('at'),
    at: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal('every'),
    everyMs: Type.Integer({ minimum: 1 }),
    anchorMs: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  Type.Object({
    kind: Type.Literal('cron'),
    expr: Type.String({ minLength: 1 }),
    tz: Type.Optional(Type.String({ minLength: 1 })),
    staggerMs: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
]);
export type CronSchedule = Static<typeof CronSchedule>;

export const CronSessionTarget = Type.Union([
  Type.Literal('main'),
  Type.Literal('isolated'),
  Type.Literal('current'),
  Type.String({ pattern: '^session:.+$' }),
]);
export type CronSessionTarget = Static<typeof CronSessionTarget>;

export const CronWakeMode = Type.Union([
  Type.Literal('next-heartbeat'),
  Type.Literal('now'),
]);
export type CronWakeMode = Static<typeof CronWakeMode>;

export const CronDeliveryMode = Type.Union([
  Type.Literal('none'),
  Type.Literal('announce'),
  Type.Literal('webhook'),
]);
export type CronDeliveryMode = Static<typeof CronDeliveryMode>;

export const CronFailureDestination = Type.Object({
  channel: Type.Optional(Type.String({ minLength: 1 })),
  to: Type.Optional(Type.String({ minLength: 1 })),
  accountId: Type.Optional(Type.String({ minLength: 1 })),
  mode: Type.Optional(Type.Union([Type.Literal('announce'), Type.Literal('webhook')])),
});
export type CronFailureDestination = Static<typeof CronFailureDestination>;

export const CronDelivery = Type.Object({
  mode: CronDeliveryMode,
  channel: Type.Optional(Type.String({ minLength: 1 })),
  to: Type.Optional(Type.String({ minLength: 1 })),
  threadId: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Integer()])),
  accountId: Type.Optional(Type.String({ minLength: 1 })),
  bestEffort: Type.Optional(Type.Boolean()),
  failureDestination: Type.Optional(CronFailureDestination),
});
export type CronDelivery = Static<typeof CronDelivery>;

export const CronFailureAlert = Type.Object({
  after: Type.Optional(Type.Integer({ minimum: 1 })),
  channel: Type.Optional(Type.String({ minLength: 1 })),
  to: Type.Optional(Type.String({ minLength: 1 })),
  cooldownMs: Type.Optional(Type.Integer({ minimum: 0 })),
  mode: Type.Optional(Type.Union([Type.Literal('announce'), Type.Literal('webhook')])),
  accountId: Type.Optional(Type.String({ minLength: 1 })),
});
export type CronFailureAlert = Static<typeof CronFailureAlert>;

export const CronPayload = Type.Union([
  Type.Object({
    kind: Type.Literal('systemEvent'),
    text: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    kind: Type.Literal('agentTurn'),
    message: Type.String({ minLength: 1 }),
    model: Type.Optional(Type.String({ minLength: 1 })),
    fallbacks: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    thinking: Type.Optional(Type.String({ minLength: 1 })),
    timeoutSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
    allowUnsafeExternalContent: Type.Optional(Type.Boolean()),
    lightContext: Type.Optional(Type.Boolean()),
    toolsAllow: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  }),
  Type.Object({
    kind: Type.Literal('flowTrigger'),
  }),
]);
export type CronPayload = Static<typeof CronPayload>;

export const CronJobSource = Type.Union([
  Type.Object({
    kind: Type.Literal('flowTrigger'),
    flowId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
    flowVersion: Type.Integer({ minimum: 1 }),
    nodeId: Type.String({ minLength: 1, maxLength: 200 }),
  }),
]);
export type CronJobSource = Static<typeof CronJobSource>;

export const CronRunStatus = Type.Union([
  Type.Literal('ok'),
  Type.Literal('error'),
  Type.Literal('skipped'),
]);
export type CronRunStatus = Static<typeof CronRunStatus>;

export const CronRunTriggerMode = Type.Union([
  Type.Literal('force'),
  Type.Literal('due'),
]);
export type CronRunTriggerMode = Static<typeof CronRunTriggerMode>;

export const CronDeliveryStatus = Type.Union([
  Type.Literal('delivered'),
  Type.Literal('not-delivered'),
  Type.Literal('unknown'),
  Type.Literal('not-requested'),
]);
export type CronDeliveryStatus = Static<typeof CronDeliveryStatus>;

export const CronJobState = Type.Object({
  nextRunAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
  runningAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
  lastRunAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
  lastRunStatus: Type.Optional(CronRunStatus),
  lastError: Type.Optional(Type.String()),
  lastDurationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  consecutiveErrors: Type.Optional(Type.Integer({ minimum: 0 })),
  lastFailureAlertAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
  scheduleErrorCount: Type.Optional(Type.Integer({ minimum: 0 })),
  lastDeliveryStatus: Type.Optional(CronDeliveryStatus),
  lastDeliveryError: Type.Optional(Type.String()),
  lastDelivered: Type.Optional(Type.Boolean()),
});
export type CronJobState = Static<typeof CronJobState>;

export const CronJobRecord = Type.Object({
  id: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  workspaceId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sessionKey: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  clearAgent: Type.Optional(Type.Boolean()),
  enabled: Type.Boolean(),
  deleteAfterRun: Type.Boolean(),
  schedule: CronSchedule,
  sessionTarget: CronSessionTarget,
  wakeMode: CronWakeMode,
  payload: CronPayload,
  delivery: Type.Optional(CronDelivery),
  failureAlert: Type.Optional(Type.Union([CronFailureAlert, Type.Literal(false)])),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
  source: Type.Optional(CronJobSource),
  state: CronJobState,
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});
export type CronJobRecord = Static<typeof CronJobRecord>;

export const CronJobRunRecord = Type.Object({
  id: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  workspaceId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  jobId: Type.Optional(Type.String({ format: 'uuid', minLength: 36, maxLength: 36 })),
  jobName: Type.String({ minLength: 1, maxLength: 200 }),
  triggerMode: CronRunTriggerMode,
  status: CronRunStatus,
  summary: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  sessionKey: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  deliveryStatus: Type.Optional(CronDeliveryStatus),
  deliveryError: Type.Optional(Type.String()),
  delivered: Type.Optional(Type.Boolean()),
  startedAt: Type.String({ format: 'date-time' }),
  finishedAt: Type.Optional(Type.String({ format: 'date-time' })),
  durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
  createdAt: Type.String({ format: 'date-time' }),
});
export type CronJobRunRecord = Static<typeof CronJobRunRecord>;

export const CronJobCreate = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  agentId: Type.Optional(Type.String({ maxLength: 200 })),
  sessionKey: Type.Optional(Type.String({ maxLength: 400 })),
  clearAgent: Type.Optional(Type.Boolean()),
  enabled: Type.Optional(Type.Boolean()),
  deleteAfterRun: Type.Optional(Type.Boolean()),
  schedule: CronSchedule,
  sessionTarget: Type.Optional(CronSessionTarget),
  wakeMode: Type.Optional(CronWakeMode),
  payload: CronPayload,
  delivery: Type.Optional(CronDelivery),
  failureAlert: Type.Optional(Type.Union([CronFailureAlert, Type.Literal(false)])),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
  state: Type.Optional(CronJobState),
});
export type CronJobCreate = Static<typeof CronJobCreate>;

export const CronJobPatch = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  agentId: Type.Optional(Type.String({ maxLength: 200 })),
  sessionKey: Type.Optional(Type.String({ maxLength: 400 })),
  clearAgent: Type.Optional(Type.Boolean()),
  enabled: Type.Optional(Type.Boolean()),
  deleteAfterRun: Type.Optional(Type.Boolean()),
  schedule: Type.Optional(CronSchedule),
  sessionTarget: Type.Optional(CronSessionTarget),
  wakeMode: Type.Optional(CronWakeMode),
  payload: Type.Optional(CronPayload),
  delivery: Type.Optional(CronDelivery),
  failureAlert: Type.Optional(Type.Union([CronFailureAlert, Type.Literal(false)])),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
  state: Type.Optional(CronJobState),
});
export type CronJobPatch = Static<typeof CronJobPatch>;
