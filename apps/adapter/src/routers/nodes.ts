import { GraphEdge, GraphNode } from '@openclaw-wrapper/schemas';
import { type Static, Type } from '@sinclair/typebox';
import { TRPCError } from '@trpc/server';
import { listChannelProfilePrefillData } from '../channel-profiles.js';
import { NODE_CATALOG, buildNodeCatalog } from '../node-catalog.js';
import { loadOpenClawNodePrefillContext, runOpenClawAgent } from '../openclaw.js';
import { loadInstalledPluginCatalog } from '../plugin-catalog.js';
import { router, workspaceProcedure } from '../trpc.js';
import { parse } from '../validate.js';

const DesignWebhookPayloadInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  flowId: Type.Optional(Type.String({ minLength: 1 })),
  flowName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  nodes: Type.Array(GraphNode),
  edges: Type.Array(GraphEdge),
});

type DesignWebhookPayloadInput = Static<typeof DesignWebhookPayloadInput>;

function getConnectedDownstreamGraph(input: DesignWebhookPayloadInput): {
  selectedNode: DesignWebhookPayloadInput['nodes'][number];
  nodes: DesignWebhookPayloadInput['nodes'];
  edges: DesignWebhookPayloadInput['edges'];
} {
  const selectedNode = input.nodes.find((node) => node.id === input.nodeId);
  if (!selectedNode) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected node was not found in the submitted graph',
    });
  }

  const includedNodeIds = new Set([selectedNode.id]);
  const includedEdgeIds = new Set<string>();
  const queue = [selectedNode.id];

  while (queue.length > 0) {
    const sourceId = queue.shift();
    if (!sourceId) continue;

    for (const edge of input.edges) {
      if (edge.source !== sourceId) continue;
      includedEdgeIds.add(edge.id);
      if (!includedNodeIds.has(edge.target)) {
        includedNodeIds.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  return {
    selectedNode,
    nodes: input.nodes.filter((node) => includedNodeIds.has(node.id)),
    edges: input.edges.filter((edge) => includedEdgeIds.has(edge.id)),
  };
}

function pickPayloadAgentId(nodes: DesignWebhookPayloadInput['nodes']): string {
  const agentNode = nodes.find((node) => node.type === 'action.agent');
  const agentId = agentNode?.data.agentId;
  return typeof agentId === 'string' && agentId.trim().length > 0 ? agentId.trim() : 'main';
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to object-boundary extraction.
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // The typed error below gives the UI a clearer failure message.
    }
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'OpenClaw did not return a valid JSON object payload',
  });
}

function buildWebhookPayloadDesignPrompt(params: {
  flowName?: string;
  selectedNode: DesignWebhookPayloadInput['nodes'][number];
  nodes: DesignWebhookPayloadInput['nodes'];
  edges: DesignWebhookPayloadInput['edges'];
}): string {
  const currentPayloadTemplate =
    typeof params.selectedNode.data.payloadTemplate === 'string'
      ? params.selectedNode.data.payloadTemplate
      : undefined;
  const userInstructions =
    typeof params.selectedNode.data.payloadDesignInstructions === 'string'
      ? params.selectedNode.data.payloadDesignInstructions.trim()
      : '';

  return [
    'Design a sample JSON request body for a webhook trigger in an OpenClaw flow builder.',
    'Infer the payload keys from the selected webhook node and the downstream linked nodes.',
    userInstructions
      ? 'Follow the user payload instructions as the highest priority when choosing fields and values.'
      : '',
    'Return ONLY one valid JSON object. Do not include markdown, comments, prose, arrays, or code fences.',
    'Use realistic placeholder values. Keep it minimal but complete enough for the downstream nodes to run.',
    'Prefer stable fields that callers can send, such as url, videoUrl, videoId, message, query, title, text, or metadata when they are clearly useful.',
    'Do not include API keys, secrets, auth tokens, cookies, passwords, or private profile IDs.',
    '',
    `Flow name: ${params.flowName ?? 'Untitled flow'}`,
    userInstructions ? `User payload instructions: ${userInstructions}` : '',
    `Selected webhook node: ${JSON.stringify(params.selectedNode, null, 2)}`,
    currentPayloadTemplate ? `Current designed payload template: ${currentPayloadTemplate}` : '',
    `Downstream connected graph: ${JSON.stringify(
      {
        nodes: params.nodes,
        edges: params.edges,
      },
      null,
      2,
    )}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

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

  designWebhookPayload: workspaceProcedure
    .input(parse(DesignWebhookPayloadInput))
    .mutation(async ({ ctx, input }) => {
      const downstreamGraph = getConnectedDownstreamGraph(input);
      const agentId = pickPayloadAgentId(downstreamGraph.nodes);
      const result = await runOpenClawAgent(
        {
          agentId,
          sessionKey: `builder:payload-design:${ctx.workspace.id}:${input.nodeId}`,
          idempotencyKey: `payload-design:${input.flowId ?? 'draft'}:${input.nodeId}:${Date.now()}`,
          message: buildWebhookPayloadDesignPrompt({
            flowName: input.flowName,
            selectedNode: downstreamGraph.selectedNode,
            nodes: downstreamGraph.nodes,
            edges: downstreamGraph.edges,
          }),
          extraSystemPrompt:
            'You are a precise API payload designer. Return only valid JSON objects for webhook request bodies.',
          timeoutMs: 45_000,
        },
        ctx.openclaw,
      );

      const replyText = result.replyText?.trim();
      if (!replyText) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: 'OpenClaw returned an empty payload suggestion',
        });
      }

      const payload = extractJsonObject(replyText);
      return {
        payload,
        payloadText: JSON.stringify(payload, null, 2),
        agentId,
        runId: result.runId,
      };
    }),
});
