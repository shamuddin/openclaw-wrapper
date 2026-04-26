import { describe, expect, it, vi } from 'vitest';
import {
  getPersistedMemoryStatus,
  loadPersistedMemory,
  mergePersistedMemoryIntoInput,
  queryPersistedMemory,
} from './memory-store.js';

describe('memory-store', () => {
  it('loads persisted flow, session, and thread memory into namespace buckets', async () => {
    const where = vi.fn().mockResolvedValue([
      {
        namespace: 'memory',
        scopeId: 'flow_1',
        key: 'customer.tier',
        value: 'gold',
        updatedAt: new Date('2026-04-22T10:00:00.000Z'),
      },
      {
        namespace: 'session',
        scopeId: 'session_1',
        key: 'lastIntent',
        value: 'refund',
        updatedAt: new Date('2026-04-22T10:01:00.000Z'),
      },
      {
        namespace: 'thread',
        scopeId: 'thread_1',
        key: 'flags.needsHuman',
        value: true,
        updatedAt: new Date('2026-04-22T10:02:00.000Z'),
      },
      {
        namespace: 'ignored',
        key: 'should.skip',
        value: 'x',
      },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await loadPersistedMemory(
      {
        select,
      } as never,
      {
        workspaceId: 'ws_default',
        flowId: 'flow_1',
        sessionKey: 'session_1',
        threadId: 'thread_1',
      },
    );

    expect(result).toEqual({
      memory: {
        customer: {
          tier: 'gold',
        },
      },
      session: {
        lastIntent: 'refund',
      },
      thread: {
        flags: {
          needsHuman: true,
        },
      },
    });
  });

  it('merges hydrated memory into object payloads while preserving existing runtime values', () => {
    const result = mergePersistedMemoryIntoInput(
      {
        message: 'hello',
        memory: {
          session: {
            lastIntent: 'exchange',
          },
        },
      },
      {
        memory: {
          customer: {
            tier: 'gold',
          },
        },
        session: {
          lastIntent: 'refund',
          customerId: 'cust_1',
        },
      },
    );

    expect(result).toEqual({
      message: 'hello',
      memory: {
        memory: {
          customer: {
            tier: 'gold',
          },
        },
        session: {
          lastIntent: 'exchange',
          customerId: 'cust_1',
        },
      },
      memoryHydrated: {
        namespaces: ['memory', 'session'],
      },
    });
  });

  it('wraps primitive payloads when hydrating persisted memory', () => {
    const result = mergePersistedMemoryIntoInput('hello', {
      session: {
        lastIntent: 'refund',
      },
    });

    expect(result).toEqual({
      input: 'hello',
      memory: {
        session: {
          lastIntent: 'refund',
        },
      },
      memoryHydrated: {
        namespaces: ['session'],
      },
    });
  });

  it('queries persisted memory entries by text and namespace', async () => {
    const where = vi.fn().mockResolvedValue([
      {
        namespace: 'session',
        scopeId: 'session_1',
        key: 'lastIntent',
        value: 'refund',
        updatedAt: new Date('2026-04-22T12:00:00.000Z'),
      },
      {
        namespace: 'memory',
        scopeId: 'flow_1',
        key: 'customer.tier',
        value: 'gold',
        updatedAt: new Date('2026-04-22T11:00:00.000Z'),
      },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await queryPersistedMemory(
      {
        select,
      } as never,
      {
        workspaceId: 'ws_default',
        flowId: 'flow_1',
        sessionKey: 'session_1',
        namespace: 'all',
        query: 'refund',
        limit: 5,
      },
    );

    expect(result).toEqual({
      namespace: 'all',
      query: 'refund',
      limit: 5,
      totalMatches: 1,
      matches: [
        {
          namespace: 'session',
          scopeId: 'session_1',
          key: 'lastIntent',
          value: 'refund',
          score: 2,
          matchedOn: ['value'],
          updatedAt: '2026-04-22T12:00:00.000Z',
        },
      ],
    });
  });

  it('summarizes persisted memory status across namespaces', async () => {
    const where = vi.fn().mockResolvedValue([
      {
        namespace: 'memory',
        scopeId: 'flow_1',
        key: 'customer.tier',
        value: 'gold',
        updatedAt: new Date('2026-04-22T10:00:00.000Z'),
      },
      {
        namespace: 'session',
        scopeId: 'session_1',
        key: 'lastIntent',
        value: 'refund',
        updatedAt: new Date('2026-04-22T10:01:00.000Z'),
      },
      {
        namespace: 'thread',
        scopeId: 'thread_1',
        key: 'flags.needsHuman',
        value: true,
        updatedAt: new Date('2026-04-22T10:02:00.000Z'),
      },
    ]);
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));

    const result = await getPersistedMemoryStatus(
      {
        select,
      } as never,
      {
        workspaceId: 'ws_default',
        flowId: 'flow_1',
        sessionKey: 'session_1',
        threadId: 'thread_1',
      },
    );

    expect(result).toEqual({
      flowId: 'flow_1',
      sessionKey: 'session_1',
      threadId: 'thread_1',
      totalEntries: 3,
      countsByNamespace: {
        memory: 1,
        session: 1,
        thread: 1,
      },
      latestUpdatedAt: '2026-04-22T10:02:00.000Z',
    });
  });
});
