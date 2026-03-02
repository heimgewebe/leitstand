import { readJsonFile } from './utils/fs.js';

/**
 * Topic with frequency count from semantic analysis
 */
export type Topic = [string, number];

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
  /** Optional metadata */
  metadata?: {
    observatory_ref?: string;
    uncertainty?: number;
    [key: string]: unknown;
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
  interface RawInsights {
    ts?: string;
    topics?: unknown[];
    questions?: unknown[];
    deltas?: unknown[];
    source?: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  }
  const rawData = await readJsonFile<unknown>(path);

  if (typeof rawData !== 'object' || rawData === null || Array.isArray(rawData)) {
    throw new Error('Invalid insights payload: expected a JSON object');
  }

  const data = rawData as RawInsights;

  // Basic validation
  if (!data.ts || typeof data.ts !== 'string') {
    throw new Error('Missing or invalid "ts" field');
  }

  // Validate topics structure
  const topics: Topic[] = (Array.isArray(data.topics) ? data.topics : [])
    .filter((t: unknown): t is Topic =>
      Array.isArray(t) &&
      t.length === 2 &&
      typeof t[0] === 'string' &&
      typeof t[1] === 'number'
    );

  return {
    ts: data.ts,
    topics,
    questions: Array.isArray(data.questions) ? data.questions.filter((q: unknown): q is string => typeof q === 'string') : [],
    deltas: Array.isArray(data.deltas) ? data.deltas.filter((d: unknown): d is string => typeof d === 'string') : [],
    source: typeof data.source === 'string' ? data.source : undefined,
    metadata: typeof data.metadata === 'object' && data.metadata !== null ? data.metadata : undefined,
  };
}
