import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { app } from '../src/server.js';

describe('GET /health', () => {
  let testDir: string;
  let bureauSnapshotPath: string;
  let checkoutSnapshotPath: string;
  let decisionAxisSnapshotPath: string;
  let repoGroundSnapshotPath: string;
  let ecosystemMapCurrentHeadPath: string;
  let storageHealthSnapshotPath: string;
  let ecosystemMapSnapshotPath: string;
  const systemkatalogHead = 'd'.repeat(40);

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-server-health-'));
    await mkdir(testDir, { recursive: true });
    bureauSnapshotPath = join(testDir, 'bureau-tasks.json');
    checkoutSnapshotPath = join(testDir, 'checkout-inventory.json');
    decisionAxisSnapshotPath = join(testDir, 'operator-decision-axis.json');
    repoGroundSnapshotPath = join(testDir, 'repoground-bundles.json');
    ecosystemMapCurrentHeadPath = join(testDir, 'ecosystem-map-current-head.json');
    storageHealthSnapshotPath = join(testDir, 'storage-health.json');
    ecosystemMapSnapshotPath = join(testDir, 'ecosystem-map.json');
    const generatedAt = new Date().toISOString();
    await writeFile(
      bureauSnapshotPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_bureau_task_snapshot',
        generatedAt,
        tasks: [],
      }),
      'utf-8',
    );
    await writeFile(
      checkoutSnapshotPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_checkout_inventory',
        generatedAt,
        checkouts: [],
      }),
      'utf-8',
    );
    await writeFile(
      decisionAxisSnapshotPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_operator_decision_axis_snapshot',
        generatedAt,
        sections: { now: {}, focus: {}, blocked: {}, convergence: {}, later: {} },
      }),
      'utf-8',
    );
    await writeFile(
      repoGroundSnapshotPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_repobrief_bundle_index',
        generatedAt,
        sourceStatus: 'available',
        staleAfterSeconds: 1200,
        bundles: [{ repo: 'leitstand' }],
      }),
      'utf-8',
    );
    await writeFile(
      ecosystemMapCurrentHeadPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_source_head_snapshot',
        generatedAt,
        repository: 'heimgewebe/systemkatalog',
        ref: 'refs/heads/main',
        status: 'available',
        head: systemkatalogHead,
      }),
      'utf-8',
    );
    await writeFile(
      storageHealthSnapshotPath,
      JSON.stringify({
        kind: 'leitstand_storage_health',
        generatedAt,
        current: {}
      }),
      'utf-8',
    );
    await writeFile(
      ecosystemMapSnapshotPath,
      JSON.stringify({
        kind: 'system_catalog_map_artifact_manifest',
        generatedAt,
        artifacts: []
      }),
      'utf-8',
    );
    vi.stubEnv('LEITSTAND_BUREAU_SNAPSHOT_PATH', bureauSnapshotPath);
    vi.stubEnv('LEITSTAND_CHECKOUT_SNAPSHOT_PATH', checkoutSnapshotPath);
    vi.stubEnv('LEITSTAND_DECISION_AXIS_SNAPSHOT_PATH', decisionAxisSnapshotPath);
    vi.stubEnv('LEITSTAND_REPOGROUND_BUNDLES_PATH', repoGroundSnapshotPath);
    vi.stubEnv('LEITSTAND_ECOSYSTEM_MAP_CURRENT_HEAD_PATH', ecosystemMapCurrentHeadPath);
    vi.stubEnv('LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT', join(testDir, systemkatalogHead));
    vi.stubEnv('LEITSTAND_STORAGE_HEALTH_PATH', storageHealthSnapshotPath);
    vi.stubEnv('LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH', ecosystemMapSnapshotPath);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns a read-only runtime health receipt', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe('leitstand_runtime_health_receipt');
    expect(response.body.status).toBe('ok');
    expect(response.body.checks.server_process.status).toBe('ok');
    expect(response.body.snapshots.bureau_tasks.path).toBe(bureauSnapshotPath);
    expect(response.body.snapshots.checkout_inventory.path).toBe(checkoutSnapshotPath);
    expect(response.body.snapshots.decision_axis.path).toBe(decisionAxisSnapshotPath);
    expect(response.body.snapshots.repoground.path).toBe(repoGroundSnapshotPath);
    expect(response.body.snapshots.ecosystem_map_head.path).toBe(ecosystemMapCurrentHeadPath);
    expect(response.body.checks.ecosystem_map_head_consistency.status).toBe('ok');
    expect(response.body.snapshots.storage_health.path).toBe(storageHealthSnapshotPath);
    expect(response.body.snapshots.ecosystem_map.path).toBe(ecosystemMapSnapshotPath);
    expect(response.body.ingress.status).toBe('not_checked');
  });
});
