import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdtemp, utimes } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadLatestMetrics } from '../src/metrics.js';

describe('metrics', () => {
  let testDir: string;
  
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-metrics-'));
  });
  
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  
  it('should load valid metrics', async () => {
    const metricsData = {
      timestamp: '2025-12-05T12:00:00Z',
      repoCount: 5,
      status: { ok: 3, warn: 1, fail: 1 },
    };
    
    const path = join(testDir, 'metrics.json');
    await writeFile(path, JSON.stringify(metricsData), 'utf-8');
    
    const metrics = await loadLatestMetrics(testDir);
    
    expect(metrics).toBeDefined();
    expect(metrics?.repoCount).toBe(5);
    expect(metrics?.status.ok).toBe(3);
    expect(metrics?.status.warn).toBe(1);
    expect(metrics?.status.fail).toBe(1);
  });
  
  it('should load the latest metrics file by mtime', async () => {
    const oldMetrics = {
      timestamp: '2025-12-04T12:00:00Z',
      repoCount: 3,
      status: { ok: 2, warn: 1, fail: 0 },
    };
    
    const newMetrics = {
      timestamp: '2025-12-05T12:00:00Z',
      repoCount: 5,
      status: { ok: 3, warn: 1, fail: 1 },
    };

    const oldPath = join(testDir, 'old.json');
    const newPath = join(testDir, 'new.json');

    await writeFile(oldPath, JSON.stringify(oldMetrics), 'utf-8');
    // Force deterministic mtimes (avoids FS timestamp resolution flakiness)
    await utimes(oldPath, new Date('2025-12-04T12:00:00Z'), new Date('2025-12-04T12:00:00Z'));

    await writeFile(newPath, JSON.stringify(newMetrics), 'utf-8');
    await utimes(newPath, new Date('2025-12-05T12:00:00Z'), new Date('2025-12-05T12:00:00Z'));

    const metrics = await loadLatestMetrics(testDir);
    
    expect(metrics?.repoCount).toBe(5); // Should load the newer file
  });

  it('prefers the most recently modified snapshot even when date-named files exist', async () => {
    const datedMetrics = {
      timestamp: '2025-12-04T12:00:00Z',
      repoCount: 3,
      status: { ok: 2, warn: 1, fail: 0 },
    };

    const latestMetrics = {
      timestamp: '2025-12-06T12:00:00Z',
      repoCount: 6,
      status: { ok: 4, warn: 1, fail: 1 },
    };

    const datedPath = join(testDir, '2025-12-04.json');
    const latestPath = join(testDir, 'latest.json');

    await writeFile(datedPath, JSON.stringify(datedMetrics), 'utf-8');
    await utimes(datedPath, new Date('2025-12-04T12:00:00Z'), new Date('2025-12-04T12:00:00Z'));

    await writeFile(latestPath, JSON.stringify(latestMetrics), 'utf-8');
    await utimes(latestPath, new Date('2025-12-06T12:00:00Z'), new Date('2025-12-06T12:00:00Z'));

    const metrics = await loadLatestMetrics(testDir);
    
    expect(metrics?.repoCount).toBe(6);
    expect(metrics?.timestamp).toBe('2025-12-06T12:00:00Z');
  });
  
  it('should return null for empty directory', async () => {
    const metrics = await loadLatestMetrics(testDir);
    
    expect(metrics).toBeNull();
  });
  
  it('should return null for non-existent directory', async () => {
    const metrics = await loadLatestMetrics(join(testDir, 'nonexistent'));
    
    expect(metrics).toBeNull();
  });
  
  it('should handle metrics with alternative structure', async () => {
    const metricsData = {
      timestamp: '2025-12-05T12:00:00Z',
      repos: ['repo1', 'repo2', 'repo3'],
      ok: 2,
      warn: 1,
      fail: 0,
    };
    
    const path = join(testDir, 'metrics.json');
    await writeFile(path, JSON.stringify(metricsData), 'utf-8');
    
    const metrics = await loadLatestMetrics(testDir);
    
    expect(metrics).toBeDefined();
    expect(metrics?.repoCount).toBe(3); // Should derive from repos array
    expect(metrics?.status.ok).toBe(2);
  });
});
