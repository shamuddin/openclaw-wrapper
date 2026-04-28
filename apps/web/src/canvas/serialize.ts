import type { GraphEdge, GraphNode, NodeCatalog } from '@openclaw-wrapper/schemas';
import { type Edge, MarkerType } from '@xyflow/react';
import { getNodeType, mergeNodeDataWithDefaults } from './node-types';
import { CANVAS_NOTE_NODE_TYPE, type CanvasNode } from './store';

const CANVAS_WIDTH_KEY = '__canvasWidth';
const CANVAS_HEIGHT_KEY = '__canvasHeight';
const CANVAS_LOCKED_KEY = '__canvasLocked';

function readPersistedDimension(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }
  return undefined;
}

function readPersistedBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
}

export function nodesToGraph(nodes: CanvasNode[]): GraphNode[] {
  return nodes.map((node) => {
    const { nodeType, ...configData } = node.data;
    const width = readPersistedDimension(node.style?.width);
    const height = readPersistedDimension(node.style?.height);
    return {
      id: node.id,
      type: nodeType,
      position: { x: node.position.x, y: node.position.y },
      data: {
        ...configData,
        ...(width ? { [CANVAS_WIDTH_KEY]: width } : {}),
        ...(height ? { [CANVAS_HEIGHT_KEY]: height } : {}),
      },
    };
  });
}

export function edgesToGraph(edges: Edge[]): GraphEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    sourcePort: e.sourceHandle ?? 'out',
    target: e.target,
    targetPort: e.targetHandle ?? 'in',
  }));
}

export function graphToNodes(
  graph: GraphNode[],
  catalog: NodeCatalog | null | undefined,
): CanvasNode[] {
  return graph.map((graphNode) => {
    const descriptor = getNodeType(catalog, graphNode.type);
    const width = readPersistedDimension(graphNode.data[CANVAS_WIDTH_KEY]);
    const height = readPersistedDimension(graphNode.data[CANVAS_HEIGHT_KEY]);
    const locked = readPersistedBoolean(graphNode.data[CANVAS_LOCKED_KEY]) ?? false;
    const {
      [CANVAS_WIDTH_KEY]: _canvasWidth,
      [CANVAS_HEIGHT_KEY]: _canvasHeight,
      [CANVAS_LOCKED_KEY]: _canvasLocked,
      ...persistedData
    } = graphNode.data;
    const label =
      (typeof persistedData.label === 'string' ? persistedData.label : undefined) ??
      descriptor?.label ??
      graphNode.type;
    if (graphNode.type === CANVAS_NOTE_NODE_TYPE) {
      return {
        id: graphNode.id,
        type: 'note',
        position: graphNode.position,
        data: {
          ...persistedData,
          nodeType: CANVAS_NOTE_NODE_TYPE,
          label,
          [CANVAS_LOCKED_KEY]: locked,
        },
        draggable: !locked,
        connectable: false,
        style: {
          width: width ?? 240,
          height: height ?? 180,
        },
      };
    }
    return {
      id: graphNode.id,
      type: 'openclaw',
      position: graphNode.position,
      data: mergeNodeDataWithDefaults(catalog, graphNode.type, {
        ...persistedData,
        [CANVAS_LOCKED_KEY]: locked,
        label,
      }),
      draggable: !locked,
      connectable: !locked,
      style:
        width || height
          ? {
              ...(width ? { width } : {}),
              ...(height ? { height } : {}),
            }
          : undefined,
    };
  });
}

export function graphToEdges(graph: GraphEdge[]): Edge[] {
  return graph.map((e) => ({
    id: e.id,
    source: e.source,
    sourceHandle: e.sourcePort,
    target: e.target,
    targetHandle: e.targetPort,
    animated: false,
    type: 'openclaw',
    reconnectable: true,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 18,
      height: 18,
    },
    style: {
      stroke: 'var(--color-border)',
      strokeWidth: 1.5,
    },
  }));
}
