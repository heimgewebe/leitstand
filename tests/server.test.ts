import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { resetEnvConfig } from '../src/config.js';

describe('POST /events', () => {
  it('explicitly returns 404 since ingest path was removed', async () => {
    const res = await request(app)
      .post('/events')
      .send({ kind: 'test.event', payload: {} });

    expect(res.status).toBe(404);
  });
});

describe('GET / – dashboard landing page', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all source cards with stable IDs', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('data-source-id="bureau"');
    expect(res.text).toContain('data-source-id="checkouts"');
    expect(res.text).toContain('data-source-id="storage_health"');
    expect(res.text).toContain('data-source-id="ecosystem_map"');
    expect(res.text).toContain('data-source-id="repo_ground"');
  });

  it('renders an accessible nav and a main landmark', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('aria-label="Hauptnavigation"');
    expect(res.text).toContain('<main');
    expect(res.text).toContain('aria-current="page"');
  });

  it('does not crash even if every source controller fails', async () => {
    const dashboardController = await import('../src/controllers/dashboard.js');
    vi.spyOn(dashboardController, 'getDashboardData').mockRejectedValueOnce(new Error('fully broken'));

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Daten konnten nicht geladen werden');
  });
});
