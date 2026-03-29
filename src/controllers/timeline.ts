import { join } from 'path';
import { envConfig } from '../config.js';
import type { EventLine } from '../events.js';
import { readdir, readFile } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

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
    /** Machine state of the time window — used by the UI to choose display text. */
    window_state: 'has_events' | 'empty_window';
    /** Error / fallback reason — machine token, not for direct UI rendering. */
    missing_reason: string;
    is_strict: boolean;
    since: string;
    until: string;
    total_loaded: number;
    hours_back: number;
    max_events: number;
    replay_mode: boolean;
    replay_until: string | null;
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
  maxEvents: number = 200,
  untilOverride?: Date
): Promise<TimelineViewData> {
  const { isStrict } = envConfig;

  const hasValidOverride = !!untilOverride && !Number.isNaN(untilOverride.getTime());
  const until = hasValidOverride ? untilOverride : new Date();
  const since = new Date(until.getTime() - hoursBack * 60 * 60 * 1000);

  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();

  // Try chronik data directory (from main config)
  // The config file path resolution requires loadConfig, but for the web server
  // we use a convention: artifacts/chronik/ or a configured path.
  const chronikDir = join(envConfig.paths.artifacts, 'chronik');

  try {
    const events = await __loadEventsFromDir(chronikDir, sinceIso, untilIso, maxEvents);
    // Chronik directory is accessible — return chronik result even if no events
    // are in the current window (avoids masking a valid-but-empty chronik as
    // "fixture" or "missing").
    return {
      events,
      view_meta: {
        source_kind: 'chronik',
        window_state: events.length === 0 ? 'empty_window' : 'has_events',
        missing_reason: 'ok',
        is_strict: isStrict,
        since: sinceIso,
        until: untilIso,
        total_loaded: events.length,
        hours_back: hoursBack,
        max_events: maxEvents,
        replay_mode: hasValidOverride,
        replay_until: hasValidOverride ? untilIso : null,
      },
    };
  } catch (e) {
    // Ignore ENOENT – directory may not exist yet
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Timeline] Error loading chronik data:', e instanceof Error ? e.message : String(e));
    }
  }

  // Fallback to fixture
  if (!isStrict) {
    try {
      const fixtureDir = join(envConfig.paths.fixtures, 'chronik');
      const events = await __loadEventsFromDir(fixtureDir, sinceIso, untilIso, maxEvents);
      if (events.length > 0) {
        return {
          events,
          view_meta: {
            source_kind: 'fixture',
            window_state: 'has_events',
            missing_reason: 'chronik_enoent',
            is_strict: isStrict,
            since: sinceIso,
            until: untilIso,
            total_loaded: events.length,
            hours_back: hoursBack,
            max_events: maxEvents,
            replay_mode: hasValidOverride,
            replay_until: hasValidOverride ? untilIso : null,
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
        const d = new Date(e.timestamp);
        if (Number.isNaN(d.getTime())) return false;
        const ts = d.toISOString();
        return ts >= sinceIso && ts < untilIso;
      });

      // Sort newest first (same as JSONL path)
      filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const events = filtered.slice(0, maxEvents);
      return {
        events,
        view_meta: {
          source_kind: 'fixture',
          window_state: 'has_events',
          missing_reason: 'chronik_enoent',
          is_strict: isStrict,
          since: sinceIso,
          until: untilIso,
          total_loaded: events.length,
          hours_back: hoursBack,
          max_events: maxEvents,
          replay_mode: hasValidOverride,
          replay_until: hasValidOverride ? untilIso : null,
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
      window_state: 'empty_window',
      missing_reason: isStrict ? 'strict_mode' : 'no_events_found',
      is_strict: isStrict,
      since: sinceIso,
      until: untilIso,
      total_loaded: 0,
      hours_back: hoursBack,
      max_events: maxEvents,
      replay_mode: hasValidOverride,
      replay_until: hasValidOverride ? untilIso : null,
    },
  };
}

/**
 * Loads events from a directory of JSONL files within a time window.
 *
 * Uses readline streaming to avoid loading entire files into memory —
 * important for large append-only chronik logs. Files are processed in
 * batches of 8 to limit concurrent file descriptor usage.
 *
 * Exported for unit testing only — not part of the controller's public API.
 */
export async function __loadEventsFromDir(
  dir: string,
  sinceIso: string,
  untilIso: string,
  maxEvents: number
): Promise<TimelineEvent[]> {
  const files = await readdir(dir);
  const jsonlFiles = files.filter((f: string) => f.endsWith('.jsonl'));

  const events: TimelineEvent[] = [];
  // Limit concurrent file streams to avoid EMFILE errors on systems with low fd limits.
  const BATCH_SIZE = 8;

  for (let i = 0; i < jsonlFiles.length; i += BATCH_SIZE) {
    const batch = jsonlFiles.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const filePath = join(dir, file);
        const fileEvents: TimelineEvent[] = [];

        const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
        const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

        try {
          for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
              const data = JSON.parse(trimmed);
              if (!data.timestamp || !data.kind) continue;

              const d = new Date(data.timestamp);
              if (Number.isNaN(d.getTime())) continue;
              const ts = d.toISOString();

              if (ts >= sinceIso && ts < untilIso) {
                fileEvents.push({
                  timestamp: ts,
                  kind: data.kind,
                  repo: data.repo,
                  job: data.job,
                  severity: data.severity,
                  payload: data.payload,
                });
              }
            } catch {
              // Skip lines with invalid JSON
            }
          }
        } finally {
          rl.close();
          fileStream.destroy();
        }

        return fileEvents;
      })
    );

    for (const fileEvents of batchResults) {
      for (const event of fileEvents) {
        events.push(event);
      }
    }
  }

  // Sort newest first
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return events.slice(0, maxEvents);
}
