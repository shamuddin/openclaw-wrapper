'use client';

import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitBranch,
  ListTodo,
  RefreshCcw,
  RotateCcw,
  Workflow,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

function statusTone(status: string) {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-900';
    case 'blocked':
      return 'border-orange-200 bg-orange-50 text-orange-900';
    case 'partial':
      return 'border-violet-200 bg-violet-50 text-violet-900';
    case 'running':
      return 'border-sky-200 bg-sky-50 text-sky-900';
    case 'waiting':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    case 'cancelled':
      return 'border-slate-300 bg-slate-100 text-slate-700';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface)] text-gray-600';
  }
}

function formatDateTime(value: string | undefined) {
  if (!value) {
    return 'ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â';
  }
  return new Date(value).toLocaleString();
}

function roleLabel(role: string, attempt: number) {
  switch (role) {
    case 'child':
      return 'Child';
    case 'retry':
      return `Retry ${attempt}`;
    default:
      return 'Root';
  }
}

export function AutomationWorkspace() {
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);

  const overviewQuery = trpc.automation.overview.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (!overviewQuery.data?.recentFlows.length) {
      setSelectedFlowId(null);
      return;
    }
    if (
      !selectedFlowId ||
      !overviewQuery.data.recentFlows.some((flow) => flow.id === selectedFlowId)
    ) {
      setSelectedFlowId(overviewQuery.data.recentFlows[0]?.id ?? null);
    }
  }, [overviewQuery.data, selectedFlowId]);

  const detailQuery = trpc.automation.get.useQuery(
    { id: selectedFlowId ?? '00000000-0000-0000-0000-000000000000' },
    { enabled: !!selectedFlowId, refetchInterval: 10_000 },
  );

  const refreshDetail = () => {
    void Promise.allSettled([overviewQuery.refetch(), detailQuery.refetch()]);
  };

  const cancelFlowMut = trpc.automation.cancel.useMutation({
    onSuccess(result) {
      refreshDetail();
      notify({
        tone: 'success',
        title: 'Automation cancelled',
        message:
          result.cancelledRuns > 0
            ? `Cancelled ${result.cancelledRuns} active run${result.cancelledRuns === 1 ? '' : 's'}.`
            : 'Marked the task flow as cancelled.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Cancel failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const spawnChildMut = trpc.automation.spawnChild.useMutation({
    onSuccess() {
      refreshDetail();
      notify({
        tone: 'success',
        title: 'Child task started',
        message: 'The managed task flow spawned a new child run.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Spawn failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const retryTaskMut = trpc.automation.retryTask.useMutation({
    onSuccess() {
      refreshDetail();
      notify({
        tone: 'success',
        title: 'Retry started',
        message: 'A retry run was queued for the failed task.',
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Retry failed',
        message: error.message,
        durationMs: 6000,
      });
    },
  });

  const cards = useMemo(() => {
    if (!overviewQuery.data) return [];
    return [
      {
        label: 'Managed flows',
        value: overviewQuery.data.totals.flows,
        detail: `${overviewQuery.data.totals.activeFlows} active`,
        icon: Workflow,
      },
      {
        label: 'Tracked tasks',
        value: overviewQuery.data.totals.tasks,
        detail: `${overviewQuery.data.totals.activeTasks} active`,
        icon: ListTodo,
      },
      {
        label: 'Blocked or partial',
        value:
          overviewQuery.data.flowStatusCounts.blocked + overviewQuery.data.flowStatusCounts.partial,
        detail: `${overviewQuery.data.flowStatusCounts.failed} failed root flows`,
        icon: AlertTriangle,
      },
      {
        label: 'Succeeded',
        value: overviewQuery.data.flowStatusCounts.succeeded,
        detail: `${overviewQuery.data.flowStatusCounts.waiting} waiting`,
        icon: CheckCircle2,
      },
    ];
  }, [overviewQuery.data]);

  const canCancelSelectedFlow =
    detailQuery.data?.flow.status === 'pending' ||
    detailQuery.data?.flow.status === 'running' ||
    detailQuery.data?.flow.status === 'waiting';
  const canSpawnWork =
    detailQuery.data?.flow.status !== 'cancelled' && detailQuery.data?.flow.status !== 'succeeded';

  if (overviewQuery.isLoading && !overviewQuery.data) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-gray-500">
          Loading automation registry...
        </div>
      </main>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          {overviewQuery.error?.message ?? 'Unable to load automation registry.'}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                Phase 8
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--color-fg)]">
                Managed taskflow orchestration
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-gray-500">
                Task and standing-order flows now keep durable progression steps, child-task
                lineage, retry attempts, and richer rollups like blocked and partial completion.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 text-sm font-medium text-gray-600 transition hover:text-[var(--color-fg)]"
              onClick={refreshDetail}
            >
              <RefreshCcw className="h-4 w-4" strokeWidth={2} />
              Refresh
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-400">
                      {card.label}
                    </span>
                    <Icon className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  </div>
                  <div className="mt-3 text-3xl font-semibold text-[var(--color-fg)]">
                    {card.value}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{card.detail}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <GitBranch className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
              Recent task flows
            </div>
            <div className="mt-4 space-y-3">
              {overviewQuery.data.recentFlows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-6 text-sm text-gray-500">
                  No tracked task flows yet. Start a Task or Standing Order trigger to populate the
                  registry.
                </div>
              ) : (
                overviewQuery.data.recentFlows.map((flow) => (
                  <button
                    key={flow.id}
                    type="button"
                    onClick={() => setSelectedFlowId(flow.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                      selectedFlowId === flow.id
                        ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                          {flow.name}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {flow.syncMode} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· {flow.triggerType}{' '}
                          ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· rev {flow.revision}
                        </div>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusTone(flow.status)}`}
                      >
                        {flow.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                      <span>{flow.taskCount} task entries</span>
                      <span>Updated {formatDateTime(flow.updatedAt)}</span>
                    </div>
                    {flow.lastError && (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                        <span>{flow.lastError}</span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
            {!selectedFlowId || (detailQuery.isLoading && !detailQuery.data) ? (
              <div className="text-sm text-gray-500">
                Select a managed task flow to inspect its orchestration steps and task lineage.
              </div>
            ) : detailQuery.isError || !detailQuery.data ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900">
                {detailQuery.error?.message ?? 'Unable to load task flow details.'}
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--color-fg)]">
                        {detailQuery.data.flow.name}
                      </h3>
                      <div className="mt-1 text-sm text-gray-500">
                        {detailQuery.data.flow.lookupKey}
                      </div>
                    </div>
                    <span
                      className={`rounded-md border px-2 py-1 text-xs font-medium ${statusTone(detailQuery.data.flow.status)}`}
                    >
                      {detailQuery.data.flow.status}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {canCancelSelectedFlow && (
                      <Button
                        size="sm"
                        variant="danger"
                        loading={cancelFlowMut.isPending}
                        onClick={() =>
                          cancelFlowMut.mutate({
                            id: detailQuery.data.flow.id,
                          })
                        }
                      >
                        <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
                        Cancel task flow
                      </Button>
                    )}
                    {canSpawnWork && detailQuery.data.tasks[0] && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={spawnChildMut.isPending}
                        onClick={() =>
                          spawnChildMut.mutate({
                            taskFlowId: detailQuery.data.flow.id,
                            sourceTaskId: detailQuery.data.tasks[0]?.id,
                          })
                        }
                      >
                        <GitBranch className="h-3.5 w-3.5" strokeWidth={2} />
                        Spawn child from latest task
                      </Button>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-gray-600">
                      <div className="text-xs uppercase tracking-[0.16em] text-gray-400">
                        Sync mode
                      </div>
                      <div className="mt-1 font-medium text-[var(--color-fg)]">
                        {detailQuery.data.flow.syncMode}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-gray-600">
                      <div className="text-xs uppercase tracking-[0.16em] text-gray-400">
                        Trigger
                      </div>
                      <div className="mt-1 font-medium text-[var(--color-fg)]">
                        {detailQuery.data.flow.triggerType} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â·{' '}
                        {detailQuery.data.flow.triggerKey}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-4">
                    {(
                      [
                        ['running', detailQuery.data.taskStatusCounts.running],
                        ['waiting', detailQuery.data.taskStatusCounts.waiting],
                        ['failed', detailQuery.data.taskStatusCounts.failed],
                        [
                          'succeeded',
                          detailQuery.data.taskStatusCounts.succeeded +
                            detailQuery.data.taskStatusCounts.partial,
                        ],
                      ] as const
                    ).map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-gray-600"
                      >
                        <div className="text-xs uppercase tracking-[0.16em] text-gray-400">
                          {label}
                        </div>
                        <div className="mt-1 font-medium text-[var(--color-fg)]">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Revision {detailQuery.data.flow.revision}</span>
                    <span>Started {formatDateTime(detailQuery.data.flow.startedAt)}</span>
                    <span>Finished {formatDateTime(detailQuery.data.flow.finishedAt)}</span>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                      <ListTodo className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                      Task ledger
                    </div>
                    <div className="mt-3 space-y-3">
                      {detailQuery.data.tasks.map((task) => (
                        <div
                          key={task.id}
                          className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                                {task.summary}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                {roleLabel(task.role, task.attempt)} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· sequence{' '}
                                {task.sequence} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· run {task.runId.slice(0, 8)}
                              </div>
                            </div>
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusTone(task.status)}`}
                            >
                              {task.status}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
                            <span>Attempt {task.attempt}</span>
                            <span>Created {formatDateTime(task.createdAt)}</span>
                            <span>Finished {formatDateTime(task.finishedAt)}</span>
                            {task.parentTaskId && (
                              <span>Parent {task.parentTaskId.slice(0, 8)}</span>
                            )}
                            {task.sourceTaskId && (
                              <span>Source {task.sourceTaskId.slice(0, 8)}</span>
                            )}
                            {task.delegations?.length ? (
                              <span>
                                {task.delegations.length} delegation
                                {task.delegations.length === 1 ? '' : 's'}
                              </span>
                            ) : null}
                          </div>

                          {task.delegations?.length ? (
                            <div className="mt-3 space-y-2">
                              {task.delegations.map((delegation) => (
                                <div
                                  key={delegation.id}
                                  className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="font-medium">
                                      Delegated to {delegation.targetAgent}
                                    </div>
                                    <span className="rounded-md border border-sky-300 bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-700">
                                      {delegation.status}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-[11px] text-sky-800">
                                    {formatDateTime(delegation.createdAt)}
                                    {delegation.gatewayRunId
                                      ? ` - gateway ${delegation.gatewayRunId}`
                                      : ''}
                                    {delegation.depth ? ` - depth ${delegation.depth}` : ''}
                                  </div>
                                  <div className="mt-1 break-all text-[11px] text-sky-800">
                                    Session {delegation.sessionKey}
                                  </div>
                                  {delegation.model && (
                                    <div className="mt-1 text-[11px] text-sky-800">
                                      Model {delegation.model}
                                    </div>
                                  )}
                                  {delegation.handoffReason && (
                                    <div className="mt-1 text-[11px] text-sky-800">
                                      {delegation.handoffReason}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-3 flex flex-wrap gap-2">
                            {canSpawnWork && (
                              <Button
                                size="sm"
                                variant="outline"
                                loading={
                                  spawnChildMut.isPending &&
                                  spawnChildMut.variables?.sourceTaskId === task.id
                                }
                                onClick={() =>
                                  spawnChildMut.mutate({
                                    taskFlowId: detailQuery.data.flow.id,
                                    sourceTaskId: task.id,
                                  })
                                }
                              >
                                <GitBranch className="h-3.5 w-3.5" strokeWidth={2} />
                                Spawn child
                              </Button>
                            )}
                            {task.status === 'failed' &&
                              detailQuery.data.flow.status !== 'cancelled' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  loading={
                                    retryTaskMut.isPending &&
                                    retryTaskMut.variables?.taskId === task.id
                                  }
                                  onClick={() =>
                                    retryTaskMut.mutate({
                                      taskId: task.id,
                                    })
                                  }
                                >
                                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                                  Retry task
                                </Button>
                              )}
                          </div>

                          {task.error && (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                              {task.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                      <Clock3 className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                      Progression timeline
                    </div>
                    <div className="mt-3 space-y-3">
                      {detailQuery.data.steps.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-6 text-sm text-gray-500">
                          No orchestration steps recorded yet.
                        </div>
                      ) : (
                        detailQuery.data.steps.map((step) => (
                          <div
                            key={step.id}
                            className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-[var(--color-fg)]">
                                  {step.summary}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                  {step.stepType}
                                  {step.taskId
                                    ? ` ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· task ${step.taskId.slice(0, 8)}`
                                    : ''}
                                  {step.runId
                                    ? ` ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· run ${step.runId.slice(0, 8)}`
                                    : ''}
                                </div>
                              </div>
                              {step.status && (
                                <span
                                  className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusTone(step.status)}`}
                                >
                                  {step.status}
                                </span>
                              )}
                            </div>
                            <div className="mt-2 text-[11px] text-gray-500">
                              {formatDateTime(step.createdAt)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
