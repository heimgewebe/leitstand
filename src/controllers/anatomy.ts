import { join } from 'path';
import { loadWithFallback } from '../utils/loader.js';
import { envConfig } from '../config.js';
import type { AnatomySnapshot } from '../anatomy.js';
import { validateAnatomySnapshot } from '../anatomy.js';
import { loadLatestMetrics } from '../metrics.js';

type RepoHealth = 'ok' | 'warn' | 'fail' | 'unknown';

interface HealthOverlay {
  source_kind: 'artifact' | 'fixture' | 'missing';
  missing_reason: string;
  timestamp: string | null;
  by_repo: Record<string, RepoHealth>;
  totals: {
    ok: number;
    warn: number;
    fail: number;
    unknown: number;
  };
  freshness_state: 'fresh' | 'stale' | 'unknown';
  data_age_minutes: number | null;
  stale_after_hours: number;
}

export interface AnatomyViewData {
  anatomy: AnatomySnapshot | null;
  health: HealthOverlay;
  view_meta: {
    source_kind: 'artifact' | 'fixture' | 'missing';
    missing_reason: string;
    is_strict: boolean;
    schema_valid: boolean;
    data_timestamp: string | null;
    data_age_minutes: number | null;
    freshness_state: 'fresh' | 'stale' | 'unknown';
    stale_after_hours: number;
  };
}

const STALE_AFTER_HOURS = 72;
const HEALTH_STALE_AFTER_HOURS = 24;

function normalizeRepoId(input: string | undefined): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  const withoutOwner = trimmed.includes('/') ? trimmed.split('/').pop() || '' : trimmed;
  return withoutOwner.toLowerCase();
}

function normalizeRepoStatus(status: unknown): RepoHealth {
  if (typeof status !== 'string') return 'unknown';
  const normalized = status.toLowerCase();
  if (normalized === 'ok' || normalized === 'warn' || normalized === 'fail') {
    return normalized;
  }
  return 'unknown';
}

function computeFreshness(generatedAt?: string): {
  data_timestamp: string | null;
  data_age_minutes: number | null;
  freshness_state: 'fresh' | 'stale' | 'unknown';
} {
  if (!generatedAt) {
    return {
      data_timestamp: null,
      data_age_minutes: null,
      freshness_state: 'unknown',
    };
  }

  const generatedMs = new Date(generatedAt).getTime();
  if (Number.isNaN(generatedMs)) {
    return {
      data_timestamp: generatedAt,
      data_age_minutes: null,
      freshness_state: 'unknown',
    };
  }

  const ageMinutes = Math.max(0, Math.floor((Date.now() - generatedMs) / 60000));
  const freshnessState = ageMinutes > STALE_AFTER_HOURS * 60 ? 'stale' : 'fresh';

  return {
    data_timestamp: new Date(generatedMs).toISOString(),
    data_age_minutes: ageMinutes,
    freshness_state: freshnessState,
  };
}

function emptyHealthOverlay(reason: string): HealthOverlay {
  return {
    source_kind: 'missing',
    missing_reason: reason,
    timestamp: null,
    by_repo: {},
    totals: {
      ok: 0,
      warn: 0,
      fail: 0,
      unknown: 0,
    },
    freshness_state: 'unknown',
    data_age_minutes: null,
    stale_after_hours: HEALTH_STALE_AFTER_HOURS,
  };
}

function classifyHealthLoadError(err: unknown): string {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  if (msg.includes('invalid json') || msg.includes('unexpected token') || msg.includes('configuration validation failed')) {
    return 'health_metrics_invalid';
  }

  if (msg.includes('enoent') || msg.includes('no such file')) {
    return 'health_metrics_missing';
  }

  return 'health_metrics_load_failed';
}

async function loadHealthOverlay(): Promise<HealthOverlay> {
  const { isStrict, paths } = envConfig;

  const artifactMetricsDir = join(paths.artifacts, 'metrics');
  const fixtureMetricsDir = join(paths.fixtures, 'metrics');

  try {
    const metricsFromArtifact = await loadLatestMetrics(artifactMetricsDir);
    if (metricsFromArtifact) {
      return buildHealthOverlay(metricsFromArtifact, 'artifact', 'ok');
    }

    if (!isStrict) {
      const metricsFromFixture = await loadLatestMetrics(fixtureMetricsDir);
      if (metricsFromFixture) {
        return buildHealthOverlay(metricsFromFixture, 'fixture', 'artifact_missing');
      }
    }

    return emptyHealthOverlay(isStrict ? 'health_metrics_missing_strict' : 'health_metrics_missing');
  } catch (err) {
    console.warn('[Anatomy] Failed to load health overlay:', err instanceof Error ? err.message : String(err));
    return emptyHealthOverlay(classifyHealthLoadError(err));
  }
}

function buildHealthOverlay(
  metrics: {
    timestamp?: string;
    repos?: Array<{ name?: string; status?: string }>;
    status?: { ok?: number; warn?: number; fail?: number };
  },
  sourceKind: 'artifact' | 'fixture',
  reason: string
): HealthOverlay {
  const byRepo: Record<string, RepoHealth> = {};

  for (const repo of metrics.repos || []) {
    const id = normalizeRepoId(repo.name);
    if (!id) continue;
    byRepo[id] = normalizeRepoStatus(repo.status);
  }

  const freshness = computeFreshness(metrics.timestamp);
  const healthFreshness: 'fresh' | 'stale' | 'unknown' =
    freshness.freshness_state === 'unknown'
      ? 'unknown'
      : (freshness.data_age_minutes || 0) > HEALTH_STALE_AFTER_HOURS * 60
        ? 'stale'
        : 'fresh';

  const totals = Object.keys(byRepo).length > 0
    ? Object.values(byRepo).reduce(
        (acc, status) => {
          acc[status] += 1;
          return acc;
        },
        { ok: 0, warn: 0, fail: 0, unknown: 0 }
      )
    : {
        // Fall back to aggregate values from the metrics snapshot when no per-repo
        // status entries are present (e.g. aggregate-only snapshot format).
        ok: metrics.status?.ok ?? 0,
        warn: metrics.status?.warn ?? 0,
        fail: metrics.status?.fail ?? 0,
        unknown: 0,
      };

  return {
    source_kind: sourceKind,
    missing_reason: reason,
    timestamp: freshness.data_timestamp,
    by_repo: byRepo,
    totals,
    freshness_state: healthFreshness,
    data_age_minutes: freshness.data_age_minutes,
    stale_after_hours: HEALTH_STALE_AFTER_HOURS,
  };
}

/**
 * Controller for loading Anatomy view data.
 *
 * Uses loadWithFallback for artifact→fixture resolution, then pipes the
 * result through validateAnatomySnapshot (from anatomy.ts) for structural
 * integrity checks (nodes, edges, achsen present).
 *
 * Note: loadAnatomySnapshot() in anatomy.ts provides a throwing single-file
 * loader; the controller intentionally uses loadWithFallback instead so the
 * artifact→fixture fallback logic is available here.
 */
export async function getAnatomyData(): Promise<AnatomyViewData> {
  const { isStrict, isStrictFail, paths } = envConfig;

  const artifactPath = join(paths.artifacts, 'anatomy.snapshot.json');
  const fixturePath = join(paths.fixtures, 'anatomy.snapshot.json');

  const loaded = await loadWithFallback<AnatomySnapshot>(artifactPath, fixturePath, {
    strict: isStrict,
    strictFail: isStrictFail,
    name: 'Anatomy',
  });

  const health = await loadHealthOverlay();

  const raw = loaded.data;

  // Structural validation via the dedicated anatomy validator
  if (raw) {
    const freshness = computeFreshness(raw.generated_at);
    const validation = validateAnatomySnapshot(raw);

    if (!validation.valid) {
      console.warn(`[Anatomy] Structural validation failed: ${validation.error}`);
      return {
        anatomy: null,
        health,
        view_meta: {
          source_kind: loaded.source,
          missing_reason: `invalid_structure: ${validation.error}`,
          is_strict: isStrict,
          schema_valid: false,
          data_timestamp: freshness.data_timestamp,
          data_age_minutes: freshness.data_age_minutes,
          freshness_state: freshness.freshness_state,
          stale_after_hours: STALE_AFTER_HOURS,
        },
      };
    }

    return {
      anatomy: raw,
      health,
      view_meta: {
        source_kind: loaded.source,
        missing_reason: loaded.reason,
        is_strict: isStrict,
        schema_valid: validation.schemaValid,
        data_timestamp: freshness.data_timestamp,
        data_age_minutes: freshness.data_age_minutes,
        freshness_state: freshness.freshness_state,
        stale_after_hours: STALE_AFTER_HOURS,
      },
    };
  }

  return {
    anatomy: null,
    health,
    view_meta: {
      source_kind: loaded.source,
      missing_reason: loaded.reason,
      is_strict: isStrict,
      schema_valid: false,
      data_timestamp: null,
      data_age_minutes: null,
      freshness_state: 'unknown',
      stale_after_hours: STALE_AFTER_HOURS,
    },
  };
}
