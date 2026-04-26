import { listChannelProfilePrefillData } from '../channel-profiles.js';
import { NODE_CATALOG, buildNodeCatalog } from '../node-catalog.js';
import { loadOpenClawNodePrefillContext } from '../openclaw.js';
import { loadInstalledPluginCatalog } from '../plugin-catalog.js';
import { router, workspaceProcedure } from '../trpc.js';

export const nodesRouter = router({
  catalog: workspaceProcedure.query(async ({ ctx }) => {
    const [prefill, channelProfiles, pluginCatalog] = await Promise.all([
      loadOpenClawNodePrefillContext().catch(() => undefined),
      listChannelProfilePrefillData(ctx.db, ctx.workspace.id).catch(() => ({
        options: [],
        preferredProfileId: undefined,
      })),
      loadInstalledPluginCatalog({
        reservedNodeTypes: NODE_CATALOG.nodes.map((node) => node.type),
        warn: (issue) => {
          console.warn(
            `[plugin-catalog${issue.code ? `:${issue.code}` : ''}] ${issue.pluginPath}${issue.fieldPath ? ` (${issue.fieldPath})` : ''}: ${issue.message}${issue.hint ? ` Hint: ${issue.hint}` : ''}`,
          );
        },
      }).catch(() => ({
        plugins: [],
        nodes: [],
        issues: [],
      })),
    ]);

    return buildNodeCatalog(
      prefill
        ? {
            ...prefill,
            channelProfileOptions: channelProfiles.options,
            preferredChannelProfileId: channelProfiles.preferredProfileId,
          }
        : {
            defaultAgentId: 'main',
            agentOptions: [{ label: 'Main (main)', value: 'main' }],
            skillOptions: [],
            modelProviderOptions: [],
            modelOptions: [],
            channelOptions: [],
            channelProfileOptions: channelProfiles.options,
            preferredChannelProfileId: channelProfiles.preferredProfileId,
          },
      ctx.workspace.execPolicy,
      pluginCatalog.nodes,
      prefill
        ? { gatewayConnected: true }
        : {
            gatewayConnected: false,
            gatewayMessage:
              'OpenClaw gateway is not connected or did not respond. You can still build and run local wrapper-only flows, but gateway-backed agents, channels, hooks, cron, and runtime pairing need a connected gateway.',
          },
    );
  }),
});
