import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadDailyInsights, sanitizeDailyInsights } from '../src/insights.js';

describe('insights', () => {
  let testDir: string;
  
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-insights-'));
  });
  
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  
  it('should load valid insights', async () => {
    const insightsData = {
      ts: '2025-12-05',
      topics: [['TypeScript', 10], ['Testing', 5]],
      questions: ['How to test?'],
      deltas: ['Added new feature'],
    };
    
    const path = join(testDir, 'today.json');
    await writeFile(path, JSON.stringify(insightsData), 'utf-8');
    
    const insights = await loadDailyInsights(path);
    
    expect(insights.ts).toBe('2025-12-05');
    expect(insights.topics).toHaveLength(2);
    expect(insights.topics[0]).toEqual(['TypeScript', 10]);
    expect(insights.questions).toHaveLength(1);
    expect(insights.deltas).toHaveLength(1);
  });
  
  it('should handle missing optional fields', async () => {
    const insightsData = {
      ts: '2025-12-05',
    };
    
    const path = join(testDir, 'today.json');
    await writeFile(path, JSON.stringify(insightsData), 'utf-8');
    
    const insights = await loadDailyInsights(path);
    
    expect(insights.ts).toBe('2025-12-05');
    expect(insights.topics).toEqual([]);
    expect(insights.questions).toEqual([]);
    expect(insights.deltas).toEqual([]);
  });
  
  it('should reject invalid insights', async () => {
    const invalidData = {
      // Missing ts field
      topics: [],
    };
    
    const path = join(testDir, 'today.json');
    await writeFile(path, JSON.stringify(invalidData), 'utf-8');
    
    await expect(loadDailyInsights(path)).rejects.toThrow();
  });
  
  it('should reject invalid JSON', async () => {
    const path = join(testDir, 'today.json');
    await writeFile(path, '{ invalid json }', 'utf-8');
    
    await expect(loadDailyInsights(path)).rejects.toThrow('Invalid JSON');
  });

  it('should sanitize malformed optional fields and clamp uncertainty', () => {
    const insights = sanitizeDailyInsights({
      ts: '2025-12-05',
      topics: [['TypeScript', 0.7], ['Broken'], ['NaN', Number.NaN]],
      questions: ['How to test?', 42],
      deltas: ['Added new feature', { text: 'broken' }],
      data_refs: {
        topics: {
          '0': { refs: ['event:123', 'obs:alpha'], drilldown_url: '/timeline?focus=123' },
          bad: { refs: ['ignored'] },
        },
        questions: {
          '0': { refs: ['metric:cpu'], drilldown_url: 'javascript:alert(1)' },
          '1': { refs: ['metric:ram'], drilldown_url: '//evil.example/phish' },
        },
      },
      metadata: {
        generated_at: '2025-12-05T10:00:00.000Z',
        uncertainty: 1.4,
        observatory_ref: 'obs-123',
      },
    });

    expect(insights).not.toBeNull();
    expect(insights?.topics).toEqual([['TypeScript', 0.7]]);
    expect(insights?.questions).toEqual(['How to test?']);
    expect(insights?.deltas).toEqual(['Added new feature']);
    expect(insights?.data_refs?.topics).toEqual({
      '0': { refs: ['event:123', 'obs:alpha'], drilldown_url: '/timeline?focus=123' },
    });
    expect(insights?.data_refs?.questions).toEqual({
      '0': { refs: ['metric:cpu'], drilldown_url: undefined },
      '1': { refs: ['metric:ram'], drilldown_url: undefined },
    });
    expect(insights?.metadata?.uncertainty).toBeUndefined();
    expect(insights?.metadata?.observatory_ref).toBe('obs-123');
  });

  it('should only allow internal absolute-path drilldown URLs', () => {
    const insights = sanitizeDailyInsights({
      ts: '2025-12-05',
      topics: [['Topic', 0.5]],
      questions: ['Q1'],
      deltas: ['D1'],
      data_refs: {
        topics: {
          '0': { refs: ['topic:ok'], drilldown_url: '/timeline?focus=123' },
          '1': { refs: ['topic:blocked'], drilldown_url: 'https://evil.example' },
          '2': { refs: ['topic:protocol-relative'], drilldown_url: '//evil.example/path' },
        },
      },
    });

    expect(insights).not.toBeNull();
    expect(insights?.data_refs?.topics).toEqual({
      '0': { refs: ['topic:ok'], drilldown_url: '/timeline?focus=123' },
      '1': { refs: ['topic:blocked'], drilldown_url: undefined },
      '2': { refs: ['topic:protocol-relative'], drilldown_url: undefined },
    });
  });

  it('should ignore invalid data_refs sections and entries', () => {
    const insights = sanitizeDailyInsights({
      ts: '2025-12-05',
      topics: [['Topic', 0.5]],
      questions: ['Q1'],
      deltas: ['D1'],
      data_refs: {
        topics: {
          '0': { refs: [] },
          '1': { refs: ['ok'] },
        },
        deltas: 'invalid',
      },
    });

    expect(insights).not.toBeNull();
    expect(insights?.data_refs?.topics).toEqual({
      '1': { refs: ['ok'], drilldown_url: undefined },
    });
    expect(insights?.data_refs?.deltas).toBeUndefined();
  });
});
