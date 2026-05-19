import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDashboardData } from '../../src/controllers/dashboard.js';
import * as anatomyCtrl from '../../src/controllers/anatomy.js';
import * as insightsCtrl from '../../src/controllers/insights.js';
import * as timelineCtrl from '../../src/controllers/timeline.js';
import * as reflexionCtrl from '../../src/controllers/reflexion.js';

describe('getDashboardData controller', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a tile for each of the five phases in a stable order', async () => {
    vi.spyOn(anatomyCtrl, 'getAnatomyData').mockResolvedValue({
      anatomy: { nodes: [], edges: [], achsen: {}, generated_at: '2026-04-01T00:00:00.000Z' } as never,
      health: {
        source_kind: 'fixture',
        missing_reason: 'artifact_missing',
        timestamp: null,
        by_repo: {},
        totals: { ok: 1, warn: 2, fail: 0, unknown: 0 },
        freshness_state: 'fresh',
        data_age_minutes: 10,
        stale_after_hours: 24,
      },
      view_meta: {
        source_kind: 'artifact',
        missing_reason: 'ok',
        is_strict: false,
        schema_valid: true,
        data_timestamp: '2026-04-01T00:00:00.000Z',
        data_age_minutes: 30,
        freshness_state: 'fresh',
        stale_after_hours: 72,
      },
    });
    vi.spyOn(insightsCtrl, 'getInsightsData').mockResolvedValue({
      insights: { ts: '2026-04-01', topics: [['x', 1]], questions: ['q'], deltas: ['d'] } as never,
      view_meta: {
        source_kind: 'artifact',
        missing_reason: 'ok',
        is_strict: false,
        data_timestamp: '2026-04-01T00:00:00.000Z',
        data_age_minutes: 5,
        freshness_state: 'fresh',
        freshness_source: 'metadata.generated_at',
        freshness_degraded: false,
        stale_after_hours: 30,
        uncertainty: 0.1,
        observatory_ref: null,
      },
    });
    vi.spyOn(timelineCtrl, 'getTimelineData').mockResolvedValue({
      events: [{ timestamp: 't', kind: 'ci.test.pass' } as never],
      view_meta: {
        source_kind: 'chronik',
        window_state: 'has_events',
        missing_reason: 'ok',
        is_strict: false,
        since: 's',
        until: 'u',
        total_loaded: 1,
        hours_back: 48,
        max_events: 200,
        replay_mode: false,
        replay_until: null,
      },
    });
    vi.spyOn(reflexionCtrl, 'getReflexionData').mockResolvedValue({
      reflexion: { schema: 'heimgeist.reflexion.bundle.v1', hypotheses: [{ id: 'h1' }], drift_markers: [] } as never,
      view_meta: {
        source_kind: 'artifact',
        missing_reason: 'ok',
        is_strict: false,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        freshness_source: 'unknown',
        stale_after_hours: 24,
      },
    });

    const result = await getDashboardData();

    expect(result.phases.map((p) => p.id)).toEqual([
      'anatomie',
      'physiologie',
      'zeitachse',
      'erkenntnisse',
      'reflexion',
    ]);
    expect(result.phases.map((p) => p.phase)).toEqual([1, 2, 3, 4, 5]);

    // Anatomy/Physiology read from the same controller but project different facets.
    expect(result.phases[0].source_kind).toBe('artifact');
    expect(result.phases[1].source_kind).toBe('fixture'); // health overlay was fixture
    expect(result.phases[1].metric).toContain('OK 1');
    expect(result.phases[1].metric).toContain('Warn 2');

    // Timeline 'chronik' source kind is normalized to 'artifact' for UI uniformity.
    expect(result.phases[2].source_kind).toBe('artifact');
    expect(result.phases[2].metric).toContain('1 Events');

    expect(result.phases[3].source_kind).toBe('artifact');
    expect(result.phases[3].metric).toContain('1 Topics');

    expect(result.phases[4].source_kind).toBe('artifact');
    expect(result.phases[4].metric).toContain('1 Hypothesen');

    for (const phase of result.phases) {
      expect(phase.error_reason).toBeNull();
    }
  });

  it('masks strict-mode error messages as an opaque token in error_reason', async () => {
    vi.spyOn(anatomyCtrl, 'getAnatomyData').mockRejectedValue(
      new Error('Strict load failed: /data/artifacts/anatomy/2026-05-18.json not found'),
    );
    vi.spyOn(insightsCtrl, 'getInsightsData').mockRejectedValue(
      new Error('strict: /var/run/leitstand/insights/latest.json is missing'),
    );
    vi.spyOn(timelineCtrl, 'getTimelineData').mockResolvedValue({
      events: [],
      view_meta: {
        source_kind: 'missing',
        window_state: 'empty',
        missing_reason: 'enoent',
        is_strict: false,
        since: '',
        until: '',
        total_loaded: 0,
        hours_back: 48,
        max_events: 200,
        replay_mode: false,
        replay_until: null,
      },
    });
    vi.spyOn(reflexionCtrl, 'getReflexionData').mockResolvedValue({
      reflexion: null,
      view_meta: {
        source_kind: 'missing',
        missing_reason: 'enoent',
        is_strict: false,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        freshness_source: 'unknown',
        stale_after_hours: 24,
      },
    });

    const result = await getDashboardData();

    const anatomyTile = result.phases.find((p) => p.id === 'anatomie')!;
    expect(anatomyTile.source_kind).toBe('error');
    expect(anatomyTile.error_reason).toBe('strict-load-failed');
    expect(anatomyTile.error_reason).not.toContain('artifact detail');
    expect(anatomyTile.error_reason).not.toContain('/data/artifacts');

    const insightsTile = result.phases.find((p) => p.id === 'erkenntnisse')!;
    expect(insightsTile.source_kind).toBe('error');
    expect(insightsTile.error_reason).toBe('strict-load-failed');
    expect(insightsTile.error_reason).not.toContain('/var/run');
  });

  it('isolates failures so one broken controller does not break the others', async () => {
    vi.spyOn(anatomyCtrl, 'getAnatomyData').mockRejectedValue(new Error('anatomy boom'));
    vi.spyOn(insightsCtrl, 'getInsightsData').mockResolvedValue({
      insights: { ts: '', topics: [], questions: [], deltas: [] } as never,
      view_meta: {
        source_kind: 'missing',
        missing_reason: 'enoent',
        is_strict: false,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        freshness_source: 'unknown',
        freshness_degraded: false,
        stale_after_hours: 30,
        uncertainty: null,
        observatory_ref: null,
      },
    });
    vi.spyOn(timelineCtrl, 'getTimelineData').mockRejectedValue(new Error('timeline boom'));
    vi.spyOn(reflexionCtrl, 'getReflexionData').mockResolvedValue({
      reflexion: null,
      view_meta: {
        source_kind: 'missing',
        missing_reason: 'enoent',
        is_strict: false,
        data_timestamp: null,
        data_age_minutes: null,
        freshness_state: 'unknown',
        freshness_source: 'unknown',
        stale_after_hours: 24,
      },
    });

    const result = await getDashboardData();

    expect(result.phases).toHaveLength(5);

    const anatomyTile = result.phases.find((p) => p.id === 'anatomie')!;
    expect(anatomyTile.source_kind).toBe('error');
    expect(anatomyTile.error_reason).toBe('controller-load-failed');

    const timelineTile = result.phases.find((p) => p.id === 'zeitachse')!;
    expect(timelineTile.source_kind).toBe('error');
    expect(timelineTile.error_reason).toBe('controller-load-failed');

    // Unaffected tiles still render their proper "missing" state.
    const insightsTile = result.phases.find((p) => p.id === 'erkenntnisse')!;
    expect(insightsTile.source_kind).toBe('missing');
    expect(insightsTile.error_reason).toBeNull();

    const reflexionTile = result.phases.find((p) => p.id === 'reflexion')!;
    expect(reflexionTile.source_kind).toBe('missing');
  });
});
