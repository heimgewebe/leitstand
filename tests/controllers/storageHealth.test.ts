import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getStorageHealthData } from '../../src/controllers/storageHealth.js';

const oldPath = process.env.LEITSTAND_STORAGE_HEALTH_PATH;
const oldFallback = process.env.LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK;
const oldStrict = process.env.LEITSTAND_STRICT;
const roots: string[] = [];

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function fixtureContract() {
  return JSON.parse(await readFile(join(process.cwd(), 'src', 'fixtures', 'storage-health.json'), 'utf8'));
}

afterEach(async () => {
  restore('LEITSTAND_STORAGE_HEALTH_PATH', oldPath);
  restore('LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK', oldFallback);
  restore('LEITSTAND_STRICT', oldStrict);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('getStorageHealthData', () => {
  it('treats a missing runtime artifact as degraded by default', async () => {
    delete process.env.LEITSTAND_STORAGE_HEALTH_PATH;
    delete process.env.LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK;
    delete process.env.LEITSTAND_STRICT;
    const data = await getStorageHealthData();
    expect(data.current).toBeNull();
    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.missing_reason).toBe('storage_health_missing');
    expect(data.view_meta.unavailable_count).toBe(1);
  });

  it('uses fixture data only when fallback is explicit', async () => {
    delete process.env.LEITSTAND_STORAGE_HEALTH_PATH;
    process.env.LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK = 'true';
    const data = await getStorageHealthData();
    expect(data.view_meta.source_kind).toBe('fixture');
    expect(data.view_meta.missing_reason).toBe('storage_health_missing_fixture_fallback');
    expect(data.current?.topProducers[0].id).toBe('linked-worktrees');
    expect(data.current?.growth24h.truth).toBe('estimated');
    expect(data.current?.cleanupBlockers[0].truth).toBe('unavailable');
    expect(data.view_meta.observed_count).toBeGreaterThan(0);
    expect(data.view_meta.estimated_count).toBeGreaterThan(0);
    expect(data.view_meta.unavailable_count).toBeGreaterThan(0);
  });

  it('loads a valid external artifact and exposes fixed retention counts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-storage-controller-'));
    roots.push(root);
    const path = join(root, 'storage-health.json');
    await writeFile(path, JSON.stringify(await fixtureContract()));
    process.env.LEITSTAND_STORAGE_HEALTH_PATH = path;
    const data = await getStorageHealthData();
    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.hourly_count).toBe(2);
    expect(data.view_meta.hourly_max).toBe(168);
    expect(data.view_meta.daily_count).toBe(1);
    expect(data.view_meta.notification_count).toBe(1);
    expect(data.notifications[0].signal).toBe('temporary-storage');
  });

  it('rejects non-monotonic or duplicate buckets instead of smoothing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-storage-corrupt-'));
    roots.push(root);
    const path = join(root, 'storage-health.json');
    const contract = await fixtureContract();
    contract.hourly[1].bucket = contract.hourly[0].bucket;
    await writeFile(path, JSON.stringify(contract));
    process.env.LEITSTAND_STORAGE_HEALTH_PATH = path;
    const data = await getStorageHealthData();
    expect(data.current).toBeNull();
    expect(data.view_meta.source_kind).toBe('corrupt');
    expect(data.view_meta.missing_reason).toBe('storage_health_corrupt');
  });

  it('rejects retention overflow as corrupt evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-storage-overflow-'));
    roots.push(root);
    const path = join(root, 'storage-health.json');
    const contract = await fixtureContract();
    contract.retention.hourlyMax = 1_000;
    await writeFile(path, JSON.stringify(contract));
    process.env.LEITSTAND_STORAGE_HEALTH_PATH = path;
    const data = await getStorageHealthData();
    expect(data.view_meta.source_kind).toBe('corrupt');
    expect(data.current).toBeNull();
  });

  it('rejects oversized nested producer payloads instead of trusting a small outer window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-storage-nested-overflow-'));
    roots.push(root);
    const path = join(root, 'storage-health.json');
    const contract = await fixtureContract();
    const sample = contract.current.topProducers[0];
    contract.daily[0].producers = Array.from({ length: 513 }, () => sample);
    await writeFile(path, JSON.stringify(contract));
    process.env.LEITSTAND_STORAGE_HEALTH_PATH = path;
    const data = await getStorageHealthData();
    expect(data.view_meta.source_kind).toBe('corrupt');
    expect(data.current).toBeNull();
  });
});
