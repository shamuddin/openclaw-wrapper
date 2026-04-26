'use client';

import { cn } from '@/lib/utils';
import {
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionLineType,
  ControlButton,
  Controls,
  type Edge,
  MiniMap,
  type NodeTypes,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  getNodesBounds,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ClipboardPaste,
  Copy,
  Focus,
  Grid3X3,
  Lock,
  Map as MapIcon,
  MousePointer2,
  Redo2,
  Sparkles,
  Spline,
  Trash2,
  Undo2,
  Unlock,
} from 'lucide-react';
import {
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CustomEdge } from './CustomEdge';
import { CustomNode } from './CustomNode';
import { PALETTE_MIME, Palette } from './Palette';
import { getNodeAccent, getNodeType } from './node-types';
import { CANVAS_RECIPES } from './presets';
import { CANVAS_LOCKED_KEY, type CanvasNode } from './store';
import { useCanvasStore } from './store';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  );
}

function CanvasHudButton({
  active = false,
  label,
  onClick,
  disabled = false,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg border transition',
        active
          ? 'border-[var(--color-accent)] bg-indigo-50 text-[var(--color-accent)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] text-gray-400 hover:border-gray-300 hover:text-gray-700',
        disabled && 'pointer-events-none opacity-30',
      )}
    >
      {children}
    </button>
  );
}

function SelectionActionButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SelectionOverlay({
  bounds,
  nodeCount,
  edgeCount,
  hasClipboard,
  hasLockedNode,
  onFit,
  onDuplicate,
  onCopy,
  onPaste,
  onToggleLock,
  onDelete,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  nodeCount: number;
  edgeCount: number;
  hasClipboard: boolean;
  hasLockedNode: boolean;
  onFit: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}) {
  const { zoom } = useViewport();
  const anchorX = bounds.x + bounds.width / 2;
  const anchorY = bounds.y - 16;

  return (
    <ViewportPortal>
      <div
        className="pointer-events-none absolute left-0 top-0"
        style={{
          transform: `translate(${anchorX}px, ${anchorY}px) translate(-50%, -100%) scale(${1 / zoom})`,
          transformOrigin: 'center bottom',
        }}
      >
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
          <div className="pr-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Selection
            </div>
            <div className="text-xs text-[var(--color-fg)]">
              {nodeCount} node{nodeCount === 1 ? '' : 's'}
              {edgeCount > 0 ? ` · ${edgeCount} edge${edgeCount === 1 ? '' : 's'}` : ''}
            </div>
          </div>

          <SelectionActionButton label="Fit selection" onClick={onFit}>
            <Focus className="h-3.5 w-3.5" strokeWidth={2} />
            Fit
          </SelectionActionButton>
          <SelectionActionButton label="Duplicate selection" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            Duplicate
          </SelectionActionButton>
          <SelectionActionButton label="Copy selection" onClick={onCopy}>
            <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            Copy
          </SelectionActionButton>
          <SelectionActionButton label="Paste selection" onClick={onPaste} disabled={!hasClipboard}>
            <ClipboardPaste className="h-3.5 w-3.5" strokeWidth={2} />
            Paste
          </SelectionActionButton>
          <SelectionActionButton
            label={hasLockedNode ? 'Unlock selected nodes' : 'Lock selected nodes'}
            onClick={onToggleLock}
          >
            {hasLockedNode ? (
              <Unlock className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Lock className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {hasLockedNode ? 'Unlock' : 'Lock'}
          </SelectionActionButton>
          <SelectionActionButton label="Delete selection" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-red-600" strokeWidth={2} />
            Delete
          </SelectionActionButton>
        </div>
      </div>
    </ViewportPortal>
  );
}

function CanvasInner() {
  const {
    nodeCatalog,
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    reconnectEdge,
    addNode,
    applyRecipe,
    selectNode,
    selectEdge,
    deleteSelectedElements,
    copySelection,
    pasteSelection,
    duplicateSelection,
    setSelectedNodesLocked,
    deleteEdge,
    clipboard,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCanvasStore(
    useShallow((state) => ({
      nodeCatalog: state.nodeCatalog,
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
      reconnectEdge: state.reconnectEdge,
      addNode: state.addNode,
      applyRecipe: state.applyRecipe,
      selectNode: state.selectNode,
      selectEdge: state.selectEdge,
      deleteSelectedElements: state.deleteSelectedElements,
      copySelection: state.copySelection,
      pasteSelection: state.pasteSelection,
      duplicateSelection: state.duplicateSelection,
      setSelectedNodesLocked: state.setSelectedNodesLocked,
      deleteEdge: state.deleteEdge,
      clipboard: state.clipboard,
      undo: state.undo,
      redo: state.redo,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    })),
  );
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [backgroundVariant, setBackgroundVariant] = useState<BackgroundVariant>(
    BackgroundVariant.Dots,
  );
  const edgeReconnectSuccessful = useRef(true);
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((edge) => edge.selected), [edges]);
  const selectedNodeBounds = useMemo(
    () => (selectedNodes.length > 0 ? getNodesBounds(selectedNodes) : null),
    [selectedNodes],
  );
  const hasClipboard = Boolean(clipboard?.nodes.length);
  const hasLockedSelectedNode = selectedNodes.some(
    (node) => node.data[CANVAS_LOCKED_KEY] === true || node.data[CANVAS_LOCKED_KEY] === 'true',
  );
  const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0;
  const showSelectionOverlay = selectedNodes.length + selectedEdges.length > 1;

  const nodeTypes: NodeTypes = useMemo(() => ({ openclaw: CustomNode }), []);
  const edgeTypes = useMemo(() => ({ openclaw: CustomEdge }), []);
  const availableRecipes = useMemo(
    () =>
      CANVAS_RECIPES.filter((recipe) =>
        recipe.nodes.every((recipeNode) => {
          const descriptor = getNodeType(nodeCatalog, recipeNode.nodeType);
          return descriptor?.availability?.status !== 'planned';
        }),
      ),
    [nodeCatalog],
  );

  const fitSelectionToView = useCallback(() => {
    if (selectedNodes.length === 0) return;
    void fitView({
      nodes: selectedNodes.map((node) => ({ id: node.id })),
      padding: 0.24,
      duration: 280,
    });
  }, [fitView, selectedNodes]);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData(PALETTE_MIME);
      if (!nodeType) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(nodeType, position);
    },
    [addNode, screenToFlowPosition],
  );

  const onNodeClick = useCallback(
    (_event: MouseEvent, node: CanvasNode) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const onEdgeClick = useCallback(
    (_event: MouseEvent, edge: Edge) => {
      selectEdge(edge.id);
    },
    [selectEdge],
  );

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      edgeReconnectSuccessful.current = true;
      reconnectEdge(oldEdge, connection);
    },
    [reconnectEdge],
  );

  const onReconnectEnd = useCallback(
    (_event: unknown, edge: Edge, _handleType: unknown, _connectionState: unknown) => {
      if (!edgeReconnectSuccessful.current) {
        deleteEdge(edge.id);
      }
      edgeReconnectSuccessful.current = true;
    },
    [deleteEdge],
  );

  // Keyboard shortcuts: Delete, Undo (Ctrl+Z), Redo (Ctrl+Y / Ctrl+Shift+Z), Duplicate (Ctrl+D)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const ctrl = event.ctrlKey || event.metaKey;

      if ((event.key === 'Delete' || event.key === 'Backspace') && !ctrl) {
        if (!hasSelection) return;
        event.preventDefault();
        deleteSelectedElements();
        return;
      }

      if (ctrl && event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (ctrl && (event.key === 'y' || (event.key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }

      if (ctrl && event.key === 'd') {
        event.preventDefault();
        duplicateSelection();
        return;
      }

      if (ctrl && event.key === 'c') {
        const copied = copySelection();
        if (copied) {
          event.preventDefault();
        }
        return;
      }

      if (ctrl && event.key === 'v') {
        const pasted = pasteSelection();
        if (pasted) {
          event.preventDefault();
        }
        return;
      }

      if (!ctrl && event.key.toLowerCase() === 'f' && selectedNodes.length > 0) {
        event.preventDefault();
        fitSelectionToView();
        return;
      }

      if (ctrl && event.key === 's') {
        event.preventDefault();
        // Dispatch a custom event that FlowBar listens to
        window.dispatchEvent(new CustomEvent('canvas:save'));
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    deleteSelectedElements,
    duplicateSelection,
    fitSelectionToView,
    hasSelection,
    pasteSelection,
    copySelection,
    redo,
    selectedNodes.length,
    undo,
  ]);

  return (
    <div className="flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        colorMode="light"
        fitView
        fitViewOptions={{ padding: 0.18, duration: 300 }}
        defaultEdgeOptions={{
          animated: false,
          type: 'openclaw',
          style: { stroke: 'var(--color-border)', strokeWidth: 1.5 },
        }}
        snapToGrid={snapToGrid}
        snapGrid={[20, 20]}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnScroll
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: 'var(--color-accent)', strokeWidth: 1.5 }}
        elevateEdgesOnSelect
        onlyRenderVisibleElements
        autoPanOnNodeDrag
        autoPanOnConnect
        edgesReconnectable
        minZoom={0.35}
        maxZoom={1.65}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={backgroundVariant}
          gap={backgroundVariant === BackgroundVariant.Dots ? 20 : 32}
          size={backgroundVariant === BackgroundVariant.Dots ? 1 : 0.8}
          color="var(--color-border)"
        />

        {showMiniMap && (
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => {
              if (!('nodeType' in node.data)) return 'var(--color-border)';
              const descriptor = getNodeType(nodeCatalog, String(node.data.nodeType));
              return descriptor
                ? getNodeAccent(nodeCatalog, descriptor.category)
                : 'var(--color-border)';
            }}
            nodeStrokeColor="rgba(0,0,0,0.06)"
            maskColor="rgba(249,250,251,0.75)"
            className="!rounded-xl !border !border-[var(--color-border)] !bg-white !shadow-sm"
          />
        )}

        <Controls
          className="!rounded-xl !border !border-[var(--color-border)] !bg-white !shadow-sm"
          fitViewOptions={{ padding: 0.18, duration: 300 }}
        >
          <ControlButton
            onClick={fitSelectionToView}
            disabled={selectedNodes.length === 0}
            title="Fit selection"
            aria-label="Fit selection"
          >
            <Focus className="h-3.5 w-3.5" strokeWidth={2} />
          </ControlButton>
        </Controls>

        {selectedNodeBounds && showSelectionOverlay && (
          <SelectionOverlay
            bounds={selectedNodeBounds}
            nodeCount={selectedNodes.length}
            edgeCount={selectedEdges.length}
            hasClipboard={hasClipboard}
            hasLockedNode={hasLockedSelectedNode}
            onFit={fitSelectionToView}
            onDuplicate={() => {
              duplicateSelection();
            }}
            onCopy={() => {
              copySelection();
            }}
            onPaste={() => {
              pasteSelection();
            }}
            onToggleLock={() => {
              setSelectedNodesLocked(!hasLockedSelectedNode);
            }}
            onDelete={deleteSelectedElements}
          />
        )}

        {nodes.length === 0 && (
          <Panel position="top-center">
            <div className="mt-16 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/90 px-8 py-6 text-center shadow-sm backdrop-blur-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                <MousePointer2 className="h-6 w-6" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--color-fg)]">
                  Start building your flow
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Drag a node from the left panel onto the canvas,
                  <br />
                  or click a node type to add it.
                </p>
              </div>
              {availableRecipes.length > 0 && (
                <div className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                  <div className="mb-2 flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" strokeWidth={2} />
                    Starter Recipes
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {availableRecipes.map((recipe) => (
                      <button
                        key={recipe.id}
                        type="button"
                        onClick={() => {
                          applyRecipe(recipe.id);
                        }}
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-left transition hover:border-gray-300 hover:bg-white"
                      >
                        <div className="text-sm font-medium text-[var(--color-fg)]">
                          {recipe.title}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-gray-400">
                          {recipe.description}
                        </div>
                        <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-400">
                          {recipe.steps.join(' -> ')}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2 text-[11px] text-gray-400">
                <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-1">
                  <kbd className="font-mono">Ctrl+Z</kbd> undo
                </span>
                <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-1">
                  <kbd className="font-mono">Ctrl+S</kbd> save
                </span>
                <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-1">
                  <kbd className="font-mono">Del</kbd> delete
                </span>
                <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-1">
                  <kbd className="font-mono">Ctrl+D</kbd> duplicate
                </span>
                <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-1">
                  <kbd className="font-mono">Ctrl+C</kbd>/<kbd className="font-mono">Ctrl+V</kbd>{' '}
                  copy paste
                </span>
                <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-1">
                  <kbd className="font-mono">F</kbd> fit selection
                </span>
              </div>
            </div>
          </Panel>
        )}

        <Panel position="top-right">
          <div className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-sm">
            <CanvasHudButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
              <Undo2 className="h-3.5 w-3.5" strokeWidth={2} />
            </CanvasHudButton>
            <CanvasHudButton label="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
              <Redo2 className="h-3.5 w-3.5" strokeWidth={2} />
            </CanvasHudButton>
            <div className="h-5 w-px bg-[var(--color-border)]" />
            <CanvasHudButton
              label="Fit canvas"
              onClick={() => fitView({ padding: 0.18, duration: 300 })}
            >
              <Focus className="h-3.5 w-3.5" strokeWidth={2} />
            </CanvasHudButton>
            <CanvasHudButton
              label="Fit selection"
              onClick={fitSelectionToView}
              disabled={selectedNodes.length === 0}
            >
              <Focus className="h-3.5 w-3.5" strokeWidth={2} />
            </CanvasHudButton>
            <CanvasHudButton
              label={snapToGrid ? 'Disable snap to grid' : 'Enable snap to grid'}
              active={snapToGrid}
              onClick={() => setSnapToGrid((v) => !v)}
            >
              <Grid3X3 className="h-3.5 w-3.5" strokeWidth={2} />
            </CanvasHudButton>
            <CanvasHudButton
              label={
                backgroundVariant === BackgroundVariant.Dots
                  ? 'Switch to line background'
                  : 'Switch to dot background'
              }
              active={backgroundVariant === BackgroundVariant.Lines}
              onClick={() =>
                setBackgroundVariant((v) =>
                  v === BackgroundVariant.Dots ? BackgroundVariant.Lines : BackgroundVariant.Dots,
                )
              }
            >
              <Spline className="h-3.5 w-3.5" strokeWidth={2} />
            </CanvasHudButton>
            <CanvasHudButton
              label={showMiniMap ? 'Hide mini map' : 'Show mini map'}
              active={showMiniMap}
              onClick={() => setShowMiniMap((v) => !v)}
            >
              <MapIcon className="h-3.5 w-3.5" strokeWidth={2} />
            </CanvasHudButton>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <div className="flex h-full w-full overflow-hidden">
        <Palette />
        <CanvasInner />
      </div>
    </ReactFlowProvider>
  );
}
