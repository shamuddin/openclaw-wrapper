'use client';

import { WorkspaceMembersPanel } from '@/components/WorkspaceMembersPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PromptDialog } from '@/components/ui/PromptDialog';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { saveLastFlowId } from '@/lib/flow-selection';
import { buildTriggerPlan } from '@/lib/trigger-plan';
import { trpc } from '@/lib/trpc';
import {
  Activity,
  AlertTriangle,
  CircleDashed,
  Copy,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderOpen,
  GitBranch,
  MailPlus,
  PencilLine,
  Play,
  Search,
  Shield,
  Ticket,
  Trash2,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

interface RenameTarget {
  id: string;
  name: string;
}

type FlowFilter = 'all' | 'published' | 'drafts' | 'attention' | 'never-run';

function toneClasses(tone: 'blue' | 'green' | 'amber' | 'slate'): string {
  switch (tone) {
    case 'blue':
      return 'border-sky-200 bg-sky-50 text-sky-950';
    case 'green':
      return 'border-emerald-200 bg-emerald-50 text-emerald-950';
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-950';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]';
  }
}

function runStatusTone(status: string | undefined): string {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-800';
    case 'running':
      return 'border-sky-200 bg-sky-50 text-sky-800';
    case 'waiting':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'cancelled':
      return 'border-slate-200 bg-slate-100 text-slate-700';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-600';
  }
}

function roleTone(role: string): string {
  switch (role) {
    case 'owner':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'admin':
      return 'border-sky-200 bg-sky-50 text-sky-800';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-600';
  }
}

function formatRunStatus(status: string | undefined): string {
  return status ? status.replace(/-/g, ' ') : 'Never run';
}

function formatRecentTimestamp(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : 'No activity yet';
}

function formatPolicyState(
  value: boolean | undefined,
  labels: { enabled: string; disabled: string; inherit: string },
): string {
  if (value === true) return labels.enabled;
  if (value === false) return labels.disabled;
  return labels.inherit;
}

function matchesFlowFilter(
  filter: FlowFilter,
  flow: {
    publishedVersion?: number | null;
    latestRun?: { status: string } | null;
  },
): boolean {
  switch (filter) {
    case 'published':
      return !!flow.publishedVersion;
    case 'drafts':
      return !flow.publishedVersion;
    case 'attention':
      return flow.latestRun?.status === 'failed' || (!flow.latestRun && !!flow.publishedVersion);
    case 'never-run':
      return !flow.latestRun;
    default:
      return true;
  }
}

export function WorkspacePanel() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const authStatusQuery = trpc.auth.status.useQuery();
  const workspaceQuery = trpc.workspaces.current.useQuery();
  const membersQuery = trpc.workspaces.members.useQuery();
  const invitesQuery = trpc.workspaces.invites.useQuery();
  const auditQuery = trpc.workspaces.audit.useQuery();
  const flowsQuery = trpc.flows.list.useQuery();

  const [search, setSearch] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [createPromptOpen, setCreatePromptOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [openingFlowId, setOpeningFlowId] = useState<string | null>(null);
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);
  const [duplicatingFlowId, setDuplicatingFlowId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all');
  const [inviteDraft, setInviteDraft] = useState({
    email: '',
    role: 'member' as 'owner' | 'admin' | 'member',
  });
  const [lastInviteDelivery, setLastInviteDelivery] = useState<{
    token?: string;
    previewUrl?: string;
    deliveryMode: 'outbox' | 'webhook';
    email: string;
  } | null>(null);

  const currentWorkspace = workspaceQuery.data?.current;
  const workspaceRole = currentWorkspace?.role ?? 'member';
  const authDisabled = authStatusQuery.data?.authMode === 'disabled';
  const flows = flowsQuery.data ?? [];
  const members = membersQuery.data?.members ?? [];
  const invites = invitesQuery.data?.invites ?? [];
  const activity = auditQuery.data ?? [];
  const memberPermissions = membersQuery.data?.permissions;
  const canManageFlows = workspaceRole === 'owner' || workspaceRole === 'admin';

  const filteredFlows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return flows.filter((flow) => {
      if (!matchesFlowFilter(flowFilter, flow)) return false;
      return query ? flow.name.toLowerCase().includes(query) : true;
    });
  }, [flowFilter, flows, search]);

  const flowFilterCounts = useMemo(
    () => ({
      all: flows.length,
      published: flows.filter((flow) => !!flow.publishedVersion).length,
      drafts: flows.filter((flow) => !flow.publishedVersion).length,
      attention: flows.filter(
        (flow) =>
          flow.latestRun?.status === 'failed' || (!flow.latestRun && !!flow.publishedVersion),
      ).length,
      'never-run': flows.filter((flow) => !flow.latestRun).length,
    }),
    [flows],
  );

  const memberRoleCounts = useMemo(
    () => ({
      owners: members.filter((member) => member.role === 'owner').length,
      admins: members.filter((member) => member.role === 'admin').length,
      members: members.filter((member) => member.role === 'member').length,
    }),
    [members],
  );

  const execPolicySummary = useMemo(() => {
    const policy = currentWorkspace?.execPolicy ?? {};
    return [
      {
        label: 'Exec availability',
        value: formatPolicyState(policy.enabled, {
          enabled: 'Allowed',
          disabled: 'Blocked',
          inherit: 'Inherit adapter default',
        }),
      },
      {
        label: 'Trusted mode',
        value: formatPolicyState(policy.allowTrusted, {
          enabled: 'Allowed',
          disabled: 'Blocked',
          inherit: 'Inherit adapter default',
        }),
      },
      {
        label: 'Require elevated',
        value: formatPolicyState(policy.allowElevated, {
          enabled: 'Allowed',
          disabled: 'Blocked',
          inherit: 'Inherit adapter default',
        }),
      },
      {
        label: 'Prefix restrictions',
        value: String(
          (policy.allowedCommandPrefixes?.length ?? 0) +
            (policy.trustedCommandPrefixes?.length ?? 0) +
            (policy.elevatedCommandPrefixes?.length ?? 0),
        ),
      },
      {
        label: 'Family restrictions',
        value: String(
          (policy.allowedCommandFamilies?.length ?? 0) +
            (policy.trustedCommandFamilies?.length ?? 0) +
            (policy.elevatedCommandFamilies?.length ?? 0),
        ),
      },
    ];
  }, [currentWorkspace?.execPolicy]);

  const createFlowMutation = trpc.flows.create.useMutation({
    onError(error) {
      notify({
        tone: 'error',
        title: 'Flow create failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });
  const renameFlowMutation = trpc.flows.update.useMutation({
    onSuccess(updatedFlow) {
      void utils.flows.list.invalidate();
      notify({
        tone: 'success',
        title: 'Flow renamed',
        message: `This flow is now called "${updatedFlow.name}".`,
      });
    },
    onError(error) {
      notify({ tone: 'error', title: 'Rename failed', message: error.message, durationMs: 6000 });
    },
  });
  const duplicateFlowMutation = trpc.flows.create.useMutation({
    onError(error) {
      notify({
        tone: 'error',
        title: 'Duplicate failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });
  const deleteFlowMutation = trpc.flows.delete.useMutation({
    onSuccess() {
      void utils.flows.list.invalidate();
      notify({
        tone: 'success',
        title: 'Flow deleted',
        message: 'The flow has been removed from this workspace.',
      });
    },
    onError(error) {
      notify({ tone: 'error', title: 'Delete failed', message: error.message, durationMs: 6000 });
    },
  });
  const startManualRunMutation = trpc.runs.startManual.useMutation();
  const startWebhookRunMutation = trpc.runs.startWebhook.useMutation();
  const startChannelRunMutation = trpc.runs.startChannel.useMutation();
  const startCronRunMutation = trpc.runs.startCron.useMutation();
  const startHookRunMutation = trpc.runs.startHook.useMutation();
  const startTaskRunMutation = trpc.runs.startTask.useMutation();
  const startStandingOrderRunMutation = trpc.runs.startStandingOrder.useMutation();
  const createInviteMutation = trpc.workspaces.createInvite.useMutation({
    onSuccess(result) {
      setLastInviteDelivery({
        token: result.token ?? undefined,
        previewUrl: result.previewUrl ?? undefined,
        deliveryMode: result.deliveryMode,
        email: result.invite.email,
      });
      setInviteDraft({ email: '', role: 'member' });
      void Promise.all([invitesQuery.refetch(), auditQuery.refetch(), membersQuery.refetch()]);
      notify({
        tone: 'success',
        title: 'Invite created',
        message:
          result.deliveryMode === 'outbox'
            ? `Invite email prepared for ${result.invite.email}.`
            : `Invite email sent to ${result.invite.email}.`,
      });
    },
    onError(error) {
      notify({ tone: 'error', title: 'Invite failed', message: error.message, durationMs: 6000 });
    },
  });
  const revokeInviteMutation = trpc.workspaces.revokeInvite.useMutation({
    onSuccess() {
      void Promise.all([invitesQuery.refetch(), auditQuery.refetch()]);
      notify({
        tone: 'success',
        title: 'Invite revoked',
        message: 'The invite can no longer be used.',
      });
    },
    onError(error) {
      notify({ tone: 'error', title: 'Revoke failed', message: error.message, durationMs: 6000 });
    },
  });

  function openBuilderForFlow(
    flowId: string,
    options?: { tab?: 'configure' | 'runs'; runId?: string },
  ) {
    saveLastFlowId(flowId);
    const searchParams = new URLSearchParams({ flow: flowId });
    if (options?.tab) searchParams.set('tab', options.tab);
    if (options?.runId) searchParams.set('run', options.runId);
    router.push(`/builder?${searchParams.toString()}`);
  }

  async function handleCreateFlow(values: Record<string, string>) {
    setCreatePromptOpen(false);
    const name = values.name?.trim();
    if (!name) return;

    const created = await createFlowMutation.mutateAsync({ name, nodes: [], edges: [] });
    await utils.flows.list.invalidate();
    notify({
      tone: 'success',
      title: 'Flow created',
      message: `${created.name} is ready in the builder.`,
    });
    openBuilderForFlow(created.id);
  }

  async function handleRenameFlow(values: Record<string, string>) {
    const target = renameTarget;
    setRenameTarget(null);
    const nextName = values.name?.trim();
    if (!target || !nextName || nextName === target.name) return;
    await renameFlowMutation.mutateAsync({ id: target.id, name: nextName });
  }

  async function handleOpenFlow(flowId: string) {
    setOpeningFlowId(flowId);
    try {
      await utils.flows.get.fetch({ id: flowId });
      openBuilderForFlow(flowId);
    } catch (error) {
      notify({
        tone: 'error',
        title: 'Open failed',
        message: error instanceof Error ? error.message : String(error),
        durationMs: 6000,
      });
    } finally {
      setOpeningFlowId(null);
    }
  }

  function handleOpenLatestRun(flowId: string, runId: string) {
    openBuilderForFlow(flowId, { tab: 'runs', runId });
  }

  async function launchWorkspaceRun(flowId: string, flowName: string) {
    const flow = await utils.flows.get.fetch({ id: flowId });
    const triggerPlan = buildTriggerPlan(flow.nodes, flow.name);

    switch (triggerPlan.kind) {
      case 'webhook':
        return startWebhookRunMutation.mutateAsync({
          flowId,
          eventName: triggerPlan.eventName,
          input: triggerPlan.payload,
          label: `Workspace ${triggerPlan.title.toLowerCase()}`,
          sourceId: 'workspace-panel:webhook',
        });
      case 'channel':
        if (!triggerPlan.channel) {
          throw new Error(`Missing channel configuration for ${flowName}.`);
        }
        return startChannelRunMutation.mutateAsync({
          flowId,
          channel: triggerPlan.channel,
          routeKey: triggerPlan.routeKey,
          accountId: triggerPlan.accountId,
          input: triggerPlan.payload,
          label: `Workspace ${triggerPlan.title.toLowerCase()}`,
          sourceId: 'workspace-panel:channel',
        });
      case 'cron':
        if (!triggerPlan.schedule) {
          throw new Error(`Missing cron schedule for ${flowName}.`);
        }
        return startCronRunMutation.mutateAsync({
          flowId,
          schedule: triggerPlan.schedule,
          timezone: triggerPlan.timezone,
          input: triggerPlan.payload,
          label: `Workspace ${triggerPlan.title.toLowerCase()}`,
          sourceId: 'workspace-panel:cron',
        });
      case 'hook':
        if (!triggerPlan.hookName) {
          throw new Error(`Missing hook name for ${flowName}.`);
        }
        return startHookRunMutation.mutateAsync({
          flowId,
          hookName: triggerPlan.hookName,
          filter: triggerPlan.filter,
          input: triggerPlan.payload,
          label: `Workspace ${triggerPlan.title.toLowerCase()}`,
          sourceId: 'workspace-panel:hook',
        });
      case 'task':
        if (!triggerPlan.taskType) {
          throw new Error(`Missing task type for ${flowName}.`);
        }
        return startTaskRunMutation.mutateAsync({
          flowId,
          taskType: triggerPlan.taskType,
          taskQueue: triggerPlan.taskQueue,
          taskPriority: triggerPlan.taskPriority,
          input: triggerPlan.payload,
          label: `Workspace ${triggerPlan.title.toLowerCase()}`,
          sourceId: 'workspace-panel:task',
        });
      case 'standing-order':
        if (!triggerPlan.standingOrderKey) {
          throw new Error(`Missing standing order key for ${flowName}.`);
        }
        return startStandingOrderRunMutation.mutateAsync({
          flowId,
          standingOrderKey: triggerPlan.standingOrderKey,
          standingOrderScope: triggerPlan.standingOrderScope,
          input: triggerPlan.payload,
          label: `Workspace ${triggerPlan.title.toLowerCase()}`,
          sourceId: 'workspace-panel:standing-order',
        });
      default:
        return startManualRunMutation.mutateAsync({
          flowId,
          label: 'Workspace run',
          sourceId: 'workspace-panel:manual',
          input: {
            source: 'workspace-panel',
            startedAt: new Date().toISOString(),
            flowName,
          },
        });
    }
  }

  async function handleRunNow(flowId: string, flowName: string) {
    setRunningFlowId(flowId);
    try {
      const run = await launchWorkspaceRun(flowId, flowName);
      await Promise.all([
        utils.flows.list.invalidate(),
        utils.runs.list.invalidate({ flowId, limit: 25 }),
      ]);
      notify({
        tone: 'success',
        title: 'Run started',
        message: `${flowName} is now running.`,
      });
      openBuilderForFlow(flowId, { tab: 'runs', runId: run.id });
    } catch (error) {
      notify({
        tone: 'error',
        title: 'Run failed',
        message: error instanceof Error ? error.message : String(error),
        durationMs: 6000,
      });
    } finally {
      setRunningFlowId(null);
    }
  }

  async function handleDuplicateFlow(flowId: string) {
    setDuplicatingFlowId(flowId);
    try {
      const flow = await utils.flows.get.fetch({ id: flowId });
      const duplicated = await duplicateFlowMutation.mutateAsync({
        name: `${flow.name} (copy)`,
        nodes: flow.nodes,
        edges: flow.edges,
      });
      await utils.flows.list.invalidate();
      notify({
        tone: 'success',
        title: 'Flow duplicated',
        message: `${duplicated.name} was added to this workspace.`,
      });
    } catch (error) {
      notify({
        tone: 'error',
        title: 'Duplicate failed',
        message: error instanceof Error ? error.message : String(error),
        durationMs: 6000,
      });
    } finally {
      setDuplicatingFlowId(null);
    }
  }

  if (
    workspaceQuery.isLoading ||
    flowsQuery.isLoading ||
    membersQuery.isLoading ||
    invitesQuery.isLoading ||
    auditQuery.isLoading
  ) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-gray-500">
          Loading workspace control panel...
        </div>
      </main>
    );
  }

  if (
    workspaceQuery.isError ||
    flowsQuery.isError ||
    membersQuery.isError ||
    invitesQuery.isError ||
    auditQuery.isError ||
    !currentWorkspace
  ) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          {workspaceQuery.error?.message ??
            flowsQuery.error?.message ??
            membersQuery.error?.message ??
            invitesQuery.error?.message ??
            auditQuery.error?.message ??
            'Unable to load workspace details.'}
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                    Workspace Control Plane
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-[var(--color-fg)]">
                    {currentWorkspace.name}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-gray-500">
                    Manage flows, team access, invite state, workspace policy, and recent activity
                    from one place.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setCreatePromptOpen(true)}>
                    <FilePlus2 className="h-3.5 w-3.5" strokeWidth={2} />
                    New flow
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => router.push('/builder')}>
                    <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
                    Open builder
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
                    <Shield className="h-3.5 w-3.5" strokeWidth={2} />
                    Full settings
                  </Button>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <div className={`rounded-2xl border px-4 py-4 ${toneClasses('blue')}`}>
                  <div className="text-xs font-medium uppercase tracking-[0.16em] opacity-70">
                    Workspace
                  </div>
                  <div className="mt-3 text-lg font-semibold">{currentWorkspace.slug}</div>
                  <p className="mt-1 text-xs opacity-80">Role: {currentWorkspace.role}</p>
                </div>
                <div className={`rounded-2xl border px-4 py-4 ${toneClasses('green')}`}>
                  <div className="text-xs font-medium uppercase tracking-[0.16em] opacity-70">
                    Flows
                  </div>
                  <div className="mt-3 text-3xl font-semibold">{flows.length}</div>
                  <p className="mt-1 text-xs opacity-80">
                    {flows.filter((flow) => flow.publishedVersion).length} published,{' '}
                    {flows.filter((flow) => !flow.latestRun).length} never run
                  </p>
                </div>
                <div className={`rounded-2xl border px-4 py-4 ${toneClasses('amber')}`}>
                  <div className="text-xs font-medium uppercase tracking-[0.16em] opacity-70">
                    Team & Invites
                  </div>
                  <div className="mt-3 text-3xl font-semibold">{members.length}</div>
                  <p className="mt-1 text-xs opacity-80">
                    {authDisabled ? 'Local mode active' : `${invites.length} active invites`}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <FileText className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                Deployment Documentation
              </div>
              <div className="mt-4 space-y-3 text-sm text-gray-600">
                <p>
                  Follow a clear, user-friendly guide for deploying OpenClaw on a VPS, keeping the
                  gateway private, and connecting this wrapper with the right gateway token.
                </p>
                <p>
                  The guide explains the <strong>why</strong> behind each step, so users understand
                  what should stay private, what belongs in the adapter, and how to verify the
                  setup safely.
                </p>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  onClick={() => router.push('/workspace/openclaw-vps')}
                  className="min-w-[170px]"
                >
                  <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                  Open setup guide
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push('/builder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
                  Back to builder
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-[var(--color-fg)]">Workspace Flows</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Search, filter, run, and open the right flow from one operational queue.
                </p>
              </div>

              <div className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={2} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search flows..."
                  className="w-full bg-transparent text-sm text-[var(--color-fg)] outline-none placeholder:text-gray-400"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-[var(--color-border)] px-6 py-4">
              {(
                [
                  ['all', 'All flows'],
                  ['published', 'Published'],
                  ['drafts', 'Drafts'],
                  ['attention', 'Needs attention'],
                  ['never-run', 'Never run'],
                ] as const satisfies ReadonlyArray<[FlowFilter, string]>
              ).map(([value, label]) => {
                const active = flowFilter === value;
                const count = flowFilterCounts[value];
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFlowFilter(value)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-500 hover:text-[var(--color-fg)]'
                    }`}
                  >
                    <span>{label}</span>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-current">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 overflow-auto">
              {filteredFlows.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                    <GitBranch className="h-6 w-6" strokeWidth={1.7} />
                  </div>
                  <h4 className="mt-4 text-base font-semibold text-[var(--color-fg)]">
                    {search || flowFilter !== 'all' ? 'No matching flows' : 'No flows yet'}
                  </h4>
                  <p className="mt-2 text-sm text-gray-500">
                    {search || flowFilter !== 'all'
                      ? 'Try a different search term or change the active flow filter.'
                      : 'Create your first flow from this workspace, then open it in the builder to configure nodes and publish it.'}
                  </p>
                  {!search && flowFilter === 'all' && (
                    <div className="mx-auto mt-5 max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-4 text-left">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
                        <CircleDashed
                          className="h-3.5 w-3.5 text-[var(--color-accent)]"
                          strokeWidth={2}
                        />
                        Suggested first steps
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <p>1. Create a new flow with a clear name.</p>
                        <p>2. Open it in the builder and wire your trigger and actions.</p>
                        <p>3. Publish when the draft is ready to run.</p>
                      </div>
                    </div>
                  )}
                  {!search && flowFilter === 'all' && (
                    <div className="mt-5">
                      <Button size="sm" onClick={() => setCreatePromptOpen(true)}>
                        <FilePlus2 className="h-3.5 w-3.5" strokeWidth={2} />
                        Create first flow
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {filteredFlows.map((flow) => {
                    const isOpening = openingFlowId === flow.id;
                    const isRunning = runningFlowId === flow.id;
                    const isDuplicating = duplicatingFlowId === flow.id;
                    const isRenaming = renameTarget?.id === flow.id;
                    const latestRunStatus = flow.latestRun?.status;
                    const needsAttention =
                      latestRunStatus === 'failed' || (!flow.latestRun && !!flow.publishedVersion);

                    return (
                      <li
                        key={flow.id}
                        className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-start lg:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-base font-semibold text-[var(--color-fg)]">
                              {flow.name}
                            </div>
                            <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-gray-600">
                              Draft v{flow.version}
                            </span>
                            {flow.publishedVersion ? (
                              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                                Published v{flow.publishedVersion}
                              </span>
                            ) : (
                              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                                Draft only
                              </span>
                            )}
                            <span
                              className={`rounded-md border px-2 py-1 text-[11px] capitalize ${runStatusTone(latestRunStatus)}`}
                            >
                              {formatRunStatus(latestRunStatus)}
                            </span>
                            {needsAttention && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                                <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
                                Needs attention
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span>Updated {new Date(flow.updatedAt).toLocaleString()}</span>
                            <span>Created {new Date(flow.createdAt).toLocaleDateString()}</span>
                            <span>
                              Latest run{' '}
                              {flow.latestRun
                                ? formatRecentTimestamp(
                                    flow.latestRun.finishedAt ?? flow.latestRun.createdAt,
                                  )
                                : 'has not happened yet'}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 lg:justify-end">
                          <Button
                            size="sm"
                            disabled={!flow.publishedVersion}
                            loading={isRunning}
                            onClick={() => void handleRunNow(flow.id, flow.name)}
                          >
                            {!isRunning && <Play className="h-3.5 w-3.5" strokeWidth={2} />}
                            Run now
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!flow.latestRun}
                            onClick={() =>
                              flow.latestRun && handleOpenLatestRun(flow.id, flow.latestRun.id)
                            }
                          >
                            <Activity className="h-3.5 w-3.5" strokeWidth={2} />
                            Latest run
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            loading={isOpening}
                            onClick={() => void handleOpenFlow(flow.id)}
                          >
                            {!isOpening && <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />}
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={isRenaming && renameFlowMutation.isPending}
                            onClick={() => setRenameTarget({ id: flow.id, name: flow.name })}
                          >
                            {!isRenaming && <PencilLine className="h-3.5 w-3.5" strokeWidth={2} />}
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={isDuplicating}
                            onClick={() => void handleDuplicateFlow(flow.id)}
                          >
                            {!isDuplicating && <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
                            Duplicate
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={!canManageFlows || deleteFlowMutation.isPending}
                            onClick={() =>
                              setPendingConfirm({
                                title: 'Delete flow',
                                message: `Delete "${flow.name}"? This cannot be undone.`,
                                confirmLabel: 'Delete',
                                onConfirm: () => deleteFlowMutation.mutate({ id: flow.id }),
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                            Delete
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Users className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Team Access
                </div>
                <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
                  <Shield className="h-3.5 w-3.5" strokeWidth={2} />
                  Manage
                </Button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-gray-400">Owners</div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--color-fg)]">
                    {memberRoleCounts.owners}
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-gray-400">Admins</div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--color-fg)]">
                    {memberRoleCounts.admins}
                  </div>
                </div>
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.14em] text-gray-400">Members</div>
                  <div className="mt-2 text-2xl font-semibold text-[var(--color-fg)]">
                    {memberRoleCounts.members}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {members.map((member) => (
                  <div
                    key={member.user.id}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                          {member.user.name}
                        </div>
                        <div className="truncate text-xs text-gray-400">{member.user.email}</div>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-1 text-[11px] capitalize ${roleTone(member.role)}`}
                      >
                        {member.role}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Shield className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Exec Policy Summary
                </div>
                <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
                  <Shield className="h-3.5 w-3.5" strokeWidth={2} />
                  Edit policy
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                {execPolicySummary.map((entry) => (
                  <div
                    key={entry.label}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="text-xs uppercase tracking-[0.14em] text-gray-400">
                      {entry.label}
                    </div>
                    <div className="mt-2 text-sm font-medium text-[var(--color-fg)]">
                      {entry.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
            {!authDisabled && (
              <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Ticket className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Invites
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Send a workspace invite or revoke an outstanding one without leaving the page.
                </p>

                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_auto]">
                  <input
                    value={inviteDraft.email}
                    onChange={(event) =>
                      setInviteDraft((current) => ({ ...current, email: event.target.value }))
                    }
                    className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                    placeholder="teammate@example.com"
                  />
                  <select
                    value={inviteDraft.role}
                    onChange={(event) =>
                      setInviteDraft((current) => ({
                        ...current,
                        role: event.target.value as 'owner' | 'admin' | 'member',
                      }))
                    }
                    className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                    disabled={!memberPermissions?.canManageMembers}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                  <Button
                    disabled={
                      !memberPermissions?.canManageMembers ||
                      inviteDraft.email.trim().length === 0 ||
                      createInviteMutation.isPending
                    }
                    onClick={() =>
                      createInviteMutation.mutate({
                        email: inviteDraft.email.trim(),
                        role: inviteDraft.role,
                      })
                    }
                  >
                    <MailPlus className="h-3.5 w-3.5" strokeWidth={2} />
                    {createInviteMutation.isPending ? 'Creating...' : 'Invite'}
                  </Button>
                </div>

                {lastInviteDelivery && (
                  <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                    <div className="font-medium">Latest invite for {lastInviteDelivery.email}</div>
                    <div className="mt-1 text-xs text-indigo-700">
                      {lastInviteDelivery.deliveryMode === 'outbox'
                        ? 'Prepared in dev outbox mode.'
                        : 'Sent using the configured delivery hook.'}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {lastInviteDelivery.previewUrl && (
                        <a
                          href={lastInviteDelivery.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-medium text-indigo-900 transition hover:bg-indigo-100"
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
                          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                          Copy token
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 space-y-3">
                  {invites.length === 0 ? (
                    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4 text-sm text-gray-500">
                      No active invites right now.
                    </div>
                  ) : (
                    invites.map((invite) => (
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
                              {invite.role} · expires {new Date(invite.expiresAt).toLocaleString()}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={
                              !memberPermissions?.canManageMembers || revokeInviteMutation.isPending
                            }
                            onClick={() => revokeInviteMutation.mutate({ inviteId: invite.id })}
                          >
                            Revoke
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            <div
              className={`rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm ${authDisabled ? 'xl:col-span-2' : ''}`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <Activity className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                Recent Activity
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Track recent workspace-level changes like members, invites, and policy updates.
              </p>

              <div className="mt-4 space-y-3">
                {activity.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4 text-sm text-gray-500">
                    No workspace activity has been recorded yet.
                  </div>
                ) : (
                  activity.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-[var(--color-fg)]">
                            {event.summary}
                          </div>
                          <div className="mt-1 text-xs text-gray-400">
                            {event.actorUser ? `${event.actorUser.name} · ` : ''}
                            {new Date(event.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <span className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-gray-500">
                          {event.eventType}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </main>

      <PromptDialog
        open={createPromptOpen}
        title="New flow"
        description="Create a draft flow in this workspace and open it in the builder."
        fields={[{ key: 'name', label: 'Flow name', placeholder: 'Customer support triage' }]}
        confirmLabel={createFlowMutation.isPending ? 'Creating...' : 'Create flow'}
        onConfirm={handleCreateFlow}
        onCancel={() => setCreatePromptOpen(false)}
      />

      <PromptDialog
        open={renameTarget !== null}
        title="Rename flow"
        description="Give this flow a clearer name so it is easier to find from the workspace panel."
        fields={[
          {
            key: 'name',
            label: 'Flow name',
            placeholder: 'Customer support triage',
            defaultValue: renameTarget?.name ?? '',
          },
        ]}
        confirmLabel={renameFlowMutation.isPending ? 'Renaming...' : 'Rename flow'}
        onConfirm={handleRenameFlow}
        onCancel={() => setRenameTarget(null)}
      />

      {pendingConfirm && (
        <ConfirmDialog
          open
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          variant="danger"
          onConfirm={() => {
            pendingConfirm.onConfirm();
            setPendingConfirm(null);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      <WorkspaceMembersPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
