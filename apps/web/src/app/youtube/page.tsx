import { AppHeader } from '@/components/AppHeader';
import { YouTubeWorkspace } from '@/youtube/YouTubeWorkspace';

export default function YouTubePage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)]">
      <AppHeader
        current="youtube"
        title="YouTube"
        subtitle="Monitor production channel uploads, transcripts, and article automation."
      />
      <YouTubeWorkspace />
    </div>
  );
}
