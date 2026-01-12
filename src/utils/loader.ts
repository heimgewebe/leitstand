import { readJsonFile, EmptyFileError } from './fs.js';

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
  const isSyntaxError = (err: unknown): err is SyntaxError =>
    err instanceof SyntaxError || (typeof err === 'object' && err !== null && 'name' in err && (err as { name: unknown }).name === 'SyntaxError');

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
      // But we still fail on corruption (SyntaxError) if the caller expects it?
      // server.ts logic: "Strict: Artifact file contains invalid JSON" (throws)
      if (isSyntaxError(artifactError) || (artifactError instanceof Error && artifactError.message.startsWith('Invalid JSON'))) {
         console.error(`[STRICT] ${name} artifact corrupted. Failing.`, artifactError);
         // server.ts threw error here. We should probably propagate the error or return a specific "corrupt" reason?
         // The server.ts logic threw: throw new Error("Strict: Artifact file contains invalid JSON");
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
      } else if (isSyntaxError(artifactError) || (artifactError instanceof Error && artifactError.message.startsWith('Invalid JSON'))) {
         console.error(`${name} artifact contains invalid JSON:`, artifactError instanceof Error ? artifactError.message : String(artifactError));
         // server.ts threw error here
         throw new Error(`${name} artifact contains invalid JSON`);
      } else {
         // Other errors (permission etc)
         throw artifactError;
      }
    }
  }
}
