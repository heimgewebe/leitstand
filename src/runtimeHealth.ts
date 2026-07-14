import { readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export type RuntimeHealthStatus = 'ok' | 'warn' | 'fail';
export type RuntimeHealthCheckStatus = RuntimeHealthStatus | 'unknown';

type SnapshotKind = 'bureau_tasks' | 'checkout_inventory';

export interface RuntimeHealthCheck {
  status: RuntimeHealthCheckStatus;
  reason: string;
}

export interface RuntimeHealthSnapshot {
  status: RuntimeHealthCheckStatus;
  reason: string;
  path: string;
  path_display: string;
  exists: boolean;
  generated_at: string | null;
  mtime: string | null;
  age_seconds: number | null;
  stale_after_seconds: number;
  kind: string | null;
  record_count: number | null;
}

export interface RuntimeHealthReceipt {
  schemaVersion: 1;
  kind: 'leitstand_runtime_health_receipt';
  generatedAt: string;
  status: RuntimeHealthStatus;
  runtime: {
    pid: number;
    uptime_seconds: number;
    node_version: string;
    cwd: string;
  };
  git: {
    status: RuntimeHealthCheckStatus;
    reason: string;
    head: string | null;
    branch: string | null;
    source_path: string;
    source_path_display: string;
  };
  snapshots: Record<SnapshotKind, RuntimeHealthSnapshot>;
  checks: Record<string, RuntimeHealthCheck>;
  ingress: {
    canonical_url: string;
    status: 'not_checked';
    reason: string;
  };
  doesNotEstablish: string[];
}

export interface RuntimeHealthOptions {
  cwd?: string;
  now?: Date;
  bureauSnapshotPath?: string;
  checkoutSnapshotPath?: string;
  staleAfterMs?: number;
}

const SNAPSHOT_STALE_AFTER_MS = 20 * 60 * 1000;
const GIT_HEAD_RE = /^[0-9a-f]{40}$/;

const DOES_NOT_ESTABLISH = [
  'external_ingress_reachable',
  'dns_correctness',
  'caddyfile_persistence',
  'bureau_task_truth',
  'checkout_cleanup_authority',
  'operator_action_authority',
];

function displayPath(cwd: string, path: string): string {
  const rel = relative(resolve(cwd), resolve(path));
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel;
  return '<external path>';
}

function snapshotPathFromEnv(kind: SnapshotKind, cwd: string): string {
  if (kind === 'bureau_tasks') {
    return process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH || join(cwd, 'artifacts', 'bureau-tasks.json');
  }
  return process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH || join(cwd, 'artifacts', 'checkout-inventory.json');
}

function snapshotRecordCount(kind: SnapshotKind, raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw as { tasks?: unknown; checkouts?: unknown };
  if (kind === 'bureau_tasks') return Array.isArray(snapshot.tasks) ? snapshot.tasks.length : null;
  return Array.isArray(snapshot.checkouts) ? snapshot.checkouts.length : null;
}

function snapshotGeneratedAt(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw as { generatedAt?: unknown; generated_at?: unknown };
  if (typeof snapshot.generatedAt === 'string') return snapshot.generatedAt;
  if (typeof snapshot.generated_at === 'string') return snapshot.generated_at;
  return null;
}

function snapshotKind(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const snapshot = raw as { kind?: unknown };
  return typeof snapshot.kind === 'string' ? snapshot.kind : null;
}

function expectedSnapshotKind(kind: SnapshotKind): string {
  if (kind === 'bureau_tasks') return 'leitstand_bureau_task_snapshot';
  return 'leitstand_checkout_inventory';
}

function msAge(now: Date, generatedAt: string | null, mtimeMs: number): number | null {
  const sourceMs = generatedAt ? Date.parse(generatedAt) : mtimeMs;
  if (!Number.isFinite(sourceMs)) return null;
  return Math.max(0, now.getTime() - sourceMs);
}

async function readSnapshotHealth(
  kind: SnapshotKind,
  path: string,
  cwd: string,
  now: Date,
  staleAfterMs: number,
): Promise<RuntimeHealthSnapshot> {
  const resolvedPath = resolve(path);
  const base = {
    path: resolvedPath,
    path_display: displayPath(cwd, resolvedPath),
    stale_after_seconds: Math.round(staleAfterMs / 1000),
  };

  try {
    const fileStat = await stat(resolvedPath);
    const text = await readFile(resolvedPath, 'utf-8');
    const parsed = JSON.parse(text) as unknown;
    const generatedAt = snapshotGeneratedAt(parsed);
    const ageMs = msAge(now, generatedAt, fileStat.mtimeMs);
    const recordCount = snapshotRecordCount(kind, parsed);
    const kindValue = snapshotKind(parsed);

    if (kindValue !== expectedSnapshotKind(kind) || recordCount === null) {
      return {
        ...base,
        status: 'fail',
        reason: 'snapshot_contract_mismatch',
        exists: true,
        generated_at: generatedAt,
        mtime: fileStat.mtime.toISOString(),
        age_seconds: ageMs === null ? null : Math.round(ageMs / 1000),
        kind: kindValue,
        record_count: recordCount,
      };
    }

    if (ageMs === null) {
      return {
        ...base,
        status: 'warn',
        reason: 'snapshot_timestamp_unparseable',
        exists: true,
        generated_at: generatedAt,
        mtime: fileStat.mtime.toISOString(),
        age_seconds: null,
        kind: kindValue,
        record_count: recordCount,
      };
    }

    return {
      ...base,
      status: ageMs <= staleAfterMs ? 'ok' : 'warn',
      reason: ageMs <= staleAfterMs ? 'snapshot_fresh' : 'snapshot_stale',
      exists: true,
      generated_at: generatedAt,
      mtime: fileStat.mtime.toISOString(),
      age_seconds: Math.round(ageMs / 1000),
      kind: kindValue,
      record_count: recordCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const missing = message.includes('enoent') || message.includes('no such file');
    const invalidJson = message.includes('json') || message.includes('unexpected');
    let mtime: string | null = null;
    if (!missing) {
      try {
        mtime = (await stat(resolvedPath)).mtime.toISOString();
      } catch {
        mtime = null;
      }
    }
    return {
      ...base,
      status: 'fail',
      reason: missing ? 'snapshot_missing' : invalidJson ? 'snapshot_json_invalid' : 'snapshot_unreadable',
      exists: !missing,
      generated_at: null,
      mtime,
      age_seconds: null,
      kind: null,
      record_count: null,
    };
  }
}

function parseGitdirFile(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('gitdir:')) return null;
  return trimmed.slice('gitdir:'.length).trim();
}

async function resolveGitDir(cwd: string): Promise<string> {
  const dotGitPath = join(cwd, '.git');
  try {
    const dotGitStat = await stat(dotGitPath);
    if (dotGitStat.isDirectory()) return dotGitPath;
  } catch {
    return dotGitPath;
  }

  const gitdir = parseGitdirFile(await readFile(dotGitPath, 'utf-8'));
  if (!gitdir) return dotGitPath;
  return resolve(cwd, gitdir);
}

async function resolveCommonGitDir(gitDir: string): Promise<string> {
  try {
    const commonDir = (await readFile(join(gitDir, 'commondir'), 'utf-8')).trim();
    return commonDir ? resolve(gitDir, commonDir) : gitDir;
  } catch {
    return gitDir;
  }
}

function isSafeGitRef(ref: string): boolean {
  return ref.startsWith('refs/')
    && !ref.includes('\\')
    && ref.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

async function readPackedRef(commonGitDir: string, ref: string): Promise<string | null> {
  try {
    const packedRefs = await readFile(join(commonGitDir, 'packed-refs'), 'utf-8');
    for (const line of packedRefs.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('^')) continue;
      const separator = trimmed.indexOf(' ');
      if (separator <= 0) continue;
      const head = trimmed.slice(0, separator);
      const packedRef = trimmed.slice(separator + 1);
      if (packedRef === ref && GIT_HEAD_RE.test(head)) return head;
    }
  } catch {
    // A missing packed-refs file is normal when every ref is loose.
  }
  return null;
}

async function readGitRef(gitDir: string, ref: string): Promise<string | null> {
  if (!isSafeGitRef(ref)) return null;
  const commonGitDir = await resolveCommonGitDir(gitDir);
  const candidatePaths = [...new Set([join(gitDir, ref), join(commonGitDir, ref)])];

  for (const candidatePath of candidatePaths) {
    try {
      const head = (await readFile(candidatePath, 'utf-8')).trim();
      if (GIT_HEAD_RE.test(head)) return head;
    } catch {
      // Continue with the common directory or packed refs.
    }
  }

  return readPackedRef(commonGitDir, ref);
}

async function readGitHealth(cwd: string): Promise<RuntimeHealthReceipt['git']> {
  const gitDir = await resolveGitDir(cwd);
  const headPath = join(gitDir, 'HEAD');
  const base = {
    source_path: headPath,
    source_path_display: displayPath(cwd, headPath),
  };

  try {
    const rawHead = (await readFile(headPath, 'utf-8')).trim();
    if (rawHead.startsWith('ref:')) {
      const ref = rawHead.slice('ref:'.length).trim();
      const head = await readGitRef(gitDir, ref);
      const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
      return {
        ...base,
        status: head ? 'ok' : 'warn',
        reason: head ? 'git_head_resolved' : 'git_ref_unresolved',
        head,
        branch,
      };
    }

    return {
      ...base,
      status: GIT_HEAD_RE.test(rawHead) ? 'ok' : 'warn',
      reason: GIT_HEAD_RE.test(rawHead) ? 'git_detached_head_resolved' : 'git_head_unexpected_format',
      head: rawHead || null,
      branch: null,
    };
  } catch {
    return {
      ...base,
      status: 'warn',
      reason: 'git_head_unavailable',
      head: null,
      branch: null,
    };
  }
}

function summarizeStatus(checks: RuntimeHealthCheckStatus[]): RuntimeHealthStatus {
  if (checks.includes('fail')) return 'fail';
  if (checks.includes('warn') || checks.includes('unknown')) return 'warn';
  return 'ok';
}

function checkFromSnapshot(snapshot: RuntimeHealthSnapshot): RuntimeHealthCheck {
  return { status: snapshot.status, reason: snapshot.reason };
}

export async function getRuntimeHealthData(options: RuntimeHealthOptions = {}): Promise<RuntimeHealthReceipt> {
  const cwd = resolve(options.cwd || process.cwd());
  const now = options.now || new Date();
  const staleAfterMs = options.staleAfterMs ?? SNAPSHOT_STALE_AFTER_MS;
  const bureauPath = options.bureauSnapshotPath || snapshotPathFromEnv('bureau_tasks', cwd);
  const checkoutPath = options.checkoutSnapshotPath || snapshotPathFromEnv('checkout_inventory', cwd);

  const [git, bureauSnapshot, checkoutSnapshot] = await Promise.all([
    readGitHealth(cwd),
    readSnapshotHealth('bureau_tasks', bureauPath, cwd, now, staleAfterMs),
    readSnapshotHealth('checkout_inventory', checkoutPath, cwd, now, staleAfterMs),
  ]);

  const checks: RuntimeHealthReceipt['checks'] = {
    server_process: { status: 'ok', reason: 'health_endpoint_served_by_current_process' },
    git_head: { status: git.status, reason: git.reason },
    bureau_snapshot: checkFromSnapshot(bureauSnapshot),
    checkout_snapshot: checkFromSnapshot(checkoutSnapshot),
  };

  return {
    schemaVersion: 1,
    kind: 'leitstand_runtime_health_receipt',
    generatedAt: now.toISOString(),
    status: summarizeStatus(Object.values(checks).map((check) => check.status)),
    runtime: {
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
      node_version: process.version,
      cwd,
    },
    git,
    snapshots: {
      bureau_tasks: bureauSnapshot,
      checkout_inventory: checkoutSnapshot,
    },
    checks,
    ingress: {
      canonical_url: 'https://leitstand.heimgewebe.home.arpa/',
      status: 'not_checked',
      reason: 'in_process_health_receipt_does_not_probe_dns_or_caddy',
    },
    doesNotEstablish: DOES_NOT_ESTABLISH,
  };
}
