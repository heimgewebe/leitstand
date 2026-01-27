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
function parseEventLine(line: string): { event: EventLine | null; error?: string } {
  try {
    const trimmed = line.trim();
    if (!trimmed) return { event: null };
    
    const data = JSON.parse(trimmed);
    
    // Basic validation
    if (!data.timestamp || !data.kind) {
      return { event: null };
    }
    
    // Ensure timestamp is in canonical ISO 8601 format for lexicographical sorting
    const d = new Date(data.timestamp);
    if (Number.isNaN(d.getTime())) {
      return {
        event: null,
        error: `Invalid timestamp in line: ${line.substring(0, 100)}...`
      };
    }
    const timestamp = d.toISOString();

    return {
      event: {
        timestamp,
        kind: data.kind,
        repo: data.repo,
        job: data.job,
        severity: data.severity,
        payload: data.payload,
      }
    };
  } catch {
    // Silently skip invalid lines
    return { event: null };
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
    // Max concurrently open streams; conservative to avoid FD exhaustion on typical systems.
    const BATCH_SIZE = 8;
    const results: EventLine[][] = [];

    for (let i = 0; i < jsonlFiles.length; i += BATCH_SIZE) {
      const batch = jsonlFiles.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(async (file) => {
        const filePath = join(dataDir, file);
        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
        
        const fileEvents: EventLine[] = [];
        let warnings = 0;
        const MAX_WARNINGS = 1;

        try {
          for await (const line of rl) {
            const { event, error } = parseEventLine(line);

            if (error) {
              if (warnings < MAX_WARNINGS) {
                console.warn(`[Event] [${file}] ${error}`);
                warnings++;
              }
            }

            if (!event) continue;

            if (event.timestamp >= sinceIso && event.timestamp < untilIso) {
              fileEvents.push(event);
            }
          }
        } finally {
          rl.close();
          fileStream.destroy();
        }
        
        return fileEvents;
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    const events = results.flat();
    
    // Sort by timestamp, newest first
    // Optimization: ISO 8601 strings can be compared lexicographically
    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    return events;
  } catch (error) {
    throw new Error(`Failed to load events: ${error instanceof Error ? error.message : String(error)}`);
  }
}
