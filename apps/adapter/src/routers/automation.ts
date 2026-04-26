import { Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { markAutomationTaskFlowCancelled } from '../automation-service.js';
import {
  automationTaskFlowSteps,
  automationTaskFlows,
  automationTasks,
  runDelegations,
  runs,
} from '../db/schema.js';
import {
  AutomationTaskFlowError,
  cancelRun,
  executeRunInBackground,
  retryAutomationTaskRun,
  spawnAutomationTaskRun,
} from '../run-service.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';

const Uuid = Type.String({ format: 'uuid', minLength: 36, maxLength: 36 });

const TaskFlowDetailInput = Type.Object({
  id: Uuid,
});

const CancelTaskFlowInput = Type.Object({
  id: Uuid,
  note: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
});

const SpawnChildTaskInput = Type.Object({
  taskFlowId: Uuid,
  parentTaskId: Type.Optional(Uuid),
  sourceTaskId: Type.Optional(Uuid),
  summary: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  input: Type.Optional(Type.Unknown()),
});

const RetryTaskInput = Type.Object({
  taskId: Uuid,
  summary: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  input: Type.Optional(Type.Unknown()),
});

type TaskFlowStatusKey =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'partial'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

function readCount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function emptyTaskFlowStatusCounts(): Record<TaskFlowStatusKey, number> {
  return {
    pending: 0,
    running: 0,
    waiting: 0,
    blocked: 0,
    partial: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
}

function rethrowAutomationTaskFlowError(error: unknown): never {
  if (error instanceof AutomationTaskFlowError) {
    switch (error.code) {
      case 'TASK_FLOW_NOT_FOUND':
      case 'TASK_NOT_FOUND':
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      case 'TASK_FLOW_CANCELLED':
      case 'TASK_FLOW_COMPLETED':
      case 'TASK_NOT_FAILED':
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
    }
  }

  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'unexpected automation task-flow failure',
  });
}

export const automationRouter = router({
  overview: workspaceProcedure.query(async ({ ctx }) => {
    const [flowTotalsRows, taskTotalsRows, statusRows, recentFlowRows] = await Promise.all([
      ctx.db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${automationTaskFlows.status} in ('pending', 'running', 'waiting'))`,
        })
        .from(automationTaskFlows)
        .where(eq(automationTaskFlows.workspaceId, ctx.workspace.id)),
      ctx.db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${automationTasks.status} in ('pending', 'running', 'waiting'))`,
        })
        .from(automationTasks)
        .where(eq(automationTasks.workspaceId, ctx.workspace.id)),
      ctx.db
        .select({
          status: automationTaskFlows.status,
          count: sql<number>`count(*)`,
        })
        .from(automationTaskFlows)
        .where(eq(automationTaskFlows.workspaceId, ctx.workspace.id))
        .groupBy(automationTaskFlows.status),
      ctx.db
        .select({
          id: automationTaskFlows.id,
          name: automationTaskFlows.name,
          lookupKey: automationTaskFlows.lookupKey,
          syncMode: automationTaskFlows.syncMode,
          triggerType: automationTaskFlows.triggerType,
          triggerKey: automationTaskFlows.triggerKey,
          scopeKey: automationTaskFlows.scopeKey,
          revision: automationTaskFlows.revision,
          status: automationTaskFlows.status,
          latestRunId: automationTaskFlows.latestRunId,
          lastError: automationTaskFlows.lastError,
          createdAt: automationTaskFlows.createdAt,
          updatedAt: automationTaskFlows.updatedAt,
          finishedAt: automationTaskFlows.finishedAt,
        })
        .from(automationTaskFlows)
        .where(eq(automationTaskFlows.workspaceId, ctx.workspace.id))
        .orderBy(desc(automationTaskFlows.updatedAt))
        .limit(12),
    ]);

    const recentFlowIds = recentFlowRows.map((row) => row.id);
    const taskCountRows =
      recentFlowIds.length > 0
        ? await ctx.db
            .select({
              taskFlowId: automationTasks.taskFlowId,
              count: sql<number>`count(*)`,
            })
            .from(automationTasks)
            .where(eq(automationTasks.workspaceId, ctx.workspace.id))
            .groupBy(automationTasks.taskFlowId)
        : [];

    const taskCounts = new Map(taskCountRows.map((row) => [row.taskFlowId, readCount(row.count)]));
    const flowTotals = flowTotalsRows[0];
    const taskTotals = taskTotalsRows[0];
    const flowStatusCounts = emptyTaskFlowStatusCounts();
    for (const row of statusRows) {
      if (
        row.status === 'pending' ||
        row.status === 'running' ||
        row.status === 'waiting' ||
        row.status === 'blocked' ||
        row.status === 'partial' ||
        row.status === 'succeeded' ||
        row.status === 'failed' ||
        row.status === 'cancelled'
      ) {
        flowStatusCounts[row.status] = readCount(row.count);
      }
    }

    return {
      totals: {
        flows: readCount(flowTotals?.total),
        activeFlows: readCount(flowTotals?.active),
        tasks: readCount(taskTotals?.total),
        activeTasks: readCount(taskTotals?.active),
      },
      flowStatusCounts,
      recentFlows: recentFlowRows.map((row) => ({
        id: row.id,
        name: row.name,
        lookupKey: row.lookupKey,
        syncMode: row.syncMode,
        triggerType: row.triggerType,
        triggerKey: row.triggerKey,
        scopeKey: row.scopeKey ?? undefined,
        revision: row.revision,
        status: row.status,
        latestRunId: row.latestRunId ?? undefined,
        taskCount: taskCounts.get(row.id) ?? 0,
        lastError: row.lastError ?? undefined,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString(),
      })),
    };
  }),

  get: workspaceProcedure.input(parse(TaskFlowDetailInput)).query(async ({ ctx, input }) => {
    const [taskFlow] = await ctx.db
      .select({
        id: automationTaskFlows.id,
        name: automationTaskFlows.name,
        lookupKey: automationTaskFlows.lookupKey,
        syncMode: automationTaskFlows.syncMode,
        triggerType: automationTaskFlows.triggerType,
        triggerKey: automationTaskFlows.triggerKey,
        scopeKey: automationTaskFlows.scopeKey,
        revision: automationTaskFlows.revision,
        status: automationTaskFlows.status,
        latestRunId: automationTaskFlows.latestRunId,
        lastError: automationTaskFlows.lastError,
        createdAt: automationTaskFlows.createdAt,
        updatedAt: automationTaskFlows.updatedAt,
        startedAt: automationTaskFlows.startedAt,
        finishedAt: automationTaskFlows.finishedAt,
      })
      .from(automationTaskFlows)
      .where(
        and(
          eq(automationTaskFlows.id, input.id),
          eq(automationTaskFlows.workspaceId, ctx.workspace.id),
        ),
      )
      .limit(1);

    if (!taskFlow) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'task flow not found' });
    }

    const taskRows = await ctx.db
      .select({
        id: automationTasks.id,
        runId: automationTasks.runId,
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
        createdAt: automationTasks.createdAt,
        startedAt: automationTasks.startedAt,
        finishedAt: automationTasks.finishedAt,
        runInput: runs.input,
        runOutput: runs.output,
      })
      .from(automationTasks)
      .leftJoin(runs, eq(runs.id, automationTasks.runId))
      .where(eq(automationTasks.taskFlowId, taskFlow.id))
      .orderBy(desc(automationTasks.sequence), desc(automationTasks.createdAt));

    const stepRows = await ctx.db
      .select({
        id: automationTaskFlowSteps.id,
        taskId: automationTaskFlowSteps.taskId,
        runId: automationTaskFlowSteps.runId,
        stepType: automationTaskFlowSteps.stepType,
        status: automationTaskFlowSteps.status,
        summary: automationTaskFlowSteps.summary,
        details: automationTaskFlowSteps.details,
        createdAt: automationTaskFlowSteps.createdAt,
      })
      .from(automationTaskFlowSteps)
      .where(eq(automationTaskFlowSteps.taskFlowId, taskFlow.id))
      .orderBy(desc(automationTaskFlowSteps.createdAt))
      .limit(30);

    const taskRunIds = taskRows.map((row) => row.runId).filter((runId): runId is string => !!runId);
    const delegationRows =
      taskRunIds.length > 0
        ? await ctx.db
            .select({
              id: runDelegations.id,
              runId: runDelegations.parentRunId,
              depth: runDelegations.depth,
              targetAgent: runDelegations.targetAgent,
              sessionKey: runDelegations.sessionKey,
              gatewayRunId: runDelegations.gatewayRunId,
              handoffReason: runDelegations.handoffReason,
              model: runDelegations.model,
              status: runDelegations.status,
              createdAt: runDelegations.createdAt,
            })
            .from(runDelegations)
            .where(
              and(
                inArray(runDelegations.parentRunId, taskRunIds),
                eq(runDelegations.workspaceId, ctx.workspace.id),
              ),
            )
            .orderBy(desc(runDelegations.createdAt))
        : [];

    const delegationsByRunId = new Map<
      string,
      Array<{
        id: string;
        depth: number;
        targetAgent: string;
        sessionKey: string;
        gatewayRunId?: string;
        handoffReason?: string;
        model?: string;
        status: 'running' | 'succeeded' | 'failed' | 'cancelled';
        createdAt: string;
      }>
    >();
    for (const row of delegationRows) {
      const bucket = delegationsByRunId.get(row.runId) ?? [];
      bucket.push({
        id: row.id,
        depth: row.depth,
        targetAgent: row.targetAgent,
        sessionKey: row.sessionKey,
        gatewayRunId: row.gatewayRunId ?? undefined,
        handoffReason: row.handoffReason ?? undefined,
        model: row.model ?? undefined,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      });
      delegationsByRunId.set(row.runId, bucket);
    }

    const taskStatusCounts = emptyTaskFlowStatusCounts();
    for (const row of taskRows) {
      if (
        row.status === 'pending' ||
        row.status === 'running' ||
        row.status === 'waiting' ||
        row.status === 'blocked' ||
        row.status === 'partial' ||
        row.status === 'succeeded' ||
        row.status === 'failed' ||
        row.status === 'cancelled'
      ) {
        taskStatusCounts[row.status] += 1;
      }
    }

    return {
      flow: {
        id: taskFlow.id,
        name: taskFlow.name,
        lookupKey: taskFlow.lookupKey,
        syncMode: taskFlow.syncMode,
        triggerType: taskFlow.triggerType,
        triggerKey: taskFlow.triggerKey,
        scopeKey: taskFlow.scopeKey ?? undefined,
        revision: taskFlow.revision,
        status: taskFlow.status,
        latestRunId: taskFlow.latestRunId ?? undefined,
        lastError: taskFlow.lastError ?? undefined,
        createdAt: taskFlow.createdAt.toISOString(),
        updatedAt: taskFlow.updatedAt.toISOString(),
        startedAt: taskFlow.startedAt?.toISOString(),
        finishedAt: taskFlow.finishedAt?.toISOString(),
      },
      taskStatusCounts,
      tasks: taskRows.map((row) => ({
        id: row.id,
        runId: row.runId,
        role: row.role,
        parentTaskId: row.parentTaskId ?? undefined,
        sourceTaskId: row.sourceTaskId ?? undefined,
        sequence: row.sequence,
        attempt: row.attempt,
        kind: row.kind,
        summary: row.summary,
        status: row.status,
        trigger: row.trigger,
        error: row.error ?? undefined,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString(),
        finishedAt: row.finishedAt?.toISOString(),
        runInput: row.runInput ?? undefined,
        runOutput: row.runOutput ?? undefined,
        delegations: (delegationsByRunId.get(row.runId) ?? []).map((delegation) => ({
          id: delegation.id,
          depth: delegation.depth,
          targetAgent: delegation.targetAgent,
          sessionKey: delegation.sessionKey,
          gatewayRunId: delegation.gatewayRunId,
          handoffReason: delegation.handoffReason,
          model: delegation.model,
          status: delegation.status,
          createdAt: delegation.createdAt,
        })),
      })),
      steps: stepRows.map((row) => ({
        id: row.id,
        taskId: row.taskId ?? undefined,
        runId: row.runId ?? undefined,
        stepType: row.stepType,
        status: row.status ?? undefined,
        summary: row.summary,
        details: row.details ?? undefined,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }),

  cancel: workspaceProcedure.input(parse(CancelTaskFlowInput)).mutation(async ({ ctx, input }) => {
    const [taskFlow] = await ctx.db
      .select({
        id: automationTaskFlows.id,
        status: automationTaskFlows.status,
      })
      .from(automationTaskFlows)
      .where(
        and(
          eq(automationTaskFlows.id, input.id),
          eq(automationTaskFlows.workspaceId, ctx.workspace.id),
        ),
      )
      .limit(1);

    if (!taskFlow) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'task flow not found' });
    }

    const cancelledAt = new Date();
    await markAutomationTaskFlowCancelled(ctx.db, {
      workspaceId: ctx.workspace.id,
      taskFlowId: taskFlow.id,
      note: input.note,
      cancelledAt,
    });

    const activeTasks = await ctx.db
      .select({
        id: automationTasks.id,
        runId: automationTasks.runId,
        status: automationTasks.status,
      })
      .from(automationTasks)
      .where(eq(automationTasks.taskFlowId, taskFlow.id))
      .orderBy(desc(automationTasks.createdAt));

    const cancellableTasks = activeTasks.filter(
      (task) => task.status === 'pending' || task.status === 'running' || task.status === 'waiting',
    );

    for (const task of cancellableTasks) {
      await cancelRun(ctx.db, {
        runId: task.runId,
        workspaceId: ctx.workspace.id,
        note: input.note,
        cancelledByUserId: ctx.user.id,
      });
    }

    const [updatedTaskFlow] = await ctx.db
      .select({
        id: automationTaskFlows.id,
        status: automationTaskFlows.status,
      })
      .from(automationTaskFlows)
      .where(eq(automationTaskFlows.id, taskFlow.id))
      .limit(1);

    return {
      id: taskFlow.id,
      cancelledRuns: cancellableTasks.length,
      status: updatedTaskFlow?.status ?? taskFlow.status,
    };
  }),

  spawnChild: workspaceProcedure
    .input(parse(SpawnChildTaskInput))
    .mutation(async ({ ctx, input }) => {
      if (!input.parentTaskId && !input.sourceTaskId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provide a parentTaskId or sourceTaskId to spawn child work',
        });
      }

      try {
        const run = await spawnAutomationTaskRun(ctx.db, {
          workspaceId: ctx.workspace.id,
          taskFlowId: input.taskFlowId,
          parentTaskId: input.parentTaskId,
          sourceTaskId: input.sourceTaskId,
          summary: input.summary,
          taskInput: input.input,
        });
        executeRunInBackground(ctx.db, run.id);
        return run;
      } catch (error) {
        rethrowAutomationTaskFlowError(error);
      }
    }),

  retryTask: workspaceProcedure.input(parse(RetryTaskInput)).mutation(async ({ ctx, input }) => {
    try {
      const run = await retryAutomationTaskRun(ctx.db, {
        workspaceId: ctx.workspace.id,
        taskId: input.taskId,
        summary: input.summary,
        taskInput: input.input,
      });
      executeRunInBackground(ctx.db, run.id);
      return run;
    } catch (error) {
      rethrowAutomationTaskFlowError(error);
    }
  }),
});
