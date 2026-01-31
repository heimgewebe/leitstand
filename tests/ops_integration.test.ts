import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { resetEnvConfig } from '../src/config.js';

describe('GET /ops', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfig(); // Force reload of env config
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfig();
  });

  it('should render the "Not Configured" state by default (when URL is empty)', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', '');
    resetEnvConfig();

    const res = await request(app).get('/ops');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Ops Viewer Not Configured');
    expect(res.text).toContain('Please configure <code>LEITSTAND_ACS_URL</code>');

    expect(res.text).not.toContain('const ACS_URL =');
    expect(res.text).not.toContain('<select id="repoSelect">');
  });

  it('should render the ops view when configured with valid URL', async () => {
    const customUrl = 'http://localhost:8000';
    vi.stubEnv('LEITSTAND_ACS_URL', customUrl);
    resetEnvConfig();

    const res = await request(app).get('/ops');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Ops Viewer (may trigger audit jobs)');

    // Check injection using regex
    expect(res.text).toMatch(/const ACS_URL = "http:\/\/localhost:8000"/);
    expect(res.text).toContain(`Data source: <strong>Agent Control Surface (${customUrl})</strong>`);

    // Check default hardcoded repo list rendering
    expect(res.text).toContain('<option value="metarepo">metarepo</option>');
    expect(res.text).toContain('<option value="wgx">wgx</option>');
    expect(res.text).toContain('<option value="leitstand">leitstand</option>');
  });

  it('should inject ALLOW_JOB_FALLBACK flag correctly', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000');
    vi.stubEnv('LEITSTAND_OPS_ALLOW_JOB_FALLBACK', 'true');
    resetEnvConfig();

    const res = await request(app).get('/ops');
    expect(res.text).toMatch(/const ALLOW_JOB_FALLBACK = true/);
    expect(res.text).toContain('Sync fetch preferred; Job triggers enabled as fallback.');
  });

  it('should default ALLOW_JOB_FALLBACK to false', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000');
    // Ensure var is unset
    delete process.env.LEITSTAND_OPS_ALLOW_JOB_FALLBACK;
    resetEnvConfig();

    const res = await request(app).get('/ops');
    expect(res.text).toMatch(/const ALLOW_JOB_FALLBACK = false/);
    expect(res.text).toContain('Viewer-only mode (Job triggers disabled).');
  });

  it('should respect LEITSTAND_REPOS overrides', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000');
    vi.stubEnv('LEITSTAND_REPOS', 'custom-repo-1, custom-repo-2');
    resetEnvConfig();

    const res = await request(app).get('/ops');
    expect(res.text).toContain('<option value="custom-repo-1">custom-repo-1</option>');
    expect(res.text).toContain('<option value="custom-repo-2">custom-repo-2</option>');

    // Should NOT contain default defaults
    expect(res.text).not.toContain('<option value="metarepo">metarepo</option>');
  });

  it('should fall back to "Not Configured" if URL is invalid (rejected by config validation)', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'ftp://invalid-scheme.com');
    resetEnvConfig();

    const res = await request(app).get('/ops');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ops Viewer Not Configured');
  });
});
