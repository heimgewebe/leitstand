import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..');
const wrapperPath = join(repoRoot, 'scripts', 'leitstand-export-operator-snapshots');

function sha256(payload: Buffer | string): string {
  return createHash('sha256').update(payload).digest('hex');
}

function treeSha256(root: string, entries: Array<{ path: string; content: string }>): string {
  const digest = createHash('sha256');
  for (const entry of entries) {
    const encoded = Buffer.from(entry.path);
    const content = Buffer.from(entry.content);
    const nameLength = Buffer.alloc(4);
    nameLength.writeUInt32BE(encoded.length);
    const contentLength = Buffer.alloc(8);
    contentLength.writeBigUInt64BE(BigInt(content.length));
    digest.update(nameLength);
    digest.update(encoded);
    digest.update(contentLength);
    digest.update(content);
  }
  return digest.digest('hex');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-snapshot-wrapper-'));
  const releasesRoot = join(root, 'releases');
  const commit = 'a'.repeat(40);
  const releaseRoot = join(releasesRoot, `${commit}-runtime-v1`);
  const snapshotRoot = join(root, 'bureau-snapshots');
  const canonicalRoot = join(snapshotRoot, 'snapshot-1');
  const artifactRoot = join(root, 'artifacts');
  const runtimeConfig = join(root, 'runtime.json');
  const bureauManifest = join(root, 'bureau-deployment.json');

  await mkdir(join(releaseRoot, 'scripts'), { recursive: true });
  await mkdir(join(canonicalRoot, 'registry', 'tasks'), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(
    join(releaseRoot, 'release-manifest.json'),
    `${JSON.stringify({
      schema_version: 2,
      kind: 'leitstand_local_release_manifest',
      source_commit: commit,
    })}\n`,
  );
  await writeFile(join(releaseRoot, 'scripts', 'export-operator-snapshots.mjs'), '// bridge\n');
  await writeFile(
    runtimeConfig,
    `${JSON.stringify({
      schema_version: 1,
      kind: 'leitstand_local_runtime_config',
      artifact_root: artifactRoot,
    })}\n`,
  );

  const entries = [
    {
      path: 'registry/queue.json',
      content: `${JSON.stringify({ lanes: { later: ['TEST-T001'] } })}\n`,
    },
    {
      path: 'registry/tasks/TEST-T001.json',
      content: `${JSON.stringify({ id: 'TEST-T001', state: 'planned', title: 'Test' })}\n`,
    },
  ];
  for (const entry of entries) {
    await writeFile(join(canonicalRoot, entry.path), entry.content);
  }
  const treeDigest = treeSha256(canonicalRoot, entries);
  const inventoryPath = join(canonicalRoot, '.bureau-runtime-snapshot.json');
  const inventoryBytes = `${JSON.stringify({
    schema_version: 1,
    kind: 'bureau_registry_snapshot',
    source_commit: 'b'.repeat(40),
    tree_sha256: treeDigest,
    paths: entries.map((entry) => entry.path),
  })}\n`;
  await writeFile(inventoryPath, inventoryBytes);
  await writeFile(
    bureauManifest,
    `${JSON.stringify({
      schema_version: 1,
      kind: 'bureau_runtime_deployment',
      source_commit: 'b'.repeat(40),
      canonical_registry_tree_sha256: treeDigest,
      canonical_registry_inventory_sha256: sha256(inventoryBytes),
      canonical_registry_root: canonicalRoot,
      canonical_registry_inventory_path: inventoryPath,
    })}\n`,
  );

  return {
    root,
    releaseRoot,
    releasesRoot,
    snapshotRoot,
    canonicalRoot,
    artifactRoot,
    runtimeConfig,
    bureauManifest,
    taskPath: join(canonicalRoot, 'registry', 'tasks', 'TEST-T001.json'),
  };
}

function verify(env: Record<string, string>) {
  return spawnSync('bash', [wrapperPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GRABOWSKI_PYTHON: 'python3',
      LEITSTAND_SNAPSHOT_VERIFY_ONLY: '1',
      ...env,
    },
  });
}

describe('leitstand-export-operator-snapshots', () => {
  it('binds Bureau input to the canonical digest-validated runtime snapshot', async () => {
    const value = await fixture();
    const result = verify({
      LEITSTAND_RELEASE_ROOT: value.releaseRoot,
      LEITSTAND_RELEASES_ROOT: value.releasesRoot,
      LEITSTAND_RUNTIME_CONFIG: value.runtimeConfig,
      BUREAU_DEPLOYMENT_MANIFEST: value.bureauManifest,
      BUREAU_REGISTRY_SNAPSHOT_ROOT: value.snapshotRoot,
    });
    expect(result.status, result.stderr).toBe(0);
    const evidence = JSON.parse(result.stdout.trim());
    expect(evidence.kind).toBe('leitstand_operator_snapshot_source_verification');
    expect(evidence.leitstand_release_root).toBe(value.releaseRoot);
    expect(evidence.bureau_source_root).toBe(value.canonicalRoot);
    expect(evidence.bureau_source_tree_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed when a canonical snapshot file changes after inventory binding', async () => {
    const value = await fixture();
    await writeFile(value.taskPath, '{"id":"TEST-T001","state":"verified"}\n');
    const result = verify({
      LEITSTAND_RELEASE_ROOT: value.releaseRoot,
      LEITSTAND_RELEASES_ROOT: value.releasesRoot,
      LEITSTAND_RUNTIME_CONFIG: value.runtimeConfig,
      BUREAU_DEPLOYMENT_MANIFEST: value.bureauManifest,
      BUREAU_REGISTRY_SNAPSHOT_ROOT: value.snapshotRoot,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Bureau canonical registry tree digest mismatch');
  });

  it('rejects a Bureau snapshot outside the configured canonical snapshot root', async () => {
    const value = await fixture();
    const otherRoot = join(value.root, 'other-snapshots');
    await mkdir(otherRoot);
    const result = verify({
      LEITSTAND_RELEASE_ROOT: value.releaseRoot,
      LEITSTAND_RELEASES_ROOT: value.releasesRoot,
      LEITSTAND_RUNTIME_CONFIG: value.runtimeConfig,
      BUREAU_DEPLOYMENT_MANIFEST: value.bureauManifest,
      BUREAU_REGISTRY_SNAPSHOT_ROOT: otherRoot,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('escapes the allowed snapshot directory');
  });

  it('rejects task files that are not declared in the canonical inventory', async () => {
    const value = await fixture();
    await writeFile(
      join(value.canonicalRoot, 'registry', 'tasks', 'EXTRA.json'),
      '{"id":"EXTRA","state":"planned"}\n',
    );
    const result = verify({
      LEITSTAND_RELEASE_ROOT: value.releaseRoot,
      LEITSTAND_RELEASES_ROOT: value.releasesRoot,
      LEITSTAND_RUNTIME_CONFIG: value.runtimeConfig,
      BUREAU_DEPLOYMENT_MANIFEST: value.bureauManifest,
      BUREAU_REGISTRY_SNAPSHOT_ROOT: value.snapshotRoot,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('task set disagrees with the declared inventory');
  });

  it('rejects symlink components inside declared registry paths', async () => {
    const value = await fixture();
    const tasks = join(value.canonicalRoot, 'registry', 'tasks');
    const realTasks = join(value.canonicalRoot, 'registry', 'tasks-real');
    await rename(tasks, realTasks);
    await symlink('tasks-real', tasks);
    const result = verify({
      LEITSTAND_RELEASE_ROOT: value.releaseRoot,
      LEITSTAND_RELEASES_ROOT: value.releasesRoot,
      LEITSTAND_RUNTIME_CONFIG: value.runtimeConfig,
      BUREAU_DEPLOYMENT_MANIFEST: value.bureauManifest,
      BUREAU_REGISTRY_SNAPSHOT_ROOT: value.snapshotRoot,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('contains a symlink component');
  });

  it('does not read Bureau truth from a repository checkout', async () => {
    const source = await readFile(wrapperPath, 'utf8');
    expect(source).not.toContain('/home/alex/repos/bureau');
    expect(source).toContain('canonical_registry_inventory_sha256');
    expect(source).toContain('canonical_registry_tree_sha256');
    expect(source).toContain('export-operator-snapshots.mjs');
    expect(source).toContain('raw = json.loads(snapshot_contents[relative.as_posix()])');
    expect(source).not.toContain('raw = json.loads(path.read_text())');
  });
});
