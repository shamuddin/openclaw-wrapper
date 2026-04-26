import { AppIcon } from '@/components/ui/icon';
import { trpc } from '@/lib/trpc';
import {
  Activity,
  Cable,
  ChevronRight,
  Clock3,
  FolderOpen,
  GitBranch,
  Search,
  Sparkles,
} from 'lucide-react';
import type { DragEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canAddNode, getNodeAccent, isGatewayUnavailableNodeType } from './node-types';
import { CANVAS_RECIPES } from './presets';
import { useCanvasStore } from './store';

export const PALETTE_MIME = 'application/openclaw-node-type';

function onDragStart(event: DragEvent<HTMLDivElement>, nodeType: string) {
  event.dataTransfer.setData(PALETTE_MIME, nodeType);
  event.dataTransfer.effectAllowed = 'move';
}

const DEFAULT_OPEN_CATEGORIES = new Set(['triggers', 'ai', 'control', 'ops']);

export function Palette() {
  const pathname = usePathname();
  const setNodeCatalog = useCanvasStore((state) => state.setNodeCatalog);
  const nodeCatalog = useCanvasStore((state) => state.nodeCatalog);
  const applyRecipe = useCanvasStore((state) => state.applyRecipe);
  const catalogQuery = trpc.nodes.catalog.useQuery(undefined, { staleTime: 60_000 });
  const [query, setQuery] = useState('');
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (catalogQuery.data) setNodeCatalog(catalogQuery.data);
  }, [catalogQuery.data, setNodeCatalog]);

  const catalog = catalogQuery.data ?? nodeCatalog;

  useEffect(() => {
    if (!catalog || Object.keys(openCategories).length > 0) return;
    setOpenCategories(
      Object.fromEntries(
        catalog.categories.map((cat) => [cat.key, DEFAULT_OPEN_CATEGORIES.has(cat.key)]),
      ),
    );
  }, [catalog, openCategories]);

  const normalizedQuery = query.trim().toLowerCase();
  const hasGatewayUnavailableNodes =
    catalog?.nodes.some((node) => isGatewayUnavailableNodeType(node)) ?? false;
  const [localOnlyView, setLocalOnlyView] = useState(false);
  const [recipesExpanded, setRecipesExpanded] = useState(false);

  useEffect(() => {
    if (hasGatewayUnavailableNodes) {
      setLocalOnlyView(true);
    }
  }, [hasGatewayUnavailableNodes]);

  const sections = useMemo(() => {
    if (!catalog) return [];
    return catalog.categories
      .map((category) => ({
        category,
        nodes: catalog.nodes.filter((node) => {
          if (node.category !== category.key) return false;
          if (localOnlyView && isGatewayUnavailableNodeType(node)) return false;
          if (!normalizedQuery) return true;
          return [node.label, node.type, node.description]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery);
        }),
      }))
      .filter((s) => s.nodes.length > 0);
  }, [catalog, localOnlyView, normalizedQuery]);

  const availableRecipes = useMemo(() => {
    if (!catalog) return [];
    return CANVAS_RECIPES.filter((recipe) =>
      recipe.nodes.every((node) => {
        const descriptor = catalog.nodes.find((entry) => entry.type === node.nodeType);
        return (
          descriptor &&
          canAddNode(catalog, node.nodeType) &&
          (!localOnlyView || !isGatewayUnavailableNodeType(descriptor))
        );
      }),
    );
  }, [catalog, localOnlyView]);

  const dashboardLinks = [
    { href: '/workspace', label: 'Workspace', icon: FolderOpen },
    { href: '/cron', label: 'Cron Jobs', icon: Clock3 },
    { href: '/channels', label: 'Channels', icon: Cable },
    { href: '/automation', label: 'Automation', icon: GitBranch },
    { href: '/ops', label: 'Ops', icon: Activity },
  ];

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-3 py-3">
        <p className="mb-2 text-xs font-medium text-gray-400 uppercase tracking-wide">Nodes</p>
        <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" strokeWidth={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-[var(--color-fg)] outline-none placeholder:text-gray-400"
            placeholder="Search..."
          />
        </label>
        {hasGatewayUnavailableNodes && (
          <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
            <input
              type="checkbox"
              checked={localOnlyView}
              onChange={(event) => setLocalOnlyView(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="leading-4">
              <span className="block font-medium">Local-only view</span>
              <span className="text-amber-800/80">
                Hide node types that still need a live OpenClaw gateway right now.
              </span>
            </span>
          </label>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {availableRecipes.length > 0 && !normalizedQuery && (
          <section className="mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/70 p-2">
            <button
              type="button"
              onClick={() => setRecipesExpanded((open) => !open)}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-white/60"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-accent)]">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--color-fg)]">Starter recipes</div>
                <div className="truncate text-[11px] text-gray-400">
                  {recipesExpanded
                    ? 'Drop in a ready-made flow pattern and tweak it.'
                    : `${availableRecipes.length} ready-made flow patterns`}
                </div>
              </div>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] font-medium text-gray-500">
                {availableRecipes.length}
              </span>
              <ChevronRight
                className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${recipesExpanded ? 'rotate-90' : ''}`}
                strokeWidth={2}
              />
            </button>

            {recipesExpanded && (
              <div className="mt-2 space-y-2">
                {availableRecipes.map((recipe) => (
                  <button
                    key={recipe.id}
                    type="button"
                    onClick={() => applyRecipe(recipe.id)}
                    className="block w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-left transition hover:border-gray-300 hover:bg-white"
                  >
                    <div className="text-[13px] font-medium text-[var(--color-fg)]">
                      {recipe.title}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-gray-400">
                      {recipe.description}
                    </div>
                    <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-400">
                      {recipe.steps.join(' -> ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {catalogQuery.isLoading && !catalog && (
          <p className="px-2 py-3 text-xs text-gray-400">Loading...</p>
        )}

        {catalogQuery.error && !catalog && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {catalogQuery.error.message}
          </p>
        )}

        {!catalogQuery.isLoading && sections.length === 0 && (
          <p className="px-2 py-3 text-xs text-gray-400">No results.</p>
        )}

        <div className="space-y-1">
          {sections.map(({ category, nodes }) => {
            // When searching, force all matching categories open
            const open = normalizedQuery ? true : (openCategories[category.key] ?? false);
            return (
              <section key={category.key}>
                <button
                  type="button"
                  onClick={() => setOpenCategories((s) => ({ ...s, [category.key]: !open }))}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--color-surface-2)]"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
                    strokeWidth={2}
                  />
                  <span className="flex-1 text-xs font-medium text-gray-600">{category.label}</span>
                  <span className="text-[11px] text-gray-400">{nodes.length}</span>
                </button>

                {open && (
                  <div className="ml-2 mt-0.5 space-y-0.5 border-l border-[var(--color-border)] pl-2">
                    {nodes.map((nodeType) => {
                      const draggable = canAddNode(catalog, nodeType.type);
                      const accent = getNodeAccent(catalog, nodeType.category);

                      return (
                        <div
                          key={nodeType.type}
                          draggable={draggable}
                          onDragStart={draggable ? (e) => onDragStart(e, nodeType.type) : undefined}
                          title={
                            draggable
                              ? (nodeType.description ?? nodeType.label)
                              : `${nodeType.label} — coming soon`
                          }
                          className={`flex items-center gap-2.5 rounded-lg px-2 py-2 transition ${
                            draggable
                              ? 'cursor-grab hover:bg-[var(--color-surface-2)] active:cursor-grabbing'
                              : 'cursor-not-allowed opacity-40'
                          }`}
                        >
                          <div
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                            style={{ backgroundColor: `${accent}18`, color: accent }}
                          >
                            <AppIcon name={nodeType.icon} className="h-3.5 w-3.5" strokeWidth={2} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium text-[var(--color-fg)]">
                              {nodeType.label}
                            </div>
                            {nodeType.description && (
                              <div className="truncate text-[11px] text-gray-400">
                                {nodeType.description}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[var(--color-border)] px-2 py-3">
        <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Dashboard Menus
        </div>
        <div className="space-y-1">
          {dashboardLinks.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'text-gray-600 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
