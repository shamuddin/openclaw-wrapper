import { type Static, Type } from '@sinclair/typebox';
import './formats.js';

export const Position = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
});
export type Position = Static<typeof Position>;

export const GraphNode = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: Type.String({ minLength: 1 }),
  position: Position,
  data: Type.Record(Type.String(), Type.Unknown()),
});
export type GraphNode = Static<typeof GraphNode>;

export const GraphEdge = Type.Object({
  id: Type.String({ minLength: 1 }),
  source: Type.String({ minLength: 1 }),
  sourcePort: Type.String({ minLength: 1 }),
  target: Type.String({ minLength: 1 }),
  targetPort: Type.String({ minLength: 1 }),
});
export type GraphEdge = Static<typeof GraphEdge>;

export const FlowDefinition = Type.Object({
  name: Type.String({ minLength: 1 }),
  nodes: Type.Array(GraphNode),
  edges: Type.Array(GraphEdge),
});
export type FlowDefinition = Static<typeof FlowDefinition>;

export const FlowGraph = Type.Intersect([
  Type.Object({
    id: Type.String({ minLength: 1 }),
    version: Type.Integer({ minimum: 1 }),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
  }),
  FlowDefinition,
]);
export type FlowGraph = Static<typeof FlowGraph>;

export const DraftFlow = Type.Intersect([
  FlowGraph,
  Type.Object({
    publishedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  }),
]);
export type DraftFlow = Static<typeof DraftFlow>;

export const PublishedFlowVersion = Type.Intersect([
  Type.Object({
    id: Type.String({ minLength: 1 }),
    flowId: Type.String({ minLength: 1 }),
    version: Type.Integer({ minimum: 1 }),
    publishedAt: Type.String({ format: 'date-time' }),
  }),
  FlowDefinition,
]);
export type PublishedFlowVersion = Static<typeof PublishedFlowVersion>;

export const FlowLifecycle = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  draftVersion: Type.Integer({ minimum: 1 }),
  publishedVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});
export type FlowLifecycle = Static<typeof FlowLifecycle>;
