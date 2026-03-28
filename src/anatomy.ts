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

const ANATOMY_SCHEMA_V1 = 'anatomy.snapshot.v1';

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

  // Structural validation
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid anatomy snapshot: expected a JSON object');
  }

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new Error('Invalid anatomy snapshot: nodes array is missing or empty');
  }

  if (!Array.isArray(raw.edges)) {
    throw new Error('Invalid anatomy snapshot: edges array is missing');
  }

  if (!raw.achsen || typeof raw.achsen !== 'object') {
    throw new Error('Invalid anatomy snapshot: achsen map is missing');
  }

  // Schema version check (warn, don't fail – forward compatibility)
  if (raw.schema && raw.schema !== ANATOMY_SCHEMA_V1) {
    console.warn(`[Anatomy] Schema version mismatch: expected ${ANATOMY_SCHEMA_V1}, got ${raw.schema}`);
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
