import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { buildDeviceAuthPayloadV3 } from './device-auth.js';
import {
  type DeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from './device-identity.js';

export interface OpenClawClientOptions {
  url: string;
  token?: string;
  bootstrapToken?: string;
  deviceToken?: string;
  password?: string;
  deviceIdentity?: DeviceIdentity;
  role?: string;
  scopes?: string[];
  requestTimeoutMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  clientId?: string;
  clientDisplayName?: string;
  clientVersion?: string;
  clientMode?: 'webchat' | 'cli' | 'ui' | 'backend' | 'node' | 'probe' | 'test';
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface RequestOptions {
  signal?: AbortSignal;
}

interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    displayName?: string;
    version: string;
    platform: string;
    mode: 'webchat' | 'cli' | 'ui' | 'backend' | 'node' | 'probe' | 'test';
  };
  role?: string;
  scopes?: string[];
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
  auth?: {
    token?: string;
    bootstrapToken?: string;
    deviceToken?: string;
    password?: string;
  };
}

interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
}

export interface OpenClawGatewayEvent {
  event: string;
  payload?: unknown;
}

interface HelloOkPayload {
  type?: 'hello-ok';
  protocol?: number;
}

type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

const PROTOCOL_VERSION = 3;

function isResponseFrame(frame: unknown): frame is ResponseFrame {
  return (
    !!frame &&
    typeof frame === 'object' &&
    (frame as { type?: unknown }).type === 'res' &&
    typeof (frame as { id?: unknown }).id === 'string'
  );
}

function isEventFrame(frame: unknown): frame is EventFrame {
  return (
    !!frame &&
    typeof frame === 'object' &&
    (frame as { type?: unknown }).type === 'event' &&
    typeof (frame as { event?: unknown }).event === 'string'
  );
}

function buildConnectParams(opts: OpenClawClientOptions, nonce: string): ConnectParams {
  const auth =
    opts.token || opts.bootstrapToken || opts.deviceToken || opts.password
      ? {
          ...(opts.token ? { token: opts.token } : {}),
          ...(opts.bootstrapToken ? { bootstrapToken: opts.bootstrapToken } : {}),
          ...(opts.deviceToken ? { deviceToken: opts.deviceToken } : {}),
          ...(opts.password ? { password: opts.password } : {}),
        }
      : undefined;
  const role = opts.role ?? 'operator';
  const scopes = opts.scopes ?? ['operator.admin'];
  const signatureToken = opts.token ?? opts.bootstrapToken ?? opts.deviceToken ?? null;
  const signedAtMs = Date.now();
  const device =
    opts.deviceIdentity !== undefined
      ? {
          id: opts.deviceIdentity.deviceId,
          publicKey: publicKeyRawBase64UrlFromPem(opts.deviceIdentity.publicKeyPem),
          signature: signDevicePayload(
            opts.deviceIdentity.privateKeyPem,
            buildDeviceAuthPayloadV3({
              deviceId: opts.deviceIdentity.deviceId,
              clientId: opts.clientId ?? 'gateway-client',
              clientMode: opts.clientMode ?? 'backend',
              role,
              scopes,
              signedAtMs,
              token: signatureToken,
              nonce,
              platform: process.platform,
            }),
          ),
          signedAt: signedAtMs,
          nonce,
        }
      : undefined;

  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: opts.clientId ?? 'gateway-client',
      displayName: opts.clientDisplayName ?? 'OpenClaw Wrapper',
      version: opts.clientVersion ?? '0.0.0',
      platform: process.platform,
      mode: opts.clientMode ?? 'backend',
    },
    role,
    scopes,
    ...(device ? { device } : {}),
    ...(auth ? { auth } : {}),
  };
}

function createAbortError(): Error {
  const error = new Error('request aborted');
  error.name = 'AbortError';
  return error;
}

interface PendingConnect {
  resolve: () => void;
  reject: (error: Error) => void;
  handshakeStarted: boolean;
}

export class OpenClawClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private connectPromise: Promise<void> | null = null;
  private pendingConnect: PendingConnect | null = null;
  private backoffMs: number;
  private closed = false;
  private handshakeComplete = false;
  private connectChallengeTimer: NodeJS.Timeout | null = null;
  private readonly log: NonNullable<OpenClawClientOptions['logger']>;
  private readonly eventListeners = new Set<(event: OpenClawGatewayEvent) => void>();
  private readonly connectedListeners = new Set<() => void>();

  constructor(private readonly opts: OpenClawClientOptions) {
    this.backoffMs = opts.minBackoffMs ?? 100;
    this.log = opts.logger ?? console;
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error('client closed');
    if (this.ws?.readyState === WebSocket.OPEN && this.handshakeComplete) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.pendingConnect = { resolve, reject, handshakeStarted: false };
      const headers = this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : undefined;
      const ws = new WebSocket(this.opts.url, { headers });
      this.ws = ws;
      this.handshakeComplete = false;

      ws.once('open', () => {
        this.log.info('[openclaw-client] connected', this.opts.url);
        this.armConnectChallengeTimeout();
      });

      ws.once('error', (err) => {
        this.log.warn('[openclaw-client] error', err.message);
        this.pendingConnect?.reject(err);
      });

      ws.on('close', () => {
        this.ws = null;
        this.handshakeComplete = false;
        this.clearConnectChallengeTimeout();
        this.connectPromise = null;
        this.pendingConnect?.reject(new Error('connection closed'));
        this.pendingConnect = null;
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('connection closed'));
          this.pending.delete(id);
        }
        if (!this.closed) this.scheduleReconnect();
      });

      ws.on('message', (data) => this.handleMessage(data.toString()));
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private armConnectChallengeTimeout(): void {
    this.clearConnectChallengeTimeout();
    const timeoutMs = this.opts.requestTimeoutMs ?? 5_000;
    this.connectChallengeTimer = setTimeout(() => {
      this.pendingConnect?.reject(new Error('connect challenge timeout'));
      this.ws?.close(1008, 'connect challenge timeout');
    }, timeoutMs);
    this.connectChallengeTimer.unref?.();
  }

  private clearConnectChallengeTimeout(): void {
    if (this.connectChallengeTimer) {
      clearTimeout(this.connectChallengeTimer);
      this.connectChallengeTimer = null;
    }
  }

  private async sendHandshake(ws: WebSocket, nonce: string): Promise<void> {
    const id = randomUUID();
    const frame: RequestFrame = {
      type: 'req',
      id,
      method: 'connect',
      params: buildConnectParams(this.opts, nonce),
    };
    const timeoutMs = this.opts.requestTimeoutMs ?? 5_000;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('handshake timeout'));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, {
        resolve: (value) => {
          const payload = (value ?? {}) as HelloOkPayload;
          if (payload.type !== 'hello-ok' || payload.protocol !== PROTOCOL_VERSION) {
            reject(new Error('invalid handshake response'));
            return;
          }
          resolve();
        },
        reject,
        timer,
      });

      ws.send(JSON.stringify(frame), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private scheduleReconnect(): void {
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs ?? 30_000);
    setTimeout(() => {
      if (this.closed) return;
      this.connect().catch((e) => this.log.warn('[openclaw-client] reconnect failed', e.message));
    }, delay).unref?.();
  }

  private handleMessage(raw: string): void {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(raw) as GatewayFrame;
    } catch {
      this.log.warn('[openclaw-client] non-JSON frame dropped');
      return;
    }

    if (isEventFrame(frame)) {
      if (frame.event === 'connect.challenge') {
        const nonce =
          frame.payload && typeof frame.payload === 'object'
            ? (frame.payload as { nonce?: unknown }).nonce
            : undefined;
        const normalizedNonce = typeof nonce === 'string' ? nonce.trim() : '';
        if (!normalizedNonce) {
          this.pendingConnect?.reject(new Error('connect challenge missing nonce'));
          this.ws?.close(1008, 'connect challenge missing nonce');
          return;
        }

        const pendingConnect = this.pendingConnect;
        const ws = this.ws;
        if (pendingConnect && !pendingConnect.handshakeStarted && ws) {
          pendingConnect.handshakeStarted = true;
          this.clearConnectChallengeTimeout();
          this.sendHandshake(ws, normalizedNonce)
            .then(() => {
              this.backoffMs = this.opts.minBackoffMs ?? 100;
              this.handshakeComplete = true;
              for (const listener of this.connectedListeners) {
                try {
                  listener();
                } catch (error) {
                  this.log.warn(
                    '[openclaw-client] connected listener failed',
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }
              this.pendingConnect?.resolve();
              this.pendingConnect = null;
            })
            .catch((error) => {
              this.pendingConnect?.reject(
                error instanceof Error ? error : new Error(String(error)),
              );
              this.pendingConnect = null;
            });
        }
      }

      if (frame.event !== 'connect.challenge') {
        for (const listener of this.eventListeners) {
          try {
            listener({ event: frame.event, payload: frame.payload });
          } catch (error) {
            this.log.warn(
              '[openclaw-client] event listener failed',
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }
      return;
    }

    if (!isResponseFrame(frame)) {
      this.log.warn('[openclaw-client] unsupported frame dropped');
      return;
    }

    const pending = this.pending.get(frame.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(frame.id);

    if (!frame.ok) {
      const code = frame.error?.code ?? 'gateway_error';
      const message = frame.error?.message ?? 'Unknown gateway error';
      pending.reject(new Error(`${code}: ${message}`));
      return;
    }

    pending.resolve(frame.payload);
  }

  async request<T = unknown>(
    method: string,
    params: unknown = {},
    options: RequestOptions = {},
  ): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.handshakeComplete) {
      throw new Error('gateway_unreachable');
    }

    if (options.signal?.aborted) {
      throw createAbortError();
    }

    const id = randomUUID();
    const frame: RequestFrame = { type: 'req', id, method, params };
    const timeoutMs = this.opts.requestTimeoutMs ?? 5_000;

    return new Promise<T>((resolve, reject) => {
      const cleanupAbort = () => {
        options.signal?.removeEventListener('abort', abortHandler);
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        cleanupAbort();
        reject(new Error('timeout'));
      }, timeoutMs);
      timer.unref?.();

      const abortHandler = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        cleanupAbort();
        reject(createAbortError());
      };

      this.pending.set(id, {
        resolve: (value) => {
          cleanupAbort();
          resolve(value as T);
        },
        reject: (error) => {
          cleanupAbort();
          reject(error);
        },
        timer,
      });

      options.signal?.addEventListener('abort', abortHandler, { once: true });

      ws.send(JSON.stringify(frame), (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          cleanupAbort();
          reject(err);
        }
      });
    });
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.handshakeComplete;
  }

  onEvent(listener: (event: OpenClawGatewayEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onConnected(listener: () => void): () => void {
    this.connectedListeners.add(listener);
    return () => {
      this.connectedListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.handshakeComplete = false;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('client closed'));
      this.pending.delete(id);
    }
  }
}
