import { afterEach, describe, expect, it } from 'vitest';
import { assertExecAllowed, runAdapterExec } from './system-exec.js';

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

function getSuccessCommand(): string {
  return process.platform === 'win32' ? "Write-Output 'exec-ok'" : "printf 'exec-ok\\n'";
}

describe('system-exec policy', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('blocks trusted mode by default in production', () => {
    process.env.NODE_ENV = 'production';
    Reflect.deleteProperty(process.env, 'EXEC_NODE_ALLOW_TRUSTED');

    expect(() =>
      assertExecAllowed({
        command: getSuccessCommand(),
        approvalMode: 'trusted',
      }),
    ).toThrow(/EXEC_NODE_ALLOW_TRUSTED=true/);
  });

  it('blocks elevated mode by default', () => {
    Reflect.deleteProperty(process.env, 'EXEC_NODE_ALLOW_ELEVATED');

    expect(() =>
      assertExecAllowed({
        command: getSuccessCommand(),
        approvalMode: 'elevated',
      }),
    ).toThrow(/EXEC_NODE_ALLOW_ELEVATED=true/);
  });

  it('blocks commands outside an allowed prefix list', () => {
    process.env.EXEC_NODE_ALLOWED_COMMAND_PREFIXES = 'pnpm,node';

    expect(() =>
      assertExecAllowed({
        command: 'npm test',
        approvalMode: 'ask',
      }),
    ).toThrow(/Allowed command prefixes: pnpm, node/);
  });

  it('blocks commands outside an allowed family list', () => {
    process.env.EXEC_NODE_ALLOWED_COMMAND_FAMILIES = 'pnpm,node';

    expect(() =>
      assertExecAllowed({
        command: 'python script.py',
        approvalMode: 'ask',
      }),
    ).toThrow(/Allowed command families: pnpm, node/);
  });

  it('blocks trusted mode commands outside the trusted allowlist', () => {
    process.env.EXEC_NODE_ALLOW_TRUSTED = 'true';
    process.env.EXEC_NODE_TRUSTED_ALLOWED_COMMAND_PREFIXES = 'pnpm,node';

    expect(() =>
      assertExecAllowed({
        command: 'npm test',
        approvalMode: 'trusted',
      }),
    ).toThrow(/Allowed trusted prefixes: pnpm, node/);
  });

  it('blocks elevated mode commands outside the elevated allowlist', () => {
    process.env.EXEC_NODE_ALLOW_ELEVATED = 'true';
    process.env.EXEC_NODE_ELEVATED_ALLOWED_COMMAND_PREFIXES = 'python';

    expect(() =>
      assertExecAllowed({
        command: 'node script.js',
        approvalMode: 'elevated',
      }),
    ).toThrow(/Allowed elevated prefixes: python/);
  });

  it('blocks trusted mode commands outside the trusted family allowlist', () => {
    process.env.EXEC_NODE_ALLOW_TRUSTED = 'true';
    process.env.EXEC_NODE_TRUSTED_ALLOWED_COMMAND_FAMILIES = 'pnpm,node';

    expect(() =>
      assertExecAllowed({
        command: 'python script.py',
        approvalMode: 'trusted',
      }),
    ).toThrow(/Allowed trusted families: pnpm, node/);
  });

  it('blocks workspace-disabled exec even when adapter policy allows it', () => {
    expect(() =>
      assertExecAllowed(
        {
          command: getSuccessCommand(),
          approvalMode: 'ask',
        },
        undefined,
        { enabled: false },
      ),
    ).toThrow(/disabled by workspace policy/i);
  });

  it('blocks workspace command family restrictions', () => {
    expect(() =>
      assertExecAllowed(
        {
          command: 'python script.py',
          approvalMode: 'ask',
        },
        undefined,
        { allowedCommandFamilies: ['pnpm', 'node'] },
      ),
    ).toThrow(/workspace policy. Allowed command families: pnpm, node/);
  });

  it('allows trusted mode when explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.EXEC_NODE_ALLOW_TRUSTED = 'true';

    const result = await runAdapterExec({
      command: getSuccessCommand(),
      approvalMode: 'trusted',
      timeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('exec-ok');
    expect(result.approvalMode).toBe('trusted');
  });
});
