import { type Static, Type } from '@sinclair/typebox';

export const WorkspaceExecPolicy = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  allowTrusted: Type.Optional(Type.Boolean()),
  allowElevated: Type.Optional(Type.Boolean()),
  allowedCommandPrefixes: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  trustedCommandPrefixes: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  elevatedCommandPrefixes: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  allowedCommandFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  trustedCommandFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  elevatedCommandFamilies: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export type WorkspaceExecPolicy = Static<typeof WorkspaceExecPolicy>;

export const WorkspaceSummary = Type.Object({
  id: Type.String({ format: 'uuid', minLength: 36, maxLength: 36 }),
  slug: Type.String({ minLength: 1, maxLength: 120 }),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  role: Type.Optional(
    Type.Union([Type.Literal('owner'), Type.Literal('admin'), Type.Literal('member')]),
  ),
  execPolicy: Type.Optional(WorkspaceExecPolicy),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});
export type WorkspaceSummary = Static<typeof WorkspaceSummary>;

export const WorkspaceContext = Type.Object({
  current: WorkspaceSummary,
  available: Type.Array(WorkspaceSummary),
});
export type WorkspaceContext = Static<typeof WorkspaceContext>;
