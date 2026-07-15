import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = resolve('scripts/storage-health-snapshot.mjs');
const roots: string[] = [];

interface ProducerOptions {
  id?: string;
  sizeBytes?: number;
  status?: string;
  errorCount?: number;
}

function producer(options: ProducerOptions = {}) {
  return {
    id: options.id ?? 'workspace-cache',
    class: 'temporary_workspace',
    owner: 'grabowski',
    cleanup_strategy: 'archive_then_review',
    size_bytes: options.sizeBytes ?? 120,
    apparent_size_bytes: options.sizeBytes ?? 120,
    budget_bytes: { warning: 100, hard: 200 },
    status: options.status ?? 'warning',
    file_count: 1,
    directory_count: 1,
    error_count: options.errorCount ?? 0,
    oldest_mtime: null,
    newest_mtime: null,
    paths: [],
    automatic_cleanup_authorized: false,
  };
}

function inventory(generatedAt: string, options: {
  usedBytes?: number;
  temporaryBytes?: number;
  temporaryStatus?: string;
  producerStatus?: string;
  producerSize?: number;
} = {}) {
  const usedBytes = options.usedBytes ?? 1_000;
  return {
    schema_version: 1,
    kind: 'heim_pc.storage_inventory',
    policy_id: 'storage-lifecycle.v1',
    generated_at: generatedAt,
    host: 'heim-pc',
    filesystem: {
      path: '/',
      total_bytes: 10_000,
      used_bytes: usedBytes,
      free_bytes: 9_000,
      available_bytes: 8_500,
      reserved_bytes: 500,
      used_percent: usedBytes / 100,
      status: 'ok',
    },
    class_totals_bytes: { temporary_workspace: options.temporaryBytes ?? 120 },
    temporary_total_bytes: options.temporaryBytes ?? 120,
    temporary_status: options.temporaryStatus ?? 'warning',
    producers: [producer({ status: options.producerStatus, sizeBytes: options.producerSize })],
    unowned_candidates: [{ path: '/tmp/unowned', size_bytes: 25 }],
    unowned_discovery_errors: [],
    summary: {
      producer_count: 1,
      warning_count: 1,
      hard_limit_count: 0,
      degraded_count: 0,
      unowned_candidate_count: 1,
      unowned_discovery_error_count: 0,
    },
    does_not_establish: ['cleanup_authority'],
    inventory_sha256: 'a'.repeat(64),
  };
}

function maintenancePlan(generatedAt: string, complete = true) {
  return {
    schema_version: 1,
    kind: 'heim_pc.cache_maintenance_plan',
    generated_at_unix: Math.floor(Date.parse(generatedAt) / 1000),
    plan_id: 'b'.repeat(64),
    plan_sha256: 'c'.repeat(64),
    policy_id: 'cache-maintenance.v1',
    policy_sha256: 'd'.repeat(64),
    home: '/home/alex',
    pins: [],
    process_observation: {
      complete,
      errors: complete ? [] : ['fd-permission:1'],
      active_docker_build_pids: [],
      path_references: [],
      open_file_descriptors_checked: 0,
    },
    classes: {
      filesystem_cache: {
        candidates: [{ id: 'cache-1', automatic_cleanup_authorized: false }],
        exclusions: [{ id: 'cache-live', reason: 'active_process' }],
      },
    },
    safety: {},
    summary: {},
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'leitstand-storage-health-'));
  roots.push(root);
  return {
    root,
    inventoryPath: join(root, 'inventory.json'),
    planPath: join(root, 'plan.json'),
    outputPath: join(root, 'storage-health.json'),
  };
}

async function runCollector(paths: Awaited<ReturnType<typeof setup>>, args: string[] = []) {
  const result = await execFileAsync('node', [
    script,
    '--inventory', paths.inventoryPath,
    '--maintenance-plan', paths.planPath,
    '--output', paths.outputPath,
    ...args,
  ], { cwd: process.cwd() });
  return {
    receipt: JSON.parse(result.stdout),
    output: JSON.parse(await readFile(paths.outputPath, 'utf8')),
  };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('storage health snapshot collector', () => {
  it('replaces the same hourly and daily buckets and suppresses repeated alert noise', async () => {
    const paths = await setup();
    await writeFile(paths.planPath, JSON.stringify(maintenancePlan('2026-07-15T10:00:00Z')));
    await writeFile(paths.inventoryPath, JSON.stringify(inventory('2026-07-15T10:05:00Z')));
    const first = await runCollector(paths);
    expect(first.output.hourly).toHaveLength(1);
    expect(first.output.daily).toHaveLength(1);
    expect(first.output.notifications.length).toBeGreaterThan(0);

    await writeFile(paths.inventoryPath, JSON.stringify(inventory('2026-07-15T10:45:00Z', { usedBytes: 1_100 })));
    const second = await runCollector(paths);
    expect(second.output.hourly).toHaveLength(1);
    expect(second.output.hourly[0].observedAt).toBe('2026-07-15T10:45:00.000Z');
    expect(second.output.daily).toHaveLength(1);
    expect(second.output.notifications).toHaveLength(first.output.notifications.length);
  });

  it('keeps bounded, strictly increasing hourly and daily windows', async () => {
    const paths = await setup();
    for (let index = 0; index < 5; index += 1) {
      const timestamp = `2026-07-${String(10 + index).padStart(2, '0')}T12:00:00Z`;
      await writeFile(paths.planPath, JSON.stringify(maintenancePlan(timestamp)));
      await writeFile(paths.inventoryPath, JSON.stringify(inventory(timestamp, { usedBytes: 1_000 + index })));
      await runCollector(paths, ['--hourly-max', '3', '--daily-max', '2', '--notification-max', '4']);
    }
    const output = JSON.parse(await readFile(paths.outputPath, 'utf8'));
    expect(output.hourly).toHaveLength(3);
    expect(output.daily).toHaveLength(2);
    expect(output.notifications.length).toBeLessThanOrEqual(4);
    expect(output.hourly.map((item: { bucket: string }) => item.bucket)).toEqual([
      '2026-07-12T12:00:00.000Z',
      '2026-07-13T12:00:00.000Z',
      '2026-07-14T12:00:00.000Z',
    ]);
    expect(output.daily.map((item: { date: string }) => item.date)).toEqual(['2026-07-13', '2026-07-14']);
  });

  it('marks exact 24-hour growth observed and nearby baselines estimated', async () => {
    const exact = await setup();
    await writeFile(exact.planPath, JSON.stringify(maintenancePlan('2026-07-14T08:00:00Z')));
    await writeFile(exact.inventoryPath, JSON.stringify(inventory('2026-07-14T08:00:00Z', { usedBytes: 1_000 })));
    await runCollector(exact);
    await writeFile(exact.planPath, JSON.stringify(maintenancePlan('2026-07-15T08:00:00Z')));
    await writeFile(exact.inventoryPath, JSON.stringify(inventory('2026-07-15T08:00:00Z', { usedBytes: 1_250 })));
    const exactResult = await runCollector(exact);
    expect(exactResult.output.current.growth24h).toMatchObject({ bytes: 250, truth: 'observed' });

    const nearby = await setup();
    await writeFile(nearby.planPath, JSON.stringify(maintenancePlan('2026-07-14T07:00:00Z')));
    await writeFile(nearby.inventoryPath, JSON.stringify(inventory('2026-07-14T07:00:00Z', { usedBytes: 1_000 })));
    await runCollector(nearby);
    await writeFile(nearby.planPath, JSON.stringify(maintenancePlan('2026-07-15T08:00:00Z')));
    await writeFile(nearby.inventoryPath, JSON.stringify(inventory('2026-07-15T08:00:00Z', { usedBytes: 1_200 })));
    const nearbyResult = await runCollector(nearby);
    expect(nearbyResult.output.current.growth24h).toMatchObject({ bytes: 200, truth: 'estimated' });
  });

  it('rejects oversized producer registries before writing an artifact', async () => {
    const paths = await setup();
    const oversized = inventory('2026-07-15T08:00:00Z');
    oversized.producers = Array.from({ length: 513 }, (_, index) => producer({ id: `producer-${index}` }));
    await writeFile(paths.inventoryPath, JSON.stringify(oversized));
    await writeFile(paths.planPath, JSON.stringify(maintenancePlan('2026-07-15T08:00:00Z')));
    await expect(runCollector(paths)).rejects.toThrow(/inventory\.producers exceeds hard payload limit 512/);
  });

  it('emits one new notification on a real threshold transition and surfaces fail-closed blockers', async () => {
    const paths = await setup();
    await writeFile(paths.planPath, JSON.stringify(maintenancePlan('2026-07-15T09:00:00Z', false)));
    await writeFile(paths.inventoryPath, JSON.stringify(inventory('2026-07-15T09:00:00Z')));
    const first = await runCollector(paths);
    const firstTemporary = first.output.notifications.filter((item: { signal: string }) => item.signal === 'temporary-storage');
    expect(firstTemporary).toHaveLength(1);
    expect(first.output.current.cleanupBlockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'process-observation-incomplete', truth: 'observed' }),
      expect.objectContaining({ reason: 'cleanup_not_authorized', truth: 'observed' }),
      expect.objectContaining({ reason: 'safety_exclusions_present', truth: 'observed' }),
    ]));

    await writeFile(paths.inventoryPath, JSON.stringify(inventory('2026-07-15T10:00:00Z', {
      temporaryStatus: 'hard_limit',
      producerStatus: 'hard_limit',
      producerSize: 220,
    })));
    const second = await runCollector(paths);
    const secondTemporary = second.output.notifications.filter((item: { signal: string }) => item.signal === 'temporary-storage');
    expect(secondTemporary).toHaveLength(2);
    expect(secondTemporary.at(-1)).toMatchObject({ from: 'warning', to: 'hard_limit', kind: 'threshold_crossing' });

    const third = await runCollector(paths);
    expect(third.output.notifications).toHaveLength(second.output.notifications.length);
  });
});
