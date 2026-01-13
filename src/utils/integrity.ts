import { readdir } from 'fs/promises';
import { join } from 'path';
import { readJsonFile } from './fs.js';

export interface IntegritySummary {
  repo: string;
  status: string;
  generated_at: string;
  counts?: {
    claims?: number;
    artifacts?: number;
    loop_gaps?: number;
    unclear?: number;
  };
  _source?: string;
  [key: string]: unknown;
}

export interface IntegrityLoadResult {
  summaries: IntegritySummary[];
  source: 'artifact' | 'fixture' | 'missing';
  reason: string;
}

export interface IntegrityLoadOptions {
  artifactDir: string;
  legacyArtifactPath: string;
  fixtureDir: string;
  legacyFixturePath: string;
  strict: boolean;
}

/**
 * Loads integrity summaries from artifacts or fixtures with fallback.
 */
export async function loadIntegritySummaries(options: IntegrityLoadOptions): Promise<IntegrityLoadResult> {
  const { artifactDir, legacyArtifactPath, fixtureDir, legacyFixturePath, strict } = options;
  const integritySummaries: IntegritySummary[] = [];

  const loadIntegrityFile = async (path: string, sourceLabel: string): Promise<IntegritySummary | null> => {
    try {
      const json = await readJsonFile<IntegritySummary>(path);
      if (json && typeof json === 'object') {
        // Tag it for the UI
        json._source = sourceLabel;
        return json;
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // 1. Try loading from artifacts/integrity/*.json
  try {
    const files = await readdir(artifactDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    for (const file of jsonFiles) {
      const summary = await loadIntegrityFile(join(artifactDir, file), 'artifact');
      if (summary) integritySummaries.push(summary);
    }
  } catch (e) {
    // Directory might not exist, which is fine
  }

  // 2. Try loading legacy artifact
  const legacySummary = await loadIntegrityFile(legacyArtifactPath, 'artifact');
  if (legacySummary) {
    // Avoid duplication if repo is same
    const exists = integritySummaries.find(s => s.repo === legacySummary.repo);
    if (!exists) integritySummaries.push(legacySummary);
  }

  // Check if we found anything in artifacts
  if (integritySummaries.length > 0) {
    return { summaries: integritySummaries, source: 'artifact', reason: 'ok' };
  }

  // 3. Fallback to fixtures if not strict
  if (!strict) {
    // Try directory fixtures
    try {
      const files = await readdir(fixtureDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      for (const file of jsonFiles) {
        const summary = await loadIntegrityFile(join(fixtureDir, file), 'fixture');
        if (summary) integritySummaries.push(summary);
      }
    } catch (e) { /* ignore */ }

    // Try legacy fixture
    const legacyFixture = await loadIntegrityFile(legacyFixturePath, 'fixture');
    if (legacyFixture) {
      const exists = integritySummaries.find(s => s.repo === legacyFixture.repo);
      if (!exists) integritySummaries.push(legacyFixture);
    }

    if (integritySummaries.length > 0) {
      return { summaries: integritySummaries, source: 'fixture', reason: 'fallback' };
    }

    return { summaries: [], source: 'missing', reason: 'enoent' };
  } else {
    // Strict mode and no artifacts found
    return { summaries: [], source: 'missing', reason: 'enoent' };
  }
}
