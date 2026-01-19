import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { resetEnvConfig } from '../src/config.js';

// Mock child_process for fetch scripts
import * as cp from 'child_process';
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof cp>();
  return {
    ...actual,
    exec: vi.fn((cmd, opts, callback) => {
      if (typeof opts === 'function') {
        callback = opts;
      }
      // Simple mock success
      if (callback) callback(null, 'OK', '');
      return { stdout: { on: () => {} }, stderr: { on: () => {} } }; // minimal process mock
    }),
  };
});

describe('POST /events', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    resetEnvConfig(); // Force reload of env config
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfig(); // Clean up
  });

  it('should allow request with correct Bearer token', async () => {
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'valid-token');
    resetEnvConfig(); // Ensure stub is picked up

    const res = await request(app)
      .post('/events')
      .set('Authorization', 'Bearer valid-token')
      .send({ kind: 'test.event', payload: {} });

    expect(res.status).toBe(200);
  });

  it('should allow request with correct X-Events-Token', async () => {
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'valid-token');
    resetEnvConfig();

    const res = await request(app)
      .post('/events')
      .set('X-Events-Token', 'valid-token')
      .send({ kind: 'test.event', payload: {} });

    expect(res.status).toBe(200);
  });

  it('should reject request with invalid token (401)', async () => {
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'valid-token');
    resetEnvConfig();

    const res = await request(app)
      .post('/events')
      .set('Authorization', 'Bearer wrong-token')
      .send({ kind: 'test.event' });

    expect(res.status).toBe(401);
  });

  it('should reject request with missing token when token is configured (401)', async () => {
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'valid-token');
    resetEnvConfig();

    const res = await request(app)
      .post('/events')
      .send({ kind: 'test.event' });

    expect(res.status).toBe(401);
  });

  it('should be disabled in STRICT mode if no token configured (403)', async () => {
    vi.stubEnv('LEITSTAND_STRICT', '1');
    resetEnvConfig();
    // Ensure LEITSTAND_EVENTS_TOKEN is unset

    const res = await request(app)
      .post('/events')
      .send({ kind: 'test.event' });

    expect(res.status).toBe(403);
  });

  it('should be permissive in non-strict mode if no token configured', async () => {
    // Ensure LEITSTAND_EVENTS_TOKEN is unset
    // Ensure STRICT flags are unset

    const res = await request(app)
      .post('/events')
      .send({ kind: 'test.event' });

    expect(res.status).toBe(200);
  });

  it('should trigger fetch-integrity script on valid integrity event (summary_url)', async () => {
    const res = await request(app)
      .post('/events')
      .send({
        type: 'integrity.summary.published.v1',
        payload: { summary_url: 'https://example.com/summary.json' }
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'refreshed', url: 'https://example.com/summary.json' });

    // Verify exec was called with correct script and env
    const { exec } = await import('child_process');
    expect(exec).toHaveBeenCalledWith(
      'node scripts/fetch-integrity.mjs',
      expect.objectContaining({
        env: expect.objectContaining({ INTEGRITY_URL: 'https://example.com/summary.json' })
      }),
      expect.anything()
    );
  });

  it('should trigger fetch-integrity script on valid integrity event (url)', async () => {
    const res = await request(app)
      .post('/events')
      .send({
        type: 'integrity.summary.published.v1',
        payload: { url: 'https://example.com/reports/integrity/summary.json' }
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'refreshed', url: 'https://example.com/reports/integrity/summary.json' });

    // Verify exec was called with correct script and env
    const { exec } = await import('child_process');
    expect(exec).toHaveBeenCalledWith(
      'node scripts/fetch-integrity.mjs',
      expect.objectContaining({
        env: expect.objectContaining({ INTEGRITY_URL: 'https://example.com/reports/integrity/summary.json' })
      }),
      expect.anything()
    );
  });

  it('should reject integrity event without url or summary_url', async () => {
    const res = await request(app)
      .post('/events')
      .send({
        type: 'integrity.summary.published.v1',
        payload: {}
      });

    expect(res.status).toBe(400);
  });

  it('should trigger fetch-observatory script on valid observatory event', async () => {
    const res = await request(app)
      .post('/events')
      .send({
        type: 'knowledge.observatory.published.v1',
        payload: {
            url: 'https://github.com/heimgewebe/semantAH/releases/download/v1/observatory.json',
            sha: 'abcdef123456',
            schema_ref: 'https://schemas.heimgewebe.org/test.json'
        }
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'refreshed', url: 'https://github.com/heimgewebe/semantAH/releases/download/v1/observatory.json' });

    // Verify exec was called with correct script and env
    const { exec } = await import('child_process');
    expect(exec).toHaveBeenCalledWith(
      'node scripts/fetch-observatory.mjs',
      expect.objectContaining({
        env: expect.objectContaining({
            OBSERVATORY_URL: 'https://github.com/heimgewebe/semantAH/releases/download/v1/observatory.json',
            OBSERVATORY_SHA: 'abcdef123456',
            OBSERVATORY_SCHEMA_REF: 'https://schemas.heimgewebe.org/test.json'
        })
      }),
      expect.anything()
    );
  });

  it('should accept and save valid plexer delivery report', async () => {
    const report = {
        counts: { pending: 5, failed: 0 },
        last_error: null,
        last_retry_at: new Date().toISOString()
    };

    const res = await request(app)
      .post('/events')
      .send({
        type: 'plexer.delivery.report.v1',
        payload: report
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'saved' });
  });

  it('should reject invalid plexer delivery report (schema violation)', async () => {
    const report = {
        counts: { pending: -1 }, // Invalid negative
    };

    const res = await request(app)
      .post('/events')
      .send({
        type: 'plexer.delivery.report.v1',
        payload: report
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Schema violation');
  });
});
