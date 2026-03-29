/**
 * Unit tests for loadEventsFromDir — the readline streaming path.
 *
 * These tests use real temporary directories to exercise the actual
 * createReadStream + readline interface, independent of any module mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { __loadEventsFromDir } from '../../src/controllers/timeline.js';

const SINCE = '2025-01-01T00:00:00.000Z';
const UNTIL = '2027-01-01T00:00:00.000Z';
const IN_WINDOW_TS = '2026-06-01T10:00:00.000Z';
const IN_WINDOW_TS2 = '2026-06-01T12:00:00.000Z';
const TOO_OLD_TS = '2024-01-01T10:00:00.000Z';

describe('loadEventsFromDir (streaming JSONL path)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-timeline-stream-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should filter events by time window', async () => {
    const lines = [
      JSON.stringify({ timestamp: IN_WINDOW_TS, kind: 'in.window', repo: 'test' }),
      JSON.stringify({ timestamp: TOO_OLD_TS, kind: 'too.old', repo: 'test' }),
    ].join('\n');
    await writeFile(join(testDir, 'events.jsonl'), lines);

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('in.window');
  });

  it('should skip lines with invalid JSON without throwing', async () => {
    const lines = [
      JSON.stringify({ timestamp: IN_WINDOW_TS, kind: 'before.bad', repo: 'test' }),
      'NOT_VALID_JSON',
      JSON.stringify({ timestamp: IN_WINDOW_TS2, kind: 'after.bad', repo: 'test' }),
    ].join('\n');
    await writeFile(join(testDir, 'events.jsonl'), lines);

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.kind).sort()).toEqual(['after.bad', 'before.bad'].sort());
  });

  it('should skip entries with invalid timestamps', async () => {
    const lines = [
      JSON.stringify({ timestamp: 'NOT-A-DATE', kind: 'bad.ts', repo: 'test' }),
      JSON.stringify({ timestamp: IN_WINDOW_TS, kind: 'good.ts', repo: 'test' }),
    ].join('\n');
    await writeFile(join(testDir, 'events.jsonl'), lines);

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('good.ts');
  });

  it('should skip entries missing required kind field', async () => {
    const lines = [
      JSON.stringify({ timestamp: IN_WINDOW_TS, repo: 'test' }), // no kind
      JSON.stringify({ timestamp: IN_WINDOW_TS2, kind: 'has.kind', repo: 'test' }),
    ].join('\n');
    await writeFile(join(testDir, 'events.jsonl'), lines);

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('has.kind');
  });

  it('should respect maxEvents limit', async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        timestamp: `2026-06-01T${String(i + 1).padStart(2, '0')}:00:00.000Z`,
        kind: `event.${i}`,
        repo: 'test',
      })
    ).join('\n');
    await writeFile(join(testDir, 'events.jsonl'), lines);

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 3);

    expect(result).toHaveLength(3);
  });

  it('should return events newest-first from a single file', async () => {
    const lines = [
      JSON.stringify({ timestamp: IN_WINDOW_TS, kind: 'older', repo: 'test' }),
      JSON.stringify({ timestamp: IN_WINDOW_TS2, kind: 'newer', repo: 'test' }),
    ].join('\n');
    await writeFile(join(testDir, 'events.jsonl'), lines);

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('newer');
    expect(result[1].kind).toBe('older');
  });

  it('should merge and sort events from multiple JSONL files newest-first', async () => {
    await writeFile(
      join(testDir, 'file1.jsonl'),
      JSON.stringify({ timestamp: IN_WINDOW_TS, kind: 'file1.event', repo: 'test' })
    );
    await writeFile(
      join(testDir, 'file2.jsonl'),
      JSON.stringify({ timestamp: IN_WINDOW_TS2, kind: 'file2.event', repo: 'test' })
    );

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('file2.event'); // newer first
    expect(result[1].kind).toBe('file1.event');
  });

  it('should ignore non-.jsonl files', async () => {
    await writeFile(
      join(testDir, 'events.json'),
      JSON.stringify([{ timestamp: IN_WINDOW_TS, kind: 'json.event', repo: 'test' }])
    );
    await writeFile(
      join(testDir, 'events.jsonl'),
      JSON.stringify({ timestamp: IN_WINDOW_TS2, kind: 'jsonl.event', repo: 'test' })
    );

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('jsonl.event');
  });

  it('should return an empty array for an empty directory', async () => {
    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);
    expect(result).toHaveLength(0);
  });

  it('should exclude events at exactly the upper boundary (half-open window)', async () => {
    const atBoundary = UNTIL; // === untilIso → must be excluded
    const justBefore = new Date(new Date(UNTIL).getTime() - 1).toISOString();

    const lines = [
      JSON.stringify({ timestamp: atBoundary, kind: 'at.boundary', repo: 'test' }),
      JSON.stringify({ timestamp: justBefore, kind: 'just.before', repo: 'test' }),
    ].join('\n');
    await writeFile(join(testDir, 'events.jsonl'), lines);

    const result = await __loadEventsFromDir(testDir, SINCE, UNTIL, 100);

    expect(result.find((e) => e.kind === 'at.boundary')).toBeUndefined();
    expect(result.find((e) => e.kind === 'just.before')).toBeDefined();
  });
});
