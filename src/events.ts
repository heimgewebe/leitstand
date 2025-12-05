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
    
    const events: EventLine[] = [];
    
    for (const file of jsonlFiles) {
      const filePath = join(dataDir, file);
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        const event = parseEventLine(line);
        if (!event) continue;
        
        const eventTime = new Date(event.timestamp);
        if (eventTime >= since && eventTime < until) {
          events.push(event);
        }
      }
    }
    
    // Sort by timestamp, newest first
    events.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    return events;
  } catch (error) {
    throw new Error(`Failed to load events: ${error instanceof Error ? error.message : String(error)}`);
  }
}
