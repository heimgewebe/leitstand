import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAnatomyData } from '../../src/controllers/anatomy.js';
import { resetEnvConfig } from '../../src/config.js';
import { loadWithFallback } from '../../src/utils/loader.js';

vi.mock('../../src/utils/loader.js', () => ({
  loadWithFallback: vi.fn(),
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

    const result = await getAnatomyData();

    expect(result.anatomy).not.toBeNull();
    expect(result.anatomy!.nodes).toHaveLength(1);
    expect(result.anatomy!.nodes[0].id).toBe('leitstand');
    expect(result.view_meta.source_kind).toBe('fixture');
    expect(result.view_meta.schema_valid).toBe(true);
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

    const result = await getAnatomyData();

    expect(result.anatomy).toBeNull();
    expect(result.view_meta.source_kind).toBe('missing');
    expect(result.view_meta.schema_valid).toBe(false);
  });

  it('should call loadWithFallback with correct paths and name', async () => {
    vi.mocked(loadWithFallback).mockResolvedValue({
      data: null,
      source: 'missing',
      reason: 'enoent',
    });

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

    const result = await getAnatomyData();

    expect(result.anatomy).toBeNull();
    expect(result.view_meta.schema_valid).toBe(false);
    expect(result.view_meta.missing_reason).toContain('invalid_structure');
    expect(console.warn).toHaveBeenCalled();
  });
});
