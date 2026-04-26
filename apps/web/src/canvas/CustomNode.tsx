import { AppIcon } from '@/components/ui/icon';
import { Handle, type NodeProps, NodeResizer, NodeToolbar, Position } from '@xyflow/react';
import { Copy, Lock, Trash2, Unlock } from 'lucide-react';
import { memo } from 'react';
import { getNodeAccent, getNodeSummary, getNodeType } from './node-types';
import { CANVAS_LOCKED_KEY, type CanvasNode, useCanvasStore } from './store';

const HANDLE_STYLE = {
  width: 10,
  height: 10,
  background: 'var(--color-accent)',
  border: '2px solid white',
};

function CustomNodeImpl({ id, data, selected }: NodeProps<CanvasNode>) {
  const nodeCatalog = useCanvasStore((state) => state.nodeCatalog);
  const selectedNodeCount = useCanvasStore(
    (state) => state.nodes.filter((node) => node.selected).length,
  );
  const copyNode = useCanvasStore((state) => state.copyNode);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const updateNodeSize = useCanvasStore((state) => state.updateNodeSize);
  const descriptor = getNodeType(nodeCatalog, data.nodeType);
  const locked = data[CANVAS_LOCKED_KEY] === true || data[CANVAS_LOCKED_KEY] === 'true';
  const showSingleNodeActions = selected && selectedNodeCount === 1;

  if (!descriptor) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
        Unknown: {data.nodeType}
      </div>
    );
  }

  const accent = getNodeAccent(nodeCatalog, descriptor.category);
  const summary = getNodeSummary(data.nodeType, data).slice(0, 2);

  return (
    <div
      className="relative min-w-[200px] rounded-xl border bg-[var(--color-surface)] shadow-sm transition-shadow"
      style={{
        borderColor: selected ? accent : 'var(--color-border)',
        boxShadow: selected
          ? `0 0 0 2px ${accent}22, 0 4px 12px rgba(0,0,0,0.08)`
          : '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      <NodeToolbar isVisible={showSingleNodeActions} offset={10}>
        <div className="nodrag nopan flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg">
          <button
            type="button"
            className="nodrag nopan flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-500 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
            onClick={() => copyNode(id)}
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            Duplicate
          </button>
          <button
            type="button"
            className="nodrag nopan flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-gray-500 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
            onClick={() => updateNodeData(id, { [CANVAS_LOCKED_KEY]: !locked })}
          >
            {locked ? (
              <Unlock className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Lock className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {locked ? 'Unlock' : 'Lock'}
          </button>
          <button
            type="button"
            className="nodrag nopan flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
            onClick={() => deleteNode(id)}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            Delete
          </button>
        </div>
      </NodeToolbar>

      <NodeResizer
        isVisible={showSingleNodeActions && !locked}
        minWidth={200}
        minHeight={96}
        lineStyle={{ borderColor: accent }}
        handleStyle={{ width: 10, height: 10, borderColor: accent }}
        onResizeEnd={(_, params) => updateNodeSize(id, params.width, params.height)}
      />

      <div
        className="absolute inset-y-3 left-0 w-[3px] rounded-r-full"
        style={{ backgroundColor: accent }}
      />

      <div className="px-4 py-3 pl-5">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${accent}18`, color: accent }}
          >
            <AppIcon name={descriptor.icon} className="h-4 w-4" strokeWidth={2} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div
                className="truncate text-[13px] font-semibold text-[var(--color-fg)]"
                title={data.label || descriptor.label}
              >
                {data.label || descriptor.label}
              </div>
              {locked && (
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[var(--color-surface-2)] text-gray-400"
                  title="Node is locked"
                >
                  <Lock className="h-3 w-3" strokeWidth={2} />
                </span>
              )}
            </div>
            <div className="text-[11px] text-gray-400">
              {descriptor.category}
              {locked ? ' · locked' : ''}
            </div>
          </div>
        </div>

        {summary.length > 0 && (
          <div className="mt-2.5 space-y-1">
            {summary.map((line) => (
              <div
                key={`${data.nodeType}-${line}`}
                className="rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-gray-500"
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>

      {descriptor.inputs.map((port, index) => {
        const total = descriptor.inputs.length;
        // Space handles evenly across the card height (approx 64px base + 22px per summary line)
        const cardHeight = 64 + summary.length * 22;
        const spacing = cardHeight / (total + 1);
        return (
          <Handle
            key={port.name}
            id={port.name}
            type="target"
            position={Position.Left}
            title={port.name}
            style={{ ...HANDLE_STYLE, top: spacing * (index + 1) }}
          />
        );
      })}

      {descriptor.outputs.map((port, index) => {
        const total = descriptor.outputs.length;
        const cardHeight = 64 + summary.length * 22;
        const spacing = cardHeight / (total + 1);
        return (
          <Handle
            key={port.name}
            id={port.name}
            type="source"
            position={Position.Right}
            title={port.name}
            style={{ ...HANDLE_STYLE, top: spacing * (index + 1) }}
          />
        );
      })}
    </div>
  );
}

export const CustomNode = memo(CustomNodeImpl);
