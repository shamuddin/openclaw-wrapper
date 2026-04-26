'use client';

export const LAST_FLOW_ID_STORAGE_KEY = 'openclaw-wrapper:last-flow-id';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLastFlowId(): string | null {
  return getStorage()?.getItem(LAST_FLOW_ID_STORAGE_KEY) ?? null;
}

export function saveLastFlowId(flowId: string): void {
  getStorage()?.setItem(LAST_FLOW_ID_STORAGE_KEY, flowId);
}

export function clearLastFlowId(): void {
  getStorage()?.removeItem(LAST_FLOW_ID_STORAGE_KEY);
}
