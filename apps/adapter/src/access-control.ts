import { TRPCError } from '@trpc/server';
import type { Context } from './trpc.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export function normalizeWorkspaceRole(role: string): WorkspaceRole {
  if (role === 'owner' || role === 'admin' || role === 'member') {
    return role;
  }
  return 'member';
}

export function hasWorkspaceRole(
  currentRole: string,
  allowedRoles: readonly WorkspaceRole[],
): boolean {
  return allowedRoles.includes(normalizeWorkspaceRole(currentRole));
}

export function requireWorkspaceRole(
  ctx: Pick<Context, 'workspace'>,
  allowedRoles: readonly WorkspaceRole[],
  action: string,
) {
  if (!ctx.workspace || !hasWorkspaceRole(ctx.workspace.role, allowedRoles)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `${action} requires ${allowedRoles.join(' or ')} access in this workspace`,
    });
  }
}

export function workspaceCanManageMembers(role: string): boolean {
  return hasWorkspaceRole(role, ['owner', 'admin']);
}

export function workspaceCanManageRoles(role: string): boolean {
  return hasWorkspaceRole(role, ['owner']);
}
