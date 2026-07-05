import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { getEcosystemMapData } from '../../src/controllers/ecosystemMap.js';

const OLD_MANIFEST = process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH;
const OLD_ROOT = process.env.LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT;
const OLD_STALE = process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS;

let tempRoots: string[] = [];

afterEach(async () => {
  if (OLD_MANIFEST === undefined) delete process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH;
  else process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = OLD_MANIFEST;
  if (OLD_ROOT === undefined) delete process.env.LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT;
  else process.env.LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT = OLD_ROOT;
  if (OLD_STALE === undefined) delete process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS;
  else process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS = OLD_STALE;

  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

async function makeFixture(generatedAt = new Date().toISOString()) {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-map-'));
  tempRoots.push(root);
  const sourceRoot = join(root, 'cabinet');
  await mkdir(join(sourceRoot, 'rendered'), { recursive: true });
  await writeFile(join(sourceRoot, 'rendered', 'ecosystem-map.mmd'), 'flowchart TD\n  A[Cabinet]\n', 'utf-8');
  await writeFile(join(sourceRoot, 'rendered', 'ecosystem-registry-map.mmd'), 'flowchart TD\n  B[Registry]\n', 'utf-8');
  const manifestPath = join(sourceRoot, 'rendered', 'ecosystem-map-artifact-manifest.json');
  const manifest = {
    schemaVersion: 1,
    kind: 'cabinet_ecosystem_map_artifact_manifest',
    contractVersion: '1',
    source: {
      repository: 'heimgewebe/cabinet',
      commit: 'a'.repeat(40),
      generatedAt,
    },
    artifactCount: 2,
    artifacts: [
      {
        role: 'readable_overview_mermaid',
        path: 'rendered/ecosystem-map.mmd',
        contentType: 'text/mermaid',
        bytes: 24,
        sha256: 'b'.repeat(64),
      },
      {
        role: 'generated_registry_projection_mermaid',
        path: 'rendered/ecosystem-registry-map.mmd',
        contentType: 'text/mermaid',
        bytes: 25,
        sha256: 'c'.repeat(64),
      },
    ],
    doesNotEstablish: ['claim_truth', 'runtime_correctness', 'merge_readiness'],
  };
  await writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');
  return { sourceRoot, manifestPath };
}

describe('getEcosystemMapData', () => {
  it('loads a Cabinet ecosystem map manifest and Mermaid sources read-only', async () => {
    const fixture = await makeFixture();
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.source_repository).toBe('heimgewebe/cabinet');
    expect(data.view_meta.source_commit).toBe('a'.repeat(40));
    expect(data.view_meta.source_root).toBe(fixture.sourceRoot);
    expect(data.overview?.content).toContain('Cabinet');
    expect(data.registry_projection?.content).toContain('Registry');
    expect(data.view_meta.does_not_establish).toContain('runtime_correctness');
  });

  it('reports a missing manifest as a missing source instead of throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-map-missing-'));
    tempRoots.push(root);
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = join(root, 'missing.json');

    const data = await getEcosystemMapData();

    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.missing_reason).toBe('manifest_missing');
    expect(data.overview).toBeNull();
    expect(data.registry_projection).toBeNull();
  });

  it('marks stale manifests without repairing them', async () => {
    const fixture = await makeFixture('2020-01-01T00:00:00Z');
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;
    process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS = '1';

    const data = await getEcosystemMapData();

    expect(data.view_meta.freshness_state).toBe('stale');
    expect(data.view_meta.source_kind).toBe('artifact');
  });
});
