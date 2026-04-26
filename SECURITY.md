# Security Policy

## Supported Use

OpenClaw Wrapper is currently in active development. Until formal versioning and release channels are in place, security fixes should be assumed to land on the latest main development line first.

## Reporting A Vulnerability

Please do not report security vulnerabilities in public issues, discussions, or pull requests.

For now, use a private maintainer contact channel and include:

- a short summary of the issue
- the affected area
- reproduction steps or a proof of concept
- impact assessment if known
- any suggested remediation

If a dedicated security contact or mailbox is added later, this file should be updated to point at it directly.

## What Counts As Security-Sensitive Here

Examples include:

- auth or session bypass
- workspace or flow access-control issues
- secret disclosure
- unsafe command execution paths
- webhook or trigger forgery
- encryption or secret-storage weaknesses
- privilege escalation through runtime or adapter surfaces

## Response Expectations

The project should aim to:

- acknowledge receipt quickly
- reproduce and assess impact
- prepare a fix or mitigation
- disclose responsibly after affected users have a reasonable path to update

## Deployment Notes

This repo includes local-first defaults, but production deployments should treat these areas carefully:

- rotate `CHANNEL_SECRET_KEY`
- use `AUTH_MODE=required` unless the deployment is intentionally single-user/local
- review gateway credentials and origin settings
- review exec-node policy before enabling trusted or elevated execution

Additional deployment and hardening notes may be published later, but this file is the current public source of security guidance for the repository.
