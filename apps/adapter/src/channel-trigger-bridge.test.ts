import { describe, expect, it, vi } from 'vitest';
import {
  extractFirstTextBlock,
  handleInboundChannelSessionMessage,
  normalizeInboundChannelSessionEvent,
  startLiveChannelTriggerBridge,
} from './channel-trigger-bridge.js';
import { RunLaunchError } from './run-service.js';

describe('channel-trigger-bridge', () => {
  it('extracts the first text block from gateway transcript messages', () => {
    expect(
      extractFirstTextBlock({
        content: [
          { type: 'image', url: 'https://example.com/image.png' },
          { type: 'text', text: 'Customer asked for a refund' },
        ],
      }),
    ).toBe('Customer asked for a refund');
  });

  it('normalizes inbound session.message payloads into channel trigger input', () => {
    expect(
      normalizeInboundChannelSessionEvent({
        sessionKey: 'agent:main:whatsapp:direct:916383935822',
        messageId: 'msg_42',
        messageSeq: 7,
        lastChannel: 'whatsapp',
        lastTo: '916383935822',
        lastAccountId: 'primary',
        lastThreadId: 123,
        deliveryContext: {
          routeKey: 'support.inbox',
        },
        origin: {
          chatId: '916383935822',
        },
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Refund order 42 please' }],
        },
      }),
    ).toEqual({
      channel: 'whatsapp',
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
      sourceId: 'msg_42',
      message: 'Refund order 42 please',
      messageId: 'msg_42',
      messageSeq: 7,
      to: '916383935822',
      accountId: 'primary',
      routeKey: 'support.inbox',
      threadId: '123',
      raw: expect.objectContaining({
        lastChannel: 'whatsapp',
      }),
    });
  });

  it('ignores non-user session messages', () => {
    expect(
      normalizeInboundChannelSessionEvent({
        sessionKey: 'agent:main:whatsapp:direct:916383935822',
        lastChannel: 'whatsapp',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is your refund update' }],
        },
      }),
    ).toBeNull();
  });

  it('launches matching published flows once and dedupes repeated inbound events', async () => {
    const launchRun = vi
      .fn()
      .mockResolvedValueOnce({ id: 'run_1' })
      .mockRejectedValueOnce(
        new RunLaunchError('TRIGGER_NOT_MATCHED', 'trigger.channel routeKey did not match'),
      );
    const executeRun = vi.fn();
    const recent = {
      seen: new Set<string>(),
      has(key: string) {
        return this.seen.has(key);
      },
      add(key: string) {
        this.seen.add(key);
      },
    } as const;

    const payload = {
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
      messageId: 'msg_42',
      messageSeq: 7,
      lastChannel: 'whatsapp',
      lastTo: '916383935822',
      lastAccountId: 'primary',
      deliveryContext: {
        routeKey: 'support.inbox',
        threadId: 'support-thread',
      },
      origin: {
        channel: 'whatsapp',
      },
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Refund order 42 please' }],
      },
    };

    const launched = await handleInboundChannelSessionMessage({
      db: {} as never,
      payload,
      listCandidateFlowIds: vi.fn().mockResolvedValue(['flow_1', 'flow_2']),
      launchRun,
      executeRun,
      recentEvents: recent,
    });

    expect(launched).toBe(1);
    expect(launchRun).toHaveBeenNthCalledWith(1, {} as never, {
      flowId: 'flow_1',
      trigger: {
        type: 'channel',
        label: 'whatsapp inbound',
        channel: 'whatsapp',
        sourceId: 'msg_42',
        accountId: 'primary',
        routeKey: 'support.inbox',
      },
      input: expect.objectContaining({
        channelType: 'whatsapp',
        sessionKey: 'agent:main:whatsapp:direct:916383935822',
        sourceId: 'msg_42',
        message: 'Refund order 42 please',
        messageId: 'msg_42',
        messageSeq: 7,
        to: '916383935822',
        accountId: 'primary',
        routeKey: 'support.inbox',
        threadId: 'support-thread',
      }),
    });
    expect(executeRun).toHaveBeenCalledWith({} as never, 'run_1', expect.any(Object));

    const launchedAgain = await handleInboundChannelSessionMessage({
      db: {} as never,
      payload,
      listCandidateFlowIds: vi.fn().mockResolvedValue(['flow_1']),
      launchRun,
      executeRun,
      recentEvents: recent,
    });

    expect(launchedAgain).toBe(0);
    expect(launchRun).toHaveBeenCalledTimes(2);
  });

  it('does not dedupe separate live events when the gateway omits message ids', async () => {
    const launchRun = vi
      .fn()
      .mockResolvedValueOnce({ id: 'run_live_1' })
      .mockResolvedValueOnce({ id: 'run_live_2' });
    const executeRun = vi.fn();
    const recent = {
      seen: new Set<string>(),
      has(key: string) {
        return this.seen.has(key);
      },
      add(key: string) {
        this.seen.add(key);
      },
    } as const;

    const payload = {
      sessionKey: 'agent:main:whatsapp:direct:916383935822',
      lastChannel: 'whatsapp',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
      },
    };

    const first = await handleInboundChannelSessionMessage({
      db: {} as never,
      payload,
      listCandidateFlowIds: vi.fn().mockResolvedValue(['flow_1']),
      launchRun,
      executeRun,
      recentEvents: recent,
    });
    const second = await handleInboundChannelSessionMessage({
      db: {} as never,
      payload,
      listCandidateFlowIds: vi.fn().mockResolvedValue(['flow_1']),
      launchRun,
      executeRun,
      recentEvents: recent,
    });

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(launchRun).toHaveBeenCalledTimes(2);
  });

  it('subscribes to live session events and launches runs from session.message frames', async () => {
    const connectedListeners = new Set<() => void>();
    const eventListeners = new Set<(event: { event: string; payload?: unknown }) => void>();
    const connect = vi.fn().mockResolvedValue(undefined);
    const isConnected = vi.fn().mockReturnValue(false);
    const request = vi.fn().mockResolvedValue(undefined);
    const launchRun = vi.fn().mockResolvedValue({ id: 'run_live_1' });
    const executeRun = vi.fn();

    const stop = startLiveChannelTriggerBridge({
      db: {} as never,
      client: {
        connect,
        isConnected,
        request,
        onConnected(listener: () => void) {
          connectedListeners.add(listener);
          return () => {
            connectedListeners.delete(listener);
          };
        },
        onEvent(listener: (event: { event: string; payload?: unknown }) => void) {
          eventListeners.add(listener);
          return () => {
            eventListeners.delete(listener);
          };
        },
      } as never,
      launchRun,
      executeRun,
      listCandidateFlowIds: vi.fn().mockResolvedValue(['flow_live_1']),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(request).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);

    for (const listener of connectedListeners) {
      listener();
    }
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('sessions.subscribe', {});

    for (const listener of eventListeners) {
      listener({
        event: 'session.message',
        payload: {
          sessionKey: 'agent:main:whatsapp:direct:916383935822',
          messageId: 'msg_live_1',
          lastChannel: 'whatsapp',
          lastTo: '916383935822',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Need help with a refund' }],
          },
        },
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(launchRun).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        flowId: 'flow_live_1',
        trigger: expect.objectContaining({
          type: 'channel',
          channel: 'whatsapp',
        }),
      }),
    );
    expect(executeRun).toHaveBeenCalledWith({} as never, 'run_live_1', expect.any(Object));

    stop();
    expect(connectedListeners.size).toBe(0);
    expect(eventListeners.size).toBe(0);
  });
});
