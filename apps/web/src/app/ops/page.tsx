import { AppHeader } from '@/components/AppHeader';
import { OpsWorkspace } from '@/ops/OpsWorkspace';

export default function OpsPage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)]">
      <AppHeader
        current="ops"
        title="Operations"
        subtitle="Monitor workspace health, approvals, runtime channels/devices, and recent activity."
      />
      <OpsWorkspace />
    </div>
  );
}
