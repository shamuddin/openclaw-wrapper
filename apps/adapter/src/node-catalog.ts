import type {
  NodeCatalog,
  NodeConfigFieldDescriptor,
  NodeConfigOption,
  NodeTypeDescriptor,
  WorkspaceExecPolicy,
} from '@openclaw-wrapper/schemas';
import type { OpenClawNodePrefillContext } from './openclaw.js';
import { normalizeWorkspaceExecPolicy, resolveExecRuntimePolicy } from './system-exec.js';

const GATEWAY_UNAVAILABLE_NODE_TYPES = new Set([
  'trigger.channel',
  'trigger.cron',
  'trigger.hook',
  'trigger.task',
  'trigger.standing-order',
]);

const OFFLINE_FALLBACK_NODE_TYPES = new Set([
  'action.agent',
  'action.skill',
  'action.agent-send',
  'action.channel-reply',
  'action.channel-route',
]);

export const NODE_CATALOG: NodeCatalog = {
  categories: [
    {
      key: 'triggers',
      label: 'Triggers',
      description: 'How a flow starts in response to events and schedules.',
      accent: 'oklch(0.72 0.18 30)',
    },
    {
      key: 'ai',
      label: 'AI',
      description: 'OpenClaw-native agents, skills, and coordination steps.',
      accent: 'oklch(0.74 0.2 340)',
    },
    {
      key: 'tools',
      label: 'Tools',
      description: 'Execution and retrieval capabilities exposed to flows.',
      accent: 'oklch(0.73 0.18 210)',
    },
    {
      key: 'channels',
      label: 'Channels',
      description: 'Messaging, routing, and reply behavior across OpenClaw channels.',
      accent: 'oklch(0.75 0.16 150)',
    },
    {
      key: 'control',
      label: 'Control',
      description: 'Branching, waits, approvals, and orchestration logic.',
      accent: 'oklch(0.79 0.16 110)',
    },
    {
      key: 'context',
      label: 'Context',
      description: 'Session, memory, and thread-binding operations.',
      accent: 'oklch(0.71 0.12 290)',
    },
    {
      key: 'ops',
      label: 'Ops',
      description: 'Logging, usage, and operational visibility inside a run.',
      accent: 'oklch(0.74 0.03 260)',
    },
  ],
  nodes: [
    {
      type: 'trigger.webhook',
      label: 'Webhook',
      category: 'triggers',
      source: 'wrapper-core',
      description: 'Starts a run when an HTTP request arrives at the adapter.',
      icon: 'Webhook',
      availability: {
        status: 'supported',
        note: 'Available now through the adapter webhook entrypoint.',
      },
      inputs: [],
      outputs: [{ name: 'out', label: 'Payload', dataType: 'object' }],
      defaults: {
        eventName: '',
        notes: '',
      },
      fields: [
        {
          key: 'eventName',
          label: 'Event name',
          type: 'text',
          placeholder: 'customer.message.received',
          description: 'Optional event key used to match inbound webhook payloads.',
        },
        {
          key: 'notes',
          label: 'Notes',
          type: 'textarea',
          placeholder: 'Describe what this webhook is expected to receive.',
        },
      ],
    },
    {
      type: 'trigger.channel',
      label: 'Channel Message',
      category: 'triggers',
      source: 'openclaw-native',
      description: 'Starts a run when a live OpenClaw channel receives a message.',
      icon: 'MessageCircle',
      availability: {
        status: 'supported',
        note: 'Available now through the adapter channel event entrypoint for published flows.',
      },
      inputs: [],
      outputs: [{ name: 'out', label: 'Inbound message', dataType: 'object' }],
      defaults: {
        channelType: '',
        routeKey: '',
        messagePattern: '',
      },
      fields: [
        {
          key: 'channelType',
          label: 'Channel',
          type: 'select',
          placeholder: 'Select discovered channel',
          options: [],
        },
        {
          key: 'routeKey',
          label: 'Route key',
          type: 'text',
          placeholder: 'support.inbox',
          description: 'Optional route or channel binding inside OpenClaw.',
        },
        {
          key: 'messagePattern',
          label: 'Message filter',
          type: 'text',
          placeholder: 'refund',
          description: 'Optional keyword or matcher used before the flow starts.',
        },
      ],
    },
    {
      type: 'trigger.cron',
      label: 'Cron Schedule',
      category: 'triggers',
      source: 'openclaw-native',
      description: 'Starts a run on an OpenClaw-backed cron schedule.',
      icon: 'Clock3',
      availability: {
        status: 'supported',
        note: 'Available now through the adapter cron scheduler and manual cron event entrypoint.',
      },
      inputs: [],
      outputs: [{ name: 'out', label: 'Schedule payload', dataType: 'object' }],
      defaults: {
        enabled: true,
        description: '',
        scheduleKind: 'cron',
        schedule: '0 * * * *',
        timezone: 'Asia/Kolkata',
        everyAmount: '30',
        everyUnit: 'minutes',
        runAt: '',
        deleteAfterRun: false,
        deliveryMode: 'none',
        deliveryChannel: '',
        deliveryTo: '',
        deliveryAccountId: '',
        deliveryBestEffort: false,
        failureAlertEnabled: false,
        failureAlertAfter: '3',
        failureAlertCooldownSeconds: '3600',
        failureAlertMode: 'announce',
        failureAlertChannel: '',
        failureAlertTo: '',
        failureAlertAccountId: '',
        executionKind: 'flowTrigger',
        agentId: 'main',
        sessionTarget: 'isolated',
        sessionKey: '',
        wakeMode: 'now',
        clearAgent: false,
        timeoutSeconds: '',
        assistantPrompt: 'Run the scheduled task and summarize what changed.',
        systemEventText: 'Scheduled wakeup from this cron trigger.',
        lightContext: false,
        model: '',
        thinking: '',
        fallbacks: '',
        toolsAllow: '',
        allowUnsafeExternalContent: false,
      },
      fields: [
        {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean',
          description: 'Pause this schedule without deleting the trigger from the flow.',
        },
        {
          key: 'description',
          label: 'Description',
          type: 'textarea',
          placeholder: 'Optional context for what this scheduled flow is responsible for.',
        },
        {
          key: 'scheduleKind',
          label: 'Schedule type',
          type: 'select',
          description:
            'Choose whether this flow runs from a cron expression, a repeating interval, or a one-time timestamp.',
          options: [
            { label: 'Cron expression', value: 'cron' },
            { label: 'Every interval', value: 'every' },
            { label: 'Run once at', value: 'at' },
          ],
        },
        {
          key: 'schedule',
          label: 'Cron expression',
          type: 'text',
          placeholder: '*/15 * * * *',
          description: 'Five fields: minute hour day month weekday.',
          visibleWhen: [{ key: 'scheduleKind', operator: 'equals', value: 'cron' }],
        },
        {
          key: 'timezone',
          label: 'Timezone',
          type: 'text',
          placeholder: 'Asia/Kolkata',
          visibleWhen: [{ key: 'scheduleKind', operator: 'equals', value: 'cron' }],
        },
        {
          key: 'everyAmount',
          label: 'Every',
          type: 'text',
          placeholder: '30',
          description: 'Whole-number interval greater than 0.',
          visibleWhen: [{ key: 'scheduleKind', operator: 'equals', value: 'every' }],
        },
        {
          key: 'everyUnit',
          label: 'Unit',
          type: 'select',
          visibleWhen: [{ key: 'scheduleKind', operator: 'equals', value: 'every' }],
          options: [
            { label: 'Minutes', value: 'minutes' },
            { label: 'Hours', value: 'hours' },
            { label: 'Days', value: 'days' },
          ],
        },
        {
          key: 'runAt',
          label: 'Run at',
          type: 'text',
          placeholder: '2026-04-27T09:00:00+05:30',
          description: 'Use an ISO date-time with timezone offset for one-time schedules.',
          visibleWhen: [{ key: 'scheduleKind', operator: 'equals', value: 'at' }],
        },
        {
          key: 'deleteAfterRun',
          label: 'Delete after run',
          type: 'boolean',
          description:
            'After a successful run, pause this schedule automatically. One-time schedules already stop after they fire.',
        },
      ],
    },
    {
      type: 'trigger.hook',
      label: 'Hook',
      category: 'triggers',
      source: 'openclaw-native',
      description: 'Starts a run from an OpenClaw hook event.',
      icon: 'Hook',
      availability: {
        status: 'supported',
        note: 'Available now through the adapter hook event entrypoint for published flows.',
      },
      inputs: [],
      outputs: [{ name: 'out', label: 'Hook payload', dataType: 'object' }],
      defaults: {
        hookName: '',
        filter: '',
      },
      fields: [
        {
          key: 'hookName',
          label: 'Hook name',
          type: 'text',
          placeholder: 'gmail.message.received',
        },
        {
          key: 'filter',
          label: 'Filter',
          type: 'text',
          placeholder: 'label:support',
        },
      ],
    },
    {
      type: 'trigger.task',
      label: 'Task',
      category: 'triggers',
      source: 'openclaw-native',
      description: 'Starts a run from a task queue event or queued work item.',
      icon: 'ListTodo',
      availability: {
        status: 'supported',
        note: 'Available now through task event entrypoints and builder sample runs for published flows.',
      },
      inputs: [],
      outputs: [{ name: 'out', label: 'Task payload', dataType: 'object' }],
      defaults: {
        taskType: '',
        taskQueue: '',
        taskPriority: '',
      },
      fields: [
        {
          key: 'taskType',
          label: 'Task type',
          type: 'text',
          placeholder: 'inbox-triage',
        },
        {
          key: 'taskQueue',
          label: 'Queue',
          type: 'text',
          placeholder: 'ops',
          description: 'Optional queue or lane name used to route the task.',
        },
        {
          key: 'taskPriority',
          label: 'Priority',
          type: 'select',
          options: [
            { label: 'Low', value: 'low' },
            { label: 'Normal', value: 'normal' },
            { label: 'High', value: 'high' },
            { label: 'Urgent', value: 'urgent' },
          ],
          description: 'Optional priority gate for matching incoming task events.',
        },
      ],
    },
    {
      type: 'trigger.standing-order',
      label: 'Standing Order',
      category: 'triggers',
      source: 'openclaw-native',
      description: 'Starts a run from a standing-order program or recurring delegate instruction.',
      icon: 'Repeat2',
      availability: {
        status: 'supported',
        note: 'Available now through standing-order event entrypoints and builder sample runs for published flows.',
      },
      inputs: [],
      outputs: [{ name: 'out', label: 'Standing-order payload', dataType: 'object' }],
      defaults: {
        standingOrderKey: '',
        standingOrderScope: '',
      },
      fields: [
        {
          key: 'standingOrderKey',
          label: 'Standing-order key',
          type: 'text',
          placeholder: 'daily-inbox-triage',
        },
        {
          key: 'standingOrderScope',
          label: 'Scope',
          type: 'text',
          placeholder: 'support',
          description: 'Optional team, tenant, or program scope for the standing order.',
        },
      ],
    },
    {
      type: 'action.agent',
      label: 'Run Agent',
      category: 'ai',
      source: 'openclaw-native',
      description: 'Calls an OpenClaw agent and returns its structured output.',
      icon: 'Bot',
      availability: {
        status: 'supported',
        note: 'Available now through the OpenClaw gateway using agent + agent.wait.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Agent result', dataType: 'object' }],
      defaults: {
        agentId: '',
        instructions: '',
        modelProvider: '',
        modelOverride: '',
        sessionKey: '',
        waitTimeoutMs: '30000',
      },
      fields: [
        {
          key: 'agentId',
          label: 'Agent ID',
          type: 'text',
          placeholder: 'intake-agent',
        },
        {
          key: 'instructions',
          label: 'Run instructions',
          type: 'textarea',
          placeholder: 'Classify the conversation and return a concise routing decision.',
        },
        {
          key: 'modelProvider',
          label: 'Model provider',
          type: 'select',
          placeholder: 'Use agent default provider',
          options: [],
          description: 'Optional provider filter for the model list.',
        },
        {
          key: 'modelOverride',
          label: 'Model',
          type: 'select',
          placeholder: 'Use agent default model',
          options: [],
          description: 'Optional model override. Choose a provider first to narrow the list.',
        },
        {
          key: 'sessionKey',
          label: 'Session key',
          type: 'text',
          placeholder: 'agent:intake:whatsapp:customer-123',
          description:
            'Optional fixed OpenClaw session key. Leave blank to generate a run-scoped session.',
        },
        {
          key: 'waitTimeoutMs',
          label: 'Wait timeout (ms)',
          type: 'text',
          placeholder: '30000',
          description: 'How long the wrapper waits for the agent run to finish.',
        },
      ],
    },
    {
      type: 'action.skill',
      label: 'Run Skill',
      category: 'ai',
      source: 'openclaw-native',
      description: 'Invokes a named OpenClaw skill with the current payload.',
      icon: 'Sparkles',
      availability: {
        status: 'supported',
        note: 'Available now through OpenClaw sessions.create + sessions.send.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Skill result', dataType: 'object' }],
      defaults: {
        skillName: '',
        agentId: '',
        inputTemplate: '',
        modelProvider: '',
        modelOverride: '',
        sessionKey: '',
        waitTimeoutMs: '30000',
      },
      fields: [
        {
          key: 'skillName',
          label: 'Skill name',
          type: 'text',
          placeholder: 'finance/refund-triage',
        },
        {
          key: 'agentId',
          label: 'Agent ID',
          type: 'text',
          placeholder: 'main',
          description: 'Optional agent scope used to resolve skills and create the session.',
        },
        {
          key: 'inputTemplate',
          label: 'Input template',
          type: 'textarea',
          placeholder: '{{input.message}}',
          description:
            'Optional template. Use {{input}} for the whole payload or {{input.path}} for a nested field.',
        },
        {
          key: 'modelProvider',
          label: 'Model provider',
          type: 'select',
          placeholder: 'Use agent default provider',
          options: [],
          description: 'Optional provider filter for the skill model list.',
        },
        {
          key: 'modelOverride',
          label: 'Model',
          type: 'select',
          placeholder: 'Use agent default model',
          options: [],
          description:
            'Optional model override for the skill session. Choose a provider first to narrow the list.',
        },
        {
          key: 'sessionKey',
          label: 'Session key',
          type: 'text',
          placeholder: 'skill:main:refund_triage:customer-123',
          description:
            'Optional fixed OpenClaw session key. Leave blank to generate a run-scoped session.',
        },
        {
          key: 'waitTimeoutMs',
          label: 'Wait timeout (ms)',
          type: 'text',
          placeholder: '30000',
          description: 'How long the wrapper waits for the skill run to finish.',
        },
      ],
    },
    {
      type: 'action.agent-send',
      label: 'Send To Agent',
      category: 'ai',
      source: 'openclaw-native',
      description: 'Hands the current state off to another agent or delegate lane.',
      icon: 'Send',
      availability: {
        status: 'supported',
        note: 'Available now through the OpenClaw gateway agent run flow with delegation-oriented defaults.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Delegation result', dataType: 'object' }],
      defaults: {
        targetAgent: '',
        handoffReason: '',
        inputTemplate: '',
        sessionKey: '',
        modelProvider: '',
        modelOverride: '',
        maxDelegationDepth: '2',
        waitTimeoutMs: '30000',
      },
      fields: [
        {
          key: 'targetAgent',
          label: 'Target agent',
          type: 'select',
          placeholder: 'Select target agent',
        },
        {
          key: 'handoffReason',
          label: 'Handoff reason',
          type: 'textarea',
          placeholder: 'Escalate refund requests over 5,000 INR.',
        },
        {
          key: 'inputTemplate',
          label: 'Input template',
          type: 'textarea',
          placeholder: '{{input.message}}',
          description:
            'Optional template for the delegated message. Leave blank to send the current payload as structured JSON context.',
        },
        {
          key: 'sessionKey',
          label: 'Session key',
          type: 'text',
          placeholder: 'agent:finance:handoff:customer-123',
          description:
            'Optional fixed target-agent session key. Leave blank to generate a run-scoped handoff session.',
        },
        {
          key: 'modelProvider',
          label: 'Model provider',
          type: 'select',
          placeholder: 'Use agent default provider',
          options: [],
          description: 'Optional provider filter for delegated model choices.',
        },
        {
          key: 'modelOverride',
          label: 'Model',
          type: 'select',
          placeholder: 'Use agent default model',
          options: [],
          description:
            'Optional model override for the delegated agent turn. Choose a provider first to narrow the list.',
        },
        {
          key: 'maxDelegationDepth',
          label: 'Max delegation depth',
          type: 'text',
          placeholder: '2',
          description:
            'Safety cap for nested agent handoffs. Delegations deeper than this are blocked.',
        },
        {
          key: 'waitTimeoutMs',
          label: 'Wait timeout (ms)',
          type: 'text',
          placeholder: '30000',
          description: 'How long the wrapper waits for the delegated agent turn to finish.',
        },
      ],
    },
    {
      type: 'action.http',
      label: 'HTTP Request',
      category: 'tools',
      source: 'wrapper-core',
      description: 'Sends an HTTP request to any URL.',
      icon: 'Globe',
      availability: {
        status: 'supported',
        note: 'Available now through the adapter runtime with templated request/response handling.',
      },
      capabilities: [
        {
          label: 'Templated requests',
          detail:
            'Supports method, URL, headers, and body templates driven by the current flow payload.',
          tone: 'supported',
        },
        {
          label: 'Structured response parsing',
          detail:
            'Can return auto, JSON, or text responses with timeout and non-2xx handling controls.',
          tone: 'supported',
        },
        {
          label: 'HTTP only',
          detail:
            'Does not emulate a browser session, follow interactive page flows, or inspect DOM content.',
          tone: 'limited',
        },
      ],
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Response', dataType: 'object' }],
      defaults: {
        method: 'GET',
        url: '',
        headersTemplate: '',
        bodyTemplate: '',
        responseMode: 'auto',
        timeoutMs: '30000',
        failOnHttpError: true,
      },
      fields: [
        {
          key: 'method',
          label: 'HTTP method',
          type: 'select',
          options: [
            { label: 'GET', value: 'GET' },
            { label: 'POST', value: 'POST' },
            { label: 'PUT', value: 'PUT' },
            { label: 'PATCH', value: 'PATCH' },
            { label: 'DELETE', value: 'DELETE' },
          ],
        },
        {
          key: 'url',
          label: 'URL',
          type: 'text',
          placeholder: 'https://api.example.com/orders',
          description: 'Supports templates like https://api.example.com/orders/{{input.orderId}}.',
        },
        {
          key: 'headersTemplate',
          label: 'Headers JSON',
          type: 'textarea',
          placeholder: '{"Authorization":"Bearer {{input.token}}"}',
          description:
            'Optional JSON object. Values may contain templates and are rendered before the request is sent.',
        },
        {
          key: 'bodyTemplate',
          label: 'Body template',
          type: 'textarea',
          placeholder: '{"message":"{{input.text}}"}',
          description:
            'Optional request body. JSON stays JSON; plain text is sent as-is after template rendering.',
        },
        {
          key: 'responseMode',
          label: 'Response parsing',
          type: 'select',
          options: [
            { label: 'Auto', value: 'auto' },
            { label: 'JSON', value: 'json' },
            { label: 'Text', value: 'text' },
          ],
        },
        {
          key: 'timeoutMs',
          label: 'Timeout (ms)',
          type: 'text',
          placeholder: '30000',
          description: 'How long to wait before the request is aborted.',
        },
        {
          key: 'failOnHttpError',
          label: 'Fail on non-2xx',
          type: 'boolean',
          description: 'When enabled, 4xx/5xx responses fail the run instead of flowing onward.',
        },
      ],
    },
    {
      type: 'tool.browser',
      label: 'Browser Lite',
      category: 'tools',
      source: 'openclaw-native',
      description:
        'Fetches pages, extracts lightweight content, and follows links through an HTTP-backed browser-lite step.',
      icon: 'Monitor',
      availability: {
        status: 'supported',
        note: 'Available now for open, extract, and click-lite flows. This step does not run a full JavaScript browser session.',
      },
      capabilities: [
        {
          label: 'Open public pages',
          detail:
            'Fetches HTML over HTTP and returns page metadata, link previews, and text snippets.',
          tone: 'supported',
        },
        {
          label: 'Structured extract modes',
          detail:
            'Supports text, HTML preview, headings, JSON-LD, metadata, meta tags, links, and direct link extraction.',
          tone: 'supported',
        },
        {
          label: 'Click-lite navigation',
          detail:
            'Follows discovered links by text:, href:, exact:text:, exact:href:, or index: hints after the initial page load.',
          tone: 'limited',
        },
        {
          label: 'No JavaScript session',
          detail:
            'Does not run a live browser tab, execute JS, fill forms, or preserve interactive state.',
          tone: 'warning',
        },
      ],
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Browser result', dataType: 'object' }],
      defaults: {
        action: 'open',
        target: '',
        extractMode: 'text',
        clickHint: '',
        waitFor: '',
        timeoutMs: '30000',
      },
      fields: [
        {
          key: 'action',
          label: 'Action',
          type: 'select',
          options: [
            { label: 'Open page', value: 'open' },
            { label: 'Extract', value: 'extract' },
            { label: 'Click', value: 'click' },
          ],
        },
        {
          key: 'target',
          label: 'Target',
          type: 'text',
          placeholder: 'https://example.com',
          description: 'Page URL to open first before extracting content or following a link.',
        },
        {
          key: 'extractMode',
          label: 'Extract mode',
          type: 'select',
          options: [
            { label: 'Page text', value: 'text' },
            { label: 'HTML preview', value: 'html' },
            { label: 'Title', value: 'title' },
            { label: 'Headings outline', value: 'headings' },
            { label: 'JSON-LD', value: 'jsonld' },
            { label: 'Metadata bundle', value: 'metadata' },
            { label: 'Meta description', value: 'meta:description' },
            { label: 'Open Graph title', value: 'meta:og:title' },
            { label: 'Open Graph description', value: 'meta:og:description' },
            { label: 'Links', value: 'links' },
          ],
          description:
            'Choose the lightweight page value to return. JSON-LD and headings are useful for article and product pages.',
          visibleWhen: [
            {
              key: 'action',
              operator: 'equals',
              value: 'extract',
            },
          ],
        },
        {
          key: 'clickHint',
          label: 'Click hint',
          type: 'text',
          placeholder: 'text:Docs, href:/pricing, exact:text:Pricing, or index:1',
          description:
            'Use a link hint like text:Docs, href:/pricing, exact:text:Pricing, exact:href:https://..., or index:1 to choose which discovered link to follow.',
          visibleWhen: [
            {
              key: 'action',
              operator: 'equals',
              value: 'click',
            },
          ],
        },
        {
          key: 'waitFor',
          label: 'Legacy selector',
          type: 'text',
          placeholder: 'text, title, meta:description, links, or text:Docs',
          description:
            'Back-compat field for older flows. New browser-lite steps should use Extract mode or Click hint instead.',
          visibleWhen: [
            {
              key: 'action',
              operator: 'equals',
              value: '__legacy__',
            },
          ],
        },
        {
          key: 'timeoutMs',
          label: 'Timeout (ms)',
          type: 'text',
          placeholder: '30000',
        },
      ],
    },
    {
      type: 'tool.web-search',
      label: 'Web Search',
      category: 'tools',
      source: 'openclaw-native',
      description: 'Runs a web search provider for live web lookup and result extraction.',
      icon: 'Search',
      availability: {
        status: 'supported',
        note: 'Available now with DuckDuckGo by default and optional Brave, Tavily, or Perplexity API keys.',
      },
      capabilities: [
        {
          label: 'Live web lookup',
          detail:
            'Queries a configured provider at run time instead of relying on stale embedded knowledge.',
          tone: 'supported',
        },
        {
          label: 'Provider-aware behavior',
          detail:
            'DuckDuckGo works by default; Brave, Tavily, and Perplexity require adapter API keys.',
          tone: 'supported',
        },
        {
          label: 'Result retrieval only',
          detail:
            'Returns search results and snippets; use Browser Lite if you need follow-up page extraction.',
          tone: 'limited',
        },
        {
          label: 'Follow-up ready output modes',
          detail:
            'Can emit the full results payload, the top result object, or just the top result URL for easier chaining.',
          tone: 'supported',
        },
      ],
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Search result', dataType: 'object' }],
      defaults: {
        provider: 'duckduckgo',
        query: '',
        limit: '5',
        outputMode: 'results',
      },
      fields: [
        {
          key: 'provider',
          label: 'Provider',
          type: 'select',
          options: [
            { label: 'Brave', value: 'brave' },
            { label: 'DuckDuckGo', value: 'duckduckgo' },
            { label: 'Tavily', value: 'tavily' },
            { label: 'Perplexity', value: 'perplexity' },
          ],
          description:
            'DuckDuckGo works without a key. Brave, Tavily, and Perplexity require adapter API keys.',
        },
        {
          key: 'query',
          label: 'Query',
          type: 'text',
          placeholder: 'customer refund policy',
        },
        {
          key: 'limit',
          label: 'Result limit',
          type: 'text',
          placeholder: '5',
        },
        {
          key: 'outputMode',
          label: 'Output mode',
          type: 'select',
          options: [
            { label: 'Full results payload', value: 'results' },
            { label: 'Top result object', value: 'top-result' },
            { label: 'Top result URL', value: 'top-result-url' },
          ],
          description:
            'Use Top result URL to feed Browser Lite directly with {{input}} in the next step.',
        },
      ],
    },
    {
      type: 'tool.exec',
      label: 'Exec',
      category: 'tools',
      source: 'openclaw-native',
      description: 'Runs a shell command from the adapter with approval-aware flow policy.',
      icon: 'TerminalSquare',
      availability: {
        status: 'supported',
        note: 'Available now. Ask and Require elevated create a runtime approval request before execution. Require elevated records elevated intent, but execution still happens under the adapter account.',
      },
      capabilities: [
        {
          label: 'Policy-aware shell execution',
          detail:
            'Runs adapter-local commands with timeout handling and structured stdout/stderr capture.',
          tone: 'supported',
        },
        {
          label: 'Approval gates',
          detail:
            'Ask and Require elevated can pause the run for approval before the command executes.',
          tone: 'supported',
        },
        {
          label: 'No OS privilege escalation',
          detail:
            'Require elevated records intent and approval state, but does not grant real OS admin rights.',
          tone: 'warning',
        },
      ],
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Exec result', dataType: 'object' }],
      defaults: {
        command: '',
        approvalMode: 'ask',
        approvalTimeoutSeconds: '300',
        timeoutMs: '30000',
      },
      fields: [
        {
          key: 'command',
          label: 'Command',
          type: 'textarea',
          placeholder: 'pnpm test',
        },
        {
          key: 'approvalMode',
          label: 'Approval mode',
          type: 'select',
          options: [
            { label: 'Ask', value: 'ask' },
            { label: 'Require elevated', value: 'elevated' },
            { label: 'Trusted', value: 'trusted' },
          ],
          description:
            'Ask and Require elevated pause for human approval before execution. Require elevated does not grant OS-level privileges by itself.',
        },
        {
          key: 'approvalTimeoutSeconds',
          label: 'Approval timeout (seconds)',
          type: 'text',
          placeholder: '300',
          description: 'How long the run waits for exec approval before timing out.',
        },
        {
          key: 'timeoutMs',
          label: 'Timeout (ms)',
          type: 'text',
          placeholder: '30000',
        },
      ],
    },
    {
      type: 'tool.payload-template',
      label: 'Shape Payload',
      category: 'tools',
      source: 'wrapper-core',
      description:
        'Builds a smaller or better-structured payload from templates before passing it onward.',
      icon: 'WandSparkles',
      availability: {
        status: 'supported',
        note: 'Available now in the adapter runtime for replace, merge, and assign-path payload shaping.',
      },
      capabilities: [
        {
          label: 'Structured templating',
          detail:
            'Can render strings, exact path references, JSON objects, arrays, numbers, and booleans from the current payload.',
          tone: 'supported',
        },
        {
          label: 'Replace, merge, or assign',
          detail:
            'Either replace the payload completely, merge a shaped object into it, or assign the shaped value to a nested path.',
          tone: 'supported',
        },
        {
          label: 'Flow-local only',
          detail:
            'Shapes the payload for downstream nodes but does not persist state outside the current run unless a later node stores it.',
          tone: 'limited',
        },
      ],
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Shaped payload', dataType: 'any' }],
      defaults: {
        template: '{{input}}',
        outputMode: 'replace',
        outputPath: '',
      },
      fields: [
        {
          key: 'template',
          label: 'Template',
          type: 'textarea',
          placeholder: '{"title":"{{topResult.title}}","url":"{{topResult.url}}"}',
          description:
            'Use an exact path like {{input.topResult}} to keep structured values, or render JSON/text from the current payload.',
        },
        {
          key: 'outputMode',
          label: 'Output mode',
          type: 'select',
          options: [
            { label: 'Replace payload', value: 'replace' },
            { label: 'Merge into payload', value: 'merge' },
            { label: 'Assign to path', value: 'assign' },
          ],
        },
        {
          key: 'outputPath',
          label: 'Output path',
          type: 'text',
          placeholder: 'browser.targetUrl',
          description:
            'Required for Assign to path. The current payload is preserved and the shaped value is written at this nested path.',
          visibleWhen: [
            {
              key: 'outputMode',
              operator: 'equals',
              value: 'assign',
            },
          ],
        },
      ],
    },
    {
      type: 'action.channel-reply',
      label: 'Channel Reply',
      category: 'channels',
      source: 'openclaw-native',
      description: 'Sends a message back through the originating OpenClaw channel.',
      icon: 'Reply',
      availability: {
        status: 'supported',
        note: 'Available now through the OpenClaw gateway send method, with optional wrapper-saved channel profiles.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Delivery result', dataType: 'object' }],
      defaults: {
        channelProfileId: '',
        channelType: '',
        toPath: 'to',
        threadIdPath: 'threadId',
        accountIdPath: 'accountId',
        sessionKeyPath: 'sessionKey',
        agentId: '',
        messageTemplate: '{{replyText}}',
      },
      fields: [
        {
          key: 'channelProfileId',
          label: 'Channel profile',
          type: 'select',
          placeholder: 'Use saved channel profile',
          options: [],
          description:
            'Optional wrapper-owned saved channel profile. When selected, the node can inherit channel, account, agent, and default target values.',
        },
        {
          key: 'channelType',
          label: 'Channel',
          type: 'select',
          placeholder: 'Use gateway default or select channel',
          options: [],
        },
        {
          key: 'toPath',
          label: 'Recipient path',
          type: 'text',
          placeholder: 'to',
          description:
            'Optional path to the delivery target inside the current payload. Use to or input.to. Leave blank to auto-detect.',
        },
        {
          key: 'threadIdPath',
          label: 'Thread path',
          type: 'text',
          placeholder: 'threadId',
          description:
            'Optional path to a thread id or topic id when the channel supports threaded replies. Use threadId or input.threadId.',
        },
        {
          key: 'accountIdPath',
          label: 'Account path',
          type: 'text',
          placeholder: 'accountId',
          description:
            'Optional path to the OpenClaw channel account id when multiple accounts are configured. Use accountId or input.accountId.',
        },
        {
          key: 'sessionKeyPath',
          label: 'Session path',
          type: 'text',
          placeholder: 'sessionKey',
          description:
            'Optional path to an OpenClaw session key for transcript mirroring after delivery. Use sessionKey or input.sessionKey.',
        },
        {
          key: 'agentId',
          label: 'Agent ID',
          type: 'text',
          placeholder: 'main',
          description: 'Optional agent scope used when the gateway resolves outbound context.',
        },
        {
          key: 'messageTemplate',
          label: 'Message template',
          type: 'textarea',
          placeholder: '{{replyText}}',
          description:
            'Optional template. Use {{replyText}}, {{message}}, or nested paths like {{input.replyText}}.',
        },
      ],
    },
    {
      type: 'action.channel-route',
      label: 'Channel Route',
      category: 'channels',
      source: 'openclaw-native',
      description: 'Routes or hands off a conversation to another OpenClaw channel lane.',
      icon: 'ArrowRightLeft',
      availability: {
        status: 'supported',
        note: 'Available now through wrapper-saved channel profiles or direct channel routing via the OpenClaw gateway send method.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Route result', dataType: 'object' }],
      defaults: {
        destination: '',
        threading: 'preserve',
        messageTemplate: '',
      },
      fields: [
        {
          key: 'destination',
          label: 'Destination',
          type: 'text',
          placeholder: 'profile id or channel type',
          description:
            'Prefer a saved channel profile id. When no saved profile matches, the value is treated as a raw channel type.',
        },
        {
          key: 'threading',
          label: 'Threading',
          type: 'select',
          options: [
            { label: 'Preserve thread', value: 'preserve' },
            { label: 'Start new thread', value: 'new' },
          ],
        },
        {
          key: 'messageTemplate',
          label: 'Message template',
          type: 'textarea',
          placeholder: '{{message}}',
          description:
            'Optional template. Use {{message}}, {{replyText}}, or nested paths like {{input.message}}.',
        },
      ],
    },
    {
      type: 'logic.branch',
      label: 'Branch',
      category: 'control',
      source: 'wrapper-core',
      description: 'Routes execution to one of two outputs based on a condition.',
      icon: 'GitBranch',
      availability: {
        status: 'supported',
        note: 'Available now in the local runtime.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [
        { name: 'true', label: 'True', dataType: 'any' },
        { name: 'false', label: 'False', dataType: 'any' },
      ],
      defaults: {
        branchMode: 'auto',
        fieldPath: '',
        equalsValue: '',
      },
      fields: [
        {
          key: 'branchMode',
          label: 'Decision mode',
          type: 'select',
          options: [
            { label: 'Auto detect truthy value', value: 'auto' },
            { label: 'Check field is truthy', value: 'path_truthy' },
            { label: 'Field equals value', value: 'path_equals' },
          ],
        },
        {
          key: 'fieldPath',
          label: 'Field path',
          type: 'text',
          placeholder: 'customer.intent',
          description: 'Dot path into the incoming payload.',
          visibleWhen: [
            {
              key: 'branchMode',
              operator: 'in',
              values: ['path_truthy', 'path_equals'],
            },
          ],
        },
        {
          key: 'equalsValue',
          label: 'Compare value',
          type: 'text',
          placeholder: 'refund',
          visibleWhen: [
            {
              key: 'branchMode',
              operator: 'equals',
              value: 'path_equals',
            },
          ],
        },
      ],
    },
    {
      type: 'control.approval',
      label: 'Approval',
      category: 'control',
      source: 'openclaw-native',
      description: 'Pauses execution until an approval decision is recorded.',
      icon: 'ShieldCheck',
      availability: {
        status: 'supported',
        note: 'Available now through persisted approval pause/resume controls in the adapter runtime.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [
        { name: 'approved', label: 'Approved', dataType: 'any' },
        { name: 'rejected', label: 'Rejected', dataType: 'any' },
      ],
      defaults: {
        reason: '',
        timeoutSeconds: '300',
      },
      fields: [
        {
          key: 'reason',
          label: 'Approval reason',
          type: 'textarea',
          placeholder: 'Escalate high-value refunds for human confirmation.',
        },
        {
          key: 'timeoutSeconds',
          label: 'Timeout (seconds)',
          type: 'text',
          placeholder: '300',
        },
      ],
    },
    {
      type: 'control.wait',
      label: 'Wait',
      category: 'control',
      source: 'wrapper-core',
      description: 'Pauses execution for a duration before continuing.',
      icon: 'PauseCircle',
      availability: {
        status: 'supported',
        note: 'Available now through persisted wait/resume scheduling in the adapter runtime.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Resumed payload', dataType: 'any' }],
      defaults: {
        durationSeconds: '60',
      },
      fields: [
        {
          key: 'durationSeconds',
          label: 'Duration (seconds)',
          type: 'text',
          placeholder: '60',
        },
      ],
    },
    {
      type: 'context.memory-query',
      label: 'Query Memory',
      category: 'context',
      source: 'openclaw-native',
      description:
        'Searches persisted flow, session, or thread memory and returns matching entries.',
      icon: 'DatabaseZap',
      availability: {
        status: 'supported',
        note: 'Available now through adapter-backed persisted memory queries and status lookups.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Query results', dataType: 'object' }],
      defaults: {
        namespace: 'session',
        keyPrefix: '',
        query: '',
        limit: '10',
      },
      fields: [
        {
          key: 'namespace',
          label: 'Namespace',
          type: 'select',
          options: [
            { label: 'Session', value: 'session' },
            { label: 'Long-term memory', value: 'memory' },
            { label: 'Thread', value: 'thread' },
            { label: 'All scopes', value: 'all' },
          ],
        },
        {
          key: 'keyPrefix',
          label: 'Key prefix',
          type: 'text',
          placeholder: 'customer.',
          description: 'Optional key-path prefix used before text matching.',
        },
        {
          key: 'query',
          label: 'Text query',
          type: 'text',
          placeholder: 'refund',
          description: 'Optional text matched against memory keys and values.',
        },
        {
          key: 'limit',
          label: 'Result limit',
          type: 'text',
          placeholder: '10',
        },
      ],
    },
    {
      type: 'context.memory-write',
      label: 'Write Memory',
      category: 'context',
      source: 'openclaw-native',
      description: 'Persists structured state into an OpenClaw memory surface.',
      icon: 'Database',
      availability: {
        status: 'supported',
        note: 'Available now through durable adapter-backed session, thread, and flow memory writes.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Stored payload', dataType: 'any' }],
      defaults: {
        namespace: 'session',
        key: '',
        valueTemplate: '',
      },
      fields: [
        {
          key: 'namespace',
          label: 'Namespace',
          type: 'select',
          options: [
            { label: 'Session', value: 'session' },
            { label: 'Long-term memory', value: 'memory' },
            { label: 'Thread', value: 'thread' },
          ],
        },
        {
          key: 'key',
          label: 'Key',
          type: 'text',
          placeholder: 'customer.intent',
        },
        {
          key: 'valueTemplate',
          label: 'Value template',
          type: 'textarea',
          placeholder: '{{intent}}',
        },
      ],
    },
    {
      type: 'context.thread-bind',
      label: 'Bind Thread',
      category: 'context',
      source: 'openclaw-native',
      description: 'Pins execution to an upstream thread or conversation binding.',
      icon: 'Link2',
      availability: {
        status: 'supported',
        note: 'Available now through payload thread/session binding in the adapter runtime.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Bound payload', dataType: 'any' }],
      defaults: {
        bindingKey: '',
        strategy: 'reuse',
      },
      fields: [
        {
          key: 'bindingKey',
          label: 'Binding key',
          type: 'text',
          placeholder: 'customer.phone',
        },
        {
          key: 'strategy',
          label: 'Strategy',
          type: 'select',
          options: [
            { label: 'Reuse existing', value: 'reuse' },
            { label: 'Create if missing', value: 'create' },
          ],
        },
      ],
    },
    {
      type: 'action.log',
      label: 'Log',
      category: 'ops',
      source: 'wrapper-core',
      description: 'Writes a log event into the run timeline.',
      icon: 'Terminal',
      availability: {
        status: 'supported',
        note: 'Available now in the local runtime and inspector.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [],
      defaults: {
        logLevel: 'info',
        message: '',
        includeInput: true,
      },
      fields: [
        {
          key: 'logLevel',
          label: 'Log level',
          type: 'select',
          options: [
            { label: 'Debug', value: 'debug' },
            { label: 'Info', value: 'info' },
            { label: 'Warn', value: 'warn' },
            { label: 'Error', value: 'error' },
          ],
        },
        {
          key: 'message',
          label: 'Message',
          type: 'text',
          placeholder: 'Refund request received',
          description: 'Optional prefix used when the node logs its payload.',
        },
        {
          key: 'includeInput',
          label: 'Include payload in log output',
          type: 'boolean',
        },
      ],
    },
    {
      type: 'ops.usage',
      label: 'Usage Snapshot',
      category: 'ops',
      source: 'openclaw-native',
      description: 'Captures usage, tokens, and cost-style metrics for the current run.',
      icon: 'ChartColumn',
      availability: {
        status: 'supported',
        note: 'Available now through adapter-derived usage snapshots with observed metric passthrough when present.',
      },
      inputs: [{ name: 'in', label: 'Input', dataType: 'any', required: true }],
      outputs: [{ name: 'out', label: 'Usage data', dataType: 'object' }],
      defaults: {
        metricScope: 'run',
      },
      fields: [
        {
          key: 'metricScope',
          label: 'Scope',
          type: 'select',
          options: [
            { label: 'Current run', value: 'run' },
            { label: 'Current node', value: 'node' },
          ],
        },
      ],
    },
  ],
};

function cloneCatalog(): NodeCatalog {
  return structuredClone(NODE_CATALOG);
}

function isBlankDefault(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0)
  );
}

function setNodeDefault(
  catalog: NodeCatalog,
  nodeType: string,
  key: string,
  value: string | undefined,
): void {
  if (!value) return;
  const node = catalog.nodes.find((entry) => entry.type === nodeType);
  if (!node) return;
  const defaults = node.defaults ?? {};
  if (!node.defaults) {
    node.defaults = defaults;
  }
  if (isBlankDefault(defaults[key])) {
    defaults[key] = value;
  }
}

function replaceNodeDefault(
  catalog: NodeCatalog,
  nodeType: string,
  key: string,
  value: string | undefined,
): void {
  if (!value) return;
  const node = catalog.nodes.find((entry) => entry.type === nodeType);
  if (!node) return;
  const defaults = node.defaults ?? {};
  if (!node.defaults) {
    node.defaults = defaults;
  }
  defaults[key] = value;
}

function setFieldSuggestions(
  catalog: NodeCatalog,
  matcher: (field: NodeConfigFieldDescriptor) => boolean,
  suggestions: NodeConfigOption[],
): void {
  if (suggestions.length === 0) return;
  for (const node of catalog.nodes) {
    for (const field of node.fields ?? []) {
      if (matcher(field) && field.type === 'text') {
        field.suggestions = suggestions;
      }
    }
  }
}

function setFieldSelectOptions(
  catalog: NodeCatalog,
  matcher: (field: NodeConfigFieldDescriptor) => boolean,
  options: NodeConfigOption[],
  emptyLabel?: string,
): void {
  if (options.length === 0) return;
  for (const node of catalog.nodes) {
    for (const field of node.fields ?? []) {
      if (matcher(field) && (field.type === 'text' || field.type === 'select')) {
        field.type = 'select';
        field.options = options;
        field.suggestions = undefined;
        if (emptyLabel) {
          field.placeholder = emptyLabel;
        }
      }
    }
  }
}

function setFieldOptions(
  catalog: NodeCatalog,
  matcher: (field: NodeConfigFieldDescriptor) => boolean,
  options: NodeConfigOption[],
): void {
  for (const node of catalog.nodes) {
    for (const field of node.fields ?? []) {
      if (matcher(field) && field.type === 'select') {
        field.options = options;
      }
    }
  }
}

function applyExecPolicyAvailability(
  catalog: NodeCatalog,
  workspaceExecPolicy?: WorkspaceExecPolicy,
): void {
  const execNode = catalog.nodes.find((node) => node.type === 'tool.exec');
  if (!execNode) return;

  const policy = resolveExecRuntimePolicy();
  const workspacePolicy = normalizeWorkspaceExecPolicy(workspaceExecPolicy);
  const availabilityParts = [
    'Available now. Ask and Require elevated request approval before execution.',
  ];

  if (!policy.enabled) {
    availabilityParts.push(
      'Exec is currently disabled by adapter policy (EXEC_NODE_ENABLED=false).',
    );
  } else {
    if (!policy.allowTrusted) {
      availabilityParts.push('Trusted mode is disabled unless EXEC_NODE_ALLOW_TRUSTED=true.');
    }
    if (!policy.allowElevated) {
      availabilityParts.push('Require elevated is disabled unless EXEC_NODE_ALLOW_ELEVATED=true.');
    }
    if (policy.allowedCommandPrefixes.length > 0) {
      availabilityParts.push(
        `Commands are limited to these prefixes: ${policy.allowedCommandPrefixes.join(', ')}.`,
      );
    }
    if (policy.trustedCommandPrefixes.length > 0) {
      availabilityParts.push(
        `Trusted mode commands are limited to: ${policy.trustedCommandPrefixes.join(', ')}.`,
      );
    }
    if (policy.elevatedCommandPrefixes.length > 0) {
      availabilityParts.push(
        `Require elevated commands are limited to: ${policy.elevatedCommandPrefixes.join(', ')}.`,
      );
    }
    if (policy.allowedCommandFamilies.length > 0) {
      availabilityParts.push(
        `Commands are limited to these command families: ${policy.allowedCommandFamilies.join(', ')}.`,
      );
    }
    if (policy.trustedCommandFamilies.length > 0) {
      availabilityParts.push(
        `Trusted mode command families are limited to: ${policy.trustedCommandFamilies.join(', ')}.`,
      );
    }
    if (policy.elevatedCommandFamilies.length > 0) {
      availabilityParts.push(
        `Require elevated command families are limited to: ${policy.elevatedCommandFamilies.join(', ')}.`,
      );
    }
  }

  if (workspacePolicy.enabled === false) {
    availabilityParts.push('This workspace has disabled exec entirely.');
  } else {
    if (workspacePolicy.allowTrusted === false) {
      availabilityParts.push('This workspace has disabled Trusted mode.');
    }
    if (workspacePolicy.allowElevated === false) {
      availabilityParts.push('This workspace has disabled Require elevated mode.');
    }
    if ((workspacePolicy.allowedCommandPrefixes?.length ?? 0) > 0) {
      availabilityParts.push(
        `This workspace limits command prefixes to: ${workspacePolicy.allowedCommandPrefixes?.join(', ')}.`,
      );
    }
    if ((workspacePolicy.trustedCommandPrefixes?.length ?? 0) > 0) {
      availabilityParts.push(
        `This workspace limits Trusted prefixes to: ${workspacePolicy.trustedCommandPrefixes?.join(', ')}.`,
      );
    }
    if ((workspacePolicy.elevatedCommandPrefixes?.length ?? 0) > 0) {
      availabilityParts.push(
        `This workspace limits Require elevated prefixes to: ${workspacePolicy.elevatedCommandPrefixes?.join(', ')}.`,
      );
    }
    if ((workspacePolicy.allowedCommandFamilies?.length ?? 0) > 0) {
      availabilityParts.push(
        `This workspace limits command families to: ${workspacePolicy.allowedCommandFamilies?.join(', ')}.`,
      );
    }
    if ((workspacePolicy.trustedCommandFamilies?.length ?? 0) > 0) {
      availabilityParts.push(
        `This workspace limits Trusted command families to: ${workspacePolicy.trustedCommandFamilies?.join(', ')}.`,
      );
    }
    if ((workspacePolicy.elevatedCommandFamilies?.length ?? 0) > 0) {
      availabilityParts.push(
        `This workspace limits Require elevated command families to: ${workspacePolicy.elevatedCommandFamilies?.join(', ')}.`,
      );
    }
  }

  availabilityParts.push('Require elevated does not grant OS-level privileges by itself.');
  if (execNode.availability) {
    execNode.availability.note = availabilityParts.join(' ');
  }

  const approvalField = execNode.fields?.find((field) => field.key === 'approvalMode');
  if (!approvalField) return;
  approvalField.description =
    'Ask and Require elevated pause for human approval before execution. Trusted and Require elevated can be disabled or further restricted by adapter policy, and Require elevated still does not grant OS-level privileges by itself.';
}

export function buildNodeCatalog(
  prefill?: OpenClawNodePrefillContext,
  workspaceExecPolicy?: WorkspaceExecPolicy,
  externalNodes: NodeTypeDescriptor[] = [],
  runtime?: {
    gatewayConnected?: boolean;
    gatewayMessage?: string;
  },
): NodeCatalog {
  const catalog = cloneCatalog();
  const defaultAgentId = prefill?.defaultAgentId ?? 'main';
  const agentSuggestions = prefill?.agentOptions ?? [{ label: 'Main (main)', value: 'main' }];
  const skillSuggestions = prefill?.skillOptions ?? [];
  const modelProviderOptions = prefill?.modelProviderOptions ?? [];
  const modelSuggestions = prefill?.modelOptions ?? [];
  const channelOptions = prefill?.channelOptions ?? [];
  const channelProfileOptions = prefill?.channelProfileOptions ?? [];
  const preferredChannelId = prefill?.preferredChannelId ?? channelOptions[0]?.value;
  const preferredChannelProfileId =
    prefill?.preferredChannelProfileId ?? channelProfileOptions[0]?.value;
  const destinationOptions =
    channelProfileOptions.length > 0 ? channelProfileOptions : channelOptions;

  setFieldSelectOptions(
    catalog,
    (field) => field.key === 'agentId',
    agentSuggestions,
    'Select agent',
  );
  setFieldSelectOptions(
    catalog,
    (field) => field.key === 'targetAgent',
    agentSuggestions,
    'Select target agent',
  );
  setFieldSelectOptions(
    catalog,
    (field) => field.key === 'skillName',
    skillSuggestions,
    'Select skill',
  );
  setFieldSelectOptions(
    catalog,
    (field) => field.key === 'modelProvider',
    modelProviderOptions,
    'Use agent default provider',
  );
  setFieldSelectOptions(
    catalog,
    (field) => field.key === 'modelOverride',
    modelSuggestions,
    'Use agent default model',
  );
  setFieldSuggestions(catalog, (field) => field.key === 'destination', destinationOptions);
  setFieldSuggestions(catalog, (field) => field.key === 'routeKey', channelOptions);
  setFieldSelectOptions(
    catalog,
    (field) => field.key === 'channelProfileId',
    channelProfileOptions,
    'Use saved channel profile',
  );

  setFieldOptions(catalog, (field) => field.key === 'channelType', channelOptions);

  setNodeDefault(catalog, 'action.agent', 'agentId', defaultAgentId);
  setNodeDefault(catalog, 'action.skill', 'agentId', defaultAgentId);
  setNodeDefault(catalog, 'action.channel-reply', 'agentId', defaultAgentId);
  setNodeDefault(catalog, 'trigger.cron', 'agentId', defaultAgentId);
  setNodeDefault(catalog, 'action.channel-reply', 'channelProfileId', preferredChannelProfileId);
  setNodeDefault(catalog, 'action.agent-send', 'targetAgent', prefill?.preferredTargetAgentId);
  setNodeDefault(catalog, 'action.skill', 'skillName', prefill?.preferredSkillValue);
  replaceNodeDefault(catalog, 'trigger.channel', 'channelType', preferredChannelId);
  replaceNodeDefault(catalog, 'action.channel-reply', 'channelType', preferredChannelId);
  applyExecPolicyAvailability(catalog, workspaceExecPolicy);

  if (runtime?.gatewayConnected === false) {
    const gatewayNote =
      runtime.gatewayMessage?.trim() ||
      'OpenClaw gateway is not connected. Gateway-backed agents, channels, hooks, cron, and runtime actions will stay unavailable until a gateway is configured.';
    for (const node of catalog.nodes) {
      if (GATEWAY_UNAVAILABLE_NODE_TYPES.has(node.type)) {
        node.availability = {
          status: node.availability?.status ?? 'supported',
          note: node.availability?.note ? `${node.availability.note} ${gatewayNote}` : gatewayNote,
        };

        const capabilities = node.capabilities ?? [];
        const alreadyTagged = capabilities.some(
          (capability) => capability.label === 'Gateway connection currently unavailable',
        );
        if (!alreadyTagged) {
          capabilities.unshift({
            label: 'Gateway connection currently unavailable',
            detail:
              'This node type still depends on a live OpenClaw gateway runtime. Local wrapper-only flows can still use HTTP, Browser Lite, Web Search, waits, approvals, memory, and exec while the gateway is offline.',
            tone: 'warning',
          });
        }
        node.capabilities = capabilities;
        continue;
      }

      if (OFFLINE_FALLBACK_NODE_TYPES.has(node.type)) {
        node.availability = {
          status: node.availability?.status ?? 'supported',
          note: node.availability?.note
            ? `${node.availability.note} ${gatewayNote} This node can still run in a clearly marked offline fallback mode for local testing.`
            : `${gatewayNote} This node can still run in a clearly marked offline fallback mode for local testing.`,
        };

        const capabilities = node.capabilities ?? [];
        const alreadyTagged = capabilities.some(
          (capability) => capability.label === 'Offline fallback available',
        );
        if (!alreadyTagged) {
          capabilities.unshift({
            label: 'Offline fallback available',
            detail:
              'When the gateway is unreachable, this node can return a simulated local result so flows stay testable. Live delivery, agent execution, and real skill output still require the gateway.',
            tone: 'limited',
          });
        }
        node.capabilities = capabilities;
      }
    }
  }

  const knownNodeTypes = new Set(catalog.nodes.map((node) => node.type));
  for (const node of externalNodes) {
    if (knownNodeTypes.has(node.type)) {
      continue;
    }
    knownNodeTypes.add(node.type);
    catalog.nodes.push(structuredClone(node));
  }

  return catalog;
}
