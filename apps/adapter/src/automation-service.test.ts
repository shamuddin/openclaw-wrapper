import { describe, expect, it } from 'vitest';
import { aggregateAutomationFlowStatus, deriveAutomationIdentity } from './automation-service.js';

describe('automation-service', () => {
  it('derives managed task-flow identity for task triggers', () => {
    expect(
      deriveAutomationIdentity({
        type: 'task',
        taskType: 'inbox-triage',
        taskQueue: 'ops',
        taskPriority: 'high',
      }),
    ).toEqual({
      syncMode: 'managed',
      kind: 'task',
      lookupKey: 'task:inbox-triage:ops',
      triggerKey: 'inbox-triage',
      scopeKey: 'ops',
      label: 'Task Flow - inbox-triage',
      taskSummary: 'inbox-triage in ops (high)',
    });
  });

  it('derives managed task-flow identity for standing-order triggers', () => {
    expect(
      deriveAutomationIdentity({
        type: 'standing-order',
        standingOrderKey: 'daily-inbox-triage',
        standingOrderScope: 'support',
      }),
    ).toEqual({
      syncMode: 'managed',
      kind: 'standing-order',
      lookupKey: 'standing-order:daily-inbox-triage:support',
      triggerKey: 'daily-inbox-triage',
      scopeKey: 'support',
      label: 'Standing Order - daily-inbox-triage',
      taskSummary: 'daily-inbox-triage (support)',
    });
  });

  it('aggregates flow status by preferring active states before terminal states', () => {
    expect(aggregateAutomationFlowStatus(['succeeded', 'failed'])).toBe('partial');
    expect(aggregateAutomationFlowStatus(['failed', 'waiting'])).toBe('waiting');
    expect(aggregateAutomationFlowStatus(['cancelled', 'succeeded'])).toBe('cancelled');
    expect(aggregateAutomationFlowStatus(['succeeded', 'running'])).toBe('running');
  });

  it('marks managed flows as blocked when child work fails without a successful recovery path', () => {
    expect(
      aggregateAutomationFlowStatus(['failed', 'failed'], {
        hasManagedChildren: true,
      }),
    ).toBe('blocked');
  });

  it('marks managed flows as partial when completed work mixes success and failure', () => {
    expect(
      aggregateAutomationFlowStatus(['succeeded', 'failed'], {
        hasManagedChildren: true,
      }),
    ).toBe('partial');
  });

  it('keeps cancelled flows cancelled once all active work has stopped', () => {
    expect(
      aggregateAutomationFlowStatus(['failed', 'cancelled'], {
        currentStatus: 'cancelled',
        hasManagedChildren: true,
      }),
    ).toBe('cancelled');

    expect(
      aggregateAutomationFlowStatus(['succeeded', 'cancelled'], {
        currentStatus: 'cancelled',
      }),
    ).toBe('cancelled');
  });
});
