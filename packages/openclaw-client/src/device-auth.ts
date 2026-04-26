export interface DeviceAuthPayloadParams {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string | null;
  nonce: string;
  platform?: string | null;
  deviceFamily?: string | null;
}

function normalizeMetadata(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildDeviceAuthPayloadV3(params: DeviceAuthPayloadParams): string {
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const platform = normalizeMetadata(params.platform);
  const deviceFamily = normalizeMetadata(params.deviceFamily);

  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily,
  ].join('|');
}
