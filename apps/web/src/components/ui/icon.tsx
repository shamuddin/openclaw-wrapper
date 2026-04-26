'use client';

import { cn } from '@/lib/utils';
import {
  ArrowLeftRight,
  Bot,
  ChartBar,
  Circle,
  Clock,
  Database,
  FileText,
  GitBranch,
  Globe,
  type LucideIcon,
  MessageCircle,
  Monitor,
  Network,
  Pause,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Webhook,
  Zap,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  ArrowRightLeft: ArrowLeftRight,
  ArrowLeftRight,
  Bot,
  ChartColumn: ChartBar,
  ChartBar,
  Clock3: Clock,
  Clock,
  Database,
  FileText,
  GitBranch,
  Globe,
  Hook: Zap,
  Zap,
  Link2: Network,
  Network,
  MessageCircle,
  Monitor,
  PauseCircle: Pause,
  Pause,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  TerminalSquare: FileText,
  Webhook,
};

export function AppIcon({
  name,
  className,
  strokeWidth = 1.8,
}: {
  name?: string | null;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = (name && ICONS[name]) || Circle;
  return <Icon className={cn('h-4 w-4 shrink-0', className)} strokeWidth={strokeWidth} />;
}
