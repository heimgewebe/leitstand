#!/usr/bin/env node
// @ts-nocheck
/**
 * export-operator-snapshots — PRODUCER-SIDE BRIDGE (not part of the observer).
 *
 * Leitstand is a read-only observer and must never call Grabowski/Bureau at
 * request time. This script is the deliberate seam that keeps that invariant:
 * the operator runs it (or a cron does) to transform *raw* Grabowski/Bureau
 * output into the contract-shaped snapshot artifacts Leitstand's controllers
 * read (`leitstand_bureau_task_snapshot`, `leitstand_checkout_inventory`,
 * `leitstand_operator_decision_axis_snapshot`,
 * `leitstand_weltgewebe_operations_snapshot`).
 *
 * It only reads raw JSON and writes local snapshot files — no external mutation.
 *
 * Usage:
 *   node scripts/export-operator-snapshots.mjs \
 *     --checkout-raw <grabowski_checkout_inventory.json> \
 *     --bureau-raw   <bureau_task_list.json> \
 *     --decision-raw   <operator_decision_axis.json> \
 *     --weltgewebe-raw <weltgewebe_operations.json> \
 *     --out-dir        artifacts
 *
 * Any input may be omitted; only the provided snapshots are (re)written. The
 * raw inputs are whatever the producer-side source collectors emit — this bridge
 * is where their vocabulary is pinned to Leitstand's read-only contracts.
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
const DECISION_NON_CLAIMS = [
  'task_or_priority_authority',
  'queue_truth',
  'focus_authority',
  'runtime_or_convergence_authority',
  'dispatch_or_mutation_authority',
];
const WELTGEWEBE_NON_CLAIMS = [
  'weltgewebe_source_truth',
  'cluster_control_authority',
  'federation_control_authority',
  'bureau_task_authority',
  'grabowski_execution_authority',
  'deployment_or_rollback_authority',
];
const EXECUTABLE_OPERATOR_FIELDS = ['command', 'argv', 'method', 'actionUrl', 'mutationUrl', 'endpoint'];
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const MAX_WELTGEWEBE_ITEMS = 200;
const DECISION_SECTION_IDS = ['now', 'focus', 'blocked', 'convergence', 'later'];

function normalizeBureauState(value) {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  if (v === 'queued' || v === 'pending' || v === 'open') return 'queued';
  if (v === 'claimed' || v === 'assigned') return 'claimed';
  if (v === 'running' || v === 'in_progress' || v === 'active') return 'running';
  if (v === 'blocked' || v === 'waiting' || v === 'stalled') return 'blocked';
  if (v === 'done' || v === 'completed' || v === 'complete') return 'done';
  if (v === 'failed' || v === 'error' || v === 'cancelled' || v === 'canceled') return 'failed';
  return 'unknown';
}

function normalizeCheckoutRetention(value) {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  if (v === 'retained' || v === 'kept' || v === 'owned') return 'retained';
  if (v === 'archivable' || v === 'archived' || v === 'stale') return 'archivable';
  if (v === 'orphan' || v === 'orphaned' || v === 'untracked') return 'orphan';
  return 'unknown';
}

/** Map a raw Bureau task record → contract task. Unknown fields are dropped. */
function mapBureauTask(raw) {
  return {
    id: String(raw.id ?? raw.task_id ?? ''),
    title: raw.title ?? raw.name ?? raw.summary ?? String(raw.id ?? ''),
    state: normalizeBureauState(raw.state ?? raw.status),
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
  else if (raw.cleanup_candidate) retention = 'archivable';
  else if (typeof raw.retention === 'string') retention = normalizeCheckoutRetention(raw.retention);
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

function mapDecisionItem(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('decision-axis item must be an object');
  const id = String(raw.id ?? '');
  const title = String(raw.title ?? '');
  if (!id || !title) throw new Error('decision-axis item requires id and title');
  return {
    id,
    title,
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    meta: typeof raw.meta === 'string' ? raw.meta : '',
  };
}

function mapDecisionSection(raw, id) {
  if (!raw || typeof raw !== 'object') throw new Error(`decision-axis section ${id} missing`);
  if (!['available', 'unknown', 'unavailable'].includes(raw.status)) {
    throw new Error(`decision-axis section ${id} has invalid status`);
  }
  if (typeof raw.source !== 'string' || raw.source.length === 0) {
    throw new Error(`decision-axis section ${id} has no source`);
  }
  return {
    status: raw.status,
    source: raw.source,
    observedAt: typeof raw.observedAt === 'string' ? raw.observedAt : null,
    items: Array.isArray(raw.items) ? raw.items.slice(0, 8).map(mapDecisionItem) : [],
  };
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be non-empty text`);
  return value.trim();
}

function nullableText(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function finiteOrNull(value, label, { min = null, max = null, integer = false } = {}) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite or null`);
  if (min != null && value < min) throw new Error(`${label} is below minimum`);
  if (max != null && value > max) throw new Error(`${label} is above maximum`);
  if (integer && !Number.isInteger(value)) throw new Error(`${label} must be integer or null`);
  return value;
}

function boundedObjects(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  if (value.length > MAX_WELTGEWEBE_ITEMS) throw new Error(`${label} exceeds bounded list limit`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${label}[${index}] must be an object`);
    return item;
  });
}

function mapEvidenceRefs(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_WELTGEWEBE_ITEMS) {
    throw new Error(`${label} must contain 1..${MAX_WELTGEWEBE_ITEMS} refs`);
  }
  return value.map((item) => requiredText(item, `${label} item`));
}

function mapProvenance(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}.provenance must be an object`);
  const observedAt = requiredText(value.observedAt, `${label}.observedAt`);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error(`${label}.observedAt must be a timestamp`);
  const sourceCommit = nullableText(value.sourceCommit);
  if (sourceCommit != null && !GIT_SHA_RE.test(sourceCommit)) throw new Error(`${label}.sourceCommit must be a full Git SHA or null`);
  return {
    sourceSystem: requiredText(value.sourceSystem, `${label}.sourceSystem`),
    sourceKind: requiredText(value.sourceKind, `${label}.sourceKind`),
    sourceRef: requiredText(value.sourceRef, `${label}.sourceRef`),
    observedAt,
    sourceCommit,
    evidenceRefs: mapEvidenceRefs(value.evidenceRefs, `${label}.evidenceRefs`),
  };
}

function mapWeltgewebeSnapshot(raw, generatedAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('weltgewebe raw input must be an object');
  const slo = raw.slo;
  const recovery = raw.recovery;
  const deployment = raw.deployment;
  const federation = raw.federation;
  for (const [label, value] of Object.entries({ slo, recovery, deployment, federation })) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`weltgewebe ${label} must be an object`);
  }
  const lastRestoreAt = nullableText(recovery.lastRestoreAt);
  if (lastRestoreAt != null && !Number.isFinite(Date.parse(lastRestoreAt))) throw new Error('recovery.lastRestoreAt must be a timestamp or null');
  const deploymentCommit = nullableText(deployment.sourceCommit);
  if (deploymentCommit != null && !GIT_SHA_RE.test(deploymentCommit)) throw new Error('deployment.sourceCommit must be a full Git SHA or null');
  const lastDeliveredAt = nullableText(federation.lastDeliveredAt);
  if (lastDeliveredAt != null && !Number.isFinite(Date.parse(lastDeliveredAt))) throw new Error('federation.lastDeliveredAt must be a timestamp or null');

  const cells = boundedObjects(raw.cells, 'cells').map((item, index) => ({
    id: requiredText(item.id, `cells[${index}].id`),
    name: requiredText(item.name, `cells[${index}].name`),
    state: requiredText(item.state, `cells[${index}].state`),
    scope: requiredText(item.scope, `cells[${index}].scope`),
    provenance: mapProvenance(item.provenance, `cells[${index}]`),
  }));
  const neighborhoods = boundedObjects(raw.neighborhoods, 'neighborhoods').map((item, index) => ({
    id: requiredText(item.id, `neighborhoods[${index}].id`),
    localCellId: requiredText(item.localCellId, `neighborhoods[${index}].localCellId`),
    remoteCellId: requiredText(item.remoteCellId, `neighborhoods[${index}].remoteCellId`),
    state: requiredText(item.state, `neighborhoods[${index}].state`),
    provenance: mapProvenance(item.provenance, `neighborhoods[${index}]`),
  }));
  const operatorReferences = boundedObjects(raw.operatorReferences, 'operatorReferences').map((item, index) => {
    for (const field of EXECUTABLE_OPERATOR_FIELDS) {
      if (field in item) throw new Error(`operatorReferences[${index}] may not carry executable field ${field}`);
    }
    const taskId = nullableText(item.taskId);
    const receiptRef = nullableText(item.receiptRef);
    if (taskId == null && receiptRef == null) throw new Error(`operatorReferences[${index}] requires taskId or receiptRef`);
    return {
      title: requiredText(item.title, `operatorReferences[${index}].title`),
      state: requiredText(item.state, `operatorReferences[${index}].state`),
      taskId,
      receiptRef,
      provenance: mapProvenance(item.provenance, `operatorReferences[${index}]`),
    };
  });

  return {
    schemaVersion: 1,
    kind: 'leitstand_weltgewebe_operations_snapshot',
    generatedAt,
    producer: mapProvenance(raw.producer, 'producer'),
    slo: {
      availabilityPercent: finiteOrNull(slo.availabilityPercent, 'slo.availabilityPercent', { min: 0, max: 100 }),
      p95LatencyMs: finiteOrNull(slo.p95LatencyMs, 'slo.p95LatencyMs', { min: 0 }),
      errorBudgetRemainingPercent: finiteOrNull(slo.errorBudgetRemainingPercent, 'slo.errorBudgetRemainingPercent', { min: 0, max: 100 }),
      window: requiredText(slo.window, 'slo.window'),
      provenance: mapProvenance(slo.provenance, 'slo'),
    },
    recovery: {
      rtoSeconds: finiteOrNull(recovery.rtoSeconds, 'recovery.rtoSeconds', { min: 0 }),
      rpoSeconds: finiteOrNull(recovery.rpoSeconds, 'recovery.rpoSeconds', { min: 0 }),
      lastRestoreAt,
      provenance: mapProvenance(recovery.provenance, 'recovery'),
    },
    deployment: {
      environment: requiredText(deployment.environment, 'deployment.environment'),
      state: requiredText(deployment.state, 'deployment.state'),
      sourceCommit: deploymentCommit,
      imageRef: nullableText(deployment.imageRef),
      provenance: mapProvenance(deployment.provenance, 'deployment'),
    },
    cells,
    neighborhoods,
    federation: {
      state: requiredText(federation.state, 'federation.state'),
      deliveryLagSeconds: finiteOrNull(federation.deliveryLagSeconds, 'federation.deliveryLagSeconds', { min: 0 }),
      pendingCount: finiteOrNull(federation.pendingCount, 'federation.pendingCount', { min: 0, integer: true }),
      quarantinedCount: finiteOrNull(federation.quarantinedCount, 'federation.quarantinedCount', { min: 0, integer: true }),
      lastDeliveredAt,
      provenance: mapProvenance(federation.provenance, 'federation'),
    },
    operatorReferences,
    doesNotEstablish: WELTGEWEBE_NON_CLAIMS,
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

  if (args['decision-raw']) {
    const raw = await readJson(resolve(args['decision-raw']));
    const sections = Object.fromEntries(
      DECISION_SECTION_IDS.map((id) => [id, mapDecisionSection(raw.sections?.[id], id)]),
    );
    const out = join(outDir, 'operator-decision-axis.json');
    await writeJsonAtomic(out, {
      schemaVersion: 1,
      kind: 'leitstand_operator_decision_axis_snapshot',
      generatedAt,
      source: 'bureau_and_grabowski_read_only_projections',
      doesNotEstablish: DECISION_NON_CLAIMS,
      sections,
    });
    console.log(`decision-axis snapshot: ${Object.keys(sections).length} sections → ${out}`);
    wrote += 1;
  }

  if (args['weltgewebe-raw']) {
    const raw = await readJson(resolve(args['weltgewebe-raw']));
    const snapshot = mapWeltgewebeSnapshot(raw, generatedAt);
    const out = join(outDir, 'weltgewebe-operations.json');
    await writeJsonAtomic(out, snapshot);
    console.log(`weltgewebe snapshot: ${snapshot.cells.length} cells / ${snapshot.operatorReferences.length} operator refs → ${out}`);
    wrote += 1;
  }

  if (wrote === 0) {
    console.error('No inputs given. Provide --bureau-raw, --checkout-raw, --decision-raw and/or --weltgewebe-raw. See header for usage.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('export-operator-snapshots failed:', err);
  process.exit(1);
});
