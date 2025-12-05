import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig } from '../src/config.js';

describe('config', () => {
  let testDir: string;
  let configPath: string;
  
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'leitstand-test-config-'));
    configPath = join(testDir, 'test.config.json');
  });
  
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
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
