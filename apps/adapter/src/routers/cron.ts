import {
  CronJobCreate,
  CronJobPatch,
  type CronJobRecord,
  type CronJobRunRecord,
  type CronPayload,
  type CronJobSource,
  type CronSessionTarget,
  type CronWakeMode,
} from '@openclaw-wrapper/schemas';
import { Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { requireWorkspaceRole } from '../access-control.js';
import {
  getCronSchedulerStatus,
  normalizeCronJobState,
  runCronJob,
} from '../cron-job-service.js';
import { cronJobRuns, cronJobs, type CronJobRow, type CronJobRunRow } from '../db/schema.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';

const Uuid = Type.String({ format: 'uuid', minLength: 36, maxLength: 36 });

const CronJobIdInput = Type.Object({ id: Uuid });
const CronJobListInput = Type.Object({
  includeDisabled: Type.Optional(Type.Boolean()),
});
const CronJobUpdateInput = Type.Object({
  id: Uuid,
  patch: CronJobPatch,
});
const CronJobRunInput = Type.Object({
  id: Uuid,
  mode: Type.Optional(Type.Union([Type.Literal('force'), Type.Literal('due')])),
});
const CronJobHistoryInput = Type.Object({
  jobId: Type.Optional(Uuid),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getDefaultSessionTarget(payload: CronPayload): CronSessionTarget {
  return payload.kind === 'systemEvent' ? 'main' : 'isolated';
}

function getDefaultWakeMode(sessionTarget: CronSessionTarget): CronWakeMode {
  return sessionTarget === 'main' ? 'next-heartbeat' : 'now';
}

export function resolveCronSessionTarget(params: {
  payload: CronPayload;
  sessionTarget?: CronSessionTarget;
  sessionKey?: string | null;
}): CronSessionTarget {
  const requestedTarget = params.sessionTarget ?? getDefaultSessionTarget(params.payload);
  if (requestedTarget !== 'current') {
    return requestedTarget;
  }

  const sessionKey = normalizeOptionalString(params.sessionKey);
  return sessionKey ? (`session:${sessionKey}` as const) : 'isolated';
}

function resolveCronWakeMode(params: {
  sessionTarget: CronSessionTarget;
  wakeMode?: CronWakeMode;
  previousSessionTarget?: CronSessionTarget;
  previousWakeMode?: CronWakeMode;
}): CronWakeMode {
  if (params.wakeMode) {
    return params.wakeMode;
  }

  if (!params.previousSessionTarget || !params.previousWakeMode) {
    return getDefaultWakeMode(params.sessionTarget);
  }

  return params.previousWakeMode === getDefaultWakeMode(params.previousSessionTarget)
    ? getDefaultWakeMode(params.sessionTarget)
    : params.previousWakeMode;
}

function validateCronJobConfig(params: {
  sessionTarget: CronSessionTarget;
  payload: CronPayload;
  delivery?: CronJobRow['delivery'];
}) {
  const { sessionTarget, payload, delivery } = params;

  if (payload.kind === 'flowTrigger') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Flow-trigger cron jobs are managed from published flow cron nodes.',
    });
  }

  if (sessionTarget === 'main' && payload.kind !== 'systemEvent') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Main-session cron jobs require payload.kind="systemEvent".',
    });
  }

  if (sessionTarget !== 'main' && payload.kind !== 'agentTurn') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Isolated, current, and custom-session cron jobs require payload.kind="agentTurn".',
    });
  }

  if (delivery?.mode === 'webhook' && !delivery.to) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Webhook delivery requires delivery.to.',
    });
  }
}

function serializeCronJobSource(row: CronJobRow): CronJobSource | undefined {
  if (row.sourceType !== 'flowTrigger' || !row.sourceFlowId || !row.sourceFlowVersion || !row.sourceNodeId) {
    return undefined;
  }

  return {
    kind: 'flowTrigger',
    flowId: row.sourceFlowId,
    flowVersion: row.sourceFlowVersion,
    nodeId: row.sourceNodeId,
  };
}

function serializeCronJob(row: CronJobRow): CronJobRecord {
  const source = serializeCronJobSource(row);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    ...(row.agentId ? { agentId: row.agentId } : {}),
    ...(row.sessionKey ? { sessionKey: row.sessionKey } : {}),
    ...(row.clearAgent ? { clearAgent: row.clearAgent } : {}),
    enabled: row.enabled,
    deleteAfterRun: row.deleteAfterRun,
    schedule: row.schedule,
    sessionTarget: row.sessionTarget,
    wakeMode: row.wakeMode,
    payload: row.payload,
    ...(row.delivery ? { delivery: row.delivery } : {}),
    ...(row.failureAlert !== null ? { failureAlert: row.failureAlert ?? undefined } : {}),
    ...(row.timeoutSeconds !== null ? { timeoutSeconds: row.timeoutSeconds ?? undefined } : {}),
    ...(source ? { source } : {}),
    state: row.state ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeCronJobRun(row: CronJobRunRow): CronJobRunRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ...(row.cronJobId ? { jobId: row.cronJobId } : {}),
    jobName: row.jobName,
    triggerMode: row.triggerMode,
    status: row.status,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.sessionKey ? { sessionKey: row.sessionKey } : {}),
    ...(row.deliveryStatus ? { deliveryStatus: row.deliveryStatus } : {}),
    ...(row.deliveryError ? { deliveryError: row.deliveryError } : {}),
    ...(row.delivered !== null ? { delivered: row.delivered ?? undefined } : {}),
    startedAt: row.startedAt.toISOString(),
    ...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
    ...(row.durationMs !== null ? { durationMs: row.durationMs ?? undefined } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export const cronRouter = router({
  status: workspaceProcedure.query(async ({ ctx }) => {
    return getCronSchedulerStatus(ctx.db, new Date(), ctx.workspace.id);
  }),

  list: workspaceProcedure.input(parse(CronJobListInput)).query(async ({ ctx, input }) => {
    const conditions = [eq(cronJobs.workspaceId, ctx.workspace.id)];
    if (!input.includeDisabled) {
      conditions.push(eq(cronJobs.enabled, true));
    }

    const rows = await ctx.db
      .select()
      .from(cronJobs)
      .where(and(...conditions))
      .orderBy(desc(cronJobs.updatedAt), desc(cronJobs.createdAt));

    return rows.map(serializeCronJob);
  }),

  get: workspaceProcedure.input(parse(CronJobIdInput)).query(async ({ ctx, input }) => {
    const row = await ctx.db.query.cronJobs.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, input.id), eq(table.workspaceId, ctx.workspace.id)),
    });

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'cron job not found' });
    }

    return serializeCronJob(row);
  }),

  history: workspaceProcedure
    .input(parse(CronJobHistoryInput))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(cronJobRuns.workspaceId, ctx.workspace.id)];
      if (input.jobId) {
        conditions.push(eq(cronJobRuns.cronJobId, input.jobId));
      }

      const rows = await ctx.db
        .select()
        .from(cronJobRuns)
        .where(and(...conditions))
        .orderBy(desc(cronJobRuns.createdAt))
        .limit(input.limit ?? 50);

      return rows.map(serializeCronJobRun);
    }),

  create: workspaceProcedure.input(parse(CronJobCreate)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Creating cron jobs');

    const sessionKey = normalizeOptionalString(input.sessionKey);
    const agentId = normalizeOptionalString(input.agentId);
    const sessionTarget = resolveCronSessionTarget({
      payload: input.payload,
      sessionTarget: input.sessionTarget,
      sessionKey,
    });
    const wakeMode = resolveCronWakeMode({
      sessionTarget,
      wakeMode: input.wakeMode,
    });
    const deleteAfterRun = input.deleteAfterRun ?? input.schedule.kind === 'at';

    validateCronJobConfig({
      sessionTarget,
      payload: input.payload,
      delivery: input.delivery,
    });

    const state = normalizeCronJobState({
      job: {
        schedule: input.schedule,
        createdAt: new Date(),
        enabled: input.enabled ?? true,
        state: input.state ?? {},
      },
    });

    const [row] = await ctx.db
      .insert(cronJobs)
      .values({
        workspaceId: ctx.workspace.id,
        name: input.name,
        description: input.description,
        agentId: agentId ?? null,
        sessionKey,
        clearAgent: input.clearAgent ?? false,
        enabled: input.enabled ?? true,
        deleteAfterRun,
        schedule: input.schedule,
        sessionTarget,
        wakeMode,
        payload: input.payload,
        delivery: input.delivery ?? null,
        failureAlert: input.failureAlert ?? null,
        timeoutSeconds: input.timeoutSeconds ?? null,
        state,
      })
      .returning();

    if (!row) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'failed to create cron job' });
    }

    return serializeCronJob(row);
  }),

  update: workspaceProcedure.input(parse(CronJobUpdateInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Updating cron jobs');

    const existing = await ctx.db.query.cronJobs.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, input.id), eq(table.workspaceId, ctx.workspace.id)),
    });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'cron job not found' });
    }

    if (existing.sourceType === 'flowTrigger') {
      const disallowedKeys = Object.keys(input.patch).filter((key) => key !== 'enabled');
      if (disallowedKeys.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Flow-managed cron jobs must be edited from the Builder cron trigger. Only pause/resume is available here.',
        });
      }

      const nextEnabled = input.patch.enabled ?? existing.enabled;
      const nextState = normalizeCronJobState({
        job: {
          schedule: existing.schedule,
          createdAt: existing.createdAt,
          enabled: nextEnabled,
          state: existing.state ?? {},
        },
      });

      const [row] = await ctx.db
        .update(cronJobs)
        .set({
          ...(input.patch.enabled !== undefined ? { enabled: input.patch.enabled } : {}),
          state: nextState,
          updatedAt: new Date(),
        })
        .where(and(eq(cronJobs.id, input.id), eq(cronJobs.workspaceId, ctx.workspace.id)))
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'failed to update cron job' });
      }

      return serializeCronJob(row);
    }

    const nextSessionKey =
      input.patch.sessionKey !== undefined ? normalizeOptionalString(input.patch.sessionKey) : existing.sessionKey;
    const nextAgentId =
      input.patch.agentId !== undefined ? normalizeOptionalString(input.patch.agentId) : existing.agentId;
    const nextSessionTarget = resolveCronSessionTarget({
      payload: input.patch.payload ?? existing.payload,
      sessionTarget: input.patch.sessionTarget ?? existing.sessionTarget,
      sessionKey: nextSessionKey,
    });
    const nextPayload = input.patch.payload ?? existing.payload;
    const nextDelivery =
      'delivery' in input.patch ? (input.patch.delivery ?? null) : (existing.delivery ?? null);
    const nextWakeMode = resolveCronWakeMode({
      sessionTarget: nextSessionTarget,
      wakeMode: input.patch.wakeMode,
      previousSessionTarget: existing.sessionTarget,
      previousWakeMode: existing.wakeMode,
    });

    validateCronJobConfig({
      sessionTarget: nextSessionTarget,
      payload: nextPayload,
      delivery: nextDelivery,
    });

    const nextState = normalizeCronJobState({
      job: {
        schedule: input.patch.schedule ?? existing.schedule,
        createdAt: existing.createdAt,
        enabled: input.patch.enabled ?? existing.enabled,
        state: input.patch.state ?? existing.state ?? {},
      },
    });

    const [row] = await ctx.db
      .update(cronJobs)
      .set({
        ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
        ...(input.patch.description !== undefined ? { description: input.patch.description } : {}),
        ...(input.patch.agentId !== undefined ? { agentId: nextAgentId ?? null } : {}),
        ...(input.patch.sessionKey !== undefined ? { sessionKey: nextSessionKey ?? null } : {}),
        ...(input.patch.clearAgent !== undefined ? { clearAgent: input.patch.clearAgent } : {}),
        ...(input.patch.enabled !== undefined ? { enabled: input.patch.enabled } : {}),
        ...(input.patch.deleteAfterRun !== undefined
          ? { deleteAfterRun: input.patch.deleteAfterRun }
          : {}),
        ...(input.patch.schedule !== undefined ? { schedule: input.patch.schedule } : {}),
        ...(input.patch.sessionTarget !== undefined ? { sessionTarget: nextSessionTarget } : {}),
        ...((input.patch.wakeMode !== undefined || input.patch.sessionTarget !== undefined)
          ? { wakeMode: nextWakeMode }
          : {}),
        ...(input.patch.payload !== undefined ? { payload: input.patch.payload } : {}),
        ...('delivery' in input.patch ? { delivery: input.patch.delivery ?? null } : {}),
        ...('failureAlert' in input.patch
          ? { failureAlert: input.patch.failureAlert ?? null }
          : {}),
        ...(input.patch.timeoutSeconds !== undefined
          ? { timeoutSeconds: input.patch.timeoutSeconds }
          : {}),
        state: nextState,
        updatedAt: new Date(),
      })
      .where(and(eq(cronJobs.id, input.id), eq(cronJobs.workspaceId, ctx.workspace.id)))
      .returning();

    if (!row) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'failed to update cron job' });
    }

    return serializeCronJob(row);
  }),

  delete: workspaceProcedure.input(parse(CronJobIdInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Deleting cron jobs');

    const existing = await ctx.db.query.cronJobs.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, input.id), eq(table.workspaceId, ctx.workspace.id)),
    });

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'cron job not found' });
    }

    if (existing.sourceType === 'flowTrigger') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Flow-managed cron jobs are removed by editing or deleting the owning flow.',
      });
    }

    const [row] = await ctx.db
      .delete(cronJobs)
      .where(and(eq(cronJobs.id, input.id), eq(cronJobs.workspaceId, ctx.workspace.id)))
      .returning();

    if (!row) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'failed to delete cron job' });
    }

    return { id: row.id };
  }),

  run: workspaceProcedure.input(parse(CronJobRunInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Running cron jobs');
    try {
      return await runCronJob({
        db: ctx.db,
        jobId: input.id,
        workspaceId: ctx.workspace.id,
        mode: input.mode ?? 'force',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'cron job not found') {
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'failed to run cron job',
      });
    }
  }),
});
