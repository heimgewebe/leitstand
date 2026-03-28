import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTimelineData } from '../../src/controllers/timeline.js';
import { resetEnvConfig } from '../../src/config.js';
import { readdir, readFile } from 'fs/promises';

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

describe('getTimelineData controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetEnvConfig();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Simulate: chronik dir ENOENT, chronik fixture ENOENT,
   * but events.json fixture exists with known timestamps.
   */
  it('should filter JSON fixture events by time window (hoursBack)', async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();

    const fixtureEvents = [
      { timestamp: oneHourAgo, kind: 'ci.pass', repo: 'a' },
      { timestamp: fiveHoursAgo, kind: 'ci.fail', repo: 'b' },
      { timestamp: threeDaysAgo, kind: 'old.event', repo: 'c' },
    ];

    // Both readdir calls fail (no chronik directories)
    vi.mocked(readdir).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    // readFile succeeds for the events.json fixture path
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('events.json')) {
        return JSON.stringify(fixtureEvents) as unknown as Buffer;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    // hoursBack=6 → should include oneHourAgo and fiveHoursAgo, but not threeDaysAgo
    const result = await getTimelineData(6);

    expect(result.view_meta.source_kind).toBe('fixture');
    expect(result.events).toHaveLength(2);
    // Should be newest first
    expect(result.events[0].kind).toBe('ci.pass');
    expect(result.events[1].kind).toBe('ci.fail');
  });

  it('should return no events when hoursBack excludes all fixture events', async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

    const fixtureEvents = [
      { timestamp: threeDaysAgo, kind: 'old.event', repo: 'x' },
    ];

    vi.mocked(readdir).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    vi.mocked(readFile).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('events.json')) {
        return JSON.stringify(fixtureEvents) as unknown as Buffer;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    // hoursBack=1 → threeDaysAgo is outside window
    const result = await getTimelineData(1);

    // Should have zero events (filtered out), returned as fixture with empty array
    // The controller returns empty fixture results but continues to the 'missing' path
    // since the empty array is not > 0 on the JSONL path but the JSON fixture path
    // returns regardless. Let's check:
    expect(result.events).toHaveLength(0);
  });

  it('should respect maxEvents limit after filtering', async () => {
    const now = Date.now();
    const fixtureEvents = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(now - i * 60 * 1000).toISOString(),
      kind: 'event.' + i,
      repo: 'test',
    }));

    vi.mocked(readdir).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    vi.mocked(readFile).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('events.json')) {
        return JSON.stringify(fixtureEvents) as unknown as Buffer;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await getTimelineData(48, 3);

    expect(result.events.length).toBeLessThanOrEqual(3);
    expect(result.view_meta.total_loaded).toBe(3);
    // Newest first
    expect(result.events[0].kind).toBe('event.0');
  });

  it('should sort events newest-first', async () => {
    const now = Date.now();
    const oldest = new Date(now - 3 * 60 * 60 * 1000).toISOString();
    const middle = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const newest = new Date(now - 1 * 60 * 60 * 1000).toISOString();

    // Intentionally unordered
    const fixtureEvents = [
      { timestamp: middle, kind: 'middle', repo: 'a' },
      { timestamp: oldest, kind: 'oldest', repo: 'a' },
      { timestamp: newest, kind: 'newest', repo: 'a' },
    ];

    vi.mocked(readdir).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    vi.mocked(readFile).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('events.json')) {
        return JSON.stringify(fixtureEvents) as unknown as Buffer;
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const result = await getTimelineData(48);

    expect(result.events[0].kind).toBe('newest');
    expect(result.events[1].kind).toBe('middle');
    expect(result.events[2].kind).toBe('oldest');
  });
});
