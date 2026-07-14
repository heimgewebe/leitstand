import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getEcosystemMapData } from '../../src/controllers/ecosystemMap.js';
import { loadEcosystemCrossLinks, resolveEcosystemCrossLink } from '../../src/controllers/ecosystemMapLinks.js';

const OLD_MANIFEST = process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH;
const OLD_ROOT = process.env.LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT;
const OLD_STALE = process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS;
const OLD_LINKS = process.env.LEITSTAND_ECOSYSTEM_MAP_LINKS_PATH;

const ARTIFACT_CONTENT = [
  {
    role: 'canonical_ecosystem_map_mermaid',
    path: 'rendered/ecosystem-registry-map.mmd',
    contentType: 'text/mermaid',
    content: 'flowchart TD\n  B[Systemkatalog]\n',
  },
  {
    role: 'rendered_catalog_markdown',
    path: 'rendered/system-catalog.md',
    contentType: 'text/markdown',
    content: '# Systemkatalog\n',
  },
  {
    role: 'registry_nodes',
    path: 'registry/ecosystem/nodes.json',
    contentType: 'application/json',
    content: '{"nodes":[]}\n',
  },
  {
    role: 'registry_edges',
    path: 'registry/ecosystem/edges.json',
    contentType: 'application/json',
    content: '{"edges":[]}\n',
  },
  {
    role: 'authority_matrix',
    path: 'registry/ecosystem/authority-matrix.v1.json',
    contentType: 'application/json',
    content: '{"authorities":[]}\n',
  },
] as const;

let tempRoots: string[] = [];

afterEach(async () => {
  if (OLD_MANIFEST === undefined) delete process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH;
  else process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = OLD_MANIFEST;
  if (OLD_ROOT === undefined) delete process.env.LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT;
  else process.env.LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT = OLD_ROOT;
  if (OLD_STALE === undefined) delete process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS;
  else process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS = OLD_STALE;
  if (OLD_LINKS === undefined) delete process.env.LEITSTAND_ECOSYSTEM_MAP_LINKS_PATH;
  else process.env.LEITSTAND_ECOSYSTEM_MAP_LINKS_PATH = OLD_LINKS;

  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function initializeRepository(sourceRoot: string): Promise<string> {
  await git(sourceRoot, ['init', '--quiet']);
  await git(sourceRoot, ['config', 'user.name', 'Leitstand Test']);
  await git(sourceRoot, ['config', 'user.email', 'leitstand-test@example.invalid']);
  await git(sourceRoot, ['add', '--', 'rendered', 'registry']);
  await git(sourceRoot, ['commit', '--quiet', '-m', 'fixture artifacts']);
  return git(sourceRoot, ['rev-parse', 'HEAD']);
}

async function makeFixture(
  generatedAt = new Date().toISOString(),
  options: { initializeGit?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-map-'));
  tempRoots.push(root);
  const sourceRoot = join(root, 'systemkatalog');
  await mkdir(sourceRoot, { recursive: true });

  for (const artifact of ARTIFACT_CONTENT) {
    const target = join(sourceRoot, artifact.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, artifact.content, 'utf-8');
  }

  const initializeGit = options.initializeGit !== false;
  const sourceCommit = initializeGit
    ? await initializeRepository(sourceRoot)
    : 'a'.repeat(40);
  const manifestPath = join(sourceRoot, 'rendered', 'ecosystem-map-artifact-manifest.json');
  const manifest = {
    schemaVersion: 1,
    kind: 'system_catalog_map_artifact_manifest',
    contractVersion: '1',
    schemaPath: 'catalog/ecosystem-map-artifact-manifest.schema.v1.json',
    mode: 'read_only_projection_source',
    source: {
      repository: 'heimgewebe/systemkatalog',
      commit: sourceCommit,
      generatedAt,
    },
    artifactCount: ARTIFACT_CONTENT.length,
    artifacts: ARTIFACT_CONTENT.map((artifact) => ({
      role: artifact.role,
      path: artifact.path,
      contentType: artifact.contentType,
      bytes: Buffer.byteLength(artifact.content),
      sha256: createHash('sha256').update(artifact.content).digest('hex'),
    })),
    doesNotEstablish: [
      'claim_truth',
      'runtime_correctness',
      'merge_readiness',
      'system_catalog_registry_correctness',
      'consumer_view_correctness',
      'render_success_validates_map',
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  return {
    sourceRoot,
    manifestPath,
    sourceCommit,
    mapPath: join(sourceRoot, 'rendered', 'ecosystem-registry-map.mmd'),
  };
}

describe('getEcosystemMapData', () => {
  it('loads and exactly binds the canonical Systemkatalog artifacts to HEAD', async () => {
    const fixture = await makeFixture();
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.source_repository).toBe('heimgewebe/systemkatalog');
    expect(data.view_meta.source_commit).toBe(fixture.sourceCommit);
    expect(data.view_meta.source_head).toBe(fixture.sourceCommit);
    expect(data.view_meta.source_root).toBe(fixture.sourceRoot);
    expect(data.view_meta.alignment_state).toBe('exact');
    expect(data.view_meta.verified_artifact_count).toBe(5);
    expect(data.view_meta.freshness_state).toBe('fresh');
    expect(data.map?.role).toBe('canonical_ecosystem_map_mermaid');
    expect(data.map?.content).toContain('Systemkatalog');
    expect(data.view_meta.does_not_establish).toContain('runtime_correctness');
  });

  it('reports compatible newer commits when declared artifacts remain byte-identical', async () => {
    const fixture = await makeFixture();
    await writeFile(join(fixture.sourceRoot, 'README.md'), 'unrelated follow-up\n', 'utf-8');
    await git(fixture.sourceRoot, ['add', '--', 'README.md']);
    await git(fixture.sourceRoot, ['commit', '--quiet', '-m', 'unrelated follow-up']);
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.alignment_state).toBe('compatible');
    expect(data.view_meta.alignment_reason).toBe('current_head_preserves_declared_artifact_bytes');
    expect(data.view_meta.commits_ahead).toBe(1);
    expect(data.view_meta.source_head).not.toBe(fixture.sourceCommit);
    expect(data.view_meta.freshness_state).toBe('fresh');
  });

  it('detects committed HEAD drift even when the working tree is manually restored', async () => {
    const fixture = await makeFixture();
    const originalMap = await readFile(fixture.mapPath, 'utf-8');
    await writeFile(fixture.mapPath, 'committed changed map\n', 'utf-8');
    await git(fixture.sourceRoot, ['add', '--', 'rendered/ecosystem-registry-map.mmd']);
    await git(fixture.sourceRoot, ['commit', '--quiet', '-m', 'change map in head']);
    await writeFile(fixture.mapPath, originalMap, 'utf-8');
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.map?.content).toContain('Systemkatalog');
    expect(data.view_meta.alignment_state).toBe('drifted');
    expect(data.view_meta.alignment_reason).toBe('source_head_artifact_drift');
    expect(data.view_meta.freshness_state).toBe('stale');
  });

  it('marks content drift stale when a declared artifact changes', async () => {
    const fixture = await makeFixture();
    await writeFile(fixture.mapPath, 'tampered map\n', 'utf-8');
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.missing_reason).toBe('artifact_integrity_mismatch');
    expect(data.view_meta.alignment_state).toBe('drifted');
    expect(data.view_meta.alignment_reason).toContain('current_artifact_mismatch:');
    expect(data.view_meta.freshness_state).toBe('stale');
    expect(data.map?.content).toBeNull();
  });

  it('keeps the map visible but reports unverifiable when the source root is not Git-bound', async () => {
    const fixture = await makeFixture(new Date().toISOString(), { initializeGit: false });
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.map?.content).toContain('Systemkatalog');
    expect(data.view_meta.alignment_state).toBe('unverifiable');
    expect(data.view_meta.freshness_state).toBe('unknown');
    expect(data.view_meta.freshness_reason).toBe('source_git_head_unavailable');
  });

  it('rejects manifest shapes that weaken the exact artifact contract', async () => {
    const fixture = await makeFixture();
    const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf-8')) as Record<string, unknown>;
    manifest.unexpected = true;
    await writeFile(fixture.manifestPath, JSON.stringify(manifest), 'utf-8');
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.source_kind).toBe('corrupt');
    expect(data.view_meta.missing_reason).toBe('manifest_corrupt');
    expect(data.map).toBeNull();
  });

  it('reports a missing manifest as a missing source instead of throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-map-missing-'));
    tempRoots.push(root);
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = join(root, 'missing.json');

    const data = await getEcosystemMapData();

    expect(data.view_meta.source_kind).toBe('missing');
    expect(data.view_meta.missing_reason).toBe('manifest_missing');
    expect(data.view_meta.alignment_state).toBe('unverifiable');
    expect(data.map).toBeNull();
  });

  it('marks age-expired manifests stale without repairing them', async () => {
    const fixture = await makeFixture('2020-01-01T00:00:00Z');
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;
    process.env.LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS = '1';

    const data = await getEcosystemMapData();

    expect(data.view_meta.alignment_state).toBe('exact');
    expect(data.view_meta.freshness_state).toBe('stale');
    expect(data.view_meta.freshness_reason).toBe('manifest_age_exceeds_threshold');
    expect(data.view_meta.source_kind).toBe('artifact');
  });

  it('loads deterministic cross-view links and degrades unknown node IDs', async () => {
    const links = await loadEcosystemCrossLinks();
    const systemCatalog = resolveEcosystemCrossLink(links, 'repo:systemkatalog');
    const unknown = resolveEcosystemCrossLink(links, 'repo:unknown');

    expect(links.meta.source_kind).toBe('artifact');
    expect(systemCatalog.status).toBe('linked');
    expect(systemCatalog.links[0].href).toBe('/ecosystem-map');
    expect(unknown.status).toBe('unmapped');
    expect(unknown.reason).toBe('node_id_not_in_cross_view_contract');
  });
});
