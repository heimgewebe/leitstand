import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Minimal event line structure (subset of event.line.schema.json from metarepo)
 */
export interface EventLine {
  /** ISO timestamp of the event */
  timestamp: string;
  /** Event kind/type (e.g., "ci.failure", "deploy.success") */
  kind: string;
  /** Repository name if applicable */
  repo?: string;
  /** Job name if applicable */
  job?: string;
  /** Severity level if applicable */
  severity?: string;
  /** Additional payload data */
  payload?: Record<string, unknown>;
}

/**
 * Parses a single JSONL line into an EventLine
 */
function parseEventLine(line: string): EventLine | null {
  try {
    const trimmed = line.trim();
    if (!trimmed) return null;
    
    const data = JSON.parse(trimmed);
    
    // Basic validation
    if (!data.timestamp || !data.kind) {
      return null;
    }
    
    return {
      timestamp: data.timestamp,
      kind: data.kind,
      repo: data.repo,
      job: data.job,
      severity: data.severity,
      payload: data.payload,
    };
  } catch {
    // Silently skip invalid lines
    return null;
  }
}

/**
 * Loads events from chronik JSONL files within a time window
 * 
 * @param dataDir - Directory containing JSONL event files
 * @param since - Start of time window (inclusive)
 * @param until - End of time window (exclusive)
 * @returns Array of events within the time window, sorted by timestamp (newest first)
 */
export async function loadRecentEvents(
  dataDir: string,
  since: Date,
  until: Date
): Promise<EventLine[]> {
  try {
    const files = await readdir(dataDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    
    const sinceIso = since.toISOString();
    const untilIso = until.toISOString();
    
    const filePromises = jsonlFiles.map(async (file) => {
      const filePath = join(dataDir, file);
      // We read file directly since it is JSONL, not a single JSON object
      // So we don't use readJsonFile here
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      const fileEvents: EventLine[] = [];
      for (const line of lines) {
        const event = parseEventLine(line);
        if (!event) continue;
        
        if (event.timestamp >= sinceIso && event.timestamp < untilIso) {
          fileEvents.push(event);
        }
      }
      return fileEvents;
    });

    const results = await Promise.all(filePromises);
    const events = results.flat();
    
    // Sort by timestamp, newest first
    // Optimization: ISO 8601 strings can be compared lexicographically
    events.sort((a, b) => {
      if (b.timestamp > a.timestamp) return 1;
      if (b.timestamp < a.timestamp) return -1;
      return 0;
    });
    
    return events;
  } catch (error) {
    throw new Error(`Failed to load events: ${error instanceof Error ? error.message : String(error)}`);
  }
}
