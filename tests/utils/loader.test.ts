import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadWithFallback, loadOptional } from '../../src/utils/loader.js';
import { EmptyFileError } from '../../src/utils/fs.js';

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

  describe('loadOptional', () => {
    it('returns artifact data when artifact is valid', async () => {
      await createArtifact('{"val": 42}');
      const result = await loadOptional(artifactPath, fixturePath, 'Test');
      expect(result).toEqual({ data: { val: 42 }, source: 'artifact', reason: 'ok' });
    });

    it('falls back to fixture when artifact is missing', async () => {
      await createFixture('{"val": 99}');
      const result = await loadOptional(artifactPath, fixturePath, 'Test');
      expect(result).toEqual({ data: { val: 99 }, source: 'fixture', reason: 'ok' });
    });

    it('returns enoent when both artifact and fixture are missing', async () => {
      const result = await loadOptional(artifactPath, fixturePath, 'Test');
      expect(result).toEqual({ data: null, source: 'missing', reason: 'enoent' });
    });

    it('returns invalid-json when artifact is corrupt and fixture is missing', async () => {
      await createArtifact('{ not valid json }');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loadOptional(artifactPath, fixturePath, 'Test');
      expect(result).toEqual({ data: null, source: 'missing', reason: 'invalid-json' });
      warnSpy.mockRestore();
    });

    it('returns invalid-json when both artifact and fixture are corrupt', async () => {
      await createArtifact('{ bad }');
      await createFixture('{ also bad }');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loadOptional(artifactPath, fixturePath, 'Test');
      expect(result).toEqual({ data: null, source: 'missing', reason: 'invalid-json' });
      warnSpy.mockRestore();
    });

    it('succeeds with fixture when only artifact is corrupt', async () => {
      await createArtifact('{ bad }');
      await createFixture('{"val": 7}');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await loadOptional(artifactPath, fixturePath, 'Test');
      expect(result).toEqual({ data: { val: 7 }, source: 'fixture', reason: 'ok' });
      warnSpy.mockRestore();
    });

    it('never throws even when both candidates fail', async () => {
      await createArtifact('{ bad }');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(loadOptional(artifactPath, fixturePath, 'Test')).resolves.not.toThrow();
      warnSpy.mockRestore();
    });

    it('correctly labels source as fixture when primarySource is fixture', async () => {
      await createFixture('{"val": 123}');
      const result = await loadOptional(artifactPath, fixturePath, 'Test', {
        primarySource: 'fixture',
      });
      expect(result).toEqual({
        data: { val: 123 },
        source: 'fixture',
        reason: 'ok',
      });
    });

    it('returns missing with correct source when primarySource is fixture and path missing', async () => {
      const result = await loadOptional(artifactPath, fixturePath, 'Test', {
        primarySource: 'fixture',
      });
      expect(result).toEqual({
        data: null,
        source: 'missing',
        reason: 'enoent',
      });
    });

    it('prioritizes other errors (e.g., EACCES) over enoent and empty', async () => {
      // Simulate a permission error on the artifact path
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const permissionError = new Error('EACCES: permission denied');
      (permissionError as NodeJS.ErrnoException).code = 'EACCES';
      
      // Mock readJsonFile to throw EACCES for artifact, then ENOENT for fixture
      const fsModule = await import('../../src/utils/fs.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const readJsonFileMock = vi.spyOn(fsModule, 'readJsonFile' as any);
      
      readJsonFileMock.mockImplementation(async (path: string) => {
        if (path === artifactPath) {
          throw permissionError;
        } else {
          const enoentError = new Error('ENOENT: no such file');
          (enoentError as NodeJS.ErrnoException).code = 'ENOENT';
          throw enoentError;
        }
      });

      const result = await loadOptional(artifactPath, fixturePath, 'Test');
      
      // Should report 'error' (the permission denied) rather than 'enoent'
      expect(result).toMatchObject({
        data: null,
        source: 'missing',
        reason: 'error',
      });
      
      readJsonFileMock.mockRestore();
      vi.restoreAllMocks();
    });

    it('prioritizes other errors over empty', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const permissionError = new Error('EACCES: permission denied');
      (permissionError as NodeJS.ErrnoException).code = 'EACCES';
      
      const fsModule = await import('../../src/utils/fs.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const readJsonFileMock = vi.spyOn(fsModule, 'readJsonFile' as any);
      
      readJsonFileMock.mockImplementation(async (path: string) => {
        if (path === artifactPath) {
          throw permissionError;
        } else {
          throw new EmptyFileError(path);
        }
      });

      const result = await loadOptional(artifactPath, fixturePath, 'Test');
      
      // Should report 'error' (permission denied) rather than 'empty'
      expect(result).toMatchObject({
        data: null,
        source: 'missing',
        reason: 'error',
      });
      
      readJsonFileMock.mockRestore();
      vi.restoreAllMocks();
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
