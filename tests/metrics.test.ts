import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdtemp } from 'fs/promises';
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
    
    await writeFile(join(testDir, 'old.json'), JSON.stringify(oldMetrics), 'utf-8');
    
    // Wait a bit to ensure different mtime
    await new Promise(resolve => setTimeout(resolve, 100));
    
    await writeFile(join(testDir, 'new.json'), JSON.stringify(newMetrics), 'utf-8');
    
    const metrics = await loadLatestMetrics(testDir);
    
    expect(metrics?.repoCount).toBe(5); // Should load the newer file
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
