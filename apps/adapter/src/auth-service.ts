import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt, isNull, ne } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { authSessions, passwordResetTokens, users } from './db/schema.js';
import { env } from './env.js';
import { createWorkspaceMembership, ensureDefaultWorkspace } from './workspaces.js';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_TTL_DAYS = 30;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedSession {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt?: string;
}

export interface ResolvedAuthContext {
  user: AuthenticatedUser;
  session: AuthenticatedSession;
}

export type AuthMode = 'required' | 'disabled';

function encodeHex(buffer: Buffer): string {
  return buffer.toString('hex');
}

function decodeHex(value: string): Buffer {
  return Buffer.from(value, 'hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getAuthMode(): AuthMode {
  return env.AUTH_MODE.trim().toLowerCase() === 'disabled' ? 'disabled' : 'required';
}

export function isAuthDisabled(): boolean {
  return getAuthMode() === 'disabled';
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `scrypt$${encodeHex(salt)}$${encodeHex(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) {
    return false;
  }

  const salt = decodeHex(saltHex);
  const expected = decodeHex(hashHex);
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;

  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function serializeUser(row: {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeSession(row: {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date | null;
}): AuthenticatedSession {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
  };
}

function readCookie(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers.cookie;
  const cookieHeader = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(';') : '';
  if (!cookieHeader) return undefined;

  for (const segment of cookieHeader.split(';')) {
    const [cookieName, ...rest] = segment.trim().split('=');
    if (cookieName === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
}

export function readSessionTokenFromHeaders(headers: Record<string, unknown>): string | undefined {
  const direct = headers['x-openclaw-session'];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  if (Array.isArray(direct)) {
    const first = direct.find((value) => typeof value === 'string' && value.trim());
    if (typeof first === 'string') {
      return first.trim();
    }
  }

  const authorization = headers.authorization;
  const authValue =
    typeof authorization === 'string'
      ? authorization
      : Array.isArray(authorization)
        ? authorization.find((value) => typeof value === 'string')
        : undefined;
  if (typeof authValue === 'string') {
    const match = authValue.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return readCookie(headers, 'openclaw_session');
}

export async function countUsers(db: Db): Promise<number> {
  const row = await db.query.users.findFirst({ columns: { id: true } });
  return row ? 1 : 0;
}

export async function createUser(params: {
  db: Db;
  email: string;
  name: string;
  password: string;
}) {
  const email = params.email.trim();
  const name = params.name.trim();
  const passwordHash = await hashPassword(params.password);
  const now = new Date();
  const [row] = await params.db
    .insert(users)
    .values({
      email,
      emailNormalized: normalizeEmail(email),
      name,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error('user create failed');
  }
  return row;
}

export async function createAuthSession(params: { db: Db; userId: string }) {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const [sessionRow] = await params.db
    .insert(authSessions)
    .values({
      userId: params.userId,
      tokenHash,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .returning();

  if (!sessionRow) {
    throw new Error('session create failed');
  }

  return {
    token,
    session: serializeSession(sessionRow),
  };
}

export async function revokeAuthSession(params: { db: Db; token?: string | null }) {
  if (!params.token) return;
  const tokenHash = hashSessionToken(params.token);
  await params.db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
}

export async function listUserSessions(params: { db: Db; userId: string }) {
  const rows = await params.db.query.authSessions.findMany({
    where: (table, { and, eq, gt }) =>
      and(eq(table.userId, params.userId), gt(table.expiresAt, new Date())),
    orderBy: (table, { desc }) => [desc(table.updatedAt), desc(table.createdAt)],
  });
  return rows.map(serializeSession);
}

export async function revokeAuthSessionById(params: {
  db: Db;
  userId: string;
  sessionId: string;
}) {
  await params.db
    .delete(authSessions)
    .where(and(eq(authSessions.userId, params.userId), eq(authSessions.id, params.sessionId)));
}

export async function revokeOtherAuthSessions(params: {
  db: Db;
  userId: string;
  keepSessionId: string;
}) {
  await params.db
    .delete(authSessions)
    .where(and(eq(authSessions.userId, params.userId), ne(authSessions.id, params.keepSessionId)));
}

export async function updateUserPassword(params: {
  db: Db;
  userId: string;
  newPassword: string;
}) {
  const passwordHash = await hashPassword(params.newPassword);
  const now = new Date();
  await params.db
    .update(users)
    .set({
      passwordHash,
      updatedAt: now,
    })
    .where(eq(users.id, params.userId));
}

export async function revokeAllAuthSessionsForUser(params: { db: Db; userId: string }) {
  await params.db.delete(authSessions).where(eq(authSessions.userId, params.userId));
}

export async function issuePasswordResetToken(params: { db: Db; userId: string }) {
  const token = `ocw_rst_${randomBytes(24).toString('base64url')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

  await params.db
    .update(passwordResetTokens)
    .set({
      consumedAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(passwordResetTokens.userId, params.userId), isNull(passwordResetTokens.consumedAt)),
    );

  const [row] = await params.db
    .insert(passwordResetTokens)
    .values({
      userId: params.userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new Error('password reset token create failed');
  }

  return {
    token,
    expiresAt,
  };
}

export async function consumePasswordResetToken(params: {
  db: Db;
  token: string;
}): Promise<{ userId: string } | null> {
  const now = new Date();
  const tokenHash = hashOpaqueToken(params.token.trim());
  const row = await params.db.query.passwordResetTokens.findFirst({
    where: (table, { and, eq, gt, isNull }) =>
      and(eq(table.tokenHash, tokenHash), gt(table.expiresAt, now), isNull(table.consumedAt)),
  });

  if (!row) {
    return null;
  }

  await params.db
    .update(passwordResetTokens)
    .set({
      consumedAt: now,
      updatedAt: now,
    })
    .where(eq(passwordResetTokens.id, row.id));

  return { userId: row.userId };
}

export async function resolveAuthContext(params: {
  db: Db;
  headers: Record<string, unknown>;
}): Promise<ResolvedAuthContext | null> {
  const token = readSessionTokenFromHeaders(params.headers);
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const row = await params.db
    .select({
      sessionId: authSessions.id,
      sessionUserId: authSessions.userId,
      sessionCreatedAt: authSessions.createdAt,
      sessionLastSeenAt: authSessions.lastSeenAt,
      sessionExpiresAt: authSessions.expiresAt,
      userId: users.id,
      userEmail: users.email,
      userName: users.name,
      userCreatedAt: users.createdAt,
      userUpdatedAt: users.updatedAt,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, now)))
    .limit(1);

  const current = row[0];
  if (!current) {
    return null;
  }

  await params.db
    .update(authSessions)
    .set({
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(authSessions.id, current.sessionId));

  return {
    user: serializeUser({
      id: current.userId,
      email: current.userEmail,
      name: current.userName,
      createdAt: current.userCreatedAt,
      updatedAt: current.userUpdatedAt,
    }),
    session: serializeSession({
      id: current.sessionId,
      userId: current.sessionUserId,
      createdAt: current.sessionCreatedAt,
      lastSeenAt: now,
      expiresAt: current.sessionExpiresAt,
    }),
  };
}

export async function findUserByEmail(db: Db, email: string) {
  return db.query.users.findFirst({
    where: (table, { eq }) => eq(table.emailNormalized, normalizeEmail(email)),
  });
}

async function ensureLocalUser(db: Db) {
  const email = env.LOCAL_AUTH_EMAIL.trim();
  const name = env.LOCAL_AUTH_NAME.trim() || 'Local User';
  const existing = await findUserByEmail(db, email);
  if (existing) {
    if (existing.name === name && existing.email === email) {
      return existing;
    }

    const [updated] = await db
      .update(users)
      .set({
        email,
        emailNormalized: normalizeEmail(email),
        name,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();

    return updated ?? existing;
  }

  return createUser({
    db,
    email,
    name,
    password: randomBytes(32).toString('base64url'),
  });
}

async function ensureLocalWorkspaceAccess(db: Db, userId: string) {
  const defaultWorkspace = await ensureDefaultWorkspace(db);
  const [availableWorkspaces, memberships] = await Promise.all([
    db.query.workspaces.findMany({
      columns: { id: true },
    }),
    db.query.workspaceMemberships.findMany({
      where: (table, { eq }) => eq(table.userId, userId),
      columns: { workspaceId: true, role: true },
    }),
  ]);

  const membershipByWorkspaceId = new Map(
    memberships.map((membership) => [membership.workspaceId, membership.role]),
  );

  for (const workspace of availableWorkspaces) {
    if (membershipByWorkspaceId.get(workspace.id) === 'owner') {
      continue;
    }

    await createWorkspaceMembership({
      db,
      workspaceId: workspace.id,
      userId,
      role: 'owner',
    });
  }

  return defaultWorkspace;
}

function createLocalSession(userId: string, createdAt: string): AuthenticatedSession {
  return {
    id: 'local-session',
    userId,
    createdAt,
    expiresAt: '9999-12-31T23:59:59.999Z',
    lastSeenAt: new Date().toISOString(),
  };
}

export async function resolveEffectiveAuthContext(params: {
  db: Db;
  headers: Record<string, unknown>;
}): Promise<ResolvedAuthContext | null> {
  if (!isAuthDisabled()) {
    return resolveAuthContext(params);
  }

  const localUser = await ensureLocalUser(params.db);
  await ensureLocalWorkspaceAccess(params.db, localUser.id);

  return {
    user: serializeUser(localUser),
    session: createLocalSession(localUser.id, localUser.createdAt.toISOString()),
  };
}
