import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig } from '../src/config.js';
import { loadDailyInsights } from '../src/insights.js';
import { loadRecentEvents } from '../src/events.js';
import { loadLatestMetrics } from '../src/metrics.js';
import { buildDailyDigest } from '../src/digest.js';
import { renderDailyDigestMarkdown } from '../src/renderMarkdown.js';

describe('integration', () => {
  let testDir: string;
  let insightsDir: string;
  let eventsDir: string;
  let metricsDir: string;
  let outputDir: string;
  
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-integration-'));
    insightsDir = join(testDir, 'insights');
    eventsDir = join(testDir, 'events');
    metricsDir = join(testDir, 'metrics');
    outputDir = join(testDir, 'digests', 'daily');
    
    await mkdir(insightsDir, { recursive: true });
    await mkdir(eventsDir, { recursive: true });
    await mkdir(metricsDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    
    // Create test fixtures
    const insights = {
      ts: '2025-12-05',
      topics: [['TypeScript', 15], ['Testing', 10]],
      questions: ['How to improve coverage?'],
      deltas: ['Added leitstand'],
    };
    
    const events = [
      { timestamp: '2025-12-05T10:00:00Z', kind: 'ci.success', repo: 'heimgewebe/wgx' },
      { timestamp: '2025-12-05T09:00:00Z', kind: 'ci.failure', repo: 'heimgewebe/semantAH', severity: 'high' },
    ];
    
    const metrics = {
      timestamp: '2025-12-05T12:00:00Z',
      repoCount: 5,
      status: { ok: 3, warn: 1, fail: 1 },
    };
    
    await writeFile(join(insightsDir, 'today.json'), JSON.stringify(insights), 'utf-8');
    await writeFile(join(eventsDir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n'), 'utf-8');
    await writeFile(join(metricsDir, 'metrics.json'), JSON.stringify(metrics), 'utf-8');
    
    // Create config
    const config = {
      paths: {
        semantah: { todayInsights: join(insightsDir, 'today.json') },
        chronik: { dataDir: eventsDir },
        wgx: { metricsDir: metricsDir },
      },
      output: { dir: outputDir },
    };
    
    await writeFile(join(testDir, 'config.json'), JSON.stringify(config), 'utf-8');
  });
  
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  
  it('should generate complete daily digest', async () => {
    const configPath = join(testDir, 'config.json');
    const config = await loadConfig(configPath);
    
    const insights = await loadDailyInsights(config.paths.semantah.todayInsights);
    const since = new Date('2025-12-05T00:00:00Z');
    const until = new Date('2025-12-06T00:00:00Z');
    const events = await loadRecentEvents(config.paths.chronik.dataDir, since, until);
    const metrics = await loadLatestMetrics(config.paths.wgx.metricsDir);
    
    const digest = buildDailyDigest('2025-12-05', insights, events, metrics);
    const markdown = renderDailyDigestMarkdown(digest);
    
    // Write outputs
    const markdownPath = join(outputDir, '2025-12-05.md');
    const jsonPath = join(outputDir, '2025-12-05.json');
    
    await writeFile(markdownPath, markdown, 'utf-8');
    await writeFile(jsonPath, JSON.stringify(digest, null, 2), 'utf-8');
    
    // Verify markdown file
    const markdownContent = await readFile(markdownPath, 'utf-8');
    expect(markdownContent).toContain('# Heimgewebe Digest – 2025-12-05');
    expect(markdownContent).toContain('## Top Topics');
    expect(markdownContent).toContain('TypeScript');
    expect(markdownContent).toContain('## Key Events');
    expect(markdownContent).toContain('ci.success');
    expect(markdownContent).toContain('## Fleet Health');
    expect(markdownContent).toContain('Total Repositories');
    
    // Verify JSON file
    const jsonContent = await readFile(jsonPath, 'utf-8');
    const parsedDigest = JSON.parse(jsonContent);
    expect(parsedDigest.date).toBe('2025-12-05');
    expect(parsedDigest.topics).toHaveLength(2);
    expect(parsedDigest.events).toHaveLength(2);
    expect(parsedDigest.fleetHealth.available).toBe(true);
  });
  
  it('should handle missing data sources gracefully', async () => {
    // Remove insights file to test partial data scenario
    await rm(join(insightsDir, 'today.json'));
    
    const configPath = join(testDir, 'config.json');
    const config = await loadConfig(configPath);
    
    let insights = null;
    try {
      insights = await loadDailyInsights(config.paths.semantah.todayInsights);
    } catch {
      // Expected to fail
    }
    
    const since = new Date('2025-12-05T00:00:00Z');
    const until = new Date('2025-12-06T00:00:00Z');
    const events = await loadRecentEvents(config.paths.chronik.dataDir, since, until);
    const metrics = await loadLatestMetrics(config.paths.wgx.metricsDir);
    
    const digest = buildDailyDigest('2025-12-05', insights, events, metrics);
    const markdown = renderDailyDigestMarkdown(digest);
    
    expect(markdown).toContain('# Heimgewebe Digest – 2025-12-05');
    expect(markdown).toContain('_No topics available_');
    expect(digest.topics).toEqual([]);
  });
});
