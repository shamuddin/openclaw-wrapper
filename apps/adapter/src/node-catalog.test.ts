import { describe, expect, it } from 'vitest';
import { buildNodeCatalog } from './node-catalog.js';

describe('buildNodeCatalog', () => {
  it('keeps runtime-backed channel fields blank until OpenClaw discovery provides options', () => {
    const catalog = buildNodeCatalog();

    const replyNode = catalog.nodes.find((node) => node.type === 'action.channel-reply');
    const triggerNode = catalog.nodes.find((node) => node.type === 'trigger.channel');

    expect(replyNode?.defaults).toMatchObject({
      channelProfileId: '',
      channelType: '',
    });
    expect(replyNode?.fields?.find((field) => field.key === 'channelProfileId')).toMatchObject({
      type: 'select',
      placeholder: 'Use saved channel profile',
      options: [],
    });
    expect(replyNode?.fields?.find((field) => field.key === 'channelType')).toMatchObject({
      type: 'select',
      placeholder: 'Use gateway default or select channel',
      options: [],
    });
    expect(triggerNode?.defaults).toMatchObject({
      channelType: '',
    });
    expect(triggerNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(triggerNode?.fields?.find((field) => field.key === 'channelType')).toMatchObject({
      type: 'select',
      placeholder: 'Select discovered channel',
      options: [],
    });

    const cronNode = catalog.nodes.find((node) => node.type === 'trigger.cron');
    const hookNode = catalog.nodes.find((node) => node.type === 'trigger.hook');
    const taskNode = catalog.nodes.find((node) => node.type === 'trigger.task');
    const standingOrderNode = catalog.nodes.find((node) => node.type === 'trigger.standing-order');
    const browserNode = catalog.nodes.find((node) => node.type === 'tool.browser');
    const webSearchNode = catalog.nodes.find((node) => node.type === 'tool.web-search');
    const shapePayloadNode = catalog.nodes.find((node) => node.type === 'tool.payload-template');
    const execNode = catalog.nodes.find((node) => node.type === 'tool.exec');
    const channelRouteNode = catalog.nodes.find((node) => node.type === 'action.channel-route');
    const approvalNode = catalog.nodes.find((node) => node.type === 'control.approval');
    const waitNode = catalog.nodes.find((node) => node.type === 'control.wait');
    const memoryQueryNode = catalog.nodes.find((node) => node.type === 'context.memory-query');
    const memoryWriteNode = catalog.nodes.find((node) => node.type === 'context.memory-write');
    const threadBindNode = catalog.nodes.find((node) => node.type === 'context.thread-bind');
    const usageNode = catalog.nodes.find((node) => node.type === 'ops.usage');
    expect(cronNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(hookNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(taskNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(taskNode?.defaults).toMatchObject({
      taskType: '',
      taskQueue: '',
      taskPriority: '',
    });
    expect(standingOrderNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(standingOrderNode?.defaults).toMatchObject({
      standingOrderKey: '',
      standingOrderScope: '',
    });
    expect(browserNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(browserNode?.label).toBe('Browser Lite');
    expect(browserNode?.defaults).toMatchObject({
      action: 'open',
      extractMode: 'text',
      clickHint: '',
      timeoutMs: '30000',
    });
    expect(browserNode?.fields?.find((field) => field.key === 'extractMode')).toMatchObject({
      type: 'select',
      visibleWhen: [{ key: 'action', operator: 'equals', value: 'extract' }],
    });
    expect(
      browserNode?.fields
        ?.find((field) => field.key === 'extractMode')
        ?.options?.some((option) => option.value === 'headings'),
    ).toBe(true);
    expect(
      browserNode?.fields
        ?.find((field) => field.key === 'extractMode')
        ?.options?.some((option) => option.value === 'jsonld'),
    ).toBe(true);
    expect(
      browserNode?.fields
        ?.find((field) => field.key === 'extractMode')
        ?.options?.some((option) => option.value === 'metadata'),
    ).toBe(true);
    expect(browserNode?.fields?.find((field) => field.key === 'clickHint')).toMatchObject({
      type: 'text',
      visibleWhen: [{ key: 'action', operator: 'equals', value: 'click' }],
    });
    expect(browserNode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Open public pages',
          tone: 'supported',
        }),
        expect.objectContaining({
          label: 'No JavaScript session',
          tone: 'warning',
        }),
      ]),
    );
    expect(webSearchNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(execNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(shapePayloadNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(webSearchNode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Live web lookup',
        }),
        expect.objectContaining({
          label: 'Follow-up ready output modes',
        }),
      ]),
    );
    expect(webSearchNode?.defaults).toMatchObject({
      provider: 'duckduckgo',
      limit: '5',
      outputMode: 'results',
    });
    expect(webSearchNode?.fields?.find((field) => field.key === 'provider')).toMatchObject({
      type: 'select',
      description:
        'DuckDuckGo works without a key. Brave, Tavily, and Perplexity require adapter API keys.',
    });
    expect(webSearchNode?.fields?.find((field) => field.key === 'outputMode')).toMatchObject({
      type: 'select',
      description:
        'Use Top result URL to feed Browser Lite directly with {{input}} in the next step.',
    });
    expect(execNode?.defaults).toMatchObject({
      approvalMode: 'ask',
      timeoutMs: '30000',
    });
    expect(shapePayloadNode?.defaults).toMatchObject({
      template: '{{input}}',
      outputMode: 'replace',
      outputPath: '',
    });
    expect(shapePayloadNode?.fields?.find((field) => field.key === 'outputMode')).toMatchObject({
      type: 'select',
    });
    expect(shapePayloadNode?.fields?.find((field) => field.key === 'outputPath')).toMatchObject({
      type: 'text',
      visibleWhen: [{ key: 'outputMode', operator: 'equals', value: 'assign' }],
    });
    expect(shapePayloadNode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Structured templating',
        }),
      ]),
    );
    expect(execNode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Policy-aware shell execution',
        }),
      ]),
    );
    expect(channelRouteNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(approvalNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(channelRouteNode?.defaults).toMatchObject({
      destination: '',
      threading: 'preserve',
      messageTemplate: '',
    });
    expect(waitNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(memoryQueryNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(memoryQueryNode?.defaults).toMatchObject({
      namespace: 'session',
      limit: '10',
    });
    expect(memoryWriteNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(threadBindNode?.availability).toMatchObject({
      status: 'supported',
    });
    expect(usageNode?.availability).toMatchObject({
      status: 'supported',
    });
  });

  it('applies runtime defaults and suggestions across matching node fields', () => {
    const catalog = buildNodeCatalog({
      defaultAgentId: 'ops',
      agentOptions: [
        { label: 'Operations (ops)', value: 'ops' },
        { label: 'Finance (finance)', value: 'finance' },
      ],
      preferredTargetAgentId: 'finance',
      skillOptions: [
        { label: 'refund triage (finance/refund-triage)', value: 'finance/refund-triage' },
      ],
      preferredSkillValue: 'finance/refund-triage',
      modelProviderOptions: [{ label: 'openai', value: 'openai' }],
      modelOptions: [
        {
          label: 'GPT-5.4 Mini (openai)',
          value: 'openai/gpt-5.4-mini',
          scope: 'openai',
        },
      ],
      channelOptions: [
        { label: 'Telegram (telegram)', value: 'telegram' },
        { label: 'WhatsApp (whatsapp)', value: 'whatsapp' },
      ],
      preferredChannelId: 'telegram',
      channelProfileOptions: [
        { label: 'Support WhatsApp (whatsapp)', value: 'profile_whatsapp', scope: 'whatsapp' },
      ],
      preferredChannelProfileId: 'profile_whatsapp',
    });

    const agentNode = catalog.nodes.find((node) => node.type === 'action.agent');
    const skillNode = catalog.nodes.find((node) => node.type === 'action.skill');
    const channelReplyNode = catalog.nodes.find((node) => node.type === 'action.channel-reply');
    const agentSendNode = catalog.nodes.find((node) => node.type === 'action.agent-send');
    const channelRouteNode = catalog.nodes.find((node) => node.type === 'action.channel-route');
    const memoryWriteNode = catalog.nodes.find((node) => node.type === 'context.memory-write');
    const usageNode = catalog.nodes.find((node) => node.type === 'ops.usage');

    expect(agentNode?.defaults).toMatchObject({
      agentId: 'ops',
    });
    expect(agentNode?.fields?.find((field) => field.key === 'agentId')).toMatchObject({
      type: 'select',
      placeholder: 'Select agent',
      options: [
        { label: 'Operations (ops)', value: 'ops' },
        { label: 'Finance (finance)', value: 'finance' },
      ],
    });
    expect(agentNode?.fields?.find((field) => field.key === 'modelProvider')).toMatchObject({
      type: 'select',
      placeholder: 'Use agent default provider',
      options: [{ label: 'openai', value: 'openai' }],
    });
    expect(agentNode?.fields?.find((field) => field.key === 'modelOverride')).toMatchObject({
      type: 'select',
      placeholder: 'Use agent default model',
      options: [
        {
          label: 'GPT-5.4 Mini (openai)',
          value: 'openai/gpt-5.4-mini',
          scope: 'openai',
        },
      ],
    });

    expect(skillNode?.defaults).toMatchObject({
      agentId: 'ops',
      skillName: 'finance/refund-triage',
    });
    expect(skillNode?.fields?.find((field) => field.key === 'skillName')).toMatchObject({
      type: 'select',
      placeholder: 'Select skill',
      options: [{ label: 'refund triage (finance/refund-triage)', value: 'finance/refund-triage' }],
    });
    expect(skillNode?.fields?.find((field) => field.key === 'modelProvider')).toMatchObject({
      type: 'select',
      placeholder: 'Use agent default provider',
      options: [{ label: 'openai', value: 'openai' }],
    });

    expect(agentSendNode?.defaults).toMatchObject({
      targetAgent: 'finance',
      waitTimeoutMs: '30000',
    });
    expect(agentSendNode?.fields?.find((field) => field.key === 'targetAgent')).toMatchObject({
      type: 'select',
      placeholder: 'Select target agent',
      options: [
        { label: 'Operations (ops)', value: 'ops' },
        { label: 'Finance (finance)', value: 'finance' },
      ],
    });
    expect(agentSendNode?.fields?.find((field) => field.key === 'modelProvider')).toMatchObject({
      type: 'select',
      placeholder: 'Use agent default provider',
      options: [{ label: 'openai', value: 'openai' }],
    });
    expect(agentSendNode?.fields?.find((field) => field.key === 'modelOverride')).toMatchObject({
      type: 'select',
      placeholder: 'Use agent default model',
      options: [
        {
          label: 'GPT-5.4 Mini (openai)',
          value: 'openai/gpt-5.4-mini',
          scope: 'openai',
        },
      ],
    });

    expect(channelReplyNode?.defaults).toMatchObject({
      agentId: 'ops',
      channelProfileId: 'profile_whatsapp',
      channelType: 'telegram',
      toPath: 'to',
      threadIdPath: 'threadId',
      accountIdPath: 'accountId',
      sessionKeyPath: 'sessionKey',
      messageTemplate: '{{replyText}}',
    });
    expect(
      channelReplyNode?.fields?.find((field) => field.key === 'channelProfileId'),
    ).toMatchObject({
      type: 'select',
      placeholder: 'Use saved channel profile',
      options: [
        { label: 'Support WhatsApp (whatsapp)', value: 'profile_whatsapp', scope: 'whatsapp' },
      ],
    });
    expect(channelReplyNode?.fields?.find((field) => field.key === 'channelType')?.options).toEqual(
      [
        { label: 'Telegram (telegram)', value: 'telegram' },
        { label: 'WhatsApp (whatsapp)', value: 'whatsapp' },
      ],
    );
    expect(channelReplyNode?.fields?.find((field) => field.key === 'agentId')).toMatchObject({
      type: 'select',
      placeholder: 'Select agent',
      options: [
        { label: 'Operations (ops)', value: 'ops' },
        { label: 'Finance (finance)', value: 'finance' },
      ],
    });
    expect(channelRouteNode?.fields?.find((field) => field.key === 'destination')).toMatchObject({
      type: 'text',
      placeholder: 'profile id or channel type',
      suggestions: [
        { label: 'Support WhatsApp (whatsapp)', value: 'profile_whatsapp', scope: 'whatsapp' },
      ],
    });
    expect(
      channelRouteNode?.fields?.find((field) => field.key === 'messageTemplate'),
    ).toMatchObject({
      type: 'textarea',
      placeholder: '{{message}}',
    });
    expect(memoryWriteNode?.fields?.find((field) => field.key === 'valueTemplate')).toMatchObject({
      type: 'textarea',
      placeholder: '{{intent}}',
    });
    expect(usageNode?.defaults).toMatchObject({
      metricScope: 'run',
    });
  });

  it('marks truly gateway-blocked nodes separately from offline-fallback nodes in local-only mode', () => {
    const catalog = buildNodeCatalog(undefined, undefined, [], {
      gatewayConnected: false,
      gatewayMessage: 'Gateway unavailable in local-only mode.',
    });

    const channelTriggerNode = catalog.nodes.find((node) => node.type === 'trigger.channel');
    const agentNode = catalog.nodes.find((node) => node.type === 'action.agent');
    const browserNode = catalog.nodes.find((node) => node.type === 'tool.browser');
    const webhookNode = catalog.nodes.find((node) => node.type === 'trigger.webhook');

    expect(channelTriggerNode?.availability?.note).toContain(
      'Gateway unavailable in local-only mode.',
    );
    expect(agentNode?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Offline fallback available',
          tone: 'limited',
        }),
      ]),
    );
    expect(browserNode?.capabilities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Gateway connection currently unavailable',
        }),
      ]),
    );
    expect(webhookNode?.capabilities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Gateway connection currently unavailable',
        }),
      ]),
    );
  });

  it('merges external plugin nodes without overwriting built-in node types', () => {
    const catalog = buildNodeCatalog(undefined, undefined, [
      {
        type: 'tool.refund-check',
        label: 'Refund Check',
        category: 'tools',
        source: 'external-plugin',
        inputs: [],
        outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
      },
      {
        type: 'trigger.webhook',
        label: 'Duplicate Webhook',
        category: 'triggers',
        source: 'external-plugin',
        inputs: [],
        outputs: [{ name: 'out', label: 'Result', dataType: 'object' }],
      },
    ]);

    expect(catalog.nodes.find((node) => node.type === 'tool.refund-check')).toMatchObject({
      source: 'external-plugin',
    });
    expect(catalog.nodes.filter((node) => node.type === 'trigger.webhook')).toHaveLength(1);
  });
});
