'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import {
  Clipboard,
  ExternalLink,
  History,
  MailPlus,
  Save,
  Shield,
  Ticket,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface MemberDraftState {
  name: string;
  email: string;
  password: string;
  role: 'owner' | 'admin' | 'member';
}

type PolicyBooleanDraft = 'inherit' | 'enabled' | 'disabled';

interface ExecPolicyDraftState {
  enabled: PolicyBooleanDraft;
  allowTrusted: PolicyBooleanDraft;
  allowElevated: PolicyBooleanDraft;
  allowedCommandPrefixes: string;
  trustedCommandPrefixes: string;
  elevatedCommandPrefixes: string;
  allowedCommandFamilies: string;
  trustedCommandFamilies: string;
  elevatedCommandFamilies: string;
}

const EMPTY_DRAFT: MemberDraftState = {
  name: '',
  email: '',
  password: '',
  role: 'member',
};

const EMPTY_EXEC_POLICY_DRAFT: ExecPolicyDraftState = {
  enabled: 'inherit',
  allowTrusted: 'inherit',
  allowElevated: 'inherit',
  allowedCommandPrefixes: '',
  trustedCommandPrefixes: '',
  elevatedCommandPrefixes: '',
  allowedCommandFamilies: '',
  trustedCommandFamilies: '',
  elevatedCommandFamilies: '',
};

function booleanToDraft(value: boolean | undefined): PolicyBooleanDraft {
  if (value === true) return 'enabled';
  if (value === false) return 'disabled';
  return 'inherit';
}

function listToDraft(value: string[] | undefined): string {
  return value?.join(', ') ?? '';
}

function parsePolicyList(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
}

function draftToBoolean(value: PolicyBooleanDraft): boolean | undefined {
  if (value === 'enabled') return true;
  if (value === 'disabled') return false;
  return undefined;
}

export function WorkspaceMembersPanel({ open, onClose }: Props) {
  const [draft, setDraft] = useState<MemberDraftState>(EMPTY_DRAFT);
  const [execPolicyDraft, setExecPolicyDraft] =
    useState<ExecPolicyDraftState>(EMPTY_EXEC_POLICY_DRAFT);
  const [removePending, setRemovePending] = useState<{ id: string; name: string } | null>(null);
  const [inviteDraft, setInviteDraft] = useState({
    email: '',
    role: 'member' as MemberDraftState['role'],
  });
  const [lastInviteDelivery, setLastInviteDelivery] = useState<{
    token?: string;
    previewUrl?: string;
    deliveryMode: 'outbox' | 'webhook';
    email: string;
  } | null>(null);

  const membersQuery = trpc.workspaces.members.useQuery(undefined, {
    enabled: open,
  });
  const authStatusQuery = trpc.auth.status.useQuery(undefined, {
    enabled: open,
  });
  const invitesQuery = trpc.workspaces.invites.useQuery(undefined, {
    enabled: open,
  });
  const auditQuery = trpc.workspaces.audit.useQuery(undefined, {
    enabled: open,
  });

  const addMemberMutation = trpc.workspaces.addMember.useMutation({
    onSuccess(result) {
      void Promise.all([membersQuery.refetch(), auditQuery.refetch()]);
      notify({
        tone: 'success',
        title: 'Member added',
        message: `${result.user.name} now has ${result.role} access.`,
      });
      setDraft(EMPTY_DRAFT);
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Member add failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const updateRoleMutation = trpc.workspaces.updateMemberRole.useMutation({
    onSuccess() {
      void Promise.all([membersQuery.refetch(), auditQuery.refetch()]);
      notify({
        tone: 'success',
        title: 'Role updated',
        message: 'Workspace access has been updated.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Role update failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const removeMemberMutation = trpc.workspaces.removeMember.useMutation({
    onSuccess() {
      void Promise.all([membersQuery.refetch(), auditQuery.refetch()]);
      notify({
        tone: 'success',
        title: 'Member removed',
        message: 'Workspace access has been revoked.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Remove failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const createInviteMutation = trpc.workspaces.createInvite.useMutation({
    onSuccess(result) {
      setLastInviteDelivery({
        token: result.token ?? undefined,
        previewUrl: result.previewUrl ?? undefined,
        deliveryMode: result.deliveryMode,
        email: result.invite.email,
      });
      setInviteDraft({ email: '', role: 'member' });
      void Promise.all([invitesQuery.refetch(), auditQuery.refetch()]);
      notify({
        tone: 'success',
        title: 'Invite created',
        message:
          result.deliveryMode === 'outbox'
            ? `Invite email prepared for ${result.invite.email}. Open the preview or copy the token.`
            : `Invite email sent to ${result.invite.email}.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Invite failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const revokeInviteMutation = trpc.workspaces.revokeInvite.useMutation({
    onSuccess() {
      void Promise.all([invitesQuery.refetch(), auditQuery.refetch()]);
      notify({
        tone: 'success',
        title: 'Invite revoked',
        message: 'The token can no longer be used.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Revoke failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const updateExecPolicyMutation = trpc.workspaces.updateExecPolicy.useMutation({
    onSuccess(result) {
      void Promise.all([membersQuery.refetch(), auditQuery.refetch()]);
      setExecPolicyDraft({
        enabled: booleanToDraft(result.execPolicy?.enabled),
        allowTrusted: booleanToDraft(result.execPolicy?.allowTrusted),
        allowElevated: booleanToDraft(result.execPolicy?.allowElevated),
        allowedCommandPrefixes: listToDraft(result.execPolicy?.allowedCommandPrefixes),
        trustedCommandPrefixes: listToDraft(result.execPolicy?.trustedCommandPrefixes),
        elevatedCommandPrefixes: listToDraft(result.execPolicy?.elevatedCommandPrefixes),
        allowedCommandFamilies: listToDraft(result.execPolicy?.allowedCommandFamilies),
        trustedCommandFamilies: listToDraft(result.execPolicy?.trustedCommandFamilies),
        elevatedCommandFamilies: listToDraft(result.execPolicy?.elevatedCommandFamilies),
      });
      notify({
        tone: 'success',
        title: 'Exec policy updated',
        message: 'Workspace exec restrictions are now active.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Exec policy update failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  useEffect(() => {
    const policy = membersQuery.data?.workspace.execPolicy;
    if (!policy) {
      setExecPolicyDraft(EMPTY_EXEC_POLICY_DRAFT);
      return;
    }
    setExecPolicyDraft({
      enabled: booleanToDraft(policy.enabled),
      allowTrusted: booleanToDraft(policy.allowTrusted),
      allowElevated: booleanToDraft(policy.allowElevated),
      allowedCommandPrefixes: listToDraft(policy.allowedCommandPrefixes),
      trustedCommandPrefixes: listToDraft(policy.trustedCommandPrefixes),
      elevatedCommandPrefixes: listToDraft(policy.elevatedCommandPrefixes),
      allowedCommandFamilies: listToDraft(policy.allowedCommandFamilies),
      trustedCommandFamilies: listToDraft(policy.trustedCommandFamilies),
      elevatedCommandFamilies: listToDraft(policy.elevatedCommandFamilies),
    });
  }, [membersQuery.data?.workspace.execPolicy]);

  const canSubmit = useMemo(
    () =>
      draft.email.trim().length > 0 &&
      (draft.password.trim().length === 0 || draft.password.trim().length >= 8) &&
      !addMemberMutation.isPending,
    [addMemberMutation.isPending, draft.email, draft.password],
  );

  const canCreateInvite = useMemo(
    () => inviteDraft.email.trim().length > 0 && !createInviteMutation.isPending,
    [createInviteMutation.isPending, inviteDraft.email],
  );

  const canSaveExecPolicy = useMemo(
    () =>
      !updateExecPolicyMutation.isPending && !!membersQuery.data?.permissions.canManageExecPolicy,
    [membersQuery.data?.permissions.canManageExecPolicy, updateExecPolicyMutation.isPending],
  );

  if (!open) {
    return null;
  }

  const permissions = membersQuery.data?.permissions;
  const authDisabled = authStatusQuery.data?.authMode === 'disabled';

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-start justify-end bg-slate-950/20 p-4">
        <div className="flex h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <Users className="h-4 w-4" strokeWidth={2} />
                {authDisabled ? 'Workspace settings' : 'Workspace members'}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {membersQuery.data?.workspace.name ?? 'Current workspace'}
              </p>
            </div>
            <Button size="iconSm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" strokeWidth={2} />
            </Button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-gray-500">
              <div className="font-medium text-[var(--color-fg)]">
                Your role: {membersQuery.data?.workspace.role ?? 'member'}
              </div>
              <div className="mt-1">
                {authDisabled
                  ? 'Local mode is active, so workspace access is implicit for the operator on this machine. Team member and invite controls stay hidden, while workspace policy and activity stay available.'
                  : 'Owners can change roles and remove members. Admins can add members. Members can use the workspace but cannot change its sensitive settings.'}
              </div>
            </div>

            {!authDisabled && (
              <div className="rounded-2xl border border-[var(--color-border)] px-4 py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <UserPlus className="h-4 w-4" strokeWidth={2} />
                  Add member
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500">Email</span>
                    <input
                      value={draft.email}
                      onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      placeholder="teammate@example.com"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500">Role</span>
                    <select
                      value={draft.role}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          role: event.target.value as MemberDraftState['role'],
                        })
                      }
                      className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      disabled={!permissions?.canManageMembers}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500">Name</span>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      placeholder="Only needed for a brand new account"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500">Password</span>
                    <input
                      type="password"
                      value={draft.password}
                      onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      placeholder="Only needed for a brand new account"
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  If the email already belongs to an existing wrapper user, they will just be added
                  to this workspace. For a new person, include a name and password so the account
                  can be created locally.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button
                    disabled={!permissions?.canManageMembers || !canSubmit}
                    onClick={() => {
                      addMemberMutation.mutate({
                        email: draft.email.trim(),
                        role: draft.role,
                        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
                        ...(draft.password.trim() ? { password: draft.password } : {}),
                      });
                    }}
                  >
                    <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
                    {addMemberMutation.isPending ? 'Adding...' : 'Add member'}
                  </Button>
                </div>
              </div>
            )}

            {!authDisabled && (
              <div className="rounded-2xl border border-[var(--color-border)] px-4 py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Ticket className="h-4 w-4" strokeWidth={2} />
                  Invite by token
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500">Email</span>
                    <input
                      value={inviteDraft.email}
                      onChange={(event) =>
                        setInviteDraft((current) => ({ ...current, email: event.target.value }))
                      }
                      className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      placeholder="new-person@example.com"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500">Role</span>
                    <select
                      value={inviteDraft.role}
                      onChange={(event) =>
                        setInviteDraft((current) => ({
                          ...current,
                          role: event.target.value as MemberDraftState['role'],
                        }))
                      }
                      className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      disabled={!permissions?.canManageMembers}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  </label>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  Use invite tokens when you want someone to create their own account securely
                  instead of giving them a preset password.
                </p>
                {lastInviteDelivery && (
                  <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-indigo-700">
                      Latest invite delivery
                    </div>
                    <div className="mt-1 text-[11px] text-indigo-800">
                      {lastInviteDelivery.deliveryMode === 'outbox'
                        ? `Dev outbox email prepared for ${lastInviteDelivery.email}.`
                        : `Email sent to ${lastInviteDelivery.email}.`}
                    </div>
                    {lastInviteDelivery.token && (
                      <code className="mt-2 block break-all text-[11px] text-indigo-800">
                        {lastInviteDelivery.token}
                      </code>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {lastInviteDelivery.previewUrl && (
                        <a
                          href={lastInviteDelivery.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
                          Open preview
                        </a>
                      )}
                      {lastInviteDelivery.token && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(lastInviteDelivery.token ?? '');
                              notify({
                                tone: 'success',
                                title: 'Copied',
                                message: 'Invite token copied to clipboard.',
                              });
                            } catch {
                              notify({
                                tone: 'error',
                                title: 'Copy failed',
                                message: 'Clipboard unavailable.',
                              });
                            }
                          }}
                        >
                          <Clipboard className="h-3.5 w-3.5" strokeWidth={2} />
                          Copy token
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-4 flex gap-2">
                  <Button
                    disabled={!permissions?.canManageMembers || !canCreateInvite}
                    onClick={() =>
                      createInviteMutation.mutate({
                        email: inviteDraft.email.trim(),
                        role: inviteDraft.role,
                      })
                    }
                  >
                    <MailPlus className="h-3.5 w-3.5" strokeWidth={2} />
                    {createInviteMutation.isPending ? 'Creating...' : 'Create invite'}
                  </Button>
                </div>
                <div className="mt-4 space-y-2">
                  {invitesQuery.isLoading && (
                    <div className="text-sm text-gray-400">Loading invites...</div>
                  )}
                  {invitesQuery.data?.invites.map((invite) => (
                    <div
                      key={invite.id}
                      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-[var(--color-fg)]">
                            {invite.email}
                          </div>
                          <div className="mt-1 text-xs text-gray-400">
                            {invite.role} | expires {new Date(invite.expiresAt).toLocaleString()}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={
                            !permissions?.canManageMembers || revokeInviteMutation.isPending
                          }
                          onClick={() => revokeInviteMutation.mutate({ inviteId: invite.id })}
                        >
                          Revoke
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-[var(--color-border)] px-4 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <Shield className="h-4 w-4" strokeWidth={2} />
                Exec policy
              </div>
              <p className="mb-4 text-xs text-gray-400">
                Leave a setting on inherit to keep the adapter default. Prefix and family lists are
                comma- or newline-separated, and empty means no extra workspace restriction.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {(
                  [
                    ['enabled', 'Exec availability'],
                    ['allowTrusted', 'Trusted mode'],
                    ['allowElevated', 'Require elevated'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>
                    <select
                      value={execPolicyDraft[key]}
                      onChange={(event) =>
                        setExecPolicyDraft((current) => ({
                          ...current,
                          [key]: event.target.value as PolicyBooleanDraft,
                        }))
                      }
                      className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      disabled={!membersQuery.data?.permissions.canManageExecPolicy}
                    >
                      <option value="inherit">Inherit adapter default</option>
                      <option value="enabled">Allow</option>
                      <option value="disabled">Block</option>
                    </select>
                  </label>
                ))}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {(
                  [
                    ['allowedCommandPrefixes', 'Global command prefixes'],
                    ['trustedCommandPrefixes', 'Trusted prefixes'],
                    ['elevatedCommandPrefixes', 'Require elevated prefixes'],
                    ['allowedCommandFamilies', 'Global command families'],
                    ['trustedCommandFamilies', 'Trusted families'],
                    ['elevatedCommandFamilies', 'Require elevated families'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500">{label}</span>
                    <textarea
                      value={execPolicyDraft[key]}
                      onChange={(event) =>
                        setExecPolicyDraft((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      rows={3}
                      className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      placeholder="pnpm, node"
                      disabled={!membersQuery.data?.permissions.canManageExecPolicy}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  disabled={!canSaveExecPolicy}
                  onClick={() =>
                    updateExecPolicyMutation.mutate({
                      enabled: draftToBoolean(execPolicyDraft.enabled),
                      allowTrusted: draftToBoolean(execPolicyDraft.allowTrusted),
                      allowElevated: draftToBoolean(execPolicyDraft.allowElevated),
                      allowedCommandPrefixes: parsePolicyList(
                        execPolicyDraft.allowedCommandPrefixes,
                      ),
                      trustedCommandPrefixes: parsePolicyList(
                        execPolicyDraft.trustedCommandPrefixes,
                      ),
                      elevatedCommandPrefixes: parsePolicyList(
                        execPolicyDraft.elevatedCommandPrefixes,
                      ),
                      allowedCommandFamilies: parsePolicyList(
                        execPolicyDraft.allowedCommandFamilies,
                      ),
                      trustedCommandFamilies: parsePolicyList(
                        execPolicyDraft.trustedCommandFamilies,
                      ),
                      elevatedCommandFamilies: parsePolicyList(
                        execPolicyDraft.elevatedCommandFamilies,
                      ),
                    })
                  }
                >
                  <Save className="h-3.5 w-3.5" strokeWidth={2} />
                  {updateExecPolicyMutation.isPending ? 'Saving...' : 'Save exec policy'}
                </Button>
              </div>
            </div>

            {!authDisabled && (
              <div className="rounded-2xl border border-[var(--color-border)] px-4 py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Shield className="h-4 w-4" strokeWidth={2} />
                  Current access
                </div>
                <div className="space-y-3">
                  {membersQuery.isLoading && (
                    <div className="text-sm text-gray-400">Loading members...</div>
                  )}
                  {membersQuery.data?.members.map((member) => (
                    <div
                      key={member.user.id}
                      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                            {member.user.name}
                          </div>
                          <div className="truncate text-xs text-gray-400">{member.user.email}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={member.role}
                            onChange={(event) => {
                              updateRoleMutation.mutate({
                                userId: member.user.id,
                                role: event.target.value as MemberDraftState['role'],
                              });
                            }}
                            className="h-8 rounded-lg border border-[var(--color-border)] bg-white px-2 text-xs text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                            disabled={!permissions?.canManageRoles || updateRoleMutation.isPending}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="owner">Owner</option>
                          </select>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={
                              !permissions?.canManageRoles || removeMemberMutation.isPending
                            }
                            onClick={() =>
                              setRemovePending({ id: member.user.id, name: member.user.name })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-[var(--color-border)] px-4 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <History className="h-4 w-4" strokeWidth={2} />
                Recent activity
              </div>
              <div className="space-y-3">
                {auditQuery.isLoading && (
                  <div className="text-sm text-gray-400">Loading activity...</div>
                )}
                {auditQuery.data?.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="text-sm font-medium text-[var(--color-fg)]">
                      {event.summary}
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      {event.actorUser ? `${event.actorUser.name} | ` : ''}
                      {new Date(event.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!removePending}
        title="Remove member"
        message={`Remove ${removePending?.name ?? 'this member'} from the workspace? They will lose all access immediately.`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => {
          if (removePending) removeMemberMutation.mutate({ userId: removePending.id });
          setRemovePending(null);
        }}
        onCancel={() => setRemovePending(null)}
      />
    </>
  );
}
