import fs from 'node:fs';
import path from 'node:path';
import {
  type DeviceIdentity,
  OpenClawClient,
  type OpenClawClientOptions,
  loadOrCreateDeviceIdentity,
} from '@openclaw-wrapper/openclaw-client';
import { env } from './env.js';

export interface GatewaySettings {
  url: string;
  token?: string;
  bootstrapToken?: string;
  deviceToken?: string;
  password?: string;
}

interface StoredGatewaySettings {
  version: 1;
  updatedAt: string;
  settings: GatewaySettings;
}

interface GatewayAgentsListResponse {
  defaultId?: string;
  agents?: Array<{ id?: string }>;
}

type SettingsSource = 'env' | 'file';

export interface GatewaySettingsRecord {
  settings: GatewaySettings;
  source: SettingsSource;
  updatedAt?: string;
}

export interface GatewayStatus {
  ok: boolean;
  state: 'connected' | 'pairing_required' | 'auth_error' | 'unreachable' | 'error';
  code?: string;
  message: string;
  detail?: string;
  roundTripMs?: number;
  settings: {
    url: string;
    hasToken: boolean;
    hasBootstrapToken: boolean;
    hasDeviceToken: boolean;
    hasPassword: boolean;
    source: SettingsSource;
    updatedAt?: string;
  };
  deviceIdentity: {
    deviceId: string;
    path: string;
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeSettings(input: Partial<GatewaySettings>): GatewaySettings {
  return {
    url: normalizeOptionalString(input.url) ?? env.GATEWAY_WS_URL,
    token: normalizeOptionalString(input.token),
    bootstrapToken: normalizeOptionalString(input.bootstrapToken),
    deviceToken: normalizeOptionalString(input.deviceToken),
    password: normalizeOptionalString(input.password),
  };
}

function buildEnvSettings(): GatewaySettings {
  return sanitizeSettings({
    url: env.GATEWAY_WS_URL,
    token: env.GATEWAY_TOKEN,
    bootstrapToken: env.GATEWAY_BOOTSTRAP_TOKEN,
    deviceToken: env.GATEWAY_DEVICE_TOKEN,
    password: env.GATEWAY_PASSWORD,
  });
}

function parseGatewayError(
  error: unknown,
): Pick<GatewayStatus, 'state' | 'code' | 'message' | 'detail'> {
  const raw = error instanceof Error ? error.message : String(error);
  const match = raw.match(/^([A-Z_]+):\s*(.*)$/);
  const code = match?.[1];
  const detail = match?.[2] && match[2] !== raw ? match[2] : undefined;
  const lower = raw.toLowerCase();

  if (
    code === 'NOT_PAIRED' ||
    lower.includes('pairing required') ||
    lower.includes('device identity required')
  ) {
    return {
      state: 'pairing_required',
      code: code ?? 'NOT_PAIRED',
      message: 'Gateway requires this wrapper device to be paired or trusted.',
      detail: detail ?? raw,
    };
  }

  if (
    code === 'UNAUTHORIZED' ||
    code === 'FORBIDDEN' ||
    code === 'AUTH_REQUIRED' ||
    code === 'AUTH_INVALID' ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('token mismatch') ||
    lower.includes('password mismatch')
  ) {
    return {
      state: 'auth_error',
      code: code ?? 'AUTH_ERROR',
      message: 'Gateway credentials were rejected.',
      detail: detail ?? raw,
    };
  }

  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('timeout') ||
    lower.includes('gateway_unreachable') ||
    lower.includes('connection closed') ||
    lower.includes('connect challenge')
  ) {
    return {
      state: 'unreachable',
      code,
      message: 'Gateway is unreachable from the adapter.',
      detail: detail ?? raw,
    };
  }

  return {
    state: 'error',
    code,
    message: 'Gateway connection failed.',
    detail: detail ?? raw,
  };
}

class GatewayConnectionManager {
  private client: OpenClawClient | null = null;
  private settingsCache: GatewaySettingsRecord | null = null;

  private resolveSettingsPath(): string {
    return path.join(env.OPENCLAW_WORKSPACE_DIR, '.wrapper', 'gateway-settings.json');
  }

  private resolveIdentityPath(): string {
    return path.join(env.OPENCLAW_WORKSPACE_DIR, '.wrapper', 'gateway-device.json');
  }

  private loadStoredSettings(): GatewaySettingsRecord | null {
    const filePath = this.resolveSettingsPath();

    try {
      if (!fs.existsSync(filePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredGatewaySettings;
      if (
        parsed?.version !== 1 ||
        typeof parsed.updatedAt !== 'string' ||
        typeof parsed.settings !== 'object'
      ) {
        return null;
      }

      return {
        settings: sanitizeSettings(parsed.settings),
        source: 'file',
        updatedAt: parsed.updatedAt,
      };
    } catch {
      return null;
    }
  }

  private ensureSettingsRecord(): GatewaySettingsRecord {
    if (this.settingsCache) return this.settingsCache;
    this.settingsCache = this.loadStoredSettings() ?? {
      settings: buildEnvSettings(),
      source: 'env',
    };
    return this.settingsCache;
  }

  private buildClientOptions(
    settings: GatewaySettings,
    identity: DeviceIdentity,
  ): OpenClawClientOptions {
    return {
      url: settings.url,
      token: settings.token,
      bootstrapToken: settings.bootstrapToken,
      deviceToken: settings.deviceToken,
      password: settings.password,
      deviceIdentity: identity,
      role: 'operator',
      scopes: ['operator.admin'],
      requestTimeoutMs: 60_000,
      minBackoffMs: 100,
      maxBackoffMs: 30_000,
      clientId: 'gateway-client',
      clientDisplayName: 'OpenClaw Wrapper',
      clientVersion: '0.0.0',
      clientMode: 'backend',
    };
  }

  private createClient(settings: GatewaySettings): OpenClawClient {
    const identity = loadOrCreateDeviceIdentity(this.resolveIdentityPath());
    return new OpenClawClient(this.buildClientOptions(settings, identity));
  }

  getSettings(): GatewaySettingsRecord {
    return this.ensureSettingsRecord();
  }

  getIdentityInfo(): { deviceId: string; path: string } {
    const identityPath = this.resolveIdentityPath();
    const identity = loadOrCreateDeviceIdentity(identityPath);
    return { deviceId: identity.deviceId, path: identityPath };
  }

  peekClient(): OpenClawClient | null {
    return this.client;
  }

  getClient(options?: { eagerConnect?: boolean }): OpenClawClient {
    if (this.client) return this.client;
    this.client = this.createClient(this.getSettings().settings);
    if (options?.eagerConnect !== false) {
      this.client.connect().catch((error) => {
        console.warn(
          '[adapter] initial gateway connect failed:',
          error instanceof Error ? error.message : String(error),
        );
      });
    }
    return this.client;
  }

  async updateSettings(input: Partial<GatewaySettings>): Promise<GatewaySettingsRecord> {
    const settings = sanitizeSettings(input);
    const updatedAt = new Date().toISOString();
    const nextRecord: GatewaySettingsRecord = {
      settings,
      source: 'file',
      updatedAt,
    };
    const filePath = this.resolveSettingsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload: StoredGatewaySettings = {
      version: 1,
      updatedAt,
      settings,
    };
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    this.settingsCache = nextRecord;
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
    return nextRecord;
  }

  async probeStatus(): Promise<GatewayStatus> {
    const record = this.getSettings();
    const identity = this.getIdentityInfo();
    const client = this.createClient(record.settings);
    const started = performance.now();

    try {
      const agents = await client.request<GatewayAgentsListResponse>('agents.list', {});
      const roundTripMs = Math.round(performance.now() - started);
      const defaultAgentId = normalizeOptionalString(agents.defaultId);
      const agentCount = agents.agents?.length ?? 0;

      return {
        ok: true,
        state: 'connected',
        message: defaultAgentId
          ? `Connected to gateway (default agent: ${defaultAgentId})`
          : 'Connected to gateway',
        detail:
          agentCount > 0
            ? `Discovered ${agentCount} agent${agentCount === 1 ? '' : 's'}.`
            : undefined,
        roundTripMs,
        settings: {
          url: record.settings.url,
          hasToken: Boolean(record.settings.token),
          hasBootstrapToken: Boolean(record.settings.bootstrapToken),
          hasDeviceToken: Boolean(record.settings.deviceToken),
          hasPassword: Boolean(record.settings.password),
          source: record.source,
          updatedAt: record.updatedAt,
        },
        deviceIdentity: identity,
      };
    } catch (error) {
      const failure = parseGatewayError(error);
      return {
        ok: false,
        ...failure,
        roundTripMs: Math.round(performance.now() - started),
        settings: {
          url: record.settings.url,
          hasToken: Boolean(record.settings.token),
          hasBootstrapToken: Boolean(record.settings.bootstrapToken),
          hasDeviceToken: Boolean(record.settings.deviceToken),
          hasPassword: Boolean(record.settings.password),
          source: record.source,
          updatedAt: record.updatedAt,
        },
        deviceIdentity: identity,
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
}

const manager = new GatewayConnectionManager();

export function getGatewayConnectionManager(): GatewayConnectionManager {
  return manager;
}
