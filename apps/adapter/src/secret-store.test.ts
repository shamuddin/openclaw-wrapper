import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptSecretValue,
  describeStoredSecret,
  encryptSecretValue,
  encryptStoredSecrets,
  isEncryptedSecretValue,
} from './secret-store.js';

describe('secret-store', () => {
  beforeEach(() => {
    vi.stubEnv('CHANNEL_SECRET_KEY', 'test-secret-key-for-wrapper');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('encrypts and decrypts secret values', () => {
    const encrypted = encryptSecretValue('super-secret-token');

    expect(isEncryptedSecretValue(encrypted)).toBe(true);
    expect(encrypted).not.toContain('super-secret-token');
    expect(decryptSecretValue(encrypted)).toBe('super-secret-token');
  });

  it('encrypts plaintext maps while preserving already encrypted values', () => {
    const alreadyEncrypted = encryptSecretValue('existing-secret');

    const stored = encryptStoredSecrets({
      accessToken: 'plain-token',
      verifyToken: alreadyEncrypted,
    });

    expect(isEncryptedSecretValue(stored.accessToken)).toBe(true);
    expect(stored.verifyToken).toBe(alreadyEncrypted);
    expect(decryptSecretValue(stored.accessToken ?? '')).toBe('plain-token');
  });

  it('describes encrypted values without exposing plaintext previews', () => {
    const encrypted = encryptSecretValue('super-secret-token');

    expect(describeStoredSecret('plain-token-1234')).toEqual({
      configured: true,
      preview: '****1234',
    });
    expect(describeStoredSecret(encrypted)).toEqual({
      configured: true,
      preview: 'encrypted',
    });
    expect(describeStoredSecret(undefined)).toEqual({
      configured: false,
    });
  });
});
