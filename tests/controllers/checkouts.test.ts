import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { getCheckoutData } from '../../src/controllers/checkouts.js';

const OLD_PATH = process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH;
const OLD_FIXTURE_FALLBACK = process.env.LEITSTAND_CHECKOUT_FIXTURE_FALLBACK;
const OLD_STRICT = process.env.LEITSTAND_STRICT;
let tempRoots: string[] = [];

afterEach(async () => {
  if (OLD_PATH === undefined) delete process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH;
  else process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH = OLD_PATH;
  if (OLD_FIXTURE_FALLBACK === undefined) delete process.env.LEITSTAND_CHECKOUT_FIXTURE_FALLBACK;
  else process.env.LEITSTAND_CHECKOUT_FIXTURE_FALLBACK = OLD_FIXTURE_FALLBACK;
  if (OLD_STRICT === undefined) delete process.env.LEITSTAND_STRICT;
  else process.env.LEITSTAND_STRICT = OLD_STRICT;
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

async function writeInventory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-checkout-'));
  tempRoots.push(root);
  const path = join(root, 'checkouts.json');
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    kind: 'leitstand_checkout_inventory',
    generatedAt: '2026-07-07T06:30:00Z',
    checkouts: [
      { path: '/w/retained', retention: 'retained', hasProcess: true, hasResourceLease: true, matchesRuntime: true },
      { path: '/w/orphan', retention: 'orphaned', hasProcess: false, hasResourceLease: false },
      { path: '/w/archivable', retention: 'stale', hasProcess: false, hasResourceLease: false },
      { path: '/w/anchored', retention: 'orphan', hasProcess: true, hasResourceLease: false },
    ],
  }), 'utf-8');
  return path;
}

describe('getCheckoutData', () => {

  it('checks the artifact path by default and does not silently treat fixtures as artifacts', async () => {
    delete process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH;
    delete process.env.LEITSTAND_CHECKOUT_FIXTURE_FALLBACK;
    delete process.env.LEITSTAND_STRICT;
    const data = await getCheckoutData();
    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.missing_reason).toBe('checkout_inventory_missing');
    expect(data.view_meta.source_path.endsWith('/artifacts/checkout-inventory.json')).toBe(true);
  });

  it('uses the demo fixture only when fixture fallback is explicit', async () => {
    delete process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH;
    process.env.LEITSTAND_CHECKOUT_FIXTURE_FALLBACK = 'true';
    const data = await getCheckoutData();
    expect(data.view_meta.source_kind).toBe('fixture');
    expect(data.view_meta.missing_reason).toBe('checkout_inventory_missing_fixture_fallback');
    expect(data.view_meta.source_path.endsWith('/src/fixtures/checkout-inventory.json')).toBe(true);
  });

  it('uses the demo fixture when Leitstand is explicitly in non-strict preview mode', async () => {
    delete process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH;
    delete process.env.LEITSTAND_CHECKOUT_FIXTURE_FALLBACK;
    process.env.LEITSTAND_STRICT = '0';
    const data = await getCheckoutData();
    expect(data.view_meta.source_kind).toBe('fixture');
    expect(data.view_meta.missing_reason).toBe('checkout_inventory_missing_fixture_fallback');
  });
  it('counts retention classes and flags true sprawl only', async () => {
    process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH = await writeInventory();
    const data = await getCheckoutData();
    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.checkout_count).toBe(4);
    expect(data.view_meta.retained_count).toBe(1);
    expect(data.view_meta.orphan_count).toBe(2); // 'orphaned' and 'orphan' both normalise
    expect(data.view_meta.archivable_count).toBe(1); // 'stale' → archivable
    // sprawl = orphan/archivable AND no process AND no lease.
    // /w/orphan and /w/archivable qualify; /w/anchored has a process so it does not.
    expect(data.view_meta.sprawl_count).toBe(2);
  });

  it('sorts worst retention first for triage', async () => {
    process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH = await writeInventory();
    const data = await getCheckoutData();
    expect(data.checkouts[0].retention).toBe('orphan');
    expect(data.checkouts[data.checkouts.length - 1].retention).toBe('retained');
  });

  it('reports a missing inventory as degraded, not green', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-checkout-missing-'));
    tempRoots.push(root);
    process.env.LEITSTAND_CHECKOUT_SNAPSHOT_PATH = join(root, 'missing.json');
    const data = await getCheckoutData();
    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.missing_reason).toBe('checkout_inventory_missing');
    expect(data.checkouts).toEqual([]);
    expect(data.view_meta.sprawl_count).toBe(0);
  });
});
