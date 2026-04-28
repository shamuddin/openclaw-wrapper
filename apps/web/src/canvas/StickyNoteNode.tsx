'use client';

import { NodeResizer, NodeToolbar, type NodeProps } from '@xyflow/react';
import { Copy, Lock, Trash2, Unlock } from 'lucide-react';
import { memo } from 'react';
import {
  CANVAS_LOCKED_KEY,
  CANVAS_NOTE_NODE_TYPE,
  type CanvasNode,
  useCanvasStore,
} from './store';

interface NoteTone {
  card: string;
  accent: string;
  selected: string;
  resize: string;
  text: string;
  placeholder: string;
}

const DEFAULT_NOTE_TONE: NoteTone = {
  card: 'border-amber-300 bg-sky-50',
  accent: 'bg-amber-300',
  selected: 'ring-2 ring-amber-300/70 shadow-md',
  resize: 'rgb(252 211 77)',
  text: 'text-slate-700',
  placeholder: 'placeholder:text-slate-400',
};

const NOTE_TONES: Record<string, NoteTone> = {
  yellow: {
    ...DEFAULT_NOTE_TONE,
  },
  blue: {
    card: 'border-sky-300 bg-sky-50',
    accent: 'bg-sky-300',
    selected: 'ring-2 ring-sky-300/70 shadow-md',
    resize: 'rgb(125 211 252)',
    text: 'text-slate-700',
    placeholder: 'placeholder:text-slate-400',
  },
  green: {
    card: 'border-emerald-300 bg-emerald-50',
    accent: 'bg-emerald-300',
    selected: 'ring-2 ring-emerald-300/70 shadow-md',
    resize: 'rgb(110 231 183)',
    text: 'text-slate-700',
    placeholder: 'placeholder:text-slate-400',
  },
  pink: {
    card: 'border-rose-300 bg-rose-50',
    accent: 'bg-rose-300',
    selected: 'ring-2 ring-rose-300/70 shadow-md',
    resize: 'rgb(253 164 175)',
    text: 'text-slate-700',
    placeholder: 'placeholder:text-slate-400',
  },
};

function StickyNoteNodeImpl({ id, data, selected }: NodeProps<CanvasNode>) {
  const selectedNodeCount = useCanvasStore(
    (state) => state.nodes.filter((node) => node.selected).length,
  );
  const copyNode = useCanvasStore((state) => state.copyNode);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const updateNodeSize = useCanvasStore((state) => state.updateNodeSize);
  const locked = data[CANVAS_LOCKED_KEY] === true || data[CANVAS_LOCKED_KEY] === 'true';
  const tone = typeof data.tone === 'string' ? data.tone : 'yellow';
  const noteTone = NOTE_TONES[tone] ?? DEFAULT_NOTE_TONE;
  const text = typeof data.text === 'string' ? data.text : '';
  const showActions = selected && selectedNodeCount === 1;

  return (
    <div
      className={`relative flex h-full min-h-[132px] min-w-[180px] flex-col overflow-hidden rounded-md border shadow-[0_1px_2px_rgba(15,23,42,0.08)] transition-shadow ${noteTone.card} ${
        selected ? noteTone.selected : ''
      }`}
    >
      <NodeToolbar isVisible={showActions} offset={10}>
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
        isVisible={showActions && !locked}
        minWidth={180}
        minHeight={132}
        lineStyle={{ borderColor: noteTone.resize }}
        handleStyle={{
          width: 8,
          height: 8,
          borderColor: noteTone.resize,
          background: 'white',
        }}
        onResizeEnd={(_, params) => updateNodeSize(id, params.width, params.height)}
      />

      <div className={`h-1 shrink-0 ${noteTone.accent}`} />
      <textarea
        className={`nodrag nopan h-full min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-[13px] leading-5 outline-none ${noteTone.text} ${noteTone.placeholder}`}
        value={text}
        placeholder="Write a note..."
        readOnly={locked}
        onChange={(event) =>
          updateNodeData(id, {
            nodeType: CANVAS_NOTE_NODE_TYPE,
            text: event.target.value,
            label: event.target.value.split('\n')[0]?.slice(0, 40) || 'Note',
          })
        }
      />
    </div>
  );
}

export const StickyNoteNode = memo(StickyNoteNodeImpl);
