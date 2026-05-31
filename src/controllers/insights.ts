import { join } from 'path';
import { envConfig } from '../config.js';
import { sanitizeDailyInsights, type DailyInsights } from '../insights.js';
import { compareInsights, previousDateOf, type DayComparison } from '../insightsComparison.js';
import { getTransportTimestamp } from '../utils/fs.js';
import { loadOptional, loadWithFallback } from '../utils/loader.js';

/**
 * Freshness contract (from contracts/consumers/leitstand.insights.daily.consumer.md):
 *   metadata.generated_at > ts > transport fallback (mtime)
 * Insights regenerate daily; stale threshold is 30 h to allow for generation drift.
 */
const STALE_AFTER_HOURS = 30;

type FreshnessSource = 'metadata.generated_at' | 'ts' | 'mtime' | 'unknown';

interface FreshnessResult {
  data_timestamp: string | null;
  data_age_minutes: number | null;
  freshness_state: 'fresh' | 'stale' | 'unknown';
  freshness_source: FreshnessSource;
  freshness_degraded: boolean;
}

/**
 * Result of binding today's insights against the previous day's artifact.
 * Optional: present in the live controller, omitted by lightweight test mocks.
 */
export interface ComparisonMeta {
  /** True only when a previous-day artifact was found and yielded a comparison. */
  available: boolean;
  source_kind: 'artifact' | 'fixture' | 'missing';
  /**
   * Status code: 'ok' | 'no-base-date' | 'no-source-coherence' | 'enoent' | 'empty' | 'invalid-json' | 'error' | 'invalid-shape'.
   * - 'ok': Comparison available.
   * - 'no-base-date': Today's ts is invalid/unparseable, so no previous date could be derived.
   * - 'no-source-coherence': Today is artifact but previous-day artifact missing/invalid (fixture not allowed).
   * - 'enoent': Previous artifact file not found.
   * - 'empty': Previous artifact file is empty.
   * - 'invalid-json': Previous artifact contains invalid JSON.
   * - 'error': Other read error (e.g., permission denied).
   * - 'invalid-shape': Previous artifact loaded but failed sanitization (wrong schema).
   */
  reason: string;
  /** Date we looked up (today's ts minus one day), or null when undeterminable. */
  previous_date: string | null;
  /** Actual ts found in the previous-day artifact, or null. */
  previous_ts: string | null;
}

export interface InsightsViewData {
  insights: DailyInsights | null;
  comparison?: DayComparison | null;
  comparison_meta?: ComparisonMeta;
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

function buildFreshness(
  timestamp: string,
  source: Exclude<FreshnessSource, 'unknown'>,
  degraded: boolean
): FreshnessResult & { timestamp_valid: boolean } {
  const ms = new Date(timestamp).getTime();
  if (Number.isNaN(ms)) {
    return {
      data_timestamp: null,
      data_age_minutes: null,
      freshness_state: 'unknown' as const,
      freshness_source: source,
      freshness_degraded: degraded,
      timestamp_valid: false,
    };
  }

  const ageMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  return {
    data_timestamp: new Date(ms).toISOString(),
    data_age_minutes: ageMinutes,
    freshness_state: ageMinutes > STALE_AFTER_HOURS * 60 ? 'stale' as const : 'fresh' as const,
    freshness_source: source,
    freshness_degraded: degraded,
    timestamp_valid: true,
  };
}

function computeFreshness(raw: DailyInsights): FreshnessResult {
  const generatedAt = typeof raw.metadata?.generated_at === 'string' ? raw.metadata.generated_at : null;
  if (generatedAt) {
    const freshness = buildFreshness(generatedAt, 'metadata.generated_at', false);
    if (freshness.timestamp_valid) {
      return freshness;
    }
  }

  const coarseDate = typeof raw.ts === 'string' && raw.ts.trim() !== '' ? `${raw.ts}T00:00:00Z` : null;
  if (coarseDate) {
    const freshness = buildFreshness(coarseDate, 'ts', false);
    if (freshness.timestamp_valid) {
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

function noComparison(reason: string): Pick<InsightsViewData, 'comparison' | 'comparison_meta'> {
  return {
    comparison: null,
    comparison_meta: {
      available: false,
      source_kind: 'missing',
      reason,
      previous_date: null,
      previous_ts: null,
    },
  };
}

/**
 * Binds today's insights against the previous day's artifact to produce a
 * verifiable day-over-day delta. The previous artifact is supplementary: its
 * absence or corruption degrades gracefully to "no comparison available" and
 * never blocks the page (it is loaded via {@link loadOptional}, bypassing
 * strict-mode aborts).
 *
 * Enforces source coherence: if today's insights came from an artifact, the
 * previous day's insights must also come from an artifact (no fixture fallback).
 * If today is from a fixture, the previous day is loaded from fixture. If today
 * is missing, no comparison is possible.
 *
 * Convention (mirrors the dated WGX metrics snapshots): the previous day's
 * payload lives at `insights.daily.<YYYY-MM-DD>.json`, derived from today's ts.
 */
async function buildComparison(
  current: DailyInsights,
  paths: { artifacts: string; fixtures: string },
  currentSource: 'artifact' | 'fixture' | 'missing',
): Promise<Pick<InsightsViewData, 'comparison' | 'comparison_meta'>> {
  // If today's insights are missing, no comparison is possible.
  if (currentSource === 'missing') {
    return noComparison('no-insights');
  }

  const previousDate = previousDateOf(current.ts);
  if (!previousDate) {
    return noComparison('no-base-date');
  }

  const fileName = `insights.daily.${previousDate}.json`;

  // Enforce source coherence: artifact → artifact, fixture → fixture.
  const allowFixtureFallback = currentSource === 'fixture';
  const fixturePath = currentSource === 'fixture' ? join(paths.fixtures, fileName) : null;

  const loaded = await loadOptional<unknown>(
    join(paths.artifacts, fileName),
    fixturePath,
    'Insights(prev)',
    { allowFixtureFallback },
  );

  if (loaded.data === null) {
    // If today is from artifact but previous-day artifact is missing/invalid,
    // report no-source-coherence to distinguish from general unavailability.
    const reason = currentSource === 'artifact' && loaded.reason !== 'ok'
      ? 'no-source-coherence'
      : loaded.reason;

    return {
      comparison: null,
      comparison_meta: {
        available: false,
        source_kind: loaded.source,
        reason,
        previous_date: previousDate,
        previous_ts: null,
      },
    };
  }

  const previous = sanitizeDailyInsights(loaded.data);
  if (!previous) {
    console.warn(`[Insights] Ignoring invalid previous-day insights from ${loaded.source} source.`);

    const reason = currentSource === 'artifact'
      ? 'no-source-coherence'
      : 'invalid-shape';

    return {
      comparison: null,
      comparison_meta: {
        available: false,
        source_kind: loaded.source,
        reason,
        previous_date: previousDate,
        previous_ts: null,
      },
    };
  }

  return {
    comparison: compareInsights(current, previous),
    comparison_meta: {
      available: true,
      source_kind: loaded.source,
      reason: 'ok',
      previous_date: previousDate,
      previous_ts: previous.ts.trim() || null,
    },
  };
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

  if (loaded.data === null) {
    return {
      insights: null,
      ...noComparison('no-insights'),
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
      ...noComparison('no-insights'),
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
  if (freshness.freshness_source === 'unknown') {
    const resolvedPath = loaded.source === 'artifact'
      ? artifactPath
      : loaded.source === 'fixture'
        ? fixturePath
        : null;
    const transportTimestamp = await getTransportTimestamp(resolvedPath);

    if (transportTimestamp) {
      console.warn('[Insights] Falling back to transport timestamp (mtime) because generated_at/ts are missing or invalid.');
      freshness = buildFreshness(transportTimestamp, 'mtime', true);
    }
  }

  const comparison = await buildComparison(insights, paths, loaded.source);

  return {
    insights,
    ...comparison,
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
