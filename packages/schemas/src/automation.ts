import { type Static, Type } from '@sinclair/typebox';

export const AutomationTaskFlowSyncMode = Type.Union([
  Type.Literal('managed'),
  Type.Literal('mirrored'),
]);
export type AutomationTaskFlowSyncMode = Static<typeof AutomationTaskFlowSyncMode>;

export const AutomationTaskFlowStatus = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('waiting'),
  Type.Literal('blocked'),
  Type.Literal('partial'),
  Type.Literal('succeeded'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);
export type AutomationTaskFlowStatus = Static<typeof AutomationTaskFlowStatus>;

export const AutomationTaskKind = Type.Union([
  Type.Literal('task'),
  Type.Literal('standing-order'),
]);
export type AutomationTaskKind = Static<typeof AutomationTaskKind>;

export const AutomationTaskRole = Type.Union([
  Type.Literal('root'),
  Type.Literal('child'),
  Type.Literal('retry'),
]);
export type AutomationTaskRole = Static<typeof AutomationTaskRole>;

export const AutomationTaskFlowStepType = Type.Union([
  Type.Literal('flow.created'),
  Type.Literal('task.spawned'),
  Type.Literal('task.status'),
  Type.Literal('flow.status'),
]);
export type AutomationTaskFlowStepType = Static<typeof AutomationTaskFlowStepType>;
