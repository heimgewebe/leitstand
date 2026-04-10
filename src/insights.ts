import { readJsonFile } from './utils/fs.js';

/**
 * Topic with frequency count from semantic analysis
 */
export type Topic = [string, number];

export interface InsightDataRefEntry {
  refs: string[];
  drilldown_url?: string;
}

export interface InsightDataRefs {
  topics?: Record<string, InsightDataRefEntry>;
  questions?: Record<string, InsightDataRefEntry>;
  deltas?: Record<string, InsightDataRefEntry>;
}

/**
 * Daily insights from semantAH
 */
export interface DailyInsights {
  /** ISO date string (YYYY-MM-DD) */
  ts: string;
  /** Topics with their frequency counts */
  topics: Topic[];
  /** Semantic questions extracted */
  questions: string[];
  /** Delta/changes detected */
  deltas: string[];
  /** Optional source identifier */
  source?: string;
  /** Optional per-insight data references for traceability */
  data_refs?: InsightDataRefs;
  /** Optional metadata */
  metadata?: {
    generated_at?: string;
    observatory_ref?: string;
    uncertainty?: number;
    [key: string]: unknown;
  };
}

interface RawInsights {
  ts?: unknown;
  topics?: unknown;
  questions?: unknown;
  deltas?: unknown;
  source?: unknown;
  data_refs?: unknown;
  metadata?: unknown;
}

interface SanitizedIndexedItems<T> {
  items: T[];
  indexMap: Map<number, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeMetadata(rawMetadata: unknown): DailyInsights['metadata'] | undefined {
  if (!isRecord(rawMetadata)) {
    return undefined;
  }

  const metadata: Record<string, unknown> = { ...rawMetadata };

  if (typeof metadata.generated_at !== 'string') {
    delete metadata.generated_at;
  }

  if (typeof metadata.observatory_ref !== 'string') {
    delete metadata.observatory_ref;
  }

  if (typeof metadata.uncertainty === 'number' && Number.isFinite(metadata.uncertainty)) {
    if (metadata.uncertainty < 0 || metadata.uncertainty > 1) {
      delete metadata.uncertainty;
    }
  } else {
    delete metadata.uncertainty;
  }

  return Object.keys(metadata).length > 0 ? (metadata as DailyInsights['metadata']) : undefined;
}

function isSafeDrilldownUrl(value: string): boolean {
  // Allow only internal absolute paths (single leading slash).
  return /^\/(?!\/)/.test(value);
}

function isTopic(value: unknown): value is Topic {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function sanitizeIndexedItems<T>(
  rawItems: unknown,
  isValidItem: (value: unknown) => value is T,
): SanitizedIndexedItems<T> {
  const items: T[] = [];
  const indexMap = new Map<number, number>();

  if (!Array.isArray(rawItems)) {
    return { items, indexMap };
  }

  for (let index = 0; index < rawItems.length; index++) {
    const item = rawItems[index];
    if (!isValidItem(item)) {
      continue;
    }

    indexMap.set(index, items.length);
    items.push(item);
  }

  return { items, indexMap };
}

function sanitizeDataRefEntry(rawEntry: unknown): InsightDataRefEntry | undefined {
  if (!isRecord(rawEntry)) {
    return undefined;
  }

  const refs = Array.isArray(rawEntry.refs)
    ? rawEntry.refs
      .filter((ref: unknown): ref is string => typeof ref === 'string')
      .map((ref) => ref.trim())
      .filter((ref) => ref.length > 0)
    : [];

  if (refs.length === 0) {
    return undefined;
  }

  const drilldown = typeof rawEntry.drilldown_url === 'string' ? rawEntry.drilldown_url.trim() : '';

  return {
    refs,
    drilldown_url: drilldown && isSafeDrilldownUrl(drilldown) ? drilldown : undefined,
  };
}

function sanitizeDataRefSection(rawSection: unknown): Record<string, InsightDataRefEntry> | undefined {
  if (!isRecord(rawSection)) {
    return undefined;
  }

  const section: Record<string, InsightDataRefEntry> = {};
  const canonicalSources = new Map<string, boolean>();
  for (const [key, value] of Object.entries(rawSection)) {
    if (!/^\d+$/.test(key)) {
      continue;
    }

    const canonicalKey = String(Number(key));
    const isCanonicalKey = key === canonicalKey;
    const entry = sanitizeDataRefEntry(value);
    if (!entry) {
      continue;
    }

    const currentIsCanonical = canonicalSources.get(canonicalKey) ?? false;
    if (!Object.prototype.hasOwnProperty.call(section, canonicalKey) || (!currentIsCanonical && isCanonicalKey)) {
      section[canonicalKey] = entry;
      canonicalSources.set(canonicalKey, isCanonicalKey);
    }
  }

  return Object.keys(section).length > 0 ? section : undefined;
}

function sanitizeDataRefs(rawDataRefs: unknown): InsightDataRefs | undefined {
  if (!isRecord(rawDataRefs)) {
    return undefined;
  }

  const topics = sanitizeDataRefSection(rawDataRefs.topics);
  const questions = sanitizeDataRefSection(rawDataRefs.questions);
  const deltas = sanitizeDataRefSection(rawDataRefs.deltas);

  if (!topics && !questions && !deltas) {
    return undefined;
  }

  return {
    topics,
    questions,
    deltas,
  };
}

function remapDataRefSection(
  section: Record<string, InsightDataRefEntry> | undefined,
  indexMap: Map<number, number>,
): Record<string, InsightDataRefEntry> | undefined {
  if (!section || indexMap.size === 0) {
    return undefined;
  }

  const remapped: Record<string, InsightDataRefEntry> = {};
  for (const [key, value] of Object.entries(section)) {
    const nextIndex = indexMap.get(Number(key));
    if (nextIndex !== undefined) {
      remapped[String(nextIndex)] = value;
    }
  }

  return Object.keys(remapped).length > 0 ? remapped : undefined;
}

function remapDataRefsToSanitizedContent(
  dataRefs: InsightDataRefs | undefined,
  indexMaps: {
    topics: Map<number, number>;
    questions: Map<number, number>;
    deltas: Map<number, number>;
  },
): InsightDataRefs | undefined {
  if (!dataRefs) {
    return undefined;
  }

  const topics = remapDataRefSection(dataRefs.topics, indexMaps.topics);
  const questions = remapDataRefSection(dataRefs.questions, indexMaps.questions);
  const deltas = remapDataRefSection(dataRefs.deltas, indexMaps.deltas);

  if (!topics && !questions && !deltas) {
    return undefined;
  }

  return {
    topics,
    questions,
    deltas,
  };
}

export function sanitizeDailyInsights(rawData: unknown, options?: { requireTs?: boolean }): DailyInsights | null {
  if (!isRecord(rawData)) {
    return null;
  }

  const data = rawData as RawInsights;
  const normalizedTs = typeof data.ts === 'string' ? data.ts.trim() : '';
  if (options?.requireTs && normalizedTs === '') {
    return null;
  }

  const sanitizedTopics = sanitizeIndexedItems(data.topics, isTopic);
  const sanitizedQuestions = sanitizeIndexedItems(data.questions, isString);
  const sanitizedDeltas = sanitizeIndexedItems(data.deltas, isString);

  const topics = sanitizedTopics.items;
  const questions = sanitizedQuestions.items;
  const deltas = sanitizedDeltas.items;

  if (normalizedTs === '' && topics.length === 0 && questions.length === 0 && deltas.length === 0) {
    return null;
  }

  const dataRefs = remapDataRefsToSanitizedContent(sanitizeDataRefs(data.data_refs), {
    topics: sanitizedTopics.indexMap,
    questions: sanitizedQuestions.indexMap,
    deltas: sanitizedDeltas.indexMap,
  });

  return {
    ts: normalizedTs,
    topics,
    questions,
    deltas,
    source: typeof data.source === 'string' ? data.source : undefined,
    data_refs: dataRefs,
    metadata: sanitizeMetadata(data.metadata),
  };
}

/**
 * Loads daily insights from a semantAH today.json file
 * 
 * @param path - Path to the today.json file
 * @returns Parsed daily insights
 * @throws Error if file cannot be read or parsed
 */
export async function loadDailyInsights(path: string): Promise<DailyInsights> {
  const rawData = await readJsonFile<unknown>(path);
  const insights = sanitizeDailyInsights(rawData, { requireTs: true });

  if (!insights) {
    throw new Error('Invalid insights payload: missing or invalid required fields');
  }

  return insights;
}
