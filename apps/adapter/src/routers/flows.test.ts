import type { GraphNode } from '@openclaw-wrapper/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { validateExecPublishPolicy } from './flows.js';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_EXEC_NODE_ENABLED = process.env.EXEC_NODE_ENABLED;
const ORIGINAL_EXEC_NODE_ALLOW_TRUSTED = process.env.EXEC_NODE_ALLOW_TRUSTED;
const ORIGINAL_EXEC_NODE_ALLOW_ELEVATED = process.env.EXEC_NODE_ALLOW_ELEVATED;
const ORIGINAL_EXEC_NODE_ALLOWED_COMMAND_PREFIXES = process.env.EXEC_NODE_ALLOWED_COMMAND_PREFIXES;
const ORIGINAL_EXEC_NODE_TRUSTED_ALLOWED_COMMAND_PREFIXES =
  process.env.EXEC_NODE_TRUSTED_ALLOWED_COMMAND_PREFIXES;
const ORIGINAL_EXEC_NODE_ELEVATED_ALLOWED_COMMAND_PREFIXES =
  process.env.EXEC_NODE_ELEVATED_ALLOWED_COMMAND_PREFIXES;
const ORIGINAL_EXEC_NODE_ALLOWED_COMMAND_FAMILIES = process.env.EXEC_NODE_ALLOWED_COMMAND_FAMILIES;
const ORIGINAL_EXEC_NODE_TRUSTED_ALLOWED_COMMAND_FAMILIES =
  process.env.EXEC_NODE_TRUSTED_ALLOWED_COMMAND_FAMILIES;
const ORIGINAL_EXEC_NODE_ELEVATED_ALLOWED_COMMAND_FAMILIES =
  process.env.EXEC_NODE_ELEVATED_ALLOWED_COMMAND_FAMILIES;

function restoreOptionalEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = value;
}

function restoreEnv() {
  restoreOptionalEnv('NODE_ENV', ORIGINAL_NODE_ENV);
  restoreOptionalEnv('EXEC_NODE_ENABLED', ORIGINAL_EXEC_NODE_ENABLED);
  restoreOptionalEnv('EXEC_NODE_ALLOW_TRUSTED', ORIGINAL_EXEC_NODE_ALLOW_TRUSTED);
  restoreOptionalEnv('EXEC_NODE_ALLOW_ELEVATED', ORIGINAL_EXEC_NODE_ALLOW_ELEVATED);
  restoreOptionalEnv(
    'EXEC_NODE_ALLOWED_COMMAND_PREFIXES',
    ORIGINAL_EXEC_NODE_ALLOWED_COMMAND_PREFIXES,
  );
  restoreOptionalEnv(
    'EXEC_NODE_TRUSTED_ALLOWED_COMMAND_PREFIXES',
    ORIGINAL_EXEC_NODE_TRUSTED_ALLOWED_COMMAND_PREFIXES,
  );
  restoreOptionalEnv(
    'EXEC_NODE_ELEVATED_ALLOWED_COMMAND_PREFIXES',
    ORIGINAL_EXEC_NODE_ELEVATED_ALLOWED_COMMAND_PREFIXES,
  );
  restoreOptionalEnv(
    'EXEC_NODE_ALLOWED_COMMAND_FAMILIES',
    ORIGINAL_EXEC_NODE_ALLOWED_COMMAND_FAMILIES,
  );
  restoreOptionalEnv(
    'EXEC_NODE_TRUSTED_ALLOWED_COMMAND_FAMILIES',
    ORIGINAL_EXEC_NODE_TRUSTED_ALLOWED_COMMAND_FAMILIES,
  );
  restoreOptionalEnv(
    'EXEC_NODE_ELEVATED_ALLOWED_COMMAND_FAMILIES',
    ORIGINAL_EXEC_NODE_ELEVATED_ALLOWED_COMMAND_FAMILIES,
  );
}

function createExecNode(data: Record<string, unknown>): GraphNode {
  return {
    id: 'exec-1',
    type: 'tool.exec',
    position: { x: 0, y: 0 },
    data: {
      label: 'Run command',
      command: 'pnpm test',
      approvalMode: 'ask',
      ...data,
    },
  };
}

describe('validateExecPublishPolicy', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('rejects exec nodes when exec is disabled', () => {
    process.env.EXEC_NODE_ENABLED = 'false';

    const issues = validateExecPublishPolicy([createExecNode({})]);

    expect(issues).toEqual([
      'Exec node "Run command" cannot be published because adapter exec is disabled (EXEC_NODE_ENABLED=false).',
    ]);
  });

  it('rejects trusted mode when trusted exec is disabled', () => {
    process.env.NODE_ENV = 'production';
    Reflect.deleteProperty(process.env, 'EXEC_NODE_ALLOW_TRUSTED');

    const issues = validateExecPublishPolicy([createExecNode({ approvalMode: 'trusted' })]);

    expect(issues).toEqual([
      'Exec node "Run command" uses Trusted mode, but trusted exec is disabled by adapter policy (EXEC_NODE_ALLOW_TRUSTED=false).',
    ]);
  });

  it('rejects elevated mode when elevated exec is disabled', () => {
    Reflect.deleteProperty(process.env, 'EXEC_NODE_ALLOW_ELEVATED');

    const issues = validateExecPublishPolicy([createExecNode({ approvalMode: 'elevated' })]);

    expect(issues).toEqual([
      'Exec node "Run command" uses Require elevated, but elevated exec is disabled by adapter policy (EXEC_NODE_ALLOW_ELEVATED=false).',
    ]);
  });

  it('rejects static commands outside the configured prefix allowlist', () => {
    process.env.EXEC_NODE_ALLOWED_COMMAND_PREFIXES = 'pnpm,node';

    const issues = validateExecPublishPolicy([createExecNode({ command: 'npm test' })]);

    expect(issues).toEqual([
      'Exec node "Run command" uses a command outside the adapter allowlist. Allowed prefixes: pnpm, node.',
    ]);
  });

  it('rejects static commands outside the configured family allowlist', () => {
    process.env.EXEC_NODE_ALLOWED_COMMAND_FAMILIES = 'pnpm,node';

    const issues = validateExecPublishPolicy([createExecNode({ command: 'python script.py' })]);

    expect(issues).toEqual([
      'Exec node "Run command" uses a command outside the adapter family allowlist. Allowed families: pnpm, node.',
    ]);
  });

  it('rejects trusted mode commands outside the trusted-mode allowlist', () => {
    process.env.EXEC_NODE_ALLOW_TRUSTED = 'true';
    process.env.EXEC_NODE_TRUSTED_ALLOWED_COMMAND_PREFIXES = 'pnpm,node';

    const issues = validateExecPublishPolicy([
      createExecNode({ approvalMode: 'trusted', command: 'npm test' }),
    ]);

    expect(issues).toEqual([
      'Exec node "Run command" uses Trusted with a command outside that mode allowlist. Allowed trusted prefixes: pnpm, node.',
    ]);
  });

  it('rejects elevated mode commands outside the elevated-mode allowlist', () => {
    process.env.EXEC_NODE_ALLOW_ELEVATED = 'true';
    process.env.EXEC_NODE_ELEVATED_ALLOWED_COMMAND_PREFIXES = 'python';

    const issues = validateExecPublishPolicy([
      createExecNode({ approvalMode: 'elevated', command: 'node script.js' }),
    ]);

    expect(issues).toEqual([
      'Exec node "Run command" uses Require elevated with a command outside that mode allowlist. Allowed elevated prefixes: python.',
    ]);
  });

  it('rejects trusted mode commands outside the trusted-mode family allowlist', () => {
    process.env.EXEC_NODE_ALLOW_TRUSTED = 'true';
    process.env.EXEC_NODE_TRUSTED_ALLOWED_COMMAND_FAMILIES = 'pnpm,node';

    const issues = validateExecPublishPolicy([
      createExecNode({ approvalMode: 'trusted', command: 'python script.py' }),
    ]);

    expect(issues).toEqual([
      'Exec node "Run command" uses Trusted with a command outside that mode family allowlist. Allowed trusted families: pnpm, node.',
    ]);
  });

  it('rejects exec nodes when workspace policy disables exec', () => {
    const issues = validateExecPublishPolicy([createExecNode({})], {
      enabled: false,
    });

    expect(issues).toEqual([
      'Exec node "Run command" cannot be published because workspace exec is disabled.',
    ]);
  });

  it('rejects workspace family restrictions for static commands', () => {
    const issues = validateExecPublishPolicy([createExecNode({ command: 'python script.py' })], {
      allowedCommandFamilies: ['pnpm', 'node'],
    });

    expect(issues).toEqual([
      'Exec node "Run command" uses a command outside the workspace family allowlist. Allowed families: pnpm, node.',
    ]);
  });

  it('skips prefix enforcement for templated commands and relies on runtime enforcement', () => {
    process.env.EXEC_NODE_ALLOWED_COMMAND_PREFIXES = 'pnpm';

    const issues = validateExecPublishPolicy([createExecNode({ command: '{{input.command}}' })]);

    expect(issues).toEqual([]);
  });
});
