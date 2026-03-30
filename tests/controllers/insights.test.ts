import { stat } from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvConfig } from '../../src/config.js';
import { getInsightsData } from '../../src/controllers/insights.js';
import { loadWithFallback } from '../../src/utils/loader.js';

vi.mock('../../src/utils/loader.js', () => ({
  loadWithFallback: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

const fixtureInsights = {
  ts: '2025-12-28',
  topics: [
    ['observatory', 0.9],
    ['insights.daily', 0.7],
    ['leitstand-ui', 0.5],
  ] as [string, number][],
  questions: ['Welche Topics sind stabil?'],
  deltas: ['Neue Observatory-Quelle verfügbar.'],
  source: 'semantAH.daily',
  metadata: { observatory_ref: 'obs-001', uncertainty: 0.12 },
};

describe('getInsightsData controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetEnvConfig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(stat).mockResolvedValue({ mtime: new Date('2026-03-30T00:00:00.000Z') } as Awaited<ReturnType<typeof stat>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return insights from fixture fallback', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: fixtureInsights,
      source: 'fixture',
      reason: 'enoent',
    });

    const result = await getInsightsData();

    expect(result.insights).not.toBeNull();
    expect(result.insights?.ts).toBe('2025-12-28');
    expect(result.insights?.topics).toHaveLength(3);
    expect(result.view_meta.source_kind).toBe('fixture');
    expect(result.view_meta.missing_reason).toBe('enoent');
    expect(result.view_meta.freshness_source).toBe('ts');
  });

  it('should return insights from artifact path', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: { ...fixtureInsights, source: 'artifact-run' },
      source: 'artifact',
      reason: 'ok',
    });

    const result = await getInsightsData();

    expect(result.insights).not.toBeNull();
    expect(result.view_meta.source_kind).toBe('artifact');
    expect(result.view_meta.missing_reason).toBe('ok');
  });

  it('should return null insights when data is missing', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });

    const result = await getInsightsData();

    expect(result.insights).toBeNull();
    expect(result.view_meta.source_kind).toBe('missing');
    expect(result.view_meta.freshness_state).toBe('unknown');
    expect(result.view_meta.data_age_minutes).toBeNull();
    expect(result.view_meta.uncertainty).toBeNull();
    expect(result.view_meta.observatory_ref).toBeNull();
  });

  it('should mark freshness as stale when metadata.generated_at is older than 30 h', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T20:00:00.000Z'));

    try {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          ...fixtureInsights,
          metadata: { ...fixtureInsights.metadata, generated_at: '2026-03-29T00:00:00.000Z' },
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getInsightsData();

      expect(result.view_meta.freshness_state).toBe('stale');
      expect(result.view_meta.data_age_minutes).toBe(44 * 60);
      expect(result.view_meta.stale_after_hours).toBe(30);
      expect(result.view_meta.freshness_source).toBe('metadata.generated_at');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should mark freshness as fresh when metadata.generated_at is recent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T10:00:00.000Z'));

    try {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          ...fixtureInsights,
          metadata: { ...fixtureInsights.metadata, generated_at: '2026-03-30T02:00:00.000Z' },
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getInsightsData();

      expect(result.view_meta.freshness_state).toBe('fresh');
      expect(result.view_meta.data_age_minutes).toBe(8 * 60);
      expect(result.view_meta.freshness_source).toBe('metadata.generated_at');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should fall back to ts field for freshness when metadata.generated_at is absent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T12:00:00.000Z'));

    try {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          ...fixtureInsights,
          metadata: { uncertainty: 0.1 },
          ts: '2026-03-30',
        },
        source: 'fixture',
        reason: 'enoent',
      });

      const result = await getInsightsData();

      expect(result.view_meta.freshness_state).toBe('fresh');
      expect(result.view_meta.data_age_minutes).toBe(12 * 60);
      expect(result.view_meta.freshness_source).toBe('ts');
    } finally {
      vi.useRealTimers();
    }
  });

  it('should return freshness_state=unknown when no time reference is available', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        ts: '',
        topics: [],
        questions: [],
        deltas: [],
      },
      source: 'fixture',
      reason: 'enoent',
    });

    const result = await getInsightsData();

    expect(result.view_meta.freshness_state).toBe('unknown');
    expect(result.view_meta.data_age_minutes).toBeNull();
  });

  it('should fall back to transport timestamp when semantic timestamps are unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T12:00:00.000Z'));

    try {
      vi.mocked(stat).mockResolvedValue({ mtime: new Date('2026-03-30T06:00:00.000Z') } as Awaited<ReturnType<typeof stat>>);
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          ...fixtureInsights,
          ts: '',
          metadata: { observatory_ref: 'obs-001' },
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getInsightsData();

      expect(result.insights).not.toBeNull();
      expect(result.view_meta.freshness_state).toBe('fresh');
      expect(result.view_meta.freshness_source).toBe('mtime');
      expect(result.view_meta.freshness_degraded).toBe(true);
      expect(result.view_meta.data_age_minutes).toBe(6 * 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should pass through valid uncertainty from metadata', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        ...fixtureInsights,
        metadata: { uncertainty: 0.35 },
      },
      source: 'artifact',
      reason: 'ok',
    });

    const result = await getInsightsData();

    expect(result.view_meta.uncertainty).toBeCloseTo(0.35);
  });

  it('should clamp invalid uncertainty to null', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        ...fixtureInsights,
        metadata: { uncertainty: 1.5, observatory_ref: 'obs-002' },
      },
      source: 'artifact',
      reason: 'ok',
    });

    const result = await getInsightsData();

    expect(result.view_meta.uncertainty).toBeNull();
    expect(result.view_meta.observatory_ref).toBe('obs-002');
  });

  it('should return null uncertainty when metadata has no uncertainty field', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: { ...fixtureInsights, metadata: {} },
      source: 'artifact',
      reason: 'ok',
    });

    const result = await getInsightsData();

    expect(result.view_meta.uncertainty).toBeNull();
  });

  it('should suppress invalid payloads instead of rendering broken structures', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        ts: 123,
        topics: 'invalid',
        questions: {},
        deltas: null,
      },
      source: 'artifact',
      reason: 'ok',
    });

    const result = await getInsightsData();

    expect(result.insights).toBeNull();
    expect(result.view_meta.source_kind).toBe('artifact');
    expect(result.view_meta.missing_reason).toBe('invalid-shape');
  });

  it('should call loadWithFallback with correct paths and name', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });

    await getInsightsData();

    expect(loadWithFallback).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(loadWithFallback).mock.calls[0];
    expect(callArgs[0]).toContain('insights.daily.json');
    expect(callArgs[1]).toContain('insights.daily.json');
    expect(callArgs[2]).toMatchObject({ name: 'Insights' });
  });

  it('should expose is_strict flag from config', async () => {
    vi.stubEnv('LEITSTAND_STRICT', '1');
    resetEnvConfig();

    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });

    const result = await getInsightsData();

    expect(result.view_meta.is_strict).toBe(true);
  });
});
