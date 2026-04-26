import { type Static, Type } from '@sinclair/typebox';

export const DataType = Type.Union([
  Type.Literal('trigger'),
  Type.Literal('string'),
  Type.Literal('number'),
  Type.Literal('boolean'),
  Type.Literal('object'),
  Type.Literal('any'),
]);
export type DataType = Static<typeof DataType>;

export const PortDescriptor = Type.Object({
  name: Type.String({ minLength: 1 }),
  label: Type.String(),
  dataType: DataType,
  required: Type.Optional(Type.Boolean()),
});
export type PortDescriptor = Static<typeof PortDescriptor>;

export const NodeCategory = Type.Union([
  Type.Literal('triggers'),
  Type.Literal('ai'),
  Type.Literal('tools'),
  Type.Literal('channels'),
  Type.Literal('control'),
  Type.Literal('context'),
  Type.Literal('ops'),
]);
export type NodeCategory = Static<typeof NodeCategory>;

export const NodeSource = Type.Union([
  Type.Literal('wrapper-core'),
  Type.Literal('openclaw-native'),
  Type.Literal('external-plugin'),
]);
export type NodeSource = Static<typeof NodeSource>;

export const NodeExecutionStatus = Type.Union([Type.Literal('supported'), Type.Literal('planned')]);
export type NodeExecutionStatus = Static<typeof NodeExecutionStatus>;

export const NodeAvailability = Type.Object({
  status: NodeExecutionStatus,
  note: Type.Optional(Type.String()),
});
export type NodeAvailability = Static<typeof NodeAvailability>;

export const NodeCapabilityTone = Type.Union([
  Type.Literal('supported'),
  Type.Literal('limited'),
  Type.Literal('warning'),
]);
export type NodeCapabilityTone = Static<typeof NodeCapabilityTone>;

export const NodeCapabilityDescriptor = Type.Object({
  label: Type.String({ minLength: 1 }),
  detail: Type.Optional(Type.String()),
  tone: Type.Optional(NodeCapabilityTone),
});
export type NodeCapabilityDescriptor = Static<typeof NodeCapabilityDescriptor>;

export const NodeConfigFieldType = Type.Union([
  Type.Literal('text'),
  Type.Literal('textarea'),
  Type.Literal('select'),
  Type.Literal('boolean'),
]);
export type NodeConfigFieldType = Static<typeof NodeConfigFieldType>;

export const NodeConfigOption = Type.Object({
  label: Type.String({ minLength: 1 }),
  value: Type.String({ minLength: 1 }),
  scope: Type.Optional(Type.String({ minLength: 1 })),
});
export type NodeConfigOption = Static<typeof NodeConfigOption>;

export const NodeConfigVisibilityOperator = Type.Union([
  Type.Literal('equals'),
  Type.Literal('notEquals'),
  Type.Literal('in'),
]);
export type NodeConfigVisibilityOperator = Static<typeof NodeConfigVisibilityOperator>;

export const NodeConfigVisibilityRule = Type.Object({
  key: Type.String({ minLength: 1 }),
  operator: NodeConfigVisibilityOperator,
  value: Type.Optional(Type.String()),
  values: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })),
});
export type NodeConfigVisibilityRule = Static<typeof NodeConfigVisibilityRule>;

export const NodeConfigFieldDescriptor = Type.Object({
  key: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  type: NodeConfigFieldType,
  description: Type.Optional(Type.String()),
  placeholder: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(NodeConfigOption)),
  suggestions: Type.Optional(Type.Array(NodeConfigOption)),
  visibleWhen: Type.Optional(Type.Array(NodeConfigVisibilityRule)),
});
export type NodeConfigFieldDescriptor = Static<typeof NodeConfigFieldDescriptor>;

export const NodeTypeDescriptor = Type.Object({
  type: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  category: NodeCategory,
  description: Type.Optional(Type.String()),
  icon: Type.Optional(Type.String()),
  source: Type.Optional(NodeSource),
  availability: Type.Optional(NodeAvailability),
  capabilities: Type.Optional(Type.Array(NodeCapabilityDescriptor)),
  inputs: Type.Array(PortDescriptor),
  outputs: Type.Array(PortDescriptor),
  defaults: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  fields: Type.Optional(Type.Array(NodeConfigFieldDescriptor)),
  // Serialized JSON Schema describing the node's `data` payload.
  // Produced by passing the implementation's TypeBox input schema through JSON.stringify.
  configSchema: Type.Optional(Type.Unknown()),
});
export type NodeTypeDescriptor = Static<typeof NodeTypeDescriptor>;

export const NodeCategoryDescriptor = Type.Object({
  key: NodeCategory,
  label: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  accent: Type.String({ minLength: 1 }),
});
export type NodeCategoryDescriptor = Static<typeof NodeCategoryDescriptor>;

export const NodeCatalog = Type.Object({
  categories: Type.Array(NodeCategoryDescriptor),
  nodes: Type.Array(NodeTypeDescriptor),
});
export type NodeCatalog = Static<typeof NodeCatalog>;
