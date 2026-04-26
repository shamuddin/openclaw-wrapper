'use client';

import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import {
  Cable,
  CheckCircle2,
  Copy,
  KeyRound,
  RefreshCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';

type FormState = {
  url: string;
  token: string;
  bootstrapToken: string;
  deviceToken: string;
  password: string;
};

function statusTone(state: string) {
  switch (state) {
    case 'connected':
      return {
        chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        icon: CheckCircle2,
        label: 'Connected',
      };
    case 'pairing_required':
      return {
        chip: 'border-amber-200 bg-amber-50 text-amber-700',
        icon: ShieldAlert,
        label: 'Pairing required',
      };
    case 'auth_error':
      return {
        chip: 'border-red-200 bg-red-50 text-red-600',
        icon: ShieldAlert,
        label: 'Auth failed',
      };
    default:
      return {
        chip: 'border-slate-200 bg-slate-50 text-slate-600',
        icon: Cable,
        label: 'Unavailable',
      };
  }
}

function blankForm(): FormState {
  return {
    url: 'ws://127.0.0.1:18789',
    token: '',
    bootstrapToken: '',
    deviceToken: '',
    password: '',
  };
}

export function GatewayPanel() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.workspaces.current.useQuery();

  const settingsQuery = trpc.gateway.settings.useQuery(undefined, {
    enabled: open,
    retry: false,
  });

  const statusQuery = trpc.gateway.status.useQuery(undefined, {
    refetchInterval: 15000,
  });

  const saveMutation = trpc.gateway.saveSettings.useMutation({
    onSuccess() {
      notify({
        tone: 'success',
        title: 'Gateway settings saved',
        message: 'The adapter will use the new connection settings immediately.',
      });
      Promise.all([utils.gateway.settings.invalidate(), utils.gateway.status.invalidate()]).catch(
        () => undefined,
      );
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Save failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setForm({
      url: settingsQuery.data.settings.url,
      token: settingsQuery.data.settings.token ?? '',
      bootstrapToken: settingsQuery.data.settings.bootstrapToken ?? '',
      deviceToken: settingsQuery.data.settings.deviceToken ?? '',
      password: settingsQuery.data.settings.password ?? '',
    });
  }, [settingsQuery.data]);

  const status = statusQuery.data;
  const tone = statusTone(status?.state ?? 'unreachable');
  const StatusIcon = tone.icon;
  const workspaceRole = workspaceQuery.data?.current.role ?? 'member';
  const canManageGateway = workspaceRole === 'owner' || workspaceRole === 'admin';

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify({ tone: 'success', title: 'Copied', message: `${label} copied.` });
    } catch {
      notify({ tone: 'error', title: 'Copy failed', message: 'Clipboard unavailable.' });
    }
  }

  return (
    <>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Gateway status: ${tone.label}`}
          className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${tone.chip}`}
        >
          <span className="relative flex items-center">
            <StatusIcon className="h-3.5 w-3.5" strokeWidth={2} />
            {statusQuery.isFetching && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-current opacity-60 animate-ping" />
            )}
          </span>
          <span>Gateway</span>
          <span className="hidden sm:inline">{tone.label}</span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[1px]">
          <div className="flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-fg)]">Gateway Settings</h2>
                <p className="text-xs text-gray-400">
                  Configure how the wrapper authenticates to OpenClaw.
                </p>
              </div>
              <Button size="iconSm" variant="ghost" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" strokeWidth={2} />
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div className={`rounded-xl border px-3 py-3 text-sm ${tone.chip}`}>
                <div className="flex items-center gap-2 font-medium">
                  <StatusIcon className="h-4 w-4" strokeWidth={2} />
                  {tone.label}
                </div>
                <p className="mt-1 text-xs leading-5">
                  {status?.message ?? 'Checking gateway status...'}
                </p>
                {status?.detail && <p className="mt-1 text-[11px] opacity-80">{status.detail}</p>}
                {status?.roundTripMs !== undefined && (
                  <p className="mt-1 text-[11px] opacity-80">Round trip: {status.roundTripMs} ms</p>
                )}
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-500">
                  <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                  Wrapper device identity
                </div>
                <div className="space-y-2 text-xs text-gray-600">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-gray-400">Device ID</div>
                    <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2">
                      <code className="min-w-0 flex-1 truncate text-[11px]">
                        {status?.deviceIdentity.deviceId ?? 'Generating...'}
                      </code>
                      {status?.deviceIdentity.deviceId && (
                        <Button
                          size="iconSm"
                          variant="ghost"
                          onClick={() => void copy(status.deviceIdentity.deviceId, 'Device ID')}
                        >
                          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-gray-400">Identity file</div>
                    <div className="rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2 font-mono text-[10px]">
                      {status?.deviceIdentity.path ?? 'Preparing...'}
                    </div>
                  </div>
                  {status?.state === 'pairing_required' && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
                      OpenClaw is seeing this wrapper device, but it still needs to trust or pair
                      it. Use the device ID above when approving it in OpenClaw.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <div className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-500">
                  <Server className="h-3.5 w-3.5" strokeWidth={2} />
                  Connection settings
                </div>
                {!canManageGateway && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                    Gateway settings are restricted to workspace admins and owners.
                  </div>
                )}
                {settingsQuery.error && canManageGateway && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                    {settingsQuery.error.message}
                  </div>
                )}

                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-gray-500">
                      Gateway WS URL
                    </span>
                    <input
                      value={form.url}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, url: event.target.value }))
                      }
                      disabled={!canManageGateway}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                      placeholder="ws://127.0.0.1:18789"
                    />
                  </label>

                  {(
                    [
                      ['token', 'Gateway token'],
                      ['bootstrapToken', 'Bootstrap token'],
                      ['deviceToken', 'Device token'],
                      ['password', 'Gateway password'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
                      <div className="relative">
                        <KeyRound
                          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                          strokeWidth={2}
                        />
                        <input
                          type="password"
                          value={form[key]}
                          onChange={(event) =>
                            setForm((current) => ({ ...current, [key]: event.target.value }))
                          }
                          disabled={!canManageGateway}
                          className="w-full rounded-lg border border-[var(--color-border)] bg-white py-2 pl-9 pr-3 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                          placeholder={label}
                        />
                      </div>
                    </label>
                  ))}
                </div>

                <div className="mt-3 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[11px] text-gray-500">
                  Source: {status?.settings.source ?? 'env'}
                  {status?.settings.updatedAt
                    ? ` · updated ${new Date(status.settings.updatedAt).toLocaleString()}`
                    : ''}
                </div>
              </div>
            </div>

            <div className="border-t border-[var(--color-border)] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => statusQuery.refetch()}
                  disabled={statusQuery.isFetching}
                >
                  <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2} />
                  {statusQuery.isFetching ? 'Checking...' : 'Check connection'}
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                  <Button
                    onClick={() => saveMutation.mutate(form)}
                    disabled={
                      saveMutation.isPending || form.url.trim().length === 0 || !canManageGateway
                    }
                  >
                    {saveMutation.isPending ? 'Saving...' : 'Save settings'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
