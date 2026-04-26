import type {
  AutomationTaskFlowStatus,
  AutomationTaskFlowStepType,
  AutomationTaskFlowSyncMode,
  AutomationTaskKind,
  AutomationTaskRole,
  RunStatus,
  RunTrigger,
} from '@openclaw-wrapper/schemas';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { automationTaskFlowSteps, automationTaskFlows, automationTasks } from './db/schema.js';

type MutableDb = Pick<Db, 'select' | 'insert' | 'update'>;

const AUTOMATION_FLOW_ROW = {
  id: automationTaskFlows.id,
  workspaceId: automationTaskFlows.workspaceId,
  flowId: automationTaskFlows.flowId,
  name: automationTaskFlows.name,
  lookupKey: automationTaskFlows.lookupKey,
  syncMode: automationTaskFlows.syncMode,
  triggerType: automationTaskFlows.triggerType,
  triggerKey: automationTaskFlows.triggerKey,
  scopeKey: automationTaskFlows.scopeKey,
  revision: automationTaskFlows.revision,
  status: automationTaskFlows.status,
  latestRunId: automationTaskFlows.latestRunId,
  startedAt: automationTaskFlows.startedAt,
  finishedAt: automationTaskFlows.finishedAt,
  lastError: automationTaskFlows.lastError,
  createdAt: automationTaskFlows.createdAt,
  updatedAt: automationTaskFlows.updatedAt,
};

const AUTOMATION_TASK_ROW = {
  id: automationTasks.id,
  workspaceId: automationTasks.workspaceId,
  taskFlowId: automationTasks.taskFlowId,
  runId: automationTasks.runId,
  flowId: automationTasks.flowId,
  role: automationTasks.role,
  parentTaskId: automationTasks.parentTaskId,
  sourceTaskId: automationTasks.sourceTaskId,
  sequence: automationTasks.sequence,
  attempt: automationTasks.attempt,
  kind: automationTasks.kind,
  summary: automationTasks.summary,
  status: automationTasks.status,
  trigger: automationTasks.trigger,
  error: automationTasks.error,
  startedAt: automationTasks.startedAt,
  finishedAt: automationTasks.finishedAt,
  createdAt: automationTasks.createdAt,
  updatedAt: automationTasks.updatedAt,
};

type AutomationFlowRowShape = {
  id: string;
  workspaceId: string;
  flowId: string;
  name: string;
  lookupKey: string;
  syncMode: AutomationTaskFlowSyncMode;
  triggerType: AutomationTaskKind;
  triggerKey: string;
  scopeKey: string | null;
  revision: number;
  status: AutomationTaskFlowStatus;
  latestRunId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AutomationTaskRowShape = {
  id: string;
  workspaceId: string;
  taskFlowId: string;
  runId: string;
  flowId: string;
  role: AutomationTaskRole;
  parentTaskId: string | null;
  sourceTaskId: string | null;
  sequence: number;
  attempt: number;
  kind: AutomationTaskKind;
  summary: string;
  status: AutomationTaskFlowStatus;
  trigger: RunTrigger;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface AutomationTrackedRun {
  id: string;
  workspaceId: string;
  flowId: string;
  status: RunStatus;
  trigger: RunTrigger;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface AutomationTaskControl {
  taskFlowId?: string;
  parentTaskId?: string;
  sourceTaskId?: string;
  role?: AutomationTaskRole;
  summary?: string;
}

export interface CancelAutomationTaskFlowInput {
  workspaceId: string;
  taskFlowId: string;
  note?: string;
  cancelledAt?: Date;
}

interface AutomationIdentity {
  syncMode: AutomationTaskFlowSyncMode;
  kind: AutomationTaskKind;
  lookupKey: string;
  triggerKey: string;
  scopeKey?: string;
  label: string;
  taskSummary: string;
}

interface FlowRollupOptions {
  currentStatus?: AutomationTaskFlowStatus;
  hasManagedChildren?: boolean;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function summarizeTrigger(trigger: RunTrigger): string {
  if (trigger.type === 'task') {
    const taskType = readNonEmptyString(trigger.taskType) ?? 'task';
    const taskQueue = readNonEmptyString(trigger.taskQueue);
    return taskQueue ? `${taskType} in ${taskQueue}` : taskType;
  }

  if (trigger.type === 'standing-order') {
    const standingOrderKey = readNonEmptyString(trigger.standingOrderKey) ?? 'standing-order';
    const scope = readNonEmptyString(trigger.standingOrderScope);
    return scope ? `${standingOrderKey} (${scope})` : standingOrderKey;
  }

  return readNonEmptyString(trigger.label) ?? trigger.type;
}

function isActiveFlowStatus(status: AutomationTaskFlowStatus): boolean {
  return status === 'pending' || status === 'running' || status === 'waiting';
}

function isTerminalFlowStatus(status: AutomationTaskFlowStatus): boolean {
  return (
    status === 'blocked' ||
    status === 'partial' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled'
  );
}

function formatRoleLabel(role: AutomationTaskRole, attempt: number): string {
  switch (role) {
    case 'child':
      return 'Child task';
    case 'retry':
      return `Retry ${attempt}`;
    default:
      return 'Root task';
  }
}

function buildFlowStatusSummary(status: AutomationTaskFlowStatus): string {
  switch (status) {
    case 'pending':
      return 'Task flow is queued for work.';
    case 'running':
      return 'Task flow is actively processing work.';
    case 'waiting':
      return 'Task flow is waiting on an approval or timer.';
    case 'blocked':
      return 'Task flow is blocked by failed child work and needs a retry or new child task.';
    case 'partial':
      return 'Task flow completed with mixed outcomes across its managed work.';
    case 'succeeded':
      return 'Task flow completed successfully.';
    case 'failed':
      return 'Task flow failed before any managed recovery path completed.';
    case 'cancelled':
      return 'Task flow was cancelled and will not accept new work.';
  }
}

async function appendAutomationStep(
  db: MutableDb,
  input: {
    workspaceId: string;
    taskFlowId: string;
    taskId?: string;
    runId?: string;
    stepType: AutomationTaskFlowStepType;
    status?: AutomationTaskFlowStatus;
    summary: string;
    details?: Record<string, unknown>;
    createdAt?: Date;
  },
): Promise<void> {
  await db.insert(automationTaskFlowSteps).values({
    workspaceId: input.workspaceId,
    taskFlowId: input.taskFlowId,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    stepType: input.stepType,
    status: input.status,
    summary: input.summary,
    details: input.details ?? null,
    createdAt: input.createdAt ?? new Date(),
  });
}

async function getLatestTask(
  db: MutableDb,
  taskFlowId: string,
): Promise<Pick<AutomationTaskRowShape, 'sequence'> | undefined> {
  const [latestTask] = await db
    .select({ sequence: automationTasks.sequence })
    .from(automationTasks)
    .where(eq(automationTasks.taskFlowId, taskFlowId))
    .orderBy(desc(automationTasks.sequence), desc(automationTasks.createdAt))
    .limit(1);

  return latestTask;
}

function buildTaskSummary(input: {
  role: AutomationTaskRole;
  summary?: string;
  identity?: AutomationIdentity | null;
  sourceTask?: AutomationTaskRowShape;
  parentTask?: AutomationTaskRowShape;
  trigger: RunTrigger;
  attempt: number;
}): string {
  const explicitSummary = readNonEmptyString(input.summary);
  if (explicitSummary) return explicitSummary;

  if (input.role === 'retry' && input.sourceTask) {
    return `Retry ${input.attempt} - ${input.sourceTask.summary}`;
  }

  if (input.role === 'child') {
    const parentSummary = input.parentTask?.summary ?? input.sourceTask?.summary;
    if (parentSummary) {
      return `Child task - ${parentSummary}`;
    }
  }

  if (input.identity) {
    return input.identity.taskSummary;
  }

  return summarizeTrigger(input.trigger);
}

function hasManagedChildren(tasks: AutomationTaskRowShape[]): boolean {
  return tasks.some((task) => task.role !== 'root') || tasks.length > 1;
}

function deriveLatestError(tasks: AutomationTaskRowShape[]): string | null {
  const latestErroredTask = tasks
    .filter((task) => typeof task.error === 'string' && task.error.length > 0)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  return latestErroredTask?.error ?? null;
}

function deriveFinishedAt(tasks: AutomationTaskRowShape[]): Date | null {
  return (
    tasks
      .map((task) => task.finishedAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  );
}

export function deriveAutomationIdentity(trigger: RunTrigger): AutomationIdentity | null {
  if (trigger.type === 'task') {
    const taskType = readNonEmptyString(trigger.taskType);
    if (!taskType) return null;
    const taskQueue = readNonEmptyString(trigger.taskQueue) ?? 'default';
    const taskPriority = readNonEmptyString(trigger.taskPriority);
    return {
      syncMode: 'managed',
      kind: 'task',
      lookupKey: `task:${taskType}:${taskQueue}`,
      triggerKey: taskType,
      scopeKey: taskQueue,
      label: `Task Flow - ${taskType}`,
      taskSummary: taskPriority
        ? `${taskType} in ${taskQueue} (${taskPriority})`
        : `${taskType} in ${taskQueue}`,
    };
  }

  if (trigger.type === 'standing-order') {
    const standingOrderKey = readNonEmptyString(trigger.standingOrderKey);
    if (!standingOrderKey) return null;
    const standingOrderScope = readNonEmptyString(trigger.standingOrderScope) ?? 'global';
    return {
      syncMode: 'managed',
      kind: 'standing-order',
      lookupKey: `standing-order:${standingOrderKey}:${standingOrderScope}`,
      triggerKey: standingOrderKey,
      scopeKey: standingOrderScope,
      label: `Standing Order - ${standingOrderKey}`,
      taskSummary: `${standingOrderKey} (${standingOrderScope})`,
    };
  }

  return null;
}

export function aggregateAutomationFlowStatus(
  statuses: AutomationTaskFlowStatus[],
  options: FlowRollupOptions = {},
): AutomationTaskFlowStatus {
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('waiting')) return 'waiting';
  if (statuses.includes('pending')) return 'pending';

  if (options.currentStatus === 'cancelled') {
    return 'cancelled';
  }

  const failedCount = statuses.filter((status) => status === 'failed').length;
  const succeededCount = statuses.filter((status) => status === 'succeeded').length;
  const cancelledCount = statuses.filter((status) => status === 'cancelled').length;

  if (failedCount > 0) {
    if (succeededCount > 0 || cancelledCount > 0) {
      return 'partial';
    }

    if (options.hasManagedChildren) {
      return 'blocked';
    }

    return 'failed';
  }

  if (cancelledCount > 0) {
    return 'cancelled';
  }

  if (succeededCount > 0) {
    return 'succeeded';
  }

  return options.currentStatus ?? 'pending';
}

export async function markAutomationTaskFlowCancelled(
  db: MutableDb,
  input: CancelAutomationTaskFlowInput,
): Promise<AutomationFlowRowShape | null> {
  const [taskFlow] = await db
    .select(AUTOMATION_FLOW_ROW)
    .from(automationTaskFlows)
    .where(
      and(
        eq(automationTaskFlows.id, input.taskFlowId),
        eq(automationTaskFlows.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  if (!taskFlow) return null;

  if (taskFlow.status === 'cancelled') {
    return taskFlow;
  }

  const cancelledAt = input.cancelledAt ?? new Date();
  const [updatedTaskFlow] = await db
    .update(automationTaskFlows)
    .set({
      status: 'cancelled',
      finishedAt: cancelledAt,
      lastError: null,
      updatedAt: cancelledAt,
    })
    .where(eq(automationTaskFlows.id, taskFlow.id))
    .returning(AUTOMATION_FLOW_ROW);

  const resolvedTaskFlow = updatedTaskFlow ?? taskFlow;
  await appendAutomationStep(db, {
    workspaceId: resolvedTaskFlow.workspaceId,
    taskFlowId: resolvedTaskFlow.id,
    runId: resolvedTaskFlow.latestRunId ?? undefined,
    stepType: 'flow.status',
    status: 'cancelled',
    summary: input.note?.trim().length
      ? `Task flow cancelled: ${input.note.trim()}`
      : 'Task flow cancelled by operator.',
    details: {
      fromStatus: taskFlow.status,
      toStatus: 'cancelled',
      note: input.note?.trim() || undefined,
    },
    createdAt: cancelledAt,
  });

  return resolvedTaskFlow;
}

export async function trackAutomationRunStarted(
  db: MutableDb,
  input: {
    flowName: string;
    run: AutomationTrackedRun;
    automation?: AutomationTaskControl;
  },
): Promise<void> {
  const now = input.run.createdAt;
  const explicitTaskFlowId = readNonEmptyString(input.automation?.taskFlowId);
  const identity = explicitTaskFlowId ? null : deriveAutomationIdentity(input.run.trigger);

  let taskFlow: AutomationFlowRowShape | undefined;
  let createdFlow = false;

  if (explicitTaskFlowId) {
    const [existingFlow] = await db
      .select(AUTOMATION_FLOW_ROW)
      .from(automationTaskFlows)
      .where(
        and(
          eq(automationTaskFlows.id, explicitTaskFlowId),
          eq(automationTaskFlows.workspaceId, input.run.workspaceId),
          eq(automationTaskFlows.flowId, input.run.flowId),
        ),
      )
      .limit(1);

    if (!existingFlow) {
      throw new Error(`automation task flow "${explicitTaskFlowId}" was not found`);
    }

    const [updatedFlow] = await db
      .update(automationTaskFlows)
      .set({
        status: input.run.status,
        latestRunId: input.run.id,
        lastError: input.run.error,
        startedAt: existingFlow.startedAt ?? input.run.startedAt ?? input.run.createdAt,
        finishedAt: input.run.finishedAt,
        updatedAt: now,
      })
      .where(eq(automationTaskFlows.id, existingFlow.id))
      .returning(AUTOMATION_FLOW_ROW);

    taskFlow = updatedFlow ?? existingFlow;
  } else if (identity) {
    const [latestFlow] = await db
      .select(AUTOMATION_FLOW_ROW)
      .from(automationTaskFlows)
      .where(
        and(
          eq(automationTaskFlows.workspaceId, input.run.workspaceId),
          eq(automationTaskFlows.flowId, input.run.flowId),
          eq(automationTaskFlows.lookupKey, identity.lookupKey),
        ),
      )
      .orderBy(desc(automationTaskFlows.revision))
      .limit(1);

    const shouldReuseLatest = latestFlow && isActiveFlowStatus(latestFlow.status);
    const revision = shouldReuseLatest ? latestFlow.revision : (latestFlow?.revision ?? 0) + 1;
    const startedAt = input.run.startedAt ?? input.run.createdAt;

    const [resolvedFlow] = shouldReuseLatest
      ? await db
          .update(automationTaskFlows)
          .set({
            syncMode: identity.syncMode,
            status: input.run.status,
            latestRunId: input.run.id,
            lastError: input.run.error,
            startedAt: latestFlow.startedAt ?? startedAt,
            finishedAt: input.run.finishedAt,
            updatedAt: now,
          })
          .where(eq(automationTaskFlows.id, latestFlow.id))
          .returning(AUTOMATION_FLOW_ROW)
      : await db
          .insert(automationTaskFlows)
          .values({
            workspaceId: input.run.workspaceId,
            flowId: input.run.flowId,
            name: `${input.flowName} - ${identity.label}`,
            lookupKey: identity.lookupKey,
            syncMode: identity.syncMode,
            triggerType: identity.kind,
            triggerKey: identity.triggerKey,
            scopeKey: identity.scopeKey ?? null,
            revision,
            status: input.run.status,
            latestRunId: input.run.id,
            startedAt,
            finishedAt: input.run.finishedAt,
            lastError: input.run.error,
            createdAt: now,
            updatedAt: now,
          })
          .returning(AUTOMATION_FLOW_ROW);

    taskFlow = resolvedFlow;
    createdFlow = !shouldReuseLatest;
  }

  if (!taskFlow) return;

  const sourceTaskId = readNonEmptyString(input.automation?.sourceTaskId) ?? null;
  const requestedParentTaskId = readNonEmptyString(input.automation?.parentTaskId) ?? null;
  const role = input.automation?.role ?? 'root';

  let sourceTask: AutomationTaskRowShape | undefined;
  if (sourceTaskId) {
    [sourceTask] = await db
      .select(AUTOMATION_TASK_ROW)
      .from(automationTasks)
      .where(and(eq(automationTasks.id, sourceTaskId), eq(automationTasks.taskFlowId, taskFlow.id)))
      .limit(1);
  }

  let parentTask: AutomationTaskRowShape | undefined;
  const parentTaskId =
    requestedParentTaskId ??
    (role === 'child' ? (sourceTask?.id ?? null) : (sourceTask?.parentTaskId ?? null));

  if (parentTaskId) {
    [parentTask] = await db
      .select(AUTOMATION_TASK_ROW)
      .from(automationTasks)
      .where(and(eq(automationTasks.id, parentTaskId), eq(automationTasks.taskFlowId, taskFlow.id)))
      .limit(1);
  }

  const latestTask = await getLatestTask(db, taskFlow.id);
  const attempt = role === 'retry' ? (sourceTask?.attempt ?? 0) + 1 : 1;
  const summary = buildTaskSummary({
    role,
    summary: input.automation?.summary,
    identity,
    sourceTask,
    parentTask,
    trigger: input.run.trigger,
    attempt,
  });

  const [task] = await db
    .insert(automationTasks)
    .values({
      workspaceId: input.run.workspaceId,
      taskFlowId: taskFlow.id,
      runId: input.run.id,
      flowId: input.run.flowId,
      role,
      parentTaskId: parentTask?.id ?? null,
      sourceTaskId: sourceTask?.id ?? null,
      sequence: (latestTask?.sequence ?? 0) + 1,
      attempt,
      kind: taskFlow.triggerType,
      summary,
      status: input.run.status,
      trigger: input.run.trigger,
      error: input.run.error,
      startedAt: input.run.startedAt,
      finishedAt: input.run.finishedAt,
      createdAt: input.run.createdAt,
      updatedAt: now,
    })
    .returning(AUTOMATION_TASK_ROW);

  if (!task) return;

  if (createdFlow) {
    await appendAutomationStep(db, {
      workspaceId: input.run.workspaceId,
      taskFlowId: taskFlow.id,
      runId: input.run.id,
      stepType: 'flow.created',
      status: taskFlow.status,
      summary: `Started managed task flow revision ${taskFlow.revision}`,
      details: {
        triggerType: taskFlow.triggerType,
        triggerKey: taskFlow.triggerKey,
        scopeKey: taskFlow.scopeKey ?? undefined,
      },
      createdAt: now,
    });
  }

  await appendAutomationStep(db, {
    workspaceId: input.run.workspaceId,
    taskFlowId: taskFlow.id,
    taskId: task.id,
    runId: input.run.id,
    stepType: 'task.spawned',
    status: input.run.status,
    summary: `${formatRoleLabel(task.role, task.attempt)} spawned: ${task.summary}`,
    details: {
      role: task.role,
      attempt: task.attempt,
      sequence: task.sequence,
      parentTaskId: task.parentTaskId ?? undefined,
      sourceTaskId: task.sourceTaskId ?? undefined,
    },
    createdAt: now,
  });

  if (!createdFlow && taskFlow.status !== input.run.status) {
    await appendAutomationStep(db, {
      workspaceId: input.run.workspaceId,
      taskFlowId: taskFlow.id,
      runId: input.run.id,
      stepType: 'flow.status',
      status: input.run.status,
      summary: buildFlowStatusSummary(input.run.status),
      details: {
        fromStatus: taskFlow.status,
        toStatus: input.run.status,
      },
      createdAt: now,
    });
  }
}

export async function syncAutomationRunState(
  db: MutableDb,
  run: AutomationTrackedRun,
): Promise<void> {
  const [task] = await db
    .select(AUTOMATION_TASK_ROW)
    .from(automationTasks)
    .where(eq(automationTasks.runId, run.id))
    .limit(1);

  if (!task) return;

  const [taskFlow] = await db
    .select(AUTOMATION_FLOW_ROW)
    .from(automationTaskFlows)
    .where(eq(automationTaskFlows.id, task.taskFlowId))
    .limit(1);

  if (!taskFlow) return;

  const updatedAt = run.finishedAt ?? new Date();
  await db
    .update(automationTasks)
    .set({
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      updatedAt,
    })
    .where(eq(automationTasks.id, task.id));

  if (task.status !== run.status || task.error !== run.error) {
    await appendAutomationStep(db, {
      workspaceId: run.workspaceId,
      taskFlowId: task.taskFlowId,
      taskId: task.id,
      runId: run.id,
      stepType: 'task.status',
      status: run.status,
      summary: `${formatRoleLabel(task.role, task.attempt)} ${run.status}: ${task.summary}`,
      details: {
        fromStatus: task.status,
        toStatus: run.status,
        error: run.error ?? undefined,
      },
      createdAt: updatedAt,
    });
  }

  const siblingTasks = await db
    .select(AUTOMATION_TASK_ROW)
    .from(automationTasks)
    .where(eq(automationTasks.taskFlowId, task.taskFlowId));

  const flowStatus = aggregateAutomationFlowStatus(
    siblingTasks.map((row) => row.status),
    {
      currentStatus: taskFlow.status,
      hasManagedChildren: hasManagedChildren(siblingTasks),
    },
  );
  const finishedAt = isTerminalFlowStatus(flowStatus) ? deriveFinishedAt(siblingTasks) : null;
  const lastError = deriveLatestError(siblingTasks);

  await db
    .update(automationTaskFlows)
    .set({
      status: flowStatus,
      latestRunId: run.id,
      finishedAt,
      lastError,
      updatedAt,
    })
    .where(eq(automationTaskFlows.id, task.taskFlowId));

  if (taskFlow.status !== flowStatus) {
    await appendAutomationStep(db, {
      workspaceId: run.workspaceId,
      taskFlowId: task.taskFlowId,
      runId: run.id,
      stepType: 'flow.status',
      status: flowStatus,
      summary: buildFlowStatusSummary(flowStatus),
      details: {
        fromStatus: taskFlow.status,
        toStatus: flowStatus,
        totalTasks: siblingTasks.length,
        activeTasks: siblingTasks.filter((row) => isActiveFlowStatus(row.status)).length,
        failedTasks: siblingTasks.filter((row) => row.status === 'failed').length,
      },
      createdAt: updatedAt,
    });
  }
}
