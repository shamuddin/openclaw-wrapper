'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { buildAdapterUrl } from '@/lib/adapter-url';
import { buildTriggerPlan } from '@/lib/trigger-plan';
import { trpc } from '@/lib/trpc';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Clock3,
  ListTodo,
  Loader2,
  MessagesSquare,
  Play,
  RefreshCcw,
  Repeat2,
  Settings2,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { NodeConfigPanel } from './NodeConfigPanel';
import { RunDetails } from './RunDetails';
import { RunList } from './RunList';
import { edgesToGraph, nodesToGraph } from './serialize';
import { useCanvasStore } from './store';
import { getBuilderIssues } from './validation';

type InspectorTab = 'configure' | 'runs';

const INSPECTOR_DEFAULT_WIDTH = 360;
const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 760;

function clampInspectorWidth(width: number): number {
  if (typeof window === 'undefined') {
    return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, width));
  }
  const viewportAwareMax = Math.min(
    INSPECTOR_MAX_WIDTH,
    Math.max(INSPECTOR_MIN_WIDTH, window.innerWidth - 560),
  );
  return Math.min(viewportAwareMax, Math.max(INSPECTOR_MIN_WIDTH, width));
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function StatusBanner({ children, tone }: { children: ReactNode; tone: 'warning' | 'success' }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
        tone === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {tone === 'warning' ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      ) : (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function RunInspector() {
  const {
    flowId,
    flowName,
    flowVersion,
    publishedVersion,
    dirty,
    nodes,
    edges,
    selectedCanvasItem,
  } = useCanvasStore(
    useShallow((state) => ({
      flowId: state.flowId,
      flowName: state.flowName,
      flowVersion: state.flowVersion,
      publishedVersion: state.publishedVersion,
      dirty: state.dirty,
      nodes: state.nodes,
      edges: state.edges,
      selectedCanvasItem:
        state.nodes.find((n) => n.selected)?.id ?? state.edges.find((e) => e.selected)?.id ?? null,
    })),
  );

  const [activeTab, setActiveTab] = useState<InspectorTab>('configure');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [revealedTriggerSecret, setRevealedTriggerSecret] = useState<string | null>(null);
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const [runLimit, setRunLimit] = useState(25);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [isResizingInspector, setIsResizingInspector] = useState(false);
  const resizeStartRef = useRef({ x: 0, width: INSPECTOR_DEFAULT_WIDTH });

  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.workspaces.current.useQuery();
  const workspaceRole = workspaceQuery.data?.current.role ?? 'member';
  const canManageTriggerSecrets = workspaceRole === 'owner' || workspaceRole === 'admin';

  useEffect(() => {
    const storedWidth = window.localStorage.getItem('openclaw:builder-inspector-width');
    if (!storedWidth) return;
    const parsed = Number.parseInt(storedWidth, 10);
    if (Number.isFinite(parsed)) {
      setInspectorWidth(clampInspectorWidth(parsed));
    }
  }, []);

  useEffect(() => {
    if (!isResizingInspector) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(event: PointerEvent) {
      const delta = event.clientX - resizeStartRef.current.x;
      setInspectorWidth(clampInspectorWidth(resizeStartRef.current.width - delta));
    }

    function handlePointerUp() {
      setIsResizingInspector(false);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isResizingInspector]);

  useEffect(() => {
    window.localStorage.setItem('openclaw:builder-inspector-width', String(inspectorWidth));
  }, [inspectorWidth]);

  function beginInspectorResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (window.innerWidth < 1024) return;
    event.preventDefault();
    resizeStartRef.current = { x: event.clientX, width: inspectorWidth };
    setIsResizingInspector(true);
  }

  const runsQuery = trpc.runs.list.useQuery(
    { flowId: flowId ?? '00000000-0000-0000-0000-000000000000', limit: runLimit },
    { enabled: !!flowId, refetchInterval: 2000 },
  );
  const approvalQueueQuery = trpc.runs.approvalQueue.useQuery(
    { status: 'pending', limit: 10 },
    { refetchInterval: 3000 },
  );
  const flowSecurityQuery = trpc.flows.triggerSecurity.useQuery(
    { id: flowId ?? '00000000-0000-0000-0000-000000000000' },
    { enabled: !!flowId && canManageTriggerSecrets },
  );

  const requestedInspectorTab = searchParams.get('tab')?.trim();
  const requestedRunId = searchParams.get('run')?.trim() || null;

  const selectedRun = runsQuery.data?.find((r) => r.id === selectedRunId) ?? runsQuery.data?.[0];

  const eventsQuery = trpc.runs.events.useQuery(
    { id: selectedRun?.id ?? '00000000-0000-0000-0000-000000000000' },
    {
      enabled: !!selectedRun?.id,
      refetchInterval:
        selectedRun?.status === 'running' || selectedRun?.status === 'waiting' ? 1500 : 4000,
    },
  );
  const lineageQuery = trpc.runs.lineage.useQuery(
    { id: selectedRun?.id ?? '00000000-0000-0000-0000-000000000000' },
    {
      enabled: !!selectedRun?.id,
      refetchInterval:
        selectedRun?.status === 'running' || selectedRun?.status === 'waiting' ? 1500 : 4000,
    },
  );

  function invalidateRun(run: { id: string; flowId: string }) {
    Promise.all([
      runsQuery.refetch(),
      utils.runs.list.invalidate({ flowId: run.flowId, limit: 50 }),
      utils.runs.events.invalidate(),
      utils.runs.lineage.invalidate(),
    ]).catch(() => undefined);
  }

  const startManualMut = trpc.runs.startManual.useMutation({
    onSuccess(run) {
      setSelectedRunId(run.id);
      setActiveTab('runs');
      invalidateRun(run);
      notify({ tone: 'success', title: 'Run started', message: run.id.slice(0, 8) });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Run failed', message: err.message, durationMs: 6000 });
    },
  });
  const startWebhookMut = trpc.runs.startWebhook.useMutation({
    onSuccess(run) {
      setSelectedRunId(run.id);
      setActiveTab('runs');
      invalidateRun(run);
      notify({ tone: 'success', title: 'Webhook run started', message: run.id.slice(0, 8) });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Run failed', message: err.message, durationMs: 6000 });
    },
  });
  const startChannelMut = trpc.runs.startChannel.useMutation({
    onSuccess(run) {
      setSelectedRunId(run.id);
      setActiveTab('runs');
      invalidateRun(run);
      notify({ tone: 'success', title: 'Channel run started', message: run.id.slice(0, 8) });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Run failed', message: err.message, durationMs: 6000 });
    },
  });
  const startCronMut = trpc.runs.startCron.useMutation({
    onSuccess(run) {
      setSelectedRunId(run.id);
      setActiveTab('runs');
      invalidateRun(run);
      notify({ tone: 'success', title: 'Cron run started', message: run.id.slice(0, 8) });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Run failed', message: err.message, durationMs: 6000 });
    },
  });
  const startHookMut = trpc.runs.startHook.useMutation({
    onSuccess(run) {
      setSelectedRunId(run.id);
      setActiveTab('runs');
      invalidateRun(run);
      notify({ tone: 'success', title: 'Hook run started', message: run.id.slice(0, 8) });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Run failed', message: err.message, durationMs: 6000 });
    },
  });
  const startTaskMut = trpc.runs.startTask.useMutation({
    onSuccess(run) {
      setSelectedRunId(run.id);
      setActiveTab('runs');
      invalidateRun(run);
      notify({ tone: 'success', title: 'Task run started', message: run.id.slice(0, 8) });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Run failed', message: err.message, durationMs: 6000 });
    },
  });
  const startStandingOrderMut = trpc.runs.startStandingOrder.useMutation({
    onSuccess(run) {
      setSelectedRunId(run.id);
      setActiveTab('runs');
      invalidateRun(run);
      notify({
        tone: 'success',
        title: 'Standing-order run started',
        message: run.id.slice(0, 8),
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Run failed', message: err.message, durationMs: 6000 });
    },
  });
  const approvalMut = trpc.runs.decideApproval.useMutation({
    onSuccess(run, variables) {
      setSelectedRunId(run.id);
      invalidateRun(run);
      void Promise.allSettled([
        approvalQueueQuery.refetch(),
        utils.runs.approvalQueue.invalidate(),
      ]);
      notify({
        tone: 'success',
        title: 'Approval recorded',
        message:
          variables.decision === 'approved'
            ? `${run.id.slice(0, 8)} approved`
            : `${run.id.slice(0, 8)} rejected`,
      });
    },
    onError(err) {
      Promise.all([
        runsQuery.refetch(),
        utils.runs.list.invalidate(),
        utils.runs.events.invalidate(),
        utils.runs.approvalQueue.invalidate(),
      ]).catch(() => undefined);
      notify({ tone: 'error', title: 'Approval failed', message: err.message, durationMs: 6000 });
    },
  });
  const cancelRunMut = trpc.runs.cancel.useMutation({
    onSuccess(run) {
      setSelectedRunId(run.id);
      invalidateRun(run);
      void Promise.allSettled([
        approvalQueueQuery.refetch(),
        utils.runs.approvalQueue.invalidate(),
      ]);
      notify({
        tone: 'success',
        title: 'Run cancelled',
        message: `${run.id.slice(0, 8)} cancelled`,
      });
    },
    onError(err) {
      Promise.all([
        runsQuery.refetch(),
        utils.runs.list.invalidate(),
        utils.runs.events.invalidate(),
        utils.runs.approvalQueue.invalidate(),
      ]).catch(() => undefined);
      notify({ tone: 'error', title: 'Cancel failed', message: err.message, durationMs: 6000 });
    },
  });
  const revealSecretMut = trpc.flows.revealTriggerSecret.useMutation({
    onSuccess(result) {
      setRevealedTriggerSecret(result.secret);
      void flowSecurityQuery.refetch();
      notify({
        tone: 'success',
        title: 'Trigger secret ready',
        message: 'Copy it before calling the raw trigger URL.',
      });
    },
    onError(err) {
      notify({
        tone: 'error',
        title: 'Secret unavailable',
        message: err.message,
        durationMs: 6000,
      });
    },
  });
  const rotateSecretMut = trpc.flows.rotateTriggerSecret.useMutation({
    onSuccess(result) {
      setRevealedTriggerSecret(result.secret);
      void flowSecurityQuery.refetch();
      notify({
        tone: 'success',
        title: 'Secret rotated',
        message: 'Existing callers must update to the new secret.',
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Rotation failed', message: err.message, durationMs: 6000 });
    },
  });

  useEffect(() => {
    setRevealedTriggerSecret(null);
    if (!flowId) setSelectedRunId(null);
    setRunLimit(25);
  }, [flowId]);
  useEffect(() => {
    if (!runsQuery.data?.length) return;
    const exists = selectedRunId ? runsQuery.data.some((r) => r.id === selectedRunId) : false;
    if (!exists) setSelectedRunId(runsQuery.data[0]?.id ?? null);
  }, [runsQuery.data, selectedRunId]);
  useEffect(() => {
    if (!flowId) return;
    if (requestedRunId) {
      setSelectedRunId(requestedRunId);
      setActiveTab('runs');
      return;
    }
    if (requestedInspectorTab === 'runs') {
      setActiveTab('runs');
    }
  }, [flowId, requestedInspectorTab, requestedRunId]);
  useEffect(() => {
    if (selectedCanvasItem) setActiveTab('configure');
  }, [selectedCanvasItem]);

  const webhookUrl = flowId ? buildAdapterUrl(`/webhooks/flows/${flowId}`) : null;
  const graphIssues = useMemo(
    () => getBuilderIssues(nodesToGraph(nodes), edgesToGraph(edges)),
    [edges, nodes],
  );
  const triggerPlan = useMemo(
    () => buildTriggerPlan(nodesToGraph(nodes), flowName),
    [flowName, nodes],
  );

  const readinessItems = useMemo(() => {
    const items: Array<{ message: string }> = [];
    if (!flowId) {
      items.push({ message: 'Save the flow to enable publishing and runs.' });
      return items;
    }
    if (!publishedVersion) items.push({ message: 'Publish the draft before triggering runs.' });
    if (dirty) items.push({ message: 'Save unsaved changes before running.' });
    for (const issue of graphIssues) items.push({ message: issue.message });
    return items;
  }, [dirty, flowId, graphIssues, publishedVersion]);

  const isReady = readinessItems.length === 0;
  const runPending =
    startManualMut.isPending ||
    startWebhookMut.isPending ||
    startChannelMut.isPending ||
    startCronMut.isPending ||
    startHookMut.isPending ||
    startTaskMut.isPending ||
    startStandingOrderMut.isPending;
  const canRun =
    !!flowId && !!publishedVersion && !dirty && graphIssues.length === 0 && !runPending;
  const securityBusy = revealSecretMut.isPending || rotateSecretMut.isPending;

  async function copyWebhookUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      notify({ tone: 'success', title: 'Copied', message: 'Webhook URL in clipboard.' });
    } catch {
      notify({ tone: 'error', title: 'Copy failed', message: 'Clipboard unavailable.' });
    }
  }

  async function copySecret() {
    if (!revealedTriggerSecret) {
      notify({
        tone: 'warning',
        title: 'Reveal first',
        message: 'Reveal or rotate the secret first.',
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(revealedTriggerSecret);
      notify({ tone: 'success', title: 'Copied', message: 'Trigger secret in clipboard.' });
    } catch {
      notify({ tone: 'error', title: 'Copy failed', message: 'Clipboard unavailable.' });
    }
  }

  async function copySamplePayload() {
    try {
      await navigator.clipboard.writeText(prettyJson(triggerPlan.payload));
      notify({
        tone: 'success',
        title: 'Copied',
        message: `${triggerPlan.title} payload in clipboard.`,
      });
    } catch {
      notify({ tone: 'error', title: 'Copy failed', message: 'Clipboard unavailable.' });
    }
  }

  function runSampleTrigger() {
    if (!flowId) return;

    switch (triggerPlan.kind) {
      case 'webhook':
        startWebhookMut.mutate({
          flowId,
          eventName: triggerPlan.eventName,
          input: triggerPlan.payload,
          label: 'Inspector webhook sample',
          sourceId: 'inspector:webhook',
        });
        return;
      case 'channel':
        if (!triggerPlan.channel || !triggerPlan.accountId) return;
        startChannelMut.mutate({
          flowId,
          channel: triggerPlan.channel,
          routeKey: triggerPlan.routeKey,
          accountId: triggerPlan.accountId,
          input: triggerPlan.payload,
          label: 'Inspector channel sample',
          sourceId: 'inspector:channel',
        });
        return;
      case 'cron':
        if (!triggerPlan.schedule) return;
        startCronMut.mutate({
          flowId,
          schedule: triggerPlan.schedule,
          ...(triggerPlan.timezone ? { timezone: triggerPlan.timezone } : {}),
          input: triggerPlan.payload,
          label: 'Inspector cron sample',
          sourceId: 'inspector:cron',
        });
        return;
      case 'hook':
        if (!triggerPlan.hookName) return;
        startHookMut.mutate({
          flowId,
          hookName: triggerPlan.hookName,
          filter: triggerPlan.filter,
          input: triggerPlan.payload,
          label: 'Inspector hook sample',
          sourceId: 'inspector:hook',
        });
        return;
      case 'task':
        if (!triggerPlan.taskType) return;
        startTaskMut.mutate({
          flowId,
          taskType: triggerPlan.taskType,
          taskQueue: triggerPlan.taskQueue,
          taskPriority: triggerPlan.taskPriority,
          input: triggerPlan.payload,
          label: 'Inspector task sample',
          sourceId: 'inspector:task',
        });
        return;
      case 'standing-order':
        if (!triggerPlan.standingOrderKey) return;
        startStandingOrderMut.mutate({
          flowId,
          standingOrderKey: triggerPlan.standingOrderKey,
          standingOrderScope: triggerPlan.standingOrderScope,
          input: triggerPlan.payload,
          label: 'Inspector standing-order sample',
          sourceId: 'inspector:standing-order',
        });
        return;
      default:
        startManualMut.mutate({
          flowId,
          input: triggerPlan.payload,
          label: 'Inspector run',
          sourceId: 'inspector:manual',
        });
    }
  }

  return (
    <>
      <aside
        style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}
        className="relative flex h-[40vh] w-full shrink-0 flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)] lg:h-full lg:w-[var(--inspector-width)] lg:border-l lg:border-t-0"
      >
        <button
          type="button"
          aria-label="Resize configuration panel"
          title="Drag to resize panel. Double-click to reset."
          onPointerDown={beginInspectorResize}
          onDoubleClick={() => setInspectorWidth(INSPECTOR_DEFAULT_WIDTH)}
          className={`absolute left-0 top-0 z-20 hidden h-full w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center lg:flex ${
            isResizingInspector ? 'bg-blue-500/10' : 'hover:bg-blue-500/5'
          }`}
        >
          <span
            className={`h-12 w-1 rounded-full transition ${
              isResizingInspector ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          />
        </button>
        {/* Header */}
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--color-fg)]">{flowName}</p>
              <p className="text-[11px] text-gray-400">
                {flowId
                  ? `Draft v${flowVersion}${publishedVersion ? ` · pub v${publishedVersion}` : ''}`
                  : 'Not saved'}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                isReady
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              {isReady ? 'Ready' : 'Attention'}
            </span>
          </div>

          <div className="mt-3 flex gap-1">
            {(['configure', 'runs'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${
                  activeTab === tab
                    ? 'bg-[var(--color-surface-2)] text-[var(--color-fg)]'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab === 'configure' ? (
                  <Settings2 className="h-3.5 w-3.5" strokeWidth={2} />
                ) : (
                  <Activity className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                {tab === 'configure' ? 'Configure' : 'Runs'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-3">
            {readinessItems.length > 0 && (
              <StatusBanner tone="warning">
                {readinessItems.map((item) => (
                  <div key={item.message}>{item.message}</div>
                ))}
              </StatusBanner>
            )}
            {isReady && (
              <StatusBanner tone="success">
                <div>Published and ready to run.</div>
              </StatusBanner>
            )}

            {activeTab === 'configure' ? (
              <>
                {/* Webhook URL */}
                {flowId && publishedVersion && webhookUrl && (
                  <div className="rounded-xl border border-[var(--color-border)] p-3">
                    <p className="mb-2 text-xs font-medium text-gray-500">Webhook URL</p>
                    <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-2">
                      <Webhook
                        className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]"
                        strokeWidth={2}
                      />
                      <span className="break-all font-mono text-[10px] text-gray-600">
                        {webhookUrl}
                      </span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void copyWebhookUrl()}>
                      <Clipboard className="h-3.5 w-3.5" strokeWidth={2} />
                      Copy URL
                    </Button>
                  </div>
                )}

                {/* Trigger security */}
                {flowId && publishedVersion && canManageTriggerSecrets && (
                  <div className="rounded-xl border border-[var(--color-border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-gray-500">Trigger security</p>
                        <p className="mt-1 text-xs text-gray-500">
                          Send the flow secret in the{' '}
                          <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">
                            {flowSecurityQuery.data?.headerName ?? 'x-openclaw-flow-secret'}
                          </code>{' '}
                          header.
                        </p>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${flowSecurityQuery.data?.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                      >
                        {flowSecurityQuery.data?.configured ? 'configured' : 'needs secret'}
                      </span>
                    </div>

                    {flowSecurityQuery.data?.configured && (
                      <div className="mt-2 rounded-lg bg-gray-50 px-2.5 py-2 text-[11px] text-gray-600">
                        Preview:{' '}
                        <span className="font-medium text-gray-700">
                          {flowSecurityQuery.data.preview}
                        </span>
                        {flowSecurityQuery.data.rotatedAt && (
                          <div className="mt-0.5">
                            Rotated {new Date(flowSecurityQuery.data.rotatedAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    )}

                    {revealedTriggerSecret && (
                      <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-2">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-indigo-700">
                          Current secret
                        </div>
                        <code className="mt-1 block break-all text-[11px] text-indigo-800">
                          {revealedTriggerSecret}
                        </code>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!flowSecurityQuery.data?.canGenerate || securityBusy}
                        onClick={() => flowId && revealSecretMut.mutate({ id: flowId })}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                        {revealedTriggerSecret ? 'Reveal again' : 'Reveal secret'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={!flowSecurityQuery.data?.canGenerate || securityBusy}
                        onClick={() => setRotateConfirmOpen(true)}
                      >
                        <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2} />
                        Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!revealedTriggerSecret}
                        onClick={() => void copySecret()}
                      >
                        <Clipboard className="h-3.5 w-3.5" strokeWidth={2} />
                        Copy
                      </Button>
                    </div>
                  </div>
                )}

                <NodeConfigPanel />
              </>
            ) : (
              <>
                {/* Run controls */}
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={runSampleTrigger} disabled={!canRun}>
                    {runPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <Play className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                    {runPending ? 'Running…' : triggerPlan.runLabel}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      runsQuery.refetch();
                      if (selectedRun?.id) eventsQuery.refetch();
                    }}
                    disabled={!flowId}
                  >
                    <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2} />
                    Refresh
                  </Button>
                  {webhookUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copyWebhookUrl()}
                      aria-label="Copy webhook URL"
                    >
                      <Clipboard className="h-3.5 w-3.5" strokeWidth={2} />
                    </Button>
                  )}
                </div>

                {/* Trigger plan card */}
                <div className="rounded-xl border border-[var(--color-border)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-500">{triggerPlan.title}</p>
                      <p className="mt-1 text-sm text-[var(--color-fg)]">
                        {triggerPlan.description}
                      </p>
                    </div>
                    <div className="shrink-0 rounded-lg bg-[var(--color-surface-2)] p-2 text-gray-500">
                      {triggerPlan.kind === 'webhook' ? (
                        <Webhook className="h-4 w-4" strokeWidth={2} />
                      ) : triggerPlan.kind === 'channel' ? (
                        <MessagesSquare className="h-4 w-4" strokeWidth={2} />
                      ) : triggerPlan.kind === 'task' ? (
                        <ListTodo className="h-4 w-4" strokeWidth={2} />
                      ) : triggerPlan.kind === 'standing-order' ? (
                        <Repeat2 className="h-4 w-4" strokeWidth={2} />
                      ) : (
                        <Clock3 className="h-4 w-4" strokeWidth={2} />
                      )}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    {triggerPlan.meta.map((line) => (
                      <div key={line} className="text-[11px] text-gray-500">
                        {line}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                      Sample payload
                    </div>
                    <pre className="max-h-32 overflow-auto rounded-lg bg-gray-50 p-2 text-[10px] text-gray-600">
                      {prettyJson(triggerPlan.payload)}
                    </pre>
                  </div>
                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={() => void copySamplePayload()}>
                      <Clipboard className="h-3.5 w-3.5" strokeWidth={2} />
                      Copy payload
                    </Button>
                  </div>
                </div>

                {flowId ? (
                  <>
                    <div className="rounded-xl border border-[var(--color-border)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium text-gray-500">Workspace approvals</p>
                          <p className="mt-1 text-xs text-gray-500">
                            Pending human decisions across this workspace.
                          </p>
                        </div>
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          {approvalQueueQuery.data?.length ?? 0} pending
                        </span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {approvalQueueQuery.isLoading && (
                          <div className="text-xs text-gray-400">Loading approvals...</div>
                        )}
                        {approvalQueueQuery.data?.length
                          ? approvalQueueQuery.data.map((request) => (
                              <div
                                key={request.id}
                                className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium text-[var(--color-fg)]">
                                      {request.flowName} · {request.nodeId}
                                    </div>
                                    <div className="mt-1 text-[11px] text-gray-500">
                                      {request.reason ??
                                        (request.command
                                          ? `Command: ${request.command}`
                                          : 'Approval required')}
                                    </div>
                                    {request.approvalMode && (
                                      <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-700">
                                        Mode: {request.approvalMode}
                                      </div>
                                    )}
                                    <div className="mt-1 text-[10px] text-gray-400">
                                      Requested {new Date(request.requestedAt).toLocaleString()}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 gap-2">
                                    <Button
                                      size="sm"
                                      disabled={approvalMut.isPending}
                                      onClick={() =>
                                        approvalMut.mutate({
                                          id: request.runId,
                                          decision: 'approved',
                                        })
                                      }
                                    >
                                      <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={approvalMut.isPending}
                                      onClick={() =>
                                        approvalMut.mutate({
                                          id: request.runId,
                                          decision: 'rejected',
                                        })
                                      }
                                    >
                                      Reject
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))
                          : !approvalQueueQuery.isLoading && (
                              <div className="text-xs text-gray-400">
                                No pending approvals right now.
                              </div>
                            )}
                      </div>
                    </div>
                    <RunList
                      runs={runsQuery.data}
                      isLoading={runsQuery.isLoading}
                      selectedRunId={selectedRun?.id ?? null}
                      onSelect={setSelectedRunId}
                    />
                    {runsQuery.data && runsQuery.data.length >= runLimit && (
                      <button
                        type="button"
                        className="w-full rounded-xl border border-[var(--color-border)] py-2 text-xs text-gray-400 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                        onClick={() => setRunLimit((n) => n + 25)}
                      >
                        Load more runs
                      </button>
                    )}
                    {selectedRun && (
                      <RunDetails
                        run={selectedRun}
                        events={eventsQuery.data}
                        lineage={lineageQuery.data}
                        approvalBusy={approvalMut.isPending}
                        cancelBusy={cancelRunMut.isPending}
                        onApprove={
                          selectedRun.pendingApproval
                            ? () => approvalMut.mutate({ id: selectedRun.id, decision: 'approved' })
                            : undefined
                        }
                        onReject={
                          selectedRun.pendingApproval
                            ? () => approvalMut.mutate({ id: selectedRun.id, decision: 'rejected' })
                            : undefined
                        }
                        onCancel={
                          selectedRun.status === 'pending' ||
                          selectedRun.status === 'running' ||
                          selectedRun.status === 'waiting'
                            ? () => cancelRunMut.mutate({ id: selectedRun.id })
                            : undefined
                        }
                      />
                    )}
                  </>
                ) : (
                  <p className="text-xs text-gray-400">Save the flow to see run history.</p>
                )}
              </>
            )}
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={rotateConfirmOpen}
        title="Rotate trigger secret"
        message="Rotating the secret will break all existing external callers — they must update to the new secret immediately. Continue?"
        confirmLabel="Rotate secret"
        variant="danger"
        onConfirm={() => {
          setRotateConfirmOpen(false);
          if (flowId) rotateSecretMut.mutate({ id: flowId });
        }}
        onCancel={() => setRotateConfirmOpen(false)}
      />
    </>
  );
}
