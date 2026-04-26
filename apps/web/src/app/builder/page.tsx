import { Canvas } from '@/canvas/Canvas';
import { FlowBar } from '@/canvas/FlowBar';
import { RunInspector } from '@/canvas/RunInspector';
import { AppHeader } from '@/components/AppHeader';

export default function BuilderPage() {
  return (
    <div className="relative flex h-screen w-screen flex-col bg-[var(--color-bg)]">
      <AppHeader
        current="builder"
        title="Flow Builder"
        subtitle="Design and publish OpenClaw automations from one canvas."
      />

      <FlowBar />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1">
          <Canvas />
        </div>
        <RunInspector />
      </div>
    </div>
  );
}
