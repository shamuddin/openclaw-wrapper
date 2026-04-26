'use client';

import { type ReactNode, createContext, useContext, useMemo, useState } from 'react';

const WORKSPACE_STORAGE_KEY = 'openclaw-wrapper:workspace-slug';
const DEFAULT_WORKSPACE_SLUG = 'default';

interface WorkspaceContextValue {
  workspaceSlug: string;
  setWorkspaceSlug: (slug: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readInitialWorkspaceSlug(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_WORKSPACE_SLUG;
  }
  const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)?.trim();
  return stored || DEFAULT_WORKSPACE_SLUG;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceSlug, setWorkspaceSlugState] = useState(readInitialWorkspaceSlug);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaceSlug,
      setWorkspaceSlug(slug) {
        const nextSlug = slug.trim() || DEFAULT_WORKSPACE_SLUG;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(WORKSPACE_STORAGE_KEY, nextSlug);
        }
        setWorkspaceSlugState(nextSlug);
      },
    }),
    [workspaceSlug],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider');
  }
  return value;
}

export { DEFAULT_WORKSPACE_SLUG, WORKSPACE_STORAGE_KEY };
