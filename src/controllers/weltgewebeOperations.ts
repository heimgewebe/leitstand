import { readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { OPERATIONAL_SNAPSHOT_STALE_AFTER_MS } from '../freshnessPolicy.js';

export type WeltgewebeSourceKind = 'artifact' | 'fixture' | 'missing' | 'corrupt';
export type WeltgewebeFreshness = 'fresh' | 'stale' | 'unknown';

export interface WeltgewebeOperationsOptions {
  sourceRoot?: string;
  now?: Date;
}

export interface ProvenanceView {
  source_system: string;
  source_kind: string;
  source_ref: string;
  observed_at: string;
  source_commit: string | null;
  evidence_refs: string[];
  freshness_state: WeltgewebeFreshness;
  age_seconds: number | null;
}

export interface SloView {
  availability_percent: number | null;
  p95_latency_ms: number | null;
  error_budget_remaining_percent: number | null;
  window: string;
  provenance: ProvenanceView;
}

export interface RecoveryView {
  rto_seconds: number | null;
  rpo_seconds: number | null;
  last_restore_at: string | null;
  restore_age_seconds: number | null;
  provenance: ProvenanceView;
}

export interface DeploymentView {
  environment: string;
  state: string;
  source_commit: string | null;
  image_ref: string | null;
  provenance: ProvenanceView;
}

export interface CellView {
  id: string;
  name: string;
  state: string;
  scope: string;
  provenance: ProvenanceView;
}

export interface NeighborhoodView {
  id: string;
  local_cell_id: string;
  remote_cell_id: string;
  state: string;
  provenance: ProvenanceView;
}

export interface FederationView {
  state: string;
  delivery_lag_seconds: number | null;
  pending_count: number | null;
  quarantined_count: number | null;
  last_delivered_at: string | null;
  provenance: ProvenanceView;
}

export interface OperatorReferenceView {
  title: string;
  state: string;
  task_id: string | null;
  receipt_ref: string | null;
  provenance: ProvenanceView;
}

export interface WeltgewebeOperationsViewData {
  slo: SloView | null;
  recovery: RecoveryView | null;
  deployment: DeploymentView | null;
  cells: CellView[];
  neighborhoods: NeighborhoodView[];
  federation: FederationView | null;
  operator_references: OperatorReferenceView[];
  view_meta: {
    source_kind: WeltgewebeSourceKind;
    source_path: string;
    source_path_display: string;
    missing_reason: string;
    generated_at: string | null;
    freshness_state: WeltgewebeFreshness;
    cell_count: number;
    neighborhood_count: number;
    operator_reference_count: number;
    producer: ProvenanceView | null;
    does_not_establish: string[];
  };
}

const CONTRACT_KIND = 'leitstand_weltgewebe_operations_snapshot';
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const MAX_LIST_ITEMS = 200;

const DEFAULT_NON_CLAIMS = [
  'weltgewebe_source_truth',
  'cluster_control_authority',
  'federation_control_authority',
  'bureau_task_authority',
  'grabowski_execution_authority',
  'deployment_or_rollback_authority',
];

function artifactSnapshotPath(sourceRoot: string): string {
  return process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH
    || join(sourceRoot, 'artifacts', 'weltgewebe-operations.json');
}

function fixtureSnapshotPath(sourceRoot: string): string {
  return join(sourceRoot, 'src', 'fixtures', 'weltgewebe-operations.json');
}

function fixtureFallbackEnabled(): boolean {
  const explicit = process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK;
  if (explicit !== undefined) {
    return explicit === '1' || explicit.toLowerCase() === 'true';
  }
  return process.env.LEITSTAND_STRICT === '0' || process.env.LEITSTAND_STRICT === 'false';
}

function displaySourcePath(sourcePath: string, sourceRoot: string): string {
  const rel = relative(sourceRoot, resolve(sourcePath));
  if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel;
  return '<external snapshot>';
}

function classifyError(error: unknown): { kind: WeltgewebeSourceKind; reason: string } {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT') return { kind: 'missing', reason: 'weltgewebe_operations_snapshot_missing' };
  if (error instanceof SyntaxError) return { kind: 'corrupt', reason: 'weltgewebe_operations_snapshot_json_invalid' };
  return { kind: 'corrupt', reason: 'weltgewebe_operations_snapshot_invalid' };
}

function requiredText(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`${label} must be non-empty text`);
  }
  return raw.trim();
}

function nullableText(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function nullableFinite(raw: unknown, label: string, options: { min?: number; max?: number } = {}): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`${label} must be a finite number or null`);
  if (options.min !== undefined && raw < options.min) throw new Error(`${label} is below its minimum`);
  if (options.max !== undefined && raw > options.max) throw new Error(`${label} is above its maximum`);
  return raw;
}

function nullableInteger(raw: unknown, label: string): number | null {
  const value = nullableFinite(raw, label, { min: 0 });
  if (value !== null && !Number.isInteger(value)) throw new Error(`${label} must be an integer or null`);
  return value;
}

function parseStringArray(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw)) throw new Error(`${label} must be a list`);
  const values = raw.map((item) => requiredText(item, `${label} item`));
  if (values.length > MAX_LIST_ITEMS) throw new Error(`${label} exceeds the bounded list limit`);
  return values;
}

function ageSeconds(now: Date, observedAt: string): number | null {
  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((now.getTime() - timestamp) / 1000));
}

function freshnessOf(now: Date, observedAt: string): WeltgewebeFreshness {
  const age = ageSeconds(now, observedAt);
  if (age === null) return 'unknown';
  return age * 1000 <= OPERATIONAL_SNAPSHOT_STALE_AFTER_MS ? 'fresh' : 'stale';
}

function parseProvenance(raw: unknown, now: Date, label: string): ProvenanceView {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} provenance must be an object`);
  const value = raw as Record<string, unknown>;
  const observedAt = requiredText(value.observedAt, `${label}.observedAt`);
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error(`${label}.observedAt must be an ISO timestamp`);
  const commit = nullableText(value.sourceCommit);
  if (commit !== null && !GIT_SHA_RE.test(commit)) throw new Error(`${label}.sourceCommit must be a full Git SHA or null`);
  const evidenceRefs = parseStringArray(value.evidenceRefs, `${label}.evidenceRefs`);
  if (evidenceRefs.length === 0) throw new Error(`${label}.evidenceRefs must contain at least one source receipt or artifact ref`);
  return {
    source_system: requiredText(value.sourceSystem, `${label}.sourceSystem`),
    source_kind: requiredText(value.sourceKind, `${label}.sourceKind`),
    source_ref: requiredText(value.sourceRef, `${label}.sourceRef`),
    observed_at: observedAt,
    source_commit: commit,
    evidence_refs: evidenceRefs,
    freshness_state: freshnessOf(now, observedAt),
    age_seconds: ageSeconds(now, observedAt),
  };
}

function requiredObject(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  return raw as Record<string, unknown>;
}

function parseSlo(raw: unknown, now: Date): SloView {
  const value = requiredObject(raw, 'slo');
  return {
    availability_percent: nullableFinite(value.availabilityPercent, 'slo.availabilityPercent', { min: 0, max: 100 }),
    p95_latency_ms: nullableFinite(value.p95LatencyMs, 'slo.p95LatencyMs', { min: 0 }),
    error_budget_remaining_percent: nullableFinite(value.errorBudgetRemainingPercent, 'slo.errorBudgetRemainingPercent', { min: 0, max: 100 }),
    window: requiredText(value.window, 'slo.window'),
    provenance: parseProvenance(value.provenance, now, 'slo'),
  };
}

function parseRecovery(raw: unknown, now: Date): RecoveryView {
  const value = requiredObject(raw, 'recovery');
  const lastRestoreAt = nullableText(value.lastRestoreAt);
  if (lastRestoreAt !== null && !Number.isFinite(Date.parse(lastRestoreAt))) throw new Error('recovery.lastRestoreAt must be an ISO timestamp or null');
  return {
    rto_seconds: nullableFinite(value.rtoSeconds, 'recovery.rtoSeconds', { min: 0 }),
    rpo_seconds: nullableFinite(value.rpoSeconds, 'recovery.rpoSeconds', { min: 0 }),
    last_restore_at: lastRestoreAt,
    restore_age_seconds: lastRestoreAt === null ? null : ageSeconds(now, lastRestoreAt),
    provenance: parseProvenance(value.provenance, now, 'recovery'),
  };
}

function parseDeployment(raw: unknown, now: Date): DeploymentView {
  const value = requiredObject(raw, 'deployment');
  const commit = nullableText(value.sourceCommit);
  if (commit !== null && !GIT_SHA_RE.test(commit)) throw new Error('deployment.sourceCommit must be a full Git SHA or null');
  return {
    environment: requiredText(value.environment, 'deployment.environment'),
    state: requiredText(value.state, 'deployment.state'),
    source_commit: commit,
    image_ref: nullableText(value.imageRef),
    provenance: parseProvenance(value.provenance, now, 'deployment'),
  };
}

function boundedObjects(raw: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(raw)) throw new Error(`${label} must be a list`);
  if (raw.length > MAX_LIST_ITEMS) throw new Error(`${label} exceeds the bounded list limit`);
  return raw.map((item, index) => requiredObject(item, `${label}[${index}]`));
}

function parseCells(raw: unknown, now: Date): CellView[] {
  return boundedObjects(raw, 'cells').map((value, index) => ({
    id: requiredText(value.id, `cells[${index}].id`),
    name: requiredText(value.name, `cells[${index}].name`),
    state: requiredText(value.state, `cells[${index}].state`),
    scope: requiredText(value.scope, `cells[${index}].scope`),
    provenance: parseProvenance(value.provenance, now, `cells[${index}]`),
  }));
}

function parseNeighborhoods(raw: unknown, now: Date): NeighborhoodView[] {
  return boundedObjects(raw, 'neighborhoods').map((value, index) => ({
    id: requiredText(value.id, `neighborhoods[${index}].id`),
    local_cell_id: requiredText(value.localCellId, `neighborhoods[${index}].localCellId`),
    remote_cell_id: requiredText(value.remoteCellId, `neighborhoods[${index}].remoteCellId`),
    state: requiredText(value.state, `neighborhoods[${index}].state`),
    provenance: parseProvenance(value.provenance, now, `neighborhoods[${index}]`),
  }));
}

function parseFederation(raw: unknown, now: Date): FederationView {
  const value = requiredObject(raw, 'federation');
  const lastDeliveredAt = nullableText(value.lastDeliveredAt);
  if (lastDeliveredAt !== null && !Number.isFinite(Date.parse(lastDeliveredAt))) throw new Error('federation.lastDeliveredAt must be an ISO timestamp or null');
  return {
    state: requiredText(value.state, 'federation.state'),
    delivery_lag_seconds: nullableFinite(value.deliveryLagSeconds, 'federation.deliveryLagSeconds', { min: 0 }),
    pending_count: nullableInteger(value.pendingCount, 'federation.pendingCount'),
    quarantined_count: nullableInteger(value.quarantinedCount, 'federation.quarantinedCount'),
    last_delivered_at: lastDeliveredAt,
    provenance: parseProvenance(value.provenance, now, 'federation'),
  };
}

function parseOperatorReferences(raw: unknown, now: Date): OperatorReferenceView[] {
  return boundedObjects(raw, 'operatorReferences').map((value, index) => {
    for (const forbidden of ['command', 'argv', 'method', 'actionUrl', 'mutationUrl', 'endpoint']) {
      if (forbidden in value) throw new Error(`operatorReferences[${index}] may not carry executable field ${forbidden}`);
    }
    const taskId = nullableText(value.taskId);
    const receiptRef = nullableText(value.receiptRef);
    if (taskId === null && receiptRef === null) {
      throw new Error(`operatorReferences[${index}] requires taskId or receiptRef`);
    }
    return {
      title: requiredText(value.title, `operatorReferences[${index}].title`),
      state: requiredText(value.state, `operatorReferences[${index}].state`),
      task_id: taskId,
      receipt_ref: receiptRef,
      provenance: parseProvenance(value.provenance, now, `operatorReferences[${index}]`),
    };
  });
}

function parseSnapshot(raw: unknown, now: Date): Omit<WeltgewebeOperationsViewData, 'view_meta'> & {
  generatedAt: string;
  producer: ProvenanceView;
  doesNotEstablish: string[];
} {
  const snapshot = requiredObject(raw, 'snapshot');
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== CONTRACT_KIND) {
    throw new Error('weltgewebe operations snapshot kind or schemaVersion mismatch');
  }
  const generatedAt = requiredText(snapshot.generatedAt, 'snapshot.generatedAt');
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('snapshot.generatedAt must be an ISO timestamp');
  const nonClaims = parseStringArray(snapshot.doesNotEstablish, 'snapshot.doesNotEstablish');
  return {
    slo: parseSlo(snapshot.slo, now),
    recovery: parseRecovery(snapshot.recovery, now),
    deployment: parseDeployment(snapshot.deployment, now),
    cells: parseCells(snapshot.cells, now),
    neighborhoods: parseNeighborhoods(snapshot.neighborhoods, now),
    federation: parseFederation(snapshot.federation, now),
    operator_references: parseOperatorReferences(snapshot.operatorReferences, now),
    generatedAt,
    producer: parseProvenance(snapshot.producer, now, 'producer'),
    doesNotEstablish: nonClaims.length > 0 ? nonClaims : DEFAULT_NON_CLAIMS,
  };
}

export function weltgewebeOperationsSnapshotRecordCount(raw: unknown): number | null {
  try {
    const parsed = parseSnapshot(raw, new Date());
    return parsed.cells.length + parsed.neighborhoods.length + parsed.operator_references.length;
  } catch {
    return null;
  }
}

function emptyData(
  kind: WeltgewebeSourceKind,
  reason: string,
  sourcePath: string,
  sourceRoot: string,
): WeltgewebeOperationsViewData {
  return {
    slo: null,
    recovery: null,
    deployment: null,
    cells: [],
    neighborhoods: [],
    federation: null,
    operator_references: [],
    view_meta: {
      source_kind: kind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath, sourceRoot),
      missing_reason: reason,
      generated_at: null,
      freshness_state: 'unknown',
      cell_count: 0,
      neighborhood_count: 0,
      operator_reference_count: 0,
      producer: null,
      does_not_establish: DEFAULT_NON_CLAIMS,
    },
  };
}

function dataFromParsed(
  parsed: ReturnType<typeof parseSnapshot>,
  sourceKind: WeltgewebeSourceKind,
  sourcePath: string,
  reason: string,
  sourceRoot: string,
  now: Date,
): WeltgewebeOperationsViewData {
  return {
    slo: parsed.slo,
    recovery: parsed.recovery,
    deployment: parsed.deployment,
    cells: parsed.cells,
    neighborhoods: parsed.neighborhoods,
    federation: parsed.federation,
    operator_references: parsed.operator_references,
    view_meta: {
      source_kind: sourceKind,
      source_path: sourcePath,
      source_path_display: displaySourcePath(sourcePath, sourceRoot),
      missing_reason: reason,
      generated_at: parsed.generatedAt,
      freshness_state: freshnessOf(now, parsed.generatedAt),
      cell_count: parsed.cells.length,
      neighborhood_count: parsed.neighborhoods.length,
      operator_reference_count: parsed.operator_references.length,
      producer: parsed.producer,
      does_not_establish: parsed.doesNotEstablish,
    },
  };
}

async function loadSnapshot(path: string, now: Date): Promise<ReturnType<typeof parseSnapshot>> {
  return parseSnapshot(JSON.parse(await readFile(path, 'utf-8')) as unknown, now);
}

export async function getWeltgewebeOperationsData(
  options: WeltgewebeOperationsOptions = {},
): Promise<WeltgewebeOperationsViewData> {
  const sourceRoot = resolve(options.sourceRoot ?? process.cwd());
  const now = options.now ?? new Date();
  const sourcePath = resolve(artifactSnapshotPath(sourceRoot));
  try {
    return dataFromParsed(await loadSnapshot(sourcePath, now), 'artifact', sourcePath, 'ok', sourceRoot, now);
  } catch (error) {
    const classified = classifyError(error);
    const envOverride = process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH !== undefined;
    if (envOverride || classified.kind !== 'missing' || !fixtureFallbackEnabled()) {
      return emptyData(classified.kind, classified.reason, sourcePath, sourceRoot);
    }

    const fallbackPath = resolve(fixtureSnapshotPath(sourceRoot));
    try {
      return dataFromParsed(
        await loadSnapshot(fallbackPath, now),
        'fixture',
        fallbackPath,
        'weltgewebe_operations_snapshot_missing_fixture_fallback',
        sourceRoot,
        now,
      );
    } catch (fallbackError) {
      const fallbackClassified = classifyError(fallbackError);
      return emptyData(fallbackClassified.kind, fallbackClassified.reason, fallbackPath, sourceRoot);
    }
  }
}
