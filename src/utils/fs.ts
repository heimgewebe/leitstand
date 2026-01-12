import { readFile } from 'fs/promises';

export class EmptyFileError extends Error {
  code = 'EMPTY_FILE';
  constructor(path: string) {
    super(`File is empty: ${path}`);
    this.name = 'EmptyFileError';
  }
}

/**
 * Reads and parses a JSON file with robust error handling.
 * Throws EmptyFileError if the file is empty (whitespace only).
 * Throws Error with descriptive message if JSON is invalid.
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
      throw new Error(`Invalid JSON in ${path}: ${error.message}`);
    }
    throw error;
  }
}
