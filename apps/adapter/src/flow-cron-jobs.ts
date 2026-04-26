import type {
  CronPayload,
  CronSessionTarget,
  CronWakeMode,
  GraphNode,
} from '@openclaw-wrapper/schemas';
import {
  buildCronScheduleFromTriggerData,
  getCronTriggerDeleteAfterRun,
  getCronTriggerDescription,
  getCronTriggerEnabled,
} from '@openclaw-wrapper/schemas/cron-trigger';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { cronJobs, flowVersions, flows, type CronJobRow } from './db/schema.js';
import { normalizeCronJobState } from './cron-job-service.js';

interface BridgeLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

interface PublishedFlowSnapshot {
  flowId: string;
  workspaceId: string;
  flowName: string;
  flowVersion: number;
  nodes: GraphNode[];
}

interface FlowCronTriggerNode {
  nodeId: string;
  label: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun: boolean;
  agentId?: string;
  sessionKey?: string;
  clearAgent: boolean;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  timeoutSeconds?: number;
  delivery: CronJobRow['delivery'];
  failureAlert: CronJobRow['failureAlert'];
  rawData: Record<string, unknown>;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readBoolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readString(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === 'string' ? data[key] : undefined;
}

function readCsvList(data: Record<string, unknown>, key: string): string[] | undefined {
  const raw = normalizeOptionalString(readString(data, key));
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return values.length > 0 ? values : undefined;
}

function readPositiveInteger(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const raw = typeof data[key] === 'string' ? data[key].trim() : '';
  if (!/^\d+$/u.test(raw)) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildCronDeliveryFromTriggerData(
  data: Record<string, unknown>,
): CronJobRow['delivery'] {
  const mode = normalizeOptionalString(typeof data.deliveryMode === 'string' ? data.deliveryMode : undefined);
  if (mode !== 'announce' && mode !== 'webhook') {
    return null;
  }

  return {
    mode,
    ...(normalizeOptionalString(typeof data.deliveryChannel === 'string' ? data.deliveryChannel : undefined)
      ? {
          channel: normalizeOptionalString(
            typeof data.deliveryChannel === 'string' ? data.deliveryChannel : undefined,
          ),
        }
      : {}),
    ...(normalizeOptionalString(typeof data.deliveryTo === 'string' ? data.deliveryTo : undefined)
      ? {
          to: normalizeOptionalString(
            typeof data.deliveryTo === 'string' ? data.deliveryTo : undefined,
          ),
        }
      : {}),
    ...(normalizeOptionalString(
      typeof data.deliveryAccountId === 'string' ? data.deliveryAccountId : undefined,
    )
      ? {
          accountId: normalizeOptionalString(
            typeof data.deliveryAccountId === 'string' ? data.deliveryAccountId : undefined,
          ),
        }
      : {}),
    ...(readBoolean(data, 'deliveryBestEffort', false) ? { bestEffort: true } : {}),
  };
}

function buildCronFailureAlertFromTriggerData(
  data: Record<string, unknown>,
): CronJobRow['failureAlert'] {
  if (!readBoolean(data, 'failureAlertEnabled', false)) {
    return false;
  }

  const after = readPositiveInteger(data, 'failureAlertAfter');
  const cooldownSeconds = readPositiveInteger(data, 'failureAlertCooldownSeconds');
  const mode =
    normalizeOptionalString(typeof data.failureAlertMode === 'string' ? data.failureAlertMode : undefined) ===
    'webhook'
      ? 'webhook'
      : 'announce';

  return {
    ...(after ? { after } : {}),
    ...(cooldownSeconds ? { cooldownMs: cooldownSeconds * 1000 } : {}),
    mode,
    ...(normalizeOptionalString(
      typeof data.failureAlertChannel === 'string' ? data.failureAlertChannel : undefined,
    )
      ? {
          channel: normalizeOptionalString(
            typeof data.failureAlertChannel === 'string' ? data.failureAlertChannel : undefined,
          ),
        }
      : {}),
    ...(normalizeOptionalString(typeof data.failureAlertTo === 'string' ? data.failureAlertTo : undefined)
      ? {
          to: normalizeOptionalString(
            typeof data.failureAlertTo === 'string' ? data.failureAlertTo : undefined,
          ),
        }
      : {}),
    ...(normalizeOptionalString(
      typeof data.failureAlertAccountId === 'string' ? data.failureAlertAccountId : undefined,
    )
      ? {
          accountId: normalizeOptionalString(
            typeof data.failureAlertAccountId === 'string' ? data.failureAlertAccountId : undefined,
          ),
        }
      : {}),
  };
}

function getCronExecutionKind(data: Record<string, unknown>): CronPayload['kind'] {
  const value = normalizeOptionalString(readString(data, 'executionKind'));
  if (value === 'agentTurn' || value === 'systemEvent') {
    return value;
  }
  return 'flowTrigger';
}

function getCronSessionTargetFromTriggerData(
  data: Record<string, unknown>,
  payloadKind: CronPayload['kind'],
): CronSessionTarget {
  if (payloadKind === 'flowTrigger' || payloadKind === 'systemEvent') {
    return 'main';
  }

  const sessionTarget = normalizeOptionalString(readString(data, 'sessionTarget'));
  if (sessionTarget === 'session') {
    const sessionKey = normalizeOptionalString(readString(data, 'sessionKey'));
    return sessionKey ? (`session:${sessionKey}` as const) : 'isolated';
  }
  if (sessionTarget === 'isolated') {
    return 'isolated';
  }
  if (sessionTarget?.startsWith('session:')) {
    return sessionTarget as CronSessionTarget;
  }

  return 'isolated';
}

function getCronWakeModeFromTriggerData(
  data: Record<string, unknown>,
  sessionTarget: CronSessionTarget,
): CronWakeMode {
  const wakeMode = normalizeOptionalString(readString(data, 'wakeMode'));
  if (wakeMode === 'now' || wakeMode === 'next-heartbeat') {
    return wakeMode;
  }
  return sessionTarget === 'main' ? 'next-heartbeat' : 'now';
}

function buildCronPayloadFromTriggerData(data: Record<string, unknown>): CronPayload {
  const kind = getCronExecutionKind(data);
  if (kind === 'systemEvent') {
    return {
      kind,
      text:
        normalizeOptionalString(readString(data, 'systemEventText')) ??
        'Scheduled wakeup from a published flow cron trigger.',
    };
  }

  if (kind === 'agentTurn') {
    const timeoutSeconds = readPositiveInteger(data, 'timeoutSeconds');
    const fallbacks = readCsvList(data, 'fallbacks');
    const toolsAllow = readCsvList(data, 'toolsAllow');
    return {
      kind,
      message:
        normalizeOptionalString(readString(data, 'assistantPrompt')) ??
        'Run the scheduled task and summarize what changed.',
      ...(normalizeOptionalString(readString(data, 'model'))
        ? { model: normalizeOptionalString(readString(data, 'model')) }
        : {}),
      ...(fallbacks ? { fallbacks } : {}),
      ...(normalizeOptionalString(readString(data, 'thinking'))
        ? { thinking: normalizeOptionalString(readString(data, 'thinking')) }
        : {}),
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
      ...(readBoolean(data, 'allowUnsafeExternalContent', false)
        ? { allowUnsafeExternalContent: true }
        : {}),
      ...(readBoolean(data, 'lightContext', false) ? { lightContext: true } : {}),
      ...(toolsAllow ? { toolsAllow } : {}),
    };
  }

  return { kind: 'flowTrigger' };
}

function readFlowCronTriggerNodes(nodes: GraphNode[]): FlowCronTriggerNode[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'trigger.cron') {
      return [];
    }

    const schedule = buildCronScheduleFromTriggerData(node.data);
    if (!schedule) {
      return [];
    }

    const payload = buildCronPayloadFromTriggerData(node.data);
    const sessionTarget = getCronSessionTargetFromTriggerData(node.data, payload.kind);
    const wakeMode = getCronWakeModeFromTriggerData(node.data, sessionTarget);

    return [
      {
        nodeId: node.id,
        label: normalizeOptionalString(
          typeof node.data.label === 'string' ? node.data.label : undefined,
        ) ?? 'Cron Schedule',
        description: getCronTriggerDescription(node.data),
        enabled: getCronTriggerEnabled(node.data),
        deleteAfterRun: getCronTriggerDeleteAfterRun(node.data),
        agentId:
          payload.kind === 'agentTurn'
            ? normalizeOptionalString(readString(node.data, 'agentId'))
            : undefined,
        sessionKey:
          payload.kind === 'agentTurn'
            ? normalizeOptionalString(readString(node.data, 'sessionKey'))
            : undefined,
        clearAgent: payload.kind === 'agentTurn' && readBoolean(node.data, 'clearAgent', false),
        sessionTarget,
        wakeMode,
        payload,
        timeoutSeconds: readPositiveInteger(node.data, 'timeoutSeconds'),
        delivery: buildCronDeliveryFromTriggerData(node.data),
        failureAlert: buildCronFailureAlertFromTriggerData(node.data),
        rawData: node.data,
      },
    ];
  });
}

function buildManagedCronJobName(flowName: string, nodeLabel: string): string {
  const normalizedFlowName = flowName.trim();
  const normalizedNodeLabel = nodeLabel.trim();
  return `${normalizedFlowName} / ${normalizedNodeLabel}`;
}

export async function syncPublishedFlowCronJobs(
  db: Db,
  snapshot: PublishedFlowSnapshot,
): Promise<void> {
  const triggerNodes = readFlowCronTriggerNodes(snapshot.nodes);
  const existingRows = await db
    .select()
    .from(cronJobs)
    .where(
      and(
        eq(cronJobs.workspaceId, snapshot.workspaceId),
        eq(cronJobs.sourceType, 'flowTrigger'),
        eq(cronJobs.sourceFlowId, snapshot.flowId),
      ),
    );

  const existingByNodeId = new Map(
    existingRows
      .filter((row) => row.sourceNodeId)
      .map((row) => [row.sourceNodeId as string, row]),
  );
  const seenNodeIds = new Set<string>();

  for (const node of triggerNodes) {
    seenNodeIds.add(node.nodeId);
    const existing = existingByNodeId.get(node.nodeId);
    const createdAt = existing?.createdAt ?? new Date();
    const schedule = buildCronScheduleFromTriggerData(node.rawData, {
      createdAtMs: createdAt.getTime(),
    });
    if (!schedule) {
      continue;
    }
    const enabled = node.enabled;
    const state = normalizeCronJobState({
      job: {
        schedule,
        createdAt,
        enabled,
        state: existing?.state ?? {},
      },
    });

    const patch = {
      workspaceId: snapshot.workspaceId,
      name: buildManagedCronJobName(snapshot.flowName, node.label),
      description:
        node.description ??
        `Managed from published flow "${snapshot.flowName}". Edit this schedule in Builder.`,
      agentId: node.agentId ?? null,
      sessionKey: node.sessionKey ?? null,
      clearAgent: node.clearAgent,
      enabled,
      deleteAfterRun: node.deleteAfterRun || schedule.kind === 'at',
      sourceType: 'flowTrigger' as const,
      sourceFlowId: snapshot.flowId,
      sourceFlowVersion: snapshot.flowVersion,
      sourceNodeId: node.nodeId,
      schedule,
      sessionTarget: node.sessionTarget,
      wakeMode: node.wakeMode,
      payload: node.payload,
      delivery: node.delivery,
      failureAlert: node.failureAlert,
      timeoutSeconds: node.timeoutSeconds ?? null,
      state,
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(cronJobs).set(patch).where(eq(cronJobs.id, existing.id));
      continue;
    }

    await db.insert(cronJobs).values(patch);
  }

  const staleRows = existingRows.filter(
    (row) => !row.sourceNodeId || !seenNodeIds.has(row.sourceNodeId),
  );
  if (staleRows.length > 0) {
    await db.delete(cronJobs).where(inArray(cronJobs.id, staleRows.map((row) => row.id)));
  }
}

export async function deletePublishedFlowCronJobs(
  db: Db,
  params: { workspaceId: string; flowId: string },
): Promise<void> {
  await db
    .delete(cronJobs)
    .where(
      and(
        eq(cronJobs.workspaceId, params.workspaceId),
        eq(cronJobs.sourceType, 'flowTrigger'),
        eq(cronJobs.sourceFlowId, params.flowId),
      ),
    );
}

export async function reconcilePublishedFlowCronJobs(params: {
  db: Db;
  logger?: BridgeLogger;
}): Promise<void> {
  const rows = await params.db
    .select({
      flowId: flows.id,
      workspaceId: flows.workspaceId,
      flowName: flows.name,
      flowVersion: flowVersions.version,
      nodes: flowVersions.nodes,
    })
    .from(flows)
    .innerJoin(
      flowVersions,
      and(eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.publishedVersion)),
    );

  const activeFlowIds: string[] = [];

  for (const row of rows) {
    activeFlowIds.push(row.flowId);
    await syncPublishedFlowCronJobs(params.db, row);
  }

  if (activeFlowIds.length > 0) {
    await params.db
      .delete(cronJobs)
      .where(
        and(
          eq(cronJobs.sourceType, 'flowTrigger'),
          notInArray(cronJobs.sourceFlowId, activeFlowIds),
        ),
      );
  } else {
    await params.db.delete(cronJobs).where(eq(cronJobs.sourceType, 'flowTrigger'));
  }

  params.logger?.info?.('[flow-cron-jobs] reconciled published flow cron jobs', {
    publishedFlows: rows.length,
  });
}

export function isFlowManagedCronJob(
  job: Pick<CronJobRow, 'sourceType' | 'sourceFlowId' | 'sourceNodeId'>,
): boolean {
  return job.sourceType === 'flowTrigger' && !!job.sourceFlowId && !!job.sourceNodeId;
}
