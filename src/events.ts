import { readdir } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
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
function parseEventLine(line: string, onWarn?: (msg: string) => void): EventLine | null {
  try {
    const trimmed = line.trim();
    if (!trimmed) return null;
    
    const data = JSON.parse(trimmed);
    
    // Basic validation
    if (!data.timestamp || !data.kind) {
      return null;
    }
    
    // Ensure timestamp is in canonical ISO 8601 format for lexicographical sorting
    const d = new Date(data.timestamp);
    if (Number.isNaN(d.getTime())) {
      onWarn?.(`Invalid timestamp in line: ${line.substring(0, 100)}...`);
      return null;
    }
    const timestamp = d.toISOString();

    return {
      timestamp,
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
    
    // Process files in batches to limit concurrency
    const BATCH_SIZE = 8;
    const results: EventLine[][] = [];

    for (let i = 0; i < jsonlFiles.length; i += BATCH_SIZE) {
      const batch = jsonlFiles.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (file) => {
        const filePath = join(dataDir, file);
        
        const fileEvents: EventLine[] = [];
        let warnings = 0;
        const MAX_WARNINGS = 1;

        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          const event = parseEventLine(line, (msg) => {
            if (warnings < MAX_WARNINGS) {
              console.warn(`[Event] [${file}] ${msg}`);
              warnings++;
            }
          });
          if (!event) continue;

          if (event.timestamp >= sinceIso && event.timestamp < untilIso) {
            fileEvents.push(event);
          }
        }
        return fileEvents;
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const events = results.flat();
    
    // Sort by timestamp, newest first
    // Optimization: ISO 8601 strings can be compared lexicographically
    events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
    
    return events;
  } catch (error) {
    throw new Error(`Failed to load events: ${error instanceof Error ? error.message : String(error)}`);
  }
}
