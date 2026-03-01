import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getObservatoryData } from '../../src/controllers/observatory.js';
import { resetEnvConfig } from '../../src/config.js';
import { loadWithFallback } from '../../src/utils/loader.js';
import { loadLatestMetrics } from '../../src/metrics.js';
import { loadIntegritySummaries } from '../../src/utils/integrity.js';
import { readJsonFile } from '../../src/utils/fs.js';

vi.mock('../../src/utils/loader.js', () => ({
  loadWithFallback: vi.fn(),
}));

vi.mock('../../src/metrics.js', () => ({
  loadLatestMetrics: vi.fn(),
}));

vi.mock('../../src/utils/integrity.js', () => ({
  loadIntegritySummaries: vi.fn(),
}));

vi.mock('../../src/utils/fs.js', () => ({
  readJsonFile: vi.fn(),
}));

describe('getObservatoryData controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetEnvConfig();

    // Setup default mock returns
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: { test: 'data' },
      source: 'artifact',
      reason: 'ok'
    });

    vi.mocked(loadIntegritySummaries).mockResolvedValue({
      summaries: [{ name: 'test' }],
      source: 'artifact',
      reason: 'ok'
    });

    vi.mocked(loadLatestMetrics).mockResolvedValue({
      fleet: 'test'
    });

    vi.mocked(readJsonFile).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('plexer.delivery.report.json')) {
        return { delivered: true };
      }
      if (typeof path === 'string' && path.includes('_meta.json')) {
        return { generated: 'now' };
      }
      throw new Error(`Unexpected file: ${path}`);
    });

    // Mock console.warn to keep output clean
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully load all data (happy path)', async () => {
    const data = await getObservatoryData();

    expect(data).toBeDefined();
    expect(data.data).toEqual({ test: 'data' });
    expect(data.insightsDaily).toEqual({ test: 'data' });
    expect(data.integritySummaries).toEqual([{ name: 'test' }]);
    expect(data.fleetMetrics).toEqual({ fleet: 'test' });
    expect(data.plexerDelivery).toEqual({ delivered: true });

    expect(data.view_meta.source_kind).toBe('artifact');
    expect(data.view_meta.is_strict).toBe(false);
    expect(data.view_meta.forensics).toEqual({ generated: 'now' });

    // Check call counts
    expect(loadWithFallback).toHaveBeenCalledTimes(3); // Observatory, Insights, SelfState
    expect(loadIntegritySummaries).toHaveBeenCalledTimes(1);
    expect(loadLatestMetrics).toHaveBeenCalledTimes(1); // Non-strict, if found on first try
    expect(readJsonFile).toHaveBeenCalledTimes(2); // Plexer, Meta
  });

  it('should sort self-state history descending by date', async () => {
    vi.mocked(loadWithFallback).mockImplementation(async (artifactPath, fixturePath, options) => {
      if (options?.name === 'Self-State') {
        return {
          data: {
            schema: 'heimgeist.self_state.bundle.v1',
            current: { confidence: 0.9 },
            history: [
              { timestamp: '2023-01-01T00:00:00Z', state: { confidence: 0.8 } },
              { timestamp: '2023-01-03T00:00:00Z', state: { confidence: 0.9 } },
              { timestamp: '2023-01-02T00:00:00Z', state: { confidence: 0.85 } }
            ]
          },
          source: 'artifact',
          reason: 'ok'
        };
      }
      return { data: null, source: 'artifact', reason: 'ok' };
    });

    const data = await getObservatoryData();

    expect(data.selfState?.history[0].timestamp).toBe('2023-01-03T00:00:00Z');
    expect(data.selfState?.history[1].timestamp).toBe('2023-01-02T00:00:00Z');
    expect(data.selfState?.history[2].timestamp).toBe('2023-01-01T00:00:00Z');
    expect(data.view_meta.self_state_schema_valid).toBe(true);
  });

  it('should warn and mark schema invalid if self-state schema mismatches', async () => {
    vi.mocked(loadWithFallback).mockImplementation(async (artifactPath, fixturePath, options) => {
      if (options?.name === 'Self-State') {
        return {
          data: {
            schema: 'wrong.schema.v1',
            current: { confidence: 0.9 },
            history: []
          },
          source: 'artifact',
          reason: 'ok'
        };
      }
      return { data: null, source: 'artifact', reason: 'ok' };
    });

    const data = await getObservatoryData();

    expect(data.view_meta.self_state_schema_valid).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[SelfState] Schema mismatch'));
  });

  it('should fallback to fixture metrics if artifact metrics are missing and not strict', async () => {
    // Fail first call, succeed second
    vi.mocked(loadLatestMetrics)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ fleet: 'fixture-metrics' });

    const data = await getObservatoryData();

    expect(loadLatestMetrics).toHaveBeenCalledTimes(2);
    expect(data.fleetMetrics).toEqual({ fleet: 'fixture-metrics' });
  });

  it('should not fallback to fixture metrics if strict mode is enabled', async () => {
    vi.stubEnv('LEITSTAND_STRICT', '1');
    resetEnvConfig();

    vi.mocked(loadLatestMetrics).mockResolvedValueOnce(null);

    const data = await getObservatoryData();

    expect(loadLatestMetrics).toHaveBeenCalledTimes(1); // Only called for artifact
    expect(data.fleetMetrics).toBeNull();
    expect(data.view_meta.is_strict).toBe(true);
  });

  it('should handle errors in metrics loading gracefully', async () => {
    vi.mocked(loadLatestMetrics).mockRejectedValue(new Error('Metrics failed'));

    const data = await getObservatoryData();

    expect(data.fleetMetrics).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      'Failed to load fleet metrics for observatory:',
      'Metrics failed'
    );
  });

  it('should handle errors in readJsonFile gracefully (plexer/forensics missing)', async () => {
    vi.mocked(readJsonFile).mockRejectedValue(new Error('File not found'));

    const data = await getObservatoryData();

    expect(data.plexerDelivery).toBeNull();
    expect(data.view_meta.forensics).toEqual({});
  });
});
