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
    expect(res.text).toContain('data-testid="ops-not-configured"');
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
    // Should contain specific "read-only" title by default
    expect(res.text).toContain('<title>Ops Viewer (read-only)</title>');

    // Check main panel presence via data-testid
    expect(res.text).toContain('data-testid="ops-panel"');

    // Check injection using regex
    expect(res.text).toMatch(/const ACS_URL = "http:\/\/localhost:8000"/);
    expect(res.text).toContain(`Data source: <strong>Agent Control Surface (${customUrl})</strong>`);

    // Check default hardcoded repo list rendering
    expect(res.text).toContain('<option value="metarepo">metarepo</option>');
    expect(res.text).toContain('<option value="wgx">wgx</option>');
    expect(res.text).toContain('<option value="leitstand">leitstand</option>');
  });

  it('should normalize ACS URL by stripping trailing slashes', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000/'); // With slash
    resetEnvConfig();

    const res = await request(app).get('/ops');

    expect(res.status).toBe(200);
    // Should NOT have trailing slash in the injected string
    expect(res.text).toMatch(/const ACS_URL = "http:\/\/localhost:8000"/);
    expect(res.text).not.toMatch(/const ACS_URL = "http:\/\/localhost:8000\/"/);
  });

  it('should inject ALLOW_JOB_FALLBACK flag correctly', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000');
    vi.stubEnv('LEITSTAND_OPS_ALLOW_JOB_FALLBACK', 'true');
    resetEnvConfig();

    const res = await request(app).get('/ops');
    expect(res.text).toMatch(/const ALLOW_JOB_FALLBACK = true/);
    expect(res.text).toContain('Sync fetch preferred; Job triggers enabled as fallback (may POST /api/audit/git).');

    // Verify dynamic title for fallback mode
    expect(res.text).toContain('<title>Ops Viewer (may trigger audit jobs)</title>');
  });

  it('should parse ALLOW_JOB_FALLBACK robustly (1/yes/on)', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000');

    // Test '1'
    vi.stubEnv('LEITSTAND_OPS_ALLOW_JOB_FALLBACK', '1');
    resetEnvConfig();
    let res = await request(app).get('/ops');
    expect(res.text).toMatch(/const ALLOW_JOB_FALLBACK = true/);

    // Test 'on'
    vi.stubEnv('LEITSTAND_OPS_ALLOW_JOB_FALLBACK', 'on');
    resetEnvConfig();
    res = await request(app).get('/ops');
    expect(res.text).toMatch(/const ALLOW_JOB_FALLBACK = true/);
  });

  it('should default ALLOW_JOB_FALLBACK to false', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000');
    // Ensure var is unset
    delete process.env.LEITSTAND_OPS_ALLOW_JOB_FALLBACK;
    resetEnvConfig();

    const res = await request(app).get('/ops');
    expect(res.text).toMatch(/const ALLOW_JOB_FALLBACK = false/);
    expect(res.text).toContain('Viewer-only mode. No job triggers.');

    // Verify dynamic title for read-only mode
    expect(res.text).toContain('<title>Ops Viewer (read-only)</title>');
  });

  it('should inject ACS_VIEWER_TOKEN if configured', async () => {
    vi.stubEnv('LEITSTAND_ACS_URL', 'http://localhost:8000');
    vi.stubEnv('LEITSTAND_ACS_VIEWER_TOKEN', 'secret-viewer-token');
    resetEnvConfig();

    const res = await request(app).get('/ops');
    expect(res.text).toMatch(/const ACS_VIEWER_TOKEN = "secret-viewer-token"/);
    // Check if the lock icon/indicator is rendered
    expect(res.text).toContain('title="Optional token configured (sent, not strictly enforced by default)"');
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
    expect(res.text).toContain('data-testid="ops-not-configured"');
  });
});
