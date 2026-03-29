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
});
