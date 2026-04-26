import { ChannelsWorkspace } from '@/channels/ChannelsWorkspace';
import { AppHeader } from '@/components/AppHeader';

export default function ChannelsPage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)]">
      <AppHeader
        current="channels"
        title="Channels"
        subtitle="Manage live runtime channels/devices, pairing, and wrapper-owned channel profiles."
      />
      <ChannelsWorkspace />
    </div>
  );
}
