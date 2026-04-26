'use client';

import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import {
  Activity,
  Bot,
  Cable,
  Check,
  Code2,
  Copy,
  Database,
  GitBranch,
  Info,
  LogOut,
  Play,
  PlayCircle,
  QrCode,
  RefreshCcw,
  Server,
  ShieldAlert,
  Smartphone,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

function metricCardTone(accent: 'blue' | 'green' | 'amber' | 'red' | 'slate') {
  switch (accent) {
    case 'blue':
      return 'border-sky-200 bg-sky-50 text-sky-900';
    case 'green':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'red':
      return 'border-rose-200 bg-rose-50 text-rose-900';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]';
  }
}

function gatewayTone(state: string | undefined) {
  switch (state) {
    case 'connected':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case 'pairing_required':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'unreachable':
      return 'border-rose-200 bg-rose-50 text-rose-900';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]';
  }
}

function runStatusTone(status: string) {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-900';
    case 'running':
      return 'border-sky-200 bg-sky-50 text-sky-900';
    case 'waiting':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface)] text-gray-600';
  }
}

function channelRuntimeTone(channel: {
  connected: boolean;
  configured: boolean;
  available: boolean;
}) {
  if (channel.connected) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
  if (channel.configured) {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  if (channel.available) {
    return 'border-sky-200 bg-sky-50 text-sky-900';
  }
  return 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)]';
}

function runtimeAccountTone(account: {
  connected?: boolean;
  running?: boolean;
  configured?: boolean;
}) {
  if (account.connected || account.running) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (account.configured) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-[var(--color-border)] bg-[var(--color-surface)] text-gray-600';
}

function channelOperationTone(
  runtime: {
    connected?: boolean;
    configured?: boolean;
  } | null,
): string {
  if (runtime?.connected) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-950';
  }
  if (runtime?.configured) {
    return 'border-amber-200 bg-amber-50 text-amber-950';
  }
  return 'border-slate-200 bg-slate-50 text-slate-900';
}

function formatDateTime(value: string | undefined) {
  if (!value) {
    return '--';
  }
  return new Date(value).toLocaleString();
}

function quoteShellPath(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function buildPluginCompatInspectCommand(pluginPath: string): string {
  return `node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(p.openclawWrapper?.compat ?? {}, null, 2));" ${quoteShellPath(pluginPath)}`;
}

function buildPluginNodesInspectCommand(pluginPath: string): string {
  return `node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(p.openclawWrapper?.nodes ?? [], null, 2));" ${quoteShellPath(pluginPath)}`;
}

function buildPluginManifestInspectCommand(pluginPath: string): string {
  return `node -e "const fs=require('node:fs');console.log(fs.readFileSync(process.argv[1],'utf8'));" ${quoteShellPath(pluginPath)}`;
}

function pluginIssueTone(code: string): string {
  if (code.includes('unsupported') || code.includes('incompatible') || code.includes('reserved')) {
    return 'border-rose-200 bg-rose-50 text-rose-900';
  }
  if (code.includes('duplicate') || code.includes('invalid') || code.includes('missing')) {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-fg)]';
}

export function OpsWorkspace() {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.ops.overview.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const channelCatalogQuery = trpc.channels.catalog.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const profilesQuery = trpc.channels.list.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const [pairingStateByProfile, setPairingStateByProfile] = useState<
    Record<
      string,
      {
        message?: string;
        qrDataUrl?: string;
        connected?: boolean;
      }
    >
  >({});

  const templates = channelCatalogQuery.data?.templates ?? [];
  const templatesById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );
  const operationalProfiles = useMemo(() => {
    return (profilesQuery.data ?? [])
      .map((profile) => ({
        profile,
        template: templatesById.get(profile.templateId),
      }))
      .filter(({ profile, template }) => {
        return profile.runtime || profile.appliedAt || template?.pairingMode === 'qr';
      })
      .sort((left, right) => {
        const preferredDelta =
          Number(Boolean(right.profile.appliedAt)) - Number(Boolean(left.profile.appliedAt));
        if (preferredDelta !== 0) {
          return preferredDelta;
        }

        const connectedDelta =
          Number(Boolean(left.profile.runtime?.connected)) -
          Number(Boolean(right.profile.runtime?.connected));
        if (connectedDelta !== 0) {
          return connectedDelta;
        }

        return left.profile.name.localeCompare(right.profile.name);
      });
  }, [profilesQuery.data, templatesById]);

  async function refreshRuntimeSurfaces() {
    await Promise.allSettled([
      utils.ops.overview.invalidate(),
      utils.channels.catalog.invalidate(),
      utils.channels.list.invalidate(),
    ]);
    await Promise.allSettled([
      overviewQuery.refetch(),
      channelCatalogQuery.refetch(),
      profilesQuery.refetch(),
    ]);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify({ tone: 'success', title: 'Copied', message: `${label} copied.` });
    } catch {
      notify({ tone: 'error', title: 'Copy failed', message: 'Clipboard unavailable.' });
    }
  }

  const pairingStartMutation = trpc.channels.pairingStart.useMutation({
    onSuccess(result, variables) {
      setPairingStateByProfile((current) => ({
        ...current,
        [variables.id]: result,
      }));
      void refreshRuntimeSurfaces();
      notify({
        tone: 'success',
        title: 'Pairing started',
        message: result.message ?? 'Scan the QR code to finish setup.',
      });
    },
    onError(error, variables) {
      setPairingStateByProfile((current) => ({
        ...current,
        [variables.id]: {
          message: error.message,
          connected: false,
        },
      }));
      notify({
        tone: 'error',
        title: 'Pairing failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const pairingWaitMutation = trpc.channels.pairingWait.useMutation({
    onSuccess(result, variables) {
      setPairingStateByProfile((current) => ({
        ...current,
        [variables.id]: result,
      }));
      void refreshRuntimeSurfaces();
      notify({
        tone: result.connected ? 'success' : 'warning',
        title: result.connected ? 'Channel connected' : 'Still waiting',
        message: result.message ?? 'Waiting for the pairing flow to finish.',
      });
    },
    onError(error, variables) {
      setPairingStateByProfile((current) => ({
        ...current,
        [variables.id]: {
          message: error.message,
          connected: false,
        },
      }));
      notify({
        tone: 'error',
        title: 'Pairing wait failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const logoutMutation = trpc.channels.logout.useMutation({
    onSuccess(_result, variables) {
      setPairingStateByProfile((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      void refreshRuntimeSurfaces();
      notify({
        tone: 'success',
        title: 'Logged out',
        message: 'Channel session cleared.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Logout failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const approveDevicePairingMutation = trpc.ops.approveDevicePairing.useMutation({
    onSuccess(result) {
      void refreshRuntimeSurfaces();
      notify({
        tone: 'success',
        title: 'Device approved',
        message: `Approved runtime device ${result.deviceId}.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Device approval failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const rejectDevicePairingMutation = trpc.ops.rejectDevicePairing.useMutation({
    onSuccess(result) {
      void refreshRuntimeSurfaces();
      notify({
        tone: 'success',
        title: 'Device rejected',
        message: `Rejected runtime device ${result.deviceId}.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Device rejection failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const approveNodePairingMutation = trpc.ops.approveNodePairing.useMutation({
    onSuccess(result) {
      void refreshRuntimeSurfaces();
      notify({
        tone: 'success',
        title: 'Node approved',
        message: `Approved runtime node ${result.nodeId}.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Node approval failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const rejectNodePairingMutation = trpc.ops.rejectNodePairing.useMutation({
    onSuccess(result) {
      void refreshRuntimeSurfaces();
      notify({
        tone: 'success',
        title: 'Node rejected',
        message: `Rejected runtime node ${result.nodeId}.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Node rejection failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-gray-500">
          Loading operations overview...
        </div>
      </main>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          {overviewQuery.error?.message ?? 'Unable to load operations overview.'}
        </div>
      </main>
    );
  }

  const overview = overviewQuery.data;
  const canManageChannels =
    overview.workspace.role === 'owner' || overview.workspace.role === 'admin';
  const cards = [
    {
      label: 'Flows',
      value: String(overview.totals.flows),
      detail: `${overview.totals.publishedFlows} published`,
      icon: GitBranch,
      accent: 'blue' as const,
    },
    {
      label: 'Runs (24h)',
      value: String(overview.totals.runsLast24h),
      detail: `${overview.totals.runs} total runs`,
      icon: PlayCircle,
      accent: 'green' as const,
    },
    {
      label: 'Pending approvals',
      value: String(overview.totals.pendingApprovals),
      detail: `${overview.runStatusCounts.waiting} waiting runs`,
      icon: ShieldAlert,
      accent: overview.totals.pendingApprovals > 0 ? ('amber' as const) : ('slate' as const),
    },
    {
      label: 'Memory entries',
      value: String(overview.totals.memoryEntries),
      detail: `${overview.runtime.plugins.nodes} external nodes`,
      icon: Database,
      accent: 'slate' as const,
    },
    {
      label: 'Runtime channels',
      value: String(overview.runtime.channels.discovered),
      detail: `${overview.runtime.channels.connected} connected / ${overview.runtime.channels.profiles} profiles`,
      icon: Cable,
      accent:
        overview.runtime.channels.unmatchedProfiles > 0 ? ('amber' as const) : ('blue' as const),
    },
    {
      label: 'Runtime nodes',
      value: String(overview.runtime.nodes.paired),
      detail: `${overview.runtime.nodes.pending} pending / ${overview.runtime.devices.paired} devices paired`,
      icon: Server,
      accent:
        overview.runtime.nodes.pending > 0 || overview.runtime.devices.pending > 0
          ? ('amber' as const)
          : ('blue' as const),
    },
    {
      label: 'Members',
      value: String(overview.totals.members),
      detail: `${overview.totals.activeInvites} active invites`,
      icon: Users,
      accent: 'slate' as const,
    },
    {
      label: 'Plugins',
      value: String(overview.runtime.plugins.installed),
      detail: `${overview.runtime.plugins.issues} plugin issues`,
      icon: Bot,
      accent: overview.runtime.plugins.issues > 0 ? ('amber' as const) : ('blue' as const),
    },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  Workspace Ops
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--color-fg)]">
                  {overview.workspace.name}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-gray-500">
                  Monitor runtime health, queue pressure, recent activity, and the current workspace
                  control-plane state from one place.
                </p>
              </div>
              <div
                className={`rounded-2xl border px-4 py-3 text-right text-sm ${gatewayTone(overview.runtime.gateway.state)}`}
              >
                <div className="font-semibold">
                  Gateway {overview.runtime.gateway.ok ? 'connected' : 'attention needed'}
                </div>
                <div className="mt-1 text-xs opacity-80">
                  {overview.runtime.gateway.roundTripMs !== undefined
                    ? `${overview.runtime.gateway.roundTripMs} ms round trip`
                    : overview.runtime.gateway.state}
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {cards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.label}
                    className={`rounded-2xl border px-4 py-4 ${metricCardTone(card.accent)}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-[0.16em] opacity-70">
                        {card.label}
                      </span>
                      <Icon className="h-4 w-4 opacity-70" strokeWidth={2} />
                    </div>
                    <div className="mt-3 text-3xl font-semibold">{card.value}</div>
                    <p className="mt-1 text-xs opacity-80">{card.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <Activity className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
              Runtime Snapshot
            </div>

            <div className="mt-5 space-y-4 text-sm text-gray-600">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">Auth mode</div>
                <div className="mt-1 font-medium text-[var(--color-fg)]">{overview.authMode}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">Gateway</div>
                <div className="mt-1 font-medium text-[var(--color-fg)]">
                  {overview.runtime.gateway.message}
                </div>
                {overview.runtime.gateway.detail && (
                  <div className="mt-1 text-xs text-gray-500">
                    {overview.runtime.gateway.detail}
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">
                  Runtime topology
                </div>
                <div className="mt-1 font-medium text-[var(--color-fg)]">
                  {overview.runtime.devices.paired} paired devices / {overview.runtime.nodes.paired}{' '}
                  paired nodes
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {overview.runtime.devices.pending + overview.runtime.nodes.pending} pending
                  pairing requests
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">Plugins</div>
                <div className="mt-1 font-medium text-[var(--color-fg)]">
                  {overview.runtime.plugins.installed} installed / {overview.runtime.plugins.nodes}{' '}
                  nodes
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {overview.runtime.plugins.issues} discovery issues detected
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-gray-400">Run states</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(overview.runStatusCounts).map(([status, count]) => (
                    <div
                      key={status}
                      className={`rounded-xl border px-3 py-2 ${runStatusTone(status)}`}
                    >
                      <div className="font-semibold capitalize">{status}</div>
                      <div className="mt-1 text-lg">{count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.35fr_0.9fr]">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <Cable className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
              Runtime Channels And Devices
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Live channel runtimes and reported accounts are operational surfaces, separate from
              flow canvas nodes and wrapper-saved profiles.
            </p>

            <div className="mt-4 space-y-3">
              {overview.runtime.channels.inventory.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No runtime channels were discovered from the gateway yet.
                </p>
              ) : (
                overview.runtime.channels.inventory.map((channel) => (
                  <div
                    key={channel.channelType}
                    className={`rounded-2xl border px-4 py-4 ${channelRuntimeTone(channel)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {channel.label ?? channel.channelType}
                        </div>
                        <div className="mt-1 text-xs opacity-80">
                          {channel.detailLabel ?? channel.channelType}
                        </div>
                      </div>
                      <div className="text-right text-[11px] opacity-80">
                        <div>{channel.accountCount} accounts</div>
                        <div>{channel.connectedAccountCount} connected</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-md bg-white/70 px-2 py-1">
                        {channel.wrapperProfileCount} wrapper profiles
                      </span>
                      {channel.preferredProfileName && (
                        <span className="rounded-md bg-white/70 px-2 py-1">
                          Preferred: {channel.preferredProfileName}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {channel.accountInventory.length === 0 ? (
                        <span className="rounded-md border border-dashed border-current/30 px-2 py-1 text-[11px] opacity-80">
                          No accounts reported by the runtime
                        </span>
                      ) : (
                        channel.accountInventory.map((account) => (
                          <div
                            key={`${channel.channelType}:${account.accountId}`}
                            className={`rounded-xl border px-3 py-2 text-[11px] ${runtimeAccountTone(account)}`}
                          >
                            <div className="font-medium">{account.label ?? account.accountId}</div>
                            <div className="mt-1 opacity-80">
                              {account.profileNames.length > 0
                                ? `Profiles: ${account.profileNames.join(', ')}`
                                : 'No wrapper profile mapped'}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-[var(--color-fg)]">
              Unmatched Wrapper Profiles
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Saved wrapper profiles that do not currently match a live runtime channel or account.
            </p>

            <div className="mt-4 space-y-3">
              {overview.runtime.channels.unmatchedProfileInventory.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Every saved wrapper profile currently maps to a discovered runtime channel.
                </p>
              ) : (
                overview.runtime.channels.unmatchedProfileInventory.map((profile) => (
                  <div
                    key={profile.id}
                    className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                  >
                    <div className="font-medium">{profile.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-amber-700">
                      {profile.channelType}
                      {profile.accountId ? ` / ${profile.accountId}` : ''}
                    </div>
                    <div className="mt-2 text-[11px] text-amber-800">
                      {profile.appliedAt ? 'Preferred wrapper profile' : 'Saved wrapper profile'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.25fr_0.9fr_0.95fr]">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Cable className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Channel Operations
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  Pair, re-check, or log out channel sessions from Ops while keeping wrapper
                  profiles distinct from live gateway accounts.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void refreshRuntimeSurfaces()}>
                <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2} />
                Refresh
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              {profilesQuery.isLoading || channelCatalogQuery.isLoading ? (
                <p className="text-sm text-gray-500">Loading runtime operations...</p>
              ) : operationalProfiles.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No saved wrapper profiles are ready for runtime operations yet.
                </p>
              ) : (
                operationalProfiles.map(({ profile, template }) => {
                  const pairingState = pairingStateByProfile[profile.id];
                  const runtime = profile.runtime ?? null;
                  const pairingSupported = template?.pairingMode === 'qr';
                  return (
                    <div
                      key={profile.id}
                      className={`rounded-2xl border px-4 py-4 ${channelOperationTone(runtime)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{profile.name}</div>
                          <div className="mt-1 text-xs opacity-80">
                            {profile.channelType}
                            {profile.accountId ? ` / ${profile.accountId}` : ''}
                          </div>
                        </div>
                        <div className="text-right text-[11px] opacity-80">
                          <div>
                            {runtime?.connected
                              ? 'Connected'
                              : runtime?.configured
                                ? 'Configured'
                                : 'Unmatched'}
                          </div>
                          {profile.appliedAt && <div>Preferred in wrapper</div>}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-md bg-white/70 px-2 py-1">
                          {template?.label ?? profile.templateId}
                        </span>
                        {runtime?.label && (
                          <span className="rounded-md bg-white/70 px-2 py-1">
                            Runtime: {runtime.label}
                          </span>
                        )}
                        {pairingSupported && (
                          <span className="rounded-md bg-white/70 px-2 py-1">QR pairing</span>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {pairingSupported && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              loading={
                                pairingStartMutation.isPending &&
                                pairingStartMutation.variables?.id === profile.id
                              }
                              onClick={() =>
                                pairingStartMutation.mutate({ id: profile.id, force: true })
                              }
                              disabled={!canManageChannels || !runtime}
                            >
                              <QrCode className="h-3.5 w-3.5" strokeWidth={2} />
                              Start pairing
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              loading={
                                pairingWaitMutation.isPending &&
                                pairingWaitMutation.variables?.id === profile.id
                              }
                              onClick={() => pairingWaitMutation.mutate({ id: profile.id })}
                              disabled={!canManageChannels}
                            >
                              <Play className="h-3.5 w-3.5" strokeWidth={2} />
                              Check connect
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={
                            logoutMutation.isPending && logoutMutation.variables?.id === profile.id
                          }
                          onClick={() => logoutMutation.mutate({ id: profile.id })}
                          disabled={!canManageChannels}
                        >
                          <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
                          Logout
                        </Button>
                      </div>

                      {!runtime && (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          The gateway is not reporting a live runtime match for this profile yet.
                        </div>
                      )}

                      {pairingState?.qrDataUrl && (
                        <div className="mt-3 rounded-xl border border-white/70 bg-white p-3">
                          <img
                            src={pairingState.qrDataUrl}
                            alt={`Pairing QR for ${profile.name}`}
                            className="mx-auto max-h-48 rounded-lg"
                          />
                        </div>
                      )}

                      {pairingState?.message && (
                        <div
                          className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
                            pairingState.connected
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-amber-200 bg-amber-50 text-amber-800'
                          }`}
                        >
                          {pairingState.message}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <Smartphone className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
              Paired Devices
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Gateway-owned device identities are separate from wrapper channel profiles.
            </p>

            <div className="mt-4 space-y-3">
              {overview.runtime.devices.pendingInventory.map((device) => (
                <div
                  key={device.requestId}
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                >
                  <div className="font-medium">{device.displayName ?? device.deviceId}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-amber-700">
                    Pending pairing
                  </div>
                  <div className="mt-2 text-xs text-amber-900">
                    {device.platform ?? 'unknown platform'}
                    {device.deviceFamily ? ` / ${device.deviceFamily}` : ''}
                  </div>
                  {device.roles.length > 0 && (
                    <div className="mt-2 text-[11px] text-amber-800">
                      Roles: {device.roles.join(', ')}
                    </div>
                  )}
                  {device.scopes.length > 0 && (
                    <div className="mt-1 text-[11px] text-amber-800">
                      Scopes: {device.scopes.join(', ')}
                    </div>
                  )}
                  <div className="mt-2 text-[11px] text-amber-700">
                    Requested {formatDateTime(device.requestedAt)}
                  </div>
                  {canManageChannels && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
                        disabled={
                          approveDevicePairingMutation.isPending ||
                          rejectDevicePairingMutation.isPending
                        }
                        onClick={() =>
                          approveDevicePairingMutation.mutate({ requestId: device.requestId })
                        }
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-rose-200 text-rose-900 hover:bg-rose-100"
                        disabled={
                          approveDevicePairingMutation.isPending ||
                          rejectDevicePairingMutation.isPending
                        }
                        onClick={() =>
                          rejectDevicePairingMutation.mutate({ requestId: device.requestId })
                        }
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {overview.runtime.devices.inventory.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No paired runtime devices are visible from the gateway.
                </p>
              ) : (
                overview.runtime.devices.inventory.map((device) => (
                  <div
                    key={device.deviceId}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="text-sm font-medium text-[var(--color-fg)]">
                      {device.displayName ?? device.deviceId}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {device.platform ?? 'unknown platform'}
                      {device.deviceFamily ? ` / ${device.deviceFamily}` : ''}
                    </div>
                    {device.roles.length > 0 && (
                      <div className="mt-2 text-[11px] text-gray-600">
                        Roles: {device.roles.join(', ')}
                      </div>
                    )}
                    {device.approvedScopes.length > 0 && (
                      <div className="mt-1 text-[11px] text-gray-600">
                        Scopes: {device.approvedScopes.join(', ')}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] text-gray-500">
                      Approved {formatDateTime(device.approvedAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <Server className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
              Runtime Nodes
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Runtime nodes are gateway-side execution surfaces, not flow canvas nodes.
            </p>

            <div className="mt-4 space-y-3">
              {overview.runtime.nodes.pendingInventory.map((node) => (
                <div
                  key={node.requestId}
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                >
                  <div className="font-medium">{node.displayName ?? node.nodeId}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-amber-700">
                    Pending pairing
                  </div>
                  <div className="mt-2 text-xs text-amber-900">
                    {node.platform ?? 'unknown platform'}
                    {node.deviceFamily ? ` / ${node.deviceFamily}` : ''}
                  </div>
                  {node.requiredApproveScopes.length > 0 && (
                    <div className="mt-2 text-[11px] text-amber-800">
                      Scopes: {node.requiredApproveScopes.join(', ')}
                    </div>
                  )}
                  {node.commands.length > 0 && (
                    <div className="mt-1 text-[11px] text-amber-800">
                      Commands: {node.commands.join(', ')}
                    </div>
                  )}
                  <div className="mt-2 text-[11px] text-amber-700">
                    Requested {formatDateTime(node.requestedAt)}
                  </div>
                  {canManageChannels && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
                        disabled={
                          approveNodePairingMutation.isPending ||
                          rejectNodePairingMutation.isPending
                        }
                        onClick={() =>
                          approveNodePairingMutation.mutate({ requestId: node.requestId })
                        }
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-rose-200 text-rose-900 hover:bg-rose-100"
                        disabled={
                          approveNodePairingMutation.isPending ||
                          rejectNodePairingMutation.isPending
                        }
                        onClick={() =>
                          rejectNodePairingMutation.mutate({ requestId: node.requestId })
                        }
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {overview.runtime.nodes.inventory.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No paired runtime nodes are visible from the gateway.
                </p>
              ) : (
                overview.runtime.nodes.inventory.map((node) => (
                  <div
                    key={node.nodeId}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="text-sm font-medium text-[var(--color-fg)]">
                      {node.displayName ?? node.nodeId}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {node.platform ?? 'unknown platform'}
                      {node.deviceFamily ? ` / ${node.deviceFamily}` : ''}
                    </div>
                    {node.capabilities.length > 0 && (
                      <div className="mt-2 text-[11px] text-gray-600">
                        Capabilities: {node.capabilities.join(', ')}
                      </div>
                    )}
                    {node.commands.length > 0 && (
                      <div className="mt-1 text-[11px] text-gray-600">
                        Commands: {node.commands.join(', ')}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] text-gray-500">
                      Last connected {formatDateTime(node.lastConnectedAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <Code2 className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                Loaded Extensions
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void refreshRuntimeSurfaces()}>
                  <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2} />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void copyText(overview.runtime.plugins.host.pluginsDir, 'Plugin directory path')
                  }
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                  Copy dir
                </Button>
              </div>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Manifest-based external plugins discovered by the adapter plugin host.
            </p>

            <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-gray-600">
              <div className="font-medium text-[var(--color-fg)]">
                Host plugin API {overview.runtime.plugins.host.pluginApiVersion}
              </div>
              <div className="mt-1 text-xs">
                Adapter {overview.runtime.plugins.host.adapterVersion} / node-sdk{' '}
                {overview.runtime.plugins.host.nodeSdkVersion}
              </div>
              <div className="mt-2 break-all text-[11px] text-gray-500">
                Plugin directory: {overview.runtime.plugins.host.pluginsDir}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {overview.runtime.plugins.inventory.length === 0 ? (
                <p className="text-sm text-gray-500">No external plugins are currently loaded.</p>
              ) : (
                overview.runtime.plugins.inventory.map((plugin) => (
                  <div
                    key={plugin.packageJsonPath}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                          {plugin.displayName ?? plugin.name}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {plugin.name} / v{plugin.version}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-gray-500">
                        <div>{plugin.nodeCount} nodes</div>
                        <div>API {plugin.pluginApi}</div>
                      </div>
                    </div>

                    {plugin.description && (
                      <p className="mt-2 text-sm text-gray-600">{plugin.description}</p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      {plugin.minAdapterVersion && (
                        <span className="rounded-md bg-white px-2 py-1 text-gray-600">
                          Min adapter {plugin.minAdapterVersion}
                        </span>
                      )}
                      {plugin.nodeSdkVersion && (
                        <span className="rounded-md bg-white px-2 py-1 text-gray-600">
                          SDK {plugin.nodeSdkVersion}
                        </span>
                      )}
                      {plugin.builtWithAdapterVersion && (
                        <span className="rounded-md bg-white px-2 py-1 text-gray-600">
                          Built with {plugin.builtWithAdapterVersion}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {plugin.nodeTypes.map((nodeType) => (
                        <span
                          key={`${plugin.packageJsonPath}:${nodeType}`}
                          className="rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-[11px] text-gray-600"
                        >
                          {nodeType}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 break-all text-[11px] text-gray-500">
                      {plugin.packageJsonPath}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void copyText(plugin.packageJsonPath, 'Plugin manifest path')
                        }
                      >
                        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                        Copy path
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void copyText(
                            buildPluginManifestInspectCommand(plugin.packageJsonPath),
                            'Manifest inspection command',
                          )
                        }
                      >
                        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                        Copy inspect cmd
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <Info className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                Extension Diagnostics
              </div>
              <Button size="sm" variant="outline" onClick={() => void refreshRuntimeSurfaces()}>
                <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2} />
                Refresh
              </Button>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Plugin validation and load failures captured by the adapter plugin host.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {overview.runtime.plugins.issueSummary.length === 0 ? (
                <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                  No extension issues detected
                </span>
              ) : (
                overview.runtime.plugins.issueSummary.map((issue) => (
                  <span
                    key={issue.code}
                    className={`rounded-md border px-2 py-1 text-[11px] ${pluginIssueTone(issue.code)}`}
                  >
                    {issue.code} x{issue.count}
                  </span>
                ))
              )}
            </div>

            <div className="mt-4 space-y-3">
              {overview.runtime.plugins.issueInventory.length === 0 ? (
                <p className="text-sm text-gray-500">
                  Every discovered plugin currently satisfies the host contract.
                </p>
              ) : (
                overview.runtime.plugins.issueInventory.map((issue, index) => (
                  <div
                    key={`${issue.pluginPath}:${issue.code}:${issue.fieldPath ?? index}`}
                    className={`rounded-2xl border px-4 py-3 ${pluginIssueTone(issue.code)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{issue.code}</div>
                        <div className="mt-1 break-all text-[11px] opacity-80">
                          {issue.pluginPath}
                        </div>
                      </div>
                      {issue.fieldPath && (
                        <span className="rounded-md bg-white/70 px-2 py-1 text-[10px]">
                          {issue.fieldPath}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 text-sm">{issue.message}</div>
                    {issue.hint && (
                      <div className="mt-2 text-xs opacity-80">Hint: {issue.hint}</div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void copyText(issue.pluginPath, 'Issue manifest path')}
                      >
                        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                        Copy path
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void copyText(
                            issue.code.includes('reserved') || issue.code.includes('duplicate')
                              ? buildPluginNodesInspectCommand(issue.pluginPath)
                              : issue.code.includes('plugin-api') ||
                                  issue.code.includes('adapter-version') ||
                                  issue.code.includes('node-sdk-version')
                                ? buildPluginCompatInspectCommand(issue.pluginPath)
                                : buildPluginManifestInspectCommand(issue.pluginPath),
                            'Issue inspection command',
                          )
                        }
                      >
                        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                        Copy inspect cmd
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-[var(--color-fg)]">Recent runs</h3>
            <div className="mt-4 space-y-3">
              {overview.recentRuns.length === 0 ? (
                <p className="text-sm text-gray-500">No runs recorded yet.</p>
              ) : (
                overview.recentRuns.map((run) => (
                  <div
                    key={run.id}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                          {run.flowName}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">{run.triggerLabel}</div>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${runStatusTone(run.status)}`}
                      >
                        {run.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                      <span>Created {formatDateTime(run.createdAt)}</span>
                      <span>Finished {formatDateTime(run.finishedAt)}</span>
                    </div>
                    {run.error && <div className="mt-2 text-xs text-rose-700">{run.error}</div>}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-[var(--color-fg)]">Pending approvals</h3>
            <div className="mt-4 space-y-3">
              {overview.pendingApprovals.length === 0 ? (
                <p className="text-sm text-gray-500">No pending approvals right now.</p>
              ) : (
                overview.pendingApprovals.map((approval) => (
                  <div
                    key={approval.id}
                    className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                  >
                    <div className="font-medium">{approval.flowName}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.14em] text-amber-700">
                      {approval.requestType} / {approval.approvalMode ?? 'manual'}
                    </div>
                    {approval.reason && (
                      <div className="mt-2 text-xs text-amber-900">{approval.reason}</div>
                    )}
                    {approval.command && (
                      <div className="mt-2 rounded-lg bg-white/70 px-2 py-1 font-mono text-[11px]">
                        {approval.command}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] text-amber-700">
                      Requested {formatDateTime(approval.requestedAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-[var(--color-fg)]">Recent activity</h3>
            <div className="mt-4 space-y-3">
              {overview.recentActivity.length === 0 ? (
                <p className="text-sm text-gray-500">No workspace activity yet.</p>
              ) : (
                overview.recentActivity.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="text-sm font-medium text-[var(--color-fg)]">
                      {event.summary}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {event.actorName ? `${event.actorName} / ` : ''}
                      {formatDateTime(event.createdAt)}
                    </div>
                    <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-gray-400">
                      {event.eventType}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
