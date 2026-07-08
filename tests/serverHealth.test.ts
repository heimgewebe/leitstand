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

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-server-health-'));
    await mkdir(testDir, { recursive: true });
    bureauSnapshotPath = join(testDir, 'bureau-tasks.json');
    checkoutSnapshotPath = join(testDir, 'checkout-inventory.json');
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
    vi.stubEnv('LEITSTAND_BUREAU_SNAPSHOT_PATH', bureauSnapshotPath);
    vi.stubEnv('LEITSTAND_CHECKOUT_SNAPSHOT_PATH', checkoutSnapshotPath);
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
    expect(response.body.ingress.status).toBe('not_checked');
  });
});
