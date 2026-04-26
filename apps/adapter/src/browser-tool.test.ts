import { describe, expect, it, vi } from 'vitest';
import { runAdapterBrowser } from './browser-tool.js';

describe('runAdapterBrowser', () => {
  it('extracts a headings outline from static HTML', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><body><h1 id="intro">Refunds</h1><section><h2>Eligibility</h2><h3>Exceptions</h3></section></body></html>',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
        },
      ),
    );

    const result = await runAdapterBrowser(
      {
        action: 'extract',
        target: 'https://example.com/refunds',
        selector: 'headings',
      },
      fetchMock,
    );

    expect(result.extracted).toEqual([
      { level: 1, text: 'Refunds', id: 'intro' },
      { level: 2, text: 'Eligibility' },
      { level: 3, text: 'Exceptions' },
    ]);
  });

  it('extracts JSON-LD from a page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","name":"Refund FAQ"}</script></head><body>Refund FAQ</body></html>',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
        },
      ),
    );

    const result = await runAdapterBrowser(
      {
        action: 'extract',
        target: 'https://example.com/refunds',
        selector: 'jsonld',
      },
      fetchMock,
    );

    expect(result.extracted).toEqual({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      name: 'Refund FAQ',
    });
  });

  it('extracts a specific discovered link by hint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        '<html><body><a href="/pricing">Pricing</a><a href="/refunds">Refund policy</a></body></html>',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
        },
      ),
    );

    const result = await runAdapterBrowser(
      {
        action: 'extract',
        target: 'https://example.com',
        selector: 'link:text:refund policy',
      },
      fetchMock,
    );

    expect(result.extracted).toEqual({
      text: 'Refund policy',
      href: 'https://example.com/refunds',
    });
  });

  it('clicks a discovered link by 1-based index', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<html><body><a href="/docs">Docs</a><a href="/refunds">Refunds</a></body></html>',
          {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/html' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response('<html><head><title>Refunds</title></head><body>Policy</body></html>', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
        }),
      );

    const result = await runAdapterBrowser(
      {
        action: 'click',
        target: 'https://example.com',
        selector: 'index:2',
      },
      fetchMock,
    );

    expect(result.clickedTarget).toBe('https://example.com/refunds');
    expect(result.title).toBe('Refunds');
  });
});
