import { createHash, randomBytes } from 'node:crypto';
import type { WorkspaceExecPolicy } from '@openclaw-wrapper/schemas';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { workspaceInvites, workspaceMemberships, workspaces } from './db/schema.js';
import { normalizeWorkspaceExecPolicy } from './system-exec.js';

export const DEFAULT_WORKSPACE_SLUG = 'default';
export const DEFAULT_WORKSPACE_NAME = 'Default workspace';

export interface WorkspaceContext {
  id: string;
  slug: string;
  name: string;
  execPolicy: WorkspaceExecPolicy;
}

export interface UserWorkspaceContext extends WorkspaceContext {
  role: string;
}

function readHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = readHeaderValue(entry);
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function ensureDefaultWorkspace(db: Db): Promise<WorkspaceContext> {
  const existing = await db.query.workspaces.findFirst({
    where: (table, { eq }) => eq(table.slug, DEFAULT_WORKSPACE_SLUG),
  });
  if (existing) {
    return {
      id: existing.id,
      slug: existing.slug,
      name: existing.name,
      execPolicy: normalizeWorkspaceExecPolicy(existing.execPolicy),
    };
  }

  const now = new Date();
  await db
    .insert(workspaces)
    .values({
      slug: DEFAULT_WORKSPACE_SLUG,
      name: DEFAULT_WORKSPACE_NAME,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: workspaces.slug });

  const created = await db.query.workspaces.findFirst({
    where: (table, { eq }) => eq(table.slug, DEFAULT_WORKSPACE_SLUG),
  });
  if (!created) {
    throw new Error('failed to ensure default workspace');
  }

  return {
    id: created.id,
    slug: created.slug,
    name: created.name,
    execPolicy: normalizeWorkspaceExecPolicy(created.execPolicy),
  };
}

export async function resolveWorkspace(params: {
  db: Db;
  workspaceId?: string | string[];
  workspaceSlug?: string | string[];
}): Promise<WorkspaceContext> {
  const requestedWorkspaceId = readHeaderValue(params.workspaceId);
  if (requestedWorkspaceId) {
    const existing = await params.db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.id, requestedWorkspaceId),
    });
    if (!existing) {
      throw new Error(`workspace "${requestedWorkspaceId}" was not found`);
    }
    return {
      id: existing.id,
      slug: existing.slug,
      name: existing.name,
      execPolicy: normalizeWorkspaceExecPolicy(existing.execPolicy),
    };
  }

  const requestedWorkspaceSlug = readHeaderValue(params.workspaceSlug);
  if (requestedWorkspaceSlug) {
    const existing = await params.db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.slug, normalizeSlug(requestedWorkspaceSlug)),
    });
    if (!existing) {
      throw new Error(`workspace "${requestedWorkspaceSlug}" was not found`);
    }
    return {
      id: existing.id,
      slug: existing.slug,
      name: existing.name,
      execPolicy: normalizeWorkspaceExecPolicy(existing.execPolicy),
    };
  }

  return ensureDefaultWorkspace(params.db);
}

export async function listUserWorkspaces(db: Db, userId: string): Promise<UserWorkspaceContext[]> {
  const rows = await db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      name: workspaces.name,
      execPolicy: workspaces.execPolicy,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(eq(workspaceMemberships.userId, userId))
    .orderBy(asc(workspaces.name), asc(workspaces.createdAt));

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    execPolicy: normalizeWorkspaceExecPolicy(row.execPolicy),
    role: row.role,
  }));
}

export async function resolveWorkspaceForUser(params: {
  db: Db;
  userId: string;
  workspaceId?: string | string[];
  workspaceSlug?: string | string[];
}): Promise<UserWorkspaceContext | null> {
  const available = await listUserWorkspaces(params.db, params.userId);
  if (available.length === 0) {
    return null;
  }

  const requestedWorkspaceId = readHeaderValue(params.workspaceId);
  if (requestedWorkspaceId) {
    return available.find((workspace) => workspace.id === requestedWorkspaceId) ?? null;
  }

  const requestedWorkspaceSlug = readHeaderValue(params.workspaceSlug);
  if (requestedWorkspaceSlug) {
    return (
      available.find((workspace) => workspace.slug === normalizeSlug(requestedWorkspaceSlug)) ??
      null
    );
  }

  return (
    available.find((workspace) => workspace.slug === DEFAULT_WORKSPACE_SLUG) ?? available[0] ?? null
  );
}

export async function createWorkspaceMembership(params: {
  db: Db;
  workspaceId: string;
  userId: string;
  role?: string;
}) {
  const now = new Date();
  await params.db
    .insert(workspaceMemberships)
    .values({
      workspaceId: params.workspaceId,
      userId: params.userId,
      role: params.role ?? 'owner',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      set: {
        role: params.role ?? 'owner',
        updatedAt: now,
      },
    });

  const membership = await params.db.query.workspaceMemberships.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.workspaceId, params.workspaceId), eq(table.userId, params.userId)),
  });
  if (!membership) {
    throw new Error('failed to create workspace membership');
  }
  return membership;
}

export async function createWorkspaceInvite(params: {
  db: Db;
  workspaceId: string;
  email: string;
  role: string;
  createdByUserId: string;
  expiresInDays?: number;
}) {
  const token = `ocw_inv_${randomBytes(24).toString('base64url')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.expiresInDays ?? 7) * 24 * 60 * 60 * 1000);
  const normalizedEmail = normalizeEmail(params.email);

  const [row] = await params.db
    .insert(workspaceInvites)
    .values({
      workspaceId: params.workspaceId,
      email: params.email.trim(),
      emailNormalized: normalizedEmail,
      role: params.role,
      tokenHash: hashInviteToken(token),
      expiresAt,
      createdByUserId: params.createdByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error('failed to create workspace invite');
  }

  return {
    invite: row,
    token,
  };
}

export async function listWorkspaceInvites(params: { db: Db; workspaceId: string }) {
  return params.db.query.workspaceInvites.findMany({
    where: (table, { and, eq, gt, isNull }) =>
      and(
        eq(table.workspaceId, params.workspaceId),
        gt(table.expiresAt, new Date()),
        isNull(table.acceptedAt),
        isNull(table.revokedAt),
      ),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
}

export async function revokeWorkspaceInvite(params: {
  db: Db;
  workspaceId: string;
  inviteId: string;
}) {
  await params.db
    .update(workspaceInvites)
    .set({
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspaceInvites.workspaceId, params.workspaceId),
        eq(workspaceInvites.id, params.inviteId),
      ),
    );
}

export async function acceptPendingWorkspaceInvites(params: {
  db: Db;
  userId: string;
  email: string;
}) {
  const now = new Date();
  const invites = await params.db.query.workspaceInvites.findMany({
    where: (table, { and, eq, gt, isNull }) =>
      and(
        eq(table.emailNormalized, normalizeEmail(params.email)),
        gt(table.expiresAt, now),
        isNull(table.acceptedAt),
        isNull(table.revokedAt),
      ),
  });

  for (const invite of invites) {
    await createWorkspaceMembership({
      db: params.db,
      workspaceId: invite.workspaceId,
      userId: params.userId,
      role: invite.role,
    });
    await params.db
      .update(workspaceInvites)
      .set({
        acceptedAt: now,
        acceptedByUserId: params.userId,
        updatedAt: now,
      })
      .where(eq(workspaceInvites.id, invite.id));
  }

  return invites;
}

export async function acceptWorkspaceInviteToken(params: {
  db: Db;
  token: string;
  userId: string;
}) {
  const now = new Date();
  const invite = await getPendingWorkspaceInviteByToken({
    db: params.db,
    token: params.token,
  });

  if (!invite) {
    return null;
  }

  await createWorkspaceMembership({
    db: params.db,
    workspaceId: invite.workspaceId,
    userId: params.userId,
    role: invite.role,
  });
  await params.db
    .update(workspaceInvites)
    .set({
      acceptedAt: now,
      acceptedByUserId: params.userId,
      updatedAt: now,
    })
    .where(eq(workspaceInvites.id, invite.id));

  return invite;
}

export async function getPendingWorkspaceInviteByToken(params: { db: Db; token: string }) {
  const now = new Date();
  const tokenHash = hashInviteToken(params.token);
  return params.db.query.workspaceInvites.findFirst({
    where: (table, { and, eq, gt, isNull }) =>
      and(
        eq(table.tokenHash, tokenHash),
        gt(table.expiresAt, now),
        isNull(table.acceptedAt),
        isNull(table.revokedAt),
      ),
  });
}

export async function userHasWorkspaceAccess(params: {
  db: Db;
  userId: string;
  workspaceId: string;
}): Promise<boolean> {
  const membership = await params.db.query.workspaceMemberships.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.workspaceId, params.workspaceId), eq(table.userId, params.userId)),
  });
  return Boolean(membership);
}
