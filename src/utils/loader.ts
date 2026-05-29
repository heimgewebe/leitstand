import { readJsonFile, EmptyFileError, InvalidJsonError } from './fs.js';

export interface LoadResult<T> {
  data: T | null;
  source: 'artifact' | 'fixture' | 'missing';
  reason: string;
}

export interface LoadOptions {
  strict: boolean;
  strictFail: boolean;
  name?: string; // e.g. "Observatory", "Insights"
}

/**
 * Loads data from an artifact with fallback to a fixture.
 * Respects strict mode flags.
 */
export async function loadWithFallback<T>(
  artifactPath: string,
  fixturePath: string,
  options: LoadOptions
): Promise<LoadResult<T>> {
  const { strict, strictFail, name = 'Artifact' } = options;

  // Type guards (helper)
  const isEnoent = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'ENOENT';

  try {
    // 1. Try Artifact
    const data = await readJsonFile<T>(artifactPath);
    return { data, source: 'artifact', reason: 'ok' };
  } catch (artifactError) {
    if (strictFail) {
      console.error(`[STRICT FAIL] ${name} artifact load failed. Aborting.`, artifactError);
      throw new Error(`Strict Fail: ${name} artifact missing or invalid.`);
    }

    if (strict) {
      // In strict mode (not failing), we treat missing/empty as Empty State.
      // But we still fail on corruption (InvalidJsonError) if the caller expects it?
      if (artifactError instanceof InvalidJsonError) {
         console.error(`[STRICT] ${name} artifact corrupted. Failing.`, artifactError);
         throw new Error(`Strict: ${name} artifact contains invalid JSON`);
      }

      let missingReason = 'unknown';
      if (artifactError instanceof EmptyFileError) missingReason = 'empty';
      else if (isEnoent(artifactError)) missingReason = 'enoent';

      console.warn(`[STRICT] ${name} artifact missing/empty. Proceeding with Empty State.`, artifactError instanceof Error ? artifactError.message : String(artifactError));

      return { data: null, source: 'missing', reason: missingReason };
    } else {
      // Dev / Fallback Mode
      if (isEnoent(artifactError) || artifactError instanceof EmptyFileError) {
        // Fallback to fixture
        const reason = artifactError instanceof EmptyFileError ? 'empty' : 'enoent';
        console.warn(`${name} loaded from fixture (fallback) - artifact ${reason}`);

        try {
          const data = await readJsonFile<T>(fixturePath);
          return { data, source: 'fixture', reason }; // reason refers to why artifact failed
        } catch (fixtureError) {
          console.warn(`Could not load ${name} fixture:`, fixtureError instanceof Error ? fixtureError.message : String(fixtureError));
          return { data: null, source: 'missing', reason: 'enoent' }; // Both missing
        }
      } else if (artifactError instanceof InvalidJsonError) {
         console.error(`${name} artifact contains invalid JSON:`, artifactError.message);
         throw new Error(`${name} artifact contains invalid JSON`);
      } else {
         // Other errors (permission etc)
         throw artifactError;
      }
    }
  }
}

/**
 * Best-effort load of a *supplementary* artifact (artifact → fixture fallback).
 *
 * Unlike {@link loadWithFallback}, this never throws and never participates in
 * strict-mode aborts: a missing or corrupt supplementary artifact (e.g. the
 * previous day's insights used only for a comparison) must never break the page
 * or trip strict-fail. Returns the first readable JSON payload, or a `missing`
 * result if none can be read.
 */
export async function loadOptional<T>(
  artifactPath: string,
  fixturePath: string,
  name = 'Artifact'
): Promise<LoadResult<T>> {
  const candidates: Array<{ path: string; source: 'artifact' | 'fixture' }> = [
    { path: artifactPath, source: 'artifact' },
    { path: fixturePath, source: 'fixture' },
  ];

  for (const { path, source } of candidates) {
    try {
      const data = await readJsonFile<T>(path);
      return { data, source, reason: 'ok' };
    } catch (err) {
      // ENOENT / empty → silently try the next candidate.
      // Corrupt JSON is non-fatal here but worth a log so it is not lost silently.
      if (err instanceof InvalidJsonError) {
        console.warn(`[${name}] Ignoring corrupt optional artifact at ${path}: ${err.message}`);
      }
    }
  }

  return { data: null, source: 'missing', reason: 'enoent' };
}
