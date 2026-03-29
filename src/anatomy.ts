import { readJsonFile } from './utils/fs.js';

/**
 * Node in the Heimgewebe anatomy graph – represents a repository/organ
 */
export interface AnatomyNode {
  /** Unique identifier (repo slug) */
  id: string;
  /** Human-readable label */
  label: string;
  /** Functional role description */
  role: string;
  /** Functional axis (achse) this organ belongs to */
  achse: string;
  /** Detailed description */
  description: string;
}

/**
 * Edge in the anatomy graph – represents a contract-based relationship
 */
export interface AnatomyEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Contract name governing this relationship */
  contract: string;
  /** Human-readable label */
  label: string;
  /** Edge type: data flow, control flow, or governance */
  type: 'data' | 'control' | 'governance';
}

/**
 * Axis definition – functional grouping of organs
 */
export interface Achse {
  /** Display label */
  label: string;
  /** Color code for visualization */
  color: string;
  /** Description of the functional axis */
  description: string;
}

/**
 * Complete anatomy snapshot – structural model of the Heimgewebe organism
 */
export interface AnatomySnapshot {
  /** Schema version identifier */
  schema: string;
  /** Timestamp of snapshot generation */
  generated_at: string;
  /** Source identifier (fixture, artifact, etc.) */
  source: string;
  /** All organs/repos as graph nodes */
  nodes: AnatomyNode[];
  /** All contract-based relationships as edges */
  edges: AnatomyEdge[];
  /** Functional axis definitions with colors */
  achsen: Record<string, Achse>;
}

export const ANATOMY_SCHEMA_V1 = 'anatomy.snapshot.v1';

export interface AnatomyValidationResult {
  valid: boolean;
  schemaValid: boolean;
  error?: string;
}

/**
 * Validates the structural integrity of an anatomy snapshot.
 *
 * Checks for required fields (nodes, edges, achsen) and schema version.
 * Does not throw – returns a result object for the caller to act on.
 *
 * @param data - Parsed JSON data to validate
 * @returns Validation result with structural and schema validity
 */
export function validateAnatomySnapshot(data: unknown): AnatomyValidationResult {
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

  // Treat a missing schema as v1 — consistent with loadAnatomySnapshot() defaulting to ANATOMY_SCHEMA_V1.
  // The warning only fires for an explicit, non-matching schema value (never for undefined).
  const schemaValid = snapshot.schema === undefined || snapshot.schema === ANATOMY_SCHEMA_V1;
  if (!schemaValid) {
    console.warn(`[Anatomy] Schema mismatch: expected ${ANATOMY_SCHEMA_V1}, got ${snapshot.schema}`);
  }

  return { valid: true, schemaValid };
}

/**
 * Loads an anatomy snapshot from a JSON file.
 *
 * Performs basic structural validation without enforcing the full schema,
 * to remain resilient against upstream changes while catching corrupt data.
 *
 * @param path - Path to the anatomy JSON file
 * @returns Parsed anatomy snapshot
 * @throws Error if file cannot be read or has invalid structure
 */
export async function loadAnatomySnapshot(path: string): Promise<AnatomySnapshot> {
  const raw = await readJsonFile<AnatomySnapshot>(path);

  const validation = validateAnatomySnapshot(raw);
  if (!validation.valid) {
    throw new Error(`Invalid anatomy snapshot: ${validation.error}`);
  }

  return {
    schema: raw.schema || ANATOMY_SCHEMA_V1,
    generated_at: raw.generated_at || new Date().toISOString(),
    source: raw.source || 'unknown',
    nodes: raw.nodes,
    edges: raw.edges,
    achsen: raw.achsen,
  };
}
