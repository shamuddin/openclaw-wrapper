'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/ui/icon';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import type {
  ChannelProfile,
  ChannelProfileFieldDescriptor,
  ChannelProfileSummary,
  ChannelProfileTemplate,
  ChannelRuntimeStatus,
} from '@openclaw-wrapper/schemas';
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  Play,
  QrCode,
  RefreshCcw,
  Save,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const EMPTY_PROFILE_ID = '00000000-0000-0000-0000-000000000000';

interface EditableChannelProfile {
  id?: string;
  name: string;
  templateId: string;
  channelType: string;
  agentId: string;
  accountId: string;
  routeKey: string;
  defaultTarget: string;
  config: Record<string, unknown>;
  secretState: ChannelProfile['secretState'];
  secretInputs: Record<string, string>;
  appliedAt?: string;
}

interface TestSendState {
  to: string;
  message: string;
  threadId: string;
}

function trim(value: string): string {
  return value.trim();
}

function createDraft(template: ChannelProfileTemplate): EditableChannelProfile {
  return {
    name: '',
    templateId: template.id,
    channelType: template.channelType === 'custom' ? '' : template.channelType,
    agentId: '',
    accountId: '',
    routeKey: '',
    defaultTarget: '',
    config: { ...((template.defaults as Record<string, unknown> | undefined) ?? {}) },
    secretState: template.fields
      .filter((field) => field.type === 'password')
      .map((field) => ({ key: field.key, configured: false })),
    secretInputs: {},
  };
}

function draftFromProfile(profile: ChannelProfile): EditableChannelProfile {
  return {
    id: profile.id,
    name: profile.name,
    templateId: profile.templateId,
    channelType: profile.channelType,
    agentId: profile.agentId ?? '',
    accountId: profile.accountId ?? '',
    routeKey: profile.routeKey ?? '',
    defaultTarget: profile.defaultTarget ?? '',
    config: { ...profile.config },
    secretState: profile.secretState,
    secretInputs: {},
    appliedAt: profile.appliedAt,
  };
}

function statusTone(runtime: ChannelRuntimeStatus | undefined): {
  label: string;
  className: string;
} {
  if (!runtime) {
    return {
      label: 'Not discovered',
      className: 'border-slate-200 bg-slate-50 text-slate-600',
    };
  }
  if (runtime.connected) {
    return {
      label: 'Connected',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (runtime.configured) {
    return {
      label: 'Configured',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }
  return {
    label: 'Detected',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  };
}

function runtimeAccountTone(account: {
  connected?: boolean;
  running?: boolean;
  configured?: boolean;
}): string {
  if (account.connected || account.running) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (account.configured) {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-500';
}

function normalizeLookupValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function resolveRuntimeForDraft(
  runtimeChannels: ChannelRuntimeStatus[],
  channelType: string | undefined,
  accountId: string | undefined,
): {
  channelRuntime?: ChannelRuntimeStatus;
  exactRuntime?: ChannelRuntimeStatus;
} {
  const normalizedChannelType = normalizeLookupValue(channelType);
  const normalizedAccountId = normalizeLookupValue(accountId);
  const channelRuntime = runtimeChannels.find(
    (entry) => normalizeLookupValue(entry.channelType) === normalizedChannelType,
  );

  if (!channelRuntime) {
    return {};
  }

  if (!normalizedAccountId) {
    return {
      channelRuntime,
      exactRuntime: channelRuntime,
    };
  }

  const matchingAccount = channelRuntime.accounts.find(
    (account) => normalizeLookupValue(account.accountId) === normalizedAccountId,
  );
  if (!matchingAccount) {
    return { channelRuntime };
  }

  return {
    channelRuntime,
    exactRuntime: {
      ...channelRuntime,
      accounts: [matchingAccount],
      configured: matchingAccount.configured || matchingAccount.running,
      connected: matchingAccount.connected || matchingAccount.running,
    },
  };
}

function renderFieldDescription(field: ChannelProfileFieldDescriptor): string | null {
  return field.description ? field.description : null;
}

function readSecretPreview(
  secretState: ChannelProfile['secretState'],
  key: string,
): { configured: boolean; preview?: string } {
  return secretState.find((entry) => entry.key === key) ?? { configured: false };
}

export function ChannelsWorkspace() {
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.workspaces.current.useQuery();
  const catalogQuery = trpc.channels.catalog.useQuery(undefined, { refetchInterval: 10_000 });
  const listQuery = trpc.channels.list.useQuery(undefined, { refetchInterval: 10_000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableChannelProfile | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [pairingState, setPairingState] = useState<{
    message?: string;
    qrDataUrl?: string;
    connected?: boolean;
  } | null>(null);
  const [testSend, setTestSend] = useState<TestSendState>({
    to: '',
    message: 'Hello from OpenClaw Wrapper.',
    threadId: '',
  });

  const profileQuery = trpc.channels.get.useQuery(
    { id: selectedId ?? EMPTY_PROFILE_ID },
    { enabled: !!selectedId },
  );

  const templates = catalogQuery.data?.templates ?? [];
  const runtimeChannels = catalogQuery.data?.runtime ?? [];
  const profiles = listQuery.data ?? [];
  const templatesById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );
  const runtimeProfilesByChannel = useMemo(() => {
    const grouped = new Map<string, ChannelProfileSummary[]>();
    for (const profile of profiles) {
      const key = normalizeLookupValue(profile.channelType);
      const current = grouped.get(key) ?? [];
      current.push(profile);
      grouped.set(key, current);
    }
    return grouped;
  }, [profiles]);
  const selectedTemplate = draft ? templatesById.get(draft.templateId) : undefined;
  const workspaceRole = workspaceQuery.data?.current.role ?? 'member';
  const canManageChannels = workspaceRole === 'owner' || workspaceRole === 'admin';

  useEffect(() => {
    if (!templates.length) return;
    if (selectedId) return;
    if (draft) return;
    if (listQuery.data && listQuery.data.length > 0) {
      const firstProfile = listQuery.data[0];
      if (firstProfile) {
        setSelectedId((current) => current ?? firstProfile.id);
      }
      return;
    }
    const firstTemplate = templates[0];
    if (firstTemplate) {
      setDraft(createDraft(firstTemplate));
    }
  }, [draft, listQuery.data, selectedId, templates]);

  useEffect(() => {
    if (!selectedId) return;
    if (profileQuery.data) {
      setDraft(draftFromProfile(profileQuery.data));
      setPairingState(null);
    }
  }, [profileQuery.data, selectedId]);

  useEffect(() => {
    if (!draft) return;
    setTestSend((current) => ({
      ...current,
      to: current.to || draft.defaultTarget,
    }));
  }, [draft]);

  useEffect(() => {
    if (!selectedId || !listQuery.data) return;
    if (listQuery.data.some((profile) => profile.id === selectedId)) return;
    if (listQuery.data[0]) {
      setSelectedId(listQuery.data[0].id);
      setDraft(null);
      return;
    }
    setSelectedId(null);
    if (templates[0]) {
      setDraft(createDraft(templates[0]));
    }
  }, [listQuery.data, selectedId, templates]);

  const saveMutation = trpc.channels.save.useMutation({
    onSuccess(profile) {
      setSelectedId(profile.id);
      setDraft(draftFromProfile(profile));
      Promise.all([
        utils.channels.list.invalidate(),
        utils.channels.get.invalidate({ id: profile.id }),
        utils.channels.catalog.invalidate(),
        utils.nodes.catalog.invalidate(),
      ]).catch(() => undefined);
      notify({
        tone: 'success',
        title: 'Channel saved',
        message: `${profile.name} is ready in the wrapper.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Save failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const applyMutation = trpc.channels.applyProfile.useMutation({
    onSuccess(profile) {
      setDraft(draftFromProfile(profile));
      Promise.all([
        utils.channels.list.invalidate(),
        utils.channels.get.invalidate({ id: profile.id }),
        utils.nodes.catalog.invalidate(),
      ]).catch(() => undefined);
      notify({
        tone: 'success',
        title: 'Wrapper preference updated',
        message: `${profile.name} is now the wrapper-preferred profile for channel nodes.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Set preferred failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const deleteMutation = trpc.channels.delete.useMutation({
    onSuccess(_result, variables) {
      Promise.all([
        utils.channels.list.invalidate(),
        utils.channels.catalog.invalidate(),
        utils.nodes.catalog.invalidate(),
      ]).catch(() => undefined);
      if (variables.id === selectedId) {
        setSelectedId(null);
        setDraft(templates[0] ? createDraft(templates[0]) : null);
      }
      notify({ tone: 'success', title: 'Deleted', message: 'Channel profile removed.' });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Delete failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const pairingStartMutation = trpc.channels.pairingStart.useMutation({
    onSuccess(result) {
      setPairingState(result);
      notify({
        tone: 'success',
        title: 'Pairing started',
        message: result.message ?? 'Scan the QR code to finish setup.',
      });
      void catalogQuery.refetch();
    },
    onError(error) {
      setPairingState({
        message: error.message,
        connected: false,
      });
      notify({
        tone: 'error',
        title: 'Pairing failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const pairingWaitMutation = trpc.channels.pairingWait.useMutation({
    onSuccess(result) {
      setPairingState(result);
      void Promise.all([catalogQuery.refetch(), listQuery.refetch()]);
      notify({
        tone: result.connected ? 'success' : 'warning',
        title: result.connected ? 'Channel connected' : 'Still waiting',
        message: result.message ?? 'Waiting for the pairing flow to finish.',
      });
    },
    onError(error) {
      setPairingState({
        message: error.message,
        connected: false,
      });
      notify({
        tone: 'error',
        title: 'Pairing wait failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const logoutMutation = trpc.channels.logout.useMutation({
    onSuccess() {
      setPairingState(null);
      void Promise.all([catalogQuery.refetch(), listQuery.refetch()]);
      notify({ tone: 'success', title: 'Logged out', message: 'Channel session cleared.' });
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

  const testSendMutation = trpc.channels.testSend.useMutation({
    onSuccess(result) {
      notify({
        tone: 'success',
        title: 'Test message sent',
        message: `Delivered via ${result.delivery.channel}.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Test send failed',
        message: error.message,
        durationMs: 6_000,
      });
    },
  });

  const { channelRuntime: selectedChannelRuntime, exactRuntime: selectedRuntime } = useMemo(
    () => resolveRuntimeForDraft(runtimeChannels, draft?.channelType, draft?.accountId),
    [draft?.accountId, draft?.channelType, runtimeChannels],
  );

  function setDraftValue<K extends keyof EditableChannelProfile>(
    key: K,
    value: EditableChannelProfile[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function setConfigValue(key: string, value: unknown) {
    setDraft((current) =>
      current
        ? {
            ...current,
            config: {
              ...current.config,
              [key]: value,
            },
          }
        : current,
    );
  }

  function setSecretValue(key: string, value: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            secretInputs: {
              ...current.secretInputs,
              [key]: value,
            },
          }
        : current,
    );
  }

  function startNewProfile() {
    if (!templates[0]) return;
    setSelectedId(null);
    setPairingState(null);
    setDraft(createDraft(templates[0]));
  }

  function selectProfile(id: string) {
    setSelectedId(id);
    setDraft(null);
    setPairingState(null);
  }

  async function persistDraft(): Promise<ChannelProfile | null> {
    if (!draft) return null;
    const payload = {
      ...(draft.id ? { id: draft.id } : {}),
      name: trim(draft.name),
      templateId: draft.templateId,
      ...(trim(draft.channelType) ? { channelType: trim(draft.channelType) } : {}),
      ...(trim(draft.agentId) ? { agentId: trim(draft.agentId) } : {}),
      ...(trim(draft.accountId) ? { accountId: trim(draft.accountId) } : {}),
      ...(trim(draft.routeKey) ? { routeKey: trim(draft.routeKey) } : {}),
      ...(trim(draft.defaultTarget) ? { defaultTarget: trim(draft.defaultTarget) } : {}),
      config: draft.config,
      secrets: Object.fromEntries(
        Object.entries(draft.secretInputs).filter(([, value]) => trim(value).length > 0),
      ),
    };
    return saveMutation.mutateAsync(payload);
  }

  async function handleApply() {
    const saved = await persistDraft();
    if (!saved) return;
    await applyMutation.mutateAsync({ id: saved.id });
  }

  const saveDisabled =
    !draft ||
    trim(draft.name).length === 0 ||
    trim(draft.templateId).length === 0 ||
    (selectedTemplate?.channelType === 'custom' && trim(draft.channelType).length === 0) ||
    saveMutation.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)] lg:w-[280px] lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-fg)]">Channel profiles</p>
            <p className="text-xs text-gray-400">
              Wrapper-owned channel settings and runtime status.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={startNewProfile}
            disabled={!canManageChannels}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            New
          </Button>
        </div>

        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Runtime channels and devices
            </p>
            <Button
              size="iconSm"
              variant="ghost"
              onClick={() => {
                void Promise.all([catalogQuery.refetch(), listQuery.refetch()]);
              }}
            >
              <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2} />
            </Button>
          </div>
          <div className="space-y-2">
            {runtimeChannels.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-gray-400">
                No live channels discovered from the gateway yet.
              </div>
            )}
            {runtimeChannels.map((runtime) => {
              const tone = statusTone(runtime);
              const matchingProfiles =
                runtimeProfilesByChannel.get(normalizeLookupValue(runtime.channelType)) ?? [];
              const preferredProfile = matchingProfiles.find((profile) =>
                Boolean(profile.appliedAt),
              );
              return (
                <div
                  key={runtime.channelType}
                  className="rounded-xl border border-[var(--color-border)] px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-[var(--color-fg)]">
                        {runtime.label ?? runtime.channelType}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {runtime.detailLabel ?? runtime.channelType}
                      </p>
                    </div>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${tone.className}`}
                    >
                      {tone.label}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-gray-500">
                    <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5">
                      {runtime.accounts.length} accounts
                    </span>
                    <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5">
                      {matchingProfiles.length} wrapper profiles
                    </span>
                    {preferredProfile && (
                      <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5">
                        preferred: {preferredProfile.name}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {runtime.accounts.length > 0 ? (
                      runtime.accounts.map((account) => {
                        const profileNames = matchingProfiles
                          .filter((profile) => {
                            const profileAccountId = normalizeLookupValue(profile.accountId);
                            return (
                              !profileAccountId ||
                              profileAccountId === normalizeLookupValue(account.accountId)
                            );
                          })
                          .map((profile) => profile.name);
                        return (
                          <div
                            key={`${runtime.channelType}:${account.accountId}`}
                            className={`rounded-md border px-2 py-1 text-[10px] ${runtimeAccountTone(
                              account,
                            )}`}
                          >
                            <div className="font-medium">{account.label ?? account.accountId}</div>
                            <div className="mt-0.5 opacity-80">
                              {profileNames.length > 0
                                ? `profiles: ${profileNames.join(', ')}`
                                : 'no wrapper profile mapped'}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] text-gray-500">
                        no accounts reported
                      </span>
                    )}
                  </div>
                  {matchingProfiles.length > 0 && (
                    <div className="mt-2 text-[10px] text-gray-400">
                      Saved wrapper profiles stay local to this app; runtime accounts come from the
                      live gateway.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Sidebar search */}
        {listQuery.data && listQuery.data.length > 2 && (
          <div className="border-b border-[var(--color-border)] px-3 py-2">
            <input
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs text-[var(--color-fg)] outline-none placeholder:text-gray-400 focus:border-[var(--color-accent)]"
              placeholder="Search profiles…"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-2">
            {listQuery.isLoading && (
              <div className="px-2 py-2 text-xs text-gray-400">Loading channel profiles...</div>
            )}
            {!listQuery.isLoading && listQuery.data?.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-xs text-gray-400">
                Save a profile here, then use it from channel nodes in the builder.
              </div>
            )}
            {listQuery.data
              ?.filter(
                (p) =>
                  !sidebarSearch.trim() ||
                  p.name.toLowerCase().includes(sidebarSearch.trim().toLowerCase()) ||
                  p.channelType.toLowerCase().includes(sidebarSearch.trim().toLowerCase()),
              )
              .map((profile) => {
                const tone = statusTone(profile.runtime);
                const selected = profile.id === selectedId;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => selectProfile(profile.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                      selected
                        ? 'border-[var(--color-accent)] bg-indigo-50'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--color-fg)]">
                          {profile.name}
                        </p>
                        <p className="truncate text-[11px] text-gray-400">{profile.channelType}</p>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${tone.className}`}
                      >
                        {tone.label}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {profile.appliedAt && (
                        <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                          preferred in wrapper
                        </span>
                      )}
                      {profile.defaultTarget && (
                        <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] text-gray-500">
                          default target
                        </span>
                      )}
                      {profile.routeKey && (
                        <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] text-gray-500">
                          route: {profile.routeKey}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      </aside>

      <section className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)]">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4">
          {draft && selectedTemplate ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                        <AppIcon name={selectedTemplate.icon} className="h-5 w-5" strokeWidth={2} />
                      </div>
                      <div className="min-w-0">
                        <h1 className="truncate text-lg font-semibold text-[var(--color-fg)]">
                          {draft.id ? draft.name || 'Unnamed profile' : 'New channel profile'}
                        </h1>
                        <p className="mt-1 text-sm text-gray-500">{selectedTemplate.description}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-1 text-[11px] font-medium ${statusTone(selectedRuntime).className}`}
                      >
                        {statusTone(selectedRuntime).label}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-4 px-5 py-5 lg:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        Profile name <span className="text-red-500">*</span>
                      </span>
                      <input
                        value={draft.name}
                        onChange={(event) => {
                          setDraftValue('name', event.target.value);
                          if (event.target.value.trim()) {
                            setValidationErrors((e) => {
                              const { name: _name, ...next } = e;
                              return next;
                            });
                          }
                        }}
                        className={`w-full rounded-xl border bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)] ${validationErrors.name ? 'border-red-400' : 'border-[var(--color-border)]'}`}
                        placeholder="Support WhatsApp"
                      />
                      {validationErrors.name && (
                        <p className="mt-1 text-xs text-red-500">{validationErrors.name}</p>
                      )}
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        Template
                      </span>
                      <select
                        value={draft.templateId}
                        onChange={(event) => {
                          const template = templatesById.get(event.target.value);
                          if (!template) return;
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  templateId: template.id,
                                  channelType:
                                    template.channelType === 'custom'
                                      ? current.channelType
                                      : template.channelType,
                                  config: {
                                    ...((template.defaults as
                                      | Record<string, unknown>
                                      | undefined) ?? {}),
                                  },
                                  secretState: template.fields
                                    .filter((field) => field.type === 'password')
                                    .map((field) => ({ key: field.key, configured: false })),
                                  secretInputs: {},
                                }
                              : createDraft(template),
                          );
                        }}
                        className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      >
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        Channel type
                        {selectedTemplate.channelType === 'custom' && (
                          <span className="text-red-500"> *</span>
                        )}
                      </span>
                      <input
                        value={draft.channelType}
                        onChange={(event) => {
                          setDraftValue('channelType', event.target.value);
                          if (event.target.value.trim()) {
                            setValidationErrors((e) => {
                              const { channelType: _channelType, ...next } = e;
                              return next;
                            });
                          }
                        }}
                        disabled={selectedTemplate.channelType !== 'custom'}
                        className={`w-full rounded-xl border bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition disabled:bg-[var(--color-surface-2)] disabled:text-gray-400 focus:border-[var(--color-accent)] ${validationErrors.channelType ? 'border-red-400' : 'border-[var(--color-border)]'}`}
                        placeholder="whatsapp"
                      />
                      {validationErrors.channelType && (
                        <p className="mt-1 text-xs text-red-500">{validationErrors.channelType}</p>
                      )}
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        Account ID
                      </span>
                      <input
                        value={draft.accountId}
                        onChange={(event) => setDraftValue('accountId', event.target.value)}
                        className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                        placeholder="default"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        Agent ID
                      </span>
                      <input
                        value={draft.agentId}
                        onChange={(event) => setDraftValue('agentId', event.target.value)}
                        className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                        placeholder="main"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        Route key
                      </span>
                      <input
                        value={draft.routeKey}
                        onChange={(event) => setDraftValue('routeKey', event.target.value)}
                        className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                        placeholder="support.inbox"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        Default target
                      </span>
                      <input
                        value={draft.defaultTarget}
                        onChange={(event) => setDraftValue('defaultTarget', event.target.value)}
                        className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                        placeholder="chat id, phone number, or channel target"
                      />
                    </label>
                  </div>

                  <div className="border-t border-[var(--color-border)] px-5 py-5">
                    <h2 className="mb-3 text-sm font-semibold text-[var(--color-fg)]">
                      Template settings
                    </h2>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {selectedTemplate.fields.map((field) => {
                        const secret = readSecretPreview(draft.secretState, field.key);

                        if (field.type === 'textarea') {
                          return (
                            <label key={field.key} className="block lg:col-span-2">
                              <span className="mb-1.5 block text-xs font-medium text-gray-500">
                                {field.label}
                              </span>
                              <textarea
                                value={String(draft.config[field.key] ?? '')}
                                onChange={(event) => setConfigValue(field.key, event.target.value)}
                                rows={4}
                                className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                                placeholder={field.placeholder}
                              />
                              {renderFieldDescription(field) && (
                                <p className="mt-1 text-xs text-gray-400">
                                  {renderFieldDescription(field)}
                                </p>
                              )}
                            </label>
                          );
                        }

                        if (field.type === 'select') {
                          return (
                            <label key={field.key} className="block">
                              <span className="mb-1.5 block text-xs font-medium text-gray-500">
                                {field.label}
                              </span>
                              <select
                                value={String(draft.config[field.key] ?? '')}
                                onChange={(event) => setConfigValue(field.key, event.target.value)}
                                className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                              >
                                <option value="">Select...</option>
                                {field.options?.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              {renderFieldDescription(field) && (
                                <p className="mt-1 text-xs text-gray-400">
                                  {renderFieldDescription(field)}
                                </p>
                              )}
                            </label>
                          );
                        }

                        if (field.type === 'boolean') {
                          return (
                            <label
                              key={field.key}
                              className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3"
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(draft.config[field.key])}
                                onChange={(event) =>
                                  setConfigValue(field.key, event.target.checked)
                                }
                                className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-accent)]"
                              />
                              <div>
                                <div className="text-sm font-medium text-[var(--color-fg)]">
                                  {field.label}
                                </div>
                                {renderFieldDescription(field) && (
                                  <p className="mt-1 text-xs text-gray-400">
                                    {renderFieldDescription(field)}
                                  </p>
                                )}
                              </div>
                            </label>
                          );
                        }

                        if (field.type === 'password') {
                          const isVisible = showSecrets[field.key] ?? false;
                          return (
                            <label key={field.key} className="block">
                              <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-gray-500">
                                <span>{field.label}</span>
                                {secret.configured && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] text-gray-500">
                                    saved {secret.preview}
                                  </span>
                                )}
                              </span>
                              <div className="relative">
                                <input
                                  type={isVisible ? 'text' : 'password'}
                                  value={draft.secretInputs[field.key] ?? ''}
                                  onChange={(event) =>
                                    setSecretValue(field.key, event.target.value)
                                  }
                                  className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 pr-10 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                                  placeholder={
                                    field.placeholder ?? 'Leave blank to keep the saved value'
                                  }
                                />
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  aria-label={isVisible ? 'Hide secret' : 'Show secret'}
                                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-600"
                                  onClick={() =>
                                    setShowSecrets((s) => ({ ...s, [field.key]: !isVisible }))
                                  }
                                >
                                  {isVisible ? (
                                    <EyeOff className="h-4 w-4" strokeWidth={2} />
                                  ) : (
                                    <Eye className="h-4 w-4" strokeWidth={2} />
                                  )}
                                </button>
                              </div>
                              {renderFieldDescription(field) && (
                                <p className="mt-1 text-xs text-gray-400">
                                  {renderFieldDescription(field)}
                                </p>
                              )}
                            </label>
                          );
                        }

                        return (
                          <label key={field.key} className="block">
                            <span className="mb-1.5 block text-xs font-medium text-gray-500">
                              {field.label}
                            </span>
                            <input
                              value={String(draft.config[field.key] ?? '')}
                              onChange={(event) => setConfigValue(field.key, event.target.value)}
                              className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                              placeholder={field.placeholder}
                            />
                            {renderFieldDescription(field) && (
                              <p className="mt-1 text-xs text-gray-400">
                                {renderFieldDescription(field)}
                              </p>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h2 className="text-sm font-semibold text-[var(--color-fg)]">Actions</h2>
                    {!canManageChannels && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-700">
                        Only workspace admins and owners can edit channel profiles, pair accounts,
                        or send channel test messages.
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        loading={saveMutation.isPending}
                        onClick={() => {
                          const errors: Record<string, string> = {};
                          if (!draft.name.trim()) errors.name = 'Profile name is required.';
                          if (
                            selectedTemplate.channelType === 'custom' &&
                            !draft.channelType.trim()
                          ) {
                            errors.channelType = 'Channel type is required for custom templates.';
                          }
                          if (Object.keys(errors).length > 0) {
                            setValidationErrors(errors);
                            return;
                          }
                          void persistDraft();
                        }}
                        disabled={!canManageChannels || saveMutation.isPending}
                      >
                        <Save className="h-3.5 w-3.5" strokeWidth={2} />
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        loading={applyMutation.isPending}
                        onClick={() => {
                          const errors: Record<string, string> = {};
                          if (!draft.name.trim()) errors.name = 'Profile name is required.';
                          if (
                            selectedTemplate.channelType === 'custom' &&
                            !draft.channelType.trim()
                          ) {
                            errors.channelType = 'Channel type is required for custom templates.';
                          }
                          if (Object.keys(errors).length > 0) {
                            setValidationErrors(errors);
                            return;
                          }
                          void handleApply();
                        }}
                        disabled={applyMutation.isPending || !canManageChannels}
                      >
                        <Upload className="h-3.5 w-3.5" strokeWidth={2} />
                        {applyMutation.isPending ? 'Saving preference...' : 'Set preferred'}
                      </Button>
                      {draft.id && (
                        <Button
                          variant="danger"
                          onClick={() => setDeleteConfirmOpen(true)}
                          disabled={deleteMutation.isPending || !canManageChannels}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                          Delete
                        </Button>
                      )}
                    </div>
                    <div className="mt-3 space-y-2 text-xs text-gray-500">
                      <p>
                        `Save` stores this profile in the wrapper. `Set preferred` marks exactly one
                        profile per workspace as the wrapper-default choice for channel-aware nodes.
                      </p>
                      <p>
                        This does not push provider config into OpenClaw or change the live gateway
                        runtime by itself.
                      </p>
                      {draft.appliedAt && (
                        <p>
                          Preferred in wrapper since {new Date(draft.appliedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h2 className="text-sm font-semibold text-[var(--color-fg)]">Connection</h2>
                    <div className="mt-3 space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                        Live connection state comes from OpenClaw. Wrapper preference only affects
                        which saved profile this app suggests or auto-selects.
                      </div>
                      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-xs text-gray-500">
                        {selectedRuntime ? (
                          <>
                            <div className="font-medium text-[var(--color-fg)]">
                              {selectedRuntime.label ?? selectedRuntime.channelType}
                            </div>
                            <div className="mt-1">
                              {selectedRuntime.connected
                                ? 'Live channel is connected at the gateway.'
                                : selectedRuntime.configured
                                  ? 'Gateway sees the channel, but it is not connected yet.'
                                  : 'Gateway reported the channel without a connected account.'}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-[var(--color-fg)]">
                              No runtime match
                            </div>
                            <div className="mt-1">
                              The gateway did not report a live channel matching this profile yet.
                            </div>
                          </>
                        )}
                      </div>

                      {selectedTemplate.id === 'whatsapp-web' && !selectedChannelRuntime && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                          <div className="font-medium">WhatsApp provider not detected</div>
                          <div className="mt-1">
                            The connected OpenClaw gateway is not reporting a WhatsApp runtime
                            provider yet. Pairing will only work after the WhatsApp channel plugin
                            is installed or enabled in OpenClaw and the gateway is restarted.
                          </div>
                        </div>
                      )}

                      {selectedTemplate.pairingMode === 'qr' &&
                        trim(draft.accountId).length > 0 &&
                        selectedChannelRuntime &&
                        !selectedRuntime && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800">
                            <div className="font-medium">Saved account not detected</div>
                            <div className="mt-1">
                              The gateway sees this channel type, but it is not reporting the saved
                              account ID "{draft.accountId}". Update the profile account ID or
                              reconnect that specific account.
                            </div>
                          </div>
                        )}

                      {selectedTemplate.pairingMode === 'qr' ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() => {
                                if (!draft.id) {
                                  notify({
                                    tone: 'warning',
                                    title: 'Save first',
                                    message: 'Save the profile before starting pairing.',
                                  });
                                  return;
                                }
                                pairingStartMutation.mutate({ id: draft.id, force: true });
                              }}
                              disabled={
                                !draft.id || pairingStartMutation.isPending || !canManageChannels
                              }
                            >
                              <QrCode className="h-3.5 w-3.5" strokeWidth={2} />
                              Start pairing
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                if (!draft.id) return;
                                pairingWaitMutation.mutate({ id: draft.id });
                              }}
                              disabled={
                                !draft.id || pairingWaitMutation.isPending || !canManageChannels
                              }
                            >
                              <Play className="h-3.5 w-3.5" strokeWidth={2} />
                              Wait for connect
                            </Button>
                          </div>
                          {pairingState?.qrDataUrl && (
                            <div className="rounded-xl border border-[var(--color-border)] bg-white p-3">
                              <img
                                src={pairingState.qrDataUrl}
                                alt="Pairing QR"
                                className="mx-auto max-h-64 rounded-lg"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-[var(--color-border)] px-3 py-3 text-xs text-gray-400">
                          This template does not use QR pairing from the wrapper.
                        </div>
                      )}

                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (!draft.id) return;
                          logoutMutation.mutate({ id: draft.id });
                        }}
                        disabled={!draft.id || logoutMutation.isPending || !canManageChannels}
                      >
                        <Cable className="h-3.5 w-3.5" strokeWidth={2} />
                        {logoutMutation.isPending ? 'Logging out...' : 'Logout channel'}
                      </Button>

                      {pairingState?.message && (
                        <div
                          className={`rounded-xl border px-3 py-2 text-xs ${
                            pairingState.connected
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-700'
                          }`}
                        >
                          {pairingState.message}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h2 className="text-sm font-semibold text-[var(--color-fg)]">Test send</h2>
                    <div className="mt-3 space-y-3">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-gray-500">To</span>
                        <input
                          value={testSend.to}
                          onChange={(event) =>
                            setTestSend((current) => ({ ...current, to: event.target.value }))
                          }
                          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                          placeholder={draft.defaultTarget || 'recipient or conversation id'}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-gray-500">
                          Message
                        </span>
                        <textarea
                          value={testSend.message}
                          onChange={(event) =>
                            setTestSend((current) => ({ ...current, message: event.target.value }))
                          }
                          rows={3}
                          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-medium text-gray-500">
                          Thread ID
                        </span>
                        <input
                          value={testSend.threadId}
                          onChange={(event) =>
                            setTestSend((current) => ({ ...current, threadId: event.target.value }))
                          }
                          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                          placeholder="optional thread or topic"
                        />
                      </label>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (!draft.id) {
                            notify({
                              tone: 'warning',
                              title: 'Save first',
                              message: 'Save the profile before sending a test message.',
                            });
                            return;
                          }
                          testSendMutation.mutate({
                            id: draft.id,
                            ...(trim(testSend.to) ? { to: trim(testSend.to) } : {}),
                            message: testSend.message,
                            ...(trim(testSend.threadId)
                              ? { threadId: trim(testSend.threadId) }
                              : {}),
                          });
                        }}
                        disabled={
                          !draft.id ||
                          testSendMutation.isPending ||
                          trim(testSend.message).length === 0 ||
                          !canManageChannels
                        }
                      >
                        <Send className="h-3.5 w-3.5" strokeWidth={2} />
                        {testSendMutation.isPending ? 'Sending...' : 'Send test message'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                    <div>
                      Channel profiles now live in the wrapper, so flow nodes can reference a
                      reusable profile instead of raw channel ids.
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                    <div>
                      Secrets are now encrypted at rest in the wrapper database. Wrapper preference
                      also stays local to this app; it does not push full provider config back into
                      OpenClaw's config files.
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-8 text-sm text-gray-400">
              Loading channel editor...
            </div>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete channel profile"
        message={`Delete "${draft?.name || 'this profile'}"? This cannot be undone and will remove the profile from all flow nodes that reference it.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          const draftId = draft?.id;
          if (draftId) deleteMutation.mutate({ id: draftId });
        }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
