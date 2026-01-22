import { describe, it, expect, vi } from 'vitest';
import { loadData } from '../src/cli.js';
import { type Config } from '../src/config.js';
import * as insightsModule from '../src/insights.js';
import * as eventsModule from '../src/events.js';
import * as metricsModule from '../src/metrics.js';

// We will mock the modules but control their resolution
vi.mock('../src/insights.js');
vi.mock('../src/events.js');
vi.mock('../src/metrics.js');

describe('CLI Data Loading Concurrency', () => {
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

  // Use a fixed "now" date that is DIFFERENT from dateStr to force "historical" path if needed,
  // or SAME as dateStr to force "today" path.
  // Here we use a different date to test the "historical" logic but the concurrency logic is independent.
  const now = new Date('2025-02-01T00:00:00Z');

  it('starts all loading tasks concurrently', async () => {
    // Create a barrier: promise that we can resolve manually
    let barrierResolve: () => void;
    const barrier = new Promise<void>((resolve) => {
      barrierResolve = resolve;
    });

    // Mock implementations that wait for the barrier
    const loadInsightsMock = vi.mocked(insightsModule.loadDailyInsights).mockImplementation(async () => {
      await barrier;
      return { ts: '2025-01-01', topics: [], questions: [], deltas: [] };
    });

    const loadEventsMock = vi.mocked(eventsModule.loadRecentEvents).mockImplementation(async () => {
      await barrier;
      return [];
    });

    const loadMetricsMock = vi.mocked(metricsModule.loadMetricsSnapshot).mockImplementation(async () => {
        await barrier;
        return { timestamp: '2025-01-01', repoCount: 0, status: { ok: 0, warn: 0, fail: 0 } };
    });

    // Also mock loadLatestMetrics in case logic falls back (though with isToday=false and success it shouldn't)
    // But let's mock it to be safe and consistent
    vi.mocked(metricsModule.loadLatestMetrics).mockImplementation(async () => {
        await barrier;
        return { timestamp: '2025-01-01', repoCount: 0, status: { ok: 0, warn: 0, fail: 0 } };
    });

    // Start loading
    const loadPromise = loadData(mockConfig, dateStr, since, until, now);

    // Give the event loop a tick to start tasks
    await new Promise(resolve => setTimeout(resolve, 0));

    // Assert that ALL mocks have been called.
    // If execution was sequential, only the first one (insights) would be called,
    // and it would be stuck waiting for barrier.
    expect(loadInsightsMock).toHaveBeenCalled();
    expect(loadEventsMock).toHaveBeenCalled();
    // For metrics, it depends on isToday logic.
    // dateStr=Jan 1, now=Feb 1 -> isToday=false.
    // It should try to load historical metrics -> loadMetricsSnapshot.
    expect(loadMetricsMock).toHaveBeenCalled();

    // Release the barrier to let them finish
    barrierResolve!();

    // Wait for completion
    const result = await loadPromise;

    // Verify result integrity
    expect(result.insights).toBeTruthy();
    expect(result.events).toEqual([]);
    expect(result.metrics).toBeTruthy();
  });
});
