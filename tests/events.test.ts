import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadRecentEvents } from '../src/events.js';

describe('events', () => {
  let testDir: string;
  
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-events-'));
  });
  
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  
  it('should load events within time window', async () => {
    const events = [
      { timestamp: '2025-12-05T10:00:00Z', kind: 'ci.success', repo: 'test' },
      { timestamp: '2025-12-05T12:00:00Z', kind: 'ci.failure', repo: 'test2' },
      { timestamp: '2025-12-04T10:00:00Z', kind: 'deploy.success', repo: 'test3' },
    ];
    
    const path = join(testDir, 'events.jsonl');
    await writeFile(path, events.map(e => JSON.stringify(e)).join('\n'), 'utf-8');
    
    const since = new Date('2025-12-05T00:00:00Z');
    const until = new Date('2025-12-06T00:00:00Z');
    
    const loaded = await loadRecentEvents(testDir, since, until);
    
    expect(loaded).toHaveLength(2);
    expect(loaded[0].timestamp).toBe('2025-12-05T12:00:00Z'); // Newest first
    expect(loaded[1].timestamp).toBe('2025-12-05T10:00:00Z');
  });
  
  it('should handle multiple JSONL files', async () => {
    const events1 = [
      { timestamp: '2025-12-05T10:00:00Z', kind: 'ci.success', repo: 'test1' },
    ];
    
    const events2 = [
      { timestamp: '2025-12-05T11:00:00Z', kind: 'ci.failure', repo: 'test2' },
    ];
    
    await writeFile(join(testDir, 'events1.jsonl'), events1.map(e => JSON.stringify(e)).join('\n'), 'utf-8');
    await writeFile(join(testDir, 'events2.jsonl'), events2.map(e => JSON.stringify(e)).join('\n'), 'utf-8');
    
    const since = new Date('2025-12-05T00:00:00Z');
    const until = new Date('2025-12-06T00:00:00Z');
    
    const loaded = await loadRecentEvents(testDir, since, until);
    
    expect(loaded).toHaveLength(2);
  });
  
  it('should skip invalid lines', async () => {
    const content = `
{"timestamp":"2025-12-05T10:00:00Z","kind":"ci.success","repo":"test"}
invalid json line
{"timestamp":"2025-12-05T11:00:00Z","kind":"ci.failure","repo":"test2"}

{"missing":"kind"}
`;
    
    const path = join(testDir, 'events.jsonl');
    await writeFile(path, content, 'utf-8');
    
    const since = new Date('2025-12-05T00:00:00Z');
    const until = new Date('2025-12-06T00:00:00Z');
    
    const loaded = await loadRecentEvents(testDir, since, until);
    
    expect(loaded).toHaveLength(2); // Only valid events
  });
  
  it('should handle empty directory', async () => {
    const since = new Date('2025-12-05T00:00:00Z');
    const until = new Date('2025-12-06T00:00:00Z');
    
    const loaded = await loadRecentEvents(testDir, since, until);
    
    expect(loaded).toEqual([]);
  });
});
