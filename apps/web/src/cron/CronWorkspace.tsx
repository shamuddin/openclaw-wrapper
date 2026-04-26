'use client';

import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import type { CronJobRecord, CronJobRunRecord, CronSchedule } from '@openclaw-wrapper/schemas';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Clock3,
  Play,
  RefreshCcw,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

function formatSchedule(schedule: CronSchedule): string {
  if (schedule.kind === 'every') {
    const minutes = Math.max(1, Math.round(schedule.everyMs / 60_000));
    if (minutes % (60 * 24) === 0) {
      const days = minutes / (60 * 24);
      return `Every ${days} day${days === 1 ? '' : 's'}`;
    }
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
    }
    return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  if (schedule.kind === 'at') {
    return `At ${new Date(schedule.at).toLocaleString()}`;
  }

  return `${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ''}`;
}

function formatSessionTarget(job: CronJobRecord): string {
  if (job.payload.kind === 'flowTrigger') return 'Published flow';
  if (job.sessionTarget === 'main') return 'Main';
  if (job.sessionTarget === 'isolated') return 'Isolated';
  if (job.sessionTarget === 'current') return 'Current';
  if (job.sessionTarget.startsWith('session:')) {
    return `Session ${job.sessionTarget.slice('session:'.length)}`;
  }
  return job.sessionTarget;
}

function formatRunStatus(status?: string): string {
  return status ? status.replace(/-/g, ' ') : 'Unknown';
}

function statusTone(status?: string): string {
  switch (status) {
    case 'ok':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'error':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'skipped':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-600';
  }
}

function deliveryTone(status?: string): string {
  switch (status) {
    case 'delivered':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'not-delivered':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'not-requested':
      return 'border-slate-200 bg-slate-100 text-slate-600';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-600';
  }
}

function summarizePayload(job: CronJobRecord): string {
  if (job.payload.kind === 'flowTrigger') {
    return 'Starts the published flow owned by this cron trigger node.';
  }
  const text = job.payload.kind === 'systemEvent' ? job.payload.text : job.payload.message;
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

export function CronWorkspace() {
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.workspaces.current.useQuery();
  const statusQuery = trpc.cron.status.useQuery(undefined, { refetchInterval: 15_000 });
  const jobsQuery = trpc.cron.list.useQuery({ includeDisabled: true }, { refetchInterval: 15_000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const historyQuery = trpc.cron.history.useQuery(
    {
      ...(selectedId ? { jobId: selectedId } : {}),
      limit: 50,
    },
    { refetchInterval: 10_000 },
  );

  const jobs = jobsQuery.data ?? [];
  const scheduler = statusQuery.data ?? {
    enabledJobs: 0,
    totalJobs: 0,
    runningJobs: 0,
    dueJobs: 0,
  };
  const workspaceRole = workspaceQuery.data?.current.role ?? 'member';
  const canManageCron = workspaceRole === 'owner' || workspaceRole === 'admin';
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedId) ?? null,
    [jobs, selectedId],
  );
  const history = historyQuery.data ?? [];
  const selectedJobBuilderHref =
    selectedJob?.source?.kind === 'flowTrigger'
      ? `/builder?flow=${encodeURIComponent(selectedJob.source.flowId)}`
      : '/builder';

  useEffect(() => {
    if (selectedId && jobs.some((job) => job.id === selectedId)) {
      return;
    }
    setSelectedId(jobs[0]?.id ?? null);
  }, [jobs, selectedId]);

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (!query) return true;
      return (
        job.name.toLowerCase().includes(query) ||
        (job.description ?? '').toLowerCase().includes(query) ||
        summarizePayload(job).toLowerCase().includes(query)
      );
    });
  }, [jobs, search]);

  const updateMutation = trpc.cron.update.useMutation({
    onSuccess(job) {
      notify({
        tone: 'success',
        title: 'Scheduler updated',
        message: `${job.name} is now ${job.enabled ? 'enabled' : 'disabled'}.`,
      });
      void Promise.all([utils.cron.list.invalidate(), utils.cron.status.invalidate()]);
    },
    onError(error) {
      notify({ tone: 'error', title: 'Update failed', message: error.message, durationMs: 6000 });
    },
  });

  const runMutation = trpc.cron.run.useMutation({
    onSuccess(result) {
      notify({
        tone:
          result.status === 'error' ? 'error' : result.status === 'skipped' ? 'warning' : 'success',
        title: result.triggered ? 'Cron run finished' : 'Cron run skipped',
        message: result.summary ?? result.error ?? 'Cron job processed.',
      });
      void Promise.all([
        utils.cron.list.invalidate(),
        utils.cron.history.invalidate(),
        utils.cron.status.invalidate(),
      ]);
    },
    onError(error) {
      notify({ tone: 'error', title: 'Run failed', message: error.message, durationMs: 6000 });
    },
  });

  async function refreshAll() {
    await Promise.all([statusQuery.refetch(), jobsQuery.refetch(), historyQuery.refetch()]);
  }

  async function toggleJob(job: CronJobRecord) {
    await updateMutation.mutateAsync({
      id: job.id,
      patch: { enabled: !job.enabled },
    });
  }

  if (workspaceQuery.isLoading || jobsQuery.isLoading || statusQuery.isLoading) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-gray-500">
          Loading scheduler dashboard...
        </div>
      </main>
    );
  }

  if (workspaceQuery.isError || jobsQuery.isError || statusQuery.isError) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          {workspaceQuery.error?.message ??
            jobsQuery.error?.message ??
            statusQuery.error?.message ??
            'Unable to load scheduler details.'}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-sky-900">
                <Clock3 className="h-4 w-4" strokeWidth={2} />
                Scheduler Dashboard
              </div>
              <p className="mt-2 max-w-3xl text-sm text-sky-800">
                Cron schedules should be authored inside the flow builder on the `Cron Schedule`
                trigger node. This page is for runtime visibility: health, next wakes, enable state,
                and run history.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/builder"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-white px-4 text-sm font-medium text-sky-900 transition hover:bg-sky-100"
              >
                Open Builder
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
              <Button size="sm" variant="outline" onClick={() => void refreshAll()}>
                <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2} />
                Refresh
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Enabled jobs', value: String(scheduler.enabledJobs) },
            { label: 'Total jobs', value: String(scheduler.totalJobs) },
            { label: 'Running now', value: String(scheduler.runningJobs) },
            { label: 'Due now', value: String(scheduler.dueJobs) },
            {
              label: 'Next wake',
              value: scheduler.nextWakeAt
                ? new Date(scheduler.nextWakeAt).toLocaleString()
                : 'None scheduled',
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 shadow-sm"
            >
              <div className="text-xs uppercase tracking-[0.14em] text-gray-400">{card.label}</div>
              <div className="mt-3 text-xl font-semibold text-[var(--color-fg)]">{card.value}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Activity className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Scheduled Jobs
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  Runtime state for the adapter scheduler. Published flow cron nodes are authored
                  in Builder and mirrored here for health, control, and history.
                </p>
              </div>
              <span className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-gray-500">
                {filteredJobs.length} shown
              </span>
            </div>

            <div className="mt-4">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                placeholder="Search by name, description, or prompt"
              />
            </div>

            <div className="mt-4 space-y-3">
              {filteredJobs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-5 text-sm text-gray-500">
                  No scheduled jobs are visible yet. Publish a flow with a `Cron Schedule` trigger
                  to have it appear here, or add a standalone scheduler job through the adapter API.
                </div>
              ) : (
                filteredJobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedId(job.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                      job.id === selectedId
                        ? 'border-[var(--color-accent)] bg-indigo-50/50'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-2)] hover:border-[var(--color-accent)]/40'
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-[var(--color-fg)]">{job.name}</div>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                              job.enabled
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-100 text-slate-600'
                            }`}
                          >
                            {job.enabled ? 'Enabled' : 'Paused'}
                          </span>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusTone(
                              job.state.lastRunStatus,
                            )}`}
                          >
                            {formatRunStatus(job.state.lastRunStatus)}
                          </span>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${deliveryTone(
                              job.state.lastDeliveryStatus,
                            )}`}
                          >
                            Delivery {formatRunStatus(job.state.lastDeliveryStatus)}
                          </span>
                          {job.source?.kind === 'flowTrigger' && (
                            <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                              Flow-backed
                            </span>
                          )}
                        </div>
                        {job.description && (
                          <p className="mt-2 text-sm text-gray-500">{job.description}</p>
                        )}
                        <p className="mt-2 text-sm text-gray-600">{summarizePayload(job)}</p>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span>{formatSchedule(job.schedule)}</span>
                          <span>{formatSessionTarget(job)}</span>
                          {job.payload.kind !== 'flowTrigger' && <span>Wake {job.wakeMode}</span>}
                          <span>
                            Next{' '}
                            {typeof job.state.nextRunAtMs === 'number'
                              ? new Date(job.state.nextRunAtMs).toLocaleString()
                              : 'not scheduled'}
                          </span>
                        </div>
                      </div>
                      {job.state.lastError && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 lg:max-w-64">
                          {job.state.lastError}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-fg)]">Selected Job</div>
                  <p className="mt-1 text-sm text-gray-500">
                    Runtime controls stay here. Schedule authoring stays in Builder.
                  </p>
                </div>
                {selectedJob && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runMutation.mutate({ id: selectedJob.id, mode: 'due' })}
                      disabled={runMutation.isPending || !canManageCron}
                    >
                      <Play className="h-3.5 w-3.5" strokeWidth={2} />
                      Run if due
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => runMutation.mutate({ id: selectedJob.id, mode: 'force' })}
                      disabled={runMutation.isPending || !canManageCron}
                    >
                      <Play className="h-3.5 w-3.5" strokeWidth={2} />
                      Run now
                    </Button>
                  </div>
                )}
              </div>

              {!selectedJob ? (
                <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-5 text-sm text-gray-500">
                  Select a scheduled job to inspect its runtime state and recent runs.
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold text-[var(--color-fg)]">
                        {selectedJob.name}
                      </div>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                          selectedJob.enabled
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                        }`}
                      >
                        {selectedJob.enabled ? 'Enabled' : 'Paused'}
                      </span>
                    </div>
                    {selectedJob.description && (
                      <p className="mt-2 text-sm text-gray-500">{selectedJob.description}</p>
                    )}
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <div>{summarizePayload(selectedJob)}</div>
                        <div>Schedule: {formatSchedule(selectedJob.schedule)}</div>
                        <div>Target: {formatSessionTarget(selectedJob)}</div>
                        {selectedJob.payload.kind !== 'flowTrigger' && (
                          <div>Wake mode: {selectedJob.wakeMode}</div>
                        )}
                        {selectedJob.source?.kind === 'flowTrigger' && (
                          <div>Source flow version: v{selectedJob.source.flowVersion}</div>
                        )}
                        <div>
                          Next wake:{' '}
                        {typeof selectedJob.state.nextRunAtMs === 'number'
                          ? new Date(selectedJob.state.nextRunAtMs).toLocaleString()
                          : 'not scheduled'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void toggleJob(selectedJob)}
                      disabled={updateMutation.isPending || !canManageCron}
                    >
                      {selectedJob.enabled ? 'Pause job' : 'Resume job'}
                    </Button>
                    <Link
                      href={selectedJobBuilderHref}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]"
                    >
                      {selectedJob?.source?.kind === 'flowTrigger' ? 'Open flow in Builder' : 'Open Builder'}
                    </Link>
                  </div>

                  {(selectedJob.state.lastError || selectedJob.state.lastDeliveryError) && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                        <div>
                          {selectedJob.state.lastError ?? selectedJob.state.lastDeliveryError}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
              <div className="text-sm font-semibold text-[var(--color-fg)]">Run History</div>
              <p className="mt-1 text-sm text-gray-500">
                {selectedJob ? `Recent runs for ${selectedJob.name}.` : 'Recent runs for scheduled jobs.'}
              </p>

              <div className="mt-4 space-y-3">
                {historyQuery.isLoading ? (
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4 text-sm text-gray-500">
                    Loading scheduler history...
                  </div>
                ) : history.length === 0 ? (
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-4 text-sm text-gray-500">
                    No scheduler runs recorded yet.
                  </div>
                ) : (
                  history.map((run: CronJobRunRecord) => (
                    <div
                      key={run.id}
                      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                    >
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-[var(--color-fg)]">{run.jobName}</div>
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${statusTone(
                                run.status,
                              )}`}
                            >
                              {formatRunStatus(run.status)}
                            </span>
                            <span className="rounded-md border border-[var(--color-border)] bg-white px-2 py-0.5 text-[11px] text-gray-600">
                              {run.triggerMode}
                            </span>
                            {run.deliveryStatus && (
                              <span
                                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${deliveryTone(
                                  run.deliveryStatus,
                                )}`}
                              >
                                {run.deliveryStatus}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-sm text-gray-600">
                            {run.summary ?? run.error ?? 'No summary recorded.'}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span>Started {new Date(run.startedAt).toLocaleString()}</span>
                            {run.finishedAt && (
                              <span>Finished {new Date(run.finishedAt).toLocaleString()}</span>
                            )}
                            {typeof run.durationMs === 'number' && <span>{run.durationMs} ms</span>}
                            {run.sessionKey && <span>Session {run.sessionKey}</span>}
                          </div>
                        </div>
                        {run.deliveryError && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 lg:max-w-64">
                            {run.deliveryError}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
