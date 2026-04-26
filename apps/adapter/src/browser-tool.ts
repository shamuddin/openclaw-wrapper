export interface AdapterBrowserInput {
  action?: 'open' | 'extract' | 'click';
  target: string;
  selector?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BrowserLink {
  text: string;
  href: string;
}

export interface BrowserMetadataExtract {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  finalUrl: string;
  status: number;
  statusText: string;
}

export interface BrowserHeadingExtract {
  level: number;
  text: string;
  id?: string;
}

export interface AdapterBrowserResult {
  action: 'open' | 'extract' | 'click';
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  title?: string;
  description?: string;
  htmlPreview: string;
  textPreview: string;
  links: BrowserLink[];
  extracted?: unknown;
  clickedTarget?: string;
}

interface LoadedPage {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  html: string;
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  text: string;
  links: BrowserLink[];
}

function normalizeAction(value: unknown): AdapterBrowserResult['action'] {
  switch (value) {
    case 'extract':
    case 'click':
      return value;
    default:
      return 'open';
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clampTimeoutMs(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 30_000;
  }
  return Math.min(parsed, 120_000);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/giu, ' ')
      .replace(/<style[\s\S]*?<\/style>/giu, ' ')
      .replace(/<[^>]+>/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  );
}

function truncate(value: string, maxLength = 4000): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function matchTagContent(html: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(html);
  return match?.[1] ? stripHtml(match[1]) : undefined;
}

function matchMetaContent(
  html: string,
  name: string,
  attribute: 'name' | 'property',
): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]*${attribute}=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    'iu',
  );
  const reversePattern = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${name}["'][^>]*>`,
    'iu',
  );
  const value = pattern.exec(html)?.[1] ?? reversePattern.exec(html)?.[1];
  return value ? decodeHtmlEntities(value.trim()) : undefined;
}

function extractLinks(html: string, baseUrl: string): BrowserLink[] {
  const matches = html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu);
  const links: BrowserLink[] = [];

  for (const match of matches) {
    const hrefRaw = match[1] ? decodeHtmlEntities(match[1].trim()) : '';
    if (!hrefRaw) continue;

    let href = hrefRaw;
    try {
      href = new URL(hrefRaw, baseUrl).toString();
    } catch {
      continue;
    }

    const text = stripHtml(match[2] ?? '') || href;
    links.push({ text, href });
  }

  return links.slice(0, 20);
}

function extractHeadings(html: string): BrowserHeadingExtract[] {
  const matches = html.matchAll(/<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/giu);
  const headings: BrowserHeadingExtract[] = [];

  for (const match of matches) {
    const tagName = normalizeText(match[1]).toLowerCase();
    const attrs = match[2] ?? '';
    const text = stripHtml(match[3] ?? '');
    if (!tagName || !text) {
      continue;
    }

    const id = attrs.match(/\bid=["']([^"']+)["']/iu)?.[1];
    headings.push({
      level: Number.parseInt(tagName.slice(1), 10),
      text,
      ...(id ? { id: decodeHtmlEntities(id.trim()) } : {}),
    });
  }

  return headings.slice(0, 30);
}

function extractJsonLd(html: string): unknown {
  const matches = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  );
  const parsedEntries: unknown[] = [];

  for (const match of matches) {
    const raw = normalizeText(match[1]);
    if (!raw) {
      continue;
    }

    try {
      parsedEntries.push(JSON.parse(raw));
    } catch {
      // Ignore malformed blocks and keep searching for valid structured data.
    }
  }

  if (parsedEntries.length === 0) {
    throw new Error('browser extract could not find valid JSON-LD on the page');
  }

  return parsedEntries.length === 1 ? parsedEntries[0] : parsedEntries;
}

async function loadPage(
  target: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<LoadedPage> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`browser target is not a valid URL: ${detail}`);
  }

  const controller = new AbortController();
  const abortHandler = () => {
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) {
    abortHandler();
  } else {
    signal?.addEventListener('abort', abortHandler, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  let response: Response;
  try {
    response = await fetchImpl(parsedUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    const detail =
      error instanceof Error && error.name === 'AbortError'
        ? `browser request timed out after ${timeoutMs}ms`
        : `browser request failed: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(detail);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortHandler);
  }

  const html = await response.text();
  if (!response.ok) {
    throw new Error(
      `browser request failed with status ${response.status} ${response.statusText}`.trim(),
    );
  }

  return {
    url: parsedUrl.toString(),
    finalUrl: response.url || parsedUrl.toString(),
    status: response.status,
    statusText: response.statusText,
    html,
    title: matchTagContent(html, /<title[^>]*>([\s\S]*?)<\/title>/iu),
    description: matchMetaContent(html, 'description', 'name'),
    ogTitle: matchMetaContent(html, 'og:title', 'property'),
    ogDescription: matchMetaContent(html, 'og:description', 'property'),
    text: stripHtml(html),
    links: extractLinks(html, response.url || parsedUrl.toString()),
  };
}

function extractContent(page: LoadedPage, selector: string): unknown {
  const normalized = selector.trim().toLowerCase();
  if (!normalized || normalized === 'text') {
    return truncate(page.text);
  }
  if (normalized === 'html') {
    return truncate(page.html);
  }
  if (normalized === 'title') {
    if (!page.title) throw new Error('browser extract could not find a page title');
    return page.title;
  }
  if (normalized === 'meta:description') {
    if (!page.description) throw new Error('browser extract could not find meta description');
    return page.description;
  }
  if (normalized === 'meta:og:title') {
    if (!page.ogTitle) throw new Error('browser extract could not find og:title');
    return page.ogTitle;
  }
  if (normalized === 'meta:og:description') {
    if (!page.ogDescription) throw new Error('browser extract could not find og:description');
    return page.ogDescription;
  }
  if (normalized === 'links') {
    return page.links;
  }
  if (normalized === 'headings') {
    const headings = extractHeadings(page.html);
    if (headings.length === 0) {
      throw new Error('browser extract could not find any headings on the page');
    }
    return headings;
  }
  if (normalized === 'jsonld') {
    return extractJsonLd(page.html);
  }
  if (normalized === 'metadata') {
    return {
      title: page.title,
      description: page.description,
      ogTitle: page.ogTitle,
      ogDescription: page.ogDescription,
      finalUrl: page.finalUrl,
      status: page.status,
      statusText: page.statusText,
    };
  }
  if (normalized.startsWith('link:')) {
    return resolveClickTarget(page, normalized.slice('link:'.length));
  }

  throw new Error(
    'browser extract currently supports text, html, title, headings, jsonld, meta:description, meta:og:title, meta:og:description, links, link:<hint>, or metadata.',
  );
}

function resolveClickTarget(page: LoadedPage, selector: string): BrowserLink {
  const normalized = selector.trim().toLowerCase();
  if (!normalized) {
    throw new Error('browser click requires a link hint');
  }

  if (normalized.startsWith('index:')) {
    const requestedIndex = Number.parseInt(normalized.slice('index:'.length).trim(), 10);
    if (!Number.isInteger(requestedIndex) || requestedIndex <= 0) {
      throw new Error('browser click index must be a positive 1-based integer');
    }
    const byIndex = page.links[requestedIndex - 1];
    if (!byIndex) {
      throw new Error(`browser click could not find link index ${requestedIndex}`);
    }
    return byIndex;
  }

  const exactMatch = normalized.match(/^exact:(text|href):(.+)$/u);
  if (exactMatch) {
    const mode = exactMatch[1];
    const needle = exactMatch[2]?.trim() ?? '';
    const match = page.links.find((link) =>
      mode === 'href' ? link.href.toLowerCase() === needle : link.text.toLowerCase() === needle,
    );
    if (!match) {
      throw new Error(
        `browser click could not find an exact ${mode} match for "${selector.trim()}"`,
      );
    }
    return match;
  }

  const [mode, rawNeedle] = normalized.includes(':')
    ? normalized.split(/:(.+)/u, 2)
    : [undefined, normalized];
  const needle = rawNeedle?.trim() ?? normalized;

  const match = page.links.find((link) => {
    const href = link.href.toLowerCase();
    const text = link.text.toLowerCase();
    if (mode === 'href') return href.includes(needle);
    if (mode === 'text') return text.includes(needle);
    return href.includes(needle) || text.includes(needle);
  });

  if (!match) {
    throw new Error(`browser click could not find a link matching "${selector.trim()}"`);
  }

  return match;
}

function buildBrowserResult(
  page: LoadedPage,
  action: AdapterBrowserResult['action'],
  extra?: Pick<AdapterBrowserResult, 'extracted' | 'clickedTarget'>,
): AdapterBrowserResult {
  return {
    action,
    url: page.url,
    finalUrl: page.finalUrl,
    status: page.status,
    statusText: page.statusText,
    title: page.title,
    description: page.description,
    htmlPreview: truncate(page.html),
    textPreview: truncate(page.text),
    links: page.links,
    ...(extra ?? {}),
  };
}

export async function runAdapterBrowser(
  input: AdapterBrowserInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AdapterBrowserResult> {
  const action = normalizeAction(input.action);
  const target = normalizeText(input.target);
  if (!target) {
    throw new Error('browser node requires a target URL');
  }

  const selector = normalizeText(input.selector);
  const timeoutMs = clampTimeoutMs(input.timeoutMs);
  const initialPage = await loadPage(target, timeoutMs, fetchImpl, input.signal);

  if (action === 'open') {
    return buildBrowserResult(initialPage, action);
  }

  if (action === 'extract') {
    return buildBrowserResult(initialPage, action, {
      extracted: extractContent(initialPage, selector),
    });
  }

  const clickedLink = resolveClickTarget(initialPage, selector);
  const clickedPage = await loadPage(clickedLink.href, timeoutMs, fetchImpl, input.signal);
  return buildBrowserResult(clickedPage, action, {
    clickedTarget: clickedLink.href,
  });
}
