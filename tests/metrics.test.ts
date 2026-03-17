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

  it('prefers date-named snapshots over other files', async () => {
    // 2025-12-04.json: has a date in filename.
    const datedMetrics = {
      timestamp: '2025-12-04T12:00:00Z',
      repoCount: 3,
      status: { ok: 2, warn: 1, fail: 0 },
    };

    // latest.json: logically newer content (dec 6), and newer mtime (dec 6).
    // BUT since it lacks a date in filename, the logic should prefer the explicit snapshot 2025-12-04.
    // This enforces "snapshot" semantics over "last written" semantics for loadLatestMetrics.
    const latestMetrics = {
      timestamp: '2025-12-06T12:00:00Z',
      repoCount: 6,
      status: { ok: 4, warn: 1, fail: 1 },
    };

    const datedPath = join(testDir, '2025-12-04.json');
    const latestPath = join(testDir, 'latest.json');

    await writeFile(datedPath, JSON.stringify(datedMetrics), 'utf-8');
    // Mtime is old
    await utimes(datedPath, new Date('2025-12-04T12:00:00Z'), new Date('2025-12-04T12:00:00Z'));

    await writeFile(latestPath, JSON.stringify(latestMetrics), 'utf-8');
    // Mtime is new
    await utimes(latestPath, new Date('2025-12-06T12:00:00Z'), new Date('2025-12-06T12:00:00Z'));

    const metrics = await loadLatestMetrics(testDir);
    
    // Expect 2025-12-04.json because it is dated
    expect(metrics?.repoCount).toBe(3);
    expect(metrics?.timestamp).toBe('2025-12-04T12:00:00Z');
  });

  it('prefers the latest date-named snapshot among multiple dated files', async () => {
    const olderMetrics = { repoCount: 1, status: { ok: 1, warn: 0, fail: 0 } };
    const newerMetrics = { repoCount: 2, status: { ok: 2, warn: 0, fail: 0 } };

    const olderPath = join(testDir, '2025-01-01.json');
    const newerPath = join(testDir, '2025-02-01.json');

    await writeFile(olderPath, JSON.stringify(olderMetrics), 'utf-8');
    await writeFile(newerPath, JSON.stringify(newerMetrics), 'utf-8');

    // Give older file a NEWER mtime to verify we rely on filename date
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);
    await utimes(newerPath, yesterday, yesterday);
    await utimes(olderPath, now, now);

    const metrics = await loadLatestMetrics(testDir);

    expect(metrics?.repoCount).toBe(2);
  });

  it('correctly handles multi-batch processing with more than 10 files', async () => {
    // MAX_CONCURRENT_STATS is 10. We create 15 files to ensure multi-batch.
    const fileCount = 15;
    const baseDate = new Date('2025-12-01T12:00:00Z');

    for (let i = 0; i < fileCount; i++) {
      // Filenames: m00.json, m01.json, ...
      const fileName = \`m\${i.toString().padStart(2, '0')}.json\`;
      const filePath = join(testDir, fileName);
      await writeFile(filePath, JSON.stringify({ repoCount: i }));

      // All files get the same base date initially
      await utimes(filePath, baseDate, baseDate);
    }

    // Set m12 (in second batch) to be the newest mtime
    const newestDate = new Date('2025-12-10T12:00:00Z');
    await utimes(join(testDir, 'm12.json'), newestDate, newestDate);

    let metrics = await loadLatestMetrics(testDir);
    expect(metrics?.repoCount).toBe(12);

    // Test tie-breaker across batches:
    // Set m05 (batch 1) and m14 (batch 2) to same newer mtime.
    // m14 should win because it is lexicographically later.
    const tieDate = new Date('2025-12-15T12:00:00Z');
    await utimes(join(testDir, 'm05.json'), tieDate, tieDate);
    await utimes(join(testDir, 'm14.json'), tieDate, tieDate);

    metrics = await loadLatestMetrics(testDir);
    expect(metrics?.repoCount).toBe(14);
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
