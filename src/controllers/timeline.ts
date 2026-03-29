import { join } from 'path';
import { envConfig } from '../config.js';
import type { EventLine } from '../events.js';
import { readdir, readFile } from 'fs/promises';

/**
 * Event data for the timeline, extended for display purposes.
 */
export interface TimelineEvent extends EventLine {
  // Inherited: timestamp, kind, repo, job, severity, payload
}

export interface TimelineViewData {
  events: TimelineEvent[];
  view_meta: {
    source_kind: 'chronik' | 'fixture' | 'missing';
    missing_reason: string;
    is_strict: boolean;
    since: string;
    until: string;
    total_loaded: number;
  };
}

/**
 * Loads events for the timeline view.
 *
 * Tries to load from the chronik data directory first,
 * then falls back to a fixture file in dev mode.
 *
 * @param hoursBack - How many hours of history to load (default: 48)
 * @param maxEvents - Maximum events to return (default: 200)
 */
export async function getTimelineData(
  hoursBack: number = 48,
  maxEvents: number = 200
): Promise<TimelineViewData> {
  const { isStrict } = envConfig;

  const until = new Date();
  const since = new Date(until.getTime() - hoursBack * 60 * 60 * 1000);

  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();

  // Try chronik data directory (from main config)
  // The config file path resolution requires loadConfig, but for the web server
  // we use a convention: artifacts/chronik/ or a configured path.
  const chronikDir = join(envConfig.paths.artifacts, 'chronik');

  try {
    const events = await loadEventsFromDir(chronikDir, sinceIso, untilIso, maxEvents);
    if (events.length > 0) {
      return {
        events,
        view_meta: {
          source_kind: 'chronik',
          missing_reason: 'ok',
          is_strict: isStrict,
          since: sinceIso,
          until: untilIso,
          total_loaded: events.length,
        },
      };
    }
  } catch (e) {
    // Ignore ENOENT – directory may not exist
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Timeline] Error loading chronik data:', e instanceof Error ? e.message : String(e));
    }
  }

  // Fallback to fixture
  if (!isStrict) {
    try {
      const fixtureDir = join(envConfig.paths.fixtures, 'chronik');
      const events = await loadEventsFromDir(fixtureDir, sinceIso, untilIso, maxEvents);
      if (events.length > 0) {
        return {
          events,
          view_meta: {
            source_kind: 'fixture',
            missing_reason: 'chronik_enoent',
            is_strict: isStrict,
            since: sinceIso,
            until: untilIso,
            total_loaded: events.length,
          },
        };
      }
    } catch (e) {
      // Ignore ENOENT
    }

    // Last fallback: fixture JSON array
    // Apply the same time-window filtering as the JSONL path for consistent semantics.
    try {
      const fixturePath = join(envConfig.paths.fixtures, 'events.json');
      const raw = await readFile(fixturePath, 'utf-8');
      const allEvents = JSON.parse(raw) as TimelineEvent[];

      const filtered = allEvents.filter((e) => {
        if (!e.timestamp) return false;
        const ts = new Date(e.timestamp).toISOString();
        return ts >= sinceIso && ts < untilIso;
      });

      // Sort newest first (same as JSONL path)
      filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const events = filtered.slice(0, maxEvents);
      return {
        events,
        view_meta: {
          source_kind: 'fixture',
          missing_reason: 'chronik_enoent',
          is_strict: isStrict,
          since: sinceIso,
          until: untilIso,
          total_loaded: events.length,
        },
      };
    } catch {
      // Ignore ENOENT
    }
  }

  // Nothing found
  return {
    events: [],
    view_meta: {
      source_kind: 'missing',
      missing_reason: isStrict ? 'strict_mode' : 'no_events_found',
      is_strict: isStrict,
      since: sinceIso,
      until: untilIso,
      total_loaded: 0,
    },
  };
}

/**
 * Loads events from a directory of JSONL files within a time window.
 * Replicates the core logic of events.ts loadRecentEvents but is usable
 * from the web controller context.
 */
async function loadEventsFromDir(
  dir: string,
  sinceIso: string,
  untilIso: string,
  maxEvents: number
): Promise<TimelineEvent[]> {
  const files = await readdir(dir);
  const jsonlFiles = files.filter((f: string) => f.endsWith('.jsonl'));

  const events: TimelineEvent[] = [];

  for (const file of jsonlFiles) {
    const content = await readFile(join(dir, file), 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const data = JSON.parse(trimmed);
        if (!data.timestamp || !data.kind) continue;

        const ts = new Date(data.timestamp).toISOString();
        if (ts >= sinceIso && ts < untilIso) {
          events.push({
            timestamp: ts,
            kind: data.kind,
            repo: data.repo,
            job: data.job,
            severity: data.severity,
            payload: data.payload,
          });
        }
      } catch {
        // Skip invalid lines
      }
    }
  }

  // Sort newest first
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return events.slice(0, maxEvents);
}
