import { MemoryQueryInput } from '@openclaw-wrapper/schemas';
import { Type } from '@sinclair/typebox';
import { getPersistedMemoryStatus, queryPersistedMemory } from '../memory-store.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';

const MemoryScopeInput = Type.Object({
  flowId: Type.String({ minLength: 1 }),
  sessionKey: Type.Optional(Type.String({ minLength: 1 })),
  threadId: Type.Optional(Type.String({ minLength: 1 })),
});

export const memoryRouter = router({
  query: workspaceProcedure
    .input(
      parse(
        Type.Intersect([
          Type.Object({
            flowId: Type.String({ minLength: 1 }),
          }),
          MemoryQueryInput,
        ]),
      ),
    )
    .query(async ({ ctx, input }) => {
      const { flowId, ...query } = input;
      return queryPersistedMemory(ctx.db, {
        workspaceId: ctx.workspace.id,
        flowId,
        ...query,
      });
    }),
  status: workspaceProcedure.input(parse(MemoryScopeInput)).query(async ({ ctx, input }) => {
    const { flowId, ...scope } = input;
    return getPersistedMemoryStatus(ctx.db, {
      workspaceId: ctx.workspace.id,
      flowId,
      ...scope,
    });
  }),
});
