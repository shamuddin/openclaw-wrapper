import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { OpenClawClient } from './client.js';
import { loadOrCreateDeviceIdentity } from './device-identity.js';

describe('OpenClawClient', () => {
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const addr = wss.address();
    if (typeof addr === 'string' || addr === null) throw new Error('no port');
    port = addr.port;
  });

  afterEach(() => {
    for (const c of wss.clients) c.terminate();
    wss.close();
  });

  it('routes responses by correlation ID', async () => {
    wss.on('connection', (socket) => {
      socket.send(
        JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'nonce-1' },
        }),
      );
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.method === 'connect') {
          socket.send(
            JSON.stringify({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: { type: 'hello-ok', protocol: 3 },
            }),
          );
          return;
        }

        socket.send(
          JSON.stringify({
            type: 'res',
            id: frame.id,
            ok: true,
            payload: { echo: frame.params },
          }),
        );
      });
    });

    const client = new OpenClawClient({
      url: `ws://127.0.0.1:${port}`,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const [a, b] = await Promise.all([
      client.request<{ echo: unknown }>('test', { n: 1 }),
      client.request<{ echo: unknown }>('test', { n: 2 }),
    ]);

    expect(a.echo).toEqual({ n: 1 });
    expect(b.echo).toEqual({ n: 2 });
    await client.close();
  });

  it('rejects with timeout when no reply comes', async () => {
    wss.on('connection', (socket) => {
      socket.send(
        JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'nonce-2' },
        }),
      );
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.method === 'connect') {
          socket.send(
            JSON.stringify({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: { type: 'hello-ok', protocol: 3 },
            }),
          );
        }
      });
    });

    const client = new OpenClawClient({
      url: `ws://127.0.0.1:${port}`,
      requestTimeoutMs: 50,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await expect(client.request('test')).rejects.toThrow(/timeout/);
    await client.close();
  });

  it('rejects an in-flight request when aborted', async () => {
    wss.on('connection', (socket) => {
      socket.send(
        JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'nonce-abort' },
        }),
      );
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.method === 'connect') {
          socket.send(
            JSON.stringify({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: { type: 'hello-ok', protocol: 3 },
            }),
          );
        }
      });
    });

    const client = new OpenClawClient({
      url: `ws://127.0.0.1:${port}`,
      requestTimeoutMs: 500,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const controller = new AbortController();
    const pending = client.request('test', { n: 1 }, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/i);
    await client.close();
  });

  it('includes extended auth fields in the connect handshake when configured', async () => {
    let handshakeFrame: Record<string, unknown> | undefined;
    const identity = loadOrCreateDeviceIdentity(
      path.join(os.tmpdir(), 'openclaw-wrapper-device-test.json'),
    );

    wss.on('connection', (socket) => {
      socket.send(
        JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'nonce-3' },
        }),
      );
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.method === 'connect') {
          handshakeFrame = frame;
          socket.send(
            JSON.stringify({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: { type: 'hello-ok', protocol: 3 },
            }),
          );
        }
      });
    });

    const client = new OpenClawClient({
      url: `ws://127.0.0.1:${port}`,
      token: 'gateway-token',
      bootstrapToken: 'bootstrap-token',
      deviceToken: 'device-token',
      password: 'gateway-password',
      deviceIdentity: identity,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    await client.connect();

    expect(handshakeFrame).toMatchObject({
      type: 'req',
      method: 'connect',
      params: {
        auth: {
          token: 'gateway-token',
          bootstrapToken: 'bootstrap-token',
          deviceToken: 'device-token',
          password: 'gateway-password',
        },
        role: 'operator',
        scopes: ['operator.admin'],
        device: {
          id: identity.deviceId,
          nonce: 'nonce-3',
        },
      },
    });

    await client.close();
  });

  it('notifies connected and event listeners for live gateway events', async () => {
    const connected = { count: 0 };
    const events: Array<{ event: string; payload?: unknown }> = [];

    wss.on('connection', (socket) => {
      socket.send(
        JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'nonce-4' },
        }),
      );
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.method === 'connect') {
          socket.send(
            JSON.stringify({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: { type: 'hello-ok', protocol: 3 },
            }),
          );
          setTimeout(() => {
            socket.send(
              JSON.stringify({
                type: 'event',
                event: 'session.message',
                payload: { sessionKey: 'agent:main:main', message: { role: 'user' } },
              }),
            );
          }, 10);
        }
      });
    });

    const client = new OpenClawClient({
      url: `ws://127.0.0.1:${port}`,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    client.onConnected(() => {
      connected.count += 1;
    });
    client.onEvent((event) => {
      events.push(event);
    });

    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(connected.count).toBe(1);
    expect(events).toContainEqual({
      event: 'session.message',
      payload: { sessionKey: 'agent:main:main', message: { role: 'user' } },
    });

    await client.close();
  });
});
