import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
    content: '{"nodes":[{"id":"repo:systemkatalog","name":"Systemkatalog","type":"repository","purpose":"stable catalog semantics","lifecycle":{"state":"active","reviewedAt":"2026-07-26","evidenceRefs":["policy/system-catalog.v1.json"]}},{"id":"repo:heimserver","name":"Heimserver","type":"repository","purpose":"retired historical reference","lifecycle":{"state":"retired","reviewedAt":"2026-07-25","evidenceRefs":["bureau:T032"]}}]}\n',
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
  {
    role: 'resilience_semantics',
    path: 'registry/ecosystem/resilience.v1.json',
    contentType: 'application/json',
    content: '{"schema_version":1,"components":[]}\n',
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
  options: { initializeGit?: boolean; nodesContent?: string } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-map-'));
  tempRoots.push(root);
  const sourceRoot = join(root, 'systemkatalog');
  await mkdir(sourceRoot, { recursive: true });

  const artifacts = ARTIFACT_CONTENT.map((artifact) => (
    artifact.role === 'registry_nodes' && options.nodesContent !== undefined
      ? { ...artifact, content: options.nodesContent }
      : artifact
  ));

  for (const artifact of artifacts) {
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
    artifactCount: artifacts.length,
    artifacts: artifacts.map((artifact) => ({
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
    expect(data.view_meta.verified_artifact_count).toBe(6);
    expect(data.view_meta.declared_artifact_count).toBe(6);
    expect(data.view_meta.freshness_state).toBe('fresh');
    expect(data.view_meta.semantic_review_state).toBe('declared');
    expect(data.view_meta.semantic_reviewed_at).toBe('2026-07-25');
    expect(data.view_meta.semantic_reviewed_node_count).toBe(2);
    expect(data.view_meta.lifecycle_counts).toEqual({
      active: 1, transition: 0, reference: 0, archived: 0, retired: 1,
    });
    expect(data.nodes).toMatchObject([
      { node_id: 'repo:systemkatalog', lifecycle_state: 'active' },
      { node_id: 'repo:heimserver', lifecycle_state: 'retired' },
    ]);
    expect(data.map?.role).toBe('canonical_ecosystem_map_mermaid');
    expect(data.map?.content).toContain('Systemkatalog');
    expect(data.view_meta.does_not_establish).toContain('runtime_correctness');
  });

  it('keeps technical artifact truth fresh when lifecycle semantics are unavailable', async () => {
    const fixture = await makeFixture(new Date().toISOString(), {
      nodesContent: '{"nodes":[{"id":"repo:systemkatalog","name":"Systemkatalog","type":"repository","purpose":"catalog","lifecycle":{"state":"running","reviewedAt":"not-a-date","evidenceRefs":[]}}]}\n',
    });
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.alignment_state).toBe('exact');
    expect(data.view_meta.freshness_state).toBe('fresh');
    expect(data.view_meta.semantic_review_state).toBe('unavailable');
    expect(data.view_meta.semantic_review_reason).toBe('registry_lifecycle_contract_unavailable');
    expect(data.view_meta.semantic_reviewed_node_count).toBe(0);
    expect(data.view_meta.semantic_node_count).toBe(1);
    expect(data.nodes).toEqual([]);
    expect(data.view_meta.lifecycle_counts).toEqual({
      active: 0, transition: 0, reference: 0, archived: 0, retired: 0,
    });
  });

  it.each(['2026-02-30', '2025-02-29', '0000-01-01', '2026-2-03'])(
    'rejects non-canonical or impossible lifecycle date %s without degrading artifact freshness',
    async (reviewedAt) => {
      const fixture = await makeFixture(new Date().toISOString(), {
        nodesContent: `${JSON.stringify({
          nodes: [{
            id: 'repo:heimserver',
            name: 'Heimserver',
            type: 'repository',
            purpose: 'retired historical reference',
            lifecycle: { state: 'retired', reviewedAt, evidenceRefs: ['bureau:T032'] },
          }],
        })}\n`,
      });
      process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

      const data = await getEcosystemMapData();

      expect(data.view_meta.alignment_state).toBe('exact');
      expect(data.view_meta.freshness_state).toBe('fresh');
      expect(data.view_meta.semantic_review_state).toBe('unavailable');
      expect(data.view_meta.semantic_node_count).toBe(1);
      expect(data.view_meta.semantic_reviewed_node_count).toBe(0);
      expect(data.nodes).toEqual([]);
    },
  );

  it.each([
    {
      label: 'duplicate node identities',
      nodes: [
        {
          id: 'repo:heimserver',
          name: 'Heimserver',
          type: 'repository',
          purpose: 'retired historical reference',
          lifecycle: { state: 'retired', reviewedAt: '2026-07-26', evidenceRefs: ['bureau:T032'] },
        },
        {
          id: 'repo:heimserver',
          name: 'Heimserver duplicate',
          type: 'repository',
          purpose: 'duplicate reference',
          lifecycle: { state: 'retired', reviewedAt: '2026-07-26', evidenceRefs: ['bureau:T063'] },
        },
      ],
    },
    {
      label: 'node identities with surrounding whitespace',
      nodes: [
        {
          id: 'repo:heimserver',
          name: 'Heimserver',
          type: 'repository',
          purpose: 'retired historical reference',
          lifecycle: { state: 'retired', reviewedAt: '2026-07-26', evidenceRefs: ['bureau:T032'] },
        },
        {
          id: ' repo:heimserver ',
          name: 'Heimserver spaced',
          type: 'repository',
          purpose: 'non-canonical reference',
          lifecycle: { state: 'retired', reviewedAt: '2026-07-26', evidenceRefs: ['bureau:T063'] },
        },
      ],
    },
    {
      label: 'duplicate lifecycle evidence references',
      nodes: [{
        id: 'repo:heimserver',
        name: 'Heimserver',
        type: 'repository',
        purpose: 'retired historical reference',
        lifecycle: {
          state: 'retired',
          reviewedAt: '2026-07-26',
          evidenceRefs: ['bureau:T032', 'bureau:T032'],
        },
      }],
    },
    {
      label: 'lifecycle evidence references with surrounding whitespace',
      nodes: [{
        id: 'repo:heimserver',
        name: 'Heimserver',
        type: 'repository',
        purpose: 'retired historical reference',
        lifecycle: {
          state: 'retired',
          reviewedAt: '2026-07-26',
          evidenceRefs: ['bureau:T032', ' bureau:T063 '],
        },
      }],
    },
  ])('rejects $label', async ({ nodes }) => {
    const fixture = await makeFixture(new Date().toISOString(), {
      nodesContent: `${JSON.stringify({ nodes })}\n`,
    });
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.alignment_state).toBe('exact');
    expect(data.view_meta.semantic_review_state).toBe('unavailable');
    expect(data.view_meta.semantic_node_count).toBe(nodes.length);
    expect(data.view_meta.semantic_reviewed_node_count).toBe(0);
    expect(data.nodes).toEqual([]);
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

  it('rejects symlinked artifacts before reading their targets', async () => {
    const fixture = await makeFixture();
    const target = join(fixture.sourceRoot, 'outside-map.mmd');
    await writeFile(target, 'flowchart TD\n  B[Systemkatalog]\n', 'utf-8');
    await rm(fixture.mapPath);
    await symlink(target, fixture.mapPath);
    process.env.LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH = fixture.manifestPath;

    const data = await getEcosystemMapData();

    expect(data.view_meta.alignment_state).toBe('drifted');
    expect(data.view_meta.missing_reason).toBe('artifact_symlink_rejected');
    expect(data.map?.content).toBeNull();
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

  it('rejects unknown additional artifacts instead of weakening the exact contract', async () => {
    const fixture = await makeFixture();
    const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf-8')) as {
      artifactCount: number;
      artifacts: Array<Record<string, unknown>>;
    };
    manifest.artifacts.push({
      role: 'future_unknown_semantics',
      path: 'registry/ecosystem/future.v1.json',
      contentType: 'application/json',
      bytes: 2,
      sha256: 'a'.repeat(64),
    });
    manifest.artifactCount = manifest.artifacts.length;
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
