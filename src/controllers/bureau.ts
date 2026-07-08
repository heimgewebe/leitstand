import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/**
 * Bureau task-board controller — Phase "Ausführungs-Achse".
 *
 * Read-only projection of Bureau task/claim state. Leitstand does NOT talk to
 * Bureau or Grabowski directly (that would couple the observer to execution);
 * it reads a contract-shaped snapshot artifact produced by a separate bridge
 * (see scripts/export-operator-snapshots.mjs) and renders it. Mirrors the
 * RepoBrief controller pattern: env-overridable path, contract-kind check,
 * source/freshness metadata and a `doesNotEstablish` non-claims list.
 */

export type BureauSourceKind = 'artifact' | 'fixture' | 'missing' | 'corrupt';
export type BureauFreshness = 'fresh' | 'stale' | 'unknown';

/** Canonical Bureau lifecycle states, normalised from producer vocab. */
export type BureauTaskState =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'unknown';

export interface BureauTaskView {
  id: string;
  title: string;
  state: BureauTaskState;
  claimant: string | null;
  repo: string | null;
  created_at: string | null;
  updated_at: string | null;
  receipt_ref: string | null;
  note: string;
}

export interface BureauViewData {
  tasks: BureauTaskView[];
  /** Ordered lifecycle columns for the board, each with its tasks. */
  columns: Array<{ state: BureauTaskState; label: string; tasks: BureauTaskView[] }>;
  view_meta: {
    source_kind: BureauSourceKind;
    source_path: string;
    source_path_display: string;
    missing_reason: string;
    generated_at: string | null;
    freshness_state: BureauFreshness;
    task_count: number;
    open_count: number;
    blocked_count: number;
    failed_count: number;
    does_not_establish: string[];
  };
}

const CONTRACT_KIND = 'leitstand_bureau_task_snapshot';
/** Bureau tasks are operational; a snapshot older than this reads as stale. */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6h

const DEFAULT_NON_CLAIMS = [
  'task_ownership',
  'claim_authority',
  'execution_truth',
  'dispatch_control',
  'completion_guarantee',
];

const COLUMN_ORDER: Array<{ state: BureauTaskState; label: string }> = [
  { state: 'queued', label: 'Queued' },
  { state: 'claimed', label: 'Claimed' },
  { state: 'running', label: 'Running' },
  { state: 'blocked', label: 'Blocked' },
  { state: 'done', label: 'Done' },
  { state: 'failed', label: 'Failed' },
];

/** States that still demand operator attention (used for the open counter). */
const OPEN_STATES: ReadonlySet<BureauTaskState> = new Set<BureauTaskState>([
  'queued',
  'claimed',
  'running',
  'blocked',
]);

function artifactSnapshotPath(): string {
  return process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH
    || join(process.cwd(), 'artifacts', 'bureau-tasks.json');
}

function fixtureSnapshotPath(): string {
  return join(process.cwd(), 'src', 'fixtures', 'bureau-tasks.json');
}

function fixtureFallbackEnabled(): boolean {
  const explicit = process.env.LEITSTAND_BUREAU_FIXTURE_FALLBACK;
  if (explicit !== undefined) {
    return explicit === '1' || explicit.toLowerCase() === 'true';
  }
  return process.env.LEITSTAND_STRICT === '0' || process.env.LEITSTAND_STRICT === 'false';
}

function normalizeState(value: unknown): BureauTaskState {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  if (v === 'queued' || v === 'pending' || v === 'open') return 'queued';
  if (v === 'claimed' || v === 'assigned') return 'claimed';
  if (v === 'running' || v === 'in_progress' || v === 'active') return 'running';
  if (v === 'blocked' || v === 'waiting' || v === 'stalled') return 'blocked';
  if (v === 'done' || v === 'completed' || v === 'complete') return 'done';
  if (v === 'failed' || v === 'error' || v === 'cancelled' || v === 'canceled') return 'failed';
  return 'unknown';
}

function classifyError(error: unknown): { kind: BureauSourceKind; reason: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('enoent') || message.includes('no such file')) {
    return { kind: 'missing', reason: 'bureau_snapshot_missing' };
  }
  if (message.includes('json') || message.includes('invalid') || message.includes('unexpected')) {
    return { kind: 'corrupt', reason: 'bureau_snapshot_corrupt' };
  }
  return { kind: 'corrupt', reason: 'bureau_snapshot_load_failed' };
}

function freshnessOf(generatedAt: string | null): BureauFreshness {
  if (!generatedAt) return 'unknown';
  const ts = Date.parse(generatedAt);
  if (Number.isNaN(ts)) return 'unknown';
  return Date.now() - ts <= STALE_AFTER_MS ? 'fresh' : 'stale';
}

function nullableString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function parseTask(raw: unknown): BureauTaskView {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid Bureau task: must be object');
  }
  const task = raw as Record<string, unknown>;
  const id = typeof task.id === 'string' ? task.id : '';
  if (!id) {
    throw new Error('invalid Bureau task: missing id');
  }
  return {
    id,
    title: typeof task.title === 'string' ? task.title : id,
    state: normalizeState(task.state),
    claimant: nullableString(task.claimant),
    repo: nullableString(task.repo),
    created_at: nullableString(task.createdAt),
    updated_at: nullableString(task.updatedAt),
    receipt_ref: nullableString(task.receiptRef),
    note: typeof task.note === 'string' ? task.note : '',
  };
}

function parseStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
}

function parseSnapshot(raw: unknown): {
  tasks: BureauTaskView[];
  generatedAt: string | null;
  doesNotEstablish: string[];
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid Bureau snapshot: root must be object');
  }
  const snapshot = raw as {
    schemaVersion?: unknown;
    kind?: unknown;
    generatedAt?: unknown;
    tasks?: unknown;
    doesNotEstablish?: unknown;
  };
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== CONTRACT_KIND) {
    throw new Error('invalid Bureau snapshot: kind or schemaVersion mismatch');
  }
  if (!Array.isArray(snapshot.tasks)) {
    throw new Error('invalid Bureau snapshot: tasks must be a list');
  }
  const nonClaims = parseStringArray(snapshot.doesNotEstablish);
  return {
    tasks: snapshot.tasks.map(parseTask),
    generatedAt: typeof snapshot.generatedAt === 'string' ? snapshot.generatedAt : null,
    doesNotEstablish: nonClaims.length > 0 ? nonClaims : DEFAULT_NON_CLAIMS,
  };
}

function buildColumns(tasks: BureauTaskView[]): BureauViewData['columns'] {
  return COLUMN_ORDER.map(({ state, label }) => ({
    state,
    label,
    tasks: tasks.filter((task) => task.state === state),
  }));
}


function displaySourcePath(sourcePath: string): string {
  const rel = relative(resolve(process.cwd()), resolve(sourcePath));
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel;
  return '<external snapshot>';
}

function emptyData(kind: BureauSourceKind, reason: string, sourcePath: string): BureauViewData {
  return {
    tasks: [],
    columns: buildColumns([]),
    view_meta: {
      source_kind: kind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath),
      missing_reason: reason,
      generated_at: null,
      freshness_state: 'unknown',
      task_count: 0,
      open_count: 0,
      blocked_count: 0,
      failed_count: 0,
      does_not_establish: DEFAULT_NON_CLAIMS,
    },
  };
}

function dataFromParsed(
  parsed: ReturnType<typeof parseSnapshot>,
  sourceKind: BureauSourceKind,
  sourcePath: string,
  missingReason: string,
): BureauViewData {
  return {
    tasks: parsed.tasks,
    columns: buildColumns(parsed.tasks),
    view_meta: {
      source_kind: sourceKind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath),
      missing_reason: missingReason,
      generated_at: parsed.generatedAt,
      freshness_state: freshnessOf(parsed.generatedAt),
      task_count: parsed.tasks.length,
      open_count: parsed.tasks.filter((task) => OPEN_STATES.has(task.state)).length,
      blocked_count: parsed.tasks.filter((task) => task.state === 'blocked').length,
      failed_count: parsed.tasks.filter((task) => task.state === 'failed').length,
      does_not_establish: parsed.doesNotEstablish,
    },
  };
}

async function loadSnapshot(path: string): Promise<ReturnType<typeof parseSnapshot>> {
  return parseSnapshot(JSON.parse(await readFile(path, 'utf-8')) as unknown);
}

export async function getBureauData(): Promise<BureauViewData> {
  const sourcePath = resolve(artifactSnapshotPath());
  try {
    return dataFromParsed(await loadSnapshot(sourcePath), 'artifact', sourcePath, 'ok');
  } catch (error) {
    const classified = classifyError(error);
    const envOverride = process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH !== undefined;
    if (envOverride || classified.kind !== 'missing' || !fixtureFallbackEnabled()) {
      return emptyData(classified.kind, classified.reason, sourcePath);
    }

    const fallbackPath = resolve(fixtureSnapshotPath());
    try {
      return dataFromParsed(
        await loadSnapshot(fallbackPath),
        'fixture',
        fallbackPath,
        'bureau_snapshot_missing_fixture_fallback',
      );
    } catch (fallbackError) {
      const fallbackClassified = classifyError(fallbackError);
      return emptyData(fallbackClassified.kind, fallbackClassified.reason, fallbackPath);
    }
  }
}
