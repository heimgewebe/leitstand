import { describe, it, expect } from 'vitest';
import { renderDailyDigestMarkdown } from '../src/renderMarkdown.js';
import type { DailyDigest } from '../src/digest.js';

describe('renderMarkdown', () => {
  it('should render a complete digest', () => {
    const digest: DailyDigest = {
      date: '2025-12-05',
      topics: [
        { topic: 'TypeScript', count: 10 },
        { topic: 'Testing', count: 5 },
      ],
      questions: ['How to test?'],
      deltas: ['Added feature'],
      events: [
        {
          timestamp: '2025-12-05T10:00:00Z',
          kind: 'ci.success',
          label: 'ci.success heimgewebe/wgx',
        },
      ],
      fleetHealth: {
        available: true,
        timestamp: '2025-12-05T12:00:00Z',
        totalRepos: 5,
        ok: 3,
        warn: 1,
        fail: 1,
      },
    };
    
    const markdown = renderDailyDigestMarkdown(digest);
    
    expect(markdown).toContain('# Heimgewebe Digest – 2025-12-05');
    expect(markdown).toContain('## Top Topics');
    expect(markdown).toContain('**TypeScript** (10)');
    expect(markdown).toContain('**Testing** (5)');
    expect(markdown).toContain('## Key Events (last 24h)');
    expect(markdown).toContain('ci.success heimgewebe/wgx');
    expect(markdown).toContain('## Fleet Health');
    expect(markdown).toContain('**Total Repositories:** 5');
    expect(markdown).toContain('✅ OK: 3');
    expect(markdown).toContain('⚠️  Warning: 1');
    expect(markdown).toContain('❌ Failed: 1');
  });
  
  it('should handle empty topics', () => {
    const digest: DailyDigest = {
      date: '2025-12-05',
      topics: [],
      questions: [],
      deltas: [],
      events: [],
      fleetHealth: {
        available: false,
        totalRepos: 0,
        ok: 0,
        warn: 0,
        fail: 0,
      },
    };
    
    const markdown = renderDailyDigestMarkdown(digest);
    
    expect(markdown).toContain('_No topics available_');
    expect(markdown).toContain('_No events recorded_');
    expect(markdown).toContain('_No metrics available_');
  });
  
  it('should render questions section if present', () => {
    const digest: DailyDigest = {
      date: '2025-12-05',
      topics: [],
      questions: ['How to test?', 'What is the best practice?'],
      deltas: [],
      events: [],
      fleetHealth: {
        available: false,
        totalRepos: 0,
        ok: 0,
        warn: 0,
        fail: 0,
      },
    };
    
    const markdown = renderDailyDigestMarkdown(digest);
    
    expect(markdown).toContain('### Questions');
    expect(markdown).toContain('How to test?');
    expect(markdown).toContain('What is the best practice?');
  });
  
  it('should render deltas section if present', () => {
    const digest: DailyDigest = {
      date: '2025-12-05',
      topics: [],
      questions: [],
      deltas: ['Added new feature', 'Updated dependencies'],
      events: [],
      fleetHealth: {
        available: false,
        totalRepos: 0,
        ok: 0,
        warn: 0,
        fail: 0,
      },
    };
    
    const markdown = renderDailyDigestMarkdown(digest);
    
    expect(markdown).toContain('### Changes Detected');
    expect(markdown).toContain('Added new feature');
    expect(markdown).toContain('Updated dependencies');
  });
});
