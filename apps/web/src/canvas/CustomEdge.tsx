'use client';

import { BaseEdge, type EdgeProps, EdgeText, EdgeToolbar, getSmoothStepPath } from '@xyflow/react';
import { X } from 'lucide-react';
import { memo } from 'react';
import { useCanvasStore } from './store';

function CustomEdgeImpl(props: EdgeProps) {
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  const [edgePath, labelX, labelY] = getSmoothStepPath(props);
  const label = `${props.sourceHandleId ?? 'out'} -> ${props.targetHandleId ?? 'in'}`;

  return (
    <>
      <BaseEdge id={props.id} path={edgePath} style={props.style} markerEnd={props.markerEnd} />
      <EdgeText
        x={labelX}
        y={labelY}
        label={label}
        labelShowBg
        labelBgPadding={[4, 2]}
        labelBgBorderRadius={6}
        labelStyle={{ fill: 'rgb(107 114 128)', fontSize: 10, fontWeight: 600 }}
        labelBgStyle={{ fill: 'rgba(255, 255, 255, 0.92)' }}
      />
      <EdgeToolbar edgeId={props.id} x={labelX} y={labelY} isVisible={props.selected}>
        <button
          type="button"
          className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-gray-500 shadow-md transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          aria-label="Delete edge"
          title="Delete edge"
          onClick={() => deleteEdge(props.id)}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </EdgeToolbar>
    </>
  );
}

export const CustomEdge = memo(CustomEdgeImpl);
