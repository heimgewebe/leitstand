import { stat } from 'fs/promises';
import { join } from 'path';
import { envConfig } from '../config.js';
import { loadWithFallback } from '../utils/loader.js';
import { sanitizeReflexionBundle, type ReflexionBundle } from '../reflexion.js';

const STALE_AFTER_HOURS = 24;

type FreshnessSource = 'generated_at' | 'mtime' | 'unknown';

interface FreshnessResult {
  data_timestamp: string | null;
  data_age_minutes: number | null;
  freshness_state: 'fresh' | 'stale' | 'unknown';
  freshness_source: FreshnessSource;
}

export interface ReflexionViewData {
  reflexion: ReflexionBundle | null;
  view_meta: {
    source_kind: 'artifact' | 'fixture' | 'missing';
    missing_reason: string;
    is_strict: boolean;
    data_timestamp: string | null;
    data_age_minutes: number | null;
    freshness_state: 'fresh' | 'stale' | 'unknown';
    freshness_source: FreshnessSource;
    stale_after_hours: number;
  };
}

function computeFreshness(raw: ReflexionBundle): FreshnessResult & { timestamp_valid: boolean } {
  const generatedAt = typeof raw.generated_at === 'string' ? raw.generated_at : null;
  if (generatedAt) {
    const ms = new Date(generatedAt).getTime();
    if (!Number.isNaN(ms)) {
      const ageMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
      return {
        data_timestamp: new Date(ms).toISOString(),
        data_age_minutes: ageMinutes,
        freshness_state: ageMinutes > STALE_AFTER_HOURS * 60 ? 'stale' : 'fresh',
        freshness_source: 'generated_at',
        timestamp_valid: true
      };
    }
  }

  return {
    data_timestamp: null,
    data_age_minutes: null,
    freshness_state: 'unknown',
    freshness_source: 'unknown',
    timestamp_valid: false
  };
}

async function getTransportTimestamp(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const fileStats = await stat(path);
    return fileStats.mtime.toISOString();
  } catch {
    return null;
  }
}

export async function getReflexionData(): Promise<ReflexionViewData> {
  const { isStrict, isStrictFail, paths } = envConfig;

  // We look for reflexion bundle; fallback to self_state.json if reflexion doesn't exist
  const artifactPath = join(paths.artifacts, 'reflexion.json');
  const fixturePath = join(paths.fixtures, 'reflexion.json');

  const loaded = await loadWithFallback<unknown>(artifactPath, fixturePath, {
    strict: isStrict,
    strictFail: isStrictFail,
    name: 'Reflexion',
  });

  if (loaded.data === null) {
    return {
      reflexion: null,
      view_meta: {
        source_kind: loaded.source,
        missing_reason: loaded.reason,
        is_strict: isStrict,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        freshness_source: 'unknown',
        stale_after_hours: STALE_AFTER_HOURS,
      },
    };
  }

  const reflexion = sanitizeReflexionBundle(loaded.data);
  if (!reflexion) {
    console.warn(`[Reflexion] Ignoring invalid reflexion payload from ${loaded.source} source.`);
    return {
      reflexion: null,
      view_meta: {
        source_kind: loaded.source,
        missing_reason: 'invalid-shape',
        is_strict: isStrict,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        freshness_source: 'unknown',
        stale_after_hours: STALE_AFTER_HOURS,
      },
    };
  }

  const freshness = computeFreshness(reflexion);
  let finalTimestamp = freshness.data_timestamp;
  let finalSource = freshness.freshness_source;
  let finalState = freshness.freshness_state;
  let finalAge = freshness.data_age_minutes;

  if (!freshness.timestamp_valid) {
    const resolvedPath = loaded.source === 'artifact' ? artifactPath : (loaded.source === 'fixture' ? fixturePath : null);
    const transportTimestamp = await getTransportTimestamp(resolvedPath);
    if (transportTimestamp) {
        const ms = new Date(transportTimestamp).getTime();
        const ageMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
        finalTimestamp = new Date(ms).toISOString();
        finalAge = ageMinutes;
        finalState = ageMinutes > STALE_AFTER_HOURS * 60 ? 'stale' : 'fresh';
        finalSource = 'mtime';
    }
  }

  return {
    reflexion,
    view_meta: {
      source_kind: loaded.source,
      missing_reason: loaded.reason,
      is_strict: isStrict,
      data_timestamp: finalTimestamp,
      data_age_minutes: finalAge,
      freshness_state: finalState,
      freshness_source: finalSource,
      stale_after_hours: STALE_AFTER_HOURS,
    },
  };
}
