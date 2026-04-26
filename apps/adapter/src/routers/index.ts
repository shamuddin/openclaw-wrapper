import { router } from '../trpc.js';
import { authRouter } from './auth.js';
import { automationRouter } from './automation.js';
import { channelsRouter } from './channels.js';
import { cronRouter } from './cron.js';
import { flowsRouter } from './flows.js';
import { gatewayRouter } from './gateway.js';
import { memoryRouter } from './memory.js';
import { nodesRouter } from './nodes.js';
import { opsRouter } from './ops.js';
import { pingRouter } from './ping.js';
import { runsRouter } from './runs.js';
import { skillsRouter } from './skills.js';
import { workspacesRouter } from './workspaces.js';

export const appRouter = router({
  automation: automationRouter,
  auth: authRouter,
  ping: pingRouter,
  gateway: gatewayRouter,
  memory: memoryRouter,
  ops: opsRouter,
  workspaces: workspacesRouter,
  channels: channelsRouter,
  cron: cronRouter,
  flows: flowsRouter,
  runs: runsRouter,
  nodes: nodesRouter,
  skills: skillsRouter,
});

export type AppRouter = typeof appRouter;
