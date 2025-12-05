import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadDailyInsights } from '../src/insights.js';

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
});
