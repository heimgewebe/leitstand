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
});
