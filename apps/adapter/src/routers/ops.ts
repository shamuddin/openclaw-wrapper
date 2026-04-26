import { EXTERNAL_PLUGIN_API_VERSION, NODE_SDK_VERSION } from '@openclaw-wrapper/node-sdk';
import { Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { requireWorkspaceRole } from '../access-control.js';
import { appendWorkspaceAuditEvent } from '../audit-log.js';
import { listChannelProfiles, loadChannelCatalog } from '../channel-profiles.js';
import {
  contextMemoryEntries,
  flows,
  runApprovalRequests,
  runs,
  users,
  workspaceAuditEvents,
  workspaceInvites,
  workspaceMemberships,
} from '../db/schema.js';
import { getGatewayConnectionManager } from '../gateway-manager.js';
import { NODE_CATALOG } from '../node-catalog.js';
import {
  approveOpenClawRuntimeDevicePairing,
  approveOpenClawRuntimeNodePairing,
  loadOpenClawRuntimePairingOverview,
  rejectOpenClawRuntimeDevicePairing,
  rejectOpenClawRuntimeNodePairing,
} from '../openclaw.js';
import {
  CURRENT_ADAPTER_VERSION,
  loadInstalledPluginCatalog,
  resolvePluginsDir,
} from '../plugin-catalog.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';

const RuntimePairingRequestInput = Type.Object({
  requestId: Type.String({ minLength: 1, maxLength: 200 }),
});

type RunStatusKey = 'pending' | 'running' | 'waiting' | 'succeeded' | 'failed';

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

function emptyRunStatusCounts(): Record<RunStatusKey, number> {
  return {
    pending: 0,
    running: 0,
    waiting: 0,
    succeeded: 0,
    failed: 0,
  };
}

function normalizeLookup(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function rethrowRuntimePairingError(error: unknown): never {
  if (error instanceof TRPCError) {
    throw error;
  }
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('unknown requestId')) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Runtime pairing request not found' });
    }
    if (message.includes('forbidden') || message.includes('denied')) {
      throw new TRPCError({ code: 'FORBIDDEN', message });
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message });
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected runtime pairing error',
  });
}

export const opsRouter = router({
  overview: workspaceProcedure.query(async ({ ctx }) => {
    const workspace = ctx.workspace;
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const nowIso = now.toISOString();
    const oneDayAgoIso = oneDayAgo.toISOString();

    const [
      gateway,
      plugins,
      channelCatalog,
      channelProfiles,
      runtimePairing,
      flowTotalsRows,
      totalRunsRows,
      recentRunsRows,
      statusRows,
      pendingApprovalRows,
      memberRows,
      inviteRows,
      memoryRows,
      recentActivityRows,
    ] = await Promise.all([
      getGatewayConnectionManager().probeStatus(),
      loadInstalledPluginCatalog({
        reservedNodeTypes: NODE_CATALOG.nodes.map((node) => node.type),
      }).catch(() => ({
        // Keep ops resilient even if plugin discovery fails.
        plugins: [],
        nodes: [],
        issues: [],
      })),
      loadChannelCatalog(),
      listChannelProfiles(ctx.db, workspace.id),
      loadOpenClawRuntimePairingOverview(),
      ctx.db
        .select({
          total: sql<number>`count(*)`,
          published: sql<number>`count(*) filter (where ${flows.publishedVersion} is not null)`,
        })
        .from(flows)
        .where(eq(flows.workspaceId, workspace.id)),
      ctx.db
        .select({
          total: sql<number>`count(*)`,
          last24h: sql<number>`count(*) filter (where ${runs.createdAt} >= ${oneDayAgoIso})`,
        })
        .from(runs)
        .where(eq(runs.workspaceId, workspace.id)),
      ctx.db
        .select({
          id: runs.id,
          flowId: runs.flowId,
          flowName: flows.name,
          status: runs.status,
          trigger: runs.trigger,
          createdAt: runs.createdAt,
          startedAt: runs.startedAt,
          finishedAt: runs.finishedAt,
          error: runs.error,
        })
        .from(runs)
        .innerJoin(flows, eq(flows.id, runs.flowId))
        .where(eq(runs.workspaceId, workspace.id))
        .orderBy(desc(runs.createdAt))
        .limit(8),
      ctx.db
        .select({
          status: runs.status,
          count: sql<number>`count(*)`,
        })
        .from(runs)
        .where(eq(runs.workspaceId, workspace.id))
        .groupBy(runs.status),
      ctx.db
        .select({
          id: runApprovalRequests.id,
          runId: runApprovalRequests.runId,
          flowId: runApprovalRequests.flowId,
          nodeId: runApprovalRequests.nodeId,
          requestType: runApprovalRequests.requestType,
          reason: runApprovalRequests.reason,
          command: runApprovalRequests.command,
          approvalMode: runApprovalRequests.approvalMode,
          requestedAt: runApprovalRequests.requestedAt,
          timeoutAt: runApprovalRequests.timeoutAt,
          flowName: flows.name,
        })
        .from(runApprovalRequests)
        .innerJoin(flows, eq(flows.id, runApprovalRequests.flowId))
        .where(
          and(
            eq(runApprovalRequests.workspaceId, workspace.id),
            eq(runApprovalRequests.status, 'pending'),
          ),
        )
        .orderBy(desc(runApprovalRequests.requestedAt))
        .limit(5),
      ctx.db
        .select({
          total: sql<number>`count(*)`,
        })
        .from(workspaceMemberships)
        .where(eq(workspaceMemberships.workspaceId, workspace.id)),
      ctx.db
        .select({
          total: sql<number>`count(*)`,
        })
        .from(workspaceInvites)
        .where(
          and(
            eq(workspaceInvites.workspaceId, workspace.id),
            isNull(workspaceInvites.acceptedAt),
            isNull(workspaceInvites.revokedAt),
            sql`${workspaceInvites.expiresAt} >= ${nowIso}`,
          ),
        ),
      ctx.db
        .select({
          total: sql<number>`count(*)`,
        })
        .from(contextMemoryEntries)
        .where(eq(contextMemoryEntries.workspaceId, workspace.id)),
      ctx.db
        .select({
          id: workspaceAuditEvents.id,
          eventType: workspaceAuditEvents.eventType,
          summary: workspaceAuditEvents.summary,
          createdAt: workspaceAuditEvents.createdAt,
          actorName: users.name,
        })
        .from(workspaceAuditEvents)
        .leftJoin(users, eq(workspaceAuditEvents.actorUserId, users.id))
        .where(eq(workspaceAuditEvents.workspaceId, workspace.id))
        .orderBy(desc(workspaceAuditEvents.createdAt))
        .limit(8),
    ]);

    const flowTotals = flowTotalsRows[0];
    const runTotals = totalRunsRows[0];
    const memberTotals = memberRows[0];
    const inviteTotals = inviteRows[0];
    const memoryTotals = memoryRows[0];

    const runStatusCounts = emptyRunStatusCounts();
    for (const row of statusRows) {
      if (
        row.status === 'pending' ||
        row.status === 'running' ||
        row.status === 'waiting' ||
        row.status === 'succeeded' ||
        row.status === 'failed'
      ) {
        runStatusCounts[row.status] = readCount(row.count);
      }
    }

    const runtimeInventory = channelCatalog.runtime.map((runtime) => {
      const matchingProfiles = channelProfiles.filter(
        (profile) => normalizeLookup(profile.channelType) === normalizeLookup(runtime.channelType),
      );
      const preferredProfile = matchingProfiles.find((profile) => Boolean(profile.appliedAt));

      return {
        channelType: runtime.channelType,
        label: runtime.label ?? undefined,
        detailLabel: runtime.detailLabel ?? undefined,
        available: runtime.available,
        configured: runtime.configured ?? false,
        connected: runtime.connected ?? false,
        accountCount: runtime.accounts.length,
        configuredAccountCount: runtime.accounts.filter((account) => account.configured).length,
        runningAccountCount: runtime.accounts.filter((account) => account.running).length,
        connectedAccountCount: runtime.accounts.filter((account) => account.connected).length,
        wrapperProfileCount: matchingProfiles.length,
        preferredProfileName: preferredProfile?.name,
        accountInventory: runtime.accounts.map((account) => {
          const matchingAccountProfiles = matchingProfiles.filter((profile) => {
            const profileAccountId = normalizeLookup(profile.accountId);
            return !profileAccountId || profileAccountId === normalizeLookup(account.accountId);
          });

          return {
            accountId: account.accountId,
            label: account.label ?? undefined,
            enabled: account.enabled ?? undefined,
            configured: account.configured ?? undefined,
            running: account.running ?? undefined,
            connected: account.connected ?? undefined,
            profileNames: matchingAccountProfiles.map((profile) => profile.name),
            preferredProfileName:
              matchingAccountProfiles.find((profile) => Boolean(profile.appliedAt))?.name ??
              undefined,
          };
        }),
      };
    });
    const unmatchedProfiles = channelProfiles
      .filter((profile) => !profile.runtime)
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        channelType: profile.channelType,
        accountId: profile.accountId ?? undefined,
        appliedAt: profile.appliedAt ?? undefined,
      }));
    const pluginIssueSummary = Array.from(
      plugins.issues.reduce((summary, issue) => {
        const code = issue.code ?? 'unknown';
        summary.set(code, (summary.get(code) ?? 0) + 1);
        return summary;
      }, new Map<string, number>()),
    )
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

    return {
      authMode: ctx.authMode,
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        role: workspace.role,
      },
      runtime: {
        gateway,
        plugins: {
          installed: plugins.plugins.length,
          nodes: plugins.nodes.length,
          issues: plugins.issues.length,
          host: {
            pluginsDir: resolvePluginsDir(),
            pluginApiVersion: EXTERNAL_PLUGIN_API_VERSION,
            adapterVersion: CURRENT_ADAPTER_VERSION,
            nodeSdkVersion: NODE_SDK_VERSION,
          },
          inventory: plugins.plugins.map((plugin) => ({
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            displayName: plugin.manifest.displayName ?? undefined,
            description: plugin.manifest.description ?? undefined,
            pluginApi: plugin.manifest.compat.pluginApi,
            minAdapterVersion: plugin.manifest.compat.minAdapterVersion ?? undefined,
            builtWithAdapterVersion: plugin.manifest.compat.builtWithAdapterVersion ?? undefined,
            nodeSdkVersion: plugin.manifest.compat.nodeSdkVersion ?? undefined,
            nodeCount: plugin.manifest.nodes.length,
            nodeTypes: plugin.manifest.nodes.map((node) => node.type),
            directory: plugin.directory,
            packageJsonPath: plugin.packageJsonPath,
          })),
          issueSummary: pluginIssueSummary,
          issueInventory: plugins.issues.map((issue) => ({
            pluginPath: issue.pluginPath,
            code: issue.code ?? 'unknown',
            fieldPath: issue.fieldPath ?? undefined,
            message: issue.message,
            hint: issue.hint ?? undefined,
          })),
        },
        channels: {
          discovered: channelCatalog.runtime.length,
          connected: channelCatalog.runtime.filter((runtime) => runtime.connected).length,
          configured: channelCatalog.runtime.filter((runtime) => runtime.configured).length,
          profiles: channelProfiles.length,
          unmatchedProfiles: unmatchedProfiles.length,
          inventory: runtimeInventory,
          unmatchedProfileInventory: unmatchedProfiles,
        },
        devices: {
          pending: runtimePairing.devices.pending.length,
          paired: runtimePairing.devices.paired.length,
          pendingInventory: runtimePairing.devices.pending,
          inventory: runtimePairing.devices.paired,
        },
        nodes: {
          pending: runtimePairing.nodes.pending.length,
          paired: runtimePairing.nodes.paired.length,
          pendingInventory: runtimePairing.nodes.pending,
          inventory: runtimePairing.nodes.paired,
        },
      },
      totals: {
        flows: readCount(flowTotals?.total),
        publishedFlows: readCount(flowTotals?.published),
        draftOnlyFlows: Math.max(
          0,
          readCount(flowTotals?.total) - readCount(flowTotals?.published),
        ),
        runs: readCount(runTotals?.total),
        runsLast24h: readCount(runTotals?.last24h),
        pendingApprovals: pendingApprovalRows.length,
        members: readCount(memberTotals?.total),
        activeInvites: readCount(inviteTotals?.total),
        memoryEntries: readCount(memoryTotals?.total),
      },
      runStatusCounts,
      pendingApprovals: pendingApprovalRows.map((row) => ({
        id: row.id,
        runId: row.runId,
        flowId: row.flowId,
        flowName: row.flowName,
        nodeId: row.nodeId,
        requestType: row.requestType,
        reason: row.reason ?? undefined,
        command: row.command ?? undefined,
        approvalMode: row.approvalMode ?? undefined,
        requestedAt: row.requestedAt.toISOString(),
        timeoutAt: row.timeoutAt?.toISOString(),
      })),
      recentRuns: recentRunsRows.map((row) => {
        const trigger =
          row.trigger && typeof row.trigger === 'object' && !Array.isArray(row.trigger)
            ? (row.trigger as Record<string, unknown>)
            : {};
        const label =
          typeof trigger.label === 'string' && trigger.label.trim().length > 0
            ? trigger.label
            : typeof trigger.type === 'string'
              ? trigger.type
              : 'run';

        return {
          id: row.id,
          flowId: row.flowId,
          flowName: row.flowName,
          status: row.status,
          triggerLabel: label,
          createdAt: row.createdAt.toISOString(),
          startedAt: row.startedAt?.toISOString(),
          finishedAt: row.finishedAt?.toISOString(),
          error: row.error ?? undefined,
        };
      }),
      recentActivity: recentActivityRows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        summary: row.summary,
        createdAt: row.createdAt.toISOString(),
        actorName: row.actorName ?? undefined,
      })),
    };
  }),

  approveDevicePairing: workspaceProcedure
    .input(parse(RuntimePairingRequestInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Approving runtime device pairing');
      try {
        const result = await approveOpenClawRuntimeDevicePairing(input.requestId, ctx.openclaw);
        await appendWorkspaceAuditEvent({
          db: ctx.db,
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          eventType: 'runtime.device_pairing.approved',
          targetType: 'runtime_device',
          targetId: result.deviceId,
          summary: `${ctx.user.name} approved runtime device pairing`,
          details: {
            requestId: result.requestId,
            deviceId: result.deviceId,
            decision: result.decision,
          },
        });
        return result;
      } catch (error) {
        rethrowRuntimePairingError(error);
      }
    }),

  rejectDevicePairing: workspaceProcedure
    .input(parse(RuntimePairingRequestInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Rejecting runtime device pairing');
      try {
        const result = await rejectOpenClawRuntimeDevicePairing(input.requestId, ctx.openclaw);
        await appendWorkspaceAuditEvent({
          db: ctx.db,
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          eventType: 'runtime.device_pairing.rejected',
          targetType: 'runtime_device',
          targetId: result.deviceId,
          summary: `${ctx.user.name} rejected runtime device pairing`,
          details: {
            requestId: result.requestId,
            deviceId: result.deviceId,
            decision: result.decision,
          },
        });
        return result;
      } catch (error) {
        rethrowRuntimePairingError(error);
      }
    }),

  approveNodePairing: workspaceProcedure
    .input(parse(RuntimePairingRequestInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Approving runtime node pairing');
      try {
        const result = await approveOpenClawRuntimeNodePairing(input.requestId, ctx.openclaw);
        await appendWorkspaceAuditEvent({
          db: ctx.db,
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          eventType: 'runtime.node_pairing.approved',
          targetType: 'runtime_node',
          targetId: result.nodeId,
          summary: `${ctx.user.name} approved runtime node pairing`,
          details: {
            requestId: result.requestId,
            nodeId: result.nodeId,
            decision: result.decision,
          },
        });
        return result;
      } catch (error) {
        rethrowRuntimePairingError(error);
      }
    }),

  rejectNodePairing: workspaceProcedure
    .input(parse(RuntimePairingRequestInput))
    .mutation(async ({ ctx, input }) => {
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Rejecting runtime node pairing');
      try {
        const result = await rejectOpenClawRuntimeNodePairing(input.requestId, ctx.openclaw);
        await appendWorkspaceAuditEvent({
          db: ctx.db,
          workspaceId: ctx.workspace.id,
          actorUserId: ctx.user.id,
          eventType: 'runtime.node_pairing.rejected',
          targetType: 'runtime_node',
          targetId: result.nodeId,
          summary: `${ctx.user.name} rejected runtime node pairing`,
          details: {
            requestId: result.requestId,
            nodeId: result.nodeId,
            decision: result.decision,
          },
        });
        return result;
      } catch (error) {
        rethrowRuntimePairingError(error);
      }
    }),
});
