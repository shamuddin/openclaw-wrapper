# Contributing to OpenClaw Wrapper

Thanks for your interest in improving OpenClaw Wrapper. Whether you're fixing a bug, proposing a feature, improving docs, or just asking questions — you're welcome here.

## Quick Links

- **Repository:** [github.com/shamuddin/openclaw-wrapper](https://github.com/shamuddin/openclaw-wrapper)
- **Issues:** [github.com/shamuddin/openclaw-wrapper/issues](https://github.com/shamuddin/openclaw-wrapper/issues)
- **Security:** [SECURITY.md](SECURITY.md)
- **Code of Conduct:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## How to Contribute

| Contribution | Process |
|---|---|
| Bug fix or small improvement | Open a PR directly |
| New feature or architecture change | Open an issue first to discuss the approach |
| Documentation fix | Open a PR directly |
| Security vulnerability | Follow [SECURITY.md](SECURITY.md) — do **not** open a public issue |
| Question or help | Open a [Discussion](https://github.com/shamuddin/openclaw-wrapper/discussions) or issue |

## Getting Started

### Prerequisites

- Node.js `22.16.0+`
- pnpm via Corepack
- Docker (for local Postgres + Redis)
- A running OpenClaw gateway

### Local Setup

```bash
corepack enable
pnpm install
cp apps/adapter/.env.example apps/adapter/.env
cp apps/web/.env.example     apps/web/.env.local
pnpm infra:up
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`. With `AUTH_MODE=disabled` (the default), the app opens straight into the workspace.

## Before You Open a PR

### Run the checks

```bash
pnpm lint        # Biome lint + format
pnpm typecheck   # TypeScript across the monorepo
pnpm test        # Vitest across packages
pnpm build       # Full build
```

Package-scoped checks are fine during development, but please run the full suite before requesting review.

### Keep PRs focused

- One concern per PR. Don't mix a bug fix with an unrelated refactor.
- Describe **what** changed and **why**.
- Include screenshots for UI changes (before/after).
- Update docs when user-facing behavior changes.
- Add or update tests for the affected area when possible.

### PR size guidelines

- Prefer small, reviewable PRs over large monolithic ones.
- If a feature requires multiple steps, split into a stack of PRs when practical.
- If a single PR is unavoidable, include a clear walkthrough in the description.

## Coding Standards

### Architecture principles

- Keep shared contracts aligned through `packages/schemas`.
- Treat runtime, workspace, and canvas concepts as distinct layers.
- Prefer durable DB records over transient in-memory state.
- Keep new wrapper features conceptually close to upstream OpenClaw.

### Code style

- **Formatter/linter:** Biome handles formatting and linting. Run `pnpm lint` before committing.
- **TypeScript:** Strict mode is on. Avoid `any` — prefer `unknown` with narrowing.
- **Naming:** camelCase for variables/functions, PascalCase for types/components, UPPER_SNAKE for constants.
- **Imports:** Use explicit `.js` extensions for local imports in the adapter (ESM).
- **Tests:** Vitest. Co-locate test files next to source (`*.test.ts`).

### Database changes

- Use Drizzle ORM for schema definitions.
- Run `pnpm db:generate` after schema changes to create a migration.
- Never edit existing migration files — always create a new one.
- See [docs/database-workflow.md](docs/database-workflow.md) for the full workflow.

## AI-Assisted PRs Welcome

Built with Claude, Copilot, Cursor, or other AI tools? Great — just be transparent about it.

Please include in your PR:

- Note that the PR is AI-assisted (title or description)
- The degree of testing (untested / lightly tested / fully tested)
- Confirmation that you understand what the code does and have reviewed the diff

AI-assisted PRs are first-class contributions. We just want reviewers to know what to look for.

## What Makes a Good PR

| Section | What to include |
|---|---|
| **Summary** | 2-5 sentences: what problem, what fix, what changed |
| **Change type** | Bug fix / Feature / Refactor / Docs / Chore |
| **Scope** | Which layer(s): web, adapter, schemas, infra |
| **Verification** | Which checks you ran and how you tested |
| **Screenshots** | Before/after for any UI change |
| **Security** | Whether permissions, secrets, or network calls changed |

## Issue Guidelines

### Bug reports

A good bug report includes:

- Summary of what's broken
- Steps to reproduce from a clean setup
- Expected vs. actual behavior
- Environment details (OS, Node version, browser, AUTH_MODE)
- Logs or screenshots

### Feature requests

A good feature request includes:

- The user problem you're solving (not just the solution)
- Proposed behavior or API
- Alternatives you considered
- Who benefits and what part of the repo it would touch

## Review Process

- Maintainers aim to review PRs within a few days.
- Be responsive to review feedback — address comments or explain why you disagree.
- If CI fails, fix it before requesting re-review.
- Maintainers may request changes, approve, or close PRs at their discretion.

## Sponsoring

If you find OpenClaw Wrapper useful, consider sponsoring the project:

- **GitHub Sponsors:** [github.com/sponsors/shamuddin](https://github.com/sponsors/shamuddin)

Sponsorship helps fund development time, infrastructure, and continued open-source maintenance. Every contribution matters, regardless of size.

## Community Standards

By participating in this project, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
