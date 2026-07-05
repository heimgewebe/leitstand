import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type RepoBriefSourceKind = 'artifact' | 'missing' | 'corrupt';
export type RepoBriefStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface RepoBriefBundleView {
  repo: string;
  bundle_stem: string;
  bundle_directory: string;
  bundle_manifest: string;
  agent_reading_pack: string;
  canonical_dump: string;
  source_commit: string | null;
  snapshot_status: RepoBriefStatus;
  preflight_status: RepoBriefStatus;
  export_safety: RepoBriefStatus;
  public_export_ready: boolean;
  summary: string;
  required_artifacts: string[];
  warnings: string[];
}

export interface RepoBriefViewData {
  bundles: RepoBriefBundleView[];
  view_meta: {
    source_kind: RepoBriefSourceKind;
    source_path: string;
    missing_reason: string;
    generated_at: string | null;
    bundle_count: number;
    public_export_ready_count: number;
    warning_count: number;
    does_not_establish: string[];
  };
}

const CONTRACT_KIND = 'leitstand_repobrief_bundle_index';
const DEFAULT_NON_CLAIMS = [
  'repo_understanding',
  'public_export_safety',
  'review_completeness',
  'runtime_correctness',
  'test_sufficiency',
];

function configuredBundleIndexPath(): string {
  return process.env.LEITSTAND_REPOBRIEF_BUNDLES_PATH
    || join(process.cwd(), 'src', 'fixtures', 'repobrief-bundles.json');
}

function normalizeStatus(value: unknown): RepoBriefStatus {
  if (value === 'ok' || value === 'pass') return 'ok';
  if (value === 'warn' || value === 'warning') return 'warn';
  if (value === 'fail' || value === 'failed' || value === 'error') return 'fail';
  return 'unknown';
}

function classifyError(error: unknown): { kind: RepoBriefSourceKind; reason: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('enoent') || message.includes('no such file')) {
    return { kind: 'missing', reason: 'repobrief_bundle_index_missing' };
  }
  if (message.includes('json') || message.includes('invalid') || message.includes('unexpected')) {
    return { kind: 'corrupt', reason: 'repobrief_bundle_index_corrupt' };
  }
  return { kind: 'corrupt', reason: 'repobrief_bundle_index_load_failed' };
}

function emptyData(kind: RepoBriefSourceKind, reason: string, sourcePath: string): RepoBriefViewData {
  return {
    bundles: [],
    view_meta: {
      source_kind: kind,
      source_path: sourcePath,
      missing_reason: reason,
      generated_at: null,
      bundle_count: 0,
      public_export_ready_count: 0,
      warning_count: 0,
      does_not_establish: DEFAULT_NON_CLAIMS,
    },
  };
}

function parseStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
}

function parseBundle(raw: unknown): RepoBriefBundleView {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid RepoBrief bundle: must be object');
  }
  const bundle = raw as Record<string, unknown>;
  const repo = typeof bundle.repo === 'string' ? bundle.repo : '';
  const bundleStem = typeof bundle.bundleStem === 'string' ? bundle.bundleStem : '';
  const bundleDirectory = typeof bundle.bundleDirectory === 'string' ? bundle.bundleDirectory : '';
  const bundleManifest = typeof bundle.bundleManifest === 'string' ? bundle.bundleManifest : '';
  const agentReadingPack = typeof bundle.agentReadingPack === 'string' ? bundle.agentReadingPack : '';
  const canonicalDump = typeof bundle.canonicalDump === 'string' ? bundle.canonicalDump : '';
  if (!repo || !bundleStem || !bundleDirectory || !bundleManifest || !agentReadingPack || !canonicalDump) {
    throw new Error('invalid RepoBrief bundle: missing required path fields');
  }
  return {
    repo,
    bundle_stem: bundleStem,
    bundle_directory: bundleDirectory,
    bundle_manifest: bundleManifest,
    agent_reading_pack: agentReadingPack,
    canonical_dump: canonicalDump,
    source_commit: typeof bundle.sourceCommit === 'string' ? bundle.sourceCommit : null,
    snapshot_status: normalizeStatus(bundle.snapshotStatus),
    preflight_status: normalizeStatus(bundle.preflightStatus),
    export_safety: normalizeStatus(bundle.exportSafety),
    public_export_ready: bundle.publicExportReady === true,
    summary: typeof bundle.summary === 'string' ? bundle.summary : '',
    required_artifacts: parseStringArray(bundle.requiredArtifacts),
    warnings: parseStringArray(bundle.warnings),
  };
}

function parseIndex(raw: unknown): {
  bundles: RepoBriefBundleView[];
  generatedAt: string | null;
  doesNotEstablish: string[];
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid RepoBrief bundle index: root must be object');
  }
  const index = raw as {
    schemaVersion?: unknown;
    kind?: unknown;
    generatedAt?: unknown;
    bundles?: unknown;
    doesNotEstablish?: unknown;
  };
  if (index.schemaVersion !== 1 || index.kind !== CONTRACT_KIND) {
    throw new Error('invalid RepoBrief bundle index: kind or schemaVersion mismatch');
  }
  if (!Array.isArray(index.bundles)) {
    throw new Error('invalid RepoBrief bundle index: bundles must be a list');
  }
  const bundles = index.bundles.map(parseBundle);
  return {
    bundles,
    generatedAt: typeof index.generatedAt === 'string' ? index.generatedAt : null,
    doesNotEstablish: parseStringArray(index.doesNotEstablish).length > 0
      ? parseStringArray(index.doesNotEstablish)
      : DEFAULT_NON_CLAIMS,
  };
}

export async function getRepoBriefData(): Promise<RepoBriefViewData> {
  const sourcePath = resolve(configuredBundleIndexPath());
  try {
    const parsed = parseIndex(JSON.parse(await readFile(sourcePath, 'utf-8')) as unknown);
    const warningCount = parsed.bundles.reduce((total, bundle) => total + bundle.warnings.length, 0);
    return {
      bundles: parsed.bundles,
      view_meta: {
        source_kind: 'artifact',
        source_path: sourcePath,
        missing_reason: 'ok',
        generated_at: parsed.generatedAt,
        bundle_count: parsed.bundles.length,
        public_export_ready_count: parsed.bundles.filter((bundle) => bundle.public_export_ready).length,
        warning_count: warningCount,
        does_not_establish: parsed.doesNotEstablish,
      },
    };
  } catch (error) {
    const classified = classifyError(error);
    return emptyData(classified.kind, classified.reason, sourcePath);
  }
}
