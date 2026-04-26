import type {
  ChannelCatalog,
  ChannelConfigOption,
  ChannelPairingState,
  ChannelProfile,
  ChannelProfileSummary,
  ChannelProfileTemplate,
  ChannelRuntimeStatus,
} from '@openclaw-wrapper/schemas';
import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from './db/client.js';
import type { ChannelProfileRow } from './db/schema.js';
import { channelProfiles } from './db/schema.js';
import {
  type CatalogPrefillOption,
  loadOpenClawChannelRuntimeStatuses,
  logoutOpenClawChannel,
  sendOpenClawChannelReply,
  startOpenClawChannelPairing,
  waitForOpenClawChannelPairing,
} from './openclaw.js';
import { describeStoredSecret, encryptStoredSecrets } from './secret-store.js';

const DM_POLICY_OPTIONS: ChannelConfigOption[] = [
  { label: 'Pairing', value: 'pairing' },
  { label: 'Open', value: 'open' },
  { label: 'Allowlist only', value: 'allowlist' },
];

export const CHANNEL_PROFILE_TEMPLATES: ChannelProfileTemplate[] = [
  {
    id: 'whatsapp-web',
    label: 'WhatsApp Web',
    channelType: 'whatsapp',
    description: 'Pair a live WhatsApp session through QR and route replies from the wrapper.',
    icon: 'MessageCircle',
    pairingMode: 'qr',
    supportsTestSend: true,
    defaults: {
      dmPolicy: 'pairing',
      allowFrom: '',
      welcomeMessage: '',
    },
    fields: [
      {
        key: 'dmPolicy',
        label: 'DM policy',
        type: 'select',
        options: DM_POLICY_OPTIONS,
        description: 'How OpenClaw should treat direct messages for this lane.',
      },
      {
        key: 'allowFrom',
        label: 'Allowlist',
        type: 'textarea',
        placeholder: '+919999999999\n+911234567890',
        description: 'Optional newline-separated sender allowlist.',
      },
      {
        key: 'welcomeMessage',
        label: 'Welcome message',
        type: 'textarea',
        placeholder: 'Thanks for messaging us. How can we help?',
        advanced: true,
      },
    ],
  },
  {
    id: 'whatsapp-cloud',
    label: 'WhatsApp Cloud',
    channelType: 'whatsapp',
    description: 'Store cloud credentials and wrapper routing defaults for Meta-hosted WhatsApp.',
    icon: 'MessageCircle',
    pairingMode: 'none',
    supportsTestSend: true,
    defaults: {
      dmPolicy: 'open',
      allowFrom: '',
    },
    fields: [
      {
        key: 'phoneNumberId',
        label: 'Phone number ID',
        type: 'text',
        required: true,
        placeholder: '123456789012345',
      },
      {
        key: 'businessAccountId',
        label: 'Business account ID',
        type: 'text',
        placeholder: '987654321098765',
      },
      {
        key: 'accessToken',
        label: 'Access token',
        type: 'password',
        required: true,
      },
      {
        key: 'verifyToken',
        label: 'Webhook verify token',
        type: 'password',
      },
      {
        key: 'dmPolicy',
        label: 'DM policy',
        type: 'select',
        options: DM_POLICY_OPTIONS,
      },
      {
        key: 'allowFrom',
        label: 'Allowlist',
        type: 'textarea',
        placeholder: '+919999999999',
      },
    ],
  },
  {
    id: 'telegram-bot',
    label: 'Telegram Bot',
    channelType: 'telegram',
    description: 'Configure a Telegram bot lane and default delivery target from the wrapper.',
    icon: 'Send',
    pairingMode: 'none',
    supportsTestSend: true,
    defaults: {
      allowFrom: '',
    },
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        type: 'password',
        required: true,
      },
      {
        key: 'defaultChatId',
        label: 'Default chat ID',
        type: 'text',
        placeholder: '-1001234567890',
      },
      {
        key: 'allowFrom',
        label: 'Allowlist',
        type: 'textarea',
        placeholder: '123456789',
      },
    ],
  },
  {
    id: 'slack-bot',
    label: 'Slack Bot',
    channelType: 'slack',
    description: 'Store Slack bot credentials and a default channel for wrapper-driven replies.',
    icon: 'MessageCircle',
    pairingMode: 'none',
    supportsTestSend: true,
    defaults: {},
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        type: 'password',
        required: true,
      },
      {
        key: 'appToken',
        label: 'App token',
        type: 'password',
      },
      {
        key: 'defaultChannelId',
        label: 'Default channel ID',
        type: 'text',
        placeholder: 'C0123456789',
      },
    ],
  },
  {
    id: 'discord-bot',
    label: 'Discord Bot',
    channelType: 'discord',
    description: 'Store Discord bot credentials and a preferred guild/channel target.',
    icon: 'MessageCircle',
    pairingMode: 'none',
    supportsTestSend: true,
    defaults: {},
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        type: 'password',
        required: true,
      },
      {
        key: 'guildId',
        label: 'Guild ID',
        type: 'text',
        placeholder: '123456789012345678',
      },
      {
        key: 'defaultChannelId',
        label: 'Default channel ID',
        type: 'text',
        placeholder: '234567890123456789',
      },
    ],
  },
  {
    id: 'youtube-data-api',
    label: 'YouTube Data API',
    channelType: 'youtube',
    description:
      'Store a read-only YouTube Data API key so scheduled agents can inspect public channel and video context.',
    icon: 'Play',
    pairingMode: 'none',
    supportsTestSend: false,
    defaults: {
      channelIds: '',
      maxResults: '5',
      includeStatistics: true,
    },
    fields: [
      {
        key: 'apiKey',
        label: 'YouTube API key',
        type: 'password',
        required: true,
        description:
          'Stored encrypted. API keys are read-only here and only fetch public YouTube Data API metadata.',
      },
      {
        key: 'channelIds',
        label: 'Channel IDs or handles',
        type: 'textarea',
        placeholder: 'UC_x5XG1OV2P6uZZ5FSM9Ttw\n@youtubecreators',
        description:
          'Optional newline- or comma-separated channel IDs/handles the cron agent should monitor.',
      },
      {
        key: 'maxResults',
        label: 'Recent videos per channel',
        type: 'text',
        placeholder: '5',
        description: 'How many recent public videos to preload for each configured channel.',
      },
      {
        key: 'includeStatistics',
        label: 'Include public statistics',
        type: 'boolean',
        description: 'Include public subscriber, view, and video counts when YouTube returns them.',
      },
    ],
  },
  {
    id: 'custom-channel',
    label: 'Custom Channel',
    channelType: 'custom',
    description:
      'A generic wrapper-owned channel profile when the upstream runtime exposes a custom lane.',
    icon: 'Network',
    pairingMode: 'none',
    supportsTestSend: true,
    defaults: {
      notes: '',
    },
    fields: [
      {
        key: 'notes',
        label: 'Notes',
        type: 'textarea',
        placeholder: 'Describe how this custom channel should be used.',
      },
    ],
  },
];

export interface SaveChannelProfileInput {
  id?: string;
  name: string;
  templateId: string;
  channelType?: string;
  agentId?: string;
  accountId?: string;
  routeKey?: string;
  defaultTarget?: string;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
}

export interface SendChannelProfileTestInput {
  id: string;
  to?: string;
  message: string;
  threadId?: string;
}

export interface ChannelExecutionProfile {
  id: string;
  name: string;
  channelType: string;
  agentId?: string;
  accountId?: string;
  routeKey?: string;
  defaultTarget?: string;
  config: Record<string, unknown>;
}

function trimOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getChannelTemplate(templateId: string): ChannelProfileTemplate {
  const template = CHANNEL_PROFILE_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) {
    throw new Error(`Unknown channel template "${templateId}"`);
  }
  return template;
}

function resolveStoredChannelType(
  template: ChannelProfileTemplate,
  inputChannelType: string | undefined,
): string {
  if (template.channelType !== 'custom') {
    return template.channelType;
  }

  const customType = trimOptionalString(inputChannelType);
  if (!customType) {
    throw new Error('Custom channel profiles require a channel type');
  }
  return customType;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function normalizeTemplateValue(
  type: ChannelProfileTemplate['fields'][number]['type'],
  value: unknown,
): unknown {
  if (type === 'boolean') {
    return normalizeBoolean(value);
  }

  return trimOptionalString(value);
}

function sanitizeProfilePayload(params: {
  template: ChannelProfileTemplate;
  config: Record<string, unknown> | undefined;
  secrets: Record<string, string> | undefined;
  existingSecrets?: Record<string, string>;
}): {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
} {
  const nextConfig: Record<string, unknown> = {
    ...((params.template.defaults as Record<string, unknown> | undefined) ?? {}),
  };

  for (const field of params.template.fields) {
    if (field.type === 'password') continue;
    const value = normalizeTemplateValue(field.type, params.config?.[field.key]);
    if (value !== undefined) {
      nextConfig[field.key] = value;
    }
  }

  const nextSecrets = encryptStoredSecrets(params.existingSecrets);
  for (const field of params.template.fields) {
    if (field.type !== 'password') continue;
    const value = trimOptionalString(params.secrets?.[field.key]);
    if (value) {
      nextSecrets[field.key] = encryptStoredSecrets({ [field.key]: value })[field.key] ?? value;
    }
  }

  for (const field of params.template.fields) {
    const value = field.type === 'password' ? nextSecrets[field.key] : nextConfig[field.key];
    if (field.required && value === undefined) {
      throw new Error(`"${field.label}" is required for ${params.template.label}`);
    }
  }

  return {
    config: nextConfig,
    secrets: nextSecrets,
  };
}

function buildRuntimeMap(runtime: ChannelRuntimeStatus[]): Map<string, ChannelRuntimeStatus> {
  return new Map(runtime.map((entry) => [entry.channelType, entry]));
}

function normalizeLookupValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function matchRuntimeForChannelProfile(
  runtime: ChannelRuntimeStatus | undefined,
  accountId?: string | null,
): ChannelRuntimeStatus | undefined {
  if (!runtime) return undefined;

  const requestedAccountId = normalizeLookupValue(accountId ?? undefined);
  if (!requestedAccountId) {
    return runtime;
  }

  const matchingAccount = runtime.accounts.find(
    (account) => normalizeLookupValue(account.accountId) === requestedAccountId,
  );
  if (!matchingAccount) {
    return undefined;
  }

  return {
    ...runtime,
    accounts: [matchingAccount],
    configured: matchingAccount.configured || matchingAccount.running,
    connected: matchingAccount.connected || matchingAccount.running,
  };
}

function buildSecretState(
  template: ChannelProfileTemplate,
  secrets: Record<string, string>,
): ChannelProfile['secretState'] {
  return template.fields
    .filter((field) => field.type === 'password')
    .map((field) => {
      const secret = trimOptionalString(secrets[field.key]);
      const state = describeStoredSecret(secret);
      return {
        key: field.key,
        configured: state.configured,
        preview: state.preview,
      };
    });
}

function serializeSummary(
  row: ChannelProfileRow,
  runtimeMap: Map<string, ChannelRuntimeStatus>,
): ChannelProfileSummary {
  return {
    id: row.id,
    name: row.name,
    templateId: row.templateId,
    channelType: row.channelType,
    agentId: row.agentId ?? undefined,
    accountId: row.accountId ?? undefined,
    routeKey: row.routeKey ?? undefined,
    defaultTarget: row.defaultTarget ?? undefined,
    appliedAt: row.appliedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    runtime: matchRuntimeForChannelProfile(runtimeMap.get(row.channelType), row.accountId),
  };
}

function serializeProfile(
  row: ChannelProfileRow,
  runtimeMap: Map<string, ChannelRuntimeStatus>,
): ChannelProfile {
  const template = getChannelTemplate(row.templateId);
  return {
    ...serializeSummary(row, runtimeMap),
    config: row.config ?? {},
    secretState: buildSecretState(template, row.secrets ?? {}),
  };
}

async function loadRuntimeStatusesSafe(): Promise<ChannelRuntimeStatus[]> {
  return loadOpenClawChannelRuntimeStatuses().catch(() => []);
}

export function buildChannelCatalog(runtime: ChannelRuntimeStatus[] = []): ChannelCatalog {
  return {
    templates: structuredClone(CHANNEL_PROFILE_TEMPLATES),
    runtime,
  };
}

export async function loadChannelCatalog(): Promise<ChannelCatalog> {
  return buildChannelCatalog(await loadRuntimeStatusesSafe());
}

export async function listChannelProfiles(
  db: Db,
  workspaceId: string,
): Promise<ChannelProfileSummary[]> {
  const [runtime, rows] = await Promise.all([
    loadRuntimeStatusesSafe(),
    db
      .select()
      .from(channelProfiles)
      .where(eq(channelProfiles.workspaceId, workspaceId))
      .orderBy(desc(channelProfiles.appliedAt), desc(channelProfiles.updatedAt)),
  ]);

  const runtimeMap = buildRuntimeMap(runtime);
  return rows.map((row) => serializeSummary(row, runtimeMap));
}

export async function getChannelProfile(
  db: Db,
  id: string,
  workspaceId: string,
): Promise<ChannelProfile | null> {
  const [runtime, row] = await Promise.all([
    loadRuntimeStatusesSafe(),
    db.query.channelProfiles.findFirst({
      where: (profiles, { and, eq }) =>
        and(eq(profiles.id, id), eq(profiles.workspaceId, workspaceId)),
    }),
  ]);
  if (!row) return null;
  return serializeProfile(row, buildRuntimeMap(runtime));
}

export async function saveChannelProfile(
  db: Db,
  input: SaveChannelProfileInput,
  workspaceId: string,
): Promise<ChannelProfile> {
  const inputId = input.id;
  const existing = inputId
    ? await db.query.channelProfiles.findFirst({
        where: (profiles, { and, eq }) =>
          and(eq(profiles.id, inputId), eq(profiles.workspaceId, workspaceId)),
      })
    : null;
  if (input.id && !existing) {
    throw new Error('Channel profile not found');
  }

  const name = trimOptionalString(input.name);
  if (!name) {
    throw new Error('Channel profile name is required');
  }

  const template = getChannelTemplate(input.templateId);
  const { config, secrets } = sanitizeProfilePayload({
    template,
    config: input.config,
    secrets: input.secrets,
    existingSecrets: existing?.secrets,
  });

  const now = new Date();
  const payload = {
    workspaceId,
    name,
    templateId: template.id,
    channelType: resolveStoredChannelType(template, input.channelType),
    agentId: trimOptionalString(input.agentId),
    accountId: trimOptionalString(input.accountId),
    routeKey: trimOptionalString(input.routeKey),
    defaultTarget: trimOptionalString(input.defaultTarget),
    config,
    secrets,
    updatedAt: now,
  };

  const [saved] = existing
    ? await db
        .update(channelProfiles)
        .set(payload)
        .where(eq(channelProfiles.id, existing.id))
        .returning()
    : await db
        .insert(channelProfiles)
        .values({
          ...payload,
          createdAt: now,
        })
        .returning();

  if (!saved) {
    throw new Error('Channel profile save failed');
  }

  const runtime = await loadRuntimeStatusesSafe();
  return serializeProfile(saved, buildRuntimeMap(runtime));
}

export async function deleteChannelProfile(
  db: Db,
  id: string,
  workspaceId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(channelProfiles)
    .where(and(eq(channelProfiles.id, id), eq(channelProfiles.workspaceId, workspaceId)))
    .returning({ id: channelProfiles.id });
  return deleted.length > 0;
}

export async function applyChannelProfile(
  db: Db,
  id: string,
  workspaceId: string,
): Promise<ChannelProfile | null> {
  const now = new Date();

  const saved = await db.transaction(async (tx) => {
    await tx
      .update(channelProfiles)
      .set({ appliedAt: null, updatedAt: now })
      .where(and(eq(channelProfiles.workspaceId, workspaceId), ne(channelProfiles.id, id)));

    const [preferred] = await tx
      .update(channelProfiles)
      .set({ appliedAt: now, updatedAt: now })
      .where(and(eq(channelProfiles.id, id), eq(channelProfiles.workspaceId, workspaceId)))
      .returning();

    return preferred ?? null;
  });
  if (!saved) return null;
  const runtime = await loadRuntimeStatusesSafe();
  return serializeProfile(saved, buildRuntimeMap(runtime));
}

export async function startChannelProfilePairing(
  db: Db,
  id: string,
  workspaceId: string,
  force = false,
): Promise<ChannelPairingState> {
  const profile = await db.query.channelProfiles.findFirst({
    where: (profiles, { and, eq }) =>
      and(eq(profiles.id, id), eq(profiles.workspaceId, workspaceId)),
  });
  if (!profile) {
    throw new Error('Channel profile not found');
  }

  return startOpenClawChannelPairing({
    channelType: profile.channelType,
    accountId: profile.accountId ?? undefined,
    force,
  });
}

export async function waitForChannelProfilePairing(
  db: Db,
  id: string,
  workspaceId: string,
): Promise<ChannelPairingState> {
  const profile = await db.query.channelProfiles.findFirst({
    where: (profiles, { and, eq }) =>
      and(eq(profiles.id, id), eq(profiles.workspaceId, workspaceId)),
  });
  if (!profile) {
    throw new Error('Channel profile not found');
  }

  return waitForOpenClawChannelPairing({
    channelType: profile.channelType,
    accountId: profile.accountId ?? undefined,
  });
}

export async function logoutChannelProfile(db: Db, id: string, workspaceId: string): Promise<void> {
  const profile = await db.query.channelProfiles.findFirst({
    where: (profiles, { and, eq }) =>
      and(eq(profiles.id, id), eq(profiles.workspaceId, workspaceId)),
  });
  if (!profile) {
    throw new Error('Channel profile not found');
  }

  await logoutOpenClawChannel({
    channelType: profile.channelType,
    accountId: profile.accountId ?? undefined,
  });
}

export async function sendChannelProfileTest(
  db: Db,
  input: SendChannelProfileTestInput,
  workspaceId: string,
): Promise<{
  profile: ChannelProfileSummary;
  delivery: Awaited<ReturnType<typeof sendOpenClawChannelReply>>;
}> {
  const profile = await db.query.channelProfiles.findFirst({
    where: (profiles, { and, eq }) =>
      and(eq(profiles.id, input.id), eq(profiles.workspaceId, workspaceId)),
  });
  if (!profile) {
    throw new Error('Channel profile not found');
  }

  const delivery = await sendOpenClawChannelReply({
    channel: profile.channelType,
    to: trimOptionalString(input.to) ?? trimOptionalString(profile.defaultTarget) ?? '',
    message: input.message,
    accountId: trimOptionalString(profile.accountId),
    agentId: trimOptionalString(profile.agentId),
    threadId: trimOptionalString(input.threadId),
  });

  const runtime = await loadRuntimeStatusesSafe();
  return {
    profile: serializeSummary(profile, buildRuntimeMap(runtime)),
    delivery,
  };
}

export async function getChannelExecutionProfile(
  db: Db,
  id: string,
  workspaceId: string,
): Promise<ChannelExecutionProfile | null> {
  const profile = await db.query.channelProfiles.findFirst({
    where: (profiles, { and, eq }) =>
      and(eq(profiles.id, id), eq(profiles.workspaceId, workspaceId)),
  });
  if (!profile) return null;

  return {
    id: profile.id,
    name: profile.name,
    channelType: profile.channelType,
    agentId: profile.agentId ?? undefined,
    accountId: profile.accountId ?? undefined,
    routeKey: profile.routeKey ?? undefined,
    defaultTarget: profile.defaultTarget ?? undefined,
    config: profile.config ?? {},
  };
}

export async function listChannelProfilePrefillData(
  db: Db,
  workspaceId: string,
): Promise<{
  options: CatalogPrefillOption[];
  preferredProfileId?: string;
}> {
  const rows = await db
    .select({
      id: channelProfiles.id,
      name: channelProfiles.name,
      channelType: channelProfiles.channelType,
      appliedAt: channelProfiles.appliedAt,
      updatedAt: channelProfiles.updatedAt,
    })
    .from(channelProfiles)
    .where(eq(channelProfiles.workspaceId, workspaceId))
    .orderBy(desc(channelProfiles.appliedAt), desc(channelProfiles.updatedAt));

  const options = rows.map((row) => ({
    label:
      row.name.trim().toLowerCase() === row.channelType.trim().toLowerCase()
        ? row.name
        : `${row.name} (${row.channelType})`,
    value: row.id,
    scope: row.channelType,
  }));

  return {
    options,
    preferredProfileId: rows[0]?.id,
  };
}
