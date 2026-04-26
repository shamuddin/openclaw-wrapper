import type {
  MemoryQueryInput,
  MemoryQueryMatch,
  MemoryQueryResult,
} from '@openclaw-wrapper/schemas';
import type { MemoryEntry } from './runtime.js';

function normalizeText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase();
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return '';
  }
}

function scoreMatch(entry: MemoryEntry, query: string | undefined, keyPrefix: string | undefined) {
  const matchedOn = new Set<string>();
  let score = 0;

  if (keyPrefix) {
    if (!entry.key.toLowerCase().startsWith(keyPrefix)) {
      return null;
    }
    matchedOn.add('keyPrefix');
    score += 3;
  }

  if (query) {
    const normalizedKey = entry.key.toLowerCase();
    const normalizedValue = normalizeText(entry.value);
    if (normalizedKey.includes(query)) {
      matchedOn.add('key');
      score += normalizedKey.startsWith(query) ? 5 : 3;
    }
    if (normalizedValue.includes(query)) {
      matchedOn.add('value');
      score += 2;
    }
    if (matchedOn.size === 0) {
      return null;
    }
  }

  if (!query && !keyPrefix) {
    matchedOn.add('recent');
    score = 1;
  }

  return {
    score,
    matchedOn: [...matchedOn],
  };
}

export function queryMemoryEntries(
  entries: MemoryEntry[],
  input: MemoryQueryInput,
): MemoryQueryResult {
  const namespace = input.namespace ?? 'all';
  const normalizedQuery = input.query?.trim().toLowerCase() || undefined;
  const normalizedPrefix = input.keyPrefix?.trim().toLowerCase() || undefined;
  const limit = input.limit ?? 10;

  const filtered = entries
    .filter((entry) => namespace === 'all' || entry.namespace === namespace)
    .map((entry) => {
      const match = scoreMatch(entry, normalizedQuery, normalizedPrefix);
      if (!match) {
        return null;
      }
      const result: MemoryQueryMatch = {
        namespace: entry.namespace,
        scopeId: entry.scopeId,
        key: entry.key,
        value: entry.value,
        score: match.score,
        matchedOn: match.matchedOn,
        ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      };
      return result;
    })
    .filter((entry): entry is MemoryQueryMatch => entry !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.updatedAt && right.updatedAt && left.updatedAt !== right.updatedAt) {
        return right.updatedAt.localeCompare(left.updatedAt);
      }
      return left.key.localeCompare(right.key);
    });

  return {
    namespace,
    ...(input.keyPrefix?.trim() ? { keyPrefix: input.keyPrefix.trim() } : {}),
    ...(input.query?.trim() ? { query: input.query.trim() } : {}),
    limit,
    totalMatches: filtered.length,
    matches: filtered.slice(0, limit),
  };
}
