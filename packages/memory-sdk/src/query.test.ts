import { describe, expect, it } from 'vitest';
import { queryMemoryEntries } from './query.js';
import { flattenMemoryState } from './runtime.js';
import { summarizeMemoryEntries } from './status.js';

describe('memory-sdk', () => {
  it('flattens runtime memory state into queryable entries', () => {
    const entries = flattenMemoryState(
      {
        memory: {
          customer: {
            tier: 'gold',
          },
        },
        session: {
          lastIntent: 'refund',
        },
      },
      {
        flowId: 'flow_1',
        sessionKey: 'session_1',
      },
    );

    expect(entries).toEqual([
      {
        namespace: 'memory',
        scopeId: 'flow_1',
        key: 'customer.tier',
        value: 'gold',
      },
      {
        namespace: 'session',
        scopeId: 'session_1',
        key: 'lastIntent',
        value: 'refund',
      },
    ]);
  });

  it('queries flattened memory entries by namespace, prefix, and text content', () => {
    const result = queryMemoryEntries(
      [
        {
          namespace: 'memory',
          scopeId: 'flow_1',
          key: 'customer.tier',
          value: 'gold',
          updatedAt: '2026-04-22T10:00:00.000Z',
        },
        {
          namespace: 'session',
          scopeId: 'session_1',
          key: 'lastIntent',
          value: 'refund',
          updatedAt: '2026-04-22T10:01:00.000Z',
        },
      ],
      {
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
          updatedAt: '2026-04-22T10:01:00.000Z',
        },
      ],
    });
  });

  it('summarizes entry counts and latest update time', () => {
    const status = summarizeMemoryEntries(
      [
        {
          namespace: 'memory',
          scopeId: 'flow_1',
          key: 'customer.tier',
          value: 'gold',
          updatedAt: '2026-04-22T10:00:00.000Z',
        },
        {
          namespace: 'thread',
          scopeId: 'thread_1',
          key: 'flags.needsHuman',
          value: true,
          updatedAt: '2026-04-22T10:05:00.000Z',
        },
      ],
      {
        flowId: 'flow_1',
        threadId: 'thread_1',
      },
    );

    expect(status).toEqual({
      flowId: 'flow_1',
      threadId: 'thread_1',
      totalEntries: 2,
      countsByNamespace: {
        memory: 1,
        session: 0,
        thread: 1,
      },
      latestUpdatedAt: '2026-04-22T10:05:00.000Z',
    });
  });
});
