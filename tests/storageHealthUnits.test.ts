import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('storage health runtime units', () => {
  it('keeps the runtime collector syntactically valid and read-only at the producer boundary', async () => {
    await execFileAsync('bash', ['-n', 'scripts/collect-storage-health-runtime']);
    const source = await readFile('scripts/collect-storage-health-runtime', 'utf8');
    expect(source).toContain('storage_inventory.py');
    expect(source).toContain('"$MAINTENANCE_SCRIPT" plan --no-write');
    expect(source).toContain('flock -n');
    expect(source).not.toContain(' cache_maintenance.py" apply ');
    expect(source).not.toContain('rm -rf');
  });

  it('installs release-bound units without activating systemd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'leitstand-storage-units-'));
    roots.push(root);
    const unitDir = join(root, 'units');
    const releaseRoot = resolve(process.cwd());
    const result = await execFileAsync('node', [
      'scripts/install-storage-health-units.mjs',
      '--release-root', releaseRoot,
      '--unit-dir', unitDir,
      '--state-root', join(root, 'state'),
      '--artifact-root', join(root, 'artifacts'),
      '--heim-pc-root', '/home/alex/repos/heim-pc',
    ]);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.kind).toBe('leitstand_storage_health_unit_install_receipt');
    expect(receipt.releaseRoot).toBe(releaseRoot);
    expect(receipt.installed).toHaveLength(2);
    expect(receipt.doesNotEstablish).toContain('timer_enabled');

    const service = await readFile(join(unitDir, 'leitstand-storage-health.service'), 'utf8');
    const timer = await readFile(join(unitDir, 'leitstand-storage-health.timer'), 'utf8');
    expect(service).toContain(`WorkingDirectory=${releaseRoot}`);
    expect(service).toContain(`ExecStart=${releaseRoot}/scripts/collect-storage-health-runtime`);
    expect(service).not.toContain('@RELEASE_ROOT@');
    expect(service).toContain('ProtectSystem=full');
    expect(timer).toContain('OnCalendar=hourly');
    expect(timer).toContain('Persistent=true');
    expect(result.stdout).not.toContain('systemctl');
  });
});
