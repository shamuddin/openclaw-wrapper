'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { notify } from '@/components/ui/toast-store';
import { trpc } from '@/lib/trpc';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  type NodeConfigField,
  getNodeConfigFields,
  getNodeExecutionSupport,
  getNodeSummary,
  getNodeType,
} from './node-types';
import { edgesToGraph, nodesToGraph } from './serialize';
import { useCanvasStore } from './store';
import { getBuilderIssues } from './validation';

function resolveFieldOptions(field: NodeConfigField, nodeData: Record<string, unknown>) {
  if (field.key !== 'skillName') {
    if (field.key !== 'modelOverride') {
      return field.options;
    }

    const provider =
      typeof nodeData.modelProvider === 'string' ? nodeData.modelProvider.trim() : '';
    if (!provider) {
      return field.options;
    }

    const scopedOptions = field.options?.filter(
      (option) => !option.scope || option.scope === provider,
    );
    return scopedOptions?.length ? scopedOptions : field.options;
  }

  const agentId = typeof nodeData.agentId === 'string' ? nodeData.agentId.trim() : '';
  if (!agentId) {
    return field.options;
  }

  const scopedOptions = field.options?.filter(
    (option) => !option.scope || option.scope === agentId,
  );
  return scopedOptions?.length ? scopedOptions : field.options;
}

function getCapabilityToneClasses(tone: 'supported' | 'limited' | 'warning' | undefined): string {
  switch (tone) {
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'limited':
      return 'border-sky-200 bg-sky-50 text-sky-800';
    default:
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
}

function getToolSpecificHint(
  nodeType: string,
  nodeData: Record<string, unknown>,
): { tone: 'info' | 'warning'; message: string } | null {
  if (nodeType === 'tool.web-search') {
    const provider =
      typeof nodeData.provider === 'string' ? nodeData.provider.trim().toLowerCase() : 'duckduckgo';
    const outputMode =
      typeof nodeData.outputMode === 'string' ? nodeData.outputMode.trim() : 'results';
    if (outputMode === 'top-result-url') {
      return {
        tone: 'info',
        message:
          'Top result URL mode sends a plain string downstream, so the next Browser Lite target can use {{input}} directly.',
      };
    }
    if (outputMode === 'top-result') {
      return {
        tone: 'info',
        message:
          'Top result mode sends the first result object downstream with fields like title, url, and snippet.',
      };
    }
    switch (provider) {
      case 'brave':
        return {
          tone: 'warning',
          message: 'Brave search requires `BRAVE_API_KEY` in the adapter environment.',
        };
      case 'tavily':
        return {
          tone: 'warning',
          message: 'Tavily search requires `TAVILY_API_KEY` in the adapter environment.',
        };
      case 'perplexity':
        return {
          tone: 'warning',
          message: 'Perplexity search requires `PERPLEXITY_API_KEY` in the adapter environment.',
        };
      default:
        return {
          tone: 'info',
          message: 'DuckDuckGo works by default and does not require an adapter API key.',
        };
    }
  }

  if (nodeType === 'tool.browser') {
    const action =
      typeof nodeData.action === 'string' ? nodeData.action.trim().toLowerCase() : 'open';
    if (action === 'extract') {
      const extractMode =
        typeof nodeData.extractMode === 'string'
          ? nodeData.extractMode.trim().toLowerCase()
          : 'text';
      return {
        tone: 'info',
        message:
          extractMode === 'metadata'
            ? 'Metadata bundle returns title, description, Open Graph fields, final URL, and HTTP status in one structured object.'
            : extractMode === 'jsonld'
              ? 'JSON-LD mode pulls structured data embedded in the page, which is useful for articles, products, and docs pages that publish schema metadata.'
              : extractMode === 'headings'
                ? 'Headings mode returns a lightweight outline of h1-h6 content so downstream steps can reason over page structure without a full DOM session.'
                : 'Browser Lite extract is limited to static page text, HTML preview, headings, JSON-LD, metadata, meta tags, and discovered links.',
      };
    }
    if (action === 'click') {
      return {
        tone: 'warning',
        message:
          'Browser Lite can only follow links already present in the fetched HTML. It supports text:, href:, exact:text:, exact:href:, and index: hints, but it does not click JS-rendered UI.',
      };
    }
  }

  if (nodeType === 'tool.payload-template') {
    const outputMode =
      typeof nodeData.outputMode === 'string'
        ? nodeData.outputMode.trim().toLowerCase()
        : 'replace';
    if (outputMode === 'merge') {
      return {
        tone: 'info',
        message:
          'Merge mode expects the template to resolve to a JSON object and overlays those fields onto the current payload.',
      };
    }
    if (outputMode === 'assign') {
      return {
        tone: 'info',
        message:
          'Assign mode keeps the current payload and writes the shaped value to the configured nested path.',
      };
    }
    return {
      tone: 'info',
      message:
        'Replace mode sends only the shaped value downstream, which is useful for trimming large search or browser payloads.',
    };
  }

  return null;
}

function InputField({
  field,
  inputId,
  value,
  options,
  onChange,
}: {
  field: NodeConfigField;
  inputId: string;
  value: unknown;
  options?: NodeConfigField['options'];
  onChange: (value: unknown) => void;
}) {
  const base =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]';

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          id={inputId}
          className={`${base} min-h-20 resize-y`}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'select': {
      const emptyLabel =
        typeof field.placeholder === 'string' && field.placeholder.trim().length > 0
          ? field.placeholder
          : undefined;
      const currentValue = typeof value === 'string' ? value : '';
      const hasMatchingOption = options?.some((option) => option.value === currentValue) ?? false;
      const renderedOptions =
        currentValue && !hasMatchingOption
          ? [{ label: `Current: ${currentValue}`, value: currentValue }, ...(options ?? [])]
          : options;
      return (
        <select
          id={inputId}
          className={base}
          value={currentValue}
          onChange={(e) => onChange(e.target.value)}
        >
          {emptyLabel ? <option value="">{emptyLabel}</option> : null}
          {renderedOptions?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }
    case 'boolean':
      return (
        <label className="flex cursor-pointer items-center gap-2" htmlFor={inputId}>
          <input
            id={inputId}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          <span className="text-sm text-[var(--color-fg)]">{value ? 'Enabled' : 'Disabled'}</span>
        </label>
      );
    default:
      return (
        <>
          <input
            id={inputId}
            list={field.suggestions?.length ? `${inputId}-suggestions` : undefined}
            className={base}
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.suggestions?.length ? (
            <datalist id={`${inputId}-suggestions`}>
              {field.suggestions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </datalist>
          ) : null}
        </>
      );
  }
}

export function NodeConfigPanel() {
  const utils = trpc.useUtils();
  const {
    nodeCatalog,
    nodes,
    edges,
    selectedNode,
    selectedEdge,
    updateNodeData,
    deleteNode,
    deleteEdge,
  } = useCanvasStore(
    useShallow((state) => ({
      nodeCatalog: state.nodeCatalog,
      nodes: state.nodes,
      edges: state.edges,
      selectedNode: state.nodes.find((n) => n.selected) ?? null,
      selectedEdge: state.edges.find((e) => e.selected) ?? null,
      updateNodeData: state.updateNodeData,
      deleteNode: state.deleteNode,
      deleteEdge: state.deleteEdge,
    })),
  );
  const [clawHubOpen, setClawHubOpen] = useState(false);
  const [clawHubQuery, setClawHubQuery] = useState('');
  const [clawHubDebouncedQuery, setClawHubDebouncedQuery] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedNodeId = selectedNode?.id ?? null;
  const selectedNodeIssues = useMemo(() => {
    if (!selectedNode) return [];
    return getBuilderIssues(nodesToGraph(nodes), edgesToGraph(edges)).filter(
      (issue) => issue.nodeId === selectedNode.id,
    );
  }, [edges, nodes, selectedNode]);

  const catalogQuery = trpc.skills.searchCatalog.useQuery(
    { query: clawHubDebouncedQuery, limit: 8 },
    { enabled: clawHubOpen, staleTime: 30_000 },
  );

  const installMutation = trpc.skills.installFromCatalog.useMutation({
    onSuccess(result) {
      if (selectedNode) {
        updateNodeData(selectedNode.id, { skillName: result.slug });
      }
      Promise.all([
        utils.nodes.catalog.invalidate(),
        utils.skills.searchCatalog.invalidate(),
      ]).catch(() => undefined);
      notify({
        tone: 'success',
        title: 'Skill installed',
        message: `${result.displayName} is ready to use.`,
      });
      setClawHubOpen(false);
    },
    onError(error) {
      notify({
        tone: 'error',
        title: 'Install failed',
        message: error.message,
        durationMs: 7000,
      });
    },
  });

  useEffect(() => {
    if (!selectedNodeId && !clawHubOpen && !clawHubQuery && !clawHubDebouncedQuery) {
      return;
    }
    setClawHubOpen(false);
    setClawHubQuery('');
    setClawHubDebouncedQuery('');
  }, [clawHubDebouncedQuery, clawHubOpen, clawHubQuery, selectedNodeId]);

  // Debounce ClawHub search — only fire query 300 ms after user stops typing
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setClawHubDebouncedQuery(clawHubQuery), 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [clawHubQuery]);

  if (!selectedNode && !selectedEdge) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] px-3 py-4 text-center">
        <p className="text-xs text-gray-400">
          Click a node or connection on the canvas to edit it.
        </p>
      </div>
    );
  }

  if (!selectedNode && selectedEdge) {
    const sourceNode = nodes.find((n) => n.id === selectedEdge.source);
    const targetNode = nodes.find((n) => n.id === selectedEdge.target);
    const sourceLabel =
      typeof sourceNode?.data.label === 'string' && sourceNode.data.label.trim()
        ? sourceNode.data.label
        : selectedEdge.source;
    const targetLabel =
      typeof targetNode?.data.label === 'string' && targetNode.data.label.trim()
        ? targetNode.data.label
        : selectedEdge.target;

    return (
      <div className="rounded-xl border border-[var(--color-border)] p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Connection
            </p>
            <p className="mt-1 text-sm font-medium text-[var(--color-fg)]">
              {sourceLabel} -&gt; {targetLabel}
            </p>
            <p className="text-[11px] text-gray-400">
              {selectedEdge.sourceHandle ?? 'out'} -&gt; {selectedEdge.targetHandle ?? 'in'}
            </p>
          </div>
          <Button size="sm" variant="danger" onClick={() => deleteEdge(selectedEdge.id)}>
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            Remove
          </Button>
        </div>
      </div>
    );
  }

  if (!selectedNode) {
    return null;
  }

  const descriptor = getNodeType(nodeCatalog, selectedNode.data.nodeType);
  const fields = getNodeConfigFields(nodeCatalog, selectedNode.data.nodeType, selectedNode.data);
  const executionSupport = getNodeExecutionSupport(nodeCatalog, selectedNode.data.nodeType);
  const summary = getNodeSummary(selectedNode.data.nodeType, selectedNode.data);
  const toolSpecificHint = getToolSpecificHint(selectedNode.data.nodeType, selectedNode.data);

  return (
    <div className="rounded-xl border border-[var(--color-border)]">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {descriptor?.label ?? selectedNode.data.nodeType}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-[var(--color-fg)]">
            {selectedNode.data.label}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
              executionSupport.status === 'supported'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            {executionSupport.status}
          </span>
          <button
            type="button"
            aria-label="Delete node"
            title="Delete node"
            onClick={() => setDeleteConfirmOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        {summary.length > 0 && (
          <div className="rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2">
            {summary.map((line) => (
              <div key={`${selectedNode.id}-${line}`} className="text-[12px] text-gray-500">
                {line}
              </div>
            ))}
          </div>
        )}

        {executionSupport.note && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-700">
            {executionSupport.note}
          </div>
        )}

        {toolSpecificHint ? (
          <div
            className={`rounded-lg px-2.5 py-2 text-xs ${
              toolSpecificHint.tone === 'warning'
                ? 'border border-amber-200 bg-amber-50 text-amber-800'
                : 'border border-sky-200 bg-sky-50 text-sky-800'
            }`}
          >
            {toolSpecificHint.message}
          </div>
        ) : null}

        {descriptor?.capabilities?.length ? (
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Capability Snapshot
            </div>
            <div className="space-y-2">
              {descriptor.capabilities.map((capability) => (
                <div
                  key={`${selectedNode.id}-${capability.label}`}
                  className={`rounded-lg border px-2.5 py-2 ${getCapabilityToneClasses(
                    capability.tone,
                  )}`}
                >
                  <div className="text-[12px] font-medium">{capability.label}</div>
                  {capability.detail ? (
                    <div className="mt-1 text-[11px] leading-5 opacity-90">{capability.detail}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {selectedNodeIssues.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <div className="space-y-1">
                {selectedNodeIssues.map((issue) => (
                  <div key={`${selectedNode.id}-${issue.code}`}>{issue.message}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        {fields.map((field) => {
          const inputId = `node-${selectedNode.id}-${field.key}`;
          const fieldOptions = resolveFieldOptions(field, selectedNode.data);

          return (
            <div key={field.key}>
              <label htmlFor={inputId} className="mb-1 block text-[12px] font-medium text-gray-600">
                {field.label}
              </label>
              <InputField
                field={field}
                inputId={inputId}
                value={selectedNode.data[field.key]}
                options={fieldOptions}
                onChange={(value) => {
                  if (field.key === 'modelProvider') {
                    const nextData = {
                      ...selectedNode.data,
                      modelProvider: value,
                    } as Record<string, unknown>;
                    const modelField = fields.find(
                      (candidate) => candidate.key === 'modelOverride',
                    );
                    const currentModel =
                      typeof selectedNode.data.modelOverride === 'string'
                        ? selectedNode.data.modelOverride
                        : '';
                    const nextModelOptions = modelField
                      ? resolveFieldOptions(modelField, nextData)
                      : undefined;
                    const keepsCurrentModel =
                      !currentModel ||
                      (nextModelOptions?.some((option) => option.value === currentModel) ?? false);
                    updateNodeData(selectedNode.id, {
                      modelProvider: value,
                      ...(keepsCurrentModel ? {} : { modelOverride: '' }),
                    });
                    return;
                  }

                  updateNodeData(selectedNode.id, { [field.key]: value });
                }}
              />

              {field.key === 'skillName' ? (
                <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-[var(--color-fg)]">
                        Installed skills only
                      </p>
                      <p className="text-[11px] text-gray-400">
                        This list comes from OpenClaw runtime discovery for the selected agent.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setClawHubOpen((open) => !open)}
                    >
                      {clawHubOpen ? 'Hide' : 'Browse ClawHub'}
                    </Button>
                  </div>

                  {clawHubOpen ? (
                    <div className="mt-3 space-y-2">
                      <input
                        value={clawHubQuery}
                        onChange={(event) => setClawHubQuery(event.target.value)}
                        placeholder="Search skills on ClawHub"
                        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
                      />

                      <div className="max-h-64 space-y-2 overflow-auto">
                        {catalogQuery.isLoading ? (
                          <p className="text-xs text-gray-400">Searching ClawHub...</p>
                        ) : null}

                        {catalogQuery.error ? (
                          <p className="text-xs text-red-500">{catalogQuery.error.message}</p>
                        ) : null}

                        {!catalogQuery.isLoading &&
                        !catalogQuery.error &&
                        !catalogQuery.data?.length ? (
                          <p className="text-xs text-gray-400">No ClawHub skills found.</p>
                        ) : null}

                        {catalogQuery.data?.map((skill) => (
                          <div
                            key={skill.slug}
                            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-[var(--color-fg)]">
                                  {skill.displayName}
                                </div>
                                <div className="truncate text-[11px] text-gray-400">
                                  {skill.slug}
                                  {skill.version ? ` · v${skill.version}` : ''}
                                </div>
                                {skill.summary ? (
                                  <p className="mt-1 text-[11px] text-gray-500">{skill.summary}</p>
                                ) : null}
                              </div>
                              <Button
                                size="sm"
                                onClick={() => installMutation.mutate({ slug: skill.slug })}
                                disabled={installMutation.isPending}
                              >
                                Install
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-gray-400">
                      Browse ClawHub to discover and install more skills, then they will appear
                      here.
                    </p>
                  )}
                </div>
              ) : null}

              {field.suggestions?.length ? (
                <p className="mt-1 text-[11px] text-gray-400">
                  Suggestions:{' '}
                  {field.suggestions
                    .slice(0, 4)
                    .map((option) => option.label)
                    .join(', ')}
                  {field.suggestions.length > 4 ? ', ...' : ''}
                </p>
              ) : null}

              {field.description && (
                <p className="mt-1 text-[11px] text-gray-400">{field.description}</p>
              )}
            </div>
          );
        })}

        <p className="text-[11px] text-gray-400">
          Press{' '}
          <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 font-mono text-[10px]">
            Del
          </kbd>{' '}
          to remove selected items, or{' '}
          <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 font-mono text-[10px]">
            Ctrl+Z
          </kbd>{' '}
          to undo.
        </p>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete node"
        message={`Delete "${selectedNode.data.label}"? This can be undone with Ctrl+Z.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          deleteNode(selectedNode.id);
          setDeleteConfirmOpen(false);
        }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
