'use client';

import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Play,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';

function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

function statusTone(status: string): string {
  switch (status) {
    case 'subscribed':
    case 'transcript_ready':
    case 'article_drafted':
    case 'approved':
    case 'published':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'renewal_due':
    case 'detected':
    case 'queued':
    case 'running':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'failed':
    case 'expired':
      return 'border-rose-200 bg-rose-50 text-rose-800';
    case 'disabled':
    case 'ignored':
      return 'border-slate-200 bg-slate-100 text-slate-700';
    default:
      return 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-gray-600';
  }
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-md border px-2 py-1 text-[11px] capitalize ${statusTone(status)}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-gray-400">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-[var(--color-fg)]">{value}</div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-accent)]">
          {icon}
        </div>
      </div>
    </div>
  );
}

export function YouTubeWorkspace() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const overviewQuery = trpc.youtube.overview.useQuery(undefined, { refetchInterval: 5000 });
  const flowsQuery = trpc.flows.list.useQuery();
  const [profileId, setProfileId] = useState('');
  const [channelRef, setChannelRef] = useState('');
  const [manualVideoUrl, setManualVideoUrl] = useState('');
  const [manualFlowId, setManualFlowId] = useState('');
  const overview = overviewQuery.data;
  const profiles = overview?.profiles ?? [];
  const publishedFlows = useMemo(
    () => (flowsQuery.data ?? []).filter((flow) => flow.publishedVersion !== undefined),
    [flowsQuery.data],
  );
  const publishedFlowById = useMemo(
    () => new Map(publishedFlows.map((flow) => [flow.id, flow])),
    [publishedFlows],
  );
  const selectedProfileId = useMemo(
    () => profileId || profiles[0]?.id || '',
    [profileId, profiles],
  );
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const selectedManualFlowId = useMemo(
    () => manualFlowId || publishedFlows[0]?.id || '',
    [manualFlowId, publishedFlows],
  );
  const selectedManualFlow = publishedFlowById.get(selectedManualFlowId);
  const subscribeMutation = trpc.youtube.subscribe.useMutation({
    onSuccess(subscription) {
      setChannelRef('');
      void utils.youtube.overview.invalidate();
      notify({
        tone: 'success',
        title: 'YouTube subscription requested',
        message: `${subscription.channelTitle ?? subscription.channelId} is registered for upload notifications.`,
      });
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'YouTube subscription failed',
        message: error.message,
        durationMs: 7000,
      });
    },
  });
  const renewMutation = trpc.youtube.renew.useMutation({
    onSuccess(subscription) {
      void utils.youtube.overview.invalidate();
      notify({
        tone: 'success',
        title: 'Subscription renewed',
        message: `${subscription.channelTitle ?? subscription.channelId} is active.`,
      });
    },
    onError(error) {
      notify({ tone: 'error', title: 'Renew failed', message: error.message, durationMs: 7000 });
    },
  });
  const unsubscribeMutation = trpc.youtube.unsubscribe.useMutation({
    onSuccess(subscription) {
      void utils.youtube.overview.invalidate();
      notify({
        tone: 'success',
        title: 'Subscription disabled',
        message: `${subscription.channelTitle ?? subscription.channelId} will no longer receive uploads.`,
      });
    },
    onError(error) {
      notify({ tone: 'error', title: 'Disable failed', message: error.message, durationMs: 7000 });
    },
  });
  const linkFlowMutation = trpc.youtube.linkFlow.useMutation({
    onSuccess(subscription) {
      void utils.youtube.overview.invalidate();
      const flowName = subscription.flowId
        ? publishedFlowById.get(subscription.flowId)?.name
        : undefined;
      notify({
        tone: 'success',
        title: subscription.flowId ? 'Flow linked' : 'Flow unlinked',
        message: subscription.flowId
          ? `${subscription.channelTitle ?? subscription.channelId} will launch ${flowName ?? 'the selected flow'}.`
          : `${subscription.channelTitle ?? subscription.channelId} will only record detections.`,
      });
    },
    onError(error) {
      notify({ tone: 'error', title: 'Flow link failed', message: error.message, durationMs: 7000 });
    },
  });
  const manualRunMutation = trpc.youtube.runVideoUrl.useMutation({
    onSuccess(video) {
      setManualVideoUrl('');
      void utils.youtube.overview.invalidate();
      notify({
        tone: 'success',
        title: 'YouTube run started',
        message: `${video.videoId} is running through ${selectedManualFlow?.name ?? 'the selected flow'}.`,
      });
    },
    onError(error) {
      notify({ tone: 'error', title: 'YouTube run failed', message: error.message, durationMs: 7000 });
    },
  });

  function handleSubscribe() {
    const nextChannelRef = channelRef.trim();
    if (!selectedProfileId || !nextChannelRef) return;
    subscribeMutation.mutate({
      profileId: selectedProfileId,
      channelRef: nextChannelRef,
    });
  }

  function handleManualRun() {
    const videoUrl = manualVideoUrl.trim();
    if (!videoUrl || !selectedManualFlowId) return;
    manualRunMutation.mutate({
      flowId: selectedManualFlowId,
      videoUrl,
    });
  }

  if (overviewQuery.isLoading) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-gray-500">
          Loading YouTube automation...
        </div>
      </main>
    );
  }

  if (overviewQuery.isError || !overview) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
          {overviewQuery.error?.message ?? 'Unable to load YouTube automation.'}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <Play className="h-4 w-4 text-red-600" strokeWidth={2} />
              YouTube Content Automation
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">
              Production monitor for channel upload subscriptions, detected videos, transcript
              extraction, and article drafting runs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => router.push('/channels')}>
              <Radio className="h-3.5 w-3.5" strokeWidth={2} />
              YouTube profiles
            </Button>
            <Button variant="outline" onClick={() => void overviewQuery.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
              Refresh
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Profiles"
            value={overview.profiles.length}
            icon={<Play className="h-4 w-4" strokeWidth={2} />}
          />
          <MetricCard
            label="Subscriptions"
            value={overview.totals.subscriptions}
            icon={<Radio className="h-4 w-4" strokeWidth={2} />}
          />
          <MetricCard
            label="Active"
            value={overview.totals.activeSubscriptions}
            icon={<CheckCircle2 className="h-4 w-4" strokeWidth={2} />}
          />
          <MetricCard
            label="Videos"
            value={overview.totals.videos}
            icon={<FileText className="h-4 w-4" strokeWidth={2} />}
          />
          <MetricCard
            label="Failed"
            value={overview.totals.failedVideos}
            icon={<AlertTriangle className="h-4 w-4" strokeWidth={2} />}
          />
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <FileText className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                YouTube Video URL
              </div>
              <p className="mt-2 max-w-2xl text-sm text-gray-500">
                Start a published article workflow for a single YouTube video immediately.
              </p>
            </div>
            <div className="grid w-full gap-2 lg:w-auto lg:grid-cols-[300px_240px_auto]">
              <input
                value={manualVideoUrl}
                onChange={(event) => setManualVideoUrl(event.target.value)}
                className="h-9 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-fg)] outline-none transition placeholder:text-gray-400 focus:border-[var(--color-accent)]"
                placeholder="https://www.youtube.com/watch?v=..."
              />
              <select
                value={selectedManualFlowId}
                onChange={(event) => setManualFlowId(event.target.value)}
                disabled={flowsQuery.isLoading || publishedFlows.length === 0}
                className="h-9 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)] disabled:bg-[var(--color-surface-2)] disabled:text-gray-400"
                aria-label="Article flow"
              >
                {publishedFlows.length === 0 ? (
                  <option value="">No published flows</option>
                ) : (
                  publishedFlows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))
                )}
              </select>
              <Button
                loading={manualRunMutation.isPending}
                disabled={
                  manualVideoUrl.trim().length === 0 ||
                  !selectedManualFlowId ||
                  manualRunMutation.isPending
                }
                onClick={handleManualRun}
              >
                <Play className="h-3.5 w-3.5" strokeWidth={2} />
                Run Agent
              </Button>
            </div>
          </div>
        </section>

        {overview.profiles.length === 0 && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
              <div>
                <div className="font-medium">No YouTube profile is configured.</div>
                <p className="mt-1 text-amber-800">
                  Create a YouTube Data API channel profile before subscribing production channel
                  monitors.
                </p>
              </div>
            </div>
          </section>
        )}

        {overview.profiles.length > 0 && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                  <Radio className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                  Subscribe Production Channel
                </div>
                <p className="mt-2 max-w-2xl text-sm text-gray-500">
                  Register a channel ID or handle with YouTube WebSub. Upload notifications will
                  arrive at the adapter callback and create ingestion records automatically.
                </p>
              </div>
              <div className="grid w-full gap-2 lg:w-auto lg:grid-cols-[220px_260px_auto]">
                <select
                  value={selectedProfileId}
                  onChange={(event) => setProfileId(event.target.value)}
                  className="h-9 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                  aria-label="YouTube profile"
                >
                  {overview.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                <input
                  value={channelRef}
                  onChange={(event) => setChannelRef(event.target.value)}
                  className="h-9 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-fg)] outline-none transition placeholder:text-gray-400 focus:border-[var(--color-accent)]"
                  placeholder="@channel or UC..."
                />
                <Button
                  loading={subscribeMutation.isPending}
                  disabled={!selectedProfile || channelRef.trim().length === 0}
                  onClick={handleSubscribe}
                >
                  <Radio className="h-3.5 w-3.5" strokeWidth={2} />
                  Subscribe
                </Button>
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <Radio className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                Channel Subscriptions
              </div>
              <span className="text-xs text-gray-400">{overview.subscriptions.length} shown</span>
            </div>

            <div className="mt-4 space-y-3">
              {overview.subscriptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-6 text-sm text-gray-500">
                  No production subscriptions have been registered yet.
                </div>
              ) : (
                overview.subscriptions.map((subscription) => (
                  <div
                    key={subscription.id}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                          {subscription.channelTitle ?? subscription.channelHandle ?? subscription.channelId}
                        </div>
                        <div className="mt-1 truncate text-xs text-gray-500">
                          {subscription.channelId}
                        </div>
                      </div>
                      <StatusPill status={subscription.status} />
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-gray-500 md:grid-cols-2">
                      <span>Lease: {formatDate(subscription.leaseExpiresAt)}</span>
                      <span>Last event: {formatDate(subscription.lastNotificationAt)}</span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      <div className="text-xs font-medium text-gray-500">Linked flow</div>
                      <select
                        value={subscription.flowId ?? ''}
                        onChange={(event) =>
                          linkFlowMutation.mutate({
                            id: subscription.id,
                            ...(event.target.value ? { flowId: event.target.value } : {}),
                          })
                        }
                        disabled={linkFlowMutation.isPending || flowsQuery.isLoading}
                        className="h-9 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)]"
                        aria-label="Linked article flow"
                      >
                        <option value="">Detection only</option>
                        {publishedFlows.map((flow) => (
                          <option key={flow.id} value={flow.id}>
                            {flow.name}
                          </option>
                        ))}
                      </select>
                      {subscription.flowId && !publishedFlowById.has(subscription.flowId) && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Linked flow is not currently published or visible in this workspace.
                        </div>
                      )}
                    </div>
                    {subscription.lastError && (
                      <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        {subscription.lastError}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={renewMutation.isPending}
                        onClick={() => renewMutation.mutate({ id: subscription.id })}
                      >
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                        Renew
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={subscription.status === 'disabled' || unsubscribeMutation.isPending}
                        onClick={() => unsubscribeMutation.mutate({ id: subscription.id })}
                      >
                        Disable
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <FileText className="h-4 w-4 text-[var(--color-accent)]" strokeWidth={2} />
                Recent Videos
              </div>
              <span className="text-xs text-gray-400">{overview.recentVideos.length} shown</span>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-[var(--color-border)]">
              {overview.recentVideos.length === 0 ? (
                <div className="bg-[var(--color-surface-2)] px-4 py-6 text-sm text-gray-500">
                  No YouTube videos have been detected yet.
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-xs uppercase tracking-[0.12em] text-gray-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Video</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Article</th>
                      <th className="px-4 py-3 font-medium">Detected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {overview.recentVideos.map((video) => (
                      <tr key={video.id} className="bg-[var(--color-surface)]">
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <a
                              href={video.videoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-[340px] items-center gap-1.5 truncate font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                            >
                              <span className="truncate">{video.title ?? video.videoId}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={2} />
                            </a>
                            <div className="mt-1 truncate text-xs text-gray-500">
                              {video.channelTitle ?? video.channelId}
                            </div>
                            {video.error && (
                              <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                                {video.error}
                              </div>
                            )}
                            {video.runId && (
                              <div className="mt-2 text-xs text-gray-400">
                                Run <span className="font-mono">{video.runId.slice(0, 8)}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5">
                            <StatusPill status={video.status} />
                            <span className="text-xs text-gray-500">
                              Transcript: {video.transcriptStatus.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill status={video.articleStatus} />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          <div className="flex items-center gap-1.5">
                            <Clock3 className="h-3.5 w-3.5" strokeWidth={2} />
                            {formatDate(video.detectedAt)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
