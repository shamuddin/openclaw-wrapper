import { Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import { appendWorkspaceAuditEvent } from '../audit-log.js';
import {
  consumePasswordResetToken,
  countUsers,
  createAuthSession,
  createUser,
  findUserByEmail,
  issuePasswordResetToken,
  listUserSessions,
  revokeAllAuthSessionsForUser,
  revokeAuthSession,
  revokeAuthSessionById,
  revokeOtherAuthSessions,
  serializeUser,
  updateUserPassword,
  verifyPassword,
} from '../auth-service.js';
import { buildPasswordResetEmail } from '../email-templates.js';
import { sendTransactionalEmail } from '../mailer.js';
import { authenticatedProcedure, publicProcedure, router } from '../trpc.js';
import { parse } from '../validate.js';
import {
  acceptPendingWorkspaceInvites,
  acceptWorkspaceInviteToken,
  createWorkspaceMembership,
  ensureDefaultWorkspace,
  getPendingWorkspaceInviteByToken,
  listUserWorkspaces,
} from '../workspaces.js';

const AuthCredentialsInput = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 320 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
});

const BootstrapInput = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 320 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
});

const RevokeSessionInput = Type.Object({
  sessionId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
});

const ChangePasswordInput = Type.Object({
  currentPassword: Type.String({ minLength: 8, maxLength: 200 }),
  nextPassword: Type.String({ minLength: 8, maxLength: 200 }),
});

const AcceptInviteInput = Type.Object({
  token: Type.String({ minLength: 10, maxLength: 400 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
});

const RequestPasswordResetInput = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 320 }),
});

const ResetPasswordInput = Type.Object({
  token: Type.String({ minLength: 10, maxLength: 400 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
});

function serializeWorkspaceSummary(row: {
  id: string;
  slug: string;
  name: string;
  role: string;
}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role,
  };
}

function requireAuthManagementMode(
  ctx: {
    authMode: 'required' | 'disabled';
  },
  action: string,
) {
  if (ctx.authMode === 'disabled') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `${action} is unavailable while AUTH_MODE=disabled.`,
    });
  }
}

export const authRouter = router({
  status: publicProcedure.query(async ({ ctx }) => {
    const needsBootstrap = ctx.authMode === 'disabled' ? false : (await countUsers(ctx.db)) === 0;

    return {
      authMode: ctx.authMode,
      needsBootstrap,
      user: ctx.user,
      session: ctx.session,
    };
  }),

  login: publicProcedure.input(parse(AuthCredentialsInput)).mutation(async ({ ctx, input }) => {
    requireAuthManagementMode(ctx, 'Sign in');

    const user = await findUserByEmail(ctx.db, input.email);
    if (!user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Invalid email or password',
      });
    }

    const matches = await verifyPassword(input.password, user.passwordHash);
    if (!matches) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Invalid email or password',
      });
    }

    const acceptedInvites = await acceptPendingWorkspaceInvites({
      db: ctx.db,
      userId: user.id,
      email: user.email,
    });
    const created = await createAuthSession({ db: ctx.db, userId: user.id });

    for (const invite of acceptedInvites) {
      await appendWorkspaceAuditEvent({
        db: ctx.db,
        workspaceId: invite.workspaceId,
        actorUserId: user.id,
        eventType: 'workspace.invite.accepted',
        targetType: 'invite',
        targetId: invite.id,
        summary: `${user.name} accepted an invite`,
        details: {
          email: user.email,
          role: invite.role,
        },
      });
    }

    return {
      token: created.token,
      user: serializeUser(user),
      session: created.session,
      acceptedWorkspaceIds: acceptedInvites.map((invite) => invite.workspaceId),
    };
  }),

  bootstrap: publicProcedure.input(parse(BootstrapInput)).mutation(async ({ ctx, input }) => {
    requireAuthManagementMode(ctx, 'Bootstrap');

    if ((await countUsers(ctx.db)) > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Bootstrap is already complete',
      });
    }

    const defaultWorkspace = await ensureDefaultWorkspace(ctx.db);
    const user = await createUser({
      db: ctx.db,
      email: input.email,
      name: input.name,
      password: input.password,
    });
    await createWorkspaceMembership({
      db: ctx.db,
      workspaceId: defaultWorkspace.id,
      userId: user.id,
      role: 'owner',
    });
    const created = await createAuthSession({ db: ctx.db, userId: user.id });

    return {
      token: created.token,
      user: serializeUser(user),
      session: created.session,
    };
  }),

  requestPasswordReset: publicProcedure
    .input(parse(RequestPasswordResetInput))
    .mutation(async ({ ctx, input }) => {
      requireAuthManagementMode(ctx, 'Password reset');

      const user = await findUserByEmail(ctx.db, input.email);
      if (!user) {
        return { ok: true as const };
      }

      const issued = await issuePasswordResetToken({
        db: ctx.db,
        userId: user.id,
      });
      const email = buildPasswordResetEmail({
        recipientEmail: user.email,
        token: issued.token,
      });
      const delivery = await sendTransactionalEmail({
        db: ctx.db,
        toEmail: user.email,
        subject: email.subject,
        textBody: email.textBody,
        htmlBody: email.htmlBody,
        template: 'password_reset',
        metadata: {
          userId: user.id,
          resetUrl: email.resetUrl,
          expiresAt: issued.expiresAt.toISOString(),
        },
      });

      return {
        ok: true as const,
        deliveryMode: delivery.mode,
        previewUrl: delivery.previewUrl,
      };
    }),

  resetPassword: publicProcedure
    .input(parse(ResetPasswordInput))
    .mutation(async ({ ctx, input }) => {
      requireAuthManagementMode(ctx, 'Password reset');

      const consumed = await consumePasswordResetToken({
        db: ctx.db,
        token: input.token,
      });
      if (!consumed) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Reset token is invalid, expired, or already used',
        });
      }

      await updateUserPassword({
        db: ctx.db,
        userId: consumed.userId,
        newPassword: input.password,
      });
      await revokeAllAuthSessionsForUser({
        db: ctx.db,
        userId: consumed.userId,
      });

      return { ok: true as const };
    }),

  acceptInvite: publicProcedure.input(parse(AcceptInviteInput)).mutation(async ({ ctx, input }) => {
    requireAuthManagementMode(ctx, 'Invite acceptance');

    if ((await countUsers(ctx.db)) === 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Bootstrap the wrapper before accepting invites',
      });
    }

    const invite = await getPendingWorkspaceInviteByToken({
      db: ctx.db,
      token: input.token.trim(),
    });
    if (!invite) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Invite token is invalid, expired, or already used',
      });
    }

    const existing = await findUserByEmail(ctx.db, invite.email);
    if (existing) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'This invite email already belongs to an existing user. Sign in with that account and the invite will be applied automatically.',
      });
    }

    const user = await createUser({
      db: ctx.db,
      email: invite.email,
      name: input.name.trim(),
      password: input.password,
    });
    await acceptWorkspaceInviteToken({
      db: ctx.db,
      token: input.token.trim(),
      userId: user.id,
    });

    const created = await createAuthSession({ db: ctx.db, userId: user.id });
    await appendWorkspaceAuditEvent({
      db: ctx.db,
      workspaceId: invite.workspaceId,
      actorUserId: user.id,
      eventType: 'workspace.invite.accepted',
      targetType: 'invite',
      targetId: invite.id,
      summary: `${user.name} joined the workspace through an invite`,
      details: {
        email: user.email,
        role: invite.role,
      },
    });

    return {
      token: created.token,
      user: serializeUser(user),
      session: created.session,
      workspaceId: invite.workspaceId,
    };
  }),

  me: authenticatedProcedure.query(async ({ ctx }) => {
    const workspaces = await listUserWorkspaces(ctx.db, ctx.user.id);
    return {
      user: ctx.user,
      session: ctx.session,
      workspaces: workspaces.map(serializeWorkspaceSummary),
    };
  }),

  logout: authenticatedProcedure.mutation(async ({ ctx }) => {
    if (ctx.authMode === 'disabled') {
      return { ok: true as const };
    }

    await revokeAuthSession({
      db: ctx.db,
      token: ctx.sessionToken,
    });
    return { ok: true };
  }),

  sessions: authenticatedProcedure.query(async ({ ctx }) => {
    if (ctx.authMode === 'disabled') {
      return {
        currentSessionId: ctx.session.id,
        sessions: [ctx.session],
      };
    }

    const sessions = await listUserSessions({
      db: ctx.db,
      userId: ctx.user.id,
    });
    return {
      currentSessionId: ctx.session.id,
      sessions,
    };
  }),

  revokeSession: authenticatedProcedure
    .input(parse(RevokeSessionInput))
    .mutation(async ({ ctx, input }) => {
      requireAuthManagementMode(ctx, 'Session revocation');

      await revokeAuthSessionById({
        db: ctx.db,
        userId: ctx.user.id,
        sessionId: input.sessionId,
      });
      return { ok: true as const };
    }),

  revokeOtherSessions: authenticatedProcedure.mutation(async ({ ctx }) => {
    requireAuthManagementMode(ctx, 'Session revocation');

    await revokeOtherAuthSessions({
      db: ctx.db,
      userId: ctx.user.id,
      keepSessionId: ctx.session.id,
    });
    return { ok: true as const };
  }),

  changePassword: authenticatedProcedure
    .input(parse(ChangePasswordInput))
    .mutation(async ({ ctx, input }) => {
      requireAuthManagementMode(ctx, 'Password changes');

      const user = await findUserByEmail(ctx.db, ctx.user.email);
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      const matches = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!matches) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Current password is incorrect',
        });
      }

      await updateUserPassword({
        db: ctx.db,
        userId: ctx.user.id,
        newPassword: input.nextPassword,
      });

      return { ok: true as const };
    }),
});
