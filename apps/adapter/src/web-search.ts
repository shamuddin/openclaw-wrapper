interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
  Result?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoSearchResponse {
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Results?: DuckDuckGoTopic[];
  RelatedTopics?: DuckDuckGoTopic[];
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      age?: string;
    }>;
  };
}

interface TavilySearchResponse {
  answer?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
  }>;
}

interface PerplexitySearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    date?: string;
    last_updated?: string;
  }>;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  source?: string;
}

export interface AdapterWebSearchInput {
  provider?: string;
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export type AdapterWebSearchOutputMode = 'results' | 'top-result' | 'top-result-url';

export interface AdapterWebSearchResult {
  provider: 'brave' | 'duckduckgo' | 'tavily' | 'perplexity';
  query: string;
  resultCount: number;
  answer?: string;
  results: WebSearchResultItem[];
}

type SearchProvider = AdapterWebSearchResult['provider'];

function normalizeProvider(value: unknown): SearchProvider {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  switch (normalized) {
    case '':
    case 'duckduckgo':
      return 'duckduckgo';
    case 'brave':
    case 'tavily':
    case 'perplexity':
      return normalized;
    default:
      throw new Error(
        `web search provider "${String(value)}" is not supported. Choose brave, duckduckgo, tavily, or perplexity.`,
      );
  }
}

function normalizeQuery(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function clampLimit(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 5;
  }
  return Math.min(parsed, 10);
}

function requireEnv(envVar: string, provider: SearchProvider): string {
  const value = process.env[envVar]?.trim();
  if (!value || value === 'undefined' || value === 'null') {
    throw new Error(
      `web search provider "${provider}" requires ${envVar} in the adapter environment.`,
    );
  }
  return value;
}

function trimText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateSnippet(value: string | undefined, maxLength = 280): string | undefined {
  const normalized = trimText(value);
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function compactEntries<T>(entries: Array<T | undefined>): T[] {
  return entries.filter((entry): entry is T => entry !== undefined);
}

function buildDuckDuckGoTitle(topic: DuckDuckGoTopic): string {
  const text = trimText(topic.Text) ?? stripHtml(topic.Result ?? '') ?? 'DuckDuckGo result';
  const separators = [' - ', ' — ', ': '];
  for (const separator of separators) {
    const [title] = text.split(separator);
    const normalized = trimText(title);
    if (normalized) return normalized;
  }
  return text;
}

function flattenDuckDuckGoTopics(topics: DuckDuckGoTopic[] | undefined): DuckDuckGoTopic[] {
  const result: DuckDuckGoTopic[] = [];
  for (const topic of topics ?? []) {
    if (Array.isArray(topic.Topics) && topic.Topics.length > 0) {
      result.push(...flattenDuckDuckGoTopics(topic.Topics));
      continue;
    }
    result.push(topic);
  }
  return result;
}

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  const raw = await response.text();
  if (!response.ok) {
    const detail = trimText(raw) ?? `${response.status} ${response.statusText}`.trim();
    throw new Error(`${label} failed: ${detail}`);
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} returned invalid JSON: ${detail}`);
  }
}

async function runDuckDuckGoSearch(
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<AdapterWebSearchResult> {
  const url = new URL('https://api.duckduckgo.com/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  });
  const payload = await parseJsonResponse<DuckDuckGoSearchResponse>(
    response,
    'DuckDuckGo web search',
  );

  const flattened = [...(payload.Results ?? []), ...flattenDuckDuckGoTopics(payload.RelatedTopics)];
  const results = compactEntries(
    flattened.map((entry) => {
      const url = trimText(entry.FirstURL);
      if (!url) return undefined;
      const result: WebSearchResultItem = {
        title: buildDuckDuckGoTitle(entry),
        url,
        snippet: truncateSnippet(trimText(entry.Text) ?? stripHtml(entry.Result ?? '')),
        source: 'DuckDuckGo',
      };
      return result;
    }),
  ).slice(0, limit);

  const answer = truncateSnippet(trimText(payload.AbstractText));
  const abstractUrl = trimText(payload.AbstractURL);
  if (answer && abstractUrl) {
    results.unshift({
      title: 'DuckDuckGo instant answer',
      url: abstractUrl,
      snippet: answer,
      source: trimText(payload.AbstractSource) ?? 'DuckDuckGo',
    });
  }

  return {
    provider: 'duckduckgo',
    query,
    resultCount: results.length,
    answer,
    results: results.slice(0, limit),
  };
}

async function runBraveSearch(
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<AdapterWebSearchResult> {
  const apiKey = requireEnv('BRAVE_API_KEY', 'brave');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(limit));

  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal,
  });
  const payload = await parseJsonResponse<BraveSearchResponse>(response, 'Brave web search');

  const results = compactEntries(
    (payload.web?.results ?? []).map((entry) => {
      const title = trimText(entry.title);
      const url = trimText(entry.url);
      if (!title || !url) return undefined;
      const result: WebSearchResultItem = {
        title,
        url,
        snippet: truncateSnippet(trimText(entry.description)),
        publishedAt: trimText(entry.age),
        source: 'Brave',
      };
      return result;
    }),
  ).slice(0, limit);

  return {
    provider: 'brave',
    query,
    resultCount: results.length,
    results,
  };
}

async function runTavilySearch(
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<AdapterWebSearchResult> {
  const apiKey = requireEnv('TAVILY_API_KEY', 'tavily');
  const response = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: true,
      max_results: limit,
    }),
    signal,
  });
  const payload = await parseJsonResponse<TavilySearchResponse>(response, 'Tavily web search');

  const results = compactEntries(
    (payload.results ?? []).map((entry) => {
      const title = trimText(entry.title);
      const url = trimText(entry.url);
      if (!title || !url) return undefined;
      const result: WebSearchResultItem = {
        title,
        url,
        snippet: truncateSnippet(trimText(entry.content)),
        publishedAt: trimText(entry.published_date),
        source: 'Tavily',
      };
      return result;
    }),
  ).slice(0, limit);

  return {
    provider: 'tavily',
    query,
    resultCount: results.length,
    answer: truncateSnippet(trimText(payload.answer)),
    results,
  };
}

async function runPerplexitySearch(
  query: string,
  limit: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<AdapterWebSearchResult> {
  const apiKey = requireEnv('PERPLEXITY_API_KEY', 'perplexity');
  const response = await fetchImpl('https://api.perplexity.ai/search', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      max_results: limit,
      max_tokens_per_page: 2048,
    }),
    signal,
  });
  const payload = await parseJsonResponse<PerplexitySearchResponse>(
    response,
    'Perplexity web search',
  );

  const results = compactEntries(
    (payload.results ?? []).map((entry) => {
      const title = trimText(entry.title);
      const url = trimText(entry.url);
      if (!title || !url) return undefined;
      const result: WebSearchResultItem = {
        title,
        url,
        snippet: truncateSnippet(trimText(entry.snippet)),
        publishedAt: trimText(entry.last_updated) ?? trimText(entry.date),
        source: 'Perplexity',
      };
      return result;
    }),
  ).slice(0, limit);

  return {
    provider: 'perplexity',
    query,
    resultCount: results.length,
    results,
  };
}

export async function runAdapterWebSearch(
  input: AdapterWebSearchInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AdapterWebSearchResult> {
  const provider = normalizeProvider(input.provider);
  const query = normalizeQuery(input.query);
  if (!query) {
    throw new Error('web search node requires a query');
  }

  const limit = clampLimit(input.limit);
  switch (provider) {
    case 'duckduckgo':
      return runDuckDuckGoSearch(query, limit, fetchImpl, input.signal);
    case 'brave':
      return runBraveSearch(query, limit, fetchImpl, input.signal);
    case 'tavily':
      return runTavilySearch(query, limit, fetchImpl, input.signal);
    case 'perplexity':
      return runPerplexitySearch(query, limit, fetchImpl, input.signal);
  }
}
