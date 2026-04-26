import { spawn } from 'node:child_process';
import path from 'node:path';
import type { WorkspaceExecPolicy } from '@openclaw-wrapper/schemas';

export interface AdapterExecInput {
  command: string;
  approvalMode?: 'ask' | 'elevated' | 'trusted';
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AdapterExecResult {
  command: string;
  approvalMode: 'ask' | 'elevated' | 'trusted';
  shell: 'powershell' | 'sh';
  cwd: string;
  timeoutMs: number;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  elevatedRequested: boolean;
}

interface ShellInvocation {
  command: string;
  args: string[];
  label: AdapterExecResult['shell'];
}

export interface ExecPolicyRestrictions {
  enabled?: boolean;
  allowTrusted?: boolean;
  allowElevated?: boolean;
  allowedCommandPrefixes?: string[];
  trustedCommandPrefixes?: string[];
  elevatedCommandPrefixes?: string[];
  allowedCommandFamilies?: string[];
  trustedCommandFamilies?: string[];
  elevatedCommandFamilies?: string[];
}

export interface ExecRuntimePolicy extends Required<ExecPolicyRestrictions> {}

function normalizeCommand(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeApprovalMode(value: unknown): AdapterExecResult['approvalMode'] {
  return value === 'elevated' || value === 'trusted' ? value : 'ask';
}

function normalizeTimeoutMs(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 30_000;
  }
  return Math.min(parsed, 300_000);
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (typeof raw !== 'string') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizePolicyList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
}

function readPolicyListEnv(name: string): string[] {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return [];
  }

  return normalizePolicyList(raw.split(','));
}

function readOptionalPolicyBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function normalizeWorkspaceExecPolicy(value: unknown): WorkspaceExecPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    enabled: readOptionalPolicyBoolean(record.enabled),
    allowTrusted: readOptionalPolicyBoolean(record.allowTrusted),
    allowElevated: readOptionalPolicyBoolean(record.allowElevated),
    allowedCommandPrefixes: normalizePolicyList(record.allowedCommandPrefixes),
    trustedCommandPrefixes: normalizePolicyList(record.trustedCommandPrefixes),
    elevatedCommandPrefixes: normalizePolicyList(record.elevatedCommandPrefixes),
    allowedCommandFamilies: normalizePolicyList(record.allowedCommandFamilies),
    trustedCommandFamilies: normalizePolicyList(record.trustedCommandFamilies),
    elevatedCommandFamilies: normalizePolicyList(record.elevatedCommandFamilies),
  };
}

export function matchesAllowedPrefix(command: string, prefix: string): boolean {
  const normalizedCommand = command.trim().toLowerCase();
  const normalizedPrefix = prefix.trim().toLowerCase();
  if (!normalizedCommand.startsWith(normalizedPrefix)) {
    return false;
  }
  if (normalizedCommand.length === normalizedPrefix.length) {
    return true;
  }

  const next = normalizedCommand[normalizedPrefix.length];
  return typeof next === 'string' && /[\s;&|()]/u.test(next);
}

function readCommandToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return '';
  }

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    return end > 1 ? trimmed.slice(1, end) : trimmed.slice(1);
  }

  const match = trimmed.match(/^[^\s;&|()]+/u);
  return match?.[0] ?? trimmed;
}

export function readCommandFamily(command: string): string {
  const token = readCommandToken(command);
  if (!token) {
    return '';
  }

  const normalizedToken = token.replace(/^['"]|['"]$/g, '');
  const base = path.win32.basename(path.posix.basename(normalizedToken));
  return base
    .replace(/\.(cmd|bat|exe|ps1|sh)$/iu, '')
    .trim()
    .toLowerCase();
}

export function matchesAllowedFamily(command: string, family: string): boolean {
  const normalizedFamily = family.trim().toLowerCase();
  if (!normalizedFamily) {
    return false;
  }
  return readCommandFamily(command) === normalizedFamily;
}

export function resolveExecRuntimePolicy(): ExecRuntimePolicy {
  const isProduction = (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
  return {
    enabled: readBooleanEnv('EXEC_NODE_ENABLED', true),
    allowTrusted: readBooleanEnv('EXEC_NODE_ALLOW_TRUSTED', !isProduction),
    allowElevated: readBooleanEnv('EXEC_NODE_ALLOW_ELEVATED', false),
    allowedCommandPrefixes: readPolicyListEnv('EXEC_NODE_ALLOWED_COMMAND_PREFIXES'),
    trustedCommandPrefixes: readPolicyListEnv('EXEC_NODE_TRUSTED_ALLOWED_COMMAND_PREFIXES'),
    elevatedCommandPrefixes: readPolicyListEnv('EXEC_NODE_ELEVATED_ALLOWED_COMMAND_PREFIXES'),
    allowedCommandFamilies: readPolicyListEnv('EXEC_NODE_ALLOWED_COMMAND_FAMILIES'),
    trustedCommandFamilies: readPolicyListEnv('EXEC_NODE_TRUSTED_ALLOWED_COMMAND_FAMILIES'),
    elevatedCommandFamilies: readPolicyListEnv('EXEC_NODE_ELEVATED_ALLOWED_COMMAND_FAMILIES'),
  };
}

function getModeSpecificRestrictions(
  approvalMode: AdapterExecResult['approvalMode'],
  policy: ExecPolicyRestrictions,
): { prefixes: string[]; families: string[] } {
  switch (approvalMode) {
    case 'trusted':
      return {
        prefixes: policy.trustedCommandPrefixes ?? [],
        families: policy.trustedCommandFamilies ?? [],
      };
    case 'elevated':
      return {
        prefixes: policy.elevatedCommandPrefixes ?? [],
        families: policy.elevatedCommandFamilies ?? [],
      };
    default:
      return {
        prefixes: [],
        families: [],
      };
  }
}

export function getExecModeAllowedPrefixes(
  approvalMode: AdapterExecResult['approvalMode'],
  policy: ExecPolicyRestrictions,
): string[] {
  return getModeSpecificRestrictions(approvalMode, policy).prefixes;
}

export function getExecModeAllowedFamilies(
  approvalMode: AdapterExecResult['approvalMode'],
  policy: ExecPolicyRestrictions,
): string[] {
  return getModeSpecificRestrictions(approvalMode, policy).families;
}

function assertAllowedByRuleSet(params: {
  command: string;
  allowed: string[];
  matcher: (command: string, rule: string) => boolean;
  message: string;
}): void {
  if (params.allowed.length === 0) {
    return;
  }

  if (!params.allowed.some((rule) => params.matcher(params.command, rule))) {
    throw new Error(params.message);
  }
}

function assertPolicyAllowed(
  input: AdapterExecInput,
  policy: ExecPolicyRestrictions,
  scopeLabel: 'adapter' | 'workspace',
): void {
  const command = normalizeCommand(input.command);
  const approvalMode = normalizeApprovalMode(input.approvalMode);

  if (policy.enabled === false) {
    throw new Error(
      scopeLabel === 'adapter'
        ? 'Exec node is disabled by adapter policy. Set EXEC_NODE_ENABLED=true to allow adapter shell execution.'
        : 'Exec node is disabled by workspace policy.',
    );
  }

  if (approvalMode === 'trusted' && policy.allowTrusted === false) {
    throw new Error(
      scopeLabel === 'adapter'
        ? 'Exec trusted mode is disabled by adapter policy. Use Ask mode behind an Approval step or set EXEC_NODE_ALLOW_TRUSTED=true.'
        : 'Exec trusted mode is disabled by workspace policy.',
    );
  }

  if (approvalMode === 'elevated' && policy.allowElevated === false) {
    throw new Error(
      scopeLabel === 'adapter'
        ? 'Exec elevated mode is disabled by adapter policy. Use Ask mode behind an Approval step or set EXEC_NODE_ALLOW_ELEVATED=true. Elevated mode still does not grant OS-level privileges by itself.'
        : 'Exec elevated mode is disabled by workspace policy. Elevated mode still does not grant OS-level privileges by itself.',
    );
  }

  assertAllowedByRuleSet({
    command,
    allowed: policy.allowedCommandPrefixes ?? [],
    matcher: matchesAllowedPrefix,
    message:
      scopeLabel === 'adapter'
        ? `Exec command is blocked by adapter policy. Allowed command prefixes: ${policy.allowedCommandPrefixes?.join(', ')}`
        : `Exec command is blocked by workspace policy. Allowed command prefixes: ${policy.allowedCommandPrefixes?.join(', ')}`,
  });

  assertAllowedByRuleSet({
    command,
    allowed: policy.allowedCommandFamilies ?? [],
    matcher: matchesAllowedFamily,
    message:
      scopeLabel === 'adapter'
        ? `Exec command is blocked by adapter policy. Allowed command families: ${policy.allowedCommandFamilies?.join(', ')}`
        : `Exec command is blocked by workspace policy. Allowed command families: ${policy.allowedCommandFamilies?.join(', ')}`,
  });

  const modeAllowedPrefixes = getExecModeAllowedPrefixes(approvalMode, policy);
  if (modeAllowedPrefixes.length > 0) {
    const modeLabel = approvalMode === 'trusted' ? 'trusted' : 'elevated';
    assertAllowedByRuleSet({
      command,
      allowed: modeAllowedPrefixes,
      matcher: matchesAllowedPrefix,
      message:
        scopeLabel === 'adapter'
          ? `Exec ${modeLabel} mode command is blocked by adapter policy. Allowed ${modeLabel} prefixes: ${modeAllowedPrefixes.join(', ')}`
          : `Exec ${modeLabel} mode command is blocked by workspace policy. Allowed ${modeLabel} prefixes: ${modeAllowedPrefixes.join(', ')}`,
    });
  }

  const modeAllowedFamilies = getExecModeAllowedFamilies(approvalMode, policy);
  if (modeAllowedFamilies.length > 0) {
    const modeLabel = approvalMode === 'trusted' ? 'trusted' : 'elevated';
    assertAllowedByRuleSet({
      command,
      allowed: modeAllowedFamilies,
      matcher: matchesAllowedFamily,
      message:
        scopeLabel === 'adapter'
          ? `Exec ${modeLabel} mode command is blocked by adapter policy. Allowed ${modeLabel} families: ${modeAllowedFamilies.join(', ')}`
          : `Exec ${modeLabel} mode command is blocked by workspace policy. Allowed ${modeLabel} families: ${modeAllowedFamilies.join(', ')}`,
    });
  }
}

export function assertExecAllowed(
  input: AdapterExecInput,
  runtimePolicy = resolveExecRuntimePolicy(),
  workspacePolicy?: WorkspaceExecPolicy,
): void {
  assertPolicyAllowed(input, runtimePolicy, 'adapter');

  const normalizedWorkspacePolicy = normalizeWorkspaceExecPolicy(workspacePolicy);
  if (
    normalizedWorkspacePolicy.enabled === undefined &&
    normalizedWorkspacePolicy.allowTrusted === undefined &&
    normalizedWorkspacePolicy.allowElevated === undefined &&
    (normalizedWorkspacePolicy.allowedCommandPrefixes?.length ?? 0) === 0 &&
    (normalizedWorkspacePolicy.trustedCommandPrefixes?.length ?? 0) === 0 &&
    (normalizedWorkspacePolicy.elevatedCommandPrefixes?.length ?? 0) === 0 &&
    (normalizedWorkspacePolicy.allowedCommandFamilies?.length ?? 0) === 0 &&
    (normalizedWorkspacePolicy.trustedCommandFamilies?.length ?? 0) === 0 &&
    (normalizedWorkspacePolicy.elevatedCommandFamilies?.length ?? 0) === 0
  ) {
    return;
  }

  assertPolicyAllowed(input, normalizedWorkspacePolicy, 'workspace');
}

function getShellInvocation(command: string): ShellInvocation {
  if (process.platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', command],
      label: 'powershell',
    };
  }

  return {
    command: '/bin/sh',
    args: ['-lc', command],
    label: 'sh',
  };
}

function summarizeStderr(stderr: string): string | undefined {
  const compact = stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return compact;
}

export async function runAdapterExec(
  input: AdapterExecInput,
  workspacePolicy?: WorkspaceExecPolicy,
): Promise<AdapterExecResult> {
  const command = normalizeCommand(input.command);
  if (!command) {
    throw new Error('exec node requires a command');
  }

  const approvalMode = normalizeApprovalMode(input.approvalMode);
  const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
  assertExecAllowed(
    { command, approvalMode, timeoutMs },
    resolveExecRuntimePolicy(),
    workspacePolicy,
  );
  const shell = getShellInvocation(command);
  const cwd = process.cwd();
  const startedAt = Date.now();

  const createAbortError = () => {
    const error = new Error('exec node was cancelled');
    error.name = 'AbortError';
    return error;
  };

  return await new Promise<AdapterExecResult>((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const child = spawn(shell.command, shell.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const finish = (handler: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abortHandler);
      handler();
    };

    const abortHandler = () => {
      aborted = true;
      child.kill();
    };

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      finish(() => reject(new Error(`exec node failed to start: ${error.message}`)));
    });

    child.once('close', (code, signal) => {
      const durationMs = Date.now() - startedAt;
      const exitCode = typeof code === 'number' ? code : signal ? 1 : 0;

      if (timedOut || (signal === 'SIGTERM' && durationMs >= timeoutMs)) {
        finish(() => reject(new Error(`exec node timed out after ${timeoutMs}ms`)));
        return;
      }

      if (aborted) {
        finish(() => reject(createAbortError()));
        return;
      }

      if (exitCode !== 0) {
        const summary = summarizeStderr(stderr);
        finish(() =>
          reject(
            new Error(
              `exec command failed with exit code ${exitCode}${summary ? `: ${summary}` : ''}`,
            ),
          ),
        );
        return;
      }

      finish(() =>
        resolve({
          command,
          approvalMode,
          shell: shell.label,
          cwd,
          timeoutMs,
          durationMs,
          exitCode,
          stdout,
          stderr,
          elevatedRequested: approvalMode === 'elevated',
        }),
      );
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref?.();

    input.signal?.addEventListener('abort', abortHandler, { once: true });
  });
}
