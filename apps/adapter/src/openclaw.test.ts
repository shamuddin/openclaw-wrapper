import { describe, expect, it, vi } from 'vitest';
import {
  approveOpenClawRuntimeDevicePairing,
  approveOpenClawRuntimeNodePairing,
  loadOpenClawNodePrefillContext,
  loadOpenClawRuntimePairingOverview,
  rejectOpenClawRuntimeDevicePairing,
  rejectOpenClawRuntimeNodePairing,
  runOpenClawAgent,
  runOpenClawSkill,
  sendOpenClawChannelReply,
} from './openclaw.js';

function createAbortError(message = 'Request aborted'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

describe('runOpenClawAgent', () => {
  it('waits for agent completion and extracts the last assistant reply from preview items', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'accepted',
        runId: 'gw_run_123',
      })
      .mockResolvedValueOnce({
        runId: 'gw_run_123',
        status: 'ok',
        startedAt: 1_744_999_000_000,
        endedAt: 1_744_999_010_000,
      })
      .mockResolvedValueOnce({
        previews: [
          {
            key: 'agent:intake:flow:flow_1:run:run_1:node:n2',
            status: 'ok',
            items: [
              { role: 'user', text: 'Customer wants a refund' },
              { role: 'assistant', text: 'Please share the order id.' },
              { role: 'assistant', text: 'Route this to finance.' },
            ],
          },
        ],
      });

    const result = await runOpenClawAgent(
      {
        agentId: 'intake',
        sessionKey: 'agent:intake:flow:flow_1:run:run_1:node:n2',
        message: 'Workflow input JSON:\n{"intent":"refund"}',
        extraSystemPrompt: 'Classify the customer intent.',
        model: 'openai/gpt-5.4-mini',
        idempotencyKey: 'run_1:n2',
        timeoutMs: 45_000,
      },
      { request } as never,
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      'agent',
      {
        agentId: 'intake',
        sessionKey: 'agent:intake:flow:flow_1:run:run_1:node:n2',
        message: 'Workflow input JSON:\n{"intent":"refund"}',
        deliver: false,
        idempotencyKey: 'run_1:n2',
        extraSystemPrompt: 'Classify the customer intent.',
        model: 'openai/gpt-5.4-mini',
      },
      { signal: undefined },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'agent.wait',
      {
        runId: 'gw_run_123',
        timeoutMs: 45_000,
      },
      { signal: undefined },
    );
    expect(request).toHaveBeenNthCalledWith(3, 'sessions.preview', {
      keys: ['agent:intake:flow:flow_1:run:run_1:node:n2'],
      limit: 8,
      maxChars: 800,
    });
    expect(result).toMatchObject({
      agentId: 'intake',
      runId: 'gw_run_123',
      sessionKey: 'agent:intake:flow:flow_1:run:run_1:node:n2',
      status: 'ok',
      replyText: 'Route this to finance.',
      previewStatus: 'ok',
      previewItems: [
        { role: 'user', text: 'Customer wants a refund' },
        { role: 'assistant', text: 'Please share the order id.' },
        { role: 'assistant', text: 'Route this to finance.' },
      ],
    });
  });

  it('forwards optional cron-style agent overrides when provided', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'accepted',
        runId: 'gw_run_456',
      })
      .mockResolvedValueOnce({
        runId: 'gw_run_456',
        status: 'ok',
      })
      .mockResolvedValueOnce({
        previews: [],
      });

    await runOpenClawAgent(
      {
        agentId: 'ops',
        sessionKey: 'cron:ops-brief',
        message: 'Prepare the brief.',
        model: 'openai/gpt-5.2',
        thinking: 'low',
        fallbacks: ['openai/gpt-5.4-mini'],
        lightContext: true,
        allowUnsafeExternalContent: true,
        toolsAllow: ['read', 'browser'],
      },
      { request } as never,
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      'agent',
      {
        agentId: 'ops',
        sessionKey: 'cron:ops-brief',
        message: 'Prepare the brief.',
        deliver: false,
        idempotencyKey: undefined,
        model: 'openai/gpt-5.2',
        thinking: 'low',
        fallbacks: ['openai/gpt-5.4-mini'],
        lightContext: true,
        allowUnsafeExternalContent: true,
        toolsAllow: ['read', 'browser'],
      },
      { signal: undefined },
    );
  });

  it('throws when the gateway reports an agent timeout', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'accepted',
        runId: 'gw_run_timeout',
      })
      .mockResolvedValueOnce({
        runId: 'gw_run_timeout',
        status: 'timeout',
      });

    await expect(
      runOpenClawAgent(
        {
          agentId: 'intake',
          sessionKey: 'agent:intake:flow:flow_1:run:run_1:node:n2',
          message: 'Ping',
          timeoutMs: 12_000,
        },
        { request } as never,
      ),
    ).rejects.toThrow('OpenClaw agent timed out after 12000ms');
  });

  it('relays cancellation to the gateway after a remote agent run has been accepted', async () => {
    let signalWaitAttached!: () => void;
    const waitAttached = new Promise<void>((resolve) => {
      signalWaitAttached = resolve;
    });
    const request = vi.fn((method: string, params: Record<string, unknown>, options?: object) => {
      if (method === 'agent') {
        return Promise.resolve({
          status: 'accepted',
          runId: 'gw_run_abort',
        });
      }

      if (method === 'agent.wait') {
        return new Promise((_, reject) => {
          const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
          signalWaitAttached();
          signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true },
          );
        });
      }

      if (method === 'chat.abort') {
        return Promise.resolve({ ok: true });
      }

      throw new Error(`Unexpected method: ${method}`);
    });
    const controller = new AbortController();

    const result = runOpenClawAgent(
      {
        agentId: 'intake',
        sessionKey: 'agent:intake:flow:flow_1:run:run_1:node:n2',
        message: 'Ping',
        signal: controller.signal,
      },
      { request } as never,
    );

    await waitAttached;
    controller.abort();

    await expect(result).rejects.toThrow('Request aborted');
    expect(request).toHaveBeenCalledWith(
      'chat.abort',
      {
        sessionKey: 'agent:intake:flow:flow_1:run:run_1:node:n2',
        runId: 'gw_run_abort',
      },
      {},
    );
  });

  it('falls back to session abort when chat abort is unavailable', async () => {
    let signalWaitAttached!: () => void;
    const waitAttached = new Promise<void>((resolve) => {
      signalWaitAttached = resolve;
    });
    const request = vi.fn((method: string, params: Record<string, unknown>, options?: object) => {
      if (method === 'agent') {
        return Promise.resolve({
          status: 'accepted',
          runId: 'gw_run_abort',
        });
      }

      if (method === 'agent.wait') {
        return new Promise((_, reject) => {
          const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
          signalWaitAttached();
          signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true },
          );
        });
      }

      if (method === 'chat.abort') {
        return Promise.reject(new Error('unknown method: chat.abort'));
      }

      if (method === 'sessions.abort') {
        return Promise.resolve({ ok: true });
      }

      throw new Error(`Unexpected method: ${method}`);
    });
    const controller = new AbortController();

    const result = runOpenClawAgent(
      {
        agentId: 'intake',
        sessionKey: 'agent:intake:flow:flow_1:run:run_1:node:n2',
        message: 'Ping',
        signal: controller.signal,
      },
      { request } as never,
    );

    await waitAttached;
    controller.abort();

    await expect(result).rejects.toThrow('Request aborted');
    expect(request).toHaveBeenCalledWith(
      'sessions.abort',
      {
        sessionKey: 'agent:intake:flow:flow_1:run:run_1:node:n2',
      },
      {},
    );
  });
});

describe('runOpenClawSkill', () => {
  it('resolves a skill command, sends it through a session, and extracts the last assistant reply', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        skills: [
          {
            name: 'refund triage',
            skillKey: 'finance/refund-triage',
            description: 'Classify refund requests',
            eligible: true,
            disabled: false,
            blockedByAllowlist: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        commands: [
          {
            name: 'refund_triage',
            source: 'skill',
            description: 'Classify refund requests',
            textAliases: ['/refund_triage'],
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        key: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
        sessionId: 'session_123',
      })
      .mockResolvedValueOnce({
        runId: 'client_run_1',
        status: 'started',
      })
      .mockResolvedValueOnce({
        previews: [
          {
            key: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
            status: 'ok',
            items: [
              { role: 'user', text: '/refund_triage Customer needs a refund' },
              { role: 'assistant', text: 'Refund intent detected.' },
            ],
          },
        ],
      });

    const result = await runOpenClawSkill(
      {
        skillName: 'finance/refund-triage',
        agentId: 'main',
        sessionKey: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
        message: 'Customer needs a refund',
        model: 'openai/gpt-5.4-mini',
        idempotencyKey: 'run_1:n3',
        timeoutMs: 45_000,
      },
      { request } as never,
    );

    expect(request).toHaveBeenNthCalledWith(1, 'skills.status', {
      agentId: 'main',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'commands.list', {
      agentId: 'main',
      scope: 'text',
      includeArgs: false,
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      'sessions.create',
      {
        key: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
        agentId: 'main',
        model: 'openai/gpt-5.4-mini',
      },
      { signal: undefined },
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      'sessions.send',
      {
        key: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
        message: '/refund_triage Customer needs a refund',
        timeoutMs: 45_000,
        idempotencyKey: 'run_1:n3',
      },
      { signal: undefined },
    );
    expect(request).toHaveBeenNthCalledWith(5, 'sessions.preview', {
      keys: ['skill:main:refund_triage:flow:flow_1:run:run_1:node:n3'],
      limit: 8,
      maxChars: 800,
    });
    expect(result).toMatchObject({
      skillName: 'finance/refund-triage',
      commandName: 'refund_triage',
      sessionKey: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
      sessionId: 'session_123',
      runId: 'client_run_1',
      status: 'ok',
      sendStatus: 'started',
      replyText: 'Refund intent detected.',
      previewStatus: 'ok',
      previewItems: [
        { role: 'user', text: '/refund_triage Customer needs a refund' },
        { role: 'assistant', text: 'Refund intent detected.' },
      ],
    });
  });

  it('throws a useful error when the configured skill is not available', async () => {
    const request = vi.fn().mockResolvedValueOnce({ skills: [] });

    await expect(
      runOpenClawSkill(
        {
          skillName: 'finance/refund-triage',
          agentId: 'main',
          sessionKey: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
          message: 'Customer needs a refund',
        },
        { request } as never,
      ),
    ).rejects.toThrow('OpenClaw skill "finance/refund-triage" was not found for agent "main"');
  });

  it('relays cancellation to the gateway session after a skill session has been created', async () => {
    let signalWaitAttached!: () => void;
    const waitAttached = new Promise<void>((resolve) => {
      signalWaitAttached = resolve;
    });
    const request = vi.fn((method: string, params: Record<string, unknown>, options?: object) => {
      if (method === 'skills.status') {
        return Promise.resolve({
          skills: [
            {
              name: 'refund triage',
              skillKey: 'finance/refund-triage',
              eligible: true,
            },
          ],
        });
      }

      if (method === 'commands.list') {
        return Promise.resolve({
          commands: [
            {
              name: 'refund_triage',
              source: 'skill',
            },
          ],
        });
      }

      if (method === 'sessions.create') {
        return Promise.resolve({
          ok: true,
          key: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
          sessionId: 'session_123',
        });
      }

      if (method === 'sessions.send') {
        return new Promise((_, reject) => {
          const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
          signalWaitAttached();
          signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true },
          );
        });
      }

      if (method === 'sessions.abort') {
        return Promise.resolve({ ok: true });
      }

      throw new Error(`Unexpected method: ${method}`);
    });
    const controller = new AbortController();

    const result = runOpenClawSkill(
      {
        skillName: 'finance/refund-triage',
        agentId: 'main',
        sessionKey: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
        message: 'Customer needs a refund',
        signal: controller.signal,
      },
      { request } as never,
    );

    await waitAttached;
    controller.abort();

    await expect(result).rejects.toThrow('Request aborted');
    expect(request).toHaveBeenCalledWith(
      'sessions.abort',
      {
        sessionKey: 'skill:main:refund_triage:flow:flow_1:run:run_1:node:n3',
      },
      {},
    );
  });
});

describe('loadOpenClawRuntimePairingOverview', () => {
  it('normalizes paired devices and nodes from gateway pairing lists', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'device.pair.list') {
        return {
          pending: [
            {
              requestId: 'dev_req_1',
              deviceId: 'ios-14',
              displayName: 'Nora iPhone',
              platform: 'ios',
              deviceFamily: 'phone',
              roles: ['operator'],
              scopes: ['operator.pairing'],
              remoteIp: '10.0.0.8',
              ts: 1_744_999_020_000,
            },
          ],
          paired: [
            {
              deviceId: 'mac-mini-1',
              displayName: 'Office Mac mini',
              platform: 'macos',
              deviceFamily: 'desktop',
              roles: ['operator'],
              approvedScopes: ['operator.pairing', 'operator.admin'],
              remoteIp: '10.0.0.21',
              createdAtMs: 1_744_999_000_000,
              approvedAtMs: 1_744_999_010_000,
            },
          ],
        };
      }

      if (method === 'node.pair.list') {
        return {
          pending: [
            {
              requestId: 'node_req_1',
              nodeId: 'android-node-3',
              displayName: 'Field Android',
              platform: 'android',
              version: '2.7.0',
              deviceFamily: 'phone',
              commands: ['wake', 'status'],
              caps: ['camera', 'location'],
              requiredApproveScopes: ['operator.mobile'],
              ts: 1_744_999_030_000,
            },
          ],
          paired: [
            {
              nodeId: 'macos-node-7',
              displayName: 'Studio Mac',
              platform: 'macos',
              version: '3.1.2',
              coreVersion: '2026.4.20',
              uiVersion: '2026.4.18',
              deviceFamily: 'desktop',
              commands: ['wake'],
              caps: ['tts'],
              remoteIp: '10.0.0.41',
              createdAtMs: 1_744_999_000_000,
              approvedAtMs: 1_744_999_005_000,
              lastConnectedAtMs: 1_744_999_040_000,
            },
          ],
        };
      }

      throw new Error(`Unexpected method: ${method}`);
    });

    const result = await loadOpenClawRuntimePairingOverview({ request } as never);

    expect(result).toEqual({
      devices: {
        pending: [
          {
            requestId: 'dev_req_1',
            deviceId: 'ios-14',
            displayName: 'Nora iPhone',
            platform: 'ios',
            deviceFamily: 'phone',
            roles: ['operator'],
            scopes: ['operator.pairing'],
            remoteIp: '10.0.0.8',
            requestedAt: '2025-04-18T17:57:00.000Z',
          },
        ],
        paired: [
          {
            deviceId: 'mac-mini-1',
            displayName: 'Office Mac mini',
            platform: 'macos',
            deviceFamily: 'desktop',
            roles: ['operator'],
            approvedScopes: ['operator.pairing', 'operator.admin'],
            remoteIp: '10.0.0.21',
            createdAt: '2025-04-18T17:56:40.000Z',
            approvedAt: '2025-04-18T17:56:50.000Z',
          },
        ],
      },
      nodes: {
        pending: [
          {
            requestId: 'node_req_1',
            nodeId: 'android-node-3',
            displayName: 'Field Android',
            platform: 'android',
            version: '2.7.0',
            coreVersion: undefined,
            uiVersion: undefined,
            deviceFamily: 'phone',
            modelIdentifier: undefined,
            commands: ['wake', 'status'],
            capabilities: ['camera', 'location'],
            requiredApproveScopes: ['operator.mobile'],
            remoteIp: undefined,
            requestedAt: '2025-04-18T17:57:10.000Z',
          },
        ],
        paired: [
          {
            nodeId: 'macos-node-7',
            displayName: 'Studio Mac',
            platform: 'macos',
            version: '3.1.2',
            coreVersion: '2026.4.20',
            uiVersion: '2026.4.18',
            deviceFamily: 'desktop',
            modelIdentifier: undefined,
            commands: ['wake'],
            capabilities: ['tts'],
            remoteIp: '10.0.0.41',
            createdAt: '2025-04-18T17:56:40.000Z',
            approvedAt: '2025-04-18T17:56:45.000Z',
            lastConnectedAt: '2025-04-18T17:57:20.000Z',
          },
        ],
      },
    });
  });
});

describe('runtime pairing decisions', () => {
  it('approves a pending device pairing request', async () => {
    const request = vi.fn().mockResolvedValue({
      requestId: 'dev_req_1',
      device: {
        deviceId: 'ios-14',
      },
    });

    const result = await approveOpenClawRuntimeDevicePairing('dev_req_1', { request } as never);

    expect(request).toHaveBeenCalledWith('device.pair.approve', {
      requestId: 'dev_req_1',
    });
    expect(result).toEqual({
      requestId: 'dev_req_1',
      deviceId: 'ios-14',
      decision: 'approved',
    });
  });

  it('rejects a pending device pairing request', async () => {
    const request = vi.fn().mockResolvedValue({
      requestId: 'dev_req_2',
      deviceId: 'mac-mini-1',
    });

    const result = await rejectOpenClawRuntimeDevicePairing('dev_req_2', { request } as never);

    expect(request).toHaveBeenCalledWith('device.pair.reject', {
      requestId: 'dev_req_2',
    });
    expect(result).toEqual({
      requestId: 'dev_req_2',
      deviceId: 'mac-mini-1',
      decision: 'rejected',
    });
  });

  it('approves a pending node pairing request', async () => {
    const request = vi.fn().mockResolvedValue({
      requestId: 'node_req_1',
      paired: {
        nodeId: 'android-node-3',
      },
    });

    const result = await approveOpenClawRuntimeNodePairing('node_req_1', { request } as never);

    expect(request).toHaveBeenCalledWith('node.pair.approve', {
      requestId: 'node_req_1',
    });
    expect(result).toEqual({
      requestId: 'node_req_1',
      nodeId: 'android-node-3',
      decision: 'approved',
    });
  });

  it('rejects a pending node pairing request', async () => {
    const request = vi.fn().mockResolvedValue({
      requestId: 'node_req_2',
      nodeId: 'macos-node-7',
    });

    const result = await rejectOpenClawRuntimeNodePairing('node_req_2', { request } as never);

    expect(request).toHaveBeenCalledWith('node.pair.reject', {
      requestId: 'node_req_2',
    });
    expect(result).toEqual({
      requestId: 'node_req_2',
      nodeId: 'macos-node-7',
      decision: 'rejected',
    });
  });
});

describe('sendOpenClawChannelReply', () => {
  it('resolves a live channel id before sending a direct outbound message', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        channelOrder: ['whatsapp-cloud'],
        channelLabels: {
          'whatsapp-cloud': 'WhatsApp Cloud',
        },
        channelAccounts: {
          'whatsapp-cloud': [{ enabled: true, configured: true, connected: true }],
        },
      })
      .mockResolvedValueOnce({
        runId: 'reply_run_1',
        messageId: 'msg_123',
        channel: 'whatsapp-cloud',
        toJid: '919999999999@s.whatsapp.net',
        conversationId: 'conv_1',
      });

    const result = await sendOpenClawChannelReply(
      {
        channel: 'whatsapp',
        to: '919999999999',
        message: 'We have received your refund request.',
        accountId: 'primary',
        agentId: 'main',
        threadId: 'topic-42',
        sessionKey: 'agent:main:whatsapp:direct:919999999999',
        idempotencyKey: 'run_7:reply',
      },
      { request } as never,
    );

    expect(request).toHaveBeenNthCalledWith(1, 'channels.status', {
      probe: false,
      timeoutMs: 2000,
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      'send',
      {
        to: '919999999999',
        message: 'We have received your refund request.',
        channel: 'whatsapp-cloud',
        accountId: 'default',
        agentId: 'main',
        threadId: 'topic-42',
        sessionKey: 'agent:main:whatsapp:direct:919999999999',
        idempotencyKey: 'run_7:reply',
      },
      { signal: undefined },
    );
    expect(result).toEqual({
      runId: 'reply_run_1',
      messageId: 'msg_123',
      channel: 'whatsapp-cloud',
      to: '919999999999',
      accountId: 'default',
      agentId: 'main',
      threadId: 'topic-42',
      sessionKey: 'agent:main:whatsapp:direct:919999999999',
      chatId: undefined,
      channelId: undefined,
      toJid: '919999999999@s.whatsapp.net',
      conversationId: 'conv_1',
    });
  });

  it('falls back to the gateway default channel when runtime discovery is unavailable', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('unknown method: channels.status'))
      .mockResolvedValueOnce({
        runId: 'reply_run_1',
        messageId: 'msg_123',
        channel: 'telegram',
        toJid: '919999999999@s.whatsapp.net',
        conversationId: 'conv_1',
      });

    const result = await sendOpenClawChannelReply(
      {
        channel: 'whatsapp',
        to: '919999999999',
        message: 'We have received your refund request.',
        accountId: 'primary',
        agentId: 'main',
        threadId: 'topic-42',
        sessionKey: 'agent:main:whatsapp:direct:919999999999',
        idempotencyKey: 'run_7:reply',
      },
      { request } as never,
    );

    expect(request).toHaveBeenCalledWith(
      'send',
      {
        to: '919999999999',
        message: 'We have received your refund request.',
        accountId: 'primary',
        agentId: 'main',
        threadId: 'topic-42',
        sessionKey: 'agent:main:whatsapp:direct:919999999999',
        idempotencyKey: 'run_7:reply',
      },
      { signal: undefined },
    );
    expect(result).toEqual({
      runId: 'reply_run_1',
      messageId: 'msg_123',
      channel: 'telegram',
      to: '919999999999',
      accountId: 'primary',
      agentId: 'main',
      threadId: 'topic-42',
      sessionKey: 'agent:main:whatsapp:direct:919999999999',
      chatId: undefined,
      channelId: undefined,
      toJid: '919999999999@s.whatsapp.net',
      conversationId: 'conv_1',
    });
  });

  it('generates an idempotency key when the caller does not provide one', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('unknown method: channels.status'))
      .mockResolvedValueOnce({
        runId: 'reply_run_2',
        messageId: 'msg_456',
        channel: 'whatsapp',
      });

    await sendOpenClawChannelReply(
      {
        channel: 'whatsapp',
        to: '919999999999',
        message: 'Hello from test send',
      },
      { request } as never,
    );

    expect(request).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        to: '919999999999',
        message: 'Hello from test send',
        idempotencyKey: expect.stringMatching(/^send:/),
      }),
      { signal: undefined },
    );
  });

  it('falls back to the single connected runtime account when the requested account is stale', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        channelOrder: ['whatsapp'],
        channelLabels: {
          whatsapp: 'WhatsApp',
        },
        channelAccounts: {
          whatsapp: [
            { accountId: 'primary', enabled: true, configured: true, connected: false },
            { accountId: 'default', enabled: true, configured: true, connected: true },
          ],
        },
      })
      .mockResolvedValueOnce({
        runId: 'reply_run_3',
        messageId: 'msg_789',
        channel: 'whatsapp',
      });

    await sendOpenClawChannelReply(
      {
        channel: 'whatsapp',
        to: '919999999999',
        message: 'Fallback account test',
        accountId: 'primary',
      },
      { request } as never,
    );

    expect(request).toHaveBeenNthCalledWith(
      2,
      'send',
      expect.objectContaining({
        channel: 'whatsapp',
        accountId: 'default',
      }),
      { signal: undefined },
    );
  });
});

describe('loadOpenClawNodePrefillContext', () => {
  it('derives defaults and suggestions from gateway metadata', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        defaultId: 'ops',
        agents: [
          { id: 'ops', identity: { name: 'Operations' } },
          { id: 'finance', name: 'Finance agent' },
        ],
      })
      .mockResolvedValueOnce({
        models: [
          { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'openai' },
          { id: 'anthropic/claude-4-sonnet', name: 'Claude 4 Sonnet', provider: 'anthropic' },
        ],
      })
      .mockResolvedValueOnce({
        channelOrder: ['telegram', 'whatsapp'],
        channelLabels: {
          telegram: 'Telegram',
          whatsapp: 'WhatsApp',
        },
        channelAccounts: {
          telegram: [{ enabled: true, configured: true, connected: true }],
          whatsapp: [{ enabled: true, configured: true }],
        },
      })
      .mockResolvedValueOnce({
        skills: [
          {
            name: 'refund triage',
            skillKey: 'finance/refund-triage',
            eligible: true,
            disabled: false,
            blockedByAllowlist: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        skills: [
          {
            name: 'invoice lookup',
            skillKey: 'finance/invoice-lookup',
            eligible: true,
            disabled: false,
            blockedByAllowlist: false,
          },
        ],
      });

    const result = await loadOpenClawNodePrefillContext({ request } as never);

    expect(request).toHaveBeenNthCalledWith(1, 'agents.list', {});
    expect(request).toHaveBeenNthCalledWith(2, 'models.list', {});
    expect(request).toHaveBeenNthCalledWith(3, 'channels.status', {
      probe: false,
      timeoutMs: 2000,
    });
    expect(request).toHaveBeenNthCalledWith(4, 'skills.status', {
      agentId: 'ops',
    });
    expect(request).toHaveBeenNthCalledWith(5, 'skills.status', {
      agentId: 'finance',
    });
    expect(result).toEqual({
      defaultAgentId: 'ops',
      agentOptions: [
        { label: 'Operations (ops)', value: 'ops' },
        { label: 'Finance agent (finance)', value: 'finance' },
      ],
      preferredTargetAgentId: 'finance',
      skillOptions: [
        {
          label: 'refund triage (finance/refund-triage)',
          value: 'finance/refund-triage',
          scope: 'ops',
        },
        {
          label: 'invoice lookup (finance/invoice-lookup) - Finance agent (finance)',
          value: 'finance/invoice-lookup',
          scope: 'finance',
        },
      ],
      preferredSkillValue: 'finance/refund-triage',
      modelProviderOptions: [
        { label: 'openai', value: 'openai' },
        { label: 'anthropic', value: 'anthropic' },
      ],
      modelOptions: [
        {
          label: 'GPT-5.4 Mini (openai)',
          value: 'openai/gpt-5.4-mini',
          scope: 'openai',
        },
        {
          label: 'Claude 4 Sonnet (anthropic)',
          value: 'anthropic/claude-4-sonnet',
          scope: 'anthropic',
        },
      ],
      channelOptions: [
        { label: 'Telegram (telegram)', value: 'telegram' },
        { label: 'WhatsApp (whatsapp)', value: 'whatsapp' },
      ],
      preferredChannelId: 'telegram',
      channelProfileOptions: [],
      preferredChannelProfileId: undefined,
    });
  });
});
