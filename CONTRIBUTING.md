# Contributing

Thanks for helping improve OpenClaw Wrapper.

This project is a local-first TypeScript monorepo that wraps the OpenClaw gateway with a visual control plane.
This repository intentionally keeps some internal planning and long-form docs private for now, so this file is the main public contributor entry point.

## Before You Start

- read the main [README.md](README.md)
- review the architecture and workflow notes in [README.md](README.md)
- coordinate major release-readiness changes in issues or pull requests before broad refactors

## Local Setup

```bash
pnpm install
pnpm infra:up
pnpm db:push
pnpm dev
```

Open `http://localhost:3000` after the services are up.

For local open-source mode, use `AUTH_MODE=disabled` and make sure the external OpenClaw gateway is reachable at `ws://127.0.0.1:18789`.

## Contribution Expectations

- keep shared contracts aligned through `packages/schemas`
- avoid drifting web and adapter data shapes
- prefer durable records over transient in-memory behavior
- keep runtime concepts distinct from canvas concepts in the UI
- document user-facing behavior changes

## Verification

Before opening a pull request, run the checks that match your change scope:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Package-scoped verification is fine during development when the change is tightly scoped.

## Pull Requests

Good pull requests usually include:

- a clear problem statement
- focused changes
- updated docs when behavior changes
- tests or verification notes for the affected area

## Community Standards

By participating in this project, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please do not open public issues for sensitive vulnerabilities. Use the process in [SECURITY.md](SECURITY.md) instead.
