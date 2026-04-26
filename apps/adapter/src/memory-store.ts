import { queryMemoryEntries, summarizeMemoryEntries } from '@openclaw-wrapper/memory-sdk';
import type {
  MemoryNamespace,
  MemoryQueryInput,
  MemoryQueryResult,
  MemoryStatus,
} from '@openclaw-wrapper/schemas';
import { and, eq, or, sql } from 'drizzle-orm';
import type { Db } from './db/client.js';
import { contextMemoryEntries } from './db/schema.js';

export interface MemoryWriteRecordInput {
  workspaceId: string;
  flowId: string;
  runId: string;
  namespace: string;
  scopeId: string;
  key: string;
  value: unknown;
}

export interface PersistedMemoryState {
  memory?: Record<string, unknown>;
  session?: Record<string, unknown>;
  thread?: Record<string, unknown>;
}

export interface QueryPersistedMemoryInput extends LoadPersistedMemoryInput, MemoryQueryInput {}

export interface LoadPersistedMemoryInput {
  workspaceId: string;
  flowId: string;
  sessionKey?: string;
  threadId?: string;
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return structuredClone(value as Record<string, unknown>);
  }
  return {};
}

function setNestedValue(target: Record<string, unknown>, keyPath: string, value: unknown): void {
  const segments = keyPath
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return;
  }

  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const leaf = segments[segments.length - 1];
  if (leaf) {
    current[leaf] = value;
  }
}

function normalizeScopeId(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildScopeConditions(input: LoadPersistedMemoryInput) {
  const sessionKey = normalizeScopeId(input.sessionKey);
  const threadId = normalizeScopeId(input.threadId);

  return {
    sessionKey,
    threadId,
    scopeConditions: [
      and(
        eq(contextMemoryEntries.namespace, 'memory'),
        eq(contextMemoryEntries.scopeId, input.flowId),
      ),
      ...(sessionKey
        ? [
            and(
              eq(contextMemoryEntries.namespace, 'session'),
              eq(contextMemoryEntries.scopeId, sessionKey),
            ),
          ]
        : []),
      ...(threadId
        ? [
            and(
              eq(contextMemoryEntries.namespace, 'thread'),
              eq(contextMemoryEntries.scopeId, threadId),
            ),
          ]
        : []),
    ],
  };
}

function isMemoryNamespace(value: string): value is MemoryNamespace {
  return value === 'memory' || value === 'session' || value === 'thread';
}

function hasPersistedMemory(state: PersistedMemoryState): boolean {
  return ['memory', 'session', 'thread'].some((namespace) => {
    const record = state[namespace as keyof PersistedMemoryState];
    return Boolean(record && Object.keys(record).length > 0);
  });
}

function mergeNamespace(
  persisted: Record<string, unknown> | undefined,
  existing: unknown,
): Record<string, unknown> | undefined {
  const persistedRecord = cloneRecord(persisted);
  const existingRecord = cloneRecord(existing);
  const merged = {
    ...persistedRecord,
    ...existingRecord,
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export async function persistMemoryWrite(db: Db, input: MemoryWriteRecordInput): Promise<void> {
  const now = new Date();

  await db
    .insert(contextMemoryEntries)
    .values({
      workspaceId: input.workspaceId,
      flowId: input.flowId,
      namespace: input.namespace,
      scopeId: input.scopeId,
      key: input.key,
      value: input.value,
      sourceRunId: input.runId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        contextMemoryEntries.flowId,
        contextMemoryEntries.namespace,
        contextMemoryEntries.scopeId,
        contextMemoryEntries.key,
      ],
      set: {
        value: input.value,
        sourceRunId: input.runId,
        updatedAt: now,
        createdAt: sql`${contextMemoryEntries.createdAt}`,
      },
    });
}

export async function loadPersistedMemory(
  db: Db,
  input: LoadPersistedMemoryInput,
): Promise<PersistedMemoryState> {
  const { scopeConditions } = buildScopeConditions(input);

  const rows = await db
    .select({
      namespace: contextMemoryEntries.namespace,
      key: contextMemoryEntries.key,
      value: contextMemoryEntries.value,
    })
    .from(contextMemoryEntries)
    .where(
      and(
        eq(contextMemoryEntries.workspaceId, input.workspaceId),
        eq(contextMemoryEntries.flowId, input.flowId),
        or(...scopeConditions),
      ),
    );

  const state: PersistedMemoryState = {};
  for (const row of rows) {
    if (!isMemoryNamespace(row.namespace)) {
      continue;
    }
    const namespaceRoot = cloneRecord(state[row.namespace]);
    setNestedValue(namespaceRoot, row.key, row.value);
    state[row.namespace] = namespaceRoot;
  }

  return state;
}

export async function queryPersistedMemory(
  db: Db,
  input: QueryPersistedMemoryInput,
): Promise<MemoryQueryResult> {
  const { sessionKey, threadId, scopeConditions } = buildScopeConditions(input);
  const rows = await db
    .select({
      namespace: contextMemoryEntries.namespace,
      scopeId: contextMemoryEntries.scopeId,
      key: contextMemoryEntries.key,
      value: contextMemoryEntries.value,
      updatedAt: contextMemoryEntries.updatedAt,
    })
    .from(contextMemoryEntries)
    .where(
      and(
        eq(contextMemoryEntries.workspaceId, input.workspaceId),
        eq(contextMemoryEntries.flowId, input.flowId),
        or(...scopeConditions),
      ),
    );

  const entries = rows.flatMap((row) => {
    if (!isMemoryNamespace(row.namespace)) {
      return [];
    }
    return [
      {
        namespace: row.namespace,
        scopeId: row.scopeId,
        key: row.key,
        value: row.value,
        updatedAt: row.updatedAt.toISOString(),
      },
    ];
  });

  return queryMemoryEntries(entries, input);
}

export async function getPersistedMemoryStatus(
  db: Db,
  input: LoadPersistedMemoryInput,
): Promise<MemoryStatus> {
  const { sessionKey, threadId, scopeConditions } = buildScopeConditions(input);
  const rows = await db
    .select({
      namespace: contextMemoryEntries.namespace,
      scopeId: contextMemoryEntries.scopeId,
      key: contextMemoryEntries.key,
      value: contextMemoryEntries.value,
      updatedAt: contextMemoryEntries.updatedAt,
    })
    .from(contextMemoryEntries)
    .where(
      and(
        eq(contextMemoryEntries.workspaceId, input.workspaceId),
        eq(contextMemoryEntries.flowId, input.flowId),
        or(...scopeConditions),
      ),
    );
  const entries = rows.flatMap((row) => {
    if (!isMemoryNamespace(row.namespace)) {
      return [];
    }
    return [
      {
        namespace: row.namespace,
        scopeId: row.scopeId,
        key: row.key,
        value: row.value,
        updatedAt: row.updatedAt.toISOString(),
      },
    ];
  });

  return summarizeMemoryEntries(entries, {
    flowId: input.flowId,
    ...(sessionKey ? { sessionKey } : {}),
    ...(threadId ? { threadId } : {}),
  });
}

export function mergePersistedMemoryIntoInput(
  input: unknown,
  persistedMemory: PersistedMemoryState,
): unknown {
  if (!hasPersistedMemory(persistedMemory)) {
    return input;
  }

  const output: Record<string, unknown> =
    input && typeof input === 'object' && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : { input };

  const existingMemory = cloneRecord(output.memory);
  const mergedMemory = {
    ...(mergeNamespace(persistedMemory.memory, existingMemory.memory)
      ? { memory: mergeNamespace(persistedMemory.memory, existingMemory.memory) }
      : {}),
    ...(mergeNamespace(persistedMemory.session, existingMemory.session)
      ? { session: mergeNamespace(persistedMemory.session, existingMemory.session) }
      : {}),
    ...(mergeNamespace(persistedMemory.thread, existingMemory.thread)
      ? { thread: mergeNamespace(persistedMemory.thread, existingMemory.thread) }
      : {}),
  };

  output.memory = mergedMemory;
  output.memoryHydrated = {
    namespaces: Object.keys(mergedMemory).sort(),
  };
  return output;
}
