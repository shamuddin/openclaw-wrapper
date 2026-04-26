'use client';

import { useSession } from '@/components/SessionProvider';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import { ExternalLink, Eye, EyeOff, LoaderCircle, Lock, Network } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

type AuthView = 'signin' | 'invite' | 'request-reset' | 'reset';

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (pw.length === 0) return { score: 0, label: '', color: 'bg-gray-200' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: 'Weak', color: 'bg-red-400' };
  if (score <= 2) return { score, label: 'Fair', color: 'bg-amber-400' };
  if (score <= 3) return { score, label: 'Good', color: 'bg-blue-400' };
  return { score, label: 'Strong', color: 'bg-emerald-500' };
}

function PasswordStrengthBar({ password }: { password: string }) {
  const { score, label, color } = passwordStrength(password);
  if (!password) return null;
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all ${i <= score ? color : 'bg-gray-200'}`}
          />
        ))}
      </div>
      {label && (
        <div
          className={`mt-0.5 text-[10px] font-medium ${score <= 1 ? 'text-red-500' : score <= 2 ? 'text-amber-500' : score <= 3 ? 'text-blue-500' : 'text-emerald-600'}`}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder = 'At least 8 characters',
  showStrength = false,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  showStrength?: boolean;
  id?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 pr-10 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
          placeholder={placeholder}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-600"
          onClick={() => setShow((v) => !v)}
        >
          {show ? (
            <EyeOff className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Eye className="h-4 w-4" strokeWidth={2} />
          )}
        </button>
      </div>
      {showStrength && <PasswordStrengthBar password={value} />}
    </div>
  );
}

function AuthCardShell({
  title,
  subtitle,
  children,
}: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4 py-10">
      <div className="w-full max-w-md rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-accent)]">
            <Network className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--color-fg)]">OpenClaw Wrapper</div>
            <div className="text-xs text-gray-400">{subtitle}</div>
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-[var(--color-fg)]">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function InputField({
  label,
  inputId,
  children,
}: {
  label: string;
  inputId?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-gray-500">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]';

export function AuthGate({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const { sessionToken, setSessionToken, clearSessionToken } = useSession();
  const utils = trpc.useUtils();
  const [authView, setAuthView] = useState<AuthView>('signin');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [bootstrapName, setBootstrapName] = useState('');
  const [bootstrapEmail, setBootstrapEmail] = useState('');
  const [bootstrapPassword, setBootstrapPassword] = useState('');

  const [inviteToken, setInviteToken] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePassword, setInvitePassword] = useState('');

  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [lastEmailPreviewUrl, setLastEmailPreviewUrl] = useState<string | null>(null);

  const statusQuery = trpc.auth.status.useQuery(undefined, { retry: false });

  useEffect(() => {
    const invite = searchParams.get('invite');
    const reset = searchParams.get('reset');
    if (invite) {
      setInviteToken(invite);
      setAuthView('invite');
      return;
    }
    if (reset) {
      setResetToken(reset);
      setAuthView('reset');
    }
  }, [searchParams]);

  const loginMut = trpc.auth.login.useMutation({
    onSuccess(result) {
      setSessionToken(result.token);
      void Promise.all([utils.auth.status.invalidate(), utils.auth.me.invalidate()]);
      notify({
        tone: 'success',
        title: 'Signed in',
        message: `Welcome back, ${result.user.name}.`,
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Sign in failed', message: err.message, durationMs: 6000 });
    },
  });

  const bootstrapMut = trpc.auth.bootstrap.useMutation({
    onSuccess(result) {
      setSessionToken(result.token);
      void Promise.all([utils.auth.status.invalidate(), utils.auth.me.invalidate()]);
      notify({
        tone: 'success',
        title: 'Workspace secured',
        message: `${result.user.name} can now manage this wrapper.`,
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Setup failed', message: err.message, durationMs: 6000 });
    },
  });

  const acceptInviteMut = trpc.auth.acceptInvite.useMutation({
    onSuccess(result) {
      setSessionToken(result.token);
      void Promise.all([utils.auth.status.invalidate(), utils.auth.me.invalidate()]);
      notify({
        tone: 'success',
        title: 'Invite accepted',
        message: `${result.user.name} joined the invited workspace.`,
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Invite failed', message: err.message, durationMs: 6000 });
    },
  });

  const requestResetMut = trpc.auth.requestPasswordReset.useMutation({
    onSuccess(result) {
      const previewUrl = 'previewUrl' in result ? (result.previewUrl ?? null) : null;
      setLastEmailPreviewUrl(previewUrl);
      notify({
        tone: 'success',
        title: 'Reset email prepared',
        message: previewUrl
          ? 'Open the dev outbox preview to continue.'
          : 'If that email exists, a reset link has been sent.',
      });
    },
    onError(err) {
      notify({
        tone: 'error',
        title: 'Reset request failed',
        message: err.message,
        durationMs: 6000,
      });
    },
  });

  const resetPasswordMut = trpc.auth.resetPassword.useMutation({
    onSuccess() {
      setAuthView('signin');
      setResetToken('');
      setResetPassword('');
      notify({
        tone: 'success',
        title: 'Password reset',
        message: 'Sign in with your new password.',
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Reset failed', message: err.message, durationMs: 6000 });
    },
  });

  const status = statusQuery.data;
  const authDisabled = status?.authMode === 'disabled';
  const isAuthenticated = authDisabled || Boolean(status?.user && status?.session && sessionToken);
  const isBusy = statusQuery.isLoading || loginMut.isPending || bootstrapMut.isPending;

  const loginDisabled = useMemo(
    () => loginMut.isPending || !loginEmail.trim() || loginPassword.length < 8,
    [loginMut.isPending, loginEmail, loginPassword],
  );
  const bootstrapDisabled = useMemo(
    () =>
      bootstrapMut.isPending ||
      !bootstrapName.trim() ||
      !bootstrapEmail.trim() ||
      bootstrapPassword.length < 8,
    [bootstrapMut.isPending, bootstrapName, bootstrapEmail, bootstrapPassword],
  );
  const inviteDisabled = useMemo(
    () =>
      acceptInviteMut.isPending ||
      !inviteToken.trim() ||
      !inviteName.trim() ||
      invitePassword.length < 8,
    [acceptInviteMut.isPending, inviteToken, inviteName, invitePassword],
  );
  const requestResetDisabled = useMemo(
    () => requestResetMut.isPending || !resetEmail.trim(),
    [requestResetMut.isPending, resetEmail],
  );
  const resetPasswordDisabled = useMemo(
    () => resetPasswordMut.isPending || !resetToken.trim() || resetPassword.length < 8,
    [resetPasswordMut.isPending, resetToken, resetPassword],
  );

  if (statusQuery.isError) {
    return (
      <AuthCardShell
        title="Unable to reach auth service"
        subtitle="Check the adapter connection, then retry."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {statusQuery.error.message}
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => {
              clearSessionToken();
              void statusQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </AuthCardShell>
    );
  }

  if (!status && isBusy) {
    return (
      <AuthCardShell title="Loading workspace access" subtitle="Checking your session.">
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-gray-500">
          <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} />
          One moment while we verify your access.
        </div>
      </AuthCardShell>
    );
  }

  if (authDisabled) {
    return <>{children}</>;
  }

  if (status?.needsBootstrap) {
    return (
      <AuthCardShell
        title="Create the first owner"
        subtitle="This secures the wrapper and binds the default workspace."
      >
        <div className="space-y-4">
          <InputField label="Name" inputId="bootstrap-name">
            <input
              id="bootstrap-name"
              value={bootstrapName}
              onChange={(e) => setBootstrapName(e.target.value)}
              className={inputCls}
              placeholder="Your name"
            />
          </InputField>
          <InputField label="Email" inputId="bootstrap-email">
            <input
              id="bootstrap-email"
              type="email"
              value={bootstrapEmail}
              onChange={(e) => setBootstrapEmail(e.target.value)}
              className={inputCls}
              placeholder="you@example.com"
            />
          </InputField>
          <InputField label="Password" inputId="bootstrap-password">
            <PasswordInput
              id="bootstrap-password"
              value={bootstrapPassword}
              onChange={setBootstrapPassword}
              showStrength
            />
          </InputField>
        </div>
        <div className="mt-5 flex gap-2">
          <Button
            loading={bootstrapMut.isPending}
            disabled={bootstrapDisabled}
            onClick={() =>
              bootstrapMut.mutate({
                name: bootstrapName.trim(),
                email: bootstrapEmail.trim(),
                password: bootstrapPassword,
              })
            }
          >
            <Lock className="h-3.5 w-3.5" strokeWidth={2} />
            Finish setup
          </Button>
        </div>
      </AuthCardShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthCardShell title="Sign in" subtitle="Use your wrapper account to access your workspaces.">
        <div
          className="mb-5 flex flex-wrap gap-2"
          role="tablist"
          aria-label="Authentication options"
        >
          {(['signin', 'invite', 'request-reset'] as const).map((view) => {
            const isActive =
              authView === view || (authView === 'reset' && view === 'request-reset');
            return (
              <Button
                key={view}
                role="tab"
                aria-selected={isActive}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAuthView(view)}
              >
                {view === 'signin'
                  ? 'Sign in'
                  : view === 'invite'
                    ? 'Accept invite'
                    : 'Reset password'}
              </Button>
            );
          })}
        </div>

        {authView === 'signin' && (
          <>
            <div className="space-y-4">
              <InputField label="Email" inputId="login-email">
                <input
                  id="login-email"
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className={inputCls}
                  placeholder="you@example.com"
                />
              </InputField>
              <InputField label="Password" inputId="login-password">
                <PasswordInput
                  id="login-password"
                  value={loginPassword}
                  onChange={setLoginPassword}
                />
              </InputField>
            </div>
            <div className="mt-5 flex gap-2">
              <Button
                loading={loginMut.isPending}
                disabled={loginDisabled}
                onClick={() =>
                  loginMut.mutate({ email: loginEmail.trim(), password: loginPassword })
                }
              >
                <Lock className="h-3.5 w-3.5" strokeWidth={2} />
                Sign in
              </Button>
              {sessionToken && (
                <Button
                  variant="outline"
                  onClick={() => {
                    clearSessionToken();
                    void statusQuery.refetch();
                  }}
                >
                  Clear session
                </Button>
              )}
            </div>
            <button
              type="button"
              className="mt-4 text-xs font-medium text-[var(--color-accent)] hover:underline"
              onClick={() => {
                setAuthView('request-reset');
                setResetEmail(loginEmail);
              }}
            >
              Forgot your password?
            </button>
          </>
        )}

        {authView === 'invite' && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4">
            <div className="text-sm font-semibold text-[var(--color-fg)]">
              Accept workspace invite
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Use the invite link from your email, or paste the invite token manually.
            </p>
            <div className="mt-4 space-y-4">
              <InputField label="Invite token" inputId="invite-token">
                <input
                  id="invite-token"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                  className={inputCls}
                  placeholder="ocw_inv_..."
                />
              </InputField>
              <InputField label="Name" inputId="invite-name">
                <input
                  id="invite-name"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  className={inputCls}
                  placeholder="Your name"
                />
              </InputField>
              <InputField label="Set a password" inputId="invite-password">
                <PasswordInput
                  id="invite-password"
                  value={invitePassword}
                  onChange={setInvitePassword}
                  showStrength
                />
              </InputField>
            </div>
            <div className="mt-4">
              <Button
                loading={acceptInviteMut.isPending}
                disabled={inviteDisabled}
                onClick={() =>
                  acceptInviteMut.mutate({
                    token: inviteToken.trim(),
                    name: inviteName.trim(),
                    password: invitePassword,
                  })
                }
              >
                Accept invite
              </Button>
            </div>
          </div>
        )}

        {authView === 'request-reset' && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4">
            <div className="text-sm font-semibold text-[var(--color-fg)]">
              Request password reset
            </div>
            <p className="mt-1 text-xs text-gray-400">
              We'll send a reset link if this email belongs to a wrapper account.
            </p>
            <div className="mt-4">
              <InputField label="Email" inputId="reset-request-email">
                <input
                  id="reset-request-email"
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className={inputCls}
                  placeholder="you@example.com"
                />
              </InputField>
            </div>
            {lastEmailPreviewUrl && (
              <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-xs text-indigo-800">
                Dev outbox mode is active. Open the prepared email preview to continue:
                <div className="mt-2">
                  <a
                    href={lastEmailPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-indigo-900 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
                    Open reset email preview
                  </a>
                </div>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button
                loading={requestResetMut.isPending}
                disabled={requestResetDisabled}
                onClick={() => requestResetMut.mutate({ email: resetEmail.trim() })}
              >
                Send reset link
              </Button>
              <Button variant="outline" onClick={() => setAuthView('signin')}>
                Back to sign in
              </Button>
            </div>
          </div>
        )}

        {authView === 'reset' && (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4">
            <div className="text-sm font-semibold text-[var(--color-fg)]">
              Choose a new password
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Paste the reset token from your email, or open the link directly from the message.
            </p>
            <div className="mt-4 space-y-4">
              <InputField label="Reset token" inputId="reset-token">
                <input
                  id="reset-token"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className={inputCls}
                  placeholder="ocw_rst_..."
                />
              </InputField>
              <InputField label="New password" inputId="reset-password">
                <PasswordInput
                  id="reset-password"
                  value={resetPassword}
                  onChange={setResetPassword}
                  showStrength
                />
              </InputField>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                loading={resetPasswordMut.isPending}
                disabled={resetPasswordDisabled}
                onClick={() =>
                  resetPasswordMut.mutate({ token: resetToken.trim(), password: resetPassword })
                }
              >
                Reset password
              </Button>
              <Button variant="outline" onClick={() => setAuthView('signin')}>
                Back to sign in
              </Button>
            </div>
          </div>
        )}
      </AuthCardShell>
    );
  }

  return <>{children}</>;
}
