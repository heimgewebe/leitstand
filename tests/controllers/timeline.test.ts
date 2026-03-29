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

    // JSON fixture path always returns (even with 0 filtered events),
    // so source_kind is 'fixture' with an empty events array.
    expect(result.events).toHaveLength(0);
  });

  it('should respect maxEvents limit after filtering', async () => {
    const now = Date.now();
    // Offset by (i + 1) minutes so the newest event (event.0) is 1 min in the
    // past and never touches the exclusive upper boundary (untilIso = new Date()).
    const fixtureEvents = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(now - (i + 1) * 60 * 1000).toISOString(),
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

  it('should exclude events at exactly the upper boundary (untilIso)', async () => {
    // Fix system time so we know the exact value of untilIso inside the controller.
    const fixedNow = new Date('2026-01-01T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    try {
      const atBoundary = fixedNow.toISOString(); // === untilIso
      const justBefore = new Date(fixedNow.getTime() - 1).toISOString(); // 1 ms before

      const fixtureEvents = [
        { timestamp: atBoundary, kind: 'at.boundary', repo: 'test' },
        { timestamp: justBefore, kind: 'just.before', repo: 'test' },
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

      // Window is [since, until) — the upper boundary is exclusive.
      expect(result.events.find((e) => e.kind === 'at.boundary')).toBeUndefined();
      // 1 ms before the boundary must be included.
      expect(result.events.find((e) => e.kind === 'just.before')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('should return source_kind chronik with empty events when chronik dir exists but window is empty', async () => {
    // readdir succeeds but returns no .jsonl files (empty chronik dir)
    vi.mocked(readdir).mockResolvedValueOnce([] as Awaited<ReturnType<typeof readdir>>);

    const result = await getTimelineData(48);

    expect(result.view_meta.source_kind).toBe('chronik');
    expect(result.events).toHaveLength(0);
    expect(result.view_meta.missing_reason).toBe('empty_window');
  });

  it('should skip invalid timestamps in JSON fixture array without throwing', async () => {
    const now = new Date();
    const validTs = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();

    const fixtureEvents = [
      { timestamp: 'not-a-date', kind: 'bad.event', repo: 'x' },
      { timestamp: validTs, kind: 'good.event', repo: 'y' },
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

    // The bad timestamp is skipped; only the valid one is returned
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kind).toBe('good.event');
  });
});
