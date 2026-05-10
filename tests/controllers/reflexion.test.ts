import { stat } from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvConfig } from '../../src/config.js';
import { getReflexionData } from '../../src/controllers/reflexion.js';
import { loadWithFallback } from '../../src/utils/loader.js';

vi.mock('../../src/utils/loader.js', () => ({
  loadWithFallback: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

const validReflexionBundle = {
  schema: 'heimgeist.reflexion.bundle.v1',
  meta_state: {
    confidence: 0.8,
    fatigue: 0.2,
    risk_tension: 0.2,
    autonomy_level: 'aware',
    basis_signals: ['signal'],
  },
  drift_markers: [],
  knowledge_gaps: [],
  hypotheses: [],
};

describe('getReflexionData controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetEnvConfig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses generated_at as freshness source when timestamp is valid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));

    try {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          ...validReflexionBundle,
          generated_at: '2026-05-10T11:30:00.000Z',
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getReflexionData();

      expect(result.reflexion).not.toBeNull();
      expect(result.view_meta.freshness_source).toBe('generated_at');
      expect(result.view_meta.data_timestamp).toBe('2026-05-10T11:30:00.000Z');
      expect(result.view_meta.data_age_minutes).toBe(30);
      expect(result.view_meta.freshness_state).toBe('fresh');
      expect(stat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to mtime when generated_at is invalid or missing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));

    try {
      vi.mocked(stat).mockResolvedValue({ mtime: new Date('2026-05-10T10:00:00.000Z') } as Awaited<ReturnType<typeof stat>>);
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          ...validReflexionBundle,
          generated_at: 'not-a-date',
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getReflexionData();

      expect(result.view_meta.freshness_source).toBe('mtime');
      expect(result.view_meta.data_timestamp).toBe('2026-05-10T10:00:00.000Z');
      expect(result.view_meta.data_age_minutes).toBe(120);
      expect(result.view_meta.freshness_state).toBe('fresh');
      expect(stat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the 24h freshness boundary correctly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));

    try {
      vi.mocked(loadWithFallback)
        .mockResolvedValueOnce({
          data: {
            ...validReflexionBundle,
            generated_at: '2026-05-09T12:00:00.000Z',
          },
          source: 'artifact',
          reason: 'ok',
        })
        .mockResolvedValueOnce({
          data: {
            ...validReflexionBundle,
            generated_at: '2026-05-09T11:59:00.000Z',
          },
          source: 'artifact',
          reason: 'ok',
        });

      const exactly24h = await getReflexionData();
      const olderThan24h = await getReflexionData();

      expect(exactly24h.view_meta.data_age_minutes).toBe(24 * 60);
      expect(exactly24h.view_meta.freshness_state).toBe('fresh');

      expect(olderThan24h.view_meta.data_age_minutes).toBe(24 * 60 + 1);
      expect(olderThan24h.view_meta.freshness_state).toBe('stale');
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a future generated_at as unknown and falls back to mtime', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));

    try {
      vi.mocked(stat).mockResolvedValue({ mtime: new Date('2026-05-10T10:00:00.000Z') } as Awaited<ReturnType<typeof stat>>);
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          ...validReflexionBundle,
          // Timestamp is 2 hours in the future — indicates clock drift
          generated_at: '2026-05-10T14:00:00.000Z',
        },
        source: 'artifact',
        reason: 'ok',
      });

      const result = await getReflexionData();

      // Future timestamps must not silently produce 0-minute freshness;
      // the controller falls back to mtime instead.
      expect(result.view_meta.freshness_source).toBe('mtime');
      expect(result.view_meta.data_age_minutes).toBe(120);
      expect(result.view_meta.freshness_state).toBe('fresh');
      expect(stat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

});
