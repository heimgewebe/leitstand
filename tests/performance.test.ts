import { describe, it, expect, vi } from 'vitest';
import { loadData } from '../src/cli.js';
import { type Config } from '../src/config.js';

// Mock dependencies with 100ms delay each
vi.mock('../src/insights.js', () => ({
  loadDailyInsights: vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { ts: '2025-01-01', topics: [], questions: [], deltas: [] };
  }),
}));

vi.mock('../src/events.js', () => ({
  loadRecentEvents: vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return [];
  }),
}));

vi.mock('../src/metrics.js', () => ({
  loadMetricsSnapshot: vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { timestamp: '2025-01-01', repoCount: 0, status: { ok: 0, warn: 0, fail: 0 } };
  }),
  loadLatestMetrics: vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { timestamp: '2025-01-01', repoCount: 0, status: { ok: 0, warn: 0, fail: 0 } };
  }),
}));

describe('CLI Data Loading Performance', () => {
  const mockConfig: Config = {
    paths: {
      semantah: { todayInsights: '/tmp/insights.json' },
      chronik: { dataDir: '/tmp/chronik' },
      wgx: { metricsDir: '/tmp/metrics' },
    },
    output: { dir: '/tmp/output' },
    digest: { maxEvents: 10 },
  };

  const dateStr = '2025-01-01';
  const since = new Date('2025-01-01T00:00:00Z');
  const until = new Date('2025-01-02T00:00:00Z');

  it('measures load time', async () => {
    const start = Date.now();
    await loadData(mockConfig, dateStr, since, until);
    const duration = Date.now() - start;

    console.log(`Load duration: ${duration}ms`);

    // Check if it matches expected duration based on whether we optimized yet or not
    // This test will be updated after optimization
    // Current state (Sequential): 100 + 100 + 100 = 300ms min
    if (duration >= 300) {
        console.log('Detected SEQUENTIAL execution');
    } else {
        console.log('Detected PARALLEL execution');
    }
  });

  it('verifies parallel execution', async () => {
      const start = Date.now();
      await loadData(mockConfig, dateStr, since, until);
      const duration = Date.now() - start;

      // Should be less than 250ms (parallel) instead of 300ms (sequential)
      expect(duration).toBeLessThan(250);
      expect(duration).toBeGreaterThanOrEqual(100); // At least the longest task
  });
});
