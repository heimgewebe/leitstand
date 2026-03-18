import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, rm, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, resetEnvConfig, envConfig } from '../src/config.js';

describe('config', () => {
  let testDir: string;
  let configPath: string;
  
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-config-'));
    configPath = join(testDir, 'test.config.json');
    // Clear env config cache before each test
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

    it('should validate PORT as integer', () => {
      vi.stubEnv('PORT', '4000');
      resetEnvConfig();
      expect(envConfig.PORT).toBe(4000);
    });

    it('should fallback to default PORT 3000 if invalid', () => {
      vi.stubEnv('PORT', 'invalid-port');
      resetEnvConfig();
      // z.coerce.number() coerces 'invalid-port' to NaN, failing .int().positive()
      // safeParse() fails -> parsedEnv() warns and returns the defaults object (PORT: 3000)
      expect(envConfig.PORT).toBe(3000);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should fallback to default PORT 3000 if non-positive', () => {
      vi.stubEnv('PORT', '-500');
      resetEnvConfig();
      // -500 fails .positive() -> safeParse() fails -> warns and returns defaults (PORT: 3000)
      expect(envConfig.PORT).toBe(3000);
      expect(warnSpy).toHaveBeenCalled();
    });

    describe('LEITSTAND_ACS_URL', () => {
      // Ops Viewer specific config tests
      it('should accept valid HTTP/HTTPS URLs', () => {
        vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000');
        resetEnvConfig();
        expect(envConfig.acsUrl).toBe('http://localhost:8000');

        vi.stubEnv('LEITSTAND_ACS_URL', 'https://acs.internal');
        resetEnvConfig();
        expect(envConfig.acsUrl).toBe('https://acs.internal');
      });

      it('should allow empty string (disabled/unconfigured)', () => {
        vi.stubEnv('LEITSTAND_ACS_URL', '');
        resetEnvConfig();
        expect(envConfig.acsUrl).toBe('');
      });

      it('should reject invalid URLs (non-http/s) and trigger global fallback', () => {
        // Set a valid PORT override alongside invalid URL
        vi.stubEnv('PORT', '4001');
        vi.stubEnv('LEITSTAND_ACS_URL', 'ftp://malicious-server.com');
        resetEnvConfig();

        // Validation fails -> global fallback to defaults
        // This confirms safeParse failure invalidates the ENTIRE env config object
        expect(envConfig.acsUrl).toBe('');
        expect(envConfig.PORT).toBe(3000); // Should revert to default, ignoring the valid 4001
        expect(warnSpy).toHaveBeenCalled();
      });

      it('should reject invalid URL strings', () => {
        vi.stubEnv('LEITSTAND_ACS_URL', 'not-a-url');
        resetEnvConfig();
        expect(envConfig.acsUrl).toBe('');
        expect(warnSpy).toHaveBeenCalled();
      });
    });

    it('should reset the cache when resetEnvConfig is called', () => {
      vi.stubEnv('PORT', '5000');
      resetEnvConfig();
      // Accessing PORT to populate the cache
      expect(envConfig.PORT).toBe(5000);

      // Change environment variable without resetting
      vi.stubEnv('PORT', '6000');
      // Should still be cached as 5000
      expect(envConfig.PORT).toBe(5000);

      // Reset the cache
      resetEnvConfig();
      // Now it should pick up the new value
      expect(envConfig.PORT).toBe(6000);
    });
  });
  
  it('should load valid configuration', async () => {
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
    
    expect(config).toBeDefined();
    expect(config.paths.semantah.todayInsights).toContain('insights/today.json');
    expect(config.paths.chronik.dataDir).toContain('chronik/data');
  });
  
  it('should reject invalid configuration', async () => {
    const invalidConfig = {
      paths: {
        semantah: {},  // Missing todayInsights
      },
    };
    
    await writeFile(configPath, JSON.stringify(invalidConfig), 'utf-8');
    
    await expect(loadConfig(configPath)).rejects.toThrow('Configuration validation failed');
  });
  
  it('should reject invalid JSON', async () => {
    await writeFile(configPath, '{ invalid json }', 'utf-8');
    
    await expect(loadConfig(configPath)).rejects.toThrow('Invalid JSON');
  });
  
  it('should expand environment variables', async () => {
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
  
  it('should fail when environment variables are not set', async () => {
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
