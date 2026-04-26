import { randomUUID } from 'node:crypto';
import type { OpenClawClient } from '@openclaw-wrapper/openclaw-client';
import { getGatewayConnectionManager } from './gateway-manager.js';

interface GatewayAgentAcceptedResponse {
  status?: string;
  runId?: string;
}

interface GatewayAgentWaitResponse {
  runId?: string;
  status?: 'ok' | 'error' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

interface GatewaySessionPreviewItem {
  role?: string;
  text?: string;
}

interface GatewaySessionPreviewEntry {
  key?: string;
  status?: string;
  items?: GatewaySessionPreviewItem[];
}

interface GatewaySessionsPreviewResponse {
  previews?: GatewaySessionPreviewEntry[];
}

interface GatewaySkillStatusEntry {
  name?: string;
  description?: string;
  skillKey?: string;
  eligible?: boolean;
  disabled?: boolean;
  blockedByAllowlist?: boolean;
}

interface GatewaySkillsStatusResponse {
  skills?: GatewaySkillStatusEntry[];
}

interface GatewayCommandEntry {
  name?: string;
  source?: 'native' | 'skill' | 'plugin';
  description?: string;
  textAliases?: string[];
}

interface GatewayCommandsListResponse {
  commands?: GatewayCommandEntry[];
}

interface GatewaySessionCreateResponse {
  ok?: boolean;
  key?: string;
  sessionId?: string;
  entry?: {
    sessionId?: string;
  };
}

interface GatewaySessionSendResponse {
  runId?: string;
  status?: string;
}

interface GatewayAgentSummary {
  id?: string;
  name?: string;
  identity?: {
    name?: string;
  };
  model?: {
    primary?: string;
  };
}

interface GatewayAgentsListResponse {
  defaultId?: string;
  agents?: GatewayAgentSummary[];
}

interface GatewayModelChoice {
  id?: string;
  name?: string;
  provider?: string;
  alias?: string;
}

interface GatewayModelsListResponse {
  models?: GatewayModelChoice[];
}

interface GatewayChannelAccountSnapshot {
  id?: string;
  accountId?: string;
  label?: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
}

interface GatewayChannelsStatusResponse {
  channelOrder?: string[];
  channelLabels?: Record<string, string>;
  channelDetailLabels?: Record<string, string>;
  channelMeta?: Array<{
    id?: string;
    label?: string;
    detailLabel?: string;
  }>;
  channels?: Record<string, unknown>;
  channelAccounts?: Record<string, GatewayChannelAccountSnapshot[]>;
}

interface GatewayDevicePairingPendingRequest {
  requestId?: string;
  deviceId?: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  ts?: number;
}

interface GatewayPairedDeviceSnapshot {
  deviceId?: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  role?: string;
  roles?: string[];
  scopes?: string[];
  approvedScopes?: string[];
  remoteIp?: string;
  createdAtMs?: number;
  approvedAtMs?: number;
}

interface GatewayDevicePairingListResponse {
  pending?: GatewayDevicePairingPendingRequest[];
  paired?: GatewayPairedDeviceSnapshot[];
}

interface GatewayNodePairingPendingRequest {
  requestId?: string;
  nodeId?: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  commands?: string[];
  caps?: string[];
  requiredApproveScopes?: string[];
  remoteIp?: string;
  ts?: number;
}

interface GatewayPairedNodeSnapshot {
  nodeId?: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  commands?: string[];
  caps?: string[];
  remoteIp?: string;
  createdAtMs?: number;
  approvedAtMs?: number;
  lastConnectedAtMs?: number;
}

interface GatewayNodePairingListResponse {
  pending?: GatewayNodePairingPendingRequest[];
  paired?: GatewayPairedNodeSnapshot[];
}

export interface CatalogPrefillOption {
  label: string;
  value: string;
  scope?: string;
}

export interface OpenClawChannelAccountStatus {
  accountId: string;
  label?: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  connected?: boolean;
}

export interface OpenClawChannelRuntimeStatus {
  channelType: string;
  label?: string;
  detailLabel?: string;
  available: boolean;
  configured?: boolean;
  connected?: boolean;
  accounts: OpenClawChannelAccountStatus[];
}

export interface OpenClawRuntimeDevicePendingRequest {
  requestId: string;
  deviceId: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  roles: string[];
  scopes: string[];
  remoteIp?: string;
  requestedAt?: string;
}

export interface OpenClawRuntimePairedDevice {
  deviceId: string;
  displayName?: string;
  platform?: string;
  deviceFamily?: string;
  roles: string[];
  approvedScopes: string[];
  remoteIp?: string;
  createdAt?: string;
  approvedAt?: string;
}

export interface OpenClawRuntimeNodePendingRequest {
  requestId: string;
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  commands: string[];
  capabilities: string[];
  requiredApproveScopes: string[];
  remoteIp?: string;
  requestedAt?: string;
}

export interface OpenClawRuntimePairedNode {
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  commands: string[];
  capabilities: string[];
  remoteIp?: string;
  createdAt?: string;
  approvedAt?: string;
  lastConnectedAt?: string;
}

export interface OpenClawRuntimePairingOverview {
  devices: {
    pending: OpenClawRuntimeDevicePendingRequest[];
    paired: OpenClawRuntimePairedDevice[];
  };
  nodes: {
    pending: OpenClawRuntimeNodePendingRequest[];
    paired: OpenClawRuntimePairedNode[];
  };
}

export interface OpenClawRuntimeDevicePairingDecision {
  requestId: string;
  deviceId: string;
  decision: 'approved' | 'rejected';
}

export interface OpenClawRuntimeNodePairingDecision {
  requestId: string;
  nodeId: string;
  decision: 'approved' | 'rejected';
}

export interface OpenClawNodePrefillContext {
  defaultAgentId?: string;
  agentOptions: CatalogPrefillOption[];
  preferredTargetAgentId?: string;
  skillOptions: CatalogPrefillOption[];
  preferredSkillValue?: string;
  modelProviderOptions: CatalogPrefillOption[];
  modelOptions: CatalogPrefillOption[];
  channelOptions: CatalogPrefillOption[];
  preferredChannelId?: string;
  channelProfileOptions: CatalogPrefillOption[];
  preferredChannelProfileId?: string;
}

export interface OpenClawAgentRunInput {
  agentId: string;
  message: string;
  sessionKey: string;
  extraSystemPrompt?: string;
  model?: string;
  thinking?: string;
  fallbacks?: string[];
  lightContext?: boolean;
  allowUnsafeExternalContent?: boolean;
  toolsAllow?: string[];
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OpenClawRemoteAbortRelayLog {
  level: 'info' | 'warn';
  message: string;
  at: string;
  data: {
    kind: 'remote-cancel-relay';
    provider: 'openclaw';
    relayMethod: 'chat.abort' | 'sessions.abort';
    sessionKey: string;
    gatewayRunId?: string;
    fallbackFrom?: 'chat.abort';
  };
}

export interface OpenClawAgentRunResult {
  agentId: string;
  runId: string;
  sessionKey: string;
  status: 'ok';
  startedAt?: number;
  endedAt?: number;
  replyText?: string;
  previewItems: Array<{ role: string; text: string }>;
  previewStatus?: string;
  previewError?: string;
}

export interface OpenClawSkillRunInput {
  skillName: string;
  message: string;
  sessionKey: string;
  agentId?: string;
  model?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OpenClawSkillRunResult {
  skillName: string;
  commandName: string;
  sessionKey: string;
  sessionId?: string;
  runId?: string;
  status: 'ok';
  sendStatus?: string;
  replyText?: string;
  previewItems: Array<{ role: string; text: string }>;
  previewStatus?: string;
  previewError?: string;
}

interface GatewaySendResponse {
  runId?: string;
  messageId?: string;
  channel?: string;
  chatId?: string;
  channelId?: string;
  toJid?: string;
  conversationId?: string;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function addRemoteAbortRelayLog(
  logs: OpenClawRemoteAbortRelayLog[],
  params: {
    level?: 'info' | 'warn';
    message: string;
    relayMethod: 'chat.abort' | 'sessions.abort';
    sessionKey: string;
    gatewayRunId?: string;
    fallbackFrom?: 'chat.abort';
  },
): void {
  logs.push({
    level: params.level ?? 'info',
    message: params.message,
    at: new Date().toISOString(),
    data: {
      kind: 'remote-cancel-relay',
      provider: 'openclaw',
      relayMethod: params.relayMethod,
      sessionKey: params.sessionKey,
      ...(params.gatewayRunId ? { gatewayRunId: params.gatewayRunId } : {}),
      ...(params.fallbackFrom ? { fallbackFrom: params.fallbackFrom } : {}),
    },
  });
}

type AbortErrorWithRemoteAbortRelayLogs = Error & {
  remoteAbortRelayLogs?: OpenClawRemoteAbortRelayLog[];
};

function attachRemoteAbortRelayLogs(error: unknown, logs: OpenClawRemoteAbortRelayLog[]): unknown {
  if (!isAbortError(error) || logs.length === 0) {
    return error;
  }

  (error as AbortErrorWithRemoteAbortRelayLogs).remoteAbortRelayLogs = logs;
  return error;
}

export function readRemoteAbortRelayLogs(error: unknown): OpenClawRemoteAbortRelayLog[] {
  const logs = (error as AbortErrorWithRemoteAbortRelayLogs | undefined)?.remoteAbortRelayLogs;
  return Array.isArray(logs) ? logs : [];
}

function attachRemoteAbortRelay(params: {
  signal?: AbortSignal;
  onAbort: () => Promise<void>;
}): () => void {
  if (!params.signal) {
    return () => {};
  }

  if (params.signal.aborted) {
    void params.onAbort().catch(() => {
      // Best-effort relay only. Local cancellation still owns the caller-visible outcome.
    });
    return () => {};
  }

  const abortHandler = () => {
    void params.onAbort().catch(() => {
      // Best-effort relay only. Local cancellation still owns the caller-visible outcome.
    });
  };

  params.signal.addEventListener('abort', abortHandler, { once: true });
  return () => {
    params.signal?.removeEventListener('abort', abortHandler);
  };
}

async function requestOpenClawChatAbort(params: {
  client: OpenClawClient;
  sessionKey: string;
  runId?: string;
  relayLogs?: OpenClawRemoteAbortRelayLog[];
}): Promise<void> {
  if (params.relayLogs) {
    addRemoteAbortRelayLog(params.relayLogs, {
      message: `Requested upstream cancellation via chat.abort for session "${params.sessionKey}"`,
      relayMethod: 'chat.abort',
      sessionKey: params.sessionKey,
      gatewayRunId: params.runId,
    });
  }

  await params.client.request(
    'chat.abort',
    {
      sessionKey: params.sessionKey,
      ...(params.runId ? { runId: params.runId } : {}),
    },
    {},
  );
}

async function requestOpenClawSessionAbort(params: {
  client: OpenClawClient;
  sessionKey: string;
  gatewayRunId?: string;
  relayLogs?: OpenClawRemoteAbortRelayLog[];
  fallbackFrom?: 'chat.abort';
}): Promise<void> {
  if (params.relayLogs) {
    addRemoteAbortRelayLog(params.relayLogs, {
      level: params.fallbackFrom ? 'warn' : 'info',
      message: params.fallbackFrom
        ? `Fell back to sessions.abort after ${params.fallbackFrom} was unavailable for session "${params.sessionKey}"`
        : `Requested upstream cancellation via sessions.abort for session "${params.sessionKey}"`,
      relayMethod: 'sessions.abort',
      sessionKey: params.sessionKey,
      gatewayRunId: params.gatewayRunId,
      fallbackFrom: params.fallbackFrom,
    });
  }

  await params.client.request(
    'sessions.abort',
    {
      sessionKey: params.sessionKey,
    },
    {},
  );
}

async function requestOpenClawAgentAbort(params: {
  client: OpenClawClient;
  sessionKey: string;
  runId: string;
  relayLogs?: OpenClawRemoteAbortRelayLog[];
}): Promise<void> {
  try {
    await requestOpenClawChatAbort(params);
  } catch {
    await requestOpenClawSessionAbort({
      client: params.client,
      sessionKey: params.sessionKey,
      gatewayRunId: params.runId,
      relayLogs: params.relayLogs,
      fallbackFrom: 'chat.abort',
    });
  }
}

export interface OpenClawChannelReplyInput {
  channel?: string;
  to: string;
  message: string;
  accountId?: string;
  agentId?: string;
  threadId?: string;
  sessionKey?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface OpenClawChannelReplyResult {
  runId?: string;
  messageId?: string;
  channel: string;
  to: string;
  accountId?: string;
  agentId?: string;
  threadId?: string;
  sessionKey?: string;
  chatId?: string;
  channelId?: string;
  toJid?: string;
  conversationId?: string;
}

function isActiveChannelAccount(account: OpenClawChannelAccountStatus): boolean {
  return account.connected === true || account.running === true;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = normalizeNonEmptyString(value);
    return normalized ? [normalized] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeNonEmptyString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function timestampToIsoString(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function extractReplyText(previewItems: Array<{ role: string; text: string }>): string | undefined {
  const assistantMessages = previewItems.filter(
    (item) => item.role === 'assistant' && item.text.trim().length > 0,
  );
  return assistantMessages.at(-1)?.text;
}

function normalizeLowercase(value: unknown): string {
  return normalizeNonEmptyString(value)?.toLowerCase() ?? '';
}

function normalizePreviewItems(
  previewEntry: GatewaySessionPreviewEntry | undefined,
): Array<{ role: string; text: string }> {
  return (previewEntry?.items ?? [])
    .map((item) => ({
      role: normalizeNonEmptyString(item.role) ?? 'unknown',
      text: normalizeNonEmptyString(item.text) ?? '',
    }))
    .filter((item) => item.text.length > 0);
}

function sanitizeSkillCommandName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const trimmed = normalized.slice(0, 32);
  return trimmed || 'skill';
}

function normalizeSkillLookup(value: unknown): string {
  return normalizeNonEmptyString(value)?.toLowerCase() ?? '';
}

function dedupeCatalogOptions(options: CatalogPrefillOption[]): CatalogPrefillOption[] {
  const seen = new Set<string>();
  const result: CatalogPrefillOption[] = [];

  for (const option of options) {
    const key = normalizeLowercase(option.value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }

  return result;
}

function normalizeLookupText(value: unknown): string {
  return normalizeNonEmptyString(value)?.toLowerCase() ?? '';
}

function slugifyLookupText(value: unknown): string {
  return normalizeLookupText(value).replace(/[^a-z0-9]+/g, '');
}

function getCatalogOptionDisplayLabel(option: CatalogPrefillOption): string {
  const suffix = ` (${option.value})`;
  return option.label.endsWith(suffix) ? option.label.slice(0, -suffix.length) : option.label;
}

function scoreCatalogOptionMatch(input: string, option: CatalogPrefillOption): number {
  const inputKey = normalizeLookupText(input);
  const inputSlug = slugifyLookupText(input);
  if (!inputKey) return 0;

  const optionValueKey = normalizeLookupText(option.value);
  const optionLabelKey = normalizeLookupText(option.label);
  const optionDisplayKey = normalizeLookupText(getCatalogOptionDisplayLabel(option));
  const optionValueSlug = slugifyLookupText(option.value);
  const optionLabelSlug = slugifyLookupText(option.label);
  const optionDisplaySlug = slugifyLookupText(getCatalogOptionDisplayLabel(option));

  if (inputKey === optionValueKey) return 100;
  if (inputKey === optionLabelKey || inputKey === optionDisplayKey) return 96;
  if (inputSlug && inputSlug === optionValueSlug) return 92;
  if (inputSlug && (inputSlug === optionLabelSlug || inputSlug === optionDisplaySlug)) return 88;
  if (inputSlug && optionValueSlug.startsWith(inputSlug)) return 74;
  if (inputSlug && optionDisplaySlug.startsWith(inputSlug)) return 70;
  if (inputSlug && optionValueSlug.includes(inputSlug)) return 60;
  if (inputSlug && (optionLabelSlug.includes(inputSlug) || optionDisplaySlug.includes(inputSlug))) {
    return 56;
  }

  return 0;
}

function resolveCatalogOptionValue(
  input: string | undefined,
  options: CatalogPrefillOption[],
): string | undefined {
  const requested = normalizeNonEmptyString(input);
  if (!requested) return undefined;

  let bestScore = 0;
  let bestValues = new Set<string>();

  for (const option of options) {
    const score = scoreCatalogOptionMatch(requested, option);
    if (score <= 0) continue;

    if (score > bestScore) {
      bestScore = score;
      bestValues = new Set([option.value]);
      continue;
    }

    if (score === bestScore) {
      bestValues.add(option.value);
    }
  }

  if (bestValues.size === 1) {
    return Array.from(bestValues)[0];
  }

  if (bestScore >= 88 && bestValues.size > 1) {
    return Array.from(bestValues)[0];
  }

  return undefined;
}

function buildChannelPrefillContext(status: GatewayChannelsStatusResponse): {
  runtime: OpenClawChannelRuntimeStatus[];
  channelOptions: CatalogPrefillOption[];
  preferredChannelId?: string;
} {
  const channelMetaById = new Map<
    string,
    { label: string | undefined; detailLabel: string | undefined }
  >();
  for (const entry of status.channelMeta ?? []) {
    const id = normalizeNonEmptyString(entry.id);
    if (!id) continue;
    channelMetaById.set(id, {
      label: normalizeNonEmptyString(entry.label),
      detailLabel: normalizeNonEmptyString(entry.detailLabel),
    });
  }

  const channelIds = status.channelOrder?.length
    ? status.channelOrder
    : Object.keys(status.channelLabels ?? {}).length
      ? Object.keys(status.channelLabels ?? {}).sort((left, right) => left.localeCompare(right))
      : Object.keys(status.channels ?? {});

  const runtime: OpenClawChannelRuntimeStatus[] = [];
  for (const channelId of channelIds) {
    const channelType = normalizeNonEmptyString(channelId);
    if (!channelType) continue;

    const meta = channelMetaById.get(channelType);
    const label =
      normalizeNonEmptyString(status.channelLabels?.[channelId]) ?? meta?.label ?? channelType;
    const detailLabel =
      normalizeNonEmptyString(status.channelDetailLabels?.[channelId]) ?? meta?.detailLabel;
    const accounts = (status.channelAccounts?.[channelType] ?? []).map((account, index) => ({
      accountId:
        normalizeNonEmptyString(account.accountId) ??
        normalizeNonEmptyString(account.id) ??
        (index === 0 ? 'default' : `account-${index + 1}`),
      label: normalizeNonEmptyString(account.label),
      enabled: account.enabled,
      configured: account.configured,
      running: account.running,
      connected: account.connected,
    }));

    runtime.push({
      channelType,
      label,
      detailLabel,
      available: true,
      configured: accounts.some((account) => account.configured || account.running),
      connected: accounts.some((account) => account.connected || account.running),
      accounts,
    });
  }

  const channelOptions = dedupeCatalogOptions(
    runtime.map((entry) => ({
      label:
        entry.label && entry.label !== entry.channelType
          ? `${entry.label} (${entry.channelType})`
          : entry.channelType,
      value: entry.channelType,
    })),
  );

  const bestMatch = runtime
    .map((entry, index) => {
      const score = entry.accounts.reduce((best, account) => {
        if (account.connected || account.running) return Math.max(best, 3);
        if (account.configured && account.enabled !== false) return Math.max(best, 2);
        if (account.enabled !== false) return Math.max(best, 1);
        return best;
      }, 0);
      return { value: entry.channelType, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)[0];

  return {
    runtime,
    channelOptions,
    preferredChannelId: bestMatch?.value,
  };
}

async function loadOpenClawChannelPrefillContext(client: OpenClawClient): Promise<{
  runtime: OpenClawChannelRuntimeStatus[];
  channelOptions: CatalogPrefillOption[];
  preferredChannelId?: string;
}> {
  const status = await client.request<GatewayChannelsStatusResponse>('channels.status', {
    probe: false,
    timeoutMs: 2_000,
  });

  return buildChannelPrefillContext(status);
}

export async function loadOpenClawChannelRuntimeStatuses(
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawChannelRuntimeStatus[]> {
  const prefill = await loadOpenClawChannelPrefillContext(client);
  return prefill.runtime;
}

export async function loadOpenClawRuntimePairingOverview(
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawRuntimePairingOverview> {
  const [devicePairingResult, nodePairingResult] = await Promise.allSettled([
    client.request<GatewayDevicePairingListResponse>('device.pair.list', {}),
    client.request<GatewayNodePairingListResponse>('node.pair.list', {}),
  ]);

  const devicePairing =
    devicePairingResult.status === 'fulfilled' ? devicePairingResult.value : undefined;
  const nodePairing =
    nodePairingResult.status === 'fulfilled' ? nodePairingResult.value : undefined;

  return {
    devices: {
      pending: (devicePairing?.pending ?? []).flatMap((entry) => {
        const requestId = normalizeNonEmptyString(entry.requestId);
        const deviceId = normalizeNonEmptyString(entry.deviceId);
        if (!requestId || !deviceId) {
          return [];
        }

        return [
          {
            requestId,
            deviceId,
            displayName: normalizeNonEmptyString(entry.displayName),
            platform: normalizeNonEmptyString(entry.platform),
            deviceFamily: normalizeNonEmptyString(entry.deviceFamily),
            roles: normalizeStringList(entry.roles ?? entry.role),
            scopes: normalizeStringList(entry.scopes),
            remoteIp: normalizeNonEmptyString(entry.remoteIp),
            requestedAt: timestampToIsoString(entry.ts),
          },
        ] satisfies OpenClawRuntimeDevicePendingRequest[];
      }),
      paired: (devicePairing?.paired ?? []).flatMap((entry) => {
        const deviceId = normalizeNonEmptyString(entry.deviceId);
        if (!deviceId) {
          return [];
        }

        return [
          {
            deviceId,
            displayName: normalizeNonEmptyString(entry.displayName),
            platform: normalizeNonEmptyString(entry.platform),
            deviceFamily: normalizeNonEmptyString(entry.deviceFamily),
            roles: normalizeStringList(entry.roles ?? entry.role),
            approvedScopes: normalizeStringList(entry.approvedScopes ?? entry.scopes),
            remoteIp: normalizeNonEmptyString(entry.remoteIp),
            createdAt: timestampToIsoString(entry.createdAtMs),
            approvedAt: timestampToIsoString(entry.approvedAtMs),
          },
        ] satisfies OpenClawRuntimePairedDevice[];
      }),
    },
    nodes: {
      pending: (nodePairing?.pending ?? []).flatMap((entry) => {
        const requestId = normalizeNonEmptyString(entry.requestId);
        const nodeId = normalizeNonEmptyString(entry.nodeId);
        if (!requestId || !nodeId) {
          return [];
        }

        return [
          {
            requestId,
            nodeId,
            displayName: normalizeNonEmptyString(entry.displayName),
            platform: normalizeNonEmptyString(entry.platform),
            version: normalizeNonEmptyString(entry.version),
            coreVersion: normalizeNonEmptyString(entry.coreVersion),
            uiVersion: normalizeNonEmptyString(entry.uiVersion),
            deviceFamily: normalizeNonEmptyString(entry.deviceFamily),
            modelIdentifier: normalizeNonEmptyString(entry.modelIdentifier),
            commands: normalizeStringList(entry.commands),
            capabilities: normalizeStringList(entry.caps),
            requiredApproveScopes: normalizeStringList(entry.requiredApproveScopes),
            remoteIp: normalizeNonEmptyString(entry.remoteIp),
            requestedAt: timestampToIsoString(entry.ts),
          },
        ] satisfies OpenClawRuntimeNodePendingRequest[];
      }),
      paired: (nodePairing?.paired ?? []).flatMap((entry) => {
        const nodeId = normalizeNonEmptyString(entry.nodeId);
        if (!nodeId) {
          return [];
        }

        return [
          {
            nodeId,
            displayName: normalizeNonEmptyString(entry.displayName),
            platform: normalizeNonEmptyString(entry.platform),
            version: normalizeNonEmptyString(entry.version),
            coreVersion: normalizeNonEmptyString(entry.coreVersion),
            uiVersion: normalizeNonEmptyString(entry.uiVersion),
            deviceFamily: normalizeNonEmptyString(entry.deviceFamily),
            modelIdentifier: normalizeNonEmptyString(entry.modelIdentifier),
            commands: normalizeStringList(entry.commands),
            capabilities: normalizeStringList(entry.caps),
            remoteIp: normalizeNonEmptyString(entry.remoteIp),
            createdAt: timestampToIsoString(entry.createdAtMs),
            approvedAt: timestampToIsoString(entry.approvedAtMs),
            lastConnectedAt: timestampToIsoString(entry.lastConnectedAtMs),
          },
        ] satisfies OpenClawRuntimePairedNode[];
      }),
    },
  };
}

export async function approveOpenClawRuntimeDevicePairing(
  requestId: string,
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawRuntimeDevicePairingDecision> {
  const normalizedRequestId = normalizeNonEmptyString(requestId);
  if (!normalizedRequestId) {
    throw new Error('Device pairing request id is required');
  }

  const response = await client.request<{
    requestId?: string;
    device?: {
      deviceId?: string;
    };
  }>('device.pair.approve', {
    requestId: normalizedRequestId,
  });

  const deviceId = normalizeNonEmptyString(response?.device?.deviceId);
  if (!deviceId) {
    throw new Error('Gateway approved the device pairing request but returned no device id');
  }

  return {
    requestId: normalizedRequestId,
    deviceId,
    decision: 'approved',
  };
}

export async function rejectOpenClawRuntimeDevicePairing(
  requestId: string,
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawRuntimeDevicePairingDecision> {
  const normalizedRequestId = normalizeNonEmptyString(requestId);
  if (!normalizedRequestId) {
    throw new Error('Device pairing request id is required');
  }

  const response = await client.request<{
    requestId?: string;
    deviceId?: string;
  }>('device.pair.reject', {
    requestId: normalizedRequestId,
  });

  const deviceId = normalizeNonEmptyString(response?.deviceId);
  if (!deviceId) {
    throw new Error('Gateway rejected the device pairing request but returned no device id');
  }

  return {
    requestId: normalizedRequestId,
    deviceId,
    decision: 'rejected',
  };
}

export async function approveOpenClawRuntimeNodePairing(
  requestId: string,
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawRuntimeNodePairingDecision> {
  const normalizedRequestId = normalizeNonEmptyString(requestId);
  if (!normalizedRequestId) {
    throw new Error('Node pairing request id is required');
  }

  const response = await client.request<{
    requestId?: string;
    paired?: {
      nodeId?: string;
    };
    node?: {
      nodeId?: string;
    };
  }>('node.pair.approve', {
    requestId: normalizedRequestId,
  });

  const nodeId =
    normalizeNonEmptyString(response?.paired?.nodeId) ??
    normalizeNonEmptyString(response?.node?.nodeId);
  if (!nodeId) {
    throw new Error('Gateway approved the node pairing request but returned no node id');
  }

  return {
    requestId: normalizedRequestId,
    nodeId,
    decision: 'approved',
  };
}

export async function rejectOpenClawRuntimeNodePairing(
  requestId: string,
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawRuntimeNodePairingDecision> {
  const normalizedRequestId = normalizeNonEmptyString(requestId);
  if (!normalizedRequestId) {
    throw new Error('Node pairing request id is required');
  }

  const response = await client.request<{
    requestId?: string;
    nodeId?: string;
  }>('node.pair.reject', {
    requestId: normalizedRequestId,
  });

  const nodeId = normalizeNonEmptyString(response?.nodeId);
  if (!nodeId) {
    throw new Error('Gateway rejected the node pairing request but returned no node id');
  }

  return {
    requestId: normalizedRequestId,
    nodeId,
    decision: 'rejected',
  };
}

async function loadSkillOptionsForAgents(params: {
  client: OpenClawClient;
  agentOptions: CatalogPrefillOption[];
  defaultAgentId: string;
}): Promise<{
  skillOptions: CatalogPrefillOption[];
  preferredSkillValue?: string;
}> {
  const orderedAgents = [
    params.defaultAgentId,
    ...params.agentOptions
      .map((option) => option.value)
      .filter((agentId) => agentId !== params.defaultAgentId),
  ].filter((agentId, index, all) => all.indexOf(agentId) === index);

  const agentLabelById = new Map(params.agentOptions.map((option) => [option.value, option.label]));
  const skillStatuses = await Promise.allSettled(
    orderedAgents.map((agentId) =>
      params.client.request<GatewaySkillsStatusResponse>('skills.status', {
        ...(agentId ? { agentId } : {}),
      }),
    ),
  );

  const rawOptions: CatalogPrefillOption[] = [];
  let preferredSkillValue: string | undefined;

  for (const [index, result] of skillStatuses.entries()) {
    if (result.status !== 'fulfilled') continue;
    const agentId = orderedAgents[index];
    if (!agentId) continue;
    const agentLabel = agentLabelById.get(agentId) ?? agentId;

    for (const skill of result.value.skills ?? []) {
      if (skill.disabled || skill.blockedByAllowlist || skill.eligible === false) continue;
      const value = normalizeNonEmptyString(skill.skillKey) ?? normalizeNonEmptyString(skill.name);
      const label = normalizeNonEmptyString(skill.name) ?? value;
      if (!value || !label) continue;

      rawOptions.push({
        label:
          agentId === params.defaultAgentId
            ? value === label
              ? label
              : `${label} (${value})`
            : value === label
              ? `${label} - ${agentLabel}`
              : `${label} (${value}) - ${agentLabel}`,
        value,
        scope: agentId,
      });

      if (!preferredSkillValue && agentId === params.defaultAgentId) {
        preferredSkillValue = value;
      }
    }
  }

  const skillOptions = dedupeCatalogOptions(rawOptions);
  return {
    skillOptions,
    preferredSkillValue: preferredSkillValue ?? skillOptions[0]?.value,
  };
}

function buildSkillCommandMessage(commandName: string, message: string): string {
  const trimmedMessage = message.trim();
  return trimmedMessage.length > 0 ? `/${commandName} ${trimmedMessage}` : `/${commandName}`;
}

async function loadSessionPreview(
  sessionKey: string,
  client: OpenClawClient,
): Promise<{
  previewStatus?: string;
  previewError?: string;
  previewItems: Array<{ role: string; text: string }>;
}> {
  let previewStatus: string | undefined;
  let previewError: string | undefined;
  let previewItems: Array<{ role: string; text: string }> = [];

  try {
    const preview = await client.request<GatewaySessionsPreviewResponse>('sessions.preview', {
      keys: [sessionKey],
      limit: 8,
      maxChars: 800,
    });
    const previewEntry = preview.previews?.find((entry) => entry.key === sessionKey);
    previewStatus = normalizeNonEmptyString(previewEntry?.status);
    previewItems = normalizePreviewItems(previewEntry);
  } catch (error) {
    previewError = error instanceof Error ? error.message : String(error);
  }

  return { previewStatus, previewError, previewItems };
}

async function resolveOpenClawSkillCommand(params: {
  skillName: string;
  agentId?: string;
  client: OpenClawClient;
}): Promise<{
  resolvedSkillName: string;
  skillKey?: string;
  commandName: string;
}> {
  const skillStatus = await params.client.request<GatewaySkillsStatusResponse>('skills.status', {
    ...(params.agentId ? { agentId: params.agentId } : {}),
  });

  const requestedSkillName = normalizeSkillLookup(params.skillName);
  const skillEntry = (skillStatus.skills ?? []).find((entry) => {
    const name = normalizeSkillLookup(entry.name);
    const skillKey = normalizeSkillLookup(entry.skillKey);
    return name === requestedSkillName || skillKey === requestedSkillName;
  });

  if (!skillEntry) {
    throw new Error(
      `OpenClaw skill "${params.skillName}" was not found${params.agentId ? ` for agent "${params.agentId}"` : ''}`,
    );
  }

  const resolvedSkillName = normalizeNonEmptyString(skillEntry.name) ?? params.skillName.trim();
  const resolvedSkillKey = normalizeNonEmptyString(skillEntry.skillKey);

  if (skillEntry.disabled) {
    throw new Error(`OpenClaw skill "${resolvedSkillName}" is disabled`);
  }

  if (skillEntry.blockedByAllowlist) {
    throw new Error(`OpenClaw skill "${resolvedSkillName}" is blocked by the current allowlist`);
  }

  if (skillEntry.eligible === false) {
    throw new Error(`OpenClaw skill "${resolvedSkillName}" is installed but not eligible to run`);
  }

  const commandsList = await params.client.request<GatewayCommandsListResponse>('commands.list', {
    ...(params.agentId ? { agentId: params.agentId } : {}),
    scope: 'text',
    includeArgs: false,
  });

  const skillCommands = (commandsList.commands ?? []).filter(
    (command) => command.source === 'skill',
  );
  const sanitizedCommand = sanitizeSkillCommandName(resolvedSkillName);
  const exactMatch =
    skillCommands.find((command) => normalizeLowercase(command.name) === sanitizedCommand) ??
    skillCommands.find((command) =>
      (command.textAliases ?? []).some(
        (alias) => normalizeLowercase(alias) === `/${sanitizedCommand}`,
      ),
    );

  const prefixedMatches = skillCommands.filter((command) => {
    const name = normalizeLowercase(command.name);
    return name === sanitizedCommand || name.startsWith(`${sanitizedCommand}_`);
  });

  const descriptionMatches = skillCommands.filter(
    (command) =>
      normalizeSkillLookup(command.description) === normalizeSkillLookup(skillEntry.description),
  );

  const resolvedCommand =
    normalizeNonEmptyString(exactMatch?.name) ??
    (prefixedMatches.length === 1
      ? normalizeNonEmptyString(prefixedMatches[0]?.name)
      : undefined) ??
    (descriptionMatches.length === 1
      ? normalizeNonEmptyString(descriptionMatches[0]?.name)
      : undefined);

  if (!resolvedCommand) {
    throw new Error(
      `OpenClaw could not resolve an invocable command for skill "${resolvedSkillName}" via commands.list`,
    );
  }

  return {
    resolvedSkillName,
    skillKey: resolvedSkillKey,
    commandName: resolvedCommand,
  };
}

export async function loadOpenClawNodePrefillContext(
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawNodePrefillContext> {
  const [agentsResult, modelsResult, channelsResult] = await Promise.allSettled([
    client.request<GatewayAgentsListResponse>('agents.list', {}),
    client.request<GatewayModelsListResponse>('models.list', {}),
    client.request<GatewayChannelsStatusResponse>('channels.status', {
      probe: false,
      timeoutMs: 2_000,
    }),
  ]);

  const defaultAgentId =
    agentsResult.status === 'fulfilled'
      ? (normalizeNonEmptyString(agentsResult.value.defaultId) ?? 'main')
      : 'main';

  const agentOptions =
    agentsResult.status === 'fulfilled'
      ? dedupeCatalogOptions(
          (agentsResult.value.agents ?? [])
            .map((agent) => {
              const id = normalizeNonEmptyString(agent.id);
              if (!id) return undefined;
              const label =
                normalizeNonEmptyString(agent.identity?.name) ??
                normalizeNonEmptyString(agent.name) ??
                id;
              return {
                label: label === id ? id : `${label} (${id})`,
                value: id,
              } satisfies CatalogPrefillOption;
            })
            .filter((option): option is CatalogPrefillOption => option !== undefined),
        )
      : [{ label: 'Main (main)', value: 'main' }];

  const preferredTargetAgentId =
    agentOptions.find((option) => option.value !== defaultAgentId)?.value ?? agentOptions[0]?.value;

  const { skillOptions, preferredSkillValue } = await loadSkillOptionsForAgents({
    client,
    agentOptions,
    defaultAgentId,
  });

  const modelOptions =
    modelsResult.status === 'fulfilled'
      ? dedupeCatalogOptions(
          (modelsResult.value.models ?? [])
            .map((model) => {
              const id = normalizeNonEmptyString(model.id);
              if (!id) return undefined;
              const provider = normalizeNonEmptyString(model.provider);
              const alias = normalizeNonEmptyString(model.alias);
              const name = normalizeNonEmptyString(model.name) ?? alias ?? id;
              const label = provider ? `${name} (${provider})` : name;
              return {
                label,
                value: id,
                ...(provider ? { scope: provider } : {}),
              } satisfies CatalogPrefillOption;
            })
            .filter((option): option is CatalogPrefillOption => option !== undefined),
        )
      : [];

  const modelProviderOptions = dedupeCatalogOptions(
    modelOptions
      .map((option) =>
        option.scope
          ? {
              label: option.scope,
              value: option.scope,
            }
          : undefined,
      )
      .filter((option): option is CatalogPrefillOption => option !== undefined),
  );

  const channelPrefill =
    channelsResult.status === 'fulfilled'
      ? buildChannelPrefillContext(channelsResult.value)
      : { runtime: [], channelOptions: [], preferredChannelId: undefined };

  return {
    defaultAgentId,
    agentOptions,
    preferredTargetAgentId,
    skillOptions,
    preferredSkillValue,
    modelProviderOptions,
    modelOptions,
    channelOptions: channelPrefill.channelOptions,
    preferredChannelId: channelPrefill.preferredChannelId,
    channelProfileOptions: [],
    preferredChannelProfileId: undefined,
  };
}

export function buildFlowAgentSessionKey(params: {
  agentId: string;
  flowId: string;
  runId: string;
  nodeId: string;
}): string {
  return `agent:${params.agentId}:flow:${params.flowId}:run:${params.runId}:node:${params.nodeId}`;
}

export function buildFlowSkillSessionKey(params: {
  skillName: string;
  flowId: string;
  runId: string;
  nodeId: string;
  agentId?: string;
}): string {
  const agentScope = normalizeNonEmptyString(params.agentId) ?? 'default';
  const skillScope = sanitizeSkillCommandName(params.skillName);
  return `skill:${agentScope}:${skillScope}:flow:${params.flowId}:run:${params.runId}:node:${params.nodeId}`;
}

export function getOpenClawClient(options?: { eagerConnect?: boolean }): OpenClawClient {
  return getGatewayConnectionManager().getClient(options);
}

export async function runOpenClawAgent(
  input: OpenClawAgentRunInput,
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawAgentRunResult> {
  const remoteAbortRelayLogs: OpenClawRemoteAbortRelayLog[] = [];
  const accepted = await client.request<GatewayAgentAcceptedResponse>(
    'agent',
    {
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      message: input.message,
      deliver: false,
      idempotencyKey: input.idempotencyKey,
      ...(input.extraSystemPrompt ? { extraSystemPrompt: input.extraSystemPrompt } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.thinking ? { thinking: input.thinking } : {}),
      ...(input.fallbacks?.length ? { fallbacks: input.fallbacks } : {}),
      ...(input.lightContext !== undefined ? { lightContext: input.lightContext } : {}),
      ...(input.allowUnsafeExternalContent !== undefined
        ? { allowUnsafeExternalContent: input.allowUnsafeExternalContent }
        : {}),
      ...(input.toolsAllow?.length ? { toolsAllow: input.toolsAllow } : {}),
    },
    { signal: input.signal },
  );

  if (accepted?.status !== 'accepted') {
    throw new Error(
      `OpenClaw agent request was not accepted (status: ${String(accepted?.status)})`,
    );
  }

  const runId = normalizeNonEmptyString(accepted.runId);
  if (!runId) {
    throw new Error('OpenClaw agent request returned an empty runId');
  }

  const detachRemoteAbortRelay = attachRemoteAbortRelay({
    signal: input.signal,
    onAbort: () =>
      requestOpenClawAgentAbort({
        client,
        sessionKey: input.sessionKey,
        runId,
        relayLogs: remoteAbortRelayLogs,
      }),
  });

  let waitResult: GatewayAgentWaitResponse;
  try {
    waitResult = await client.request<GatewayAgentWaitResponse>(
      'agent.wait',
      {
        runId,
        timeoutMs: input.timeoutMs,
      },
      { signal: input.signal },
    );
  } catch (error) {
    throw attachRemoteAbortRelayLogs(error, remoteAbortRelayLogs);
  } finally {
    detachRemoteAbortRelay();
  }

  if (waitResult?.status === 'timeout') {
    throw new Error(`OpenClaw agent timed out after ${input.timeoutMs ?? 30_000}ms`);
  }

  if (waitResult?.status === 'error') {
    throw new Error(waitResult.error || 'OpenClaw agent run failed');
  }

  if (waitResult?.status !== 'ok') {
    throw new Error(
      `OpenClaw agent returned unexpected wait status: ${String(waitResult?.status)}`,
    );
  }
  const { previewStatus, previewError, previewItems } = await loadSessionPreview(
    input.sessionKey,
    client,
  );

  return {
    agentId: input.agentId,
    runId,
    sessionKey: input.sessionKey,
    status: 'ok',
    startedAt: waitResult.startedAt,
    endedAt: waitResult.endedAt,
    replyText: extractReplyText(previewItems),
    previewItems,
    previewStatus,
    previewError,
  };
}

export async function runOpenClawSkill(
  input: OpenClawSkillRunInput,
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawSkillRunResult> {
  const remoteAbortRelayLogs: OpenClawRemoteAbortRelayLog[] = [];
  const resolved = await resolveOpenClawSkillCommand({
    skillName: input.skillName,
    agentId: input.agentId,
    client,
  });

  const createdSession = await client.request<GatewaySessionCreateResponse>(
    'sessions.create',
    {
      key: input.sessionKey,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.model ? { model: input.model } : {}),
    },
    { signal: input.signal },
  );

  const sessionKey = normalizeNonEmptyString(createdSession.key) ?? input.sessionKey;
  const sessionId =
    normalizeNonEmptyString(createdSession.sessionId) ??
    normalizeNonEmptyString(createdSession.entry?.sessionId);

  const detachRemoteAbortRelay = attachRemoteAbortRelay({
    signal: input.signal,
    onAbort: () =>
      requestOpenClawSessionAbort({
        client,
        sessionKey,
        relayLogs: remoteAbortRelayLogs,
      }),
  });

  let sendResult: GatewaySessionSendResponse;
  try {
    sendResult = await client.request<GatewaySessionSendResponse>(
      'sessions.send',
      {
        key: sessionKey,
        message: buildSkillCommandMessage(resolved.commandName, input.message),
        timeoutMs: input.timeoutMs,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      },
      { signal: input.signal },
    );
  } catch (error) {
    throw attachRemoteAbortRelayLogs(error, remoteAbortRelayLogs);
  } finally {
    detachRemoteAbortRelay();
  }

  const { previewStatus, previewError, previewItems } = await loadSessionPreview(
    sessionKey,
    client,
  );

  return {
    skillName: resolved.skillKey ?? resolved.resolvedSkillName,
    commandName: resolved.commandName,
    sessionKey,
    sessionId,
    runId: normalizeNonEmptyString(sendResult.runId),
    status: 'ok',
    sendStatus: normalizeNonEmptyString(sendResult.status),
    replyText: extractReplyText(previewItems),
    previewItems,
    previewStatus,
    previewError,
  };
}

export async function sendOpenClawChannelReply(
  input: OpenClawChannelReplyInput,
  client: OpenClawClient = getOpenClawClient(),
): Promise<OpenClawChannelReplyResult> {
  const to = normalizeNonEmptyString(input.to);
  if (!to) {
    throw new Error('OpenClaw channel reply requires a delivery target');
  }

  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message) {
    throw new Error('OpenClaw channel reply requires a message');
  }

  let accountId = normalizeNonEmptyString(input.accountId);
  const agentId = normalizeNonEmptyString(input.agentId);
  const threadId = normalizeNonEmptyString(input.threadId);
  const sessionKey = normalizeNonEmptyString(input.sessionKey);
  const idempotencyKey = normalizeNonEmptyString(input.idempotencyKey) ?? `send:${randomUUID()}`;
  const requestedChannel = normalizeNonEmptyString(input.channel);
  const { runtime, channelOptions, preferredChannelId } = await loadOpenClawChannelPrefillContext(
    client,
  ).catch(() => ({
    runtime: [] as OpenClawChannelRuntimeStatus[],
    channelOptions: [] as CatalogPrefillOption[],
    preferredChannelId: undefined as string | undefined,
  }));

  let channel = resolveCatalogOptionValue(requestedChannel, channelOptions);
  if (!channel) {
    if (requestedChannel && channelOptions.length > 1) {
      throw new Error(
        `OpenClaw channel "${requestedChannel}" is not available. Choose one of: ${channelOptions
          .map((option) => option.label)
          .join(', ')}`,
      );
    }

    channel = preferredChannelId;
  }

  const selectedRuntime = runtime.find((entry) => entry.channelType === channel);
  const connectedAccounts = (selectedRuntime?.accounts ?? []).filter(isActiveChannelAccount);
  const matchingAccount = accountId
    ? selectedRuntime?.accounts.find(
        (account) => normalizeLowercase(account.accountId) === normalizeLowercase(accountId),
      )
    : undefined;

  if (connectedAccounts.length === 1) {
    const connectedAccountId = connectedAccounts[0]?.accountId;
    if (
      connectedAccountId &&
      (!accountId || !matchingAccount || !isActiveChannelAccount(matchingAccount))
    ) {
      accountId = connectedAccountId;
    }
  }
  let sendResult: GatewaySendResponse;
  try {
    sendResult = await client.request<GatewaySendResponse>(
      'send',
      {
        to,
        message,
        ...(channel ? { channel } : {}),
        ...(accountId ? { accountId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(threadId ? { threadId } : {}),
        ...(sessionKey ? { sessionKey } : {}),
        idempotencyKey,
      },
      { signal: input.signal },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('No active WhatsApp Web listener')) {
      if (connectedAccounts.length > 0) {
        throw new Error(
          `No active WhatsApp listener for account "${accountId ?? 'unknown'}". Active account${connectedAccounts.length === 1 ? '' : 's'} available: ${connectedAccounts
            .map((account) => account.accountId)
            .join(', ')}. Update the channel profile account ID or reconnect that account.`,
        );
      }
      throw new Error(
        'No active WhatsApp listener is running in OpenClaw. Reconnect WhatsApp from Channels, then retry this flow.',
      );
    }
    throw error;
  }

  return {
    runId: normalizeNonEmptyString(sendResult.runId),
    messageId: normalizeNonEmptyString(sendResult.messageId),
    channel: normalizeNonEmptyString(sendResult.channel) ?? channel ?? 'default',
    to,
    accountId,
    agentId,
    threadId,
    sessionKey,
    chatId: normalizeNonEmptyString(sendResult.chatId),
    channelId: normalizeNonEmptyString(sendResult.channelId),
    toJid: normalizeNonEmptyString(sendResult.toJid),
    conversationId: normalizeNonEmptyString(sendResult.conversationId),
  };
}

export async function startOpenClawChannelPairing(
  input: {
    channelType: string;
    accountId?: string;
    force?: boolean;
  },
  client: OpenClawClient = getOpenClawClient(),
): Promise<{
  message?: string;
  qrDataUrl?: string;
}> {
  if (normalizeLowercase(input.channelType) !== 'whatsapp') {
    throw new Error(`Pairing is not supported yet for channel "${input.channelType}"`);
  }

  try {
    return await client.request<{ message?: string; qrDataUrl?: string }>('web.login.start', {
      ...(normalizeNonEmptyString(input.accountId)
        ? { accountId: normalizeNonEmptyString(input.accountId) }
        : {}),
      force: input.force ?? false,
      timeoutMs: 30_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('web login provider is not available')) {
      throw new Error(
        'WhatsApp QR pairing is not available in the connected OpenClaw runtime. Install or enable the WhatsApp web login provider first, then retry pairing.',
      );
    }
    if (message.includes('web login is not supported by provider')) {
      throw new Error(
        'The connected OpenClaw channel provider does not support QR pairing from the gateway.',
      );
    }
    throw error;
  }
}

export async function waitForOpenClawChannelPairing(
  input: {
    channelType: string;
    accountId?: string;
  },
  client: OpenClawClient = getOpenClawClient(),
): Promise<{
  message?: string;
  connected?: boolean;
}> {
  if (normalizeLowercase(input.channelType) !== 'whatsapp') {
    throw new Error(`Pairing is not supported yet for channel "${input.channelType}"`);
  }

  try {
    return await client.request<{ message?: string; connected?: boolean }>('web.login.wait', {
      ...(normalizeNonEmptyString(input.accountId)
        ? { accountId: normalizeNonEmptyString(input.accountId) }
        : {}),
      timeoutMs: 120_000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('web login provider is not available')) {
      throw new Error(
        'WhatsApp QR pairing is not available in the connected OpenClaw runtime. Install or enable the WhatsApp web login provider first, then retry pairing.',
      );
    }
    if (message.includes('web login is not supported by provider')) {
      throw new Error(
        'The connected OpenClaw channel provider does not support QR pairing from the gateway.',
      );
    }
    throw error;
  }
}

export async function logoutOpenClawChannel(
  input: {
    channelType: string;
    accountId?: string;
  },
  client: OpenClawClient = getOpenClawClient(),
): Promise<void> {
  await client.request('channels.logout', {
    channel: input.channelType,
    ...(normalizeNonEmptyString(input.accountId)
      ? { accountId: normalizeNonEmptyString(input.accountId) }
      : {}),
  });
}
