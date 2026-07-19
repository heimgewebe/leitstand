import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envConfig, loadConfig, resetEnvConfig } from '../src/config.js';

describe('config', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-config-'));
    configPath = join(testDir, 'test.config.json');
    resetEnvConfig();
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    resetEnvConfig();
  });

  describe('envConfig', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('validates PORT and falls back safely', () => {
      vi.stubEnv('PORT', '4000');
      resetEnvConfig();
      expect(envConfig.PORT).toBe(4000);

      vi.stubEnv('PORT', 'invalid-port');
      resetEnvConfig();
      expect(envConfig.PORT).toBe(3000);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('rejects non-positive ports', () => {
      vi.stubEnv('PORT', '-500');
      resetEnvConfig();
      expect(envConfig.PORT).toBe(3000);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('defaults to IPv4 loopback', () => {
      expect(envConfig.bindHost).toBe('127.0.0.1');
    });

    it('accepts explicit IPv4 and IPv6 literals', () => {
      vi.stubEnv('LEITSTAND_BIND_HOST', '192.168.178.10');
      resetEnvConfig();
      expect(envConfig.bindHost).toBe('192.168.178.10');

      vi.stubEnv('LEITSTAND_BIND_HOST', '::1');
      resetEnvConfig();
      expect(envConfig.bindHost).toBe('::1');
    });

    it('rejects hostnames without corrupting unrelated environment values', () => {
      vi.stubEnv('PORT', '4001');
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('LEITSTAND_BIND_HOST', 'leitstand.local');
      resetEnvConfig();

      expect(envConfig.bindHost).toBe('127.0.0.1');
      expect(envConfig.PORT).toBe(4001);
      expect(envConfig.NODE_ENV).toBe('production');
      expect(envConfig.isStrict).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    });

    it.each(['0.0.0.0', '::'])('rejects wildcard %s without acknowledgement', (host) => {
      vi.stubEnv('LEITSTAND_BIND_HOST', host);
      resetEnvConfig();
      expect(envConfig.bindHost).toBe('127.0.0.1');
      expect(warnSpy).toHaveBeenCalled();
    });

    it.each(['0.0.0.0', '::'])('accepts wildcard %s only with explicit acknowledgement', (host) => {
      vi.stubEnv('LEITSTAND_BIND_HOST', host);
      vi.stubEnv('LEITSTAND_ALLOW_WIDE_BIND', 'true');
      resetEnvConfig();
      expect(envConfig.bindHost).toBe(host);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('resets the environment cache explicitly', () => {
      vi.stubEnv('PORT', '5000');
      resetEnvConfig();
      expect(envConfig.PORT).toBe(5000);

      vi.stubEnv('PORT', '6000');
      expect(envConfig.PORT).toBe(5000);

      resetEnvConfig();
      expect(envConfig.PORT).toBe(6000);
    });
  });

  it('loads valid digest configuration', async () => {
    const configData = {
      paths: {
        semantah: { todayInsights: './insights/today.json' },
        chronik: { dataDir: './chronik/data' },
        wgx: { metricsDir: './wgx/metrics' },
      },
      output: { dir: './digests/daily' },
    };

    await writeFile(configPath, JSON.stringify(configData), 'utf-8');
    const config = await loadConfig(configPath);

    expect(config.paths.semantah.todayInsights).toContain('insights/today.json');
    expect(config.paths.chronik.dataDir).toContain('chronik/data');
  });

  it('rejects invalid configuration', async () => {
    await writeFile(configPath, JSON.stringify({ paths: { semantah: {} } }), 'utf-8');
    await expect(loadConfig(configPath)).rejects.toThrow('Configuration validation failed');
  });

  it('rejects invalid JSON', async () => {
    await writeFile(configPath, '{ invalid json }', 'utf-8');
    await expect(loadConfig(configPath)).rejects.toThrow('Invalid JSON');
  });

  it('expands configured environment variables', async () => {
    process.env.TEST_ROOT = '/test/root';
    const configData = {
      paths: {
        semantah: { todayInsights: '$TEST_ROOT/insights/today.json' },
        chronik: { dataDir: '$TEST_ROOT/chronik/data' },
        wgx: { metricsDir: '$TEST_ROOT/wgx/metrics' },
      },
      output: { dir: './digests/daily' },
    };

    await writeFile(configPath, JSON.stringify(configData), 'utf-8');
    const config = await loadConfig(configPath);
    expect(config.paths.semantah.todayInsights).toContain('/test/root/insights/today.json');
    delete process.env.TEST_ROOT;
  });

  it('fails when a referenced environment variable is unset', async () => {
    const configData = {
      paths: {
        semantah: { todayInsights: '$UNDEFINED_VAR/insights/today.json' },
        chronik: { dataDir: './chronik/data' },
        wgx: { metricsDir: './wgx/metrics' },
      },
      output: { dir: './digests/daily' },
    };

    await writeFile(configPath, JSON.stringify(configData), 'utf-8');
    await expect(loadConfig(configPath)).rejects.toThrow('Environment variable(s) not set: UNDEFINED_VAR');
  });
});
