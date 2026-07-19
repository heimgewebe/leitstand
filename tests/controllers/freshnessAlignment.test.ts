import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBureauData } from '../../src/controllers/bureau.js';
import { getCheckoutData } from '../../src/controllers/checkouts.js';
import { getStorageHealthData } from '../../src/controllers/storageHealth.js';

const OLD_BUREAU = process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH;
const OLD_CHECKOUT = process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH;
const OLD_STORAGE = process.env.LEITSTAND_STORAGE_HEALTH_PATH;
const roots: string[] = [];

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function writeJson(name: string, value: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `leitstand-${name}-`));
  roots.push(root);
  const path = join(root, `${name}.json`);
  await writeFile(path, JSON.stringify(value), 'utf-8');
  return path;
}

afterEach(async () => {
  vi.useRealTimers();
  restore('LEITSTAND_BUREAU_SNAPSHOT_PATH', OLD_BUREAU);
  restore('LEITSTAND_CHECKOUT_SNAPSHOT_PATH', OLD_CHECKOUT);
  restore('LEITSTAND_STORAGE_HEALTH_PATH', OLD_STORAGE);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('controller freshness policy alignment', () => {
  it('uses the same 20-minute boundary for Bureau and checkout projections', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T12:00:00Z'));

    process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH = await writeJson('bureau', {
      schemaVersion: 1,
      kind: 'leitstand_bureau_task_snapshot',
      generatedAt: '2026-07-19T11:40:00Z',
      tasks: [],
    });
    process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH = await writeJson('checkouts', {
      schemaVersion: 1,
      kind: 'leitstand_checkout_inventory',
      generatedAt: '2026-07-19T11:40:00Z',
      checkouts: [],
    });

    expect((await getBureauData()).view_meta.freshness_state).toBe('fresh');
    expect((await getCheckoutData()).view_meta.freshness_state).toBe('fresh');

    process.env.LEITSTAND_BUREAU_SNAPSHOT_PATH = await writeJson('bureau-stale', {
      schemaVersion: 1,
      kind: 'leitstand_bureau_task_snapshot',
      generatedAt: '2026-07-19T11:39:59Z',
      tasks: [],
    });
    process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH = await writeJson('checkouts-stale', {
      schemaVersion: 1,
      kind: 'leitstand_checkout_inventory',
      generatedAt: '2026-07-19T11:39:59Z',
      checkouts: [],
    });

    expect((await getBureauData()).view_meta.freshness_state).toBe('stale');
    expect((await getCheckoutData()).view_meta.freshness_state).toBe('stale');
  });

  it('uses the same 90-minute boundary for storage-health projection and receipt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T12:00:00Z'));
    const fixture = JSON.parse(
      await readFile(join(process.cwd(), 'src', 'fixtures', 'storage-health.json'), 'utf-8'),
    ) as Record<string, unknown>;

    fixture.generatedAt = '2026-07-19T10:30:00Z';
    process.env.LEITSTAND_STORAGE_HEALTH_PATH = await writeJson('storage', fixture);
    expect((await getStorageHealthData()).view_meta.freshness_state).toBe('fresh');

    fixture.generatedAt = '2026-07-19T10:29:59Z';
    process.env.LEITSTAND_STORAGE_HEALTH_PATH = await writeJson('storage-stale', fixture);
    expect((await getStorageHealthData()).view_meta.freshness_state).toBe('stale');
  });
});
