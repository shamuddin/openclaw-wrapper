import type { OpenClawClient } from '@openclaw-wrapper/openclaw-client';
import { TRPCError, initTRPC } from '@trpc/server';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import type { AuthMode, AuthenticatedSession, AuthenticatedUser } from './auth-service.js';
import {
  getAuthMode,
  readSessionTokenFromHeaders,
  resolveEffectiveAuthContext,
} from './auth-service.js';
import { type Db, getDb } from './db/client.js';
import { getOpenClawClient } from './openclaw.js';
import { type UserWorkspaceContext, resolveWorkspaceForUser } from './workspaces.js';

export interface Context {
  authMode: AuthMode;
  openclaw: OpenClawClient;
  db: Db;
  user: AuthenticatedUser | null;
  session: AuthenticatedSession | null;
  sessionToken: string | null;
  workspace: UserWorkspaceContext | null;
}

export async function createContext(opts: CreateFastifyContextOptions): Promise<Context> {
  const db = getDb();
  const authMode = getAuthMode();
  const auth = await resolveEffectiveAuthContext({
    db,
    headers: opts.req.headers,
  });
  const workspace = auth
    ? await resolveWorkspaceForUser({
        db,
        userId: auth.user.id,
        workspaceId: opts.req.headers['x-openclaw-workspace-id'],
        workspaceSlug: opts.req.headers['x-openclaw-workspace'],
      })
    : null;

  return {
    authMode,
    openclaw: getOpenClawClient({ eagerConnect: false }),
    db,
    user: auth?.user ?? null,
    session: auth?.session ?? null,
    sessionToken: readSessionTokenFromHeaders(opts.req.headers) ?? null,
    workspace,
  };
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const authenticatedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Sign in to continue',
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      session: ctx.session,
    },
  });
});

export const workspaceProcedure = authenticatedProcedure.use(({ ctx, next }) => {
  if (!ctx.workspace) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not have access to this workspace',
    });
  }
  return next({
    ctx: {
      ...ctx,
      workspace: ctx.workspace,
    },
  });
});
