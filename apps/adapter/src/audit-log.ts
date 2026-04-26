import type { Db } from './db/client.js';
import { workspaceAuditEvents } from './db/schema.js';

export async function appendWorkspaceAuditEvent(params: {
  db: Db;
  workspaceId: string;
  actorUserId?: string | null;
  eventType: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  details?: Record<string, unknown> | null;
}) {
  await params.db.insert(workspaceAuditEvents).values({
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId ?? null,
    eventType: params.eventType,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    summary: params.summary,
    details: params.details ?? null,
    createdAt: new Date(),
  });
}
