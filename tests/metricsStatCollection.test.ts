import { stat } from 'fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

import { loadLatestMetrics } from '../src/metrics.js';

interface MeasurementFixture {
  workerLimit: number;
  mtime: string;
  expectedLatestFile: string;
  files: Array<{ file: string; repoCount: number }>;
}

describe('metrics file-stat collection measurement', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-stat-measurement-'));
  });

  afterEach(async () => {
    vi.mocked(stat).mockReset();
    await rm(testDir, { recursive: true, force: true });
  });

  it('uses bounded concurrent stats and preserves the stable filename tie-breaker', async () => {
    const fixturePath = join(process.cwd(), 'tests', 'fixtures', 'metrics-stat-collection.json');
    const fixture = JSON.parse(await readFile(fixturePath, 'utf-8')) as MeasurementFixture;

    await Promise.all(fixture.files.map(({ file, repoCount }) => writeFile(
      join(testDir, file),
      JSON.stringify({
        timestamp: '2026-08-01T12:00:00.000Z',
        repoCount,
        status: { ok: repoCount, warn: 0, fail: 0 },
      }),
      'utf-8',
    )));

    let activeStats = 0;
    let maximumActiveStats = 0;
    const pendingReleases: Array<() => void> = [];
    const measuredMtime = new Date(fixture.mtime);

    vi.mocked(stat).mockImplementation(async () => {
      activeStats += 1;
      maximumActiveStats = Math.max(maximumActiveStats, activeStats);
      await new Promise<void>((resolve) => pendingReleases.push(resolve));
      activeStats -= 1;
      return { mtime: measuredMtime } as Awaited<ReturnType<typeof stat>>;
    });

    const resultPromise = loadLatestMetrics(testDir);

    await vi.waitFor(() => expect(stat).toHaveBeenCalledTimes(fixture.workerLimit));
    expect(activeStats).toBe(fixture.workerLimit);
    expect(maximumActiveStats).toBe(fixture.workerLimit);

    pendingReleases.splice(0, fixture.workerLimit).forEach((release) => release());
    await vi.waitFor(() => expect(stat).toHaveBeenCalledTimes(fixture.files.length));

    expect(activeStats).toBe(fixture.files.length - fixture.workerLimit);
    expect(maximumActiveStats).toBe(fixture.workerLimit);

    pendingReleases.splice(0).reverse().forEach((release) => release());
    const result = await resultPromise;

    const measuredFiles = vi.mocked(stat).mock.calls
      .map(([filePath]) => basename(filePath.toString()))
      .sort();
    expect(measuredFiles).toEqual(fixture.files.map(({ file }) => file).sort());
    expect(result?.repoCount).toBe(
      fixture.files.find(({ file }) => file === fixture.expectedLatestFile)?.repoCount,
    );
  });
});
