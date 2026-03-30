import { stat } from 'fs/promises';
import { join } from 'path';
import { envConfig } from '../config.js';
import { sanitizeDailyInsights, type DailyInsights } from '../insights.js';
import { loadWithFallback } from '../utils/loader.js';

/**
 * Freshness contract (from contracts/consumers/leitstand.insights.daily.consumer.md):
 *   metadata.generated_at > ts > transport fallback (mtime)
 * Insights regenerate daily; stale threshold is 30 h to allow for generation drift.
 */
const STALE_AFTER_HOURS = 30;

type FreshnessSource = 'metadata.generated_at' | 'ts' | 'mtime' | 'unknown';

export interface InsightsViewData {
  insights: DailyInsights | null;
  view_meta: {
    source_kind: 'artifact' | 'fixture' | 'missing';
    missing_reason: string;
    is_strict: boolean;
    data_timestamp: string | null;
    data_age_minutes: number | null;
    freshness_state: 'fresh' | 'stale' | 'unknown';
    freshness_source: FreshnessSource;
    freshness_degraded: boolean;
    stale_after_hours: number;
    uncertainty: number | null;
    observatory_ref: string | null;
  };
}

function buildFreshness(timestamp: string, source: Exclude<FreshnessSource, 'unknown'>, degraded: boolean) {
  const ms = new Date(timestamp).getTime();
  if (Number.isNaN(ms)) {
    return {
      data_timestamp: timestamp,
      data_age_minutes: null,
      freshness_state: 'unknown' as const,
      freshness_source: source,
      freshness_degraded: degraded,
    };
  }

  const ageMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  return {
    data_timestamp: new Date(ms).toISOString(),
    data_age_minutes: ageMinutes,
    freshness_state: ageMinutes > STALE_AFTER_HOURS * 60 ? 'stale' as const : 'fresh' as const,
    freshness_source: source,
    freshness_degraded: degraded,
  };
}

function computeFreshness(raw: DailyInsights) {
  const generatedAt = typeof raw.metadata?.generated_at === 'string' ? raw.metadata.generated_at : null;
  if (generatedAt) {
    const freshness = buildFreshness(generatedAt, 'metadata.generated_at', false);
    if (freshness.data_age_minutes !== null || freshness.data_timestamp === generatedAt) {
      return freshness;
    }
  }

  const coarseDate = typeof raw.ts === 'string' && raw.ts.trim() !== '' ? `${raw.ts}T00:00:00Z` : null;
  if (coarseDate) {
    const freshness = buildFreshness(coarseDate, 'ts', false);
    if (freshness.data_age_minutes !== null || freshness.data_timestamp === coarseDate) {
      return freshness;
    }
  }

  return {
    data_timestamp: null,
    data_age_minutes: null,
    freshness_state: 'unknown' as const,
    freshness_source: 'unknown' as const,
    freshness_degraded: false,
  };
}

async function getTransportTimestamp(path: string | null): Promise<string | null> {
  if (!path) {
    return null;
  }

  try {
    const fileStats = await stat(path);
    return fileStats.mtime.toISOString();
  } catch {
    return null;
  }
}

export async function getInsightsData(): Promise<InsightsViewData> {
  const { isStrict, isStrictFail, paths } = envConfig;

  const artifactPath = join(paths.artifacts, 'insights.daily.json');
  const fixturePath = join(paths.fixtures, 'insights.daily.json');

  const loaded = await loadWithFallback<unknown>(artifactPath, fixturePath, {
    strict: isStrict,
    strictFail: isStrictFail,
    name: 'Insights',
  });

  const resolvedPath = loaded.source === 'artifact'
    ? artifactPath
    : loaded.source === 'fixture'
      ? fixturePath
      : null;
  const transportTimestamp = await getTransportTimestamp(resolvedPath);

  if (!loaded.data) {
    return {
      insights: null,
      view_meta: {
        source_kind: loaded.source,
        missing_reason: loaded.reason,
        is_strict: isStrict,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        freshness_source: 'unknown',
        freshness_degraded: false,
        stale_after_hours: STALE_AFTER_HOURS,
        uncertainty: null,
        observatory_ref: null,
      },
    };
  }

  const insights = sanitizeDailyInsights(loaded.data);
  if (!insights) {
    console.warn(`[Insights] Ignoring invalid insights payload from ${loaded.source} source.`);
    return {
      insights: null,
      view_meta: {
        source_kind: loaded.source,
        missing_reason: 'invalid-shape',
        is_strict: isStrict,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        freshness_source: 'unknown',
        freshness_degraded: false,
        stale_after_hours: STALE_AFTER_HOURS,
        uncertainty: null,
        observatory_ref: null,
      },
    };
  }

  let freshness = computeFreshness(insights);
  if (freshness.freshness_source === 'unknown' && transportTimestamp) {
    console.warn('[Insights] Falling back to transport timestamp (mtime) because generated_at/ts are missing or invalid.');
    freshness = buildFreshness(transportTimestamp, 'mtime', true);
  }

  return {
    insights,
    view_meta: {
      source_kind: loaded.source,
      missing_reason: loaded.reason,
      is_strict: isStrict,
      data_timestamp: freshness.data_timestamp,
      data_age_minutes: freshness.data_age_minutes,
      freshness_state: freshness.freshness_state,
      freshness_source: freshness.freshness_source,
      freshness_degraded: freshness.freshness_degraded,
      stale_after_hours: STALE_AFTER_HOURS,
      uncertainty: insights.metadata?.uncertainty ?? null,
      observatory_ref: insights.metadata?.observatory_ref ?? null,
    },
  };
}
