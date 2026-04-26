import type { MemoryStatus } from '@openclaw-wrapper/schemas';
import type { MemoryEntry, MemoryScopeBindings } from './runtime.js';

export function summarizeMemoryEntries(
  entries: MemoryEntry[],
  bindings: MemoryScopeBindings,
): MemoryStatus {
  const countsByNamespace = {
    memory: 0,
    session: 0,
    thread: 0,
  };

  let latestUpdatedAt: string | undefined;
  for (const entry of entries) {
    countsByNamespace[entry.namespace] += 1;
    if (entry.updatedAt && (!latestUpdatedAt || entry.updatedAt > latestUpdatedAt)) {
      latestUpdatedAt = entry.updatedAt;
    }
  }

  return {
    flowId: bindings.flowId,
    ...(bindings.sessionKey ? { sessionKey: bindings.sessionKey } : {}),
    ...(bindings.threadId ? { threadId: bindings.threadId } : {}),
    totalEntries: entries.length,
    countsByNamespace,
    ...(latestUpdatedAt ? { latestUpdatedAt } : {}),
  };
}
