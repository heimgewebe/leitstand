import { readFile } from 'fs/promises';

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
}

/**
 * Loads daily insights from a semantAH today.json file
 * 
 * @param path - Path to the today.json file
 * @returns Parsed daily insights
 * @throws Error if file cannot be read or parsed
 */
export async function loadDailyInsights(path: string): Promise<DailyInsights> {
  try {
    const content = await readFile(path, 'utf-8');
    const data = JSON.parse(content);
    
    // Basic validation
    if (!data.ts || typeof data.ts !== 'string') {
      throw new Error('Missing or invalid "ts" field');
    }
    
    return {
      ts: data.ts,
      topics: Array.isArray(data.topics) ? data.topics : [],
      questions: Array.isArray(data.questions) ? data.questions : [],
      deltas: Array.isArray(data.deltas) ? data.deltas : [],
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in insights file: ${error.message}`);
    }
    throw new Error(`Failed to load insights: ${error instanceof Error ? error.message : String(error)}`);
  }
}
