import { type Static, Type } from '@sinclair/typebox';

export const MemoryNamespace = Type.Union([
  Type.Literal('session'),
  Type.Literal('memory'),
  Type.Literal('thread'),
]);
export type MemoryNamespace = Static<typeof MemoryNamespace>;

export const MemoryQueryNamespace = Type.Union([MemoryNamespace, Type.Literal('all')]);
export type MemoryQueryNamespace = Static<typeof MemoryQueryNamespace>;

export const MemoryQueryMatch = Type.Object({
  namespace: MemoryNamespace,
  scopeId: Type.String({ minLength: 1 }),
  key: Type.String({ minLength: 1 }),
  value: Type.Unknown(),
  score: Type.Number(),
  matchedOn: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
});
export type MemoryQueryMatch = Static<typeof MemoryQueryMatch>;

export const MemoryQueryResult = Type.Object({
  namespace: MemoryQueryNamespace,
  keyPrefix: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  limit: Type.Number({ minimum: 1 }),
  totalMatches: Type.Number({ minimum: 0 }),
  matches: Type.Array(MemoryQueryMatch),
});
export type MemoryQueryResult = Static<typeof MemoryQueryResult>;

export const MemoryQueryInput = Type.Object({
  namespace: Type.Optional(MemoryQueryNamespace),
  keyPrefix: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
});
export type MemoryQueryInput = Static<typeof MemoryQueryInput>;

export const MemoryStatus = Type.Object({
  flowId: Type.String({ minLength: 1 }),
  sessionKey: Type.Optional(Type.String({ minLength: 1 })),
  threadId: Type.Optional(Type.String({ minLength: 1 })),
  totalEntries: Type.Number({ minimum: 0 }),
  countsByNamespace: Type.Object({
    memory: Type.Number({ minimum: 0 }),
    session: Type.Number({ minimum: 0 }),
    thread: Type.Number({ minimum: 0 }),
  }),
  latestUpdatedAt: Type.Optional(Type.String({ format: 'date-time' })),
});
export type MemoryStatus = Static<typeof MemoryStatus>;
