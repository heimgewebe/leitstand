import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRuntimeHealthData } from '../src/runtimeHealth.js';

type SnapshotTimes = {
  bureau: string;
  checkouts: string;
  storage: string;
  ecosystem: string;
};

describe('runtime health receipt', () => {
  let testDir: string;
  let artifactsDir: string;
  const now = new Date('2026-07-08T18:00:00.000Z');

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-runtime-health-'));
    artifactsDir = join(testDir, 'artifacts');
    await mkdir(artifactsDir, { recursive: true });
    await mkdir(join(testDir, '.git', 'refs', 'heads'), { recursive: true });
    await writeFile(join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8');
    await writeFile(join(testDir, '.git', 'refs', 'heads', 'main'), `${'a'.repeat(40)}\n`, 'utf-8');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function writeSnapshots(generatedAt: string | SnapshotTimes): Promise<void> {
    const times = typeof generatedAt === 'string'
      ? { bureau: generatedAt, checkouts: generatedAt, storage: generatedAt, ecosystem: generatedAt }
      : generatedAt;

    await writeFile(
      join(artifactsDir, 'bureau-tasks.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_bureau_task_snapshot',
        generatedAt: times.bureau,
        tasks: [{ id: 'T1', title: 'Task one', state: 'queued' }],
      }),
      'utf-8',
    );
    await writeFile(
      join(artifactsDir, 'checkout-inventory.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_checkout_inventory',
        generatedAt: times.checkouts,
        checkouts: [{ path: '/tmp/repo', retention: 'retained' }],
      }),
      'utf-8',
    );
    await writeFile(
      join(artifactsDir, 'storage-health.json'),
      JSON.stringify({
        kind: 'leitstand_storage_health',
        generatedAt: times.storage,
        current: {},
      }),
      'utf-8',
    );
    await writeFile(
      join(artifactsDir, 'ecosystem-map-artifact-manifest.json'),
      JSON.stringify({
        kind: 'system_catalog_map_artifact_manifest',
        generatedAt: times.ecosystem,
        artifacts: [],
      }),
      'utf-8',
    );
  }

  it('reports ok when git and operator snapshots are fresh', async () => {
    await writeSnapshots('2026-07-08T17:55:00.000Z');

    const receipt = await getRuntimeHealthData({ cwd: testDir, now });

    expect(receipt.status).toBe('ok');
    expect(receipt.kind).toBe('leitstand_runtime_health_receipt');
    expect(receipt.git.head).toBe('a'.repeat(40));
    expect(receipt.git.branch).toBe('main');
    expect(receipt.snapshots.bureau_tasks.record_count).toBe(1);
    expect(receipt.snapshots.checkout_inventory.status).toBe('ok');
    expect(receipt.snapshots.storage_health.status).toBe('ok');
    expect(receipt.snapshots.ecosystem_map.status).toBe('ok');
    expect(receipt.ingress.status).toBe('not_checked');
    expect(receipt.doesNotEstablish).toContain('dns_correctness');
  });

  it('pins source-specific default freshness limits and boundary transitions', async () => {
    await writeSnapshots({
      bureau: '2026-07-08T17:39:00.000Z',
      checkouts: '2026-07-08T17:40:00.000Z',
      storage: '2026-07-08T16:29:00.000Z',
      ecosystem: '2026-07-01T19:00:00.000Z',
    });

    const receipt = await getRuntimeHealthData({ cwd: testDir, now });

    expect(receipt.snapshots.bureau_tasks.stale_after_seconds).toBe(20 * 60);
    expect(receipt.snapshots.checkout_inventory.stale_after_seconds).toBe(20 * 60);
    expect(receipt.snapshots.storage_health.stale_after_seconds).toBe(90 * 60);
    expect(receipt.snapshots.ecosystem_map.stale_after_seconds).toBe(168 * 60 * 60);

    expect(receipt.snapshots.bureau_tasks).toMatchObject({ status: 'warn', reason: 'snapshot_stale' });
    expect(receipt.snapshots.checkout_inventory).toMatchObject({ status: 'ok', reason: 'snapshot_fresh' });
    expect(receipt.snapshots.storage_health).toMatchObject({ status: 'warn', reason: 'snapshot_stale' });
    expect(receipt.snapshots.ecosystem_map).toMatchObject({ status: 'ok', reason: 'snapshot_fresh' });
    expect(receipt.status).toBe('warn');
  });

  it('marks the Systemkatalog manifest stale only after seven days', async () => {
    await writeSnapshots({
      bureau: '2026-07-08T17:55:00.000Z',
      checkouts: '2026-07-08T17:55:00.000Z',
      storage: '2026-07-08T17:00:00.000Z',
      ecosystem: '2026-07-01T17:59:59.000Z',
    });

    const receipt = await getRuntimeHealthData({ cwd: testDir, now });

    expect(receipt.snapshots.ecosystem_map).toMatchObject({
      status: 'warn',
      reason: 'snapshot_stale',
      stale_after_seconds: 168 * 60 * 60,
    });
  });

  it('allows explicit per-source overrides for isolated tests', async () => {
    await writeSnapshots('2026-07-08T17:00:00.000Z');

    const receipt = await getRuntimeHealthData({
      cwd: testDir,
      now,
      staleAfterMsOverrides: {
        bureau_tasks: 20 * 60 * 1000,
        checkout_inventory: 20 * 60 * 1000,
        storage_health: 20 * 60 * 1000,
        ecosystem_map: 20 * 60 * 1000,
      },
    });

    expect(receipt.status).toBe('warn');
    expect(receipt.snapshots.bureau_tasks.status).toBe('warn');
    expect(receipt.snapshots.checkout_inventory.status).toBe('warn');
    expect(receipt.snapshots.storage_health.status).toBe('warn');
    expect(receipt.snapshots.ecosystem_map.status).toBe('warn');
  });

  it('resolves a loose branch ref from a linked worktree common Git directory', async () => {
    await writeSnapshots('2026-07-08T17:55:00.000Z');
    const commonGitDir = join(testDir, '.git-common');
    const worktreeGitDir = join(commonGitDir, 'worktrees', 'linked');
    await rm(join(testDir, '.git'), { recursive: true, force: true });
    await mkdir(join(commonGitDir, 'refs', 'heads'), { recursive: true });
    await mkdir(worktreeGitDir, { recursive: true });
    await writeFile(join(testDir, '.git'), `gitdir: ${worktreeGitDir}\n`, 'utf-8');
    await writeFile(join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/feature\n', 'utf-8');
    await writeFile(join(worktreeGitDir, 'commondir'), '../..\n', 'utf-8');
    await writeFile(join(commonGitDir, 'refs', 'heads', 'feature'), `${'b'.repeat(40)}\n`, 'utf-8');

    const receipt = await getRuntimeHealthData({ cwd: testDir, now });

    expect(receipt.status).toBe('ok');
    expect(receipt.git.status).toBe('ok');
    expect(receipt.git.head).toBe('b'.repeat(40));
    expect(receipt.git.branch).toBe('feature');
  });

  it('resolves a packed branch ref from a linked worktree common Git directory', async () => {
    await writeSnapshots('2026-07-08T17:55:00.000Z');
    const commonGitDir = join(testDir, '.git-common');
    const worktreeGitDir = join(commonGitDir, 'worktrees', 'linked');
    await rm(join(testDir, '.git'), { recursive: true, force: true });
    await mkdir(worktreeGitDir, { recursive: true });
    await writeFile(join(testDir, '.git'), `gitdir: ${worktreeGitDir}\n`, 'utf-8');
    await writeFile(join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/packed-feature\n', 'utf-8');
    await writeFile(join(worktreeGitDir, 'commondir'), '../..\n', 'utf-8');
    await writeFile(
      join(commonGitDir, 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${'c'.repeat(40)} refs/heads/packed-feature\n`,
      'utf-8',
    );

    const receipt = await getRuntimeHealthData({ cwd: testDir, now });

    expect(receipt.status).toBe('ok');
    expect(receipt.git.status).toBe('ok');
    expect(receipt.git.head).toBe('c'.repeat(40));
    expect(receipt.git.branch).toBe('packed-feature');
  });

  it('fails when a snapshot has the wrong contract kind', async () => {
    await writeSnapshots('2026-07-08T17:55:00.000Z');
    await writeFile(
      join(artifactsDir, 'bureau-tasks.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'wrong_kind',
        generatedAt: '2026-07-08T17:55:00.000Z',
        tasks: [],
      }),
      'utf-8',
    );

    const receipt = await getRuntimeHealthData({ cwd: testDir, now });

    expect(receipt.status).toBe('fail');
    expect(receipt.snapshots.bureau_tasks.status).toBe('fail');
    expect(receipt.snapshots.bureau_tasks.reason).toBe('snapshot_contract_mismatch');
    expect(receipt.snapshots.bureau_tasks.exists).toBe(true);
  });

  it('fails when a required snapshot is missing', async () => {
    await writeSnapshots('2026-07-08T17:55:00.000Z');
    await rm(join(artifactsDir, 'bureau-tasks.json'));

    const receipt = await getRuntimeHealthData({ cwd: testDir, now });

    expect(receipt.status).toBe('fail');
    expect(receipt.snapshots.bureau_tasks.status).toBe('fail');
    expect(receipt.snapshots.bureau_tasks.reason).toBe('snapshot_missing');
  });
});
