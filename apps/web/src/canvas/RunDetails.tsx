'use client';

import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import type { Run } from '@openclaw-wrapper/schemas';
import type { RunLineage } from '@openclaw-wrapper/schemas/run';
import {
  CheckCircle2,
  Circle,
  Clipboard,
  Download,
  Loader2,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react';

interface TimelineEventRecord {
  id: string;
  createdAt: string;
  runId: string;
  sequence: number;
  eventType: string;
  event: { type: string; [key: string]: unknown };
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function readString(event: TimelineEventRecord['event'], key: string): string | undefined {
  const value = event[key];
  return typeof value === 'string' ? value : undefined;
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

function eventIcon(record: TimelineEventRecord) {
  if (readDelegationEvent(record)) {
    return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-sky-500" strokeWidth={2} />;
  }
  if (readRemoteCancelRelayData(record)) {
    return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-sky-500" strokeWidth={2} />;
  }
  const type = record.event.type;
  if (type === 'node.failed' || type === 'run.finished') {
    return <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" strokeWidth={2} />;
  }
  if (type === 'node.finished' || type === 'run.started') {
    return <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" strokeWidth={2} />;
  }
  if (type === 'run.approval.requested' || type === 'run.waiting') {
    return (
      <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-violet-400" strokeWidth={2} />
    );
  }
  return <Circle className="mt-0.5 h-3 w-3 shrink-0 text-gray-300" strokeWidth={2} />;
}

function EventPayload({ record }: { record: TimelineEventRecord }) {
  if (record.event.type === 'run.log' && record.event.data !== undefined) {
    return (
      <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-gray-50 p-2 text-[10px] text-gray-600">
        {prettyJson(record.event.data)}
      </pre>
    );
  }
  if (record.event.type === 'node.finished' && 'result' in record.event) {
    return (
      <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg bg-gray-50 p-2 text-[10px] text-gray-600">
        {prettyJson(record.event.result)}
      </pre>
    );
  }
  return null;
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

export function RunDetails({
  run,
  events,
  lineage,
  onApprove,
  onReject,
  onCancel,
  approvalBusy,
  cancelBusy,
}: {
  run: Run;
  events: TimelineEventRecord[] | undefined;
  lineage?: RunLineage;
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

  const canCancel =
    run.status === 'pending' || run.status === 'running' || run.status === 'waiting';
  const delegatedChildren = lineage?.delegatedChildren ?? [];
  const delegations = (events ?? [])
    .map((record) => readDelegationEvent(record))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry);

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
                  {eventIcon(record)}
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
                    <EventPayload record={record} />
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
