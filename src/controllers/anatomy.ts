import { join } from 'path';
import { loadWithFallback } from '../utils/loader.js';
import { envConfig } from '../config.js';
import type { AnatomySnapshot } from '../anatomy.js';

export interface AnatomyViewData {
  anatomy: AnatomySnapshot | null;
  view_meta: {
    source_kind: string;
    missing_reason: string;
    is_strict: boolean;
    schema_valid: boolean;
  };
}

/**
 * Controller for loading Anatomy view data.
 *
 * Follows the same loadWithFallback pattern as the Observatory controller:
 * artifact → fixture → null (in strict mode, fixture fallback is disabled).
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

  const anatomy = loaded.data;
  let schemaValid = false;

  if (anatomy) {
    schemaValid = anatomy.schema === 'anatomy.snapshot.v1';
    if (!schemaValid) {
      console.warn(`[Anatomy] Schema mismatch: expected anatomy.snapshot.v1, got ${anatomy.schema}`);
    }
  }

  return {
    anatomy,
    view_meta: {
      source_kind: loaded.source,
      missing_reason: loaded.reason,
      is_strict: isStrict,
      schema_valid: schemaValid,
    },
  };
}
