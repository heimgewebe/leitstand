import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { getBureauData } from '../../src/controllers/bureau.js';

const OLD_PATH = process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH;
const OLD_FIXTURE_FALLBACK = process.env.LEITSTAND_BUREAU_FIXTURE_FALLBACK;
const OLD_STRICT = process.env.LEITSTAND_STRICT;
let tempRoots: string[] = [];

afterEach(async () => {
  if (OLD_PATH === undefined) delete process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH;
  else process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH = OLD_PATH;
  if (OLD_FIXTURE_FALLBACK === undefined) delete process.env.LEITSTAND_BUREAU_FIXTURE_FALLBACK;
  else process.env.LEITSTAND_BUREAU_FIXTURE_FALLBACK = OLD_FIXTURE_FALLBACK;
  if (OLD_STRICT === undefined) delete process.env.LEITSTAND_STRICT;
  else process.env.LEITSTAND_STRICT = OLD_STRICT;
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

async function writeSnapshot(generatedAt: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-bureau-'));
  tempRoots.push(root);
  const path = join(root, 'bureau.json');
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    kind: 'leitstand_bureau_task_snapshot',
    generatedAt,
    doesNotEstablish: ['task_ownership', 'execution_truth'],
    tasks: [
      { id: 'T1', title: 'running one', state: 'running', claimant: 'grabowski', repo: 'grabowski' },
      { id: 'T2', title: 'queued one', state: 'pending', repo: 'leitstand' },
      { id: 'T3', title: 'blocked one', state: 'blocked' },
      { id: 'T4', title: 'failed one', state: 'error', claimant: 'heimlern' },
      { id: 'T5', title: 'done one', state: 'completed', receiptRef: 'receipt:x' },
    ],
  }), 'utf-8');
  return path;
}

describe('getBureauData', () => {

  it('checks the artifact path by default and does not silently treat fixtures as artifacts', async () => {
    delete process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH;
    delete process.env.LEITSTAND_BUREAU_FIXTURE_FALLBACK;
    delete process.env.LEITSTAND_STRICT;
    const data = await getBureauData();
    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.missing_reason).toBe('bureau_snapshot_missing');
    expect(data.view_meta.source_path_display.startsWith('artifacts/')).toBe(true);
    expect(data.view_meta.source_path.endsWith('/artifacts/bureau-tasks.json')).toBe(true);
  });

  it('uses the demo fixture only when fixture fallback is explicit', async () => {
    delete process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH;
    process.env.LEITSTAND_BUREAU_FIXTURE_FALLBACK = '1';
    const data = await getBureauData();
    expect(data.view_meta.source_kind).toBe('fixture');
    expect(data.view_meta.missing_reason).toBe('bureau_snapshot_missing_fixture_fallback');
    expect(data.view_meta.source_path_display.startsWith('src/fixtures/')).toBe(true);
    expect(data.view_meta.source_path.endsWith('/src/fixtures/bureau-tasks.json')).toBe(true);
  });

  it('uses the demo fixture when Leitstand is explicitly in non-strict preview mode', async () => {
    delete process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH;
    delete process.env.LEITSTAND_BUREAU_FIXTURE_FALLBACK;
    process.env.LEITSTAND_STRICT = 'false';
    const data = await getBureauData();
    expect(data.view_meta.source_kind).toBe('fixture');
    expect(data.view_meta.missing_reason).toBe('bureau_snapshot_missing_fixture_fallback');
  });
  it('groups tasks into lifecycle columns and normalises producer vocab', async () => {
    process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH = await writeSnapshot('2026-07-07T06:30:00Z');
    const data = await getBureauData();
    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.task_count).toBe(5);
    // queued+claimed+running+blocked = open
    expect(data.view_meta.open_count).toBe(3);
    expect(data.view_meta.blocked_count).toBe(1);
    expect(data.view_meta.failed_count).toBe(1);

    const byState = Object.fromEntries(data.columns.map((c) => [c.state, c.tasks.length]));
    expect(byState.queued).toBe(1); // 'pending' → queued
    expect(byState.running).toBe(1);
    expect(byState.blocked).toBe(1);
    expect(byState.failed).toBe(1); // 'error' → failed
    expect(byState.done).toBe(1); // 'completed' → done
  });

  it('marks an old snapshot as stale', async () => {
    process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH = await writeSnapshot('2000-01-01T00:00:00Z');
    const data = await getBureauData();
    expect(data.view_meta.freshness_state).toBe('stale');
  });

  it('reports a missing snapshot as degraded, not green', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-bureau-missing-'));
    tempRoots.push(root);
    process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH = join(root, 'missing.json');
    const data = await getBureauData();
    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.missing_reason).toBe('bureau_snapshot_missing');
    expect(data.view_meta.task_count).toBe(0);
    expect(data.tasks).toEqual([]);
    // Empty state still renders all lifecycle columns.
    expect(data.columns).toHaveLength(6);
  });

  it('rejects a snapshot with the wrong contract kind as corrupt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-bureau-wrong-'));
    tempRoots.push(root);
    const path = join(root, 'wrong.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 1, kind: 'something_else', tasks: [] }), 'utf-8');
    process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH = path;
    const data = await getBureauData();
    expect(data.view_meta.source_kind).toBe('corrupt');
  });
});
