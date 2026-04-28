import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const envFileCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'apps/adapter/.env'),
];

for (const envFile of envFileCandidates) {
  if (!fs.existsSync(envFile)) continue;
  process.loadEnvFile(envFile);
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env: ${name}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number.parseInt(process.env.PORT ?? '4000', 10),
  HOST: process.env.HOST ?? '0.0.0.0',
  AUTH_MODE:
    process.env.AUTH_MODE ??
    ((process.env.NODE_ENV ?? 'development').trim().toLowerCase() === 'production'
      ? 'required'
      : 'disabled'),
  LOCAL_AUTH_EMAIL: process.env.LOCAL_AUTH_EMAIL ?? 'local@openclaw-wrapper.local',
  LOCAL_AUTH_NAME: process.env.LOCAL_AUTH_NAME ?? 'Local User',
  DATABASE_URL: required('DATABASE_URL', 'postgres://postgres:postgres@127.0.0.1:55433/openclaw'),
  REDIS_URL: required('REDIS_URL', 'redis://127.0.0.1:56379'),
  GATEWAY_WS_URL: required('GATEWAY_WS_URL', 'ws://127.0.0.1:18789'),
  GATEWAY_TOKEN: process.env.GATEWAY_TOKEN,
  GATEWAY_BOOTSTRAP_TOKEN: process.env.GATEWAY_BOOTSTRAP_TOKEN,
  GATEWAY_DEVICE_TOKEN: process.env.GATEWAY_DEVICE_TOKEN,
  GATEWAY_PASSWORD: process.env.GATEWAY_PASSWORD,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  OPENCLAW_WORKSPACE_DIR:
    process.env.OPENCLAW_WORKSPACE_DIR ?? path.join(os.homedir(), '.openclaw', 'workspace'),
  OPENCLAW_PLUGIN_DIR: process.env.OPENCLAW_PLUGIN_DIR,
  CLAWHUB_BASE_URL: process.env.CLAWHUB_BASE_URL ?? 'https://clawhub.ai',
  CLAWHUB_TOKEN: process.env.CLAWHUB_TOKEN,
  CHANNEL_SECRET_KEY: process.env.CHANNEL_SECRET_KEY,
  APP_BASE_URL: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  ADAPTER_BASE_URL: process.env.ADAPTER_BASE_URL ?? 'http://localhost:4000',
  YOUTUBE_WEBSUB_SECRET: process.env.YOUTUBE_WEBSUB_SECRET,
  YOUTUBE_TRANSCRIPT_PYTHON: process.env.YOUTUBE_TRANSCRIPT_PYTHON ?? 'python',
  YOUTUBE_TRANSCRIPT_TIMEOUT_MS: Number.parseInt(
    process.env.YOUTUBE_TRANSCRIPT_TIMEOUT_MS ?? '30000',
    10,
  ),
  YOUTUBE_TRANSCRIPT_HTTP_PROXY: process.env.YOUTUBE_TRANSCRIPT_HTTP_PROXY,
  YOUTUBE_TRANSCRIPT_HTTPS_PROXY: process.env.YOUTUBE_TRANSCRIPT_HTTPS_PROXY,
  TRANSCRIPT_API_KEY: process.env.TRANSCRIPT_API_KEY,
  TRANSCRIPT_API_BASE_URL:
    process.env.TRANSCRIPT_API_BASE_URL ?? 'https://transcriptapi.com/api/v2',
  EMAIL_DELIVERY_MODE: process.env.EMAIL_DELIVERY_MODE ?? 'outbox',
  EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL,
  EMAIL_WEBHOOK_AUTH: process.env.EMAIL_WEBHOOK_AUTH,
  EMAIL_FROM: process.env.EMAIL_FROM ?? 'OpenClaw Wrapper <no-reply@openclaw-wrapper.local>',
};
