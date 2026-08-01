import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ANATOMY_SCHEMA_V1 = 'anatomy.snapshot.v1';

interface AnatomyValidationResult {
  valid: boolean;
  schemaValid: boolean;
  error?: string;
}

/**
 * Test-local reference for the last structural validator contract attached to
 * the remaining historical fixture. The anatomy runtime was removed, so this
 * must not restore an anatomy loader or route to production code.
 */
function validateHistoricalAnatomySnapshot(data: unknown): AnatomyValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, schemaValid: false, error: 'expected a JSON object' };
  }

  const snapshot = data as Record<string, unknown>;
  if (!Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) {
    return { valid: false, schemaValid: false, error: 'nodes array is missing or empty' };
  }
  if (!Array.isArray(snapshot.edges)) {
    return { valid: false, schemaValid: false, error: 'edges array is missing' };
  }
  if (!snapshot.achsen || typeof snapshot.achsen !== 'object') {
    return { valid: false, schemaValid: false, error: 'achsen map is missing' };
  }

  return {
    valid: true,
    schemaValid: snapshot.schema === undefined || snapshot.schema === ANATOMY_SCHEMA_V1,
  };
}

const structurallyValidSnapshot = {
  nodes: [{ id: 'leitstand' }],
  edges: [],
  achsen: {},
};

describe('historical anatomy snapshot contract', () => {
  it('accepts the repository fixture as schema v1 evidence', async () => {
    const fixturePath = join(process.cwd(), 'src', 'fixtures', 'anatomy.snapshot.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf-8')) as unknown;

    expect(validateHistoricalAnatomySnapshot(fixture)).toEqual({
      valid: true,
      schemaValid: true,
    });
  });

  it.each([
    ['a null document', null, 'expected a JSON object'],
    ['an empty nodes array', { ...structurallyValidSnapshot, nodes: [] }, 'nodes array is missing or empty'],
    ['a missing edges array', { nodes: structurallyValidSnapshot.nodes, achsen: {} }, 'edges array is missing'],
    ['a missing axes map', { nodes: structurallyValidSnapshot.nodes, edges: [] }, 'achsen map is missing'],
  ])('rejects %s', (_label, input, error) => {
    expect(validateHistoricalAnatomySnapshot(input)).toEqual({
      valid: false,
      schemaValid: false,
      error,
    });
  });

  it('keeps a missing schema compatible but identifies an explicit schema mismatch', () => {
    expect(validateHistoricalAnatomySnapshot(structurallyValidSnapshot)).toEqual({
      valid: true,
      schemaValid: true,
    });
    expect(validateHistoricalAnatomySnapshot({
      ...structurallyValidSnapshot,
      schema: 'anatomy.snapshot.v2',
    })).toEqual({
      valid: true,
      schemaValid: false,
    });
  });
});
