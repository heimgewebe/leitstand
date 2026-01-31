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

  it('should render the ops view with default ACS URL', async () => {
    // Default is http://localhost:8000
    const res = await request(app).get('/ops');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Ops Viewer (may trigger audit jobs)');
    // Check injection
    expect(res.text).toContain('const ACS_URL = "http://localhost:8000";');
    expect(res.text).toContain('Data fetched from Agent Control Surface at: <strong>http://localhost:8000</strong>');
  });

  it('should render the ops view with configured LEITSTAND_ACS_URL', async () => {
    const customUrl = 'https://acs.internal:9000';
    vi.stubEnv('LEITSTAND_ACS_URL', customUrl);
    resetEnvConfig();

    const res = await request(app).get('/ops');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`const ACS_URL = "${customUrl}";`);
    expect(res.text).toContain(`Data fetched from Agent Control Surface at: <strong>${customUrl}</strong>`);
  });
});
