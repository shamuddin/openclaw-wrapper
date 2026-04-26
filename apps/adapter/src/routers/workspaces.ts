import { WorkspaceExecPolicy } from '@openclaw-wrapper/schemas';
import { Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  requireWorkspaceRole,
  workspaceCanManageMembers,
  workspaceCanManageRoles,
} from '../access-control.js';
import { appendWorkspaceAuditEvent } from '../audit-log.js';
import { createUser, findUserByEmail, serializeUser } from '../auth-service.js';
import {
  users,
  workspaceAuditEvents,
  workspaceInvites,
  workspaceMemberships,
  workspaces,
} from '../db/schema.js';
import { buildWorkspaceInviteEmail } from '../email-templates.js';
import { sendTransactionalEmail } from '../mailer.js';
import { normalizeWorkspaceExecPolicy } from '../system-exec.js';
import { authenticatedProcedure, router } from '../trpc.js';
import { parse } from '../validate.js';
import { createWorkspaceMembership } from '../workspaces.js';
import {
  createWorkspaceInvite,
  listWorkspaceInvites,
  revokeWorkspaceInvite,
} from '../workspaces.js';

const CreateWorkspaceInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  slug: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
});

const WorkspaceRole = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
]);

const AddWorkspaceMemberInput = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 320 }),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  password: Type.Optional(Type.String({ minLength: 8, maxLength: 200 })),
  role: WorkspaceRole,
});

const UpdateWorkspaceMemberRoleInput = Type.Object({
  userId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  role: WorkspaceRole,
});

const RemoveWorkspaceMemberInput = Type.Object({
  userId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
});

const CreateWorkspaceInviteInput = Type.Object({
  email: Type.String({ minLength: 3, maxLength: 320 }),
  role: WorkspaceRole,
  expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
});

const RevokeWorkspaceInviteInput = Type.Object({
  inviteId: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
});

const UpdateWorkspaceExecPolicyInput = WorkspaceExecPolicy;

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function deriveSlug(name: string, inputSlug?: string): string {
  const candidate = normalizeSlug(inputSlug ?? name);
  if (!candidate) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'workspace slug must contain letters or numbers',
    });
  }
  return candidate;
}

function serializeWorkspace(row: {
  id: string;
  slug: string;
  name: string;
  role: string;
  execPolicy?: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    role: row.role,
    execPolicy: normalizeWorkspaceExecPolicy(row.execPolicy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function serializeMember(row: {
  role: string;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  };
}) {
  return {
    user: serializeUser(row.user),
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeInvite(row: {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
  createdByUserId: string;
}) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
  };
}

function serializeAuditEvent(row: {
  id: string;
  eventType: string;
  targetType: string;
  targetId: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
  actorUserId: string | null;
  actorUserEmail: string | null;
  actorUserName: string | null;
  actorUserCreatedAt: Date | null;
  actorUserUpdatedAt: Date | null;
}) {
  return {
    id: row.id,
    eventType: row.eventType,
    targetType: row.targetType,
    targetId: row.targetId ?? undefined,
    summary: row.summary,
    details: row.details ?? undefined,
    createdAt: row.createdAt.toISOString(),
    actorUser:
      row.actorUserId &&
      row.actorUserEmail &&
      row.actorUserName &&
      row.actorUserCreatedAt &&
      row.actorUserUpdatedAt
        ? serializeUser({
            id: row.actorUserId,
            email: row.actorUserEmail,
            name: row.actorUserName,
            createdAt: row.actorUserCreatedAt,
            updatedAt: row.actorUserUpdatedAt,
          })
        : undefined,
  };
}

export const workspacesRouter = router({
  current: authenticatedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        execPolicy: workspaces.execPolicy,
        role: workspaceMemberships.role,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .innerJoin(workspaceMemberships, eq(workspaceMemberships.workspaceId, workspaces.id))
      .where(eq(workspaceMemberships.userId, ctx.user.id))
      .orderBy(asc(workspaces.name), asc(workspaces.createdAt));
    const currentRow = rows.find((row) => row.id === ctx.workspace?.id);

    return {
      current: serializeWorkspace(
        currentRow ?? {
          id: ctx.workspace?.id ?? rows[0]?.id ?? '',
          slug: ctx.workspace?.slug ?? rows[0]?.slug ?? '',
          name: ctx.workspace?.name ?? rows[0]?.name ?? '',
          execPolicy: ctx.workspace?.execPolicy ?? rows[0]?.execPolicy ?? {},
          role: ctx.workspace?.role ?? rows[0]?.role ?? 'member',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ),
      available: rows.map(serializeWorkspace),
      permissions: {
        canManageExecPolicy:
          (ctx.workspace?.role ?? rows[0]?.role ?? 'member') === 'owner' ||
          (ctx.workspace?.role ?? rows[0]?.role ?? 'member') === 'admin',
      },
    };
  }),

  list: authenticatedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        execPolicy: workspaces.execPolicy,
        role: workspaceMemberships.role,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .innerJoin(workspaceMemberships, eq(workspaceMemberships.workspaceId, workspaces.id))
      .where(eq(workspaceMemberships.userId, ctx.user.id))
      .orderBy(asc(workspaces.name), asc(workspaces.createdAt));
    return rows.map(serializeWorkspace);
  }),

  create: authenticatedProcedure
    .input(parse(CreateWorkspaceInput))
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      const slug = deriveSlug(name, input.slug);

      const existing = await ctx.db.query.workspaces.findFirst({
        where: (table, { eq }) => eq(table.slug, slug),
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `workspace slug "${slug}" is already in use`,
        });
      }

      const now = new Date();
      const [row] = await ctx.db
        .insert(workspaces)
        .values({
          name,
          slug,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!row) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'workspace create failed',
        });
      }

      await createWorkspaceMembership({
        db: ctx.db,
        workspaceId: row.id,
        userId: ctx.user.id,
        role: 'owner',
      });
      await appendWorkspaceAuditEvent({
        db: ctx.db,
        workspaceId: row.id,
        actorUserId: ctx.user.id,
        eventType: 'workspace.created',
        targetType: 'workspace',
        targetId: row.id,
        summary: `${ctx.user.name} created the workspace`,
        details: { slug: row.slug },
      });

      return serializeWorkspace({
        ...row,
        role: 'owner',
      });
    }),

  updateExecPolicy: authenticatedProcedure
    .input(parse(UpdateWorkspaceExecPolicyInput))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Select a workspace to update exec policy',
        });
      }
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Updating exec policy');

      const workspace = ctx.workspace;
      const execPolicy = normalizeWorkspaceExecPolicy(input);
      const now = new Date();

      const [row] = await ctx.db
        .update(workspaces)
        .set({
          execPolicy,
          updatedAt: now,
        })
        .where(eq(workspaces.id, workspace.id))
        .returning({
          id: workspaces.id,
          slug: workspaces.slug,
          name: workspaces.name,
          execPolicy: workspaces.execPolicy,
          createdAt: workspaces.createdAt,
          updatedAt: workspaces.updatedAt,
        });

      if (!row) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'workspace exec policy update failed',
        });
      }

      await appendWorkspaceAuditEvent({
        db: ctx.db,
        workspaceId: workspace.id,
        actorUserId: ctx.user.id,
        eventType: 'workspace.exec_policy.updated',
        targetType: 'workspace',
        targetId: workspace.id,
        summary: `${ctx.user.name} updated the workspace exec policy`,
        details: execPolicy,
      });

      return serializeWorkspace({
        ...row,
        role: workspace.role,
      });
    }),

  members: authenticatedProcedure.query(async ({ ctx }) => {
    if (!ctx.workspace) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Select a workspace to manage members',
      });
    }
    const workspace = ctx.workspace;

    const rows = await ctx.db.query.workspaceMemberships.findMany({
      where: (table, { eq }) => eq(table.workspaceId, workspace.id),
      with: {
        user: true,
      },
      orderBy: (table, { asc }) => [asc(table.role), asc(table.createdAt)],
    });

    return {
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        role: workspace.role,
        execPolicy: normalizeWorkspaceExecPolicy(workspace.execPolicy),
      },
      members: rows.map(serializeMember),
      permissions: {
        canManageMembers: workspaceCanManageMembers(workspace.role),
        canManageRoles: workspaceCanManageRoles(workspace.role),
        canManageExecPolicy: workspace.role === 'owner' || workspace.role === 'admin',
      },
    };
  }),

  invites: authenticatedProcedure.query(async ({ ctx }) => {
    if (!ctx.workspace) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Select a workspace to view invites',
      });
    }

    const invites = await listWorkspaceInvites({
      db: ctx.db,
      workspaceId: ctx.workspace.id,
    });

    return {
      invites: invites.map(serializeInvite),
      permissions: {
        canManageMembers: workspaceCanManageMembers(ctx.workspace.role),
      },
    };
  }),

  createInvite: authenticatedProcedure
    .input(parse(CreateWorkspaceInviteInput))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Select a workspace to create invites',
        });
      }
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Creating invites');

      if (input.role === 'owner' && !workspaceCanManageRoles(ctx.workspace.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only owners can grant owner access',
        });
      }

      const created = await createWorkspaceInvite({
        db: ctx.db,
        workspaceId: ctx.workspace.id,
        email: input.email,
        role: input.role,
        createdByUserId: ctx.user.id,
        expiresInDays: input.expiresInDays,
      });
      const email = buildWorkspaceInviteEmail({
        workspaceName: ctx.workspace.name,
        inviterName: ctx.user.name,
        recipientEmail: created.invite.email,
        token: created.token,
      });
      const delivery = await sendTransactionalEmail({
        db: ctx.db,
        toEmail: created.invite.email,
        subject: email.subject,
        textBody: email.textBody,
        htmlBody: email.htmlBody,
        template: 'workspace_invite',
        metadata: {
          workspaceId: ctx.workspace.id,
          inviteId: created.invite.id,
          inviteUrl: email.inviteUrl,
          role: created.invite.role,
        },
      });
      await appendWorkspaceAuditEvent({
        db: ctx.db,
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        eventType: 'workspace.invite.created',
        targetType: 'invite',
        targetId: created.invite.id,
        summary: `${ctx.user.name} invited ${created.invite.email}`,
        details: {
          role: created.invite.role,
          expiresAt: created.invite.expiresAt.toISOString(),
        },
      });

      return {
        invite: serializeInvite(created.invite),
        deliveryMode: delivery.mode,
        previewUrl: delivery.previewUrl,
        token: delivery.mode === 'outbox' ? created.token : undefined,
      };
    }),

  revokeInvite: authenticatedProcedure
    .input(parse(RevokeWorkspaceInviteInput))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Select a workspace to revoke invites',
        });
      }
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Revoking invites');
      const workspace = ctx.workspace;

      const invite = await ctx.db.query.workspaceInvites.findFirst({
        where: (table, { and, eq, isNull }) =>
          and(
            eq(table.workspaceId, workspace.id),
            eq(table.id, input.inviteId),
            isNull(table.acceptedAt),
            isNull(table.revokedAt),
          ),
      });
      if (!invite) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found' });
      }

      await revokeWorkspaceInvite({
        db: ctx.db,
        workspaceId: workspace.id,
        inviteId: input.inviteId,
      });
      await appendWorkspaceAuditEvent({
        db: ctx.db,
        workspaceId: workspace.id,
        actorUserId: ctx.user.id,
        eventType: 'workspace.invite.revoked',
        targetType: 'invite',
        targetId: invite.id,
        summary: `${ctx.user.name} revoked the invite for ${invite.email}`,
        details: {
          role: invite.role,
        },
      });

      return { ok: true as const };
    }),

  audit: authenticatedProcedure.query(async ({ ctx }) => {
    if (!ctx.workspace) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Select a workspace to view activity',
      });
    }
    const workspace = ctx.workspace;

    const rows = await ctx.db
      .select({
        id: workspaceAuditEvents.id,
        eventType: workspaceAuditEvents.eventType,
        targetType: workspaceAuditEvents.targetType,
        targetId: workspaceAuditEvents.targetId,
        summary: workspaceAuditEvents.summary,
        details: workspaceAuditEvents.details,
        createdAt: workspaceAuditEvents.createdAt,
        actorUserId: users.id,
        actorUserEmail: users.email,
        actorUserName: users.name,
        actorUserCreatedAt: users.createdAt,
        actorUserUpdatedAt: users.updatedAt,
      })
      .from(workspaceAuditEvents)
      .leftJoin(users, eq(workspaceAuditEvents.actorUserId, users.id))
      .where(eq(workspaceAuditEvents.workspaceId, workspace.id))
      .orderBy(desc(workspaceAuditEvents.createdAt))
      .limit(25);

    return rows.map(serializeAuditEvent);
  }),

  addMember: authenticatedProcedure
    .input(parse(AddWorkspaceMemberInput))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Select a workspace to add members',
        });
      }
      const workspace = ctx.workspace;
      requireWorkspaceRole(ctx, ['owner', 'admin'], 'Adding members');

      const email = normalizeEmail(input.email);
      let user = await findUserByEmail(ctx.db, email);
      if (!user) {
        if (!input.name?.trim() || !input.password?.trim()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Name and password are required when creating a new member account',
          });
        }
        user = await createUser({
          db: ctx.db,
          email,
          name: input.name.trim(),
          password: input.password,
        });
      }

      if (input.role === 'owner' && !workspaceCanManageRoles(workspace.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only owners can grant owner access',
        });
      }

      await createWorkspaceMembership({
        db: ctx.db,
        workspaceId: workspace.id,
        userId: user.id,
        role: input.role,
      });
      await appendWorkspaceAuditEvent({
        db: ctx.db,
        workspaceId: workspace.id,
        actorUserId: ctx.user.id,
        eventType: 'workspace.member.added',
        targetType: 'membership',
        targetId: user.id,
        summary: `${ctx.user.name} added ${user.name} as ${input.role}`,
        details: {
          email: user.email,
          role: input.role,
        },
      });

      const membership = await ctx.db.query.workspaceMemberships.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.workspaceId, workspace.id), eq(table.userId, user.id)),
        with: {
          user: true,
        },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'member add failed',
        });
      }

      return serializeMember(membership);
    }),

  updateMemberRole: authenticatedProcedure
    .input(parse(UpdateWorkspaceMemberRoleInput))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Select a workspace to update roles',
        });
      }
      const workspace = ctx.workspace;
      requireWorkspaceRole(ctx, ['owner'], 'Updating member roles');

      const membership = await ctx.db.query.workspaceMemberships.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.workspaceId, workspace.id), eq(table.userId, input.userId)),
        with: {
          user: true,
        },
      });
      if (!membership) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Workspace member not found',
        });
      }

      const now = new Date();
      await ctx.db
        .update(workspaceMemberships)
        .set({
          role: input.role,
          updatedAt: now,
        })
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspace.id),
            eq(workspaceMemberships.userId, input.userId),
          ),
        );
      await appendWorkspaceAuditEvent({
        db: ctx.db,
        workspaceId: workspace.id,
        actorUserId: ctx.user.id,
        eventType: 'workspace.member.role_updated',
        targetType: 'membership',
        targetId: input.userId,
        summary: `${ctx.user.name} changed a member role to ${input.role}`,
        details: {
          previousRole: membership.role,
          nextRole: input.role,
        },
      });

      return {
        ok: true as const,
      };
    }),

  removeMember: authenticatedProcedure
    .input(parse(RemoveWorkspaceMemberInput))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspace) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Select a workspace to remove members',
        });
      }
      const workspace = ctx.workspace;
      requireWorkspaceRole(ctx, ['owner'], 'Removing members');

      const membership = await ctx.db.query.workspaceMemberships.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.workspaceId, workspace.id), eq(table.userId, input.userId)),
      });
      if (!membership) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Workspace member not found',
        });
      }

      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Owners cannot remove themselves from the active workspace',
        });
      }

      const owners = await ctx.db.query.workspaceMemberships.findMany({
        where: (table, { and, eq }) =>
          and(eq(table.workspaceId, workspace.id), eq(table.role, 'owner')),
        columns: { userId: true },
      });
      if (membership.role === 'owner' && owners.length <= 1) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'A workspace must keep at least one owner',
        });
      }

      await ctx.db
        .delete(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspace.id),
            eq(workspaceMemberships.userId, input.userId),
          ),
        );
      await appendWorkspaceAuditEvent({
        db: ctx.db,
        workspaceId: workspace.id,
        actorUserId: ctx.user.id,
        eventType: 'workspace.member.removed',
        targetType: 'membership',
        targetId: input.userId,
        summary: `${ctx.user.name} removed a workspace member`,
        details: {
          userId: input.userId,
          role: membership.role,
        },
      });

      return { ok: true as const };
    }),
});
