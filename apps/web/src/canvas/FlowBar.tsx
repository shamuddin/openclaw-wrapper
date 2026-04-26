'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { clearLastFlowId, readLastFlowId, saveLastFlowId } from '@/lib/flow-selection';
import { trpc } from '@/lib/trpc';
import type { GraphNode } from '@openclaw-wrapper/schemas';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  FilePlus2,
  FolderOpen,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { edgesToGraph, nodesToGraph } from './serialize';
import { useCanvasStore } from './store';
import { getBuilderIssues } from './validation';

function pillClasses(tone: 'neutral' | 'accent' | 'warning') {
  switch (tone) {
    case 'accent':
      return 'border-indigo-200 bg-indigo-50 text-indigo-700';
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-gray-200 bg-gray-100 text-gray-500';
  }
}

const EMPTY_FLOW_ID = '00000000-0000-0000-0000-000000000000';
const AUTOSAVE_DELAY_MS = 3000;
const POLICY_VALIDATION_DELAY_MS = 350;

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  variant: 'danger' | 'default';
  onConfirm: () => void;
}

type PublishPolicyIssue = { code: string; severity: 'error'; message: string };

export function FlowBar() {
  const {
    nodes,
    edges,
    flowId,
    flowName,
    flowVersion,
    publishedVersion,
    dirty,
    setFlowName,
    loadFlow,
    markSaved,
    markPublished,
    resetFlow,
  } = useCanvasStore(
    useShallow((s) => ({
      nodes: s.nodes,
      edges: s.edges,
      flowId: s.flowId,
      flowName: s.flowName,
      flowVersion: s.flowVersion,
      publishedVersion: s.publishedVersion,
      dirty: s.dirty,
      setFlowName: s.setFlowName,
      loadFlow: s.loadFlow,
      markSaved: s.markSaved,
      markPublished: s.markPublished,
      resetFlow: s.resetFlow,
    })),
  );

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [flowSearch, setFlowSearch] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [autosaveFlash, setAutosaveFlash] = useState(false);
  const [publishPolicyIssues, setPublishPolicyIssues] = useState<PublishPolicyIssue[]>([]);
  const [publishPolicyPending, setPublishPolicyPending] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishPolicyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishPolicyRequestSeq = useRef(0);
  const doSaveRef = useRef<() => void>(() => undefined);
  const publishPolicyValidateRef = useRef<
    (input: { nodes: GraphNode[] }) => Promise<PublishPolicyIssue[]>
  >(() => Promise.resolve([]));

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.workspaces.current.useQuery();
  const listQuery = trpc.flows.list.useQuery(undefined, { enabled: open });
  const versionsQuery = trpc.flows.versions.useQuery(
    { id: flowId ?? EMPTY_FLOW_ID },
    { enabled: open && !!flowId },
  );
  const publishPolicyMut = trpc.flows.publishPolicy.useMutation();

  const graphNodes = useMemo(() => nodesToGraph(nodes), [nodes]);
  const graphEdges = useMemo(() => edgesToGraph(edges), [edges]);
  const deferredGraphNodes = useDeferredValue(graphNodes);

  const graphIssues = useMemo(
    () => getBuilderIssues(graphNodes, graphEdges),
    [graphEdges, graphNodes],
  );
  const hasExecNode = useMemo(
    () => deferredGraphNodes.some((node) => node.type === 'tool.exec'),
    [deferredGraphNodes],
  );
  const combinedIssues = useMemo(() => {
    const seen = new Set<string>();
    return [...graphIssues, ...publishPolicyIssues].filter((issue) => {
      const key = `${issue.code}:${issue.message}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [graphIssues, publishPolicyIssues]);
  const graphIssueMessage = combinedIssues.map((i) => i.message).join(' ');
  const workspaceRole = workspaceQuery.data?.current.role ?? 'member';
  const canManageLiveFlow = workspaceRole === 'owner' || workspaceRole === 'admin';

  const filteredFlows = useMemo(() => {
    if (!listQuery.data) return [];
    const q = flowSearch.trim().toLowerCase();
    if (!q) return listQuery.data;
    return listQuery.data.filter((f) => f.name.toLowerCase().includes(q));
  }, [listQuery.data, flowSearch]);
  const requestedFlowId = searchParams.get('flow')?.trim() || null;

  useEffect(() => {
    publishPolicyValidateRef.current = (input) => publishPolicyMut.mutateAsync(input);
  }, [publishPolicyMut]);

  // Warn on page unload when there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Persist last-opened flow id
  useEffect(() => {
    if (!flowId) return;
    saveLastFlowId(flowId);
  }, [flowId]);

  useEffect(() => {
    if (publishPolicyTimer.current) {
      clearTimeout(publishPolicyTimer.current);
      publishPolicyTimer.current = null;
    }

    if (!hasExecNode) {
      publishPolicyRequestSeq.current += 1;
      setPublishPolicyPending(false);
      setPublishPolicyIssues([]);
      return;
    }

    const requestSeq = publishPolicyRequestSeq.current + 1;
    publishPolicyRequestSeq.current = requestSeq;
    setPublishPolicyPending(true);

    publishPolicyTimer.current = setTimeout(() => {
      void publishPolicyValidateRef
        .current({ nodes: deferredGraphNodes })
        .then((issues) => {
          if (publishPolicyRequestSeq.current !== requestSeq) return;
          setPublishPolicyIssues(issues);
        })
        .catch(() => {
          if (publishPolicyRequestSeq.current !== requestSeq) return;
          setPublishPolicyIssues([]);
        })
        .finally(() => {
          if (publishPolicyRequestSeq.current !== requestSeq) return;
          setPublishPolicyPending(false);
        });
    }, POLICY_VALIDATION_DELAY_MS);

    return () => {
      if (publishPolicyTimer.current) {
        clearTimeout(publishPolicyTimer.current);
        publishPolicyTimer.current = null;
      }
    };
  }, [deferredGraphNodes, hasExecNode]);

  // Bootstrap: load last-used flow on mount
  useEffect(() => {
    if (bootstrapped || flowId) return;

    const savedFlowId = requestedFlowId ?? readLastFlowId();
    if (!savedFlowId) {
      setBootstrapped(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const row = await utils.flows.get.fetch({ id: savedFlowId });
        if (cancelled) return;
        loadFlow({
          id: row.id,
          name: row.name,
          version: row.version,
          publishedVersion: row.publishedVersion,
          nodes: row.nodes,
          edges: row.edges,
        });
      } catch {
        if (!requestedFlowId) {
          clearLastFlowId();
        }
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, flowId, loadFlow, requestedFlowId, utils.flows.get]);

  useEffect(() => {
    if (!bootstrapped) return;

    const currentFlowParam = searchParams.get('flow')?.trim() || null;
    const currentRunParam = searchParams.get('run')?.trim() || null;
    const currentTabParam = searchParams.get('tab')?.trim() || null;

    if (flowId) {
      if (currentFlowParam === flowId) {
        return;
      }
      router.replace(`${pathname}?flow=${encodeURIComponent(flowId)}`);
      return;
    }

    if (currentFlowParam || currentRunParam || currentTabParam) {
      router.replace(pathname);
    }
  }, [bootstrapped, flowId, pathname, router, searchParams]);

  function flashAutosaved() {
    setAutosaveFlash(true);
    if (autosaveFlashTimer.current) clearTimeout(autosaveFlashTimer.current);
    autosaveFlashTimer.current = setTimeout(() => setAutosaveFlash(false), 2500);
  }

  const createMut = trpc.flows.create.useMutation({
    onSuccess(row) {
      markSaved({ id: row.id, version: row.version, publishedVersion: row.publishedVersion });
      utils.flows.list.invalidate();
      notify({ tone: 'success', title: 'Saved', message: `Draft v${row.version} created.` });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Save failed', message: err.message, durationMs: 6000 });
    },
  });

  const updateMut = trpc.flows.update.useMutation({
    onSuccess(row) {
      markSaved({ id: row.id, version: row.version, publishedVersion: row.publishedVersion });
      utils.flows.list.invalidate();
      flashAutosaved();
    },
    onError(err) {
      notify({ tone: 'error', title: 'Save failed', message: err.message, durationMs: 6000 });
    },
  });

  const duplicateMut = trpc.flows.create.useMutation({
    onSuccess(row) {
      loadFlow({
        id: row.id,
        name: row.name,
        version: row.version,
        publishedVersion: row.publishedVersion,
        nodes: row.nodes,
        edges: row.edges,
      });
      setOpen(false);
      utils.flows.list.invalidate();
      notify({
        tone: 'success',
        title: 'Duplicated',
        message: `"${row.name}" created as a new draft.`,
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Duplicate failed', message: err.message, durationMs: 6000 });
    },
  });

  const publishMut = trpc.flows.publish.useMutation({
    onSuccess(row) {
      markPublished(row.version);
      utils.flows.list.invalidate();
      if (flowId) utils.flows.get.invalidate({ id: flowId });
      utils.runs.list.invalidate();
      notify({ tone: 'success', title: 'Published', message: `v${row.version} is live.` });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Publish failed', message: err.message, durationMs: 6000 });
    },
  });

  const rollbackMut = trpc.flows.rollbackPublished.useMutation({
    onSuccess(row, variables) {
      if (flowId === row.id && row.publishedVersion) markPublished(row.publishedVersion);
      void Promise.all([
        utils.flows.list.invalidate(),
        utils.flows.get.invalidate({ id: row.id }),
        utils.flows.versions.invalidate({ id: row.id }),
        utils.runs.list.invalidate(),
      ]);
      notify({
        tone: 'success',
        title: 'Live version rolled back',
        message: `Published flow moved to v${variables.version}.`,
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Rollback failed', message: err.message, durationMs: 6000 });
    },
  });

  const restoreMut = trpc.flows.restoreVersion.useMutation({
    onSuccess(row, variables) {
      loadFlow({
        id: row.id,
        name: row.name,
        version: row.version,
        publishedVersion: row.publishedVersion,
        nodes: row.nodes,
        edges: row.edges,
      });
      void Promise.all([
        utils.flows.list.invalidate(),
        utils.flows.get.invalidate({ id: row.id }),
        utils.flows.versions.invalidate({ id: row.id }),
      ]);
      notify({
        tone: 'success',
        title: 'Draft restored',
        message: `Draft rebuilt from v${variables.version} as draft v${row.version}.`,
      });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Restore failed', message: err.message, durationMs: 6000 });
    },
  });

  const deleteMut = trpc.flows.delete.useMutation({
    onSuccess(_result, variables) {
      utils.flows.list.invalidate();
      if (variables.id === flowId) {
        clearLastFlowId();
        resetFlow();
      }
      notify({ tone: 'success', title: 'Deleted', message: 'Flow removed.' });
    },
    onError(err) {
      notify({ tone: 'error', title: 'Delete failed', message: err.message, durationMs: 6000 });
    },
  });

  async function handleLoad(id: string) {
    setLoading(id);
    try {
      const row = await utils.flows.get.fetch({ id });
      loadFlow({
        id: row.id,
        name: row.name,
        version: row.version,
        publishedVersion: row.publishedVersion,
        nodes: row.nodes,
        edges: row.edges,
      });
      setOpen(false);
      notify({ tone: 'success', title: 'Loaded', message: `${row.name} is ready.` });
    } catch (err) {
      notify({
        tone: 'error',
        title: 'Load failed',
        message: err instanceof Error ? err.message : String(err),
        durationMs: 6000,
      });
    } finally {
      setLoading(null);
    }
  }

  const doSave = useCallback(() => {
    // Skip if a save is already in flight to prevent race conditions
    if (createMut.isPending || updateMut.isPending) return;
    const payload = { name: flowName, nodes: nodesToGraph(nodes), edges: edgesToGraph(edges) };
    if (flowId) {
      updateMut.mutate({ id: flowId, ...payload, expectedVersion: flowVersion });
    } else {
      createMut.mutate(payload);
    }
  }, [
    createMut,
    createMut.isPending,
    edges,
    flowId,
    flowName,
    flowVersion,
    nodes,
    updateMut,
    updateMut.isPending,
  ]);

  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // Ctrl+S from Canvas keyboard handler
  useEffect(() => {
    const handler = () => {
      doSaveRef.current();
    };
    window.addEventListener('canvas:save', handler);
    return () => window.removeEventListener('canvas:save', handler);
  }, []);

  // Autosave: trigger 3 s after the last change, only for already-persisted flows,
  // and only when no save is already in flight.
  useEffect(() => {
    if (!dirty || !flowId || createMut.isPending || updateMut.isPending) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(doSave, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [createMut.isPending, dirty, doSave, flowId, updateMut.isPending]);

  function handlePublish() {
    if (!canManageLiveFlow) {
      notify({
        tone: 'warning',
        title: 'Owner or admin required',
        message: 'Publishing live flow changes is limited to workspace admins and owners.',
      });
      return;
    }
    if (!flowId) {
      notify({ tone: 'warning', title: 'Save first', message: 'Save the flow before publishing.' });
      return;
    }
    if (dirty) {
      notify({ tone: 'warning', title: 'Unsaved changes', message: 'Save before publishing.' });
      return;
    }
    if (graphIssues.length > 0) {
      notify({
        tone: 'warning',
        title: 'Validation',
        message: graphIssueMessage,
        durationMs: 7000,
      });
      return;
    }
    if (publishPolicyPending) {
      notify({
        tone: 'warning',
        title: 'Checking policy',
        message: 'Hold on while the adapter validates Exec publish policy.',
      });
      return;
    }
    if (publishPolicyIssues.length > 0) {
      notify({
        tone: 'warning',
        title: 'Publish blocked',
        message: graphIssueMessage,
        durationMs: 7000,
      });
      return;
    }
    publishMut.mutate({ id: flowId });
  }

  function confirm(opts: PendingConfirm) {
    setPendingConfirm(opts);
  }

  const saving = createMut.isPending || updateMut.isPending;
  const publishing = publishMut.isPending;
  const rollingBack = rollbackMut.isPending;
  const restoring = restoreMut.isPending;
  const draftLabel = flowId ? `draft v${flowVersion}` : 'unsaved';
  const publishLabel = publishedVersion ? `published v${publishedVersion}` : 'not published';

  return (
    <>
      <div className="relative flex h-11 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <input
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            className="w-full max-w-[260px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-[var(--color-fg)] outline-none transition hover:bg-[var(--color-surface-2)] focus:border-[var(--color-border)] focus:bg-[var(--color-surface-2)]"
            placeholder="Untitled flow"
          />

          <div className="hidden items-center gap-1.5 text-[11px] md:flex">
            <span className={`rounded-md border px-2 py-0.5 ${pillClasses('neutral')}`}>
              {draftLabel}
            </span>
            <span className={`rounded-md border px-2 py-0.5 ${pillClasses('accent')}`}>
              {publishLabel}
            </span>
            {dirty && (
              <span className={`rounded-md border px-2 py-0.5 ${pillClasses('warning')}`}>
                modified
              </span>
            )}
            {saving && (
              <span className="inline-flex items-center gap-1 text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                Saving…
              </span>
            )}
            {!saving && autosaveFlash && (
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                Autosaved
              </span>
            )}
            {publishPolicyPending && hasExecNode && (
              <span className="inline-flex items-center gap-1 text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                Checking exec policy…
              </span>
            )}
            {combinedIssues.length > 0 && (
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${pillClasses('warning')}`}
                title={graphIssueMessage}
              >
                <AlertCircle className="h-3 w-3" strokeWidth={2} />
                {combinedIssues.length} issue{combinedIssues.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (dirty) {
                confirm({
                  title: 'Discard unsaved changes?',
                  message: 'You have unsaved changes. Starting a new flow will discard them.',
                  confirmLabel: 'Discard & new',
                  variant: 'danger',
                  onConfirm: () => {
                    clearLastFlowId();
                    resetFlow();
                  },
                });
                return;
              }
              clearLastFlowId();
              resetFlow();
            }}
          >
            <FilePlus2 className="h-3.5 w-3.5" strokeWidth={2} />
            New
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={2} />
            Open
          </Button>
          <Button size="sm" variant="outline" onClick={doSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Save className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="sm"
            onClick={handlePublish}
            disabled={
              publishing ||
              publishPolicyPending ||
              !flowId ||
              dirty ||
              combinedIssues.length > 0 ||
              !canManageLiveFlow
            }
          >
            {publishing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </div>

        {open && (
          <div className="absolute right-3 top-[calc(100%+6px)] z-50 flex max-h-[min(600px,calc(100vh-80px))] w-96 flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--color-fg)]">Open flow</p>
                <p className="text-xs text-gray-400">Select a saved flow to load.</p>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-gray-400 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Search */}
            <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-2">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5">
                <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" strokeWidth={2} />
                <input
                  className="flex-1 bg-transparent text-xs text-[var(--color-fg)] outline-none placeholder:text-gray-400"
                  placeholder="Search flows…"
                  value={flowSearch}
                  onChange={(e) => setFlowSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Version history for current flow */}
            {flowId && (
              <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <RotateCcw className="h-3.5 w-3.5 text-gray-400" strokeWidth={2} />
                  <p className="text-sm font-medium text-[var(--color-fg)]">Version history</p>
                </div>
                <p className="mb-3 text-xs text-gray-400">
                  <strong>Rollback live</strong> changes the published version only.{' '}
                  <strong>Restore draft</strong> copies that snapshot back as a new draft.
                </p>
                {!canManageLiveFlow && (
                  <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
                    Only workspace admins and owners can roll back or restore versions.
                  </p>
                )}
                {versionsQuery.isLoading && (
                  <p className="text-xs text-gray-400">Loading version history…</p>
                )}
                {versionsQuery.error && (
                  <p className="text-xs text-red-500">{versionsQuery.error.message}</p>
                )}
                {!versionsQuery.isLoading &&
                  versionsQuery.data &&
                  versionsQuery.data.length === 0 && (
                    <p className="text-xs text-gray-400">
                      No published versions yet. Publish this flow to create version history.
                    </p>
                  )}
                {versionsQuery.data && versionsQuery.data.length > 0 && (
                  <ul className="max-h-40 space-y-2 overflow-y-auto">
                    {versionsQuery.data.map((versionRow) => {
                      const isPublished = publishedVersion === versionRow.version;
                      return (
                        <li
                          key={versionRow.id}
                          className="rounded-lg border border-[var(--color-border)] px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-[var(--color-fg)]">
                                  v{versionRow.version}
                                </span>
                                {isPublished && (
                                  <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                                    live
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-gray-400">
                                {new Date(versionRow.publishedAt).toLocaleString()}
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-gray-600 transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={restoring || saving || !canManageLiveFlow}
                                onClick={() => {
                                  confirm({
                                    title: 'Restore draft',
                                    message: dirty
                                      ? `Restore draft from v${versionRow.version}? Your unsaved local edits will be lost.`
                                      : `Restore draft from v${versionRow.version}?`,
                                    confirmLabel: 'Restore',
                                    variant: dirty ? 'danger' : 'default',
                                    onConfirm: () =>
                                      restoreMut.mutate({
                                        id: flowId,
                                        version: versionRow.version,
                                      }),
                                  });
                                }}
                              >
                                Restore draft
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-gray-600 transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={rollingBack || isPublished || !canManageLiveFlow}
                                onClick={() => {
                                  confirm({
                                    title: 'Rollback live flow',
                                    message: `Set the live published flow to v${versionRow.version}? This will affect all active triggers.`,
                                    confirmLabel: 'Rollback',
                                    variant: 'danger',
                                    onConfirm: () =>
                                      rollbackMut.mutate({
                                        id: flowId,
                                        version: versionRow.version,
                                      }),
                                  });
                                }}
                              >
                                Rollback live
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Flow list */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {listQuery.isLoading && (
                <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  Loading…
                </div>
              )}
              {listQuery.error && (
                <p className="px-4 py-3 text-sm text-red-500">{listQuery.error.message}</p>
              )}
              {!listQuery.isLoading && filteredFlows.length === 0 && (
                <p className="px-4 py-3 text-sm text-gray-400">
                  {flowSearch ? 'No flows match your search.' : 'No saved flows yet.'}
                </p>
              )}
              <ul className="divide-y divide-[var(--color-border)]">
                {filteredFlows.map((flow) => (
                  <li key={flow.id} className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => handleLoad(flow.id)}
                      disabled={loading === flow.id}
                    >
                      <div className="flex items-center gap-1.5">
                        {loading === flow.id && (
                          <Loader2 className="h-3 w-3 animate-spin text-gray-400" strokeWidth={2} />
                        )}
                        <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                          {flow.name}
                        </div>
                        {flow.id === flowId && (
                          <span className="shrink-0 rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] text-gray-400">
                            open
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-400">
                        v{flow.version}
                        {flow.publishedVersion
                          ? ` · published v${flow.publishedVersion}`
                          : ' · draft only'}{' '}
                        · {new Date(flow.updatedAt).toLocaleDateString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Duplicate ${flow.name}`}
                      title="Duplicate flow"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:opacity-40"
                      disabled={duplicateMut.isPending}
                      onClick={async () => {
                        const row = await utils.flows.get.fetch({ id: flow.id });
                        duplicateMut.mutate({
                          name: `${row.name} (copy)`,
                          nodes: row.nodes,
                          edges: row.edges,
                        });
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${flow.name}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                      onClick={() => {
                        confirm({
                          title: 'Delete flow',
                          message: `Delete "${flow.name}"? This cannot be undone.`,
                          confirmLabel: 'Delete',
                          variant: 'danger',
                          onConfirm: () => deleteMut.mutate({ id: flow.id }),
                        });
                      }}
                      disabled={!canManageLiveFlow}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {pendingConfirm && (
        <ConfirmDialog
          open
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          variant={pendingConfirm.variant}
          onConfirm={() => {
            pendingConfirm.onConfirm();
            setPendingConfirm(null);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </>
  );
}
