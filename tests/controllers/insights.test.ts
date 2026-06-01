import { stat } from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvConfig } from '../../src/config.js';
import { getInsightsData } from '../../src/controllers/insights.js';
import { loadOptional, loadWithFallback } from '../../src/utils/loader.js';

vi.mock('../../src/utils/loader.js', () => ({
  loadWithFallback: vi.fn(),
  loadOptional: vi.fn(),
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
    // By default no previous-day artifact is available; comparison stays null.
    vi.mocked(loadOptional).mockResolvedValue({ data: null, source: 'missing', reason: 'enoent' });
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
    expect(stat).not.toHaveBeenCalled();
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
      expect(stat).not.toHaveBeenCalled();
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
      expect(stat).not.toHaveBeenCalled();
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
      expect(stat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should fall back to ts when metadata.generated_at is invalid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T12:00:00.000Z'));

    try {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          ...fixtureInsights,
          ts: '2026-03-30',
          metadata: { generated_at: 'not-a-date', uncertainty: 0.12 },
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getInsightsData();

      expect(result.view_meta.freshness_source).toBe('ts');
      expect(result.view_meta.freshness_degraded).toBe(false);
      expect(stat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should return freshness_state=unknown when no time reference is available', async () => {
    vi.mocked(stat).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        ts: '',
        topics: [['observatory', 0.6]],
        questions: [],
        deltas: [],
      },
      source: 'fixture',
      reason: 'enoent',
    });

    const result = await getInsightsData();

    expect(result.view_meta.freshness_state).toBe('unknown');
    expect(result.view_meta.data_timestamp).toBeNull();
    expect(result.view_meta.data_age_minutes).toBeNull();
    expect(stat).toHaveBeenCalledTimes(1);
  });

  it('should keep data_timestamp null when generated_at is invalid and no fallback resolves', async () => {
    vi.mocked(stat).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        ...fixtureInsights,
        ts: '',
        metadata: { generated_at: 'invalid-date' },
      },
      source: 'artifact',
      reason: 'ok',
    });

    const result = await getInsightsData();

    expect(result.view_meta.freshness_state).toBe('unknown');
    expect(result.view_meta.freshness_source).toBe('unknown');
    expect(result.view_meta.data_timestamp).toBeNull();
    expect(stat).toHaveBeenCalledTimes(1);
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
          metadata: { generated_at: 'invalid-date', observatory_ref: 'obs-001' },
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getInsightsData();

      expect(result.insights).not.toBeNull();
      expect(result.view_meta.freshness_state).toBe('fresh');
      expect(result.view_meta.freshness_source).toBe('mtime');
      expect(result.view_meta.freshness_degraded).toBe(true);
      expect(result.view_meta.data_timestamp).toBe('2026-03-30T06:00:00.000Z');
      expect(result.view_meta.data_age_minutes).toBe(6 * 60);
      expect(stat).toHaveBeenCalledTimes(1);
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
    expect(stat).not.toHaveBeenCalled();
  });

  it('should classify non-null falsy payload as invalid-shape and not as missing', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: false,
      source: 'artifact',
      reason: 'ok',
    });

    const result = await getInsightsData();

    expect(result.insights).toBeNull();
    expect(result.view_meta.source_kind).toBe('artifact');
    expect(result.view_meta.missing_reason).toBe('invalid-shape');
    expect(stat).not.toHaveBeenCalled();
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

  describe('previous-day comparison (Vortagsvergleich)', () => {
   it('binds against the previous-day artifact and computes a structured delta', async () => {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: { ...fixtureInsights, ts: '2025-12-28' },
        source: 'artifact',
        reason: 'ok',
      });
      vi.mocked(loadOptional).mockResolvedValue({
        data: {
          ts: '2025-12-27',
          topics: [
            ['observatory', 0.8],
            ['insights.daily', 0.7],
            ['chronik-events', 0.6],
          ],
          questions: ['Welche Topics sind stabil?'],
          deltas: [],
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getInsightsData();

      // Looks up the day before today's ts via the dated-artifact convention.
      // When today is from artifact, fixturePath is null (enforcing source coherence).
      const optionalArgs = vi.mocked(loadOptional).mock.calls[0];
      expect(optionalArgs[0]).toContain('insights.daily.2025-12-27.json');
      expect(optionalArgs[1]).toBe(null);
      // allowFixtureFallback option should be false (artifact-only when today is artifact)
      expect(optionalArgs[3]).toMatchObject({ allowFixtureFallback: false });

      expect(result.comparison_meta).toMatchObject({
        available: true,
        source_kind: 'artifact',
        reason: 'ok',
        previous_date: '2025-12-27',
        previous_ts: '2025-12-27',
      });

      const cmp = result.comparison;
      expect(cmp).not.toBeNull();
      expect(cmp?.has_changes).toBe(true);
      // observatory 0.8 → 0.9, insights.daily unchanged, leitstand-ui added, chronik-events removed
      expect(cmp?.topics.added.map((t) => t.name)).toEqual(['leitstand-ui']);
      expect(cmp?.topics.removed.map((t) => t.name)).toEqual(['chronik-events']);
      expect(cmp?.topics.changed).toHaveLength(1);
      expect(cmp?.topics.changed[0]).toMatchObject({ name: 'observatory', direction: 'up' });
      expect(cmp?.topics.unchanged).toBe(1);
    });

    it('reports comparison unavailable when no previous-day artifact exists', async () => {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: { ...fixtureInsights, ts: '2025-12-28' },
        source: 'artifact',
        reason: 'ok',
      });
      vi.mocked(loadOptional).mockResolvedValue({ data: null, source: 'missing', reason: 'enoent' });

      const result = await getInsightsData();

      expect(result.comparison).toBeNull();
      expect(result.comparison_meta).toMatchObject({
        available: false,
        // When today is from artifact but previous is missing, report no-source-coherence instead of enoent
        reason: 'no-source-coherence',
        previous_date: '2025-12-27',
      });
    });

    it('skips comparison when today has no parseable base date', async () => {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: { ...fixtureInsights, ts: '', metadata: { generated_at: '2026-03-30T02:00:00.000Z' } },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getInsightsData();

      expect(result.comparison).toBeNull();
      expect(result.comparison_meta).toMatchObject({ available: false, reason: 'no-base-date' });
      expect(loadOptional).not.toHaveBeenCalled();
    });

    it('degrades to unavailable when the previous-day artifact is invalid', async () => {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: { ...fixtureInsights, ts: '2025-12-28' },
        source: 'fixture',
        reason: 'enoent',
      });
      vi.mocked(loadOptional).mockResolvedValue({
        data: { ts: 123, topics: 'nope' },
        source: 'fixture',
        reason: 'ok',
      });

      const result = await getInsightsData();

      expect(result.comparison).toBeNull();
      expect(result.comparison_meta).toMatchObject({
        available: false,
        reason: 'invalid-shape',
        previous_date: '2025-12-27',
      });
    });

    it('propagates invalid-json reason when previous-day artifact is corrupt', async () => {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: { ...fixtureInsights, ts: '2025-12-28' },
        source: 'artifact',
        reason: 'ok',
      });
      vi.mocked(loadOptional).mockResolvedValue({
        data: null,
        source: 'missing',
        reason: 'invalid-json',
      });

      const result = await getInsightsData();

      expect(result.comparison).toBeNull();
      expect(result.comparison_meta).toMatchObject({
        available: false,
        // When today is from artifact but previous is invalid, report no-source-coherence instead of invalid-json
        reason: 'no-source-coherence',
        previous_date: '2025-12-27',
        source_kind: 'missing',
      });
    });

    it('enforces source coherence: artifact→artifact (no fixture fallback)', async () => {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: { ...fixtureInsights, ts: '2025-12-28' },
        source: 'artifact',
        reason: 'ok',
      });
      vi.mocked(loadOptional).mockResolvedValue({
        data: {
          ts: '2025-12-27',
          topics: [['observatory', 0.8]],
          questions: [],
          deltas: [],
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getInsightsData();

      // Verify that when today is artifact, loadOptional is called with:
      // - artifact path as primary
      // - null as fixturePath (no fallback allowed)
      // - allowFixtureFallback: false
      // - primarySource: 'artifact'
      const optionalCall = vi.mocked(loadOptional).mock.calls[0];
      expect(optionalCall[0]).toContain('artifacts');
      expect(optionalCall[0]).toContain('insights.daily.2025-12-27.json');
      expect(optionalCall[1]).toBe(null); // No fixture fallback
      expect(optionalCall[3]).toMatchObject({
        allowFixtureFallback: false,
        primarySource: 'artifact',
      });

      // Comparison should succeed with artifact source
      expect(result.comparison_meta).toMatchObject({
        available: true,
        source_kind: 'artifact',
      });
    });

    it('enforces source coherence: fixture→fixture (with correct source tracking)', async () => {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: { ...fixtureInsights, ts: '2025-12-28' },
        source: 'fixture', // Today from fixture
        reason: 'enoent',
      });
      vi.mocked(loadOptional).mockResolvedValue({
        data: {
          ts: '2025-12-27',
          topics: [['observatory', 0.8]],
          questions: [],
          deltas: [],
        },
        source: 'fixture',
        reason: 'ok',
      });

      const result = await getInsightsData();

      // Verify that when today is fixture, loadOptional is called with:
      // - fixture path as primary (not artifact path)
      // - null as fixturePath (no dual candidates)
      // - allowFixtureFallback: false
      // - primarySource: 'fixture'
      const optionalCall = vi.mocked(loadOptional).mock.calls[0];
      expect(optionalCall[0]).toContain('fixtures');
      expect(optionalCall[0]).toContain('insights.daily.2025-12-27.json');
      expect(optionalCall[1]).toBe(null); // No additional candidates
      expect(optionalCall[3]).toMatchObject({
        allowFixtureFallback: false,
        primarySource: 'fixture',
      });

      // Comparison should succeed with fixture source
      expect(result.comparison_meta).toMatchObject({
        available: true,
        source_kind: 'fixture',
      });
    });
  });
});
