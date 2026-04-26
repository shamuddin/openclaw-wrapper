import { type Static, Type } from '@sinclair/typebox';

export const ChannelConfigOption = Type.Object({
  label: Type.String({ minLength: 1 }),
  value: Type.String({ minLength: 1 }),
});
export type ChannelConfigOption = Static<typeof ChannelConfigOption>;

export const ChannelProfileFieldType = Type.Union([
  Type.Literal('text'),
  Type.Literal('textarea'),
  Type.Literal('select'),
  Type.Literal('boolean'),
  Type.Literal('password'),
]);
export type ChannelProfileFieldType = Static<typeof ChannelProfileFieldType>;

export const ChannelProfileFieldDescriptor = Type.Object({
  key: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  type: ChannelProfileFieldType,
  description: Type.Optional(Type.String()),
  placeholder: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(ChannelConfigOption)),
  required: Type.Optional(Type.Boolean()),
  advanced: Type.Optional(Type.Boolean()),
});
export type ChannelProfileFieldDescriptor = Static<typeof ChannelProfileFieldDescriptor>;

export const ChannelPairingMode = Type.Union([Type.Literal('none'), Type.Literal('qr')]);
export type ChannelPairingMode = Static<typeof ChannelPairingMode>;

export const ChannelProfileTemplate = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  channelType: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  icon: Type.Optional(Type.String()),
  pairingMode: Type.Optional(ChannelPairingMode),
  supportsTestSend: Type.Optional(Type.Boolean()),
  defaults: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  fields: Type.Array(ChannelProfileFieldDescriptor),
});
export type ChannelProfileTemplate = Static<typeof ChannelProfileTemplate>;

export const ChannelRuntimeAccount = Type.Object({
  accountId: Type.String({ minLength: 1 }),
  label: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  configured: Type.Optional(Type.Boolean()),
  running: Type.Optional(Type.Boolean()),
  connected: Type.Optional(Type.Boolean()),
});
export type ChannelRuntimeAccount = Static<typeof ChannelRuntimeAccount>;

export const ChannelRuntimeStatus = Type.Object({
  channelType: Type.String({ minLength: 1 }),
  label: Type.Optional(Type.String()),
  detailLabel: Type.Optional(Type.String()),
  available: Type.Boolean(),
  configured: Type.Optional(Type.Boolean()),
  connected: Type.Optional(Type.Boolean()),
  accounts: Type.Array(ChannelRuntimeAccount),
});
export type ChannelRuntimeStatus = Static<typeof ChannelRuntimeStatus>;

export const ChannelSecretState = Type.Object({
  key: Type.String({ minLength: 1 }),
  configured: Type.Boolean(),
  preview: Type.Optional(Type.String()),
});
export type ChannelSecretState = Static<typeof ChannelSecretState>;

export const ChannelProfileSummary = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  templateId: Type.String({ minLength: 1 }),
  channelType: Type.String({ minLength: 1 }),
  agentId: Type.Optional(Type.String()),
  accountId: Type.Optional(Type.String()),
  routeKey: Type.Optional(Type.String()),
  defaultTarget: Type.Optional(Type.String()),
  appliedAt: Type.Optional(Type.String({ format: 'date-time' })),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  runtime: Type.Optional(ChannelRuntimeStatus),
});
export type ChannelProfileSummary = Static<typeof ChannelProfileSummary>;

export const ChannelProfile = Type.Intersect([
  ChannelProfileSummary,
  Type.Object({
    config: Type.Record(Type.String(), Type.Unknown()),
    secretState: Type.Array(ChannelSecretState),
  }),
]);
export type ChannelProfile = Static<typeof ChannelProfile>;

export const ChannelCatalog = Type.Object({
  templates: Type.Array(ChannelProfileTemplate),
  runtime: Type.Array(ChannelRuntimeStatus),
});
export type ChannelCatalog = Static<typeof ChannelCatalog>;

export const ChannelPairingState = Type.Object({
  message: Type.Optional(Type.String()),
  qrDataUrl: Type.Optional(Type.String()),
  connected: Type.Optional(Type.Boolean()),
});
export type ChannelPairingState = Static<typeof ChannelPairingState>;
