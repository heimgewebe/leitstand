import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getWeltgewebeOperationsData } from '../../src/controllers/weltgewebeOperations.js';

const OLD_PATH = process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH;
const OLD_FIXTURE_FALLBACK = process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK;
const OLD_STRICT = process.env.LEITSTAND_STRICT;
let tempRoots: string[] = [];

const NOW = new Date('2026-08-18T15:00:00Z');
const COMMIT = 'a'.repeat(40);

function provenance(observedAt = '2026-08-18T14:55:00Z') {
  return {
    sourceSystem: 'weltgewebe',
    sourceKind: 'test-readback',
    sourceRef: 'test:source',
    observedAt,
    sourceCommit: COMMIT,
    evidenceRefs: ['receipt:test'],
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: 'leitstand_weltgewebe_operations_snapshot',
    generatedAt: '2026-08-18T14:56:00Z',
    producer: provenance('2026-08-18T14:56:00Z'),
    slo: {
      availabilityPercent: 99.95,
      p95LatencyMs: 250,
      errorBudgetRemainingPercent: 66,
      window: '30d',
      provenance: provenance(),
    },
    recovery: {
      rtoSeconds: 180,
      rpoSeconds: 60,
      lastRestoreAt: '2026-08-18T13:00:00Z',
      provenance: provenance(),
    },
    deployment: {
      environment: 'staging',
      state: 'current',
      sourceCommit: COMMIT,
      imageRef: 'example.invalid/weltgewebe@sha256:abc',
      provenance: provenance(),
    },
    cells: [
      { id: 'cell-a', name: 'A', state: 'healthy', scope: 'regional', provenance: provenance() },
    ],
    neighborhoods: [
      { id: 'a-b', localCellId: 'cell-a', remoteCellId: 'cell-b', state: 'connected', provenance: provenance() },
    ],
    federation: {
      state: 'connected',
      deliveryLagSeconds: 3,
      pendingCount: 1,
      quarantinedCount: 0,
      lastDeliveredAt: '2026-08-18T14:54:00Z',
      provenance: provenance(),
    },
    operatorReferences: [
      { title: 'T008', state: 'active', taskId: 'WELTGEWEBE-OS-V1-T008', receiptRef: 'receipt:t008', provenance: { ...provenance(), sourceSystem: 'grabowski' } },
    ],
    doesNotEstablish: ['cluster_control_authority', 'grabowski_execution_authority'],
    ...overrides,
  };
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-weltgewebe-'));
  tempRoots.push(root);
  return root;
}

async function writeSnapshot(value: unknown): Promise<string> {
  const root = await makeRoot();
  const path = join(root, 'weltgewebe.json');
  await writeFile(path, JSON.stringify(value), 'utf-8');
  return path;
}

afterEach(async () => {
  if (OLD_PATH === undefined) delete process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH;
  else process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH = OLD_PATH;
  if (OLD_FIXTURE_FALLBACK === undefined) delete process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK;
  else process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK = OLD_FIXTURE_FALLBACK;
  if (OLD_STRICT === undefined) delete process.env.LEITSTAND_STRICT;
  else process.env.LEITSTAND_STRICT = OLD_STRICT;
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
  tempRoots = [];
});

describe('getWeltgewebeOperationsData', () => {
  it('fails closed when the production artifact is missing', async () => {
    delete process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH;
    delete process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK;
    delete process.env.LEITSTAND_STRICT;
    const root = await makeRoot();
    const data = await getWeltgewebeOperationsData({ sourceRoot: root, now: NOW });
    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.source_path_display).toBe('artifacts/weltgewebe-operations.json');
    expect(data.slo).toBeNull();
    expect(data.cells).toEqual([]);
  });

  it('uses the demo fixture only when fallback is explicit', async () => {
    delete process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH;
    process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_FIXTURE_FALLBACK = '1';
    const root = await makeRoot();
    await mkdir(join(root, 'src', 'fixtures'), { recursive: true });
    await copyFile(
      join(process.cwd(), 'src', 'fixtures', 'weltgewebe-operations.json'),
      join(root, 'src', 'fixtures', 'weltgewebe-operations.json'),
    );
    const data = await getWeltgewebeOperationsData({ sourceRoot: root, now: NOW });
    expect(data.view_meta.source_kind).toBe('fixture');
    expect(data.view_meta.cell_count).toBe(2);
    expect(data.operator_references[0]?.task_id).toBe('WELTGEWEBE-OS-V1-T008');
  });

  it('preserves source states and exposes per-section freshness plus restore age', async () => {
    process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH = await writeSnapshot(snapshot());
    const data = await getWeltgewebeOperationsData({ now: NOW });
    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.freshness_state).toBe('fresh');
    expect(data.slo?.availability_percent).toBe(99.95);
    expect(data.slo?.provenance.source_system).toBe('weltgewebe');
    expect(data.cells[0]?.state).toBe('healthy');
    expect(data.cells[0]?.provenance.freshness_state).toBe('fresh');
    expect(data.recovery?.restore_age_seconds).toBe(2 * 60 * 60);
    expect(data.federation?.state).toBe('connected');
  });

  it('marks source evidence stale independently instead of rewriting its state', async () => {
    const old = provenance('2026-08-18T12:00:00Z');
    process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH = await writeSnapshot(snapshot({
      cells: [{ id: 'cell-a', name: 'A', state: 'healthy', scope: 'regional', provenance: old }],
    }));
    const data = await getWeltgewebeOperationsData({ now: NOW });
    expect(data.cells[0]?.state).toBe('healthy');
    expect(data.cells[0]?.provenance.freshness_state).toBe('stale');
  });

  it('rejects operator references that try to carry executable actions', async () => {
    process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH = await writeSnapshot(snapshot({
      operatorReferences: [
        {
          title: 'unsafe',
          state: 'active',
          taskId: 'T1',
          receiptRef: null,
          command: 'kubectl delete pod',
          provenance: { ...provenance(), sourceSystem: 'grabowski' },
        },
      ],
    }));
    const data = await getWeltgewebeOperationsData({ now: NOW });
    expect(data.view_meta.source_kind).toBe('corrupt');
    expect(data.operator_references).toEqual([]);
  });

  it('requires provenance evidence instead of accepting unattributed operational values', async () => {
    process.env.LEITSTAND_WELTGEWEBE_OPERATIONS_PATH = await writeSnapshot(snapshot({
      slo: {
        availabilityPercent: 100,
        p95LatencyMs: 1,
        errorBudgetRemainingPercent: 100,
        window: '1h',
        provenance: { ...provenance(), evidenceRefs: [] },
      },
    }));
    const data = await getWeltgewebeOperationsData({ now: NOW });
    expect(data.view_meta.source_kind).toBe('corrupt');
  });
});
