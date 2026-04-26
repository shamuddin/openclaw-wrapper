import { describe, expect, it } from 'vitest';
import type { CronPayload } from '@openclaw-wrapper/schemas';
import { resolveCronSessionTarget } from './cron.js';

const AGENT_PAYLOAD: CronPayload = {
  kind: 'agentTurn',
  message: 'Summarize overnight updates.',
};

describe('resolveCronSessionTarget', () => {
  it('resolves current to a persisted named session when a session key is provided', () => {
    expect(
      resolveCronSessionTarget({
        payload: AGENT_PAYLOAD,
        sessionTarget: 'current',
        sessionKey: ' agent:main:daily-brief ',
      }),
    ).toBe('session:agent:main:daily-brief');
  });

  it('falls back current to isolated when no session key is available', () => {
    expect(
      resolveCronSessionTarget({
        payload: AGENT_PAYLOAD,
        sessionTarget: 'current',
      }),
    ).toBe('isolated');
  });
});
