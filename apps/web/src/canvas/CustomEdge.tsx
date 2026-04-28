'use client';

import { BaseEdge, type EdgeProps, EdgeText, EdgeToolbar, getSmoothStepPath } from '@xyflow/react';
import { X } from 'lucide-react';
import { memo } from 'react';
import { useCanvasStore } from './store';

function statusStroke(status: string | undefined): string | undefined {
  switch (status) {
    case 'running':
      return 'rgb(59 130 246)';
    case 'waiting':
      return 'rgb(139 92 246)';
    case 'succeeded':
      return 'rgb(16 185 129)';
    case 'failed':
      return 'rgb(239 68 68)';
    case 'rejected':
      return 'rgb(245 158 11)';
    default:
      return undefined;
  }
}

function CustomEdgeImpl(props: EdgeProps) {
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  const sourceRunStatus = useCanvasStore((state) => state.runNodeStatuses[props.source]);
  const targetRunStatus = useCanvasStore((state) => state.runNodeStatuses[props.target]);
  const [edgePath, labelX, labelY] = getSmoothStepPath(props);
  const label = `${props.sourceHandleId ?? 'out'} -> ${props.targetHandleId ?? 'in'}`;
  const runStroke = statusStroke(targetRunStatus ?? sourceRunStatus);
  const isLivePath = Boolean(runStroke);
  const edgeStyle = props.selected
    ? { ...props.style, stroke: 'var(--color-accent)', strokeWidth: 2.25 }
    : runStroke
      ? {
          ...props.style,
          stroke: runStroke,
          strokeWidth: targetRunStatus === 'running' || targetRunStatus === 'waiting' ? 2.25 : 1.9,
        }
    : props.style;

  return (
    <>
      <BaseEdge
        id={`${props.id}-hitbox`}
        path={edgePath}
        style={{ stroke: 'transparent', strokeWidth: 12 }}
      />
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={props.markerEnd}
        className={
          isLivePath && (targetRunStatus === 'running' || targetRunStatus === 'waiting')
            ? 'animate-pulse'
            : undefined
        }
      />
      {props.selected ? (
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
      ) : null}
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
