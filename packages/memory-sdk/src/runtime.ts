import type { MemoryNamespace } from '@openclaw-wrapper/schemas';

export interface MemoryEntry {
  namespace: MemoryNamespace;
  scopeId: string;
  key: string;
  value: unknown;
  updatedAt?: string;
}

export interface MemoryRuntimeState {
  memory?: Record<string, unknown>;
  session?: Record<string, unknown>;
  thread?: Record<string, unknown>;
}

export interface MemoryScopeBindings {
  flowId: string;
  sessionKey?: string;
  threadId?: string;
}

function visitEntries(
  value: unknown,
  callback: (keyPath: string, value: unknown) => void,
  prefix?: string,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) {
      callback(prefix, value);
    }
    return;
  }

  const entries = Object.entries(value);
  if (entries.length === 0 && prefix) {
    callback(prefix, {});
    return;
  }

  for (const [key, child] of entries) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      visitEntries(child, callback, nextPrefix);
      continue;
    }
    callback(nextPrefix, child);
  }
}

export function flattenMemoryState(
  state: MemoryRuntimeState,
  bindings: MemoryScopeBindings,
): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const scopes: Array<{ namespace: MemoryNamespace; scopeId?: string; value: unknown }> = [
    { namespace: 'memory', scopeId: bindings.flowId, value: state.memory },
    { namespace: 'session', scopeId: bindings.sessionKey, value: state.session },
    { namespace: 'thread', scopeId: bindings.threadId, value: state.thread },
  ];

  for (const scope of scopes) {
    if (
      !scope.scopeId ||
      !scope.value ||
      typeof scope.value !== 'object' ||
      Array.isArray(scope.value)
    ) {
      continue;
    }

    const scopeId = scope.scopeId;
    visitEntries(scope.value, (key, value) => {
      entries.push({
        namespace: scope.namespace,
        scopeId,
        key,
        value,
      });
    });
  }

  return entries;
}
