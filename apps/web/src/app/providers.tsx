'use client';

import { AuthGate } from '@/components/AuthGate';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SessionProvider, useSession } from '@/components/SessionProvider';
import {
  DEFAULT_WORKSPACE_SLUG,
  WorkspaceProvider,
  useWorkspace,
} from '@/components/WorkspaceProvider';
import { Toaster } from '@/components/ui/toaster';
import { buildAdapterUrl } from '@/lib/adapter-url';
import { trpc } from '@/lib/trpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { type ReactNode, Suspense, useMemo, useState } from 'react';

function AuthGateFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-gray-500 shadow-sm">
        Loading workspace...
      </div>
    </div>
  );
}

function ProvidersInner({ children }: { children: ReactNode }) {
  const { workspaceSlug } = useWorkspace();
  const { sessionToken } = useSession();
  const [queryClient] = useState(() => new QueryClient());
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [
          httpBatchLink({
            url: buildAdapterUrl('/trpc'),
            headers() {
              return {
                'x-openclaw-workspace': workspaceSlug || DEFAULT_WORKSPACE_SLUG,
                ...(sessionToken ? { 'x-openclaw-session': sessionToken } : {}),
              };
            },
          }),
        ],
      }),
    [sessionToken, workspaceSlug],
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <Suspense fallback={<AuthGateFallback />}>
            <AuthGate>{children}</AuthGate>
          </Suspense>
        </ErrorBoundary>
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <WorkspaceProvider>
        <ProvidersInner>{children}</ProvidersInner>
      </WorkspaceProvider>
    </SessionProvider>
  );
}
