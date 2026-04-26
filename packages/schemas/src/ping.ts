import { type Static, Type } from '@sinclair/typebox';

export const PingRequest = Type.Object({
  nonce: Type.String({ minLength: 1 }),
});
export type PingRequest = Static<typeof PingRequest>;

export const PingResponseOk = Type.Object({
  ok: Type.Literal(true),
  gateway: Type.Object({
    version: Type.String(),
    uptimeMs: Type.Number(),
  }),
  echoNonce: Type.String(),
  roundTripMs: Type.Number(),
});
export type PingResponseOk = Static<typeof PingResponseOk>;

export const PingResponseErr = Type.Object({
  ok: Type.Literal(false),
  error: Type.Union([
    Type.Literal('gateway_unreachable'),
    Type.Literal('timeout'),
    Type.Literal('protocol_error'),
  ]),
  detail: Type.Optional(Type.String()),
});
export type PingResponseErr = Static<typeof PingResponseErr>;

export const PingResponse = Type.Union([PingResponseOk, PingResponseErr]);
export type PingResponse = Static<typeof PingResponse>;
