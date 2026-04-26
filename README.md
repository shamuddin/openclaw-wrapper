# OpenClaw Wrapper

Visual flow builder wrapping the OpenClaw gateway. Three-tier TypeScript monorepo:

- **`apps/web`** - Next.js 15 + React Flow canvas (Tier 1)
- **`apps/adapter`** - Fastify + tRPC service; owns DB, workers, WS to gateway (Tier 2)
- **OpenClaw gateway** - runs externally on `ws://127.0.0.1:18789` (Tier 3)

Shared TypeBox schemas in `packages/schemas` keep the wire format type-checked across tiers.

## Project Status

This repo is feature-rich enough for local and contributor use, but it is still being polished for a first public GitHub release.

What works well today:

- workspace-first flow management
- visual builder and run inspection
- channels, automation, and ops surfaces
- local open-source mode without sign-in
- plugin and extension discovery
- durable flow, run, approval, and workspace records

Known limitations:

- the wrapper depends on an external OpenClaw gateway
- some runtime pairing and operational surfaces are still partial
- flow execution still does not support cycles
- browser and tool support is intentionally narrower than full browser automation
- plugin lifecycle management is stronger on diagnostics than on operator controls

## Open Source Modes

OpenClaw Wrapper supports two auth modes:

- `AUTH_MODE=disabled`
  Local open-source mode. No sign-in screen, a local owner identity is created automatically, and the app opens straight into the workspace.
- `AUTH_MODE=required`
  Team or hosted mode. Sign-in, sessions, invites, account management, and multi-user controls stay enabled.

For local development and most open-source usage, the adapter defaults to `AUTH_MODE=disabled` unless `NODE_ENV=production`.

## Upstream Reference

OpenClaw Wrapper stays aligned with the upstream OpenClaw runtime surface area.
When contributing new node families or runtime behavior, keep naming and concepts close to the upstream project where possible.

## Product Roadmap

- `Phase 1` - OSS/local-first onboarding and auth-optional startup
- `Phase 2` - external plugin foundation for catalog-discovered nodes
- `Phase 3` - memory platform parity
- `Phase 4` - broader control-plane and ops surfaces
- `Phase 5` - deeper automation parity with task and standing-order entry surfaces
- `Phase 6` - mirrored task-flow registry and automation control-plane
- `Phase 7` - durable run and task-flow cancellation
- `Phase 8` - managed taskflow orchestration with child work, retries, and progression history
- `Phase 9` - deeper agent and coordination parity with delegated lineage
- `Phase 10` - richer tool, provider, and browser parity
- `Phase 11` - channel, device, and runtime-node parity
- `Phase 12` - plugin host maturity and OSS contributor polish

Historical planning notes are kept out of the public repository for now.

## Quick Start

```bash
pnpm install
cp apps/adapter/.env.example apps/adapter/.env
cp apps/web/.env.example apps/web/.env.local

# start local infra
pnpm infra:up

# apply checked-in database migrations
pnpm db:migrate

# run adapter and web in parallel
pnpm dev
```

Before starting the wrapper, make sure the upstream OpenClaw gateway is already running on `ws://127.0.0.1:18789` or update `GATEWAY_WS_URL` in `apps/adapter/.env`.

Local infra intentionally binds to higher host ports by default:

- Postgres: `127.0.0.1:55433`
- Redis: `127.0.0.1:56379`

That avoids collisions with machines that already have local database services on `5432` or `6379`.

Then open `http://localhost:3000`:

- In local mode, the app should open directly into the workspace.
- In team mode, you will see the sign-in/bootstrap flow.

The public repository currently ships the essential setup and governance docs only. If we publish a larger documentation set later, the README can link to it directly.

## Governance

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SECURITY.md](SECURITY.md)
- [LICENSE](LICENSE)
- [CHANGELOG.md](CHANGELOG.md)

OpenClaw Wrapper is released under the MIT License.

## Layout

```text
apps/
  web/              Next.js 15 canvas
  adapter/          Fastify + tRPC + Drizzle + BullMQ
packages/
  memory-sdk/       Shared memory query + status helpers
  schemas/          Shared TypeBox wire schemas
  openclaw-client/  ws wrapper with reconnect/backoff
  node-sdk/         FlowNode base class + external plugin manifest contract
  tsconfig/         Shared tsconfig bases
infra/
  docker-compose.yml
```

## Scripts

- `pnpm dev` - run adapter + web in parallel
- `pnpm build` - build everything
- `pnpm infra:up` - start local Postgres + Redis
- `pnpm infra:down` - stop local Postgres + Redis
- `pnpm db:migrate` - apply checked-in adapter database migrations
- `pnpm db:generate` - generate a new migration after changing the adapter schema
- `pnpm db:push` - directly push schema changes to a local database without migration history
- `pnpm typecheck` - TS check across all packages
- `pnpm lint` - Biome lint + format check
- `pnpm test` - Vitest across packages

Database and release workflow guidance is currently maintained outside the public repository.
