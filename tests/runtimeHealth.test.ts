import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getRuntimeHealthData } from '../src/runtimeHealth.js';

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

  async function writeSnapshots(generatedAt: string): Promise<void> {
    await writeFile(
      join(artifactsDir, 'bureau-tasks.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_bureau_task_snapshot',
        generatedAt,
        tasks: [{ id: 'T1', title: 'Task one', state: 'queued' }],
      }),
      'utf-8',
    );
    await writeFile(
      join(artifactsDir, 'checkout-inventory.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_checkout_inventory',
        generatedAt,
        checkouts: [{ path: '/tmp/repo', retention: 'retained' }],
      }),
      'utf-8',
    );
  }

  it('reports ok when git and operator snapshots are fresh', async () => {
    await writeSnapshots('2026-07-08T17:55:00.000Z');

    const receipt = await getRuntimeHealthData({ cwd: testDir, now, staleAfterMs: 20 * 60 * 1000 });

    expect(receipt.status).toBe('ok');
    expect(receipt.kind).toBe('leitstand_runtime_health_receipt');
    expect(receipt.git.head).toBe('a'.repeat(40));
    expect(receipt.git.branch).toBe('main');
    expect(receipt.snapshots.bureau_tasks.status).toBe('ok');
    expect(receipt.snapshots.bureau_tasks.record_count).toBe(1);
    expect(receipt.snapshots.checkout_inventory.status).toBe('ok');
    expect(receipt.ingress.status).toBe('not_checked');
    expect(receipt.doesNotEstablish).toContain('dns_correctness');
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

    const receipt = await getRuntimeHealthData({ cwd: testDir, now, staleAfterMs: 20 * 60 * 1000 });

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

    const receipt = await getRuntimeHealthData({ cwd: testDir, now, staleAfterMs: 20 * 60 * 1000 });

    expect(receipt.status).toBe('ok');
    expect(receipt.git.status).toBe('ok');
    expect(receipt.git.head).toBe('c'.repeat(40));
    expect(receipt.git.branch).toBe('packed-feature');
  });

  it('warns when snapshots are stale', async () => {
    await writeSnapshots('2026-07-08T17:00:00.000Z');

    const receipt = await getRuntimeHealthData({ cwd: testDir, now, staleAfterMs: 20 * 60 * 1000 });

    expect(receipt.status).toBe('warn');
    expect(receipt.snapshots.bureau_tasks.status).toBe('warn');
    expect(receipt.snapshots.bureau_tasks.reason).toBe('snapshot_stale');
    expect(receipt.snapshots.checkout_inventory.status).toBe('warn');
  });

  it('fails when a snapshot has the wrong contract kind', async () => {
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
    await writeFile(
      join(artifactsDir, 'checkout-inventory.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_checkout_inventory',
        generatedAt: '2026-07-08T17:55:00.000Z',
        checkouts: [],
      }),
      'utf-8',
    );

    const receipt = await getRuntimeHealthData({ cwd: testDir, now, staleAfterMs: 20 * 60 * 1000 });

    expect(receipt.status).toBe('fail');
    expect(receipt.snapshots.bureau_tasks.status).toBe('fail');
    expect(receipt.snapshots.bureau_tasks.reason).toBe('snapshot_contract_mismatch');
    expect(receipt.snapshots.bureau_tasks.exists).toBe(true);
  });

  it('fails when a required snapshot is missing', async () => {
    await writeFile(
      join(artifactsDir, 'checkout-inventory.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'leitstand_checkout_inventory',
        generatedAt: '2026-07-08T17:55:00.000Z',
        checkouts: [],
      }),
      'utf-8',
    );

    const receipt = await getRuntimeHealthData({ cwd: testDir, now, staleAfterMs: 20 * 60 * 1000 });

    expect(receipt.status).toBe('fail');
    expect(receipt.snapshots.bureau_tasks.status).toBe('fail');
    expect(receipt.snapshots.bureau_tasks.reason).toBe('snapshot_missing');
  });
});
