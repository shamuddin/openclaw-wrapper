import crypto from 'node:crypto';
import { env } from './env.js';

const SECRET_PREFIX = 'enc:v1';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class SecretStoreError extends Error {
  constructor(
    readonly code: 'MISSING_KEY' | 'INVALID_SECRET',
    message: string,
  ) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

function toBase64Url(value: Buffer): string {
  return value.toString('base64url');
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function deriveKey(): Buffer {
  const keyMaterial = process.env.CHANNEL_SECRET_KEY ?? env.CHANNEL_SECRET_KEY;
  if (!keyMaterial || keyMaterial.trim().length === 0) {
    throw new SecretStoreError(
      'MISSING_KEY',
      'CHANNEL_SECRET_KEY is required to encrypt channel secrets at rest',
    );
  }

  return crypto.createHash('sha256').update(keyMaterial).digest();
}

export function hasSecretStoreKey(): boolean {
  const keyMaterial = process.env.CHANNEL_SECRET_KEY ?? env.CHANNEL_SECRET_KEY;
  return typeof keyMaterial === 'string' && keyMaterial.trim().length > 0;
}

export function isEncryptedSecretValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${SECRET_PREFIX}:`);
}

export function encryptSecretValue(value: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}:${toBase64Url(iv)}:${toBase64Url(tag)}:${toBase64Url(ciphertext)}`;
}

export function decryptSecretValue(value: string): string {
  if (!isEncryptedSecretValue(value)) {
    return value;
  }

  const [, version, ivPart, tagPart, payloadPart] = value.split(':');
  if (version !== 'v1' || !ivPart || !tagPart || !payloadPart) {
    throw new SecretStoreError('INVALID_SECRET', 'channel secret payload is malformed');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), fromBase64Url(ivPart));
  decipher.setAuthTag(fromBase64Url(tagPart));
  const decrypted = Buffer.concat([decipher.update(fromBase64Url(payloadPart)), decipher.final()]);
  return decrypted.toString('utf8');
}

export function encryptStoredSecrets(
  secrets: Record<string, string> | undefined,
): Record<string, string> {
  const nextSecrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets ?? {})) {
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    nextSecrets[key] = isEncryptedSecretValue(value) ? value : encryptSecretValue(value.trim());
  }
  return nextSecrets;
}

export function describeStoredSecret(value: string | undefined): {
  configured: boolean;
  preview?: string;
} {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { configured: false };
  }

  if (isEncryptedSecretValue(value)) {
    return { configured: true, preview: 'encrypted' };
  }

  const tail = value.trim().slice(-4);
  return {
    configured: true,
    preview: tail ? `****${tail}` : 'configured',
  };
}
