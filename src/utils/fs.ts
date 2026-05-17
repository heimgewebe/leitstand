import { readFile, stat } from 'fs/promises';

export class EmptyFileError extends Error {
  code = 'EMPTY_FILE';
  constructor(path: string) {
    super(`File is empty: ${path}`);
    this.name = 'EmptyFileError';
  }
}

export class InvalidJsonError extends Error {
  code = 'INVALID_JSON';
  constructor(path: string, originalMessage: string) {
    super(`Invalid JSON in ${path}: ${originalMessage}`);
    this.name = 'InvalidJsonError';
  }
}

/**
 * Reads and parses a JSON file with robust error handling.
 * Throws EmptyFileError if the file is empty (whitespace only).
 * Throws InvalidJsonError if JSON is invalid.
 */
export async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  if (!content.trim()) {
    throw new EmptyFileError(path);
  }
  try {
    return JSON.parse(content) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidJsonError(path, error.message);
    }
    throw error;
  }
}

/**
 * Returns the mtime of a file as an ISO string, or null if the path is
 * missing/unreadable. Used by view controllers as a transport-level
 * freshness fallback when no semantic timestamp is available in the payload.
 */
export async function getTransportTimestamp(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const fileStats = await stat(path);
    return fileStats.mtime.toISOString();
  } catch {
    return null;
  }
}
