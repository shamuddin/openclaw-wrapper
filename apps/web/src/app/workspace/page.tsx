import { AppHeader } from '@/components/AppHeader';
import { WorkspacePanel } from '../../workspace/WorkspacePanel';

export default function WorkspacePage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)]">
      <AppHeader
        current="workspace"
        title="Workspace"
        subtitle="Create, browse, and manage the flows that belong to the active workspace."
      />
      <WorkspacePanel />
    </div>
  );
}
