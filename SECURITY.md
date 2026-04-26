# Security Policy

## Supported Versions

OpenClaw Wrapper is in active development. Security fixes land on the latest `main` branch first. Once formal versioning is in place, this table will be updated.

| Version | Supported |
|---------|-----------|
| `main` (latest) | Yes |
| Older commits | Best-effort |

## Reporting a Vulnerability

**Do not report security vulnerabilities in public issues, discussions, or pull requests.**

### How to report

1. Email **[security@openclaw-wrapper.dev](mailto:shamuddin@outlook.com)** with your findings.
2. If you prefer, use [GitHub's private vulnerability reporting](https://github.com/shamuddin/openclaw-wrapper/security/advisories/new).

### What to include

| Field | Description |
|-------|-------------|
| **Title** | Short summary of the vulnerability |
| **Severity** | Your assessment: Critical / High / Medium / Low |
| **Affected component** | Which app, package, or surface (adapter, web, schemas, etc.) |
| **Impact** | What an attacker could achieve |
| **Reproduction steps** | Step-by-step instructions to reproduce |
| **Proof of concept** | Code, curl commands, screenshots, or logs |
| **Environment** | OS, Node version, browser, AUTH_MODE, deployment type |
| **Suggested fix** | If you have one (optional but appreciated) |

Reports without reproduction steps will be deprioritized.

### Response timeline

| Step | Target |
|------|--------|
| Acknowledge receipt | 48 hours |
| Initial assessment | 5 business days |
| Fix or mitigation | Depends on severity — critical issues are prioritized immediately |
| Public disclosure | After affected users have a reasonable path to update |

## Trust Model

### Operator trust boundary

OpenClaw Wrapper follows a **single-operator trust model**:

- The person who deploys the adapter and web app is the trusted operator.
- Authenticated adapter callers (via session tokens or `AUTH_MODE=disabled` local mode) are treated as trusted users within that deployment.
- The adapter trusts the OpenClaw gateway it connects to. The gateway URL and credentials are operator-configured secrets.
- Session identifiers and workspace membership are authorization boundaries, not multi-tenant isolation boundaries.

### What this means in practice

- If multiple people share one adapter deployment, they share the same trust boundary.
- For untrusted-user isolation, deploy separate adapter instances per trust boundary.
- `AUTH_MODE=disabled` is designed for single-user local development. Do not expose it on a network without understanding the implications.

## What Counts as Security-Sensitive

| Category | Examples |
|----------|---------|
| **Auth bypass** | Session token forgery, session fixation, auth mode bypass |
| **Access control** | Workspace access without membership, cross-workspace data leak |
| **Secret disclosure** | Channel secrets, gateway tokens, API keys exposed in responses or logs |
| **Command execution** | Exec node policy bypass, command injection through flow inputs |
| **Trigger forgery** | Unauthorized flow execution via webhook or cron trigger manipulation |
| **Encryption weakness** | AES-GCM misuse in secret store, weak key derivation |
| **Privilege escalation** | Member gaining admin/owner capabilities |
| **Injection** | SQL injection, XSS, template injection through flow data |

## Out of Scope

The following are **not** considered vulnerabilities in this project's trust model:

- Issues that require the attacker to already be a trusted operator or workspace owner
- `AUTH_MODE=disabled` being "insecure" — it is intentionally open for local development
- Prompt injection or AI model manipulation (the wrapper does not run an AI model directly)
- Issues in the upstream OpenClaw gateway (report those to the [OpenClaw project](https://github.com/openclaw/openclaw))
- Denial of service via resource exhaustion on a local deployment
- Issues that require physical access to the host machine
- Scanner-only findings without a working proof of concept

## Deployment Hardening

If you deploy OpenClaw Wrapper beyond local development, review these settings:

### Required for production

| Setting | Guidance |
|---------|----------|
| `AUTH_MODE` | Set to `required` for any multi-user or network-exposed deployment |
| `CHANNEL_SECRET_KEY` | Replace with a long random secret (`openssl rand -hex 32`). Used for AES-256-GCM encryption of channel credentials at rest |
| `GATEWAY_TOKEN` | Use a strong, unique token. Rotate if it has ever been committed or shared |
| `CORS_ORIGIN` | Set to your actual frontend origin. Do not use `*` |

### Recommended

| Setting | Guidance |
|---------|----------|
| `EXEC_NODE_ENABLED` | Leave disabled unless you specifically need shell execution in flows |
| `EXEC_NODE_ALLOW_TRUSTED` | Keep `false` in production unless you understand the implications |
| `EXEC_NODE_ALLOWED_COMMAND_PREFIXES` | Restrict to known-safe commands when exec is enabled |
| Database | Use a dedicated Postgres user with minimal privileges. Do not use the default `postgres` superuser |
| Redis | Use password authentication. Do not expose Redis to the network |
| Network | Keep adapter and database on a private network. Only expose the web app through a reverse proxy with TLS |
| Docker | Run containers as non-root. Use `--cap-drop=ALL` where possible |

### Exec node policy

The adapter enforces a layered exec policy for shell execution nodes in published flows:

- **Global toggle:** `EXEC_NODE_ENABLED` (default: true)
- **Approval modes:** `ask` (human approval), `trusted` (auto-run), `elevated` (privileged)
- **Command allowlists:** prefix-based and family-based restrictions at global and per-mode levels
- **Workspace policy:** per-workspace overrides for enabled state and command families

Review [docs/configuration-and-security.md](docs/configuration-and-security.md) for full details.

## Security Scanning

This project uses Biome for static analysis and CI runs lint, typecheck, and test on every PR. Additional security tooling (dependency scanning, secret detection) may be added as the project matures.

To check for known dependency vulnerabilities locally:

```bash
pnpm audit
```

## Responsible Disclosure

We believe in responsible disclosure. We will:

- Work with you to understand and validate the issue
- Keep you informed about the fix timeline
- Credit you in the release notes (unless you prefer to remain anonymous)
- Not pursue legal action against researchers acting in good faith

Thank you for helping keep OpenClaw Wrapper and its users safe.
