import { describe, expect, it } from 'vitest';
import { matchRuntimeForChannelProfile } from './channel-profiles.js';

describe('matchRuntimeForChannelProfile', () => {
  const runtime = {
    channelType: 'whatsapp',
    label: 'WhatsApp',
    available: true,
    configured: true,
    connected: true,
    accounts: [
      { accountId: 'default', configured: true, connected: true, running: true },
      { accountId: 'sales', configured: true, connected: false, running: false },
    ],
  };

  it('returns the full runtime when no account is pinned', () => {
    expect(matchRuntimeForChannelProfile(runtime, undefined)).toEqual(runtime);
  });

  it('filters runtime state to the requested account', () => {
    expect(matchRuntimeForChannelProfile(runtime, 'sales')).toEqual({
      ...runtime,
      configured: true,
      connected: false,
      accounts: [{ accountId: 'sales', configured: true, connected: false, running: false }],
    });
  });

  it('returns undefined when the requested account is not present', () => {
    expect(matchRuntimeForChannelProfile(runtime, 'missing')).toBeUndefined();
  });
});
