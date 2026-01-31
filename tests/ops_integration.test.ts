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
    // Current default in config.ts is empty string (after our previous step changes)
    // or if the test env doesn't set it.

    // Explicitly set empty to be sure of the test case
    vi.stubEnv('LEITSTAND_ACS_URL', '');
    resetEnvConfig();

    const res = await request(app).get('/ops');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Ops Viewer Not Configured');
    expect(res.text).toContain('Please configure <code>LEITSTAND_ACS_URL</code>');

    // Should NOT contain the main panel or script injection
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

    // Check injection using more robust matching (avoid exact string equality on whitespace)
    expect(res.text).toMatch(/const ACS_URL = "http:\/\/localhost:8000"/);
    expect(res.text).toContain(`Data source: <strong>Agent Control Surface (${customUrl})</strong>`);

    // Check for repo list rendering
    expect(res.text).toContain('<option value="metarepo">metarepo</option>');
    expect(res.text).toContain('<option value="wgx">wgx</option>');
    expect(res.text).toContain('<option value="leitstand">leitstand</option>');
  });

  it('should fall back to "Not Configured" if URL is invalid (rejected by config validation)', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'ftp://invalid-scheme.com');
    resetEnvConfig();

    const res = await request(app).get('/ops');

    // Validation logic in config.ts returns defaults (empty string) on failure
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ops Viewer Not Configured');
  });
});
