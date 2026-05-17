import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readJsonFile, EmptyFileError, InvalidJsonError, getTransportTimestamp } from '../../src/utils/fs.js';

describe('readJsonFile', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-fs-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should successfully parse a valid JSON file', async () => {
    const filePath = join(testDir, 'valid.json');
    const data = { foo: 'bar', baz: 123 };
    await writeFile(filePath, JSON.stringify(data));

    const result = await readJsonFile(filePath);
    expect(result).toEqual(data);
  });

  it('should throw EmptyFileError if the file is completely empty', async () => {
    const filePath = join(testDir, 'empty.json');
    await writeFile(filePath, '');

    const error = await readJsonFile(filePath).catch(e => e);
    expect(error).toBeInstanceOf(EmptyFileError);
    expect(error.message).toBe(`File is empty: ${filePath}`);
  });

  it('should throw EmptyFileError if the file contains only whitespace', async () => {
    const filePath = join(testDir, 'whitespace.json');
    await writeFile(filePath, '   \n\t  ');

    const error = await readJsonFile(filePath).catch(e => e);
    expect(error).toBeInstanceOf(EmptyFileError);
  });

  it('should throw InvalidJsonError if the file contains invalid JSON', async () => {
    const filePath = join(testDir, 'invalid.json');
    await writeFile(filePath, '{ "foo": "bar", }'); // Trailing comma is invalid in standard JSON

    const error = await readJsonFile(filePath).catch(e => e);
    expect(error).toBeInstanceOf(InvalidJsonError);
    expect(error.message).toContain(`Invalid JSON in ${filePath}`);
  });

  it('should throw original error (e.g. ENOENT) if the file does not exist', async () => {
    const filePath = join(testDir, 'non-existent.json');
    await expect(readJsonFile(filePath)).rejects.toHaveProperty('code', 'ENOENT');
  });
});

describe('getTransportTimestamp', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-mtime-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns null when path is null', async () => {
    expect(await getTransportTimestamp(null)).toBeNull();
  });

  it('returns null when the file does not exist', async () => {
    expect(await getTransportTimestamp(join(testDir, 'missing.json'))).toBeNull();
  });

  it('returns the mtime as ISO string when the file exists', async () => {
    const filePath = join(testDir, 'present.json');
    await writeFile(filePath, '{}');
    const fixed = new Date('2026-01-15T12:34:56.000Z');
    await utimes(filePath, fixed, fixed);

    const ts = await getTransportTimestamp(filePath);
    expect(ts).toBe(fixed.toISOString());
    // sanity: matches actual stat mtime
    const s = await stat(filePath);
    expect(ts).toBe(s.mtime.toISOString());
  });
});
