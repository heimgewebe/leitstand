import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRepoBriefData } from '../../src/controllers/repoBrief.js';

const OLD_INDEX = process.env.LEITSTAND_REPOGROUND_BUNDLES_PATH;
let tempRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  if (OLD_INDEX === undefined) delete process.env.LEITSTAND_REPOGROUND_BUNDLES_PATH;
  else process.env.LEITSTAND_REPOGROUND_BUNDLES_PATH = OLD_INDEX;
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

async function writeBundleIndex(publicExportReady = false, freshnessBound = false) {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-repobrief-'));
  tempRoots.push(root);
  const path = join(root, 'bundles.json');
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    kind: 'leitstand_repobrief_bundle_index',
    generatedAt: freshnessBound ? '2026-07-27T18:00:00Z' : '2026-07-05T06:43:00Z',
    ...(freshnessBound ? { sourceStatus: 'available', staleAfterSeconds: 1200, warnings: [] } : {}),
    doesNotEstablish: ['repo_understanding', 'public_export_safety'],
    bundles: [
      {
        repo: 'leitstand',
        bundleStem: 'leitstand-max-260705-0443',
        bundleDirectory: '/tmp/leitstand-bundle',
        bundleManifest: '/tmp/leitstand-bundle/manifest.json',
        agentReadingPack: '/tmp/leitstand-bundle/pack.md',
        canonicalDump: '/tmp/leitstand-bundle/dump.md',
        sourceCommit: 'a'.repeat(40),
        snapshotStatus: 'ok',
        preflightStatus: 'warn',
        exportSafety: publicExportReady ? 'ok' : 'fail',
        publicExportReady,
        summary: 'fixture bundle',
        requiredArtifacts: ['bundle_manifest', 'canonical_dump'],
        warnings: publicExportReady ? [] : ['export gate missing or not pass'],
      },
    ],
  }), 'utf-8');
  return path;
}

describe('getRepoBriefData', () => {
  it('loads a configured artifact without inventing a freshness verdict', async () => {
    process.env.LEITSTAND_REPOGROUND_BUNDLES_PATH = await writeBundleIndex(false);
    const data = await getRepoBriefData();
    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.freshness_state).toBe('unknown');
    expect(data.view_meta.generated_at).toBe('2026-07-05T06:43:00Z');
    expect(data.view_meta.missing_reason).toBe('canonical_publication_catalog_unavailable');
    expect(data.view_meta.bundle_count).toBe(0);
    expect(data.view_meta.public_export_ready_count).toBe(0);
    expect(data.view_meta.warning_count).toBe(1);
    expect(data.bundles).toEqual([]);
  });


  it('renders only a fresh explicitly bound canonical publication index', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T18:10:00Z'));
    process.env.LEITSTAND_REPOGROUND_BUNDLES_PATH = await writeBundleIndex(true, true);

    const data = await getRepoBriefData();

    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.source_status).toBe('available');
    expect(data.view_meta.freshness_state).toBe('fresh');
    expect(data.view_meta.stale_after_seconds).toBe(1200);
    expect(data.view_meta.bundle_count).toBe(1);
    expect(data.view_meta.public_export_ready_count).toBe(1);
    expect(data.bundles[0]).toMatchObject({
      repo: 'leitstand',
      public_export_ready: true,
    });
  });

  it('labels the repository demo bundle as fixture, not artifact', async () => {
    delete process.env.LEITSTAND_REPOGROUND_BUNDLES_PATH;
    const data = await getRepoBriefData();
    expect(data.view_meta.source_kind).toBe('fixture');
    expect(data.view_meta.freshness_state).toBe('unknown');
    expect(data.view_meta.missing_reason).toBe('fixture_fallback');
  });

  it('reports missing configured index as degraded, not green', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-repobrief-missing-'));
    tempRoots.push(root);
    process.env.LEITSTAND_REPOGROUND_BUNDLES_PATH = join(root, 'missing.json');
    const data = await getRepoBriefData();
    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.freshness_state).toBe('unknown');
    expect(data.view_meta.missing_reason).toBe('repobrief_bundle_index_missing');
    expect(data.view_meta.bundle_count).toBe(0);
    expect(data.bundles).toEqual([]);
  });
});
