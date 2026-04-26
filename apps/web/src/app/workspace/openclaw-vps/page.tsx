import { AppHeader } from '@/components/AppHeader';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Lock,
  Server,
  Shield,
  TerminalSquare,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

const verificationItems = [
  'The OpenClaw gateway is running on the VPS and reachable from the adapter.',
  'The adapter shows connected gateway status instead of "Gateway unavailable".',
  'The web app opens normally and can reach the adapter without browser fetch errors.',
  'Your gateway token exists only in the adapter env, never in the web env.',
];

const troubleshootingItems = [
  'If the web app says it cannot reach auth service, the adapter is usually down or the adapter URL is wrong.',
  'If the workspace shows Gateway unavailable, double-check GATEWAY_WS_URL and GATEWAY_TOKEN in the adapter env.',
  'If the browser console shows CORS errors, make sure CORS_ORIGIN matches the real web app URL.',
  'If secrets or trigger features fail, replace the default CHANNEL_SECRET_KEY with a real random value.',
];

function StepCard({
  step,
  title,
  why,
  children,
}: {
  step: string;
  title: string;
  why: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-accent)] text-sm font-semibold text-white">
          {step}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-[var(--color-fg)]">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            <strong>Why this matters:</strong> {why}
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-4 text-sm leading-6 text-gray-600">{children}</div>
    </section>
  );
}

export default function OpenClawVpsGuidePage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)]">
      <AppHeader
        current="workspace"
        title="OpenClaw VPS Guide"
        subtitle="A step-by-step deployment guide for running OpenClaw securely and connecting this wrapper with a gateway token."
      />

      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <Link
              href="/workspace"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm font-medium text-[var(--color-fg)] transition hover:bg-white"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              Back to workspace
            </Link>

            <h1 className="mt-5 text-3xl font-semibold text-[var(--color-fg)]">
              Fastest safe way to deploy OpenClaw with this wrapper
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-600">
              This wrapper can run in <strong>either</strong> of these places:
              <strong> on the same VPS as OpenClaw</strong> or <strong>on your local machine</strong>.
              In both cases, the connection rule stays the same: the adapter uses{' '}
              <code>GATEWAY_WS_URL</code> and <code>GATEWAY_TOKEN</code>, and users only talk to the
              wrapper UI, not directly to the OpenClaw gateway.
            </p>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Server className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Recommended layout
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  OpenClaw on VPS, then wrapper on the VPS or on your local machine.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Lock className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Private runtime
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  Gateway, Postgres, and Redis should stay private. Only the web and adapter URLs
                  should be public.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Shield className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Token rule
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  The gateway token goes only into the adapter env. Never put it in a
                  <code> NEXT_PUBLIC_*</code> variable.
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div className="text-sm font-semibold text-[var(--color-fg)]">
                Option A: wrapper on the same VPS
              </div>
              <div className="mt-3 space-y-3 text-sm leading-6 text-gray-600">
                <p>This is the simplest production setup.</p>
                <p>
                  Use a private gateway URL like <code>ws://127.0.0.1:18789</code> so the adapter
                  reaches OpenClaw locally on the server.
                </p>
                <p>
                  Best when you want one hosted deployment that other users can open through a
                  normal domain.
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div className="text-sm font-semibold text-[var(--color-fg)]">
                Option B: wrapper on your local machine
              </div>
              <div className="mt-3 space-y-3 text-sm leading-6 text-gray-600">
                <p>
                  Clone the wrapper locally, but still point the adapter at the remote OpenClaw
                  gateway running on the VPS.
                </p>
                <p>
                  In that case, <code>GATEWAY_WS_URL</code> should be the reachable gateway address
                  from your machine, ideally a protected private or <code>wss://</code> endpoint.
                </p>
                <p>
                  The token still belongs only in <code>apps/adapter/.env</code> on your local
                  machine, never in the web env.
                </p>
              </div>
            </div>
          </section>

          <StepCard
            step="1"
            title="Prepare the VPS"
            why="You want a clean server, a stable domain, and as few public ports as possible before you add the app."
          >
            <p>Use a VPS that can run Node.js, Docker, and a reverse proxy.</p>
            <p>Make sure you have:</p>
            <ul className="list-disc pl-5">
              <li>a domain for the web app, such as <code>https://app.example.com</code></li>
              <li>
                a domain for the adapter, such as <code>https://api.example.com</code>
              </li>
              <li>SSH access to the VPS</li>
            </ul>
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`sudo apt update && sudo apt upgrade -y
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable`}</pre>
            </div>
            <p>
              Do <strong>not</strong> expose your OpenClaw websocket port, Postgres, or Redis to
              the public internet unless you truly need that and know why.
            </p>
          </StepCard>

          <StepCard
            step="2"
            title="Install OpenClaw on the VPS first"
            why="This wrapper is the control plane. OpenClaw is still the actual runtime and gateway."
          >
            <p>
              Install and start OpenClaw on the VPS using the upstream method you already trust.
            </p>
            <p>Before you continue, write down these two values from your OpenClaw setup:</p>
            <ul className="list-disc pl-5">
              <li>
                gateway websocket URL, usually <code>ws://127.0.0.1:18789</code> when it is on the
                same VPS
              </li>
              <li>gateway token, if your OpenClaw gateway requires one</li>
            </ul>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-950">
              The safest same-VPS pattern is: keep OpenClaw bound privately, let the adapter call
              it over <code>127.0.0.1</code>, and never expose the raw websocket port publicly. If
              the wrapper runs on your local machine instead, use a protected reachable gateway URL
              from that machine.
            </div>
          </StepCard>

          <StepCard
            step="3"
            title="Clone this wrapper and install dependencies"
            why="The wrapper needs its own codebase, Node packages, and local infra before it can talk to OpenClaw."
          >
            <p>
              Run this on the machine where you want the wrapper to live, either the VPS or your
              local machine.
            </p>
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`git clone <your-repo-url>
cd OpenClawWrapper
corepack enable
corepack pnpm install`}</pre>
            </div>
            <p>
              This project expects Node <code>22.16.0+</code> and uses <code>pnpm</code>.
            </p>
          </StepCard>

          <StepCard
            step="4"
            title="Create the adapter env file"
            why="The adapter is the trusted backend. It owns the gateway token, database connections, auth mode, and secret storage."
          >
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`cp apps/adapter/.env.example apps/adapter/.env`}</pre>
            </div>
            <p>Then edit <code>apps/adapter/.env</code> and use a production-style setup like this:</p>
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`PORT=4000
HOST=0.0.0.0
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55433/openclaw
REDIS_URL=redis://127.0.0.1:56379

GATEWAY_WS_URL=ws://127.0.0.1:18789
GATEWAY_TOKEN=your-real-gateway-token
GATEWAY_BOOTSTRAP_TOKEN=
GATEWAY_DEVICE_TOKEN=
GATEWAY_PASSWORD=

AUTH_MODE=required
LOCAL_AUTH_EMAIL=admin@example.com
LOCAL_AUTH_NAME=Admin User

CORS_ORIGIN=https://app.example.com
APP_BASE_URL=https://app.example.com
ADAPTER_BASE_URL=https://api.example.com

CHANNEL_SECRET_KEY=replace-this-with-a-long-random-secret
EMAIL_DELIVERY_MODE=outbox`}</pre>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
              Replace <code>CHANNEL_SECRET_KEY</code> with a long random value. Do not leave the
              placeholder in place on a real VPS.
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-950">
              If the wrapper runs on your <strong>local machine</strong>, keep the same rule but
              change <code>GATEWAY_WS_URL</code> to the reachable gateway address on the VPS.
              Example: <code>wss://gateway.example.com</code> if that is how your OpenClaw gateway
              is exposed securely.
            </div>
          </StepCard>

          <StepCard
            step="5"
            title="Create the web env file"
            why="The browser only needs to know where the adapter lives. It should not receive private gateway credentials."
          >
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`cp apps/web/.env.example apps/web/.env.local`}</pre>
            </div>
            <p>Then set only the public adapter URL:</p>
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`NEXT_PUBLIC_ADAPTER_URL=https://api.example.com`}</pre>
            </div>
            <p>
              That is enough for the web app. Do not add <code>GATEWAY_TOKEN</code>, websocket
              URLs, or any other server secret here.
            </p>
            <p>
              If you run the wrapper locally, this can also be a local adapter URL such as
              <code> http://localhost:4000</code>.
            </p>
          </StepCard>

          <StepCard
            step="6"
            title="Start the wrapper database and Redis"
            why="The wrapper uses Postgres for saved state and Redis for queues and orchestration."
          >
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`corepack pnpm infra:up
corepack pnpm db:migrate`}</pre>
            </div>
            <p>
              This brings up Postgres and Redis using the repo&apos;s Docker Compose file, then
              applies the checked-in database migrations.
            </p>
          </StepCard>

          <StepCard
            step="7"
            title="Build the wrapper"
            why="A VPS deployment should run the production build, not the local dev server."
          >
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`corepack pnpm build`}</pre>
            </div>
            <p>
              This builds both the adapter and the web app using the scripts already defined in
              this repo.
            </p>
          </StepCard>

          <StepCard
            step="8"
            title="Start the adapter and the web app"
            why="These are separate services. The web app serves the UI, and the adapter connects to OpenClaw, Postgres, and Redis."
          >
            <p>Start them in separate terminals, or better, under a process manager like systemd or pm2.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                  <TerminalSquare className="h-4 w-4" strokeWidth={2} />
                  Adapter
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap">{`corepack pnpm --filter @openclaw-wrapper/adapter start`}</pre>
              </div>
              <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
                  <TerminalSquare className="h-4 w-4" strokeWidth={2} />
                  Web
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap">{`corepack pnpm --filter @openclaw-wrapper/web start`}</pre>
              </div>
            </div>
            <p>
              After this, place your reverse proxy in front of them so users access
              <code> app.example.com</code> and <code>api.example.com</code> instead of raw ports.
            </p>
          </StepCard>

          <StepCard
            step="9"
            title="Verify that the gateway connection works"
            why="You want to confirm the secure connection before you start building real flows."
          >
            <p>Open the wrapper in the browser and check the top-right gateway status.</p>
            <p>
              It should show a healthy connection instead of <strong>Gateway unavailable</strong>.
            </p>
            <p>You can also verify the adapter directly:</p>
            <div className="rounded-2xl border border-[var(--color-border)] bg-slate-950 px-4 py-4 text-sm text-slate-100">
              <pre className="overflow-x-auto whitespace-pre-wrap">{`curl https://api.example.com/health`}</pre>
            </div>
            <div className="mt-4 space-y-3">
              {verificationItems.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                >
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                    strokeWidth={2}
                  />
                  <div>{item}</div>
                </div>
              ))}
            </div>
          </StepCard>

          <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
              <div className="text-sm font-semibold text-rose-950">Troubleshooting</div>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-rose-900">
                {troubleshootingItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
              <div className="text-sm font-semibold text-[var(--color-fg)]">Need the upstream runtime docs too?</div>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                This page focuses on the wrapper side and the secure gateway connection pattern. If
                you need the lower-level OpenClaw runtime installation details, continue with the
                upstream project documentation and then come back here for the wrapper env setup.
              </p>
              <a
                href="https://github.com/openclaw/openclaw"
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm font-medium text-[var(--color-fg)] transition hover:bg-white"
              >
                <ExternalLink className="h-4 w-4" strokeWidth={2} />
                Open upstream OpenClaw project
              </a>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
