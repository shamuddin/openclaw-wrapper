import { AppHeader } from '@/components/AppHeader';
import { CronWorkspace } from '@/cron/CronWorkspace';

export default function CronPage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)]">
      <AppHeader
        current="cron"
        title="Scheduler"
        subtitle="Review cron runtime health, next wakes, and run history for the active workspace."
      />
      <CronWorkspace />
    </div>
  );
}
