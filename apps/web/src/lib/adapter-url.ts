const DEFAULT_ADAPTER_URL = 'http://localhost:4000';

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getAdapterBaseUrl(rawValue = process.env.NEXT_PUBLIC_ADAPTER_URL): string {
  const candidate = cleanBaseUrl(rawValue ?? DEFAULT_ADAPTER_URL);

  try {
    return new URL(candidate).toString().replace(/\/+$/, '');
  } catch {
    if (typeof window !== 'undefined') {
      console.warn(
        '[openclaw-wrapper] Invalid NEXT_PUBLIC_ADAPTER_URL, falling back to default adapter URL.',
        rawValue,
      );
    }
    return DEFAULT_ADAPTER_URL;
  }
}

export function buildAdapterUrl(path: string, rawValue?: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getAdapterBaseUrl(rawValue)}${normalizedPath}`;
}
