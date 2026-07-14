import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  loadEcosystemCrossLinks,
  type EcosystemCrossLinkData,
  type EcosystemCrossViewLink,
} from './ecosystemMapLinks.js';

const MANIFEST_KIND = 'system_catalog_map_artifact_manifest';
const MANIFEST_SCHEMA_PATH = 'catalog/ecosystem-map-artifact-manifest.schema.v1.json';
const MANIFEST_MODE = 'read_only_projection_source';
const DEFAULT_STALE_AFTER_HOURS = 168;
const GIT_TIMEOUT_MS = 2_500;
const MAX_GIT_OUTPUT_BYTES = 1_000_000;

const ARTIFACT_CONTRACT = [
  {
    role: 'canonical_ecosystem_map_mermaid',
    path: 'rendered/ecosystem-registry-map.mmd',
    contentType: 'text/mermaid',
  },
  {
    role: 'rendered_catalog_markdown',
    path: 'rendered/system-catalog.md',
    contentType: 'text/markdown',
  },
  {
    role: 'registry_nodes',
    path: 'registry/ecosystem/nodes.json',
    contentType: 'application/json',
  },
  {
    role: 'registry_edges',
    path: 'registry/ecosystem/edges.json',
    contentType: 'application/json',
  },
  {
    role: 'authority_matrix',
    path: 'registry/ecosystem/authority-matrix.v1.json',
    contentType: 'application/json',
  },
] as const;

const DOES_NOT_ESTABLISH_CONTRACT = [
  'claim_truth',
  'runtime_correctness',
  'merge_readiness',
  'system_catalog_registry_correctness',
  'consumer_view_correctness',
  'render_success_validates_map',
] as const;

export type EcosystemMapSourceKind = 'artifact' | 'missing' | 'corrupt';
export type EcosystemMapFreshness = 'fresh' | 'stale' | 'unknown';
export type EcosystemMapAlignment = 'exact' | 'compatible' | 'drifted' | 'unverifiable';

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
  schemaPath: string;
  mode: string;
  source: {
    repository: string;
    commit: string;
    generatedAt: string;
  };
  artifactCount: number;
  artifacts: MapManifestArtifact[];
  doesNotEstablish: string[];
}

interface GitCommandResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  outputOverflow: boolean;
}

interface ArtifactInspection {
  artifact: MapManifestArtifact;
  view: EcosystemMapArtifactView;
  matches: boolean;
}

interface AlignmentInspection {
  state: EcosystemMapAlignment;
  reason: string;
  sourceHead: string | null;
  commitsAhead: number | null;
  verifiedArtifactCount: number;
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
  map: EcosystemMapArtifactView | null;
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
    source_head: string | null;
    commits_ahead: number | null;
    alignment_state: EcosystemMapAlignment;
    alignment_reason: string;
    verified_artifact_count: number;
    generated_at: string | null;
    data_age_minutes: number | null;
    freshness_state: EcosystemMapFreshness;
    freshness_reason: string;
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
    map: null,
    cross_links: crossLinks.links,
    cross_link_meta: crossLinks.meta,
    view_meta: {
      source_kind: kind,
      missing_reason: reason,
      manifest_path: manifestPath,
      source_root: null,
      source_repository: null,
      source_commit: null,
      source_head: null,
      commits_ahead: null,
      alignment_state: 'unverifiable',
      alignment_reason: reason,
      verified_artifact_count: 0,
      generated_at: null,
      data_age_minutes: null,
      freshness_state: 'unknown',
      freshness_reason: reason,
      stale_after_hours: configuredStaleAfterHours(),
      does_not_establish: [
        'claim_truth',
        'runtime_correctness',
        'merge_readiness',
      ],
    },
  };
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseManifest(raw: unknown): MapManifest {
  if (!isRecord(raw)) {
    throw new Error('invalid ecosystem map manifest: root must be object');
  }
  if (!hasExactKeys(raw, [
    'schemaVersion',
    'kind',
    'contractVersion',
    'schemaPath',
    'mode',
    'source',
    'artifactCount',
    'artifacts',
    'doesNotEstablish',
  ])) {
    throw new Error('invalid ecosystem map manifest: fields mismatch');
  }
  if (raw.schemaVersion !== 1 || raw.kind !== MANIFEST_KIND) {
    throw new Error('invalid ecosystem map manifest: identity mismatch');
  }
  if (raw.contractVersion !== '1' || raw.schemaPath !== MANIFEST_SCHEMA_PATH) {
    throw new Error('invalid ecosystem map manifest: contract binding mismatch');
  }
  if (raw.mode !== MANIFEST_MODE) {
    throw new Error('invalid ecosystem map manifest: mode mismatch');
  }
  if (!isRecord(raw.source) || !hasExactKeys(raw.source, ['repository', 'commit', 'generatedAt'])) {
    throw new Error('invalid ecosystem map manifest: source fields mismatch');
  }
  if (raw.source.repository !== 'heimgewebe/systemkatalog') {
    throw new Error('invalid ecosystem map manifest: source repository mismatch');
  }
  if (typeof raw.source.commit !== 'string' || !/^[0-9a-f]{40}$/.test(raw.source.commit)) {
    throw new Error('invalid ecosystem map manifest: source commit mismatch');
  }
  if (typeof raw.source.generatedAt !== 'string' || Number.isNaN(new Date(raw.source.generatedAt).getTime())) {
    throw new Error('invalid ecosystem map manifest: generatedAt mismatch');
  }
  if (!Array.isArray(raw.artifacts) || raw.artifactCount !== ARTIFACT_CONTRACT.length || raw.artifacts.length !== ARTIFACT_CONTRACT.length) {
    throw new Error('invalid ecosystem map manifest: artifacts missing or count mismatch');
  }

  const artifacts = raw.artifacts.map((item, index): MapManifestArtifact => {
    if (!isRecord(item) || !hasExactKeys(item, ['role', 'path', 'contentType', 'bytes', 'sha256'])) {
      throw new Error(`invalid ecosystem map manifest: artifact fields mismatch at ${index}`);
    }
    const expected = ARTIFACT_CONTRACT[index];
    if (item.role !== expected.role || item.path !== expected.path || item.contentType !== expected.contentType) {
      throw new Error(`invalid ecosystem map manifest: artifact contract mismatch at ${index}`);
    }
    if (!Number.isInteger(item.bytes) || (item.bytes as number) < 1) {
      throw new Error(`invalid ecosystem map manifest: artifact bytes mismatch at ${index}`);
    }
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) {
      throw new Error(`invalid ecosystem map manifest: artifact sha256 mismatch at ${index}`);
    }
    return {
      role: expected.role,
      path: expected.path,
      contentType: expected.contentType,
      bytes: item.bytes as number,
      sha256: item.sha256,
    };
  });

  if (!Array.isArray(raw.doesNotEstablish)
    || raw.doesNotEstablish.length !== DOES_NOT_ESTABLISH_CONTRACT.length
    || raw.doesNotEstablish.some((item, index) => item !== DOES_NOT_ESTABLISH_CONTRACT[index])) {
    throw new Error('invalid ecosystem map manifest: non-claims mismatch');
  }

  const sourceRepository = raw.source.repository as string;
  const sourceCommit = raw.source.commit as string;
  const generatedAt = raw.source.generatedAt as string;

  return {
    schemaVersion: 1,
    kind: MANIFEST_KIND,
    contractVersion: '1',
    schemaPath: MANIFEST_SCHEMA_PATH,
    mode: MANIFEST_MODE,
    source: {
      repository: sourceRepository,
      commit: sourceCommit,
      generatedAt,
    },
    artifactCount: ARTIFACT_CONTRACT.length,
    artifacts,
    doesNotEstablish: [...DOES_NOT_ESTABLISH_CONTRACT],
  };
}

function ageFreshness(generatedAt: string | null, staleAfterHours: number): {
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
  const ageMinutes = Math.max(0, Math.floor((Date.now() - generatedMs) / 60_000));
  return {
    generated_at: new Date(generatedMs).toISOString(),
    data_age_minutes: ageMinutes,
    freshness_state: ageMinutes > staleAfterHours * 60 ? 'stale' : 'fresh',
  };
}

function resolveArtifactPath(sourceRoot: string, artifactPath: string): string {
  const resolved = resolve(sourceRoot, artifactPath);
  const rel = relative(sourceRoot, resolved);
  if (artifactPath.startsWith('/') || rel.startsWith('..') || rel === '') {
    throw new Error('invalid ecosystem map manifest: artifact path escapes source root');
  }
  return resolved;
}

function digestMatches(raw: Buffer, artifact: MapManifestArtifact): boolean {
  return raw.byteLength === artifact.bytes
    && createHash('sha256').update(raw).digest('hex') === artifact.sha256;
}

async function inspectCurrentArtifact(sourceRoot: string, artifact: MapManifestArtifact): Promise<ArtifactInspection> {
  const resolvedPath = resolveArtifactPath(sourceRoot, artifact.path);
  try {
    const raw = await readFile(resolvedPath);
    const matches = digestMatches(raw, artifact);
    return {
      artifact,
      matches,
      view: {
        role: artifact.role,
        path: artifact.path,
        content_type: artifact.contentType,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        content: matches ? raw.toString('utf-8') : null,
        missing_reason: matches ? null : 'artifact_integrity_mismatch',
      },
    };
  } catch {
    return {
      artifact,
      matches: false,
      view: {
        role: artifact.role,
        path: artifact.path,
        content_type: artifact.contentType,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        content: null,
        missing_reason: 'artifact_missing',
      },
    };
  }
}

function runGit(sourceRoot: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolveResult) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputOverflow = false;

    const child = spawn('git', ['-C', sourceRoot, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf-8').slice(0, 2_000),
        timedOut,
        outputOverflow,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, GIT_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_GIT_OUTPUT_BYTES) {
        outputOverflow = true;
        child.kill('SIGKILL');
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });
}

async function inspectAlignment(
  sourceRoot: string,
  manifest: MapManifest,
  currentArtifacts: ArtifactInspection[],
): Promise<AlignmentInspection> {
  const currentMismatch = currentArtifacts.find((item) => !item.matches);
  const headResult = await runGit(sourceRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const sourceHead = headResult.code === 0
    ? headResult.stdout.toString('utf-8').trim()
    : null;

  if (currentMismatch) {
    return {
      state: 'drifted',
      reason: `current_artifact_mismatch:${currentMismatch.artifact.path}`,
      sourceHead: /^[0-9a-f]{40}$/.test(sourceHead || '') ? sourceHead : null,
      commitsAhead: null,
      verifiedArtifactCount: currentArtifacts.filter((item) => item.matches).length,
    };
  }

  if (headResult.code !== 0 || headResult.timedOut || headResult.outputOverflow || sourceHead === null || !/^[0-9a-f]{40}$/.test(sourceHead)) {
    return {
      state: 'unverifiable',
      reason: 'source_git_head_unavailable',
      sourceHead: null,
      commitsAhead: null,
      verifiedArtifactCount: currentArtifacts.length,
    };
  }
  const verifiedSourceHead = sourceHead;

  const commitArtifacts = await Promise.all(manifest.artifacts.map(async (artifact) => {
    const result = await runGit(sourceRoot, [
      'show',
      '--no-ext-diff',
      '--no-textconv',
      `${manifest.source.commit}:${artifact.path}`,
    ]);
    return {
      artifact,
      matches: result.code === 0
        && !result.timedOut
        && !result.outputOverflow
        && digestMatches(result.stdout, artifact),
    };
  }));
  const commitMismatch = commitArtifacts.find((item) => !item.matches);
  if (commitMismatch) {
    return {
      state: 'drifted',
      reason: `source_commit_artifact_mismatch:${commitMismatch.artifact.path}`,
      sourceHead: verifiedSourceHead,
      commitsAhead: null,
      verifiedArtifactCount: commitArtifacts.filter((item) => item.matches).length,
    };
  }

  const ancestry = await runGit(sourceRoot, [
    'merge-base',
    '--is-ancestor',
    manifest.source.commit,
    verifiedSourceHead,
  ]);
  if (ancestry.code === 1) {
    return {
      state: 'drifted',
      reason: 'source_commit_not_ancestor',
      sourceHead: verifiedSourceHead,
      commitsAhead: null,
      verifiedArtifactCount: manifest.artifacts.length,
    };
  }
  if (ancestry.code !== 0 || ancestry.timedOut || ancestry.outputOverflow) {
    return {
      state: 'unverifiable',
      reason: 'source_commit_ancestry_unavailable',
      sourceHead: verifiedSourceHead,
      commitsAhead: null,
      verifiedArtifactCount: manifest.artifacts.length,
    };
  }

  if (verifiedSourceHead === manifest.source.commit) {
    return {
      state: 'exact',
      reason: 'source_head_matches_manifest_commit',
      sourceHead: verifiedSourceHead,
      commitsAhead: 0,
      verifiedArtifactCount: manifest.artifacts.length,
    };
  }

  const headArtifactDiff = await runGit(sourceRoot, [
    'diff',
    '--quiet',
    '--no-ext-diff',
    manifest.source.commit,
    verifiedSourceHead,
    '--',
    ...manifest.artifacts.map((artifact) => artifact.path),
  ]);
  if (headArtifactDiff.code === 1) {
    return {
      state: 'drifted',
      reason: 'source_head_artifact_drift',
      sourceHead: verifiedSourceHead,
      commitsAhead: null,
      verifiedArtifactCount: manifest.artifacts.length,
    };
  }
  if (headArtifactDiff.code !== 0 || headArtifactDiff.timedOut || headArtifactDiff.outputOverflow) {
    return {
      state: 'unverifiable',
      reason: 'source_head_artifact_comparison_unavailable',
      sourceHead: verifiedSourceHead,
      commitsAhead: null,
      verifiedArtifactCount: manifest.artifacts.length,
    };
  }

  const countResult = await runGit(sourceRoot, [
    'rev-list',
    '--count',
    `${manifest.source.commit}..${verifiedSourceHead}`,
  ]);
  const parsedCount = Number(countResult.stdout.toString('utf-8').trim());
  const commitsAhead = countResult.code === 0 && Number.isInteger(parsedCount) && parsedCount >= 0
    ? parsedCount
    : null;

  return {
    state: 'compatible',
    reason: 'current_head_preserves_declared_artifact_bytes',
    sourceHead: verifiedSourceHead,
    commitsAhead,
    verifiedArtifactCount: manifest.artifacts.length,
  };
}

function combineFreshness(
  ageState: EcosystemMapFreshness,
  alignment: AlignmentInspection,
): { state: EcosystemMapFreshness; reason: string } {
  if (alignment.state === 'drifted') {
    return { state: 'stale', reason: alignment.reason };
  }
  if (alignment.state === 'unverifiable') {
    return { state: 'unknown', reason: alignment.reason };
  }
  if (ageState === 'stale') {
    return { state: 'stale', reason: 'manifest_age_exceeds_threshold' };
  }
  if (ageState === 'unknown') {
    return { state: 'unknown', reason: 'manifest_age_unavailable' };
  }
  return { state: 'fresh', reason: 'artifact_alignment_verified' };
}

export async function getEcosystemMapData(): Promise<EcosystemMapViewData> {
  const manifestPath = resolve(configuredManifestPath());
  const staleAfterHours = configuredStaleAfterHours();
  const crossLinks = await loadEcosystemCrossLinks();
  try {
    const raw = JSON.parse(await readFile(manifestPath, 'utf-8')) as unknown;
    const manifest = parseManifest(raw);
    const sourceRoot = sourceRootForManifest(manifestPath);
    const ageState = ageFreshness(manifest.source.generatedAt, staleAfterHours);
    const currentArtifacts = await Promise.all(
      manifest.artifacts.map((artifact) => inspectCurrentArtifact(sourceRoot, artifact)),
    );
    const mapInspection = currentArtifacts.find(
      (item) => item.artifact.role === 'canonical_ecosystem_map_mermaid',
    );
    const map = mapInspection?.view || null;
    const missingReason = map?.missing_reason || (map ? 'ok' : 'artifact_role_missing');
    const alignment = await inspectAlignment(sourceRoot, manifest, currentArtifacts);
    const combinedFreshness = combineFreshness(ageState.freshness_state, alignment);

    return {
      map,
      cross_links: crossLinks.links,
      cross_link_meta: crossLinks.meta,
      view_meta: {
        source_kind: missingReason === 'ok' ? 'artifact' : 'missing',
        missing_reason: missingReason,
        manifest_path: manifestPath,
        source_root: sourceRoot,
        source_repository: manifest.source.repository,
        source_commit: manifest.source.commit,
        source_head: alignment.sourceHead,
        commits_ahead: alignment.commitsAhead,
        alignment_state: alignment.state,
        alignment_reason: alignment.reason,
        verified_artifact_count: alignment.verifiedArtifactCount,
        generated_at: ageState.generated_at,
        data_age_minutes: ageState.data_age_minutes,
        freshness_state: combinedFreshness.state,
        freshness_reason: combinedFreshness.reason,
        stale_after_hours: staleAfterHours,
        does_not_establish: manifest.doesNotEstablish,
      },
    };
  } catch (error) {
    const classified = classifyError(error);
    return emptyData(classified.kind, classified.reason, manifestPath, crossLinks);
  }
}
