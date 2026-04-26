import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './db/schema.js';
import { decryptSecretValue, encryptSecretValue, hasSecretStoreKey } from './secret-store.js';

export const FLOW_TRIGGER_SECRET_HEADER = 'x-openclaw-flow-secret';

export class FlowTriggerSecurityError extends Error {
  constructor(
    readonly code:
      | 'FLOW_NOT_FOUND'
      | 'MISSING_SECRET'
      | 'INVALID_SECRET'
      | 'SECRET_NOT_CONFIGURED'
      | 'SECRET_STORE_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'FlowTriggerSecurityError';
  }
}

type DbLike = NodePgDatabase<typeof schema>;

function hashSecret(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

export function buildFlowTriggerSecretPreview(secret: string): string {
  const tail = secret.trim().slice(-6);
  return tail ? `••••${tail}` : 'configured';
}

export function verifyFlowTriggerSecret(secret: string, expectedHash: string): boolean {
  if (!secret || !expectedHash) return false;

  const providedHash = hashSecret(secret.trim());
  const storedHash = Buffer.from(expectedHash, 'base64url');
  if (providedHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(providedHash, storedHash);
}

export function issueFlowTriggerSecret() {
  if (!hasSecretStoreKey()) {
    throw new FlowTriggerSecurityError(
      'SECRET_STORE_UNAVAILABLE',
      'CHANNEL_SECRET_KEY is required before flow trigger secrets can be generated',
    );
  }

  const secret = `ocw_trg_${crypto.randomBytes(24).toString('base64url')}`;
  const rotatedAt = new Date();

  return {
    secret,
    preview: buildFlowTriggerSecretPreview(secret),
    rotatedAt,
    encrypted: encryptSecretValue(secret),
    hash: hashSecret(secret).toString('base64url'),
  };
}

export async function readFlowTriggerSecurity(
  db: DbLike,
  flowId: string,
  workspaceId: string,
): Promise<{
  configured: boolean;
  canGenerate: boolean;
  preview?: string;
  rotatedAt?: Date;
}> {
  const [row] = await db
    .select({
      id: schema.flows.id,
      triggerSecretEncrypted: schema.flows.triggerSecretEncrypted,
      triggerSecretRotatedAt: schema.flows.triggerSecretRotatedAt,
    })
    .from(schema.flows)
    .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
    .limit(1);

  if (!row) {
    throw new FlowTriggerSecurityError('FLOW_NOT_FOUND', 'flow not found');
  }

  if (!row.triggerSecretEncrypted) {
    return { configured: false, canGenerate: hasSecretStoreKey() };
  }

  const secret = decryptSecretValue(row.triggerSecretEncrypted);
  return {
    configured: true,
    canGenerate: hasSecretStoreKey(),
    preview: buildFlowTriggerSecretPreview(secret),
    rotatedAt: row.triggerSecretRotatedAt ?? undefined,
  };
}

export async function revealFlowTriggerSecret(
  db: DbLike,
  flowId: string,
  workspaceId: string,
): Promise<{
  secret: string;
  preview: string;
  rotatedAt: Date;
}> {
  const [row] = await db
    .select({
      id: schema.flows.id,
      triggerSecretEncrypted: schema.flows.triggerSecretEncrypted,
      triggerSecretHash: schema.flows.triggerSecretHash,
      triggerSecretRotatedAt: schema.flows.triggerSecretRotatedAt,
    })
    .from(schema.flows)
    .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
    .limit(1);

  if (!row) {
    throw new FlowTriggerSecurityError('FLOW_NOT_FOUND', 'flow not found');
  }

  if (!row.triggerSecretEncrypted || !row.triggerSecretHash) {
    const nextSecret = issueFlowTriggerSecret();
    const [updated] = await db
      .update(schema.flows)
      .set({
        triggerSecretEncrypted: nextSecret.encrypted,
        triggerSecretHash: nextSecret.hash,
        triggerSecretRotatedAt: nextSecret.rotatedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
      .returning({
        rotatedAt: schema.flows.triggerSecretRotatedAt,
      });

    return {
      secret: nextSecret.secret,
      preview: nextSecret.preview,
      rotatedAt: updated?.rotatedAt ?? nextSecret.rotatedAt,
    };
  }

  const secret = decryptSecretValue(row.triggerSecretEncrypted);
  return {
    secret,
    preview: buildFlowTriggerSecretPreview(secret),
    rotatedAt: row.triggerSecretRotatedAt ?? new Date(),
  };
}

export async function rotateFlowTriggerSecret(
  db: DbLike,
  flowId: string,
  workspaceId: string,
): Promise<{
  secret: string;
  preview: string;
  rotatedAt: Date;
}> {
  const nextSecret = issueFlowTriggerSecret();

  const [updated] = await db
    .update(schema.flows)
    .set({
      triggerSecretEncrypted: nextSecret.encrypted,
      triggerSecretHash: nextSecret.hash,
      triggerSecretRotatedAt: nextSecret.rotatedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.flows.id, flowId), eq(schema.flows.workspaceId, workspaceId)))
    .returning({
      id: schema.flows.id,
      rotatedAt: schema.flows.triggerSecretRotatedAt,
    });

  if (!updated) {
    throw new FlowTriggerSecurityError('FLOW_NOT_FOUND', 'flow not found');
  }

  return {
    secret: nextSecret.secret,
    preview: nextSecret.preview,
    rotatedAt: updated.rotatedAt ?? nextSecret.rotatedAt,
  };
}

export async function authorizeFlowTriggerRequest(
  db: DbLike,
  flowId: string,
  providedSecret: string | undefined,
): Promise<{
  flowId: string;
  workspaceId: string;
}> {
  const [row] = await db
    .select({
      id: schema.flows.id,
      workspaceId: schema.flows.workspaceId,
      triggerSecretHash: schema.flows.triggerSecretHash,
    })
    .from(schema.flows)
    .where(eq(schema.flows.id, flowId))
    .limit(1);

  if (!row) {
    throw new FlowTriggerSecurityError('FLOW_NOT_FOUND', 'flow not found');
  }

  if (!row.triggerSecretHash) {
    throw new FlowTriggerSecurityError(
      'SECRET_NOT_CONFIGURED',
      'flow trigger security is not configured yet; reveal or rotate the trigger secret in the builder first',
    );
  }

  const secret = providedSecret?.trim();
  if (!secret) {
    throw new FlowTriggerSecurityError(
      'MISSING_SECRET',
      `missing ${FLOW_TRIGGER_SECRET_HEADER} header`,
    );
  }

  if (!verifyFlowTriggerSecret(secret, row.triggerSecretHash)) {
    throw new FlowTriggerSecurityError('INVALID_SECRET', 'invalid flow trigger secret');
  }

  return {
    flowId: row.id,
    workspaceId: row.workspaceId,
  };
}
