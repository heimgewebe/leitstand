import { describe, it, expect } from 'vitest';
import { buildDailyDigest } from '../src/digest.js';
import type { DailyInsights } from '../src/insights.js';
import type { EventLine } from '../src/events.js';
import type { MetricsSnapshot } from '../src/metrics.js';

describe('digest', () => {
  it('should build digest from all data sources', () => {
    const insights: DailyInsights = {
      ts: '2025-12-05',
      topics: [['TypeScript', 10], ['Testing', 5]],
      questions: ['How to test?'],
      deltas: ['Added feature'],
    };
    
    const events: EventLine[] = [
      {
        timestamp: '2025-12-05T10:00:00Z',
        kind: 'ci.success',
        repo: 'heimgewebe/wgx',
      },
      {
        timestamp: '2025-12-05T09:00:00Z',
        kind: 'ci.failure',
        repo: 'heimgewebe/semantAH',
        job: 'build',
        severity: 'high',
      },
    ];
    
    const metrics: MetricsSnapshot = {
      timestamp: '2025-12-05T12:00:00Z',
      repoCount: 5,
      status: { ok: 3, warn: 1, fail: 1 },
    };
    
    const digest = buildDailyDigest('2025-12-05', insights, events, metrics);
    
    expect(digest.date).toBe('2025-12-05');
    expect(digest.topics).toHaveLength(2);
    expect(digest.topics[0]).toEqual({ topic: 'TypeScript', count: 10 });
    expect(digest.events).toHaveLength(2);
    expect(digest.events[0].kind).toBe('ci.success');
    expect(digest.fleetHealth.available).toBe(true);
    expect(digest.fleetHealth.totalRepos).toBe(5);
  });
  
  it('should handle missing insights', () => {
    const digest = buildDailyDigest('2025-12-05', null, [], null);
    
    expect(digest.topics).toEqual([]);
    expect(digest.questions).toEqual([]);
    expect(digest.deltas).toEqual([]);
  });
  
  it('should handle missing metrics', () => {
    const digest = buildDailyDigest('2025-12-05', null, [], null);
    
    expect(digest.fleetHealth.available).toBe(false);
    expect(digest.fleetHealth.totalRepos).toBe(0);
  });
  
  it('should limit events to maxEvents', () => {
    const events: EventLine[] = Array.from({ length: 50 }, (_, i) => ({
      timestamp: `2025-12-05T${String(i).padStart(2, '0')}:00:00Z`,
      kind: 'test.event',
    }));
    
    const digest = buildDailyDigest('2025-12-05', null, events, null, 10);
    
    expect(digest.events).toHaveLength(10);
  });
  
  it('should create proper event labels', () => {
    const events: EventLine[] = [
      {
        timestamp: '2025-12-05T10:00:00Z',
        kind: 'ci.failure',
        repo: 'heimgewebe/wgx',
        job: 'test',
        severity: 'high',
      },
    ];
    
    const digest = buildDailyDigest('2025-12-05', null, events, null);
    
    expect(digest.events[0].label).toContain('ci.failure');
    expect(digest.events[0].label).toContain('heimgewebe/wgx');
    expect(digest.events[0].label).toContain('test');
    expect(digest.events[0].label).toContain('[high]');
  });
});
