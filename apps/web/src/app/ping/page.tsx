'use client';

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import Link from 'next/link';

export default function PingPage() {
  const ping = trpc.ping.gateway.useMutation();

  return (
    <main className="mx-auto max-w-2xl p-10 space-y-6">
      <header className="space-y-1">
        <div className="text-xs opacity-60">
          <Link href="/" className="hover:underline">
            ← Canvas
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Gateway ping</h1>
        <p className="text-sm opacity-70">
          Seam test - pings the OpenClaw gateway through the adapter.
        </p>
      </header>

      <Button onClick={() => ping.mutate()} disabled={ping.isPending}>
        {ping.isPending ? 'Pinging...' : 'Ping gateway'}
      </Button>

      {ping.data && (
        <pre className="rounded-md bg-white/5 p-4 text-xs overflow-auto">
          {JSON.stringify(ping.data, null, 2)}
        </pre>
      )}
      {ping.error && (
        <pre className="rounded-md bg-red-500/10 p-4 text-xs text-red-300 overflow-auto">
          {ping.error.message}
        </pre>
      )}
    </main>
  );
}
