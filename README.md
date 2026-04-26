# OpenClaw Wrapper

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 22.16.0](https://img.shields.io/badge/node-%3E%3D%2022.16.0-339933)](package.json)
[![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220)](https://pnpm.io/)

**OpenClaw Wrapper** is a visual control plane for OpenClaw automations.
It gives you a local-first workspace to design flows, manage channels, inspect runs, review approvals, and operate automations without talking directly to the gateway for every task.

This repository is the wrapper layer, not the OpenClaw runtime itself.
OpenClaw remains the execution substrate and capability provider. This project adds the builder, persistence, workspace APIs, orchestration records, and operator-facing surfaces around it.

[Upstream OpenClaw](https://github.com/openclaw/openclaw) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md) | [Issues](https://github.com/shamuddin/openclaw-wrapper/issues)

## Highlights

- **Visual flow builder** with a React Flow canvas, node palette, config panels, publish flow, and run inspection.
- **Durable control plane** for flows, versions, runs, approvals, workspace state, automation ledgers, and memory records.
- **Operator surfaces** for channels, automation, and ops instead of treating the canvas as the whole product.
- **Local-first open-source mode** with `AUTH_MODE=disabled` so contributors can run the app without sign-in friction.
- **Shared schema contracts** across web and adapter so builder and runtime data stay aligned.
- **Plugin-ready architecture** with a node SDK, manifest-based extension surface, and catalog-driven node metadata.

## What This Repo Contains

OpenClaw Wrapper is a three-layer TypeScript monorepo:

- **`apps/web`**
  Next.js 15 app for the workspace UI, builder, channels, automation, and ops views.
- **`apps/adapter`**
  Fastify + tRPC service that owns persistence, orchestration, auth mode behavior, gateway integration, and public trigger endpoints.
- **External OpenClaw gateway**
  Runs separately, usually on `ws://127.0.0.1:18789`, and handles upstream runtime work.

The adapter is the real heart of the product. It owns the database, the run lifecycle, approval handling, waits/resume, automation records, and the gateway-facing runtime boundary.

## Main Surfaces

- **Builder**
  Design, save, publish, and inspect automation flows.
- **Channels**
  Manage wrapper-owned channel profiles and view runtime channel state.
- **Automation**
  Review task-flow progression, retries, children, and managed automation history.
- **Ops**
  See gateway status, runtime inventory, approvals, activity, plugin diagnostics, and health signals.

## Quick Start

Prerequisites:

- Node `22.16.0` or newer
- `pnpm` via Corepack
- Docker for local Postgres + Redis
- a running OpenClaw gateway

```bash
corepack enable
pnpm install
cp apps/adapter/.env.example apps/adapter/.env
cp apps/web/.env.example apps/web/.env.local
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Before starting the wrapper, make sure the OpenClaw gateway is already running on `ws://127.0.0.1:18789`, or update `GATEWAY_WS_URL` in `apps/adapter/.env`.

Then open `http://localhost:3000`.

Local default ports:

- Web: `3000`
- Adapter: `4000`
- Postgres: `55433`
- Redis: `56379`
- Gateway WebSocket: `18789`

## Auth Modes

OpenClaw Wrapper supports two modes:

- `AUTH_MODE=disabled`
  Best for local development, OSS experimentation, and single-user setups. The app auto-creates a local owner and opens directly into the workspace.
- `AUTH_MODE=required`
  Best for team or hosted deployments. Sign-in, sessions, invites, and multi-user controls remain enabled.

For local development, the adapter defaults to `AUTH_MODE=disabled` unless `NODE_ENV=production`.

## Architecture

### Web app

- renders workspace surfaces
- talks only to the adapter
- manages builder UI and operator workflows

### Adapter

- owns database access
- exposes tRPC APIs and trigger endpoints
- persists flows, runs, approvals, memory, and automation records
- executes published flows and coordinates waits/resume
- connects to the OpenClaw gateway

### OpenClaw gateway

- provides upstream runtime, agents, skills, and channel capabilities
- remains an external dependency

## Repo Layout

```text
apps/
  web/              Next.js workspace UI
  adapter/          Fastify + tRPC + Drizzle + BullMQ runtime layer
packages/
  memory-sdk/       Shared memory query + status helpers
  schemas/          Shared TypeBox wire schemas
  openclaw-client/  WebSocket client wrapper with reconnect/backoff
  node-sdk/         External plugin and node contract surface
  tsconfig/         Shared tsconfig presets
infra/
  docker-compose.yml
```

## Scripts

- `pnpm dev` - run adapter and web together
- `pnpm build` - build the full workspace
- `pnpm test` - run Vitest across packages
- `pnpm typecheck` - run TypeScript checks across the monorepo
- `pnpm lint` - run Biome checks
- `pnpm infra:up` - start local Postgres and Redis
- `pnpm infra:down` - stop local Postgres and Redis
- `pnpm db:migrate` - apply checked-in adapter migrations
- `pnpm db:generate` - generate a new migration after schema changes
- `pnpm db:push` - push schema changes directly to a local database

## Current Boundaries

This repo is already useful for local and contributor workflows, but a few constraints are important:

- the wrapper depends on an external OpenClaw gateway
- some pairing and operational paths are still partial
- published flow execution does not support cycles yet
- browser and tool support is intentionally narrower than full browser automation
- plugin management is currently stronger on discovery and diagnostics than on operator controls

## Development Notes

- Keep shared contracts aligned through `packages/schemas`.
- Treat runtime concepts, workspace concepts, and canvas concepts as distinct on purpose.
- Prefer durable records over transient in-memory orchestration behavior.
- Keep new wrapper features conceptually close to upstream OpenClaw where possible.

## Governance

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)
- [LICENSE](LICENSE)
- [CHANGELOG.md](CHANGELOG.md)

OpenClaw Wrapper is released under the MIT License.
