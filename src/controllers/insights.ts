import { join } from 'path';
import { loadWithFallback } from '../utils/loader.js';
import { envConfig } from '../config.js';
import type { DailyInsights } from '../insights.js';

/**
 * Freshness contract (from contracts/consumers/leitstand.insights.daily.consumer.md):
 *   metadata.generated_at  >  ts  >  mtime
 * Insights regenerate daily; stale threshold is 30 h to allow for generation drift.
 */
const STALE_AFTER_HOURS = 30;

export interface InsightsViewData {
  insights: DailyInsights | null;
  view_meta: {
    source_kind: 'artifact' | 'fixture' | 'missing';
    missing_reason: string;
    is_strict: boolean;
    data_timestamp: string | null;
    data_age_minutes: number | null;
    freshness_state: 'fresh' | 'stale' | 'unknown';
    stale_after_hours: number;
    uncertainty: number | null;
  };
}

function computeFreshness(raw: DailyInsights): {
  data_timestamp: string | null;
  data_age_minutes: number | null;
  freshness_state: 'fresh' | 'stale' | 'unknown';
} {
  // Priority: metadata.generated_at > ts > unknown
  const candidate =
    (typeof raw.metadata?.generated_at === 'string' ? raw.metadata.generated_at : null) ??
    (typeof raw.ts === 'string' ? `${raw.ts}T00:00:00Z` : null);

  if (!candidate) {
    return { data_timestamp: null, data_age_minutes: null, freshness_state: 'unknown' };
  }

  const ms = new Date(candidate).getTime();
  if (Number.isNaN(ms)) {
    return { data_timestamp: candidate, data_age_minutes: null, freshness_state: 'unknown' };
  }

  const ageMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  const freshness_state: 'fresh' | 'stale' = ageMinutes > STALE_AFTER_HOURS * 60 ? 'stale' : 'fresh';

  return {
    data_timestamp: new Date(ms).toISOString(),
    data_age_minutes: ageMinutes,
    freshness_state,
  };
}

/**
 * Controller for loading the Insights daily view data.
 *
 * Uses loadWithFallback for artifact→fixture resolution, respecting strict-mode
 * flags from envConfig.
 *
 * Note: loadDailyInsights() in insights.ts provides a throwing single-file loader;
 * the controller intentionally uses loadWithFallback instead so the artifact→fixture
 * fallback logic is available here.
 */
export async function getInsightsData(): Promise<InsightsViewData> {
  const { isStrict, isStrictFail, paths } = envConfig;

  const artifactPath = join(paths.artifacts, 'insights.daily.json');
  const fixturePath = join(paths.fixtures, 'insights.daily.json');

  const loaded = await loadWithFallback<DailyInsights>(artifactPath, fixturePath, {
    strict: isStrict,
    strictFail: isStrictFail,
    name: 'Insights',
  });

  const raw = loaded.data;

  if (!raw) {
    return {
      insights: null,
      view_meta: {
        source_kind: loaded.source,
        missing_reason: loaded.reason,
        is_strict: isStrict,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        stale_after_hours: STALE_AFTER_HOURS,
        uncertainty: null,
      },
    };
  }

  const freshness = computeFreshness(raw);
  const uncertainty =
    typeof raw.metadata?.uncertainty === 'number' ? raw.metadata.uncertainty : null;

  return {
    insights: raw,
    view_meta: {
      source_kind: loaded.source,
      missing_reason: loaded.reason,
      is_strict: isStrict,
      data_timestamp: freshness.data_timestamp,
      data_age_minutes: freshness.data_age_minutes,
      freshness_state: freshness.freshness_state,
      stale_after_hours: STALE_AFTER_HOURS,
      uncertainty,
    },
  };
}
