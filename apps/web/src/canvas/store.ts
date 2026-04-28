import type { NodeCatalog } from '@openclaw-wrapper/schemas';
import {
  type Connection,
  type Edge,
  type EdgeChange,
  MarkerType,
  type Node,
  type NodeChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge as reconnectCanvasEdge,
} from '@xyflow/react';
import { create } from 'zustand';
import { getNodeDefaults, getNodeType, mergeNodeDataWithDefaults } from './node-types';
import { CANVAS_RECIPES } from './presets';
import { graphToEdges, graphToNodes } from './serialize';

export interface CanvasNodeData extends Record<string, unknown> {
  nodeType: string;
  label: string;
}

export const CANVAS_NOTE_NODE_TYPE = 'canvas.note';
export type CanvasNode = Node<CanvasNodeData, 'openclaw' | 'note'>;
export type CanvasNodeRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'rejected';

export type CanvasEdgeRunStatus = Exclude<CanvasNodeRunStatus, 'queued'>;

export interface LoadedFlow {
  id: string;
  name: string;
  version: number;
  publishedVersion?: number;
  nodes: import('@openclaw-wrapper/schemas').GraphNode[];
  edges: import('@openclaw-wrapper/schemas').GraphEdge[];
}

interface HistorySnapshot {
  nodes: CanvasNode[];
  edges: Edge[];
}

interface ClipboardSnapshot {
  nodes: CanvasNode[];
  edges: Edge[];
}

interface CanvasState {
  nodeCatalog: NodeCatalog | null;
  nodes: CanvasNode[];
  edges: Edge[];
  flowId: string | null;
  flowName: string;
  flowVersion: number;
  publishedVersion: number | null;
  dirty: boolean;
  runNodeStatuses: Record<string, CanvasNodeRunStatus>;
  nodeIssueCounts: Record<string, number>;
  clipboard: ClipboardSnapshot | null;
  pasteCount: number;
  // Undo/redo
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  // Actions
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  reconnectEdge: (oldEdge: Edge, connection: Connection) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  setNodeCatalog: (catalog: NodeCatalog) => void;
  setRunNodeStatuses: (statuses: Record<string, CanvasNodeRunStatus>) => void;
  setNodeIssueCounts: (counts: Record<string, number>) => void;
  isConnectionValid: (connection: Connection) => boolean;
  addNode: (nodeType: string, position: { x: number; y: number }) => void;
  addNote: (position?: { x: number; y: number }) => void;
  applyRecipe: (recipeId: string) => boolean;
  setFlowName: (name: string) => void;
  loadFlow: (flow: LoadedFlow) => void;
  markSaved: (flow: { id: string; version: number; publishedVersion?: number }) => void;
  markPublished: (version: number) => void;
  updateNodeData: (nodeId: string, patch: Partial<CanvasNodeData>) => void;
  updateNodeSize: (nodeId: string, width: number, height: number) => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  deleteSelectedElements: () => void;
  resetFlow: () => void;
  copyNode: (nodeId: string) => void;
  copySelection: () => boolean;
  pasteSelection: () => boolean;
  duplicateSelection: () => boolean;
  setSelectedNodesLocked: (locked: boolean) => boolean;
  autoLayout: () => boolean;
}

let nodeCounter = 0;
const nextNodeId = () => `n_${Date.now().toString(36)}_${(nodeCounter++).toString(36)}`;
let edgeCounter = 0;
const nextEdgeId = () => `e_${Date.now().toString(36)}_${(edgeCounter++).toString(36)}`;

const MAX_HISTORY = 50;
export const CANVAS_WIDTH_KEY = '__canvasWidth';
export const CANVAS_HEIGHT_KEY = '__canvasHeight';
export const CANVAS_LOCKED_KEY = '__canvasLocked';

function clampCanvasSize(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(120, Math.round(value));
}

function isCanvasLockedValue(value: unknown): boolean {
  return value === true || value === 'true';
}

function isCanvasNoteNode(node: CanvasNode): boolean {
  return node.type === 'note' || node.data.nodeType === CANVAS_NOTE_NODE_TYPE;
}

function applyCanvasNodeFlags(node: CanvasNode): CanvasNode {
  const locked = isCanvasLockedValue(node.data[CANVAS_LOCKED_KEY]);
  if (isCanvasNoteNode(node)) {
    return {
      ...node,
      type: 'note',
      draggable: !locked,
      connectable: false,
    };
  }
  return {
    ...node,
    draggable: !locked,
    connectable: !locked,
  };
}

function createCanvasEdge(connection: Connection): Edge {
  return {
    ...connection,
    id: nextEdgeId(),
    type: 'openclaw',
    animated: false,
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
  };
}

function isCompatibleDataType(sourceType: string, targetType: string): boolean {
  return sourceType === 'any' || targetType === 'any' || sourceType === targetType;
}

function wouldCreateCycle(edges: Edge[], source: string, target: string): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  outgoing.set(source, [...(outgoing.get(source) ?? []), target]);

  const visited = new Set<string>();
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

function validateConnection(
  catalog: NodeCatalog | null,
  nodes: CanvasNode[],
  edges: Edge[],
  connection: Connection,
  replacingEdgeId?: string,
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;

  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode) return false;
  if (isCanvasNoteNode(sourceNode) || isCanvasNoteNode(targetNode)) return false;

  const sourceDescriptor = getNodeType(catalog, sourceNode.data.nodeType);
  const targetDescriptor = getNodeType(catalog, targetNode.data.nodeType);
  if (!sourceDescriptor || !targetDescriptor) return false;

  const sourcePortName = connection.sourceHandle ?? sourceDescriptor.outputs[0]?.name;
  const targetPortName = connection.targetHandle ?? targetDescriptor.inputs[0]?.name;
  if (!sourcePortName || !targetPortName) return false;

  const sourcePort = sourceDescriptor.outputs.find((port) => port.name === sourcePortName);
  const targetPort = targetDescriptor.inputs.find((port) => port.name === targetPortName);
  if (!sourcePort || !targetPort) return false;
  if (!isCompatibleDataType(sourcePort.dataType, targetPort.dataType)) return false;

  const comparableEdges = edges.filter((edge) => edge.id !== replacingEdgeId);
  if (
    comparableEdges.some(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        (edge.sourceHandle ?? 'out') === sourcePortName &&
        (edge.targetHandle ?? 'in') === targetPortName,
    )
  ) {
    return false;
  }

  if (
    comparableEdges.some(
      (edge) => edge.target === connection.target && (edge.targetHandle ?? 'in') === targetPortName,
    )
  ) {
    return false;
  }

  return !wouldCreateCycle(comparableEdges, connection.source, connection.target);
}

function cloneMarker(
  marker: Edge['markerStart'] | Edge['markerEnd'],
): Edge['markerStart'] | Edge['markerEnd'] {
  return typeof marker === 'object' && marker !== null ? { ...marker } : marker;
}

function cloneCanvasNode(node: CanvasNode): CanvasNode {
  return applyCanvasNodeFlags({
    ...node,
    position: { ...node.position },
    data: { ...node.data },
    style: node.style ? { ...node.style } : undefined,
    selected: false,
  });
}

function cloneCanvasEdge(edge: Edge): Edge {
  return {
    ...edge,
    style: edge.style ? { ...edge.style } : undefined,
    data: edge.data ? { ...edge.data } : undefined,
    markerEnd: cloneMarker(edge.markerEnd),
    markerStart: cloneMarker(edge.markerStart),
    selected: false,
  };
}

function createClipboardFromSelection(
  nodes: CanvasNode[],
  edges: Edge[],
): ClipboardSnapshot | null {
  const selectedNodes = nodes.filter((node) => node.selected);
  if (selectedNodes.length === 0) {
    return null;
  }

  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = edges.filter(
    (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
  );

  return {
    nodes: selectedNodes.map(cloneCanvasNode),
    edges: selectedEdges.map(cloneCanvasEdge),
  };
}

function buildPastedSelection(
  clipboard: ClipboardSnapshot,
  offset: number,
): { nodes: CanvasNode[]; edges: Edge[] } {
  const idMap = new Map<string, string>();
  const pastedNodes = clipboard.nodes.map((node) => {
    const nextId = nextNodeId();
    idMap.set(node.id, nextId);
    return applyCanvasNodeFlags({
      ...node,
      id: nextId,
      position: {
        x: node.position.x + offset,
        y: node.position.y + offset,
      },
      data: { ...node.data },
      style: node.style ? { ...node.style } : undefined,
      selected: true,
    });
  });

  const pastedEdges: Edge[] = [];
  for (const edge of clipboard.edges) {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) {
      continue;
    }

    pastedEdges.push({
      ...edge,
      id: nextEdgeId(),
      source,
      target,
      selected: false,
      style: edge.style ? { ...edge.style } : undefined,
      data: edge.data ? { ...edge.data } : undefined,
      markerEnd: cloneMarker(edge.markerEnd),
      markerStart: cloneMarker(edge.markerStart),
    });
  }

  return { nodes: pastedNodes, edges: pastedEdges };
}

function getRecipeInsertOrigin(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) {
    return { x: 80, y: 80 };
  }

  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    maxX = Math.max(maxX, node.position.x);
    minY = Math.min(minY, node.position.y);
  }

  return {
    x: Number.isFinite(maxX) ? maxX + 280 : 80,
    y: Number.isFinite(minY) ? Math.max(minY, 80) : 80,
  };
}

function hasPersistentNodeChanges(changes: NodeChange<CanvasNode>[]): boolean {
  return changes.some((change) => change.type !== 'select' && change.type !== 'dimensions');
}

function hasPersistentEdgeChanges(changes: EdgeChange[]): boolean {
  return changes.some((change) => change.type !== 'select');
}

function removeNodesAndConnectedEdges(
  nodes: CanvasNode[],
  edges: Edge[],
  nodeIds: string[],
): { nodes: CanvasNode[]; edges: Edge[] } {
  if (nodeIds.length === 0) return { nodes, edges };
  const ids = new Set(nodeIds);
  return {
    nodes: nodes.filter((node) => !ids.has(node.id)),
    edges: edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
  };
}

function removeEdges(edges: Edge[], edgeIds: string[]): Edge[] {
  if (edgeIds.length === 0) return edges;
  const ids = new Set(edgeIds);
  return edges.filter((edge) => !ids.has(edge.id));
}

function pushHistory(
  past: HistorySnapshot[],
  nodes: CanvasNode[],
  edges: Edge[],
): HistorySnapshot[] {
  const next = [...past, { nodes, edges }];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

function readNodeWidth(node: CanvasNode): number {
  return clampCanvasSize(Number(node.style?.width ?? node.data[CANVAS_WIDTH_KEY]), 220);
}

function readNodeHeight(node: CanvasNode): number {
  return clampCanvasSize(Number(node.style?.height ?? node.data[CANVAS_HEIGHT_KEY]), 112);
}

function autoLayoutNodes(nodes: CanvasNode[], edges: Edge[]): CanvasNode[] {
  if (nodes.length < 2) return nodes;

  const flowNodes = nodes.filter((node) => !isCanvasNoteNode(node));
  if (flowNodes.length < 2) return nodes;

  const nodeIds = new Set(flowNodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of flowNodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const byPosition = [...flowNodes].sort(
    (left, right) => left.position.y - right.position.y || left.position.x - right.position.x,
  );
  const queue = byPosition.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const remainingIndegree = new Map(indegree);
  const layerById = new Map<string, number>();

  for (const id of queue) {
    layerById.set(id, 0);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    if (!id) continue;
    const sourceLayer = layerById.get(id) ?? 0;
    for (const targetId of outgoing.get(id) ?? []) {
      layerById.set(targetId, Math.max(layerById.get(targetId) ?? 0, sourceLayer + 1));
      const nextIndegree = (remainingIndegree.get(targetId) ?? 0) - 1;
      remainingIndegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(targetId);
      }
    }
  }

  let fallbackLayer = Math.max(0, ...layerById.values()) + 1;
  for (const node of byPosition) {
    if (!layerById.has(node.id)) {
      layerById.set(node.id, fallbackLayer);
      fallbackLayer += 1;
    }
  }

  const layers = new Map<number, CanvasNode[]>();
  for (const node of flowNodes) {
    const layer = layerById.get(node.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  }

  const sortedLayerKeys = [...layers.keys()].sort((left, right) => left - right);
  const minX = Math.min(...flowNodes.map((node) => node.position.x));
  const minY = Math.min(...flowNodes.map((node) => node.position.y));
  const originX = Number.isFinite(minX) ? Math.max(40, minX) : 80;
  const originY = Number.isFinite(minY) ? Math.max(40, minY) : 80;
  const columnGap = 120;
  const rowGap = 44;
  const layerX = new Map<number, number>();
  let nextX = originX;

  for (const layer of sortedLayerKeys) {
    const layerNodes = layers.get(layer) ?? [];
    layerX.set(layer, nextX);
    const widest = Math.max(220, ...layerNodes.map(readNodeWidth));
    nextX += widest + columnGap;
  }

  const positionById = new Map<string, { x: number; y: number }>();
  for (const layer of sortedLayerKeys) {
    const layerNodes = [...(layers.get(layer) ?? [])].sort(
      (left, right) => left.position.y - right.position.y || left.position.x - right.position.x,
    );
    let nextY = originY;
    for (const node of layerNodes) {
      positionById.set(node.id, {
        x: layerX.get(layer) ?? originX,
        y: nextY,
      });
      nextY += readNodeHeight(node) + rowGap;
    }
  }

  return nodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) ?? node.position,
  }));
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodeCatalog: null,
  nodes: [],
  edges: [],
  flowId: null,
  flowName: 'Untitled flow',
  flowVersion: 0,
  publishedVersion: null,
  dirty: false,
  runNodeStatuses: {},
  nodeIssueCounts: {},
  clipboard: null,
  pasteCount: 0,
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  undo: () => {
    const { past, nodes, edges, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    if (!prev) return;
    set({
      past: past.slice(0, -1),
      future: [{ nodes, edges }, ...future].slice(0, MAX_HISTORY),
      nodes: prev.nodes,
      edges: prev.edges,
      dirty: true,
      canUndo: past.length > 1,
      canRedo: true,
    });
  },

  redo: () => {
    const { future, nodes, edges, past } = get();
    if (future.length === 0) return;
    const next = future[0];
    if (!next) return;
    set({
      future: future.slice(1),
      past: pushHistory(past, nodes, edges),
      nodes: next.nodes,
      edges: next.edges,
      dirty: true,
      canUndo: true,
      canRedo: future.length > 1,
    });
  },

  onNodesChange: (changes) => {
    const isPersistent = hasPersistentNodeChanges(changes);
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes),
      dirty: s.dirty || isPersistent,
      ...(isPersistent
        ? {
            past: pushHistory(s.past, s.nodes, s.edges),
            future: [],
            canUndo: true,
            canRedo: false,
          }
        : {}),
    }));
  },

  onEdgesChange: (changes) => {
    const isPersistent = hasPersistentEdgeChanges(changes);
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
      dirty: s.dirty || isPersistent,
      ...(isPersistent
        ? {
            past: pushHistory(s.past, s.nodes, s.edges),
            future: [],
            canUndo: true,
            canRedo: false,
          }
        : {}),
    }));
  },

  onConnect: (connection) =>
    set((s) => {
      if (!validateConnection(s.nodeCatalog, s.nodes, s.edges, connection)) return s;
      return {
        edges: addEdge(createCanvasEdge(connection), s.edges),
        dirty: true,
        past: pushHistory(s.past, s.nodes, s.edges),
        future: [],
        canUndo: true,
        canRedo: false,
      };
    }),

  reconnectEdge: (oldEdge, connection) =>
    set((state) => {
      if (!validateConnection(state.nodeCatalog, state.nodes, state.edges, connection, oldEdge.id)) {
        return state;
      }
      return {
        edges: reconnectCanvasEdge(oldEdge, connection, state.edges, {
          shouldReplaceId: false,
        }),
        dirty: true,
        past: pushHistory(state.past, state.nodes, state.edges),
        future: [],
        canUndo: true,
        canRedo: false,
      };
    }),

  selectNode: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.map((node) => ({
        ...node,
        selected: nodeId !== null && node.id === nodeId,
      })),
      edges: state.edges.map((edge) => ({ ...edge, selected: false })),
    })),

  selectEdge: (edgeId) =>
    set((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, selected: false })),
      edges: state.edges.map((edge) => ({
        ...edge,
        selected: edgeId !== null && edge.id === edgeId,
      })),
    })),

  setNodeCatalog: (catalog) =>
    set((state) => ({
      nodeCatalog: catalog,
      nodes: state.nodes.map((node) =>
        applyCanvasNodeFlags({
          ...node,
          data: mergeNodeDataWithDefaults(catalog, node.data.nodeType, node.data),
        }),
      ),
    })),

  setRunNodeStatuses: (statuses) => set({ runNodeStatuses: statuses }),

  setNodeIssueCounts: (counts) => set({ nodeIssueCounts: counts }),

  isConnectionValid: (connection) => {
    const state = get();
    return validateConnection(state.nodeCatalog, state.nodes, state.edges, connection);
  },

  addNode: (nodeType, position) => {
    const catalog = get().nodeCatalog;
    const descriptor = getNodeType(catalog, nodeType);
    if (!descriptor) return;
    if (descriptor.availability?.status === 'planned') return;
    const defaults = getNodeDefaults(catalog, nodeType);
    const node: CanvasNode = {
      id: nextNodeId(),
      type: 'openclaw',
      position,
      data: {
        nodeType,
        ...defaults,
        label: typeof defaults.label === 'string' ? defaults.label : descriptor.label,
      },
    };
    set((s) => ({
      nodes: [...s.nodes, applyCanvasNodeFlags(node)],
      dirty: true,
      past: pushHistory(s.past, s.nodes, s.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    }));
  },

  addNote: (position = { x: 120, y: 120 }) => {
    const node: CanvasNode = applyCanvasNodeFlags({
      id: nextNodeId(),
      type: 'note',
      position,
      data: {
        nodeType: CANVAS_NOTE_NODE_TYPE,
        label: 'Note',
        text: 'Write a note...',
        tone: 'yellow',
      },
      style: {
        width: 240,
        height: 180,
      },
      selected: true,
    });

    set((s) => ({
      nodes: [...s.nodes.map((entry) => ({ ...entry, selected: false })), node],
      dirty: true,
      past: pushHistory(s.past, s.nodes, s.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    }));
  },

  applyRecipe: (recipeId) => {
    const state = get();
    const catalog = state.nodeCatalog;
    if (!catalog) return false;

    const recipe = CANVAS_RECIPES.find((entry) => entry.id === recipeId);
    if (!recipe) return false;

    const origin = getRecipeInsertOrigin(state.nodes);
    const minX = Math.min(...recipe.nodes.map((node) => node.position.x));
    const minY = Math.min(...recipe.nodes.map((node) => node.position.y));
    const idMap = new Map<string, string>();

    const nextNodes: CanvasNode[] = [];
    for (const template of recipe.nodes) {
      const descriptor = getNodeType(catalog, template.nodeType);
      if (!descriptor || descriptor.availability?.status === 'planned') {
        return false;
      }

      const nextId = nextNodeId();
      idMap.set(template.id, nextId);

      const defaults = getNodeDefaults(catalog, template.nodeType);
      const data = mergeNodeDataWithDefaults(catalog, template.nodeType, {
        ...defaults,
        ...(template.data ?? {}),
        label: template.label,
      });

      nextNodes.push(
        applyCanvasNodeFlags({
          id: nextId,
          type: 'openclaw',
          position: {
            x: origin.x + (template.position.x - minX),
            y: origin.y + (template.position.y - minY),
          },
          selected: true,
          data,
        }),
      );
    }

    const nextEdges: Edge[] = [];
    for (const edge of recipe.edges) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) {
        return false;
      }
      nextEdges.push(
        createCanvasEdge({
          source,
          sourceHandle: edge.sourcePort,
          target,
          targetHandle: edge.targetPort,
        }),
      );
    }

    set({
      nodes: [...state.nodes.map((node) => ({ ...node, selected: false })), ...nextNodes],
      edges: [...state.edges.map((edge) => ({ ...edge, selected: false })), ...nextEdges],
      dirty: true,
      past: pushHistory(state.past, state.nodes, state.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    });

    return true;
  },

  copyNode: (nodeId) => {
    const { nodes, edges, nodeCatalog } = get();
    const source = nodes.find((n) => n.id === nodeId);
    if (!source) return;
    const copy = applyCanvasNodeFlags({
      ...source,
      id: nextNodeId(),
      position: { x: source.position.x + 30, y: source.position.y + 30 },
      selected: false,
      data: { ...source.data },
    });
    if (nodeCatalog) {
      copy.data = mergeNodeDataWithDefaults(nodeCatalog, copy.data.nodeType, copy.data);
    }
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...copy, selected: true }],
      dirty: true,
      past: pushHistory(s.past, nodes, edges),
      future: [],
      canUndo: true,
      canRedo: false,
    }));
  },

  setFlowName: (name) => set({ flowName: name, dirty: true }),

  loadFlow: (flow) =>
    set({
      nodes: graphToNodes(flow.nodes, get().nodeCatalog),
      edges: graphToEdges(flow.edges),
      flowId: flow.id,
      flowName: flow.name,
      flowVersion: flow.version,
      publishedVersion: flow.publishedVersion ?? null,
      dirty: false,
      runNodeStatuses: {},
      nodeIssueCounts: {},
      clipboard: null,
      pasteCount: 0,
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    }),

  markSaved: ({ id, version, publishedVersion }) =>
    set({
      flowId: id,
      flowVersion: version,
      publishedVersion: publishedVersion ?? null,
      dirty: false,
      runNodeStatuses: {},
    }),

  markPublished: (version) => set({ publishedVersion: version }),

  updateNodeData: (nodeId, patch) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? applyCanvasNodeFlags({
              ...node,
              data: { ...node.data, ...patch, nodeType: node.data.nodeType },
            })
          : node,
      ),
      dirty: true,
      past: pushHistory(state.past, state.nodes, state.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    })),

  updateNodeSize: (nodeId, width, height) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              style: {
                ...node.style,
                width: clampCanvasSize(width, 220),
                height: clampCanvasSize(height, 96),
              },
              data: {
                ...node.data,
                [CANVAS_WIDTH_KEY]: clampCanvasSize(width, 220),
                [CANVAS_HEIGHT_KEY]: clampCanvasSize(height, 96),
              },
            }
          : node,
      ),
      dirty: true,
      past: pushHistory(state.past, state.nodes, state.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    })),

  deleteNode: (nodeId) =>
    set((state) => ({
      ...removeNodesAndConnectedEdges(state.nodes, state.edges, [nodeId]),
      dirty: true,
      past: pushHistory(state.past, state.nodes, state.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    })),

  deleteEdge: (edgeId) =>
    set((state) => ({
      edges: removeEdges(state.edges, [edgeId]),
      dirty: true,
      past: pushHistory(state.past, state.nodes, state.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    })),

  deleteSelectedElements: () =>
    set((state) => {
      const selectedNodeIds = state.nodes.filter((n) => n.selected).map((n) => n.id);
      const selectedEdgeIds = state.edges.filter((e) => e.selected).map((e) => e.id);
      if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return state;
      return {
        ...removeNodesAndConnectedEdges(
          state.nodes,
          removeEdges(state.edges, selectedEdgeIds),
          selectedNodeIds,
        ),
        dirty: true,
        past: pushHistory(state.past, state.nodes, state.edges),
        future: [],
        canUndo: true,
        canRedo: false,
      };
    }),

  resetFlow: () =>
    set({
      nodeCatalog: get().nodeCatalog,
      nodes: [],
      edges: [],
      flowId: null,
      flowName: 'Untitled flow',
      flowVersion: 0,
      publishedVersion: null,
      dirty: false,
      nodeIssueCounts: {},
      clipboard: null,
      pasteCount: 0,
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    }),

  copySelection: () => {
    const { nodes, edges } = get();
    const clipboard = createClipboardFromSelection(nodes, edges);
    if (!clipboard) {
      return false;
    }

    set({
      clipboard,
      pasteCount: 0,
    });

    return true;
  },

  pasteSelection: () => {
    const { clipboard, nodes, edges, past, pasteCount } = get();
    if (!clipboard || clipboard.nodes.length === 0) {
      return false;
    }

    const offset = 40 * (pasteCount + 1);
    const pasted = buildPastedSelection(clipboard, offset);

    set({
      nodes: [...nodes.map((node) => ({ ...node, selected: false })), ...pasted.nodes],
      edges: [...edges.map((edge) => ({ ...edge, selected: false })), ...pasted.edges],
      dirty: true,
      past: pushHistory(past, nodes, edges),
      future: [],
      canUndo: true,
      canRedo: false,
      pasteCount: pasteCount + 1,
    });

    return true;
  },

  duplicateSelection: () => {
    const { nodes, edges, past } = get();
    const clipboard = createClipboardFromSelection(nodes, edges);
    if (!clipboard) {
      return false;
    }

    const duplicated = buildPastedSelection(clipboard, 30);

    set({
      nodes: [...nodes.map((node) => ({ ...node, selected: false })), ...duplicated.nodes],
      edges: [...edges.map((edge) => ({ ...edge, selected: false })), ...duplicated.edges],
      dirty: true,
      past: pushHistory(past, nodes, edges),
      future: [],
      canUndo: true,
      canRedo: false,
    });

    return true;
  },

  setSelectedNodesLocked: (locked) => {
    const state = get();
    const selectedNodeIds = state.nodes.filter((node) => node.selected).map((node) => node.id);
    if (selectedNodeIds.length === 0) {
      return false;
    }

    const ids = new Set(selectedNodeIds);
    set({
      nodes: state.nodes.map((node) =>
        ids.has(node.id)
          ? applyCanvasNodeFlags({
              ...node,
              data: { ...node.data, [CANVAS_LOCKED_KEY]: locked },
            })
          : node,
      ),
      dirty: true,
      past: pushHistory(state.past, state.nodes, state.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    });

    return true;
  },

  autoLayout: () => {
    const state = get();
    if (state.nodes.length < 2) return false;
    const nextNodes = autoLayoutNodes(state.nodes, state.edges);
    const changed = nextNodes.some(
      (node, index) =>
        node.position.x !== state.nodes[index]?.position.x ||
        node.position.y !== state.nodes[index]?.position.y,
    );
    if (!changed) return false;
    set({
      nodes: nextNodes,
      dirty: true,
      past: pushHistory(state.past, state.nodes, state.edges),
      future: [],
      canUndo: true,
      canRedo: false,
    });
    return true;
  },
}));
