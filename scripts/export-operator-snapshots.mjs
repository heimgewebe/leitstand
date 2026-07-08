#!/usr/bin/env node
// @ts-nocheck
/**
 * export-operator-snapshots — PRODUCER-SIDE BRIDGE (not part of the observer).
 *
 * Leitstand is a read-only observer and must never call Grabowski/Bureau at
 * request time. This script is the deliberate seam that keeps that invariant:
 * the operator runs it (or a cron does) to transform *raw* Grabowski/Bureau
 * output into the contract-shaped snapshot artifacts Leitstand's controllers
 * read (`leitstand_bureau_task_snapshot`, `leitstand_checkout_inventory`).
 *
 * It only reads raw JSON and writes local snapshot files — no external mutation.
 *
 * Usage:
 *   node scripts/export-operator-snapshots.mjs \
 *     --checkout-raw <grabowski_checkout_inventory.json> \
 *     --bureau-raw   <bureau_task_list.json> \
 *     --out-dir      artifacts
 *
 * Any input may be omitted; only the provided snapshots are (re)written. The
 * raw inputs are whatever `grabowski_checkout_inventory` / the Bureau task
 * listing emit — this bridge is where their vocab is pinned to our contract.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith('--')) args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'));
}

/** Atomic write (tmp → rename), consistent with Leitstand's artifact convention. */
async function writeJsonAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, path);
}

const BUREAU_NON_CLAIMS = [
  'task_ownership', 'claim_authority', 'execution_truth', 'dispatch_control', 'completion_guarantee',
];
const CHECKOUT_NON_CLAIMS = [
  'checkout_ownership', 'cleanup_authority', 'branch_deletion', 'retention_decision', 'process_control',
];

/** Map a raw Bureau task record → contract task. Unknown fields are dropped. */
function mapBureauTask(raw) {
  return {
    id: String(raw.id ?? raw.task_id ?? ''),
    title: raw.title ?? raw.name ?? raw.summary ?? String(raw.id ?? ''),
    state: raw.state ?? raw.status ?? 'unknown',
    claimant: raw.claimant ?? raw.owner ?? raw.assignee ?? null,
    repo: raw.repo ?? raw.repository ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
    receiptRef: raw.receiptRef ?? raw.receipt_ref ?? raw.receipt ?? null,
    note: raw.note ?? raw.detail ?? '',
  };
}

/**
 * Map a raw `grabowski_checkout_inventory` worktree record → contract checkout.
 *
 * Derives a retention verdict from the real coordination/lifecycle shape:
 *   - `lifecycle.retention` object present        → retained (owner-anchored)
 *   - `cleanup_candidate` true                    → archivable
 *   - no retention, no process/lease/task anchor  → orphan (prime sprawl)
 *   - otherwise (anchored by coordination only)   → unknown
 * `runtimeHead` (optional) lets the bridge flag the runtime-matching checkout.
 */
function mapCheckout(raw, runtimeHead) {
  const coord = raw.coordination ?? {};
  const hasProcess = Array.isArray(coord.processes) ? coord.processes.length > 0 : Boolean(raw.hasProcess);
  const hasLease = Array.isArray(coord.resource_leases) ? coord.resource_leases.length > 0 : Boolean(raw.hasResourceLease);
  const hasTask = Array.isArray(coord.tasks) ? coord.tasks.length > 0 : false;
  const retentionRecord = raw.lifecycle?.retention ?? (typeof raw.retention === 'object' ? raw.retention : null);

  let retention;
  if (retentionRecord) retention = 'retained';
  else if (typeof raw.retention === 'string') retention = raw.retention;
  else if (raw.cleanup_candidate) retention = 'archivable';
  else if (!hasProcess && !hasLease && !hasTask) retention = 'orphan';
  else retention = 'unknown';

  const head = (raw.head ?? '').slice(0, 12) || null;
  const dirtyNote = raw.status?.dirty ? `dirty (${raw.status.entry_count ?? '?'} entries)` : '';
  const note = raw.note ?? retentionRecord?.purpose ?? dirtyNote;

  return {
    path: raw.path,
    repo: raw.repo ?? raw.repository ?? null,
    branch: raw.branch ?? null,
    head,
    retention,
    hasProcess,
    hasResourceLease: hasLease,
    matchesRuntime: Boolean(raw.matchesRuntime ?? raw.matches_runtime)
      || (runtimeHead != null && raw.head === runtimeHead),
    note,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args['out-dir'] ?? 'artifacts');
  const generatedAt = new Date().toISOString();
  let wrote = 0;

  if (args['bureau-raw']) {
    const raw = await readJson(resolve(args['bureau-raw']));
    const tasks = (raw.tasks ?? raw.records ?? raw ?? []).map(mapBureauTask).filter((t) => t.id);
    const snapshot = {
      schemaVersion: 1,
      kind: 'leitstand_bureau_task_snapshot',
      generatedAt,
      source: 'bureau_state_export',
      doesNotEstablish: BUREAU_NON_CLAIMS,
      tasks,
    };
    const out = join(outDir, 'bureau-tasks.json');
    await writeJsonAtomic(out, snapshot);
    console.log(`bureau snapshot: ${tasks.length} tasks → ${out}`);
    wrote += 1;
  }

  if (args['checkout-raw']) {
    const raw = await readJson(resolve(args['checkout-raw']));
    const source = raw.checkout?.worktrees ?? raw.worktrees ?? raw.checkouts ?? raw ?? [];
    const runtimeHead = args['runtime-head'] ?? null;
    const checkouts = source.filter((c) => c && c.path).map((c) => mapCheckout(c, runtimeHead));
    const snapshot = {
      schemaVersion: 1,
      kind: 'leitstand_checkout_inventory',
      generatedAt,
      source: 'grabowski_checkout_inventory',
      doesNotEstablish: CHECKOUT_NON_CLAIMS,
      checkouts,
    };
    const out = join(outDir, 'checkout-inventory.json');
    await writeJsonAtomic(out, snapshot);
    console.log(`checkout snapshot: ${checkouts.length} checkouts → ${out}`);
    wrote += 1;
  }

  if (wrote === 0) {
    console.error('No inputs given. Provide --bureau-raw and/or --checkout-raw. See header for usage.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('export-operator-snapshots failed:', err);
  process.exit(1);
});
