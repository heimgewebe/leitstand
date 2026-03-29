import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAnatomyData } from '../../src/controllers/anatomy.js';
import { resetEnvConfig } from '../../src/config.js';
import { loadWithFallback } from '../../src/utils/loader.js';
import { loadLatestMetrics } from '../../src/metrics.js';

vi.mock('../../src/utils/loader.js', () => ({
  loadWithFallback: vi.fn(),
}));

vi.mock('../../src/metrics.js', () => ({
  loadLatestMetrics: vi.fn(),
}));

describe('getAnatomyData controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetEnvConfig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return anatomy data from fixture fallback', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        schema: 'anatomy.snapshot.v1',
        generated_at: '2026-03-28T00:00:00Z',
        source: 'fixture',
        nodes: [{ id: 'leitstand', label: 'Leitstand', role: 'UI', achse: 'interface', description: 'test' }],
        edges: [],
        achsen: { interface: { label: 'Interface', color: '#3B82F6', description: 'UI' } },
      },
      source: 'fixture',
      reason: 'enoent',
    });
    vi.mocked(loadLatestMetrics).mockResolvedValue(null);

    const result = await getAnatomyData();

    expect(result.anatomy).not.toBeNull();
    expect(result.anatomy!.nodes).toHaveLength(1);
    expect(result.anatomy!.nodes[0].id).toBe('leitstand');
    expect(result.view_meta.source_kind).toBe('fixture');
    expect(result.view_meta.schema_valid).toBe(true);
    expect(result.health.source_kind).toBe('missing');
  });

  it('should mark schema_valid=false on schema mismatch without throwing', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        schema: 'anatomy.snapshot.v2',
        generated_at: '2026-03-28T00:00:00Z',
        source: 'artifact',
        nodes: [{ id: 'x', label: 'X', role: 'x', achse: 'x', description: 'x' }],
        edges: [],
        achsen: {},
      },
      source: 'artifact',
      reason: 'ok',
    });
    vi.mocked(loadLatestMetrics).mockResolvedValue(null);

    const result = await getAnatomyData();

    expect(result.anatomy).not.toBeNull();
    expect(result.view_meta.schema_valid).toBe(false);
    // Controller should warn, not throw
    expect(console.warn).toHaveBeenCalled();
    expect(vi.mocked(console.warn).mock.calls.some((args) =>
      String(args[0]).includes('[Anatomy] Schema mismatch')
    )).toBe(true);
  });

  it('should return null anatomy when data is missing', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });
    vi.mocked(loadLatestMetrics).mockResolvedValue(null);

    const result = await getAnatomyData();

    expect(result.anatomy).toBeNull();
    expect(result.view_meta.source_kind).toBe('missing');
    expect(result.view_meta.schema_valid).toBe(false);
    expect(result.view_meta.freshness_state).toBe('unknown');
    expect(result.view_meta.data_age_minutes).toBeNull();
  });

  it('should mark freshness as stale when generated_at is older than threshold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

    try {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: {
          schema: 'anatomy.snapshot.v1',
          generated_at: '2026-03-20T12:00:00.000Z',
          source: 'artifact',
          nodes: [{ id: 'leitstand', label: 'Leitstand', role: 'UI', achse: 'interface', description: 'test' }],
          edges: [],
          achsen: { interface: { label: 'Interface', color: '#3B82F6', description: 'UI' } },
        },
        source: 'artifact',
        reason: 'ok',
      });
      vi.mocked(loadLatestMetrics).mockResolvedValue(null);

      const result = await getAnatomyData();

      expect(result.view_meta.freshness_state).toBe('stale');
      expect(result.view_meta.data_age_minutes).toBe(9 * 24 * 60);
      expect(result.view_meta.stale_after_hours).toBe(72);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should call loadWithFallback with correct paths and name', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });
    vi.mocked(loadLatestMetrics).mockResolvedValue(null);

    await getAnatomyData();

    expect(loadWithFallback).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(loadWithFallback).mock.calls[0];
    expect(callArgs[0]).toContain('anatomy.snapshot.json');
    expect(callArgs[1]).toContain('anatomy.snapshot.json');
    expect(callArgs[2]).toMatchObject({ name: 'Anatomy' });
  });

  it('should reject structurally invalid data (missing nodes) and return null anatomy', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        schema: 'anatomy.snapshot.v1',
        generated_at: '2026-03-28T00:00:00Z',
        source: 'fixture',
        // nodes is empty → structural validation fails
        nodes: [],
        edges: [],
        achsen: {},
      },
      source: 'fixture',
      reason: 'enoent',
    });
    vi.mocked(loadLatestMetrics).mockResolvedValue(null);

    const result = await getAnatomyData();

    expect(result.anatomy).toBeNull();
    expect(result.view_meta.schema_valid).toBe(false);
    expect(result.view_meta.missing_reason).toContain('invalid_structure');
    expect(console.warn).toHaveBeenCalled();
  });

  it('should expose health overlay from metrics artifact', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: {
        schema: 'anatomy.snapshot.v1',
        generated_at: '2026-03-28T00:00:00Z',
        source: 'artifact',
        nodes: [{ id: 'metarepo', label: 'Metarepo', role: 'Gov', achse: 'governance', description: 'test' }],
        edges: [],
        achsen: { governance: { label: 'Governance', color: '#3B82F6', description: 'Gov' } },
      },
      source: 'artifact',
      reason: 'ok',
    });

    vi.mocked(loadLatestMetrics).mockResolvedValueOnce({
      timestamp: '2026-03-29T08:00:00.000Z',
      repoCount: 2,
      status: { ok: 99, warn: 99, fail: 99 },
      repos: [
        { name: 'heimgewebe/metarepo', status: 'ok' },
        { name: 'heimgewebe/wgx', status: 'warn' },
      ],
    });

    const result = await getAnatomyData();

    expect(result.health.source_kind).toBe('artifact');
    expect(result.health.totals.ok).toBe(1);
    expect(result.health.totals.warn).toBe(1);
    expect(result.health.totals.fail).toBe(0);
    expect(result.health.totals.unknown).toBe(0);
    expect(result.health.by_repo.metarepo).toBe('ok');
    expect(result.health.by_repo.wgx).toBe('warn');
  });

  it('should compute health freshness_state=fresh when metrics timestamp is recent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));
    try {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: null,
        source: 'missing',
        reason: 'enoent',
      });
      vi.mocked(loadLatestMetrics).mockResolvedValueOnce({
        timestamp: '2026-03-29T10:00:00.000Z', // 2 h ago — well within 24h
        repoCount: 1,
        status: { ok: 1, warn: 0, fail: 0 },
        repos: [{ name: 'leitstand', status: 'ok' }],
      });

      const result = await getAnatomyData();

      expect(result.health.freshness_state).toBe('fresh');
      expect(result.health.data_age_minutes).toBe(120);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should compute health freshness_state=stale when metrics timestamp is older than threshold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));
    try {
      vi.mocked(loadWithFallback).mockResolvedValue({
        data: null,
        source: 'missing',
        reason: 'enoent',
      });
      vi.mocked(loadLatestMetrics).mockResolvedValueOnce({
        timestamp: '2026-03-28T10:00:00.000Z', // 26 h ago — exceeds 24h threshold
        repoCount: 1,
        status: { ok: 1, warn: 0, fail: 0 },
        repos: [{ name: 'leitstand', status: 'ok' }],
      });

      const result = await getAnatomyData();

      expect(result.health.freshness_state).toBe('stale');
      expect(result.health.data_age_minutes).toBe(26 * 60);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should compute health freshness_state=unknown when metrics timestamp is absent', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });
    vi.mocked(loadLatestMetrics).mockResolvedValueOnce({
      timestamp: undefined,
      repoCount: 1,
      status: { ok: 1, warn: 0, fail: 0 },
      repos: [{ name: 'leitstand', status: 'ok' }],
    });

    const result = await getAnatomyData();

    expect(result.health.freshness_state).toBe('unknown');
    expect(result.health.data_age_minutes).toBeNull();
  });

  it('should fall back to fixture metrics for health in non-strict mode when artifact metrics are absent', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });
    // First call (artifact metrics dir) → null; second call (fixture metrics dir) → data
    vi.mocked(loadLatestMetrics)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        timestamp: '2026-03-29T10:00:00.000Z',
        repoCount: 1,
        status: { ok: 1, warn: 0, fail: 0 },
        repos: [{ name: 'chronik', status: 'ok' }],
      });

    const result = await getAnatomyData();

    expect(result.health.source_kind).toBe('fixture');
    expect(result.health.by_repo['chronik']).toBe('ok');
    expect(result.health.totals.ok).toBe(1);
  });

  it('should not fall back to fixture metrics in strict mode', async () => {
    vi.stubEnv('LEITSTAND_STRICT', '1');
    resetEnvConfig();

    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });
    // Artifact metrics → null; fixture should never be tried in strict mode
    vi.mocked(loadLatestMetrics).mockResolvedValueOnce(null);

    const result = await getAnatomyData();

    expect(result.health.source_kind).toBe('missing');
    expect(result.health.missing_reason).toBe('health_metrics_missing_strict');
    // loadLatestMetrics should only have been called once (no fixture fallback)
    expect(vi.mocked(loadLatestMetrics)).toHaveBeenCalledTimes(1);
  });

  it('should derive totals from metrics.status aggregate when repos array is empty', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });
    vi.mocked(loadLatestMetrics).mockResolvedValueOnce({
      timestamp: '2026-03-29T10:00:00.000Z',
      repoCount: 5,
      status: { ok: 3, warn: 1, fail: 1 },
      repos: [], // no per-repo entries → should fall back to aggregate
    });

    const result = await getAnatomyData();

    expect(result.health.source_kind).toBe('artifact');
    expect(result.health.totals.ok).toBe(3);
    expect(result.health.totals.warn).toBe(1);
    expect(result.health.totals.fail).toBe(1);
    expect(result.health.totals.unknown).toBe(0);
    expect(Object.keys(result.health.by_repo)).toHaveLength(0);
  });

  it('should still try fixture fallback in non-strict mode when artifact metrics loader throws', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });
    // First call (artifact dir) → throws (e.g. corrupted JSON inside the dir)
    // Second call (fixture dir) → resolves with real data
    vi.mocked(loadLatestMetrics)
      .mockRejectedValueOnce(new Error('Failed to load metrics snapshot from /artifact/metrics/2026-03-29.json: Unexpected token'))
      .mockResolvedValueOnce({
        timestamp: '2026-03-29T10:00:00.000Z',
        repoCount: 1,
        status: { ok: 1, warn: 0, fail: 0 },
        repos: [{ name: 'leitstand', status: 'ok' }],
      });

    const result = await getAnatomyData();

    // Fixture fallback must have been used despite artifact throw
    expect(result.health.source_kind).toBe('fixture');
    expect(result.health.totals.ok).toBe(1);
      // missing_reason must reflect the actual artifact failure, not the generic 'artifact_missing'
      expect(result.health.missing_reason).toBe('health_metrics_invalid');
    expect(vi.mocked(loadLatestMetrics)).toHaveBeenCalledTimes(2);
  });

  it('should return classified error and not try fixture when artifact throws in strict mode', async () => {
    vi.stubEnv('LEITSTAND_STRICT', '1');
    resetEnvConfig();

    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });
    vi.mocked(loadLatestMetrics).mockRejectedValueOnce(
      new Error('Failed to load metrics snapshot from /artifact/metrics/2026-03-29.json: Unexpected token')
    );

    const result = await getAnatomyData();

    expect(result.health.source_kind).toBe('missing');
    expect(result.health.missing_reason).toBe('health_metrics_invalid');
    // Only artifact call — no fixture attempt in strict mode
    expect(vi.mocked(loadLatestMetrics)).toHaveBeenCalledTimes(1);
  });
});
