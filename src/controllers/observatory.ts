import { join } from 'path';
import { loadWithFallback } from '../utils/loader.js';
import { loadLatestMetrics } from '../metrics.js';
import { loadIntegritySummaries } from '../utils/integrity.js';
import { readJsonFile } from '../utils/fs.js';
import { envConfig } from '../config.js';

interface SelfModel {
  confidence: number;
  fatigue: number;
  risk_tension: number;
  autonomy_level: "dormant" | "aware" | "reflective" | "critical";
  last_updated?: string;
  basis_signals: string[];
}

interface SelfStateSnapshot {
  timestamp: string;
  state: SelfModel;
}

interface SelfStateArtifact {
  schema?: string;
  current: SelfModel;
  history: SelfStateSnapshot[];
}

export interface ObservatoryViewData {
  data: unknown;
  insightsDaily: unknown;
  integritySummaries: unknown[];
  fleetMetrics: unknown;
  selfState: SelfStateArtifact | null;
  observatoryUrl: string;
  view_meta: {
    source_kind: string;
    insights_source_kind: string;
    integrity_source_kind: string;
    self_state_source_kind: string;
    self_state_schema_valid: boolean;
    missing_reason: string;
    insights_missing_reason: string;
    integrity_missing_reason: string;
    self_state_missing_reason: string;
    is_strict: boolean;
    forensics: unknown;
  };
}

/**
 * Controller for loading Observatory view data
 */
export async function getObservatoryData(): Promise<ObservatoryViewData> {
  const { isStrict, isStrictFail, OBSERVATORY_URL, paths } = envConfig;

  const observatoryUrl = OBSERVATORY_URL;
  const artifactDir = paths.artifacts;
  const fixtureDir = paths.fixtures;

  // Load Knowledge Observatory
  const defaultArtifactPath = join(artifactDir, 'knowledge.observatory.json');
  const artifactPath = envConfig.OBSERVATORY_ARTIFACT_PATH || defaultArtifactPath;
  const fixturePath = join(fixtureDir, 'observatory.json');

  const observatoryLoad = await loadWithFallback(artifactPath, fixturePath, { strict: isStrict, strictFail: isStrictFail, name: 'Observatory' });

  // Load insights.daily.json
  const insightsArtifactPath = join(artifactDir, 'insights.daily.json');
  const insightsFixturePath = join(fixtureDir, 'insights.daily.json');

  const insightsLoad = await loadWithFallback(insightsArtifactPath, insightsFixturePath, { strict: isStrict, strictFail: isStrictFail, name: 'Insights Daily' });

  // Load integrity summaries
  const integrityLoad = await loadIntegritySummaries({
    artifactDir: join(artifactDir, 'integrity'),
    legacyArtifactPath: join(artifactDir, 'integrity.summary.json'),
    fixtureDir: join(fixtureDir, 'integrity'),
    legacyFixturePath: join(fixtureDir, 'integrity.summary.json'),
    strict: isStrict
  });

  // Load Fleet Metrics
  let fleetMetrics = null;
  try {
    const metricsDir = join(artifactDir, 'metrics');
    fleetMetrics = await loadLatestMetrics(metricsDir);

    if (!fleetMetrics && !isStrict) {
      const metricsFixtureDir = join(fixtureDir, 'metrics');
      fleetMetrics = await loadLatestMetrics(metricsFixtureDir);
    }
  } catch (e) {
    console.warn('Failed to load fleet metrics for observatory:', e instanceof Error ? e.message : String(e));
  }

  // Load Self-State
  const selfStateArtifactPath = join(artifactDir, 'self_state.json');
  const selfStateFixturePath = join(fixtureDir, 'self_state.json');

  const selfStateLoad = await loadWithFallback<SelfStateArtifact>(selfStateArtifactPath, selfStateFixturePath, {
    strict: isStrict,
    strictFail: false,
    name: 'Self-State'
  });

  const selfState = selfStateLoad.data;

  // Ensure history is sorted descending by date
  if (selfState && selfState.history && Array.isArray(selfState.history)) {
    selfState.history.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }

  // Check Schema
  let selfStateSchemaValid = false;
  const EXPECTED_SCHEMA = "heimgeist.self_state.bundle.v1";
  if (selfState) {
    if (selfState.schema === EXPECTED_SCHEMA) {
      selfStateSchemaValid = true;
    } else {
      console.warn(`[SelfState] Schema mismatch. Expected ${EXPECTED_SCHEMA}, got ${selfState.schema}`);
    }
  }

  // Load forensic metadata
  let forensics = {};
  try {
    const metaPath = join(artifactDir, '_meta.json');
    forensics = await readJsonFile(metaPath);
  } catch (e) { /* ignore */ }

  return {
    data: observatoryLoad.data,
    insightsDaily: insightsLoad.data,
    integritySummaries: integrityLoad.summaries,
    fleetMetrics,
    selfState,
    observatoryUrl,
    view_meta: {
      source_kind: observatoryLoad.source,
      insights_source_kind: insightsLoad.source,
      integrity_source_kind: integrityLoad.source,
      self_state_source_kind: selfStateLoad.source,
      self_state_schema_valid: selfStateSchemaValid,
      missing_reason: observatoryLoad.reason,
      insights_missing_reason: insightsLoad.reason,
      integrity_missing_reason: integrityLoad.reason,
      self_state_missing_reason: selfStateLoad.reason,
      is_strict: isStrict,
      forensics: forensics
    }
  };
}
