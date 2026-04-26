import { Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import {
  ApprovalDecisionError,
  RunLaunchError,
  cancelRun,
  executeRunInBackground,
  getRun,
  getRunLineage,
  listApprovalRequests,
  listRunEvents,
  listRuns,
  recordApprovalDecision,
  startPublishedFlowRun,
} from '../run-service.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';

const Uuid = Type.String({ format: 'uuid', minLength: 36, maxLength: 36 });

const FlowRunsInput = Type.Object({
  flowId: Uuid,
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

const RunIdInput = Type.Object({ id: Uuid });

const ManualRunInput = Type.Object({
  flowId: Uuid,
  input: Type.Optional(Type.Unknown()),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const WebhookRunInput = Type.Object({
  flowId: Uuid,
  input: Type.Optional(Type.Unknown()),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  eventName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const ChannelRunInput = Type.Object({
  flowId: Uuid,
  channel: Type.String({ minLength: 1, maxLength: 100 }),
  input: Type.Optional(Type.Unknown()),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  accountId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  routeKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  eventName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const CronRunInput = Type.Object({
  flowId: Uuid,
  input: Type.Optional(Type.Unknown()),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  schedule: Type.String({ minLength: 1, maxLength: 200 }),
  timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const HookRunInput = Type.Object({
  flowId: Uuid,
  input: Type.Optional(Type.Unknown()),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  hookName: Type.String({ minLength: 1, maxLength: 200 }),
  filter: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
});

const TaskRunInput = Type.Object({
  flowId: Uuid,
  input: Type.Optional(Type.Unknown()),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  taskType: Type.String({ minLength: 1, maxLength: 200 }),
  taskQueue: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  taskPriority: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
});

const StandingOrderRunInput = Type.Object({
  flowId: Uuid,
  input: Type.Optional(Type.Unknown()),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
  standingOrderKey: Type.String({ minLength: 1, maxLength: 200 }),
  standingOrderScope: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const ApprovalDecisionInput = Type.Object({
  id: Uuid,
  decision: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
  note: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
});

const ApprovalQueueInput = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal('pending'),
      Type.Literal('approved'),
      Type.Literal('rejected'),
      Type.Literal('cancelled'),
      Type.Literal('timed_out'),
    ]),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

const CancelRunInput = Type.Object({
  id: Uuid,
  note: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
});

function rethrowRunLaunchError(error: unknown): never {
  if (error instanceof RunLaunchError) {
    switch (error.code) {
      case 'FLOW_NOT_FOUND':
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      case 'FLOW_NOT_PUBLISHED':
      case 'PUBLISHED_VERSION_MISSING':
      case 'FLOW_NOT_RUNNABLE':
      case 'TRIGGER_NOT_MATCHED':
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
      case 'RUN_INSERT_FAILED':
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
    }
  }

  if (error instanceof TRPCError) throw error;
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'unexpected run launch failure' });
}

function rethrowApprovalDecisionError(error: unknown): never {
  if (error instanceof ApprovalDecisionError) {
    switch (error.code) {
      case 'RUN_NOT_FOUND':
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      case 'RUN_NOT_WAITING':
      case 'APPROVAL_NOT_PENDING':
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
    }
  }

  if (error instanceof TRPCError) throw error;
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'unexpected approval decision failure',
  });
}

export const runsRouter = router({
  list: workspaceProcedure.input(parse(FlowRunsInput)).query(async ({ ctx, input }) => {
    return listRuns(ctx.db, { ...input, workspaceId: ctx.workspace.id });
  }),

  get: workspaceProcedure.input(parse(RunIdInput)).query(async ({ ctx, input }) => {
    const run = await getRun(ctx.db, input.id, ctx.workspace.id);
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'run not found' });
    return run;
  }),

  cancel: workspaceProcedure.input(parse(CancelRunInput)).mutation(async ({ ctx, input }) => {
    const run = await cancelRun(ctx.db, {
      runId: input.id,
      workspaceId: ctx.workspace.id,
      note: input.note,
      cancelledByUserId: ctx.user.id,
    });
    if (!run) throw new TRPCError({ code: 'NOT_FOUND', message: 'run not found' });
    return run;
  }),

  events: workspaceProcedure.input(parse(RunIdInput)).query(async ({ ctx, input }) => {
    return listRunEvents(ctx.db, input.id, ctx.workspace.id);
  }),

  lineage: workspaceProcedure.input(parse(RunIdInput)).query(async ({ ctx, input }) => {
    const lineage = await getRunLineage(ctx.db, input.id, ctx.workspace.id);
    if (!lineage) throw new TRPCError({ code: 'NOT_FOUND', message: 'run not found' });
    return lineage;
  }),

  approvalQueue: workspaceProcedure
    .input(parse(ApprovalQueueInput))
    .query(async ({ ctx, input }) => {
      return listApprovalRequests(ctx.db, {
        workspaceId: ctx.workspace.id,
        status: input.status,
        limit: input.limit,
      });
    }),

  startManual: workspaceProcedure.input(parse(ManualRunInput)).mutation(async ({ ctx, input }) => {
    try {
      const run = await startPublishedFlowRun(ctx.db, {
        flowId: input.flowId,
        workspaceId: ctx.workspace.id,
        trigger: {
          type: 'manual',
          label: input.label,
          sourceId: input.sourceId,
        },
        input: input.input,
      });
      executeRunInBackground(ctx.db, run.id);
      return run;
    } catch (error) {
      rethrowRunLaunchError(error);
    }
  }),

  startWebhook: workspaceProcedure
    .input(parse(WebhookRunInput))
    .mutation(async ({ ctx, input }) => {
      try {
        const run = await startPublishedFlowRun(ctx.db, {
          flowId: input.flowId,
          workspaceId: ctx.workspace.id,
          trigger: {
            type: 'webhook',
            label: input.label,
            sourceId: input.sourceId,
            eventName: input.eventName,
          },
          input: input.input,
        });
        executeRunInBackground(ctx.db, run.id);
        return run;
      } catch (error) {
        rethrowRunLaunchError(error);
      }
    }),

  startChannel: workspaceProcedure
    .input(parse(ChannelRunInput))
    .mutation(async ({ ctx, input }) => {
      try {
        const run = await startPublishedFlowRun(ctx.db, {
          flowId: input.flowId,
          workspaceId: ctx.workspace.id,
          trigger: {
            type: 'channel',
            label: input.label,
            channel: input.channel,
            sourceId: input.sourceId,
            accountId: input.accountId,
            routeKey: input.routeKey,
            eventName: input.eventName,
          },
          input: input.input,
        });
        executeRunInBackground(ctx.db, run.id);
        return run;
      } catch (error) {
        rethrowRunLaunchError(error);
      }
    }),

  startCron: workspaceProcedure.input(parse(CronRunInput)).mutation(async ({ ctx, input }) => {
    try {
      const run = await startPublishedFlowRun(ctx.db, {
        flowId: input.flowId,
        workspaceId: ctx.workspace.id,
        trigger: {
          type: 'cron',
          label: input.label,
          sourceId: input.sourceId,
          schedule: input.schedule,
          timezone: input.timezone,
        },
        input: input.input,
      });
      executeRunInBackground(ctx.db, run.id);
      return run;
    } catch (error) {
      rethrowRunLaunchError(error);
    }
  }),

  startHook: workspaceProcedure.input(parse(HookRunInput)).mutation(async ({ ctx, input }) => {
    try {
      const run = await startPublishedFlowRun(ctx.db, {
        flowId: input.flowId,
        workspaceId: ctx.workspace.id,
        trigger: {
          type: 'hook',
          label: input.label,
          sourceId: input.sourceId,
          hookName: input.hookName,
          filter: input.filter,
        },
        input: input.input,
      });
      executeRunInBackground(ctx.db, run.id);
      return run;
    } catch (error) {
      rethrowRunLaunchError(error);
    }
  }),

  startTask: workspaceProcedure.input(parse(TaskRunInput)).mutation(async ({ ctx, input }) => {
    try {
      const run = await startPublishedFlowRun(ctx.db, {
        flowId: input.flowId,
        workspaceId: ctx.workspace.id,
        trigger: {
          type: 'task',
          label: input.label,
          sourceId: input.sourceId,
          taskType: input.taskType,
          taskQueue: input.taskQueue,
          taskPriority: input.taskPriority,
        },
        input: input.input,
      });
      executeRunInBackground(ctx.db, run.id);
      return run;
    } catch (error) {
      rethrowRunLaunchError(error);
    }
  }),

  startStandingOrder: workspaceProcedure
    .input(parse(StandingOrderRunInput))
    .mutation(async ({ ctx, input }) => {
      try {
        const run = await startPublishedFlowRun(ctx.db, {
          flowId: input.flowId,
          workspaceId: ctx.workspace.id,
          trigger: {
            type: 'standing-order',
            label: input.label,
            sourceId: input.sourceId,
            standingOrderKey: input.standingOrderKey,
            standingOrderScope: input.standingOrderScope,
          },
          input: input.input,
        });
        executeRunInBackground(ctx.db, run.id);
        return run;
      } catch (error) {
        rethrowRunLaunchError(error);
      }
    }),

  decideApproval: workspaceProcedure
    .input(parse(ApprovalDecisionInput))
    .mutation(async ({ ctx, input }) => {
      try {
        const run = await recordApprovalDecision(ctx.db, {
          runId: input.id,
          workspaceId: ctx.workspace.id,
          decision: input.decision,
          note: input.note,
          decidedByUserId: ctx.user.id,
        });
        if (!run) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'run not found' });
        }
        if (run.status === 'running') {
          executeRunInBackground(ctx.db, run.id);
        }
        return run;
      } catch (error) {
        rethrowApprovalDecisionError(error);
      }
    }),
});
