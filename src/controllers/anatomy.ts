import { join } from 'path';
import { loadWithFallback } from '../utils/loader.js';
import { envConfig } from '../config.js';
import type { AnatomySnapshot } from '../anatomy.js';
import { validateAnatomySnapshot } from '../anatomy.js';

export interface AnatomyViewData {
  anatomy: AnatomySnapshot | null;
  view_meta: {
    source_kind: 'artifact' | 'fixture' | 'missing';
    missing_reason: string;
    is_strict: boolean;
    schema_valid: boolean;
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

  const raw = loaded.data;

  // Structural validation via the dedicated anatomy validator
  if (raw) {
    const validation = validateAnatomySnapshot(raw);

    if (!validation.valid) {
      console.warn(`[Anatomy] Structural validation failed: ${validation.error}`);
      return {
        anatomy: null,
        view_meta: {
          source_kind: loaded.source,
          missing_reason: `invalid_structure: ${validation.error}`,
          is_strict: isStrict,
          schema_valid: false,
        },
      };
    }

    return {
      anatomy: raw,
      view_meta: {
        source_kind: loaded.source,
        missing_reason: loaded.reason,
        is_strict: isStrict,
        schema_valid: validation.schemaValid,
      },
    };
  }

  return {
    anatomy: null,
    view_meta: {
      source_kind: loaded.source,
      missing_reason: loaded.reason,
      is_strict: isStrict,
      schema_valid: false,
    },
  };
}
