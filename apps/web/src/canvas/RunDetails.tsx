'use client';

import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import type { Run } from '@openclaw-wrapper/schemas';
import type { RunLineage } from '@openclaw-wrapper/schemas/run';
import {
  Clipboard,
  ChevronDown,
  Download,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';

interface TimelineEventRecord {
  id: string;
  createdAt: string;
  runId: string;
  sequence: number;
  eventType: string;
  event: { type: string; [key: string]: unknown };
}

interface RunDetailsNode {
  id: string;
  data: {
    label?: unknown;
    nodeType?: unknown;
  };
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function readString(event: TimelineEventRecord['event'], key: string): string | undefined {
  const value = event[key];
  return typeof value === 'string' ? value : undefined;
}

function readRecordObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return readRecordObject(parsed);
  } catch {
    return undefined;
  }
}

function getNodeEventResult(record: TimelineEventRecord): unknown {
  return record.event.result;
}

function getAgentReplyObject(result: unknown): Record<string, unknown> | undefined {
  const resultObject = readRecordObject(result);
  const replyText = typeof resultObject?.replyText === 'string' ? resultObject.replyText : '';
  return replyText.trim() ? parseJsonObject(replyText.trim()) : undefined;
}

function getNodeEventDisplayOutput(record: TimelineEventRecord): unknown {
  const result = getNodeEventResult(record);
  const agentReply = getAgentReplyObject(result);
  if (agentReply) return agentReply;

  const resultObject = readRecordObject(result);
  if (resultObject && 'output' in resultObject) {
    return resultObject.output;
  }
  return result;
}

function readDelegationEvent(record: TimelineEventRecord):
  | {
      nodeId: string;
      targetAgent: string;
      sessionKey: string;
      gatewayRunId?: string;
      handoffReason?: string;
      model?: string;
      createdAt: string;
    }
  | undefined {
  if (record.event.type !== 'run.delegated') {
    return undefined;
  }

  const nodeId = readString(record.event, 'nodeId');
  const targetAgent = readString(record.event, 'targetAgent');
  const sessionKey = readString(record.event, 'sessionKey');
  if (!nodeId || !targetAgent || !sessionKey) {
    return undefined;
  }

  const gatewayRunId = readString(record.event, 'gatewayRunId');
  const handoffReason = readString(record.event, 'handoffReason');
  const model = readString(record.event, 'model');

  return {
    nodeId,
    targetAgent,
    sessionKey,
    ...(gatewayRunId ? { gatewayRunId } : {}),
    ...(handoffReason ? { handoffReason } : {}),
    ...(model ? { model } : {}),
    createdAt: record.createdAt,
  };
}

function readRemoteCancelRelayData(record: TimelineEventRecord):
  | {
      relayMethod: string;
      fallbackFrom?: string;
    }
  | undefined {
  if (record.event.type !== 'run.log') {
    return undefined;
  }

  const rawData = record.event.data;
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return undefined;
  }

  const data = rawData as {
    kind?: unknown;
    relayMethod?: unknown;
    fallbackFrom?: unknown;
  };

  if (data.kind !== 'remote-cancel-relay' || typeof data.relayMethod !== 'string') {
    return undefined;
  }

  return {
    relayMethod: data.relayMethod,
    ...(typeof data.fallbackFrom === 'string' ? { fallbackFrom: data.fallbackFrom } : {}),
  };
}

function eventSummary(record: TimelineEventRecord): string {
  const remoteCancelRelay = readRemoteCancelRelayData(record);
  if (remoteCancelRelay) {
    return remoteCancelRelay.fallbackFrom
      ? `Upstream cancel fallback via ${remoteCancelRelay.relayMethod} after ${remoteCancelRelay.fallbackFrom}`
      : `Upstream cancel requested via ${remoteCancelRelay.relayMethod}`;
  }

  switch (record.event.type) {
    case 'run.queued':
      return `Queued — ${String((record.event.trigger as { type?: string } | undefined)?.type ?? 'unknown')}`;
    case 'run.started':
      return 'Run started';
    case 'run.delegated':
      return `Delegated to ${readString(record.event, 'targetAgent') ?? 'agent'}`;
    case 'run.approval.requested':
      return readString(record.event, 'reason')
        ? `Approval requested — ${readString(record.event, 'reason')}`
        : 'Approval requested';
    case 'run.approval.recorded':
      return `Approval ${readString(record.event, 'decision') ?? 'recorded'}`;
    case 'run.waiting':
      return `Waiting until ${readString(record.event, 'resumeAt') ?? 'scheduled time'}`;
    case 'run.resumed':
      return 'Run resumed';
    case 'node.started':
      return `Started: ${readString(record.event, 'nodeId') ?? 'n/a'}`;
    case 'node.finished':
      return `Finished: ${readString(record.event, 'nodeId') ?? 'n/a'}`;
    case 'node.failed':
      return `Failed: ${readString(record.event, 'nodeId') ?? 'n/a'}`;
    case 'run.log':
      return readString(record.event, 'message') ?? 'Log';
    case 'run.finished':
      return readString(record.event, 'error')
        ? `Finished: ${readString(record.event, 'status') ?? 'unknown'} — ${readString(record.event, 'error')}`
        : `Finished: ${readString(record.event, 'status') ?? 'unknown'}`;
  }
  return record.event.type;
}

function eventStatus(record: TimelineEventRecord): {
  label: string;
  classes: string;
  helper: string;
} {
  const type = record.event.type;
  if (type === 'node.failed') {
    return {
      label: 'failed',
      classes: 'border-red-200 bg-red-50 text-red-700',
      helper: 'A node stopped with an error.',
    };
  }
  if (type === 'run.finished') {
    const status = readString(record.event, 'status') ?? 'finished';
    return {
      label: status,
      classes:
        status === 'succeeded'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : status === 'failed'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-gray-200 bg-gray-50 text-gray-700',
      helper: status === 'succeeded' ? 'The whole run completed.' : 'The run has ended.',
    };
  }
  if (type === 'run.approval.requested' || type === 'run.waiting') {
    return {
      label: 'waiting',
      classes: 'border-violet-200 bg-violet-50 text-violet-700',
      helper: 'The run paused and is waiting before continuing.',
    };
  }
  if (type === 'run.approval.recorded') {
    const rejected = readString(record.event, 'decision') === 'rejected';
    return {
      label: rejected ? 'rejected' : 'approved',
      classes: rejected
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700',
      helper: rejected
        ? 'The approval was rejected by a user.'
        : 'The approval was accepted by a user.',
    };
  }
  if (type === 'node.started' || type === 'run.started' || type === 'run.resumed') {
    return {
      label: 'running',
      classes: 'border-blue-200 bg-blue-50 text-blue-700',
      helper: 'Work started or resumed.',
    };
  }
  if (type === 'node.finished' || readDelegationEvent(record)) {
    return {
      label: 'done',
      classes: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      helper: 'This step completed.',
    };
  }
  return {
    label: 'recorded',
    classes: 'border-gray-200 bg-gray-50 text-gray-700',
    helper: 'Informational event.',
  };
}

function eventFriendlyDetails(record: TimelineEventRecord): string[] {
  const rows: string[] = [];
  const nodeId = readString(record.event, 'nodeId');
  if (nodeId) rows.push(`Node: ${nodeId}`);
  const reason = readString(record.event, 'reason');
  if (reason) rows.push(`Reason: ${reason}`);
  const decision = readString(record.event, 'decision');
  if (decision) rows.push(`Decision: ${decision}`);
  const error = readString(record.event, 'error');
  if (error) rows.push(`Error: ${error}`);
  if (record.event.type === 'node.finished' && 'result' in record.event) {
    const result = record.event.result as { output?: unknown } | undefined;
    if (result?.output && typeof result.output === 'object') {
      const output = result.output as Record<string, unknown>;
      if (typeof output.videoId === 'string') rows.push(`Video: ${output.videoId}`);
      if (typeof output.characterCount === 'number') {
        rows.push(`Transcript: ${output.characterCount} characters`);
      }
      if (typeof output.segmentCount === 'number') rows.push(`Segments: ${output.segmentCount}`);
      if (typeof output.agentId === 'string') rows.push(`Agent: ${output.agentId}`);
    }
  }
  return rows;
}

export function statusClasses(status: Run['status']) {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'failed':
      return 'border-red-200 bg-red-50 text-red-600';
    case 'running':
      return 'border-blue-200 bg-blue-50 text-blue-700';
    case 'waiting':
      return 'border-violet-200 bg-violet-50 text-violet-700';
    case 'cancelled':
      return 'border-gray-200 bg-gray-100 text-gray-500';
    case 'pending':
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
}

export function statusDotClass(status: Run['status']) {
  switch (status) {
    case 'succeeded':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-red-500';
    case 'running':
      return 'bg-blue-500 animate-pulse';
    case 'waiting':
      return 'bg-violet-500 animate-pulse';
    case 'cancelled':
      return 'bg-gray-400';
    case 'pending':
      return 'bg-amber-400 animate-pulse';
  }
}

function delegatedStatusClasses(status: RunLineage['delegatedChildren'][number]['status']) {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'failed':
      return 'border-red-200 bg-red-50 text-red-600';
    case 'cancelled':
      return 'border-gray-200 bg-gray-100 text-gray-500';
    case 'running':
      return 'border-blue-200 bg-blue-50 text-blue-700';
  }
}

function NodeOutputCard({
  record,
  label,
  nodeType,
  selected,
  onCopy,
}: {
  record: TimelineEventRecord;
  label: string;
  nodeType?: string;
  selected?: boolean;
  onCopy: (value: unknown) => void;
}) {
  const output = getNodeEventDisplayOutput(record);
  const resultObject = readRecordObject(getNodeEventResult(record));
  const replyText = typeof resultObject?.replyText === 'string' ? resultObject.replyText : '';
  const outputObject = readRecordObject(output);
  const title = typeof outputObject?.title === 'string' ? outputObject.title : undefined;
  const summary = typeof outputObject?.summary === 'string' ? outputObject.summary : undefined;
  const bodyMarkdown =
    typeof outputObject?.bodyMarkdown === 'string' ? outputObject.bodyMarkdown : undefined;

  return (
    <div
      className={`rounded-xl border p-3 ${
        selected
          ? 'border-blue-200 bg-blue-50/60'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--color-fg)]">{label}</div>
          <div className="mt-0.5 text-[10px] text-gray-400">
            {nodeType ?? 'node'} - finished at {new Date(record.createdAt).toLocaleTimeString()}
          </div>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-gray-400 transition hover:bg-[var(--color-surface-2)] hover:text-gray-600"
          onClick={() => onCopy(output)}
          aria-label={`Copy ${label} output`}
        >
          <Clipboard className="h-3 w-3" strokeWidth={2} />
          Copy
        </button>
      </div>

      {title ? (
        <div className="mt-3 rounded-lg bg-white/80 p-2">
          <div className="text-[11px] font-medium text-gray-500">Article title</div>
          <div className="mt-1 text-sm font-semibold text-[var(--color-fg)]">{title}</div>
          {summary ? <p className="mt-1 text-xs leading-5 text-gray-600">{summary}</p> : null}
        </div>
      ) : null}

      {bodyMarkdown ? (
        <details className="mt-2 rounded-lg bg-white/80 p-2">
          <summary className="cursor-pointer text-[11px] font-medium text-gray-500">
            Article markdown
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-gray-700">
            {bodyMarkdown}
          </pre>
        </details>
      ) : null}

      {!title && replyText ? (
        <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-[11px] text-gray-700">
          {replyText}
        </pre>
      ) : null}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] font-medium text-gray-500">
          Full node output JSON
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-gray-50 p-2 text-[10px] text-gray-600">
          {prettyJson(output)}
        </pre>
      </details>
    </div>
  );
}

export function RunDetails({
  run,
  events,
  lineage,
  nodes = [],
  selectedNodeId,
  onApprove,
  onReject,
  onCancel,
  approvalBusy,
  cancelBusy,
}: {
  run: Run;
  events: TimelineEventRecord[] | undefined;
  lineage?: RunLineage;
  nodes?: RunDetailsNode[];
  selectedNodeId?: string | null;
  onApprove?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  approvalBusy?: boolean;
  cancelBusy?: boolean;
}) {
  async function exportRun() {
    try {
      const blob = new Blob([prettyJson({ run, events: events ?? [], lineage })], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `run-${run.id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify({ tone: 'error', title: 'Export failed', message: 'Could not download run data.' });
    }
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(prettyJson(run.output));
      notify({ tone: 'success', title: 'Copied', message: 'Run output in clipboard.' });
    } catch {
      notify({ tone: 'error', title: 'Copy failed', message: 'Clipboard unavailable.' });
    }
  }

  async function copyNodeOutput(value: unknown) {
    try {
      await navigator.clipboard.writeText(prettyJson(value));
      notify({ tone: 'success', title: 'Copied', message: 'Node output in clipboard.' });
    } catch {
      notify({ tone: 'error', title: 'Copy failed', message: 'Clipboard unavailable.' });
    }
  }

  const canCancel =
    run.status === 'pending' || run.status === 'running' || run.status === 'waiting';
  const delegatedChildren = lineage?.delegatedChildren ?? [];
  const delegations = (events ?? [])
    .map((record) => readDelegationEvent(record))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const nodeMetaById = new Map(
    nodes.map((node) => [
      node.id,
      {
        label:
          typeof node.data.label === 'string' && node.data.label.trim()
            ? node.data.label.trim()
            : node.id,
        nodeType: typeof node.data.nodeType === 'string' ? node.data.nodeType : undefined,
      },
    ]),
  );
  const finishedNodeEvents = (events ?? [])
    .filter((record) => record.event.type === 'node.finished' && readString(record.event, 'nodeId'))
    .sort((left, right) => left.sequence - right.sequence);
  const selectedNodeFinishedEvents = selectedNodeId
    ? finishedNodeEvents.filter((record) => readString(record.event, 'nodeId') === selectedNodeId)
    : [];
  const otherFinishedNodeEvents = selectedNodeId
    ? finishedNodeEvents.filter((record) => readString(record.event, 'nodeId') !== selectedNodeId)
    : finishedNodeEvents;

  return (
    <div className="space-y-3">
      {/* Run header */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${statusDotClass(run.status)}`}
                aria-hidden="true"
              />
              <div className="text-sm font-medium text-[var(--color-fg)]">
                Run <span className="font-mono">{run.id.slice(0, 8)}</span>
              </div>
            </div>
            <div className="mt-0.5 text-[11px] text-gray-400">
              {new Date(run.createdAt).toLocaleString()} · flow v{run.flowVersion}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusClasses(run.status)}`}
              aria-label={`Status: ${run.status}`}
            >
              {run.status}
            </span>
            <button
              type="button"
              aria-label="Export run as JSON"
              title="Export run as JSON"
              className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition hover:bg-[var(--color-surface-2)] hover:text-gray-600"
              onClick={exportRun}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-gray-400">
          Trigger: {run.trigger.label ?? run.trigger.type}
        </div>

        {run.error && (
          <div className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-600">
            {run.error}
          </div>
        )}

        {run.status === 'waiting' && run.resumeAt && (
          <div className="mt-2 rounded-lg bg-violet-50 px-2 py-1.5 text-xs font-medium text-violet-700">
            ⏳ Resumes at {new Date(run.resumeAt).toLocaleString()}
          </div>
        )}

        {canCancel && onCancel && (
          <div className="mt-3">
            <Button size="sm" variant="danger" onClick={onCancel} loading={cancelBusy}>
              <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
              Cancel run
            </Button>
          </div>
        )}

        {/* Approval block — made prominent */}
        {run.pendingApproval && (
          <div className="mt-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              <span className="text-xs font-semibold text-amber-800">
                Action required — Pending approval
              </span>
            </div>
            {run.pendingApproval.reason && (
              <div className="mb-1 text-xs text-amber-700">{run.pendingApproval.reason}</div>
            )}
            {run.pendingApproval.command && (
              <code className="mb-2 block break-all rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-900">
                {run.pendingApproval.command}
              </code>
            )}
            {run.pendingApproval.timeoutAt && (
              <div className="mb-2 text-[11px] font-medium text-amber-600">
                ⏱ Times out at {new Date(run.pendingApproval.timeoutAt).toLocaleString()}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={onApprove} disabled={approvalBusy}>
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={onReject} disabled={approvalBusy}>
                <ShieldX className="h-3.5 w-3.5" strokeWidth={2} />
                Reject
              </Button>
            </div>
          </div>
        )}

        {run.input !== undefined && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Input
            </div>
            <pre className="max-h-40 overflow-auto rounded-lg bg-gray-50 p-2 text-[10px] text-gray-600">
              {prettyJson(run.input)}
            </pre>
          </div>
        )}

        {run.output !== undefined && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-gray-400">
              <span>Output</span>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1 py-0.5 text-gray-400 transition hover:text-gray-600"
                onClick={copyOutput}
                aria-label="Copy output"
              >
                <Clipboard className="h-3 w-3" strokeWidth={2} />
                Copy
              </button>
            </div>
            <pre className="max-h-40 overflow-auto rounded-lg bg-gray-50 p-2 text-[10px] text-gray-600">
              {prettyJson(run.output)}
            </pre>
          </div>
        )}

        {delegatedChildren.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Delegated Child Runs
              {lineage && lineage.maxDelegationDepth > 0
                ? ` · max depth ${lineage.maxDelegationDepth}`
                : ''}
            </div>
            <div className="space-y-2">
              {delegatedChildren.map((child: RunLineage['delegatedChildren'][number]) => (
                <div
                  key={child.id}
                  className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs text-sky-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">
                      {child.targetAgent} via {child.parentNodeId}
                    </div>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${delegatedStatusClasses(child.status)}`}
                    >
                      {child.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-sky-800">
                    Started {new Date(child.createdAt).toLocaleString()}
                    {child.gatewayRunId ? ` · gateway ${child.gatewayRunId}` : ''}
                    {child.depth ? ` · depth ${child.depth}` : ''}
                  </div>
                  <div className="mt-1 break-all text-[11px] text-sky-800">
                    Session {child.sessionKey}
                  </div>
                  {child.model && (
                    <div className="mt-1 text-[11px] text-sky-800">Model {child.model}</div>
                  )}
                  {child.handoffReason && (
                    <div className="mt-1 text-[11px] text-sky-800">{child.handoffReason}</div>
                  )}
                  {child.replyText && (
                    <div className="mt-1 text-[11px] text-sky-800">{child.replyText}</div>
                  )}
                  {child.error && (
                    <div className="mt-1 text-[11px] text-red-600">{child.error}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {delegations.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Delegation Lanes
            </div>
            <div className="space-y-2">
              {delegations.map((delegation, index) => (
                <div
                  key={`${delegation.nodeId}:${delegation.sessionKey}:${index}`}
                  className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs text-sky-900"
                >
                  <div className="font-medium">
                    {delegation.targetAgent} via {delegation.nodeId}
                  </div>
                  <div className="mt-1 text-[11px] text-sky-800">
                    Started {new Date(delegation.createdAt).toLocaleString()}
                    {delegation.gatewayRunId ? ` Â· gateway ${delegation.gatewayRunId}` : ''}
                  </div>
                  <div className="mt-1 break-all text-[11px] text-sky-800">
                    Session {delegation.sessionKey}
                  </div>
                  {delegation.model && (
                    <div className="mt-1 text-[11px] text-sky-800">Model {delegation.model}</div>
                  )}
                  {delegation.handoffReason && (
                    <div className="mt-1 text-[11px] text-sky-800">{delegation.handoffReason}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {finishedNodeEvents.length > 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="mb-2">
            <p className="text-xs font-medium text-gray-600">Node outputs</p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              Select a canvas node to pin its latest output here.
            </p>
          </div>
          <div className="space-y-2">
            {[...selectedNodeFinishedEvents, ...otherFinishedNodeEvents].map((record) => {
              const nodeId = readString(record.event, 'nodeId') ?? '';
              const meta = nodeMetaById.get(nodeId);
              return (
                <NodeOutputCard
                  key={record.id}
                  record={record}
                  label={meta?.label ?? nodeId}
                  nodeType={meta?.nodeType}
                  selected={Boolean(selectedNodeId && selectedNodeId === nodeId)}
                  onCopy={copyNodeOutput}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Event timeline */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
          <p className="text-xs font-medium text-gray-500">
            Event timeline
            {events?.length ? ` (${events.length})` : ''}
          </p>
        </div>
        <div className="max-h-80 divide-y divide-[var(--color-border)] overflow-auto">
          {events?.length ? (
            events.map((record) => (
              <div key={record.id} className="px-3 py-2">
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                      eventStatus(record).classes
                    }`}
                  >
                    {eventStatus(record).label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="truncate text-[12px] text-[var(--color-fg)]">
                        {eventSummary(record)}
                      </div>
                      <div className="shrink-0 text-[10px] text-gray-400">
                        {new Date(record.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {record.event.type} · #{record.sequence}
                    </div>
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-[var(--color-fg)]"
                      onClick={() =>
                        setExpandedEventId(expandedEventId === record.id ? null : record.id)
                      }
                    >
                      Details
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition ${
                          expandedEventId === record.id ? 'rotate-180' : ''
                        }`}
                        strokeWidth={2}
                      />
                    </button>
                    {expandedEventId === record.id ? (
                      <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-gray-50 p-2.5">
                        {eventFriendlyDetails(record).length > 0 ? (
                          <div className="space-y-1 text-[11px] text-gray-600">
                            {eventFriendlyDetails(record).map((line) => (
                              <div key={line}>{line}</div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-gray-500">
                            No extra summary for this event.
                          </div>
                        )}
                        <details className="mt-2">
                          <summary className="cursor-pointer text-[11px] font-medium text-gray-500">
                            Technical JSON
                          </summary>
                          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-white p-2 text-[10px] text-gray-600">
                            {prettyJson(record.event)}
                          </pre>
                        </details>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="px-3 py-3 text-xs text-gray-400">No events yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
