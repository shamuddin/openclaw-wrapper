'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import { Eye, EyeOff, KeyRound, Monitor, Shield, X } from 'lucide-react';
import { useMemo, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AccountPanel({ open, onClose }: Props) {
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    nextPassword: '',
  });
  const statusQuery = trpc.auth.status.useQuery(undefined, { enabled: open });
  const sessionsQuery = trpc.auth.sessions.useQuery(undefined, { enabled: open });
  const revokeSessionMutation = trpc.auth.revokeSession.useMutation({
    onSuccess() {
      void sessionsQuery.refetch();
      notify({ tone: 'success', title: 'Session revoked', message: 'Access was removed.' });
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
  const revokeOthersMutation = trpc.auth.revokeOtherSessions.useMutation({
    onSuccess() {
      void sessionsQuery.refetch();
      notify({
        tone: 'success',
        title: 'Other sessions revoked',
        message: 'Only this device remains signed in.',
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
  const changePasswordMutation = trpc.auth.changePassword.useMutation({
    onSuccess() {
      setPasswordForm({ currentPassword: '', nextPassword: '' });
      notify({
        tone: 'success',
        title: 'Password updated',
        message: 'Use the new password the next time you sign in.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Password change failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const canChangePassword = useMemo(
    () =>
      passwordForm.currentPassword.trim().length >= 8 &&
      passwordForm.nextPassword.trim().length >= 8 &&
      !changePasswordMutation.isPending,
    [changePasswordMutation.isPending, passwordForm],
  );

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [revokeAllConfirmOpen, setRevokeAllConfirmOpen] = useState(false);
  const authDisabled = statusQuery.data?.authMode === 'disabled';

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-start justify-end bg-slate-950/20 p-4">
        <div className="flex h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_30px_120px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <Shield className="h-4 w-4" strokeWidth={2} />
                {authDisabled ? 'Local mode' : 'Account security'}
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {authDisabled
                  ? 'Sign-in is disabled for this installation, so session and password management are not needed.'
                  : 'Manage active sessions and rotate your password.'}
              </p>
            </div>
            <Button size="iconSm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" strokeWidth={2} />
            </Button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {authDisabled ? (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4 text-sm text-gray-500">
                The app is running in local open-source mode. Access is tied to this local
                installation, so there are no account sessions or passwords to manage here.
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-[var(--color-border)] px-4 py-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                    <Monitor className="h-4 w-4" strokeWidth={2} />
                    Active sessions
                  </div>
                  <div className="space-y-3">
                    {sessionsQuery.isLoading && (
                      <div className="text-sm text-gray-400">Loading sessions...</div>
                    )}
                    {sessionsQuery.data?.sessions.map((session) => {
                      const isCurrent = session.id === sessionsQuery.data.currentSessionId;
                      return (
                        <div
                          key={session.id}
                          className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-[var(--color-fg)]">
                                {isCurrent
                                  ? 'Current session'
                                  : `Session ${session.id.slice(0, 8)}`}
                              </div>
                              <div className="mt-1 text-xs text-gray-400">
                                Created {new Date(session.createdAt).toLocaleString()}
                              </div>
                              <div className="text-xs text-gray-400">
                                Last seen{' '}
                                {session.lastSeenAt
                                  ? new Date(session.lastSeenAt).toLocaleString()
                                  : 'just now'}
                              </div>
                              <div className="text-xs text-gray-400">
                                Expires {new Date(session.expiresAt).toLocaleString()}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={isCurrent || revokeSessionMutation.isPending}
                              onClick={() =>
                                revokeSessionMutation.mutate({ sessionId: session.id })
                              }
                            >
                              Revoke
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4">
                    <Button
                      size="sm"
                      variant="danger"
                      loading={revokeOthersMutation.isPending}
                      disabled={revokeOthersMutation.isPending}
                      onClick={() => setRevokeAllConfirmOpen(true)}
                    >
                      Revoke other sessions
                    </Button>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--color-border)] px-4 py-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                    <KeyRound className="h-4 w-4" strokeWidth={2} />
                    Change password
                  </div>
                  <div className="grid gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        Current password
                      </span>
                      <div className="relative">
                        <input
                          type={showCurrent ? 'text' : 'password'}
                          value={passwordForm.currentPassword}
                          onChange={(event) =>
                            setPasswordForm((current) => ({
                              ...current,
                              currentPassword: event.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 pr-10 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={showCurrent ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-600"
                          onClick={() => setShowCurrent((v) => !v)}
                        >
                          {showCurrent ? (
                            <EyeOff className="h-4 w-4" strokeWidth={2} />
                          ) : (
                            <Eye className="h-4 w-4" strokeWidth={2} />
                          )}
                        </button>
                      </div>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-500">
                        New password
                      </span>
                      <div className="relative">
                        <input
                          type={showNext ? 'text' : 'password'}
                          value={passwordForm.nextPassword}
                          onChange={(event) =>
                            setPasswordForm((current) => ({
                              ...current,
                              nextPassword: event.target.value,
                            }))
                          }
                          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 pr-10 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={showNext ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-600"
                          onClick={() => setShowNext((v) => !v)}
                        >
                          {showNext ? (
                            <EyeOff className="h-4 w-4" strokeWidth={2} />
                          ) : (
                            <Eye className="h-4 w-4" strokeWidth={2} />
                          )}
                        </button>
                      </div>
                    </label>
                  </div>
                  <div className="mt-4">
                    <Button
                      disabled={!canChangePassword}
                      onClick={() =>
                        changePasswordMutation.mutate({
                          currentPassword: passwordForm.currentPassword,
                          nextPassword: passwordForm.nextPassword,
                        })
                      }
                    >
                      {changePasswordMutation.isPending ? 'Updating...' : 'Update password'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={revokeAllConfirmOpen}
        title="Revoke other sessions"
        message="This will immediately sign out all other devices and browsers. Only this current session will remain active."
        confirmLabel="Revoke all others"
        variant="danger"
        onConfirm={() => {
          setRevokeAllConfirmOpen(false);
          revokeOthersMutation.mutate();
        }}
        onCancel={() => setRevokeAllConfirmOpen(false)}
      />
    </>
  );
}
