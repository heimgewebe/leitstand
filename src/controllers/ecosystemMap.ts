import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative } from 'node:path';
import {
  loadEcosystemCrossLinks,
  type EcosystemCrossLinkData,
  type EcosystemCrossViewLink,
} from './ecosystemMapLinks.js';

const MANIFEST_KIND = 'cabinet_ecosystem_map_artifact_manifest';
const DEFAULT_STALE_AFTER_HOURS = 168;

export type EcosystemMapSourceKind = 'artifact' | 'missing' | 'corrupt';
export type EcosystemMapFreshness = 'fresh' | 'stale' | 'unknown';

interface MapManifestArtifact {
  role: string;
  path: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

interface MapManifest {
  schemaVersion: number;
  kind: string;
  contractVersion: string;
  source: {
    repository: string;
    commit: string;
    generatedAt: string;
  };
  artifactCount: number;
  artifacts: MapManifestArtifact[];
  doesNotEstablish: string[];
}

export interface EcosystemMapArtifactView {
  role: string;
  path: string;
  content_type: string;
  bytes: number;
  sha256: string;
  content: string | null;
  missing_reason: string | null;
}

export interface EcosystemMapViewData {
  overview: EcosystemMapArtifactView | null;
  registry_projection: EcosystemMapArtifactView | null;
  cross_links: EcosystemCrossViewLink[];
  cross_link_meta: {
    source_kind: string;
    source_path: string;
    missing_reason: string;
    does_not_establish: string[];
  };
  view_meta: {
    source_kind: EcosystemMapSourceKind;
    missing_reason: string;
    manifest_path: string;
    source_root: string | null;
    source_repository: string | null;
    source_commit: string | null;
    generated_at: string | null;
    data_age_minutes: number | null;
    freshness_state: EcosystemMapFreshness;
    stale_after_hours: number;
    does_not_establish: string[];
  };
}

function configuredManifestPath(): string {
  return process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH
    || join(process.cwd(), 'artifacts', 'ecosystem-map-artifact-manifest.json');
}

function configuredStaleAfterHours(): number {
  const raw = process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS;
  const parsed = raw ? Number(raw) : DEFAULT_STALE_AFTER_HOURS;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_STALE_AFTER_HOURS;
}

function sourceRootForManifest(manifestPath: string): string {
  if (process.env.LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT) {
    return resolve(process.env.LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT);
  }

  const manifestDir = dirname(resolve(manifestPath));
  return basename(manifestDir) === 'rendered' ? dirname(manifestDir) : manifestDir;
}

function classifyError(error: unknown): { kind: EcosystemMapSourceKind; reason: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('enoent') || message.includes('no such file')) {
    return { kind: 'missing', reason: 'manifest_missing' };
  }
  if (message.includes('json') || message.includes('invalid') || message.includes('unexpected')) {
    return { kind: 'corrupt', reason: 'manifest_corrupt' };
  }
  return { kind: 'corrupt', reason: 'manifest_load_failed' };
}

function emptyData(
  kind: EcosystemMapSourceKind,
  reason: string,
  manifestPath: string,
  crossLinks: EcosystemCrossLinkData,
): EcosystemMapViewData {
  return {
    overview: null,
    registry_projection: null,
    cross_links: crossLinks.links,
    cross_link_meta: crossLinks.meta,
    view_meta: {
      source_kind: kind,
      missing_reason: reason,
      manifest_path: manifestPath,
      source_root: null,
      source_repository: null,
      source_commit: null,
      generated_at: null,
      data_age_minutes: null,
      freshness_state: 'unknown',
      stale_after_hours: configuredStaleAfterHours(),
      does_not_establish: [
        'claim_truth',
        'runtime_correctness',
        'merge_readiness',
      ],
    },
  };
}

function parseManifest(raw: unknown): MapManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid ecosystem map manifest: root must be object');
  }
  const manifest = raw as Partial<MapManifest>;
  if (manifest.schemaVersion !== 1) {
    throw new Error('invalid ecosystem map manifest: schemaVersion must be 1');
  }
  if (manifest.kind !== MANIFEST_KIND) {
    throw new Error('invalid ecosystem map manifest: kind mismatch');
  }
  if (!manifest.source || typeof manifest.source !== 'object') {
    throw new Error('invalid ecosystem map manifest: source missing');
  }
  if (manifest.source.repository !== 'heimgewebe/heimgewebe-katalog') {
    throw new Error('invalid ecosystem map manifest: source repository mismatch');
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.source.commit || '')) {
    throw new Error('invalid ecosystem map manifest: source commit mismatch');
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error('invalid ecosystem map manifest: artifacts missing');
  }
  if (!Array.isArray(manifest.doesNotEstablish)) {
    throw new Error('invalid ecosystem map manifest: non-claims missing');
  }
  return manifest as MapManifest;
}

function freshness(generatedAt: string | null, staleAfterHours: number): {
  generated_at: string | null;
  data_age_minutes: number | null;
  freshness_state: EcosystemMapFreshness;
} {
  if (!generatedAt) {
    return { generated_at: null, data_age_minutes: null, freshness_state: 'unknown' };
  }
  const generatedMs = new Date(generatedAt).getTime();
  if (Number.isNaN(generatedMs)) {
    return { generated_at: generatedAt, data_age_minutes: null, freshness_state: 'unknown' };
  }
  const ageMinutes = Math.max(0, Math.floor((Date.now() - generatedMs) / 60000));
  return {
    generated_at: new Date(generatedMs).toISOString(),
    data_age_minutes: ageMinutes,
    freshness_state: ageMinutes > staleAfterHours * 60 ? 'stale' : 'fresh',
  };
}

function resolveArtifactPath(sourceRoot: string, artifactPath: string): string {
  if (artifactPath.startsWith('/') || artifactPath.includes('..')) {
    throw new Error('invalid ecosystem map manifest: artifact path escapes source root');
  }
  const resolved = resolve(sourceRoot, artifactPath);
  const rel = relative(sourceRoot, resolved);
  if (rel.startsWith('..') || rel === '') {
    throw new Error('invalid ecosystem map manifest: artifact path escapes source root');
  }
  return resolved;
}

async function readArtifact(sourceRoot: string, artifact: MapManifestArtifact | undefined): Promise<EcosystemMapArtifactView | null> {
  if (!artifact) return null;
  const resolvedPath = resolveArtifactPath(sourceRoot, artifact.path);
  try {
    const content = await readFile(resolvedPath, 'utf-8');
    return {
      role: artifact.role,
      path: artifact.path,
      content_type: artifact.contentType,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      content,
      missing_reason: null,
    };
  } catch {
    return {
      role: artifact.role,
      path: artifact.path,
      content_type: artifact.contentType,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      content: null,
      missing_reason: 'artifact_missing',
    };
  }
}

export async function getEcosystemMapData(): Promise<EcosystemMapViewData> {
  const manifestPath = resolve(configuredManifestPath());
  const staleAfterHours = configuredStaleAfterHours();
  const crossLinks = await loadEcosystemCrossLinks();
  try {
    const raw = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
    const manifest = parseManifest(raw);
    const sourceRoot = sourceRootForManifest(manifestPath);
    const freshnessState = freshness(manifest.source.generatedAt, staleAfterHours);
    const overviewSpec = manifest.artifacts.find((artifact) => artifact.role === 'readable_overview_mermaid');
    const registrySpec = manifest.artifacts.find((artifact) => artifact.role === 'generated_registry_projection_mermaid');
    const [overview, registryProjection] = await Promise.all([
      readArtifact(sourceRoot, overviewSpec),
      readArtifact(sourceRoot, registrySpec),
    ]);

    const missingReason = overview?.missing_reason || registryProjection?.missing_reason || 'ok';

    return {
      overview,
      registry_projection: registryProjection,
      cross_links: crossLinks.links,
      cross_link_meta: crossLinks.meta,
      view_meta: {
        source_kind: missingReason === 'ok' ? 'artifact' : 'missing',
        missing_reason: missingReason,
        manifest_path: manifestPath,
        source_root: sourceRoot,
        source_repository: manifest.source.repository,
        source_commit: manifest.source.commit,
        generated_at: freshnessState.generated_at,
        data_age_minutes: freshnessState.data_age_minutes,
        freshness_state: freshnessState.freshness_state,
        stale_after_hours: staleAfterHours,
        does_not_establish: manifest.doesNotEstablish,
      },
    };
  } catch (error) {
    const classified = classifyError(error);
    return emptyData(classified.kind, classified.reason, manifestPath, crossLinks);
  }
}
