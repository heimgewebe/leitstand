import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptPath = resolve('scripts/export-operator-snapshots.mjs');
let tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-operator-snapshots-'));
  tempRoots.push(root);
  return root;
}

describe('export-operator-snapshots', () => {
  it('exports canonical Bureau lifecycle states and checkout retention verdicts', async () => {
    const root = await makeTempRoot();
    const bureauRawPath = join(root, 'bureau-raw.json');
    const checkoutRawPath = join(root, 'checkout-raw.json');
    const outDir = join(root, 'out');

    await writeFile(bureauRawPath, JSON.stringify({
      tasks: [
        { id: 'T-open', status: 'open' },
        { id: 'T-assigned', state: 'assigned' },
        { id: 'T-active', state: 'active' },
        { id: 'T-waiting', state: 'waiting' },
        { id: 'T-complete', status: 'complete' },
        { id: 'T-error', status: 'error' },
        { id: 'T-weird', status: 'custom-state' },
      ],
    }), 'utf-8');

    await writeFile(checkoutRawPath, JSON.stringify({
      checkouts: [
        { path: 'example://retained', retention: { purpose: 'keep' } },
        { path: 'example://cleanup', cleanup_candidate: true },
        { path: 'example://stale', retention: 'stale' },
        { path: 'example://orphaned', retention: 'orphaned' },
        { path: 'example://implicit-orphan' },
        { path: 'example://anchored', coordination: { processes: ['pid:1'] } },
      ],
    }), 'utf-8');

    await execFileAsync(process.execPath, [
      scriptPath,
      '--bureau-raw', bureauRawPath,
      '--checkout-raw', checkoutRawPath,
      '--out-dir', outDir,
    ]);

    const bureauSnapshot = JSON.parse(await readFile(join(outDir, 'bureau-tasks.json'), 'utf-8')) as {
      tasks: Array<{ id: string; state: string }>;
    };
    const checkoutSnapshot = JSON.parse(await readFile(join(outDir, 'checkout-inventory.json'), 'utf-8')) as {
      checkouts: Array<{ path: string; retention: string }>;
    };

    expect(Object.fromEntries(bureauSnapshot.tasks.map((task) => [task.id, task.state]))).toEqual({
      'T-open': 'queued',
      'T-assigned': 'claimed',
      'T-active': 'running',
      'T-waiting': 'blocked',
      'T-complete': 'done',
      'T-error': 'failed',
      'T-weird': 'unknown',
    });
    expect(Object.fromEntries(checkoutSnapshot.checkouts.map((checkout) => [checkout.path, checkout.retention]))).toEqual({
      'example://retained': 'retained',
      'example://cleanup': 'archivable',
      'example://stale': 'archivable',
      'example://orphaned': 'orphan',
      'example://implicit-orphan': 'orphan',
      'example://anchored': 'unknown',
    });
  });

  it('exports a provenance-bound Weltgewebe snapshot without inventing source state', async () => {
    const root = await makeTempRoot();
    const rawPath = join(root, 'weltgewebe-raw.json');
    const outDir = join(root, 'out');
    const source = JSON.parse(
      await readFile(join(process.cwd(), 'src', 'fixtures', 'weltgewebe-operations.json'), 'utf-8'),
    ) as Record<string, unknown>;
    await writeFile(rawPath, JSON.stringify(source), 'utf-8');

    await execFileAsync(process.execPath, [
      scriptPath,
      '--weltgewebe-raw', rawPath,
      '--out-dir', outDir,
    ]);

    const snapshot = JSON.parse(
      await readFile(join(outDir, 'weltgewebe-operations.json'), 'utf-8'),
    ) as {
      schemaVersion: number;
      kind: string;
      generatedAt: string;
      cells: Array<{ id: string; state: string; provenance: { evidenceRefs: string[] } }>;
      operatorReferences: Array<Record<string, unknown>>;
      doesNotEstablish: string[];
    };

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.kind).toBe('leitstand_weltgewebe_operations_snapshot');
    expect(Date.parse(snapshot.generatedAt)).not.toBeNaN();
    expect(snapshot.cells.map((cell) => [cell.id, cell.state])).toEqual([
      ['cell-hamburg', 'healthy'],
      ['cell-altona', 'degraded'],
    ]);
    expect(snapshot.cells[0]?.provenance.evidenceRefs).toEqual(['fixture:cell-hamburg-receipt']);
    expect(snapshot.operatorReferences[0]).not.toHaveProperty('command');
    expect(snapshot.operatorReferences[0]).not.toHaveProperty('actionUrl');
    expect(snapshot.doesNotEstablish).toContain('cluster_control_authority');
    expect(snapshot.doesNotEstablish).toContain('grabowski_execution_authority');
  });

  it('rejects executable operator fields before a Weltgewebe snapshot is written', async () => {
    const root = await makeTempRoot();
    const rawPath = join(root, 'weltgewebe-unsafe.json');
    const outDir = join(root, 'out');
    const source = JSON.parse(
      await readFile(join(process.cwd(), 'src', 'fixtures', 'weltgewebe-operations.json'), 'utf-8'),
    ) as { operatorReferences: Array<Record<string, unknown>> };
    source.operatorReferences[0] = {
      ...source.operatorReferences[0],
      command: 'kubectl delete pod',
    };
    await writeFile(rawPath, JSON.stringify(source), 'utf-8');

    await expect(execFileAsync(process.execPath, [
      scriptPath,
      '--weltgewebe-raw', rawPath,
      '--out-dir', outDir,
    ])).rejects.toThrow();
    await expect(readFile(join(outDir, 'weltgewebe-operations.json'), 'utf-8')).rejects.toThrow();
  });

});
