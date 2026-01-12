import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadWithFallback } from '../../src/utils/loader.js';

describe('loadWithFallback', () => {
  let testDir: string;
  let artifactPath: string;
  let fixturePath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-loader-'));
    artifactPath = join(testDir, 'artifact.json');
    fixturePath = join(testDir, 'fixture.json');
    // Ensure mocks/spies are cleared if any (though we use file system mostly here)
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // Helper to create files
  const createArtifact = (content: string) => writeFile(artifactPath, content);
  const createFixture = (content: string) => writeFile(fixturePath, content);

  describe('Strict: OFF (Dev/Fallback Mode)', () => {
    const options = { strict: false, strictFail: false, name: 'Test' };

    it('should load valid artifact', async () => {
      await createArtifact('{"val": 1}');
      const result = await loadWithFallback(artifactPath, fixturePath, options);
      expect(result).toEqual({ data: { val: 1 }, source: 'artifact', reason: 'ok' });
    });

    it('should fall back to fixture if artifact is missing', async () => {
      await createFixture('{"val": 2}');
      const result = await loadWithFallback(artifactPath, fixturePath, options);
      expect(result).toEqual({ data: { val: 2 }, source: 'fixture', reason: 'enoent' });
    });

    it('should fall back to fixture if artifact is empty', async () => {
      await createArtifact('   '); // empty
      await createFixture('{"val": 2}');
      const result = await loadWithFallback(artifactPath, fixturePath, options);
      expect(result).toEqual({ data: { val: 2 }, source: 'fixture', reason: 'empty' });
    });

    it('should throw if artifact is invalid JSON (corruption is fatal in dev too?)', async () => {
      // In current logic: "artifact artifact contains invalid JSON" -> throws
      await createArtifact('{ invalid }');
      await expect(loadWithFallback(artifactPath, fixturePath, options))
        .rejects.toThrow('Test artifact contains invalid JSON');
    });

    it('should return missing/enoent if both missing', async () => {
      const result = await loadWithFallback(artifactPath, fixturePath, options);
      expect(result).toEqual({ data: null, source: 'missing', reason: 'enoent' });
    });
  });

  describe('Strict: ON (strict=true, strictFail=false)', () => {
    const options = { strict: true, strictFail: false, name: 'Test' };

    it('should load valid artifact', async () => {
      await createArtifact('{"val": 1}');
      const result = await loadWithFallback(artifactPath, fixturePath, options);
      expect(result).toEqual({ data: { val: 1 }, source: 'artifact', reason: 'ok' });
    });

    it('should return empty state (missing) if artifact is missing', async () => {
      // No fallback to fixture in strict mode
      await createFixture('{"val": 2}'); // should be ignored
      const result = await loadWithFallback(artifactPath, fixturePath, options);
      expect(result).toEqual({ data: null, source: 'missing', reason: 'enoent' });
    });

    it('should return empty state (missing) if artifact is empty', async () => {
      await createArtifact('   ');
      const result = await loadWithFallback(artifactPath, fixturePath, options);
      expect(result).toEqual({ data: null, source: 'missing', reason: 'empty' });
    });

    it('should throw if artifact is invalid JSON (corruption is fatal)', async () => {
      await createArtifact('{ invalid }');
      await expect(loadWithFallback(artifactPath, fixturePath, options))
        .rejects.toThrow('Strict: Test artifact contains invalid JSON');
    });
  });

  describe('Strict Fail: ON (strictFail=true)', () => {
    const options = { strict: true, strictFail: true, name: 'Test' };

    it('should load valid artifact', async () => {
      await createArtifact('{"val": 1}');
      const result = await loadWithFallback(artifactPath, fixturePath, options);
      expect(result).toEqual({ data: { val: 1 }, source: 'artifact', reason: 'ok' });
    });

    it('should throw if artifact is missing', async () => {
      await expect(loadWithFallback(artifactPath, fixturePath, options))
        .rejects.toThrow('Strict Fail: Test artifact missing or invalid');
    });

    it('should throw if artifact is empty', async () => {
      await createArtifact('   ');
      // strictFail catches any error from readJsonFile including EmptyFileError
      await expect(loadWithFallback(artifactPath, fixturePath, options))
        .rejects.toThrow('Strict Fail: Test artifact missing or invalid');
    });

    it('should throw if artifact is invalid', async () => {
      await createArtifact('{ invalid }');
      await expect(loadWithFallback(artifactPath, fixturePath, options))
        .rejects.toThrow('Strict Fail: Test artifact missing or invalid');
    });
  });
});
