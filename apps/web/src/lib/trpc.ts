import type { AppRouter } from '@openclaw-wrapper/adapter/router';
import { createTRPCReact } from '@trpc/react-query';

export const trpc = createTRPCReact<AppRouter>();
