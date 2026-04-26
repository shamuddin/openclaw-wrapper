import { AutomationWorkspace } from '@/automation/AutomationWorkspace';
import { AppHeader } from '@/components/AppHeader';

export default function AutomationPage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)]">
      <AppHeader
        current="automation"
        title="Automation"
        subtitle="Inspect managed task flows, child-task orchestration, retries, and durable runtime history."
      />
      <AutomationWorkspace />
    </div>
  );
}
