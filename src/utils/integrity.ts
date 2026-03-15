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

const MAX_CONCURRENT_FILE_LOADS = 10;

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

  // Helper for bounded concurrency
  const loadIntegrityFilesBatched = async (dir: string, jsonFiles: string[], sourceLabel: string) => {
    for (let i = 0; i < jsonFiles.length; i += MAX_CONCURRENT_FILE_LOADS) {
      const batch = jsonFiles.slice(i, i + MAX_CONCURRENT_FILE_LOADS);
      const summaries = await Promise.all(batch.map(file => loadIntegrityFile(join(dir, file), sourceLabel)));
      for (const summary of summaries) {
        if (summary) integritySummaries.push(summary);
      }
    }
  };

  // 1. Try loading from artifacts/integrity/*.json
  try {
    const files = await readdir(artifactDir);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
    await loadIntegrityFilesBatched(artifactDir, jsonFiles, 'artifact');
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
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
      await loadIntegrityFilesBatched(fixtureDir, jsonFiles, 'fixture');
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
