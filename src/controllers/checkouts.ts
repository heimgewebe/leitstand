import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/**
 * Checkout / worktree health controller — Phase "Ausführungs-Achse".
 *
 * Read-only projection of Grabowski's linked-checkout inventory. Worktree
 * sprawl (many long-lived, unretained checkouts) is an operational health
 * signal the observer should surface, not act on. Leitstand reads a
 * contract-shaped snapshot artifact produced by a separate bridge; it never
 * calls Grabowski to enumerate or mutate checkouts itself.
 */

export type CheckoutSourceKind = 'artifact' | 'fixture' | 'missing' | 'corrupt';
export type CheckoutFreshness = 'fresh' | 'stale' | 'unknown';

/** Retention verdict, normalised from producer vocab. Ordered worst→best for triage. */
export type CheckoutRetention = 'orphan' | 'archivable' | 'retained' | 'unknown';

export interface CheckoutView {
  path: string;
  repo: string | null;
  branch: string | null;
  head: string | null;
  retention: CheckoutRetention;
  has_process: boolean;
  has_resource_lease: boolean;
  matches_runtime: boolean;
  note: string;
}

export interface CheckoutViewData {
  checkouts: CheckoutView[];
  view_meta: {
    source_kind: CheckoutSourceKind;
    source_path: string;
    source_path_display: string;
    missing_reason: string;
    generated_at: string | null;
    freshness_state: CheckoutFreshness;
    checkout_count: number;
    orphan_count: number;
    archivable_count: number;
    retained_count: number;
    /** Checkouts with no retention owner AND no process/lease → prime sprawl candidates. */
    sprawl_count: number;
    does_not_establish: string[];
  };
}

const CONTRACT_KIND = 'leitstand_checkout_inventory';
/** Checkout inventory changes slowly; a day-old snapshot is still useful but flagged. */
const STALE_AFTER_MS = 20 * 60 * 1000; // 20m

const DEFAULT_NON_CLAIMS = [
  'checkout_ownership',
  'cleanup_authority',
  'branch_deletion',
  'retention_decision',
  'process_control',
];

function artifactSnapshotPath(): string {
  return process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH
    || join(process.cwd(), 'artifacts', 'checkout-inventory.json');
}

function fixtureSnapshotPath(): string {
  return join(process.cwd(), 'src', 'fixtures', 'checkout-inventory.json');
}

function fixtureFallbackEnabled(): boolean {
  const explicit = process.env.LEITSTAND_CHECKOUT_FIXTURE_FALLBACK;
  if (explicit !== undefined) {
    return explicit === '1' || explicit.toLowerCase() === 'true';
  }
  return process.env.LEITSTAND_STRICT === '0' || process.env.LEITSTAND_STRICT === 'false';
}

function normalizeRetention(value: unknown): CheckoutRetention {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  if (v === 'retained' || v === 'kept' || v === 'owned') return 'retained';
  if (v === 'archivable' || v === 'archived' || v === 'stale') return 'archivable';
  if (v === 'orphan' || v === 'orphaned' || v === 'untracked') return 'orphan';
  return 'unknown';
}

function classifyError(error: unknown): { kind: CheckoutSourceKind; reason: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('enoent') || message.includes('no such file')) {
    return { kind: 'missing', reason: 'checkout_inventory_missing' };
  }
  if (message.includes('json') || message.includes('invalid') || message.includes('unexpected')) {
    return { kind: 'corrupt', reason: 'checkout_inventory_corrupt' };
  }
  return { kind: 'corrupt', reason: 'checkout_inventory_load_failed' };
}

function freshnessOf(generatedAt: string | null): CheckoutFreshness {
  if (!generatedAt) return 'unknown';
  const ts = Date.parse(generatedAt);
  if (Number.isNaN(ts)) return 'unknown';
  return Date.now() - ts <= STALE_AFTER_MS ? 'fresh' : 'stale';
}

function nullableString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function parseStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
}

function parseCheckout(raw: unknown): CheckoutView {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid checkout entry: must be object');
  }
  const entry = raw as Record<string, unknown>;
  const path = typeof entry.path === 'string' ? entry.path : '';
  if (!path) {
    throw new Error('invalid checkout entry: missing path');
  }
  return {
    path,
    repo: nullableString(entry.repo),
    branch: nullableString(entry.branch),
    head: nullableString(entry.head),
    retention: normalizeRetention(entry.retention),
    has_process: entry.hasProcess === true,
    has_resource_lease: entry.hasResourceLease === true,
    matches_runtime: entry.matchesRuntime === true,
    note: typeof entry.note === 'string' ? entry.note : '',
  };
}

function parseSnapshot(raw: unknown): {
  checkouts: CheckoutView[];
  generatedAt: string | null;
  doesNotEstablish: string[];
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid checkout inventory: root must be object');
  }
  const snapshot = raw as {
    schemaVersion?: unknown;
    kind?: unknown;
    generatedAt?: unknown;
    checkouts?: unknown;
    doesNotEstablish?: unknown;
  };
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== CONTRACT_KIND) {
    throw new Error('invalid checkout inventory: kind or schemaVersion mismatch');
  }
  if (!Array.isArray(snapshot.checkouts)) {
    throw new Error('invalid checkout inventory: checkouts must be a list');
  }
  const nonClaims = parseStringArray(snapshot.doesNotEstablish);
  return {
    checkouts: snapshot.checkouts.map(parseCheckout),
    generatedAt: typeof snapshot.generatedAt === 'string' ? snapshot.generatedAt : null,
    doesNotEstablish: nonClaims.length > 0 ? nonClaims : DEFAULT_NON_CLAIMS,
  };
}

/** A checkout is "sprawl" when nothing anchors it: no retention, no process, no lease. */
function isSprawl(checkout: CheckoutView): boolean {
  return (
    (checkout.retention === 'orphan' || checkout.retention === 'archivable') &&
    !checkout.has_process &&
    !checkout.has_resource_lease
  );
}


function displaySourcePath(sourcePath: string): string {
  const rel = relative(resolve(process.cwd()), resolve(sourcePath));
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel;
  return '<external snapshot>';
}

function emptyData(kind: CheckoutSourceKind, reason: string, sourcePath: string): CheckoutViewData {
  return {
    checkouts: [],
    view_meta: {
      source_kind: kind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath),
      missing_reason: reason,
      generated_at: null,
      freshness_state: 'unknown',
      checkout_count: 0,
      orphan_count: 0,
      archivable_count: 0,
      retained_count: 0,
      sprawl_count: 0,
      does_not_establish: DEFAULT_NON_CLAIMS,
    },
  };
}

function dataFromParsed(
  parsed: ReturnType<typeof parseSnapshot>,
  sourceKind: CheckoutSourceKind,
  sourcePath: string,
  missingReason: string,
): CheckoutViewData {
  // Sort worst retention first so triage-relevant checkouts surface at the top.
  const order: Record<CheckoutRetention, number> = { orphan: 0, archivable: 1, unknown: 2, retained: 3 };
  const checkouts = [...parsed.checkouts].sort((a, b) => order[a.retention] - order[b.retention]);
  return {
    checkouts,
    view_meta: {
      source_kind: sourceKind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath),
      missing_reason: missingReason,
      generated_at: parsed.generatedAt,
      freshness_state: freshnessOf(parsed.generatedAt),
      checkout_count: checkouts.length,
      orphan_count: checkouts.filter((c) => c.retention === 'orphan').length,
      archivable_count: checkouts.filter((c) => c.retention === 'archivable').length,
      retained_count: checkouts.filter((c) => c.retention === 'retained').length,
      sprawl_count: checkouts.filter(isSprawl).length,
      does_not_establish: parsed.doesNotEstablish,
    },
  };
}

async function loadSnapshot(path: string): Promise<ReturnType<typeof parseSnapshot>> {
  return parseSnapshot(JSON.parse(await readFile(path, 'utf-8')) as unknown);
}

export async function getCheckoutData(): Promise<CheckoutViewData> {
  const sourcePath = resolve(artifactSnapshotPath());
  try {
    return dataFromParsed(await loadSnapshot(sourcePath), 'artifact', sourcePath, 'ok');
  } catch (error) {
    const classified = classifyError(error);
    const envOverride = process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH !== undefined;
    if (envOverride || classified.kind !== 'missing' || !fixtureFallbackEnabled()) {
      return emptyData(classified.kind, classified.reason, sourcePath);
    }

    const fallbackPath = resolve(fixtureSnapshotPath());
    try {
      return dataFromParsed(
        await loadSnapshot(fallbackPath),
        'fixture',
        fallbackPath,
        'checkout_inventory_missing_fixture_fallback',
      );
    } catch (fallbackError) {
      const fallbackClassified = classifyError(fallbackError);
      return emptyData(fallbackClassified.kind, fallbackClassified.reason, fallbackPath);
    }
  }
}
