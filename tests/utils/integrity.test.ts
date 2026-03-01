import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadIntegritySummaries, type IntegrityLoadOptions } from '../../src/utils/integrity.js';

describe('loadIntegritySummaries', () => {
  let testDir: string;
  let options: IntegrityLoadOptions;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-integrity-'));

    options = {
      artifactDir: join(testDir, 'artifacts'),
      legacyArtifactPath: join(testDir, 'legacy-artifact.json'),
      fixtureDir: join(testDir, 'fixtures'),
      legacyFixturePath: join(testDir, 'legacy-fixture.json'),
      strict: true
    };
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Strict: ON (strict=true)', () => {
    it('should successfully load valid summaries from artifactDir and legacyArtifactPath with deduplication', async () => {
      await mkdir(options.artifactDir, { recursive: true });

      const artifactSummary1 = { repo: 'repo1', status: 'ok', generated_at: '2023-01-01' };
      const artifactSummary2 = { repo: 'repo2', status: 'ok', generated_at: '2023-01-01' };
      const legacySummary = { repo: 'repo1', status: 'legacy_ok', generated_at: '2022-01-01' }; // repo1 is duplicate

      await writeFile(join(options.artifactDir, '1.json'), JSON.stringify(artifactSummary1));
      await writeFile(join(options.artifactDir, '2.json'), JSON.stringify(artifactSummary2));
      await writeFile(options.legacyArtifactPath, JSON.stringify(legacySummary));

      options.strict = true;
      const result = await loadIntegritySummaries(options);

      expect(result.source).toBe('artifact');
      expect(result.summaries.length).toBe(2);

      const repoNames = result.summaries.map(s => s.repo).sort();
      expect(repoNames).toEqual(['repo1', 'repo2']);

      const r1Entries = result.summaries.filter(s => s.repo === 'repo1');
      expect(r1Entries.length).toBe(1);
      // artifactDir summaries are loaded before legacyArtifactPath; within artifactDir, files are processed deterministically via sort().
      expect(r1Entries[0].status).toBe('ok');
    });

    it('should gracefully ignore invalid JSON in strict mode without hard failing', async () => {
      await mkdir(options.artifactDir, { recursive: true });

      await writeFile(join(options.artifactDir, '1.json'), JSON.stringify({ repo: 'repo1', status: 'ok', generated_at: '2023-01-01' }));
      await writeFile(join(options.artifactDir, '2.json'), '{ invalid JSON');
      await writeFile(join(options.artifactDir, '3.json'), '   '); // empty

      options.strict = true;
      const result = await loadIntegritySummaries(options);

      expect(result.source).toBe('artifact');
      expect(result.summaries.length).toBe(1);
      expect(result.summaries[0].repo).toBe('repo1');
    });

    it('should return missing enoent when artifactDir and legacyArtifactPath are missing', async () => {
      // Intentionally not creating the artifactDir or legacyArtifactPath
      // But creating fixtures to prove they are ignored in strict mode
      await mkdir(options.fixtureDir, { recursive: true });
      await writeFile(join(options.fixtureDir, 'f1.json'), JSON.stringify({ repo: 'f1', status: 'ok', generated_at: '2023-01-01' }));
      await writeFile(options.legacyFixturePath, JSON.stringify({ repo: 'legacy_f', status: 'ok', generated_at: '2023-01-01' }));

      options.strict = true;
      const result = await loadIntegritySummaries(options);

      expect(result.source).toBe('missing');
      expect(result.reason).toBe('enoent');
      expect(result.summaries.length).toBe(0);
    });
  });

  describe('Strict: OFF (strict=false)', () => {
    it('should load from artifactDir if present', async () => {
      await mkdir(options.artifactDir, { recursive: true });
      await writeFile(join(options.artifactDir, '1.json'), JSON.stringify({ repo: 'repo1', status: 'ok', generated_at: '2023-01-01' }));

      options.strict = false;
      const result = await loadIntegritySummaries(options);

      expect(result.source).toBe('artifact');
      expect(result.reason).toBe('ok');
      expect(result.summaries.length).toBe(1);
    });

    it('should fallback to fixtureDir and legacyFixturePath when artifacts are missing', async () => {
      await mkdir(options.fixtureDir, { recursive: true });

      const fixtureSummary1 = { repo: 'f1', status: 'ok', generated_at: '2023-01-01' };
      const legacyFixtureSummary = { repo: 'f1', status: 'legacy_ok', generated_at: '2022-01-01' }; // duplicate repo

      await writeFile(join(options.fixtureDir, 'f1.json'), JSON.stringify(fixtureSummary1));
      await writeFile(options.legacyFixturePath, JSON.stringify(legacyFixtureSummary));

      options.strict = false;
      const result = await loadIntegritySummaries(options);

      expect(result.source).toBe('fixture');
      expect(result.reason).toBe('fallback');
      expect(result.summaries.length).toBe(1);

      const r1 = result.summaries.find(s => s.repo === 'f1');
      expect(r1?.status).toBe('ok');
    });

    it('should return missing enoent when all artifacts and fixtures are missing', async () => {
      options.strict = false;
      const result = await loadIntegritySummaries(options);

      expect(result.source).toBe('missing');
      expect(result.reason).toBe('enoent');
      expect(result.summaries.length).toBe(0);
    });

    it('should gracefully ignore invalid JSON and proceed with valid summaries', async () => {
      await mkdir(options.fixtureDir, { recursive: true });

      const fixtureSummary1 = { repo: 'f1', status: 'ok', generated_at: '2023-01-01' };

      // valid JSON
      await writeFile(join(options.fixtureDir, 'f1.json'), JSON.stringify(fixtureSummary1));
      // invalid JSON syntax
      await writeFile(join(options.fixtureDir, 'f2.json'), '{ invalid JSON');
      // empty file
      await writeFile(join(options.fixtureDir, 'f3.json'), '   ');
      // non-JSON extension file should be ignored completely
      await writeFile(join(options.fixtureDir, 'ignored.txt'), 'hello world');

      // We use strict: false so we hit the fixture parsing logic
      options.strict = false;
      const result = await loadIntegritySummaries(options);

      expect(result.source).toBe('fixture');
      expect(result.reason).toBe('fallback');
      // It should only load the 1 valid summary
      expect(result.summaries.length).toBe(1);
      expect(result.summaries[0].repo).toBe('f1');
    });
  });

});
