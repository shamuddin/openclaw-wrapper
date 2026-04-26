import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFlowTriggerSecretPreview,
  issueFlowTriggerSecret,
  verifyFlowTriggerSecret,
} from './flow-trigger-security.js';

describe('flow-trigger-security', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('issues a verifiable trigger secret bundle', () => {
    vi.stubEnv('CHANNEL_SECRET_KEY', 'test-secret-key');

    const issued = issueFlowTriggerSecret();

    expect(issued.secret).toMatch(/^ocw_trg_/);
    expect(issued.preview).toBe(buildFlowTriggerSecretPreview(issued.secret));
    expect(verifyFlowTriggerSecret(issued.secret, issued.hash)).toBe(true);
    expect(verifyFlowTriggerSecret(`${issued.secret}_wrong`, issued.hash)).toBe(false);
  });

  it('builds a readable preview from the secret tail', () => {
    expect(buildFlowTriggerSecretPreview('ocw_trg_abcdef123456')).toBe('••••123456');
  });
});
