import {
  GraphEdge,
  GraphNode,
  type WorkspaceExecPolicy,
  validateExecutableFlowGraph,
  validateFlowSemantics,
} from '@openclaw-wrapper/schemas';
import { type Static, Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { requireWorkspaceRole } from '../access-control.js';
import { flowVersions, flows, runs } from '../db/schema.js';
import {
  FLOW_TRIGGER_SECRET_HEADER,
  FlowTriggerSecurityError,
  readFlowTriggerSecurity,
  revealFlowTriggerSecret,
  rotateFlowTriggerSecret,
} from '../flow-trigger-security.js';
import {
  getExecModeAllowedFamilies,
  getExecModeAllowedPrefixes,
  matchesAllowedFamily,
  matchesAllowedPrefix,
  normalizeWorkspaceExecPolicy,
  resolveExecRuntimePolicy,
} from '../system-exec.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';

const Uuid = Type.String({ format: 'uuid', minLength: 36, maxLength: 36 });

const FlowIdInput = Type.Object({ id: Uuid });
const FlowVersionInput = Type.Object({
  id: Uuid,
  version: Type.Integer({ minimum: 1 }),
});

const CreateFlowInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  nodes: Type.Optional(Type.Array(GraphNode)),
  edges: Type.Optional(Type.Array(GraphEdge)),
});

const PublishPolicyValidationInput = Type.Object({
  nodes: Type.Array(GraphNode),
});

const UpdateFlowInput = Type.Object({
  id: Uuid,
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  nodes: Type.Optional(Type.Array(GraphNode)),
  edges: Type.Optional(Type.Array(GraphEdge)),
  expectedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
});

type UpdateFlowInput = Static<typeof UpdateFlowInput>;

function serializeFlow<
  T extends {
    createdAt: Date;
    updatedAt: Date;
    publishedVersion?: number | null;
    latestRun?: {
      id: string;
      status: string;
      createdAt: Date;
      finishedAt: Date | null;
    } | null;
  },
>(row: T) {
  return {
    ...row,
    publishedVersion: row.publishedVersion ?? undefined,
    latestRun: row.latestRun
      ? {
          ...row.latestRun,
          createdAt: row.latestRun.createdAt.toISOString(),
          finishedAt: row.latestRun.finishedAt?.toISOString(),
        }
      : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeFlowVersion<T extends { publishedAt: Date }>(row: T) {
  return {
    ...row,
    publishedAt: row.publishedAt.toISOString(),
  };
}

function getExecNodeLabel(node: GraphNode): string {
  const label = typeof node.data.label === 'string' ? node.data.label.trim() : '';
  return label || node.id;
}

function hasCommandTemplate(command: string): boolean {
  return /\{\{[\s\S]+?\}\}/u.test(command);
}

export function validateExecPublishPolicy(
  nodes: GraphNode[],
  workspacePolicy?: WorkspaceExecPolicy,
): string[] {
  const policy = resolveExecRuntimePolicy();
  const normalizedWorkspacePolicy = normalizeWorkspaceExecPolicy(workspacePolicy);
  const issues: string[] = [];

  for (const node of nodes) {
    if (node.type !== 'tool.exec') {
      continue;
    }

    const label = getExecNodeLabel(node);
    const rawApprovalMode =
      typeof node.data.approvalMode === 'string' ? node.data.approvalMode.trim() : 'ask';
    const approvalMode =
      rawApprovalMode === 'trusted' || rawApprovalMode === 'elevated' ? rawApprovalMode : 'ask';
    const command = typeof node.data.command === 'string' ? node.data.command.trim() : '';

    if (!policy.enabled) {
      issues.push(
        `Exec node "${label}" cannot be published because adapter exec is disabled (EXEC_NODE_ENABLED=false).`,
      );
      continue;
    }

    if (approvalMode === 'trusted' && !policy.allowTrusted) {
      issues.push(
        `Exec node "${label}" uses Trusted mode, but trusted exec is disabled by adapter policy (EXEC_NODE_ALLOW_TRUSTED=false).`,
      );
    }

    if (approvalMode === 'elevated' && !policy.allowElevated) {
      issues.push(
        `Exec node "${label}" uses Require elevated, but elevated exec is disabled by adapter policy (EXEC_NODE_ALLOW_ELEVATED=false).`,
      );
    }

    if (
      command &&
      policy.allowedCommandPrefixes.length > 0 &&
      !hasCommandTemplate(command) &&
      !policy.allowedCommandPrefixes.some((prefix) => matchesAllowedPrefix(command, prefix))
    ) {
      issues.push(
        `Exec node "${label}" uses a command outside the adapter allowlist. Allowed prefixes: ${policy.allowedCommandPrefixes.join(', ')}.`,
      );
    }

    if (
      command &&
      policy.allowedCommandFamilies.length > 0 &&
      !hasCommandTemplate(command) &&
      !policy.allowedCommandFamilies.some((family) => matchesAllowedFamily(command, family))
    ) {
      issues.push(
        `Exec node "${label}" uses a command outside the adapter family allowlist. Allowed families: ${policy.allowedCommandFamilies.join(', ')}.`,
      );
    }

    const modeAllowedPrefixes = getExecModeAllowedPrefixes(approvalMode, policy);
    if (
      command &&
      modeAllowedPrefixes.length > 0 &&
      !hasCommandTemplate(command) &&
      !modeAllowedPrefixes.some((prefix) => matchesAllowedPrefix(command, prefix))
    ) {
      const modeLabel = approvalMode === 'trusted' ? 'Trusted' : 'Require elevated';
      issues.push(
        `Exec node "${label}" uses ${modeLabel} with a command outside that mode allowlist. Allowed ${approvalMode} prefixes: ${modeAllowedPrefixes.join(', ')}.`,
      );
    }

    const modeAllowedFamilies = getExecModeAllowedFamilies(approvalMode, policy);
    if (
      command &&
      modeAllowedFamilies.length > 0 &&
      !hasCommandTemplate(command) &&
      !modeAllowedFamilies.some((family) => matchesAllowedFamily(command, family))
    ) {
      const modeLabel = approvalMode === 'trusted' ? 'Trusted' : 'Require elevated';
      issues.push(
        `Exec node "${label}" uses ${modeLabel} with a command outside that mode family allowlist. Allowed ${approvalMode} families: ${modeAllowedFamilies.join(', ')}.`,
      );
    }

    if (normalizedWorkspacePolicy.enabled === false) {
      issues.push(`Exec node "${label}" cannot be published because workspace exec is disabled.`);
      continue;
    }

    if (approvalMode === 'trusted' && normalizedWorkspacePolicy.allowTrusted === false) {
      issues.push(
        `Exec node "${label}" uses Trusted mode, but trusted exec is disabled by workspace policy.`,
      );
    }

    if (approvalMode === 'elevated' && normalizedWorkspacePolicy.allowElevated === false) {
      issues.push(
        `Exec node "${label}" uses Require elevated, but elevated exec is disabled by workspace policy.`,
      );
    }

    if (
      command &&
      (normalizedWorkspacePolicy.allowedCommandPrefixes?.length ?? 0) > 0 &&
      !hasCommandTemplate(command) &&
      !normalizedWorkspacePolicy.allowedCommandPrefixes?.some((prefix) =>
        matchesAllowedPrefix(command, prefix),
      )
    ) {
      issues.push(
        `Exec node "${label}" uses a command outside the workspace allowlist. Allowed prefixes: ${normalizedWorkspacePolicy.allowedCommandPrefixes?.join(', ')}.`,
      );
    }

    if (
      command &&
      (normalizedWorkspacePolicy.allowedCommandFamilies?.length ?? 0) > 0 &&
      !hasCommandTemplate(command) &&
      !normalizedWorkspacePolicy.allowedCommandFamilies?.some((family) =>
        matchesAllowedFamily(command, family),
      )
    ) {
      issues.push(
        `Exec node "${label}" uses a command outside the workspace family allowlist. Allowed families: ${normalizedWorkspacePolicy.allowedCommandFamilies?.join(', ')}.`,
      );
    }

    const workspaceModeAllowedPrefixes = getExecModeAllowedPrefixes(
      approvalMode,
      normalizedWorkspacePolicy,
    );
    if (
      command &&
      workspaceModeAllowedPrefixes.length > 0 &&
      !hasCommandTemplate(command) &&
      !workspaceModeAllowedPrefixes.some((prefix) => matchesAllowedPrefix(command, prefix))
    ) {
      const modeLabel = approvalMode === 'trusted' ? 'Trusted' : 'Require elevated';
      issues.push(
        `Exec node "${label}" uses ${modeLabel} with a command outside the workspace mode allowlist. Allowed ${approvalMode} prefixes: ${workspaceModeAllowedPrefixes.join(', ')}.`,
      );
    }

    const workspaceModeAllowedFamilies = getExecModeAllowedFamilies(
      approvalMode,
      normalizedWorkspacePolicy,
    );
    if (
      command &&
      workspaceModeAllowedFamilies.length > 0 &&
      !hasCommandTemplate(command) &&
      !workspaceModeAllowedFamilies.some((family) => matchesAllowedFamily(command, family))
    ) {
      const modeLabel = approvalMode === 'trusted' ? 'Trusted' : 'Require elevated';
      issues.push(
        `Exec node "${label}" uses ${modeLabel} with a command outside the workspace mode family allowlist. Allowed ${approvalMode} families: ${workspaceModeAllowedFamilies.join(', ')}.`,
      );
    }
  }

  return issues;
}

export const flowsRouter = router({
  list: workspaceProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: flows.id,
        name: flows.name,
        version: flows.version,
        publishedVersion: flows.publishedVersion,
        createdAt: flows.createdAt,
        updatedAt: flows.updatedAt,
      })
      .from(flows)
      .where(eq(flows.workspaceId, ctx.workspace.id))
      .orderBy(desc(flows.updatedAt));

    const latestRunsByFlowId = new Map<
      string,
      {
        id: string;
        status: string;
        createdAt: Date;
        finishedAt: Date | null;
      }
    >();

    const latestRunRows = await ctx.db
      .selectDistinctOn([runs.flowId], {
        flowId: runs.flowId,
        id: runs.id,
        status: runs.status,
        createdAt: runs.createdAt,
        finishedAt: runs.finishedAt,
      })
      .from(runs)
      .where(eq(runs.workspaceId, ctx.workspace.id))
      .orderBy(runs.flowId, desc(runs.createdAt));

    for (const latestRun of latestRunRows) {
      if (latestRun) {
        latestRunsByFlowId.set(latestRun.flowId, latestRun);
      }
    }

    return rows.map((row) =>
      serializeFlow({
        ...row,
        latestRun: latestRunsByFlowId.get(row.id) ?? null,
      }),
    );
  }),

  get: workspaceProcedure.input(parse(FlowIdInput)).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(flows)
      .where(and(eq(flows.id, input.id), eq(flows.workspaceId, ctx.workspace.id)))
      .limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'flow not found' });
    return serializeFlow(row);
  }),

  create: workspaceProcedure.input(parse(CreateFlowInput)).mutation(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .insert(flows)
      .values({
        workspaceId: ctx.workspace.id,
        name: input.name,
        nodes: input.nodes ?? [],
        edges: input.edges ?? [],
      })
      .returning();
    if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'insert failed' });
    return serializeFlow(row);
  }),

  publishPolicy: workspaceProcedure
    .input(parse(PublishPolicyValidationInput))
    .mutation(async ({ ctx, input }) => {
      return validateExecPublishPolicy(input.nodes, ctx.workspace.execPolicy).map((message) => ({
        code: 'publish-policy',
        severity: 'error' as const,
        message,
      }));
    }),

  update: workspaceProcedure.input(parse(UpdateFlowInput)).mutation(async ({ ctx, input }) => {
    const patch: Partial<typeof flows.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.nodes !== undefined) patch.nodes = input.nodes;
    if (input.edges !== undefined) patch.edges = input.edges;

    const result = await ctx.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ version: flows.version })
        .from(flows)
        .where(and(eq(flows.id, input.id), eq(flows.workspaceId, ctx.workspace.id)))
        .limit(1);
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'flow not found' });
      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `version mismatch: expected ${input.expectedVersion}, actual ${current.version}`,
        });
      }
      patch.version = current.version + 1;
      const [row] = await tx
        .update(flows)
        .set(patch)
        .where(and(eq(flows.id, input.id), eq(flows.workspaceId, ctx.workspace.id)))
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'update failed' });
      return row;
    });

    return serializeFlow(result);
  }),

  publish: workspaceProcedure.input(parse(FlowIdInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Publishing flows');
    const now = new Date();

    const result = await ctx.db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(flows)
        .where(and(eq(flows.id, input.id), eq(flows.workspaceId, ctx.workspace.id)))
        .limit(1);
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'flow not found' });

      const issues = [
        ...validateExecutableFlowGraph(draft.nodes, draft.edges),
        ...validateFlowSemantics(draft.nodes, draft.edges),
      ];
      if (issues.length > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: issues.map((issue) => issue.message).join(' '),
        });
      }
      const execPolicyIssues = validateExecPublishPolicy(draft.nodes, ctx.workspace.execPolicy);
      if (execPolicyIssues.length > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: execPolicyIssues.join(' '),
        });
      }

      const [snapshot] = await tx
        .insert(flowVersions)
        .values({
          flowId: draft.id,
          version: draft.version,
          name: draft.name,
          nodes: draft.nodes,
          edges: draft.edges,
          publishedAt: now,
        })
        .onConflictDoUpdate({
          target: [flowVersions.flowId, flowVersions.version],
          set: {
            name: draft.name,
            nodes: draft.nodes,
            edges: draft.edges,
            publishedAt: now,
          },
        })
        .returning();
      if (!snapshot) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'publish failed' });
      }

      await tx
        .update(flows)
        .set({ publishedVersion: draft.version })
        .where(and(eq(flows.id, draft.id), eq(flows.workspaceId, ctx.workspace.id)));

      return snapshot;
    });

    return serializeFlowVersion(result);
  }),

  versions: workspaceProcedure.input(parse(FlowIdInput)).query(async ({ ctx, input }) => {
    const [ownedFlow] = await ctx.db
      .select({ id: flows.id })
      .from(flows)
      .where(and(eq(flows.id, input.id), eq(flows.workspaceId, ctx.workspace.id)))
      .limit(1);
    if (!ownedFlow) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'flow not found' });
    }

    const rows = await ctx.db
      .select()
      .from(flowVersions)
      .where(eq(flowVersions.flowId, input.id))
      .orderBy(desc(flowVersions.version));
    return rows.map(serializeFlowVersion);
  }),

  triggerSecurity: workspaceProcedure.input(parse(FlowIdInput)).query(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Viewing flow trigger security');
    try {
      const security = await readFlowTriggerSecurity(ctx.db, input.id, ctx.workspace.id);
      return {
        ...security,
        rotatedAt: security.rotatedAt?.toISOString(),
        headerName: FLOW_TRIGGER_SECRET_HEADER,
      };
    } catch (error) {
      if (error instanceof FlowTriggerSecurityError && error.code === 'FLOW_NOT_FOUND') {
        throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
      }
      throw error;
    }
  }),

  revealTriggerSecret: workspaceProcedure
    .input(parse(FlowIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Revealing flow trigger secrets');
      try {
        const secret = await revealFlowTriggerSecret(ctx.db, input.id, ctx.workspace.id);
        return {
          ...secret,
          rotatedAt: secret.rotatedAt.toISOString(),
          headerName: FLOW_TRIGGER_SECRET_HEADER,
        };
      } catch (error) {
        if (error instanceof FlowTriggerSecurityError) {
          if (error.code === 'FLOW_NOT_FOUND') {
            throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
          }
          if (error.code === 'SECRET_STORE_UNAVAILABLE') {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
          }
        }
        throw error;
      }
    }),

  rotateTriggerSecret: workspaceProcedure
    .input(parse(FlowIdInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Rotating flow trigger secrets');
      try {
        const secret = await rotateFlowTriggerSecret(ctx.db, input.id, ctx.workspace.id);
        return {
          ...secret,
          rotatedAt: secret.rotatedAt.toISOString(),
          headerName: FLOW_TRIGGER_SECRET_HEADER,
        };
      } catch (error) {
        if (error instanceof FlowTriggerSecurityError) {
          if (error.code === 'FLOW_NOT_FOUND') {
            throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
          }
          if (error.code === 'SECRET_STORE_UNAVAILABLE') {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message });
          }
        }
        throw error;
      }
    }),

  rollbackPublished: workspaceProcedure
    .input(parse(FlowVersionInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Rolling back published flows');
      const result = await ctx.db.transaction(async (tx) => {
        const [draft] = await tx
          .select({
            id: flows.id,
            version: flows.version,
            publishedVersion: flows.publishedVersion,
            workspaceId: flows.workspaceId,
          })
          .from(flows)
          .where(and(eq(flows.id, input.id), eq(flows.workspaceId, ctx.workspace.id)))
          .limit(1);
        if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'flow not found' });

        const [snapshot] = await tx
          .select({
            id: flowVersions.id,
            version: flowVersions.version,
          })
          .from(flowVersions)
          .where(and(eq(flowVersions.flowId, draft.id), eq(flowVersions.version, input.version)))
          .limit(1);
        if (!snapshot) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'flow version not found' });
        }

        const [row] = await tx
          .update(flows)
          .set({
            publishedVersion: snapshot.version,
            updatedAt: new Date(),
          })
          .where(and(eq(flows.id, draft.id), eq(flows.workspaceId, ctx.workspace.id)))
          .returning();

        if (!row) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'rollback failed' });
        }

        return row;
      });

      return serializeFlow(result);
    }),

  restoreVersion: workspaceProcedure
    .input(parse(FlowVersionInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Restoring flow versions');
      const result = await ctx.db.transaction(async (tx) => {
        const [draft] = await tx
          .select()
          .from(flows)
          .where(and(eq(flows.id, input.id), eq(flows.workspaceId, ctx.workspace.id)))
          .limit(1);
        if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'flow not found' });

        const [snapshot] = await tx
          .select()
          .from(flowVersions)
          .where(and(eq(flowVersions.flowId, draft.id), eq(flowVersions.version, input.version)))
          .limit(1);
        if (!snapshot) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'flow version not found' });
        }

        const [row] = await tx
          .update(flows)
          .set({
            name: snapshot.name,
            nodes: snapshot.nodes,
            edges: snapshot.edges,
            version: draft.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(flows.id, draft.id), eq(flows.workspaceId, ctx.workspace.id)))
          .returning();

        if (!row) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'version restore failed',
          });
        }

        return row;
      });

      return serializeFlow(result);
    }),

  delete: workspaceProcedure.input(parse(FlowIdInput)).mutation(async ({ ctx, input }) => {
    requireWorkspaceRole(ctx, ['owner', 'admin'], 'Deleting flows');
    const deleted = await ctx.db
      .delete(flows)
      .where(and(eq(flows.id, input.id), eq(flows.workspaceId, ctx.workspace.id)))
      .returning({ id: flows.id });
    if (deleted.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'flow not found' });
    }
    return { ok: true as const, id: input.id };
  }),
});
