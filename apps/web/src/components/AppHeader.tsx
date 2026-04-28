'use client';

import { GatewayPanel } from '@/canvas/GatewayPanel';
import { OpenClawLogo } from '@/components/OpenClawLogo';
import { AccountPanel } from '@/components/AccountPanel';
import { useSession } from '@/components/SessionProvider';
import { WorkspaceMembersPanel } from '@/components/WorkspaceMembersPanel';
import { useWorkspace } from '@/components/WorkspaceProvider';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import {
  LogOut,
  Shield,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AppHeader({
  current,
  title,
  subtitle,
}: {
  current: 'workspace' | 'builder' | 'channels' | 'cron' | 'automation' | 'ops' | 'youtube';
  title: string;
  subtitle: string;
}) {
  const router = useRouter();
  const [accountOpen, setAccountOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [workspacePromptOpen, setWorkspacePromptOpen] = useState(false);
  const { workspaceSlug, setWorkspaceSlug } = useWorkspace();
  const { clearSessionToken } = useSession();
  const utils = trpc.useUtils();
  const authStatusQuery = trpc.auth.status.useQuery();
  const authQuery = trpc.auth.me.useQuery();
  const workspacesQuery = trpc.workspaces.current.useQuery();
  const authDisabled = authStatusQuery.data?.authMode === 'disabled';
  const displayUser = authQuery.data?.user ?? authStatusQuery.data?.user;

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess() {
      clearSessionToken();
      void Promise.allSettled([
        utils.auth.status.invalidate(),
        utils.auth.me.invalidate(),
        utils.workspaces.current.invalidate(),
      ]);
      notify({
        tone: 'success',
        title: 'Signed out',
        message: 'Your wrapper session has been cleared.',
      });
      router.refresh();
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Sign out failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const createWorkspace = trpc.workspaces.create.useMutation({
    onSuccess(workspace) {
      notify({
        tone: 'success',
        title: 'Workspace created',
        message: `${workspace.name} is ready.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Workspace create failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  async function handleWorkspaceChange(nextSlug: string) {
    if (!nextSlug || nextSlug === workspaceSlug) return;
    setWorkspaceSlug(nextSlug);
    await Promise.allSettled([
      utils.flows.list.invalidate(),
      utils.channels.list.invalidate(),
      utils.runs.list.invalidate(),
      utils.workspaces.current.invalidate(),
    ]);
    router.refresh();
  }

  async function handleCreateWorkspace(values: Record<string, string>) {
    setWorkspacePromptOpen(false);
    const name = values.name?.trim();
    if (!name) return;
    const slug = values.slug?.trim() || undefined;
    const created = await createWorkspace.mutateAsync({ name, ...(slug ? { slug } : {}) });
    await utils.workspaces.current.invalidate();
    await handleWorkspaceChange(created.slug);
  }

  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <OpenClawLogo className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <span>OpenClaw</span>
              <span className="text-gray-300">/</span>
              <span className="truncate">{title}</span>
            </div>
            <p className="truncate text-[11px] text-gray-400">{subtitle}</p>
          </div>
        </div>

        <div className="ml-auto mr-3 flex items-center gap-2">
          <div className="hidden min-w-0 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-right md:flex">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-[var(--color-fg)]">
                {displayUser?.name ?? 'Workspace user'}
              </div>
              <div className="truncate text-[10px] text-gray-400">
                {authDisabled ? 'Local mode (auth disabled)' : (displayUser?.email ?? '')}
              </div>
            </div>
          </div>

          <select
            value={workspaceSlug}
            onChange={(event) => void handleWorkspaceChange(event.target.value)}
            className="h-8 min-w-[150px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-fg)] outline-none transition hover:bg-[var(--color-surface-2)] focus:border-[var(--color-accent)]"
            aria-label="Switch workspace"
          >
            {(workspacesQuery.data?.available ?? []).map((workspace) => (
              <option key={workspace.id} value={workspace.slug}>
                {workspace.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-gray-500 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-40"
            onClick={() => setWorkspacePromptOpen(true)}
            disabled={createWorkspace.isPending}
            aria-label="Create new workspace"
          >
            {createWorkspace.isPending ? 'Creating...' : 'New workspace'}
          </button>

          {!authDisabled && (
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-gray-500 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
              onClick={() => setAccountOpen(true)}
              aria-label="Account settings"
            >
              <Shield className="h-3.5 w-3.5" strokeWidth={2} />
              Account
            </button>
          )}

          {current !== 'workspace' && (
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-gray-500 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
              onClick={() => setMembersOpen(true)}
              aria-label={authDisabled ? 'Open workspace settings' : 'Manage workspace members'}
            >
              <Users className="h-3.5 w-3.5" strokeWidth={2} />
              {authDisabled ? 'Workspace' : 'Members'}
            </button>
          )}

          {!authDisabled && (
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-gray-500 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-40"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
              {logoutMutation.isPending ? 'Signing out...' : 'Sign out'}
            </button>
          )}
        </div>

        <GatewayPanel />
        <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />
        <WorkspaceMembersPanel open={membersOpen} onClose={() => setMembersOpen(false)} />
      </header>

      <PromptDialog
        open={workspacePromptOpen}
        title="New workspace"
        description="Create a new isolated workspace for your flows and channels."
        fields={[
          { key: 'name', label: 'Workspace name', placeholder: 'My workspace' },
          { key: 'slug', label: 'Slug (optional)', placeholder: 'my-workspace' },
        ]}
        confirmLabel="Create"
        onConfirm={handleCreateWorkspace}
        onCancel={() => setWorkspacePromptOpen(false)}
      />
    </>
  );
}
