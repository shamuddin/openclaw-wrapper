import { randomUUID } from 'node:crypto';
import type { PingResponse } from '@openclaw-wrapper/schemas';
import type { OpenClawClient } from './client.js';

export async function ping(client: OpenClawClient): Promise<PingResponse> {
  const nonce = randomUUID();
  const started = performance.now();
  try {
    let gatewayVersion = 'reachable';
    let uptimeMs = 0;

    try {
      const result = await client.request<{ version: string; uptimeMs: number; echoNonce: string }>(
        'system.ping',
        { nonce },
      );
      gatewayVersion = result.version;
      uptimeMs = result.uptimeMs;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes('unknown method: system.ping')) {
        throw error;
      }

      await client.request('agents.list', {});
    }

    return {
      ok: true,
      gateway: { version: gatewayVersion, uptimeMs },
      echoNonce: nonce,
      roundTripMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'timeout') {
      return { ok: false, error: 'timeout' };
    }
    if (message === 'gateway_unreachable' || message === 'connection closed') {
      return { ok: false, error: 'gateway_unreachable' };
    }
    return { ok: false, error: 'protocol_error', detail: message };
  }
}
