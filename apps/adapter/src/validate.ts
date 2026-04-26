import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { TRPCError } from '@trpc/server';

/**
 * Wraps a TypeBox schema as a tRPC-compatible input parser. Throws a typed
 * BAD_REQUEST TRPCError on validation failure.
 */
export function parse<T extends TSchema>(schema: T) {
  return (raw: unknown): Static<T> => {
    if (!Value.Check(schema, raw)) {
      const first = Value.Errors(schema, raw).First();
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: first ? `${first.path} ${first.message}` : 'invalid input',
      });
    }
    return raw as Static<T>;
  };
}
