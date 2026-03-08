import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { resetEnvConfig } from '../src/config.js';
import { resetValidators, validatePlexerReport } from '../src/validation/validators.js';

// Mock validation
vi.mock('../src/validation/validators.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/validation/validators.js')>();
  return {
    ...actual,
    validatePlexerReport: vi.fn(actual.validatePlexerReport)
  };
});

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
    resetValidators(); // Clean up cached validators
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfig(); // Clean up
    resetValidators(); // Clean up
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
    // 64-char hex SHA for strict validation
    const validSha = 'a'.repeat(64);

    const res = await request(app)
      .post('/events')
      .send({
        type: 'knowledge.observatory.published.v1',
        payload: {
            url: 'https://github.com/heimgewebe/semantAH/releases/download/v1/observatory.json',
            sha: validSha,
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
            OBSERVATORY_SHA: validSha,
            OBSERVATORY_SCHEMA_REF: 'https://schemas.heimgewebe.org/test.json'
        })
      }),
      expect.anything()
    );
  });

  it('should accept and save valid plexer delivery report', async () => {
    // Explicitly set strict mode to '0' to avoid potential flakiness if validator is missing
    vi.stubEnv('LEITSTAND_STRICT', '0');
    resetEnvConfig();
    resetValidators();

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
    expect(res.body.details).toBeDefined();
    expect(typeof res.body.details).toBe('string');
  });

  it('should return 503 Service Unavailable without details on plexer validator missing', async () => {
    vi.stubEnv('LEITSTAND_STRICT', '1');
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'test-token');
    resetEnvConfig();

    vi.mocked(validatePlexerReport).mockReturnValueOnce({ valid: false, error: 'Schema missing', status: 503 });

    const res = await request(app)
      .post('/events')
      .set('Authorization', 'Bearer test-token')
      .send({
        type: 'plexer.delivery.report.v1',
        payload: { counts: { pending: 0, failed: 0 } }
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Service Unavailable');
    expect(res.body.details).toBeUndefined();
  });

  it('should return 500 Validation unavailable without details on plexer validator compile failure', async () => {
    vi.stubEnv('LEITSTAND_STRICT', '1');
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'test-token');
    resetEnvConfig();

    vi.mocked(validatePlexerReport).mockReturnValueOnce({ valid: false, error: 'Failed to compile validator', status: 500 });

    const res = await request(app)
      .post('/events')
      .set('Authorization', 'Bearer test-token')
      .send({
        type: 'plexer.delivery.report.v1',
        payload: { counts: { pending: 0, failed: 0 } }
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Validation unavailable');
    expect(res.body.details).toBeUndefined();
  });

  it('should return 500 without details on observatory refresh failure', async () => {
    const { exec } = await import('child_process');
    vi.mocked(exec).mockImplementationOnce((cmd, opts, callback) => {
      const cb = typeof opts === 'function' ? opts : callback;
      if (cb) cb(new Error('SENSITIVE_INFO_DO_NOT_LEAK'), '', 'Internal Error');
      return { stdout: { on: () => {} }, stderr: { on: () => {} } } as unknown as import('child_process').ChildProcess;
    });

    const res = await request(app)
      .post('/events')
      .send({
        type: 'knowledge.observatory.published.v1',
        payload: {
            url: 'https://github.com/heimgewebe/semantAH/releases/download/v1/observatory.json'
        }
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Refresh failed');
    expect(res.body.details).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('SENSITIVE_INFO');
  });

  it('should return 500 without details on integrity refresh failure', async () => {
    const { exec } = await import('child_process');
    vi.mocked(exec).mockImplementationOnce((cmd, opts, callback) => {
      const cb = typeof opts === 'function' ? opts : callback;
      if (cb) cb(new Error('SENSITIVE_INFO_DO_NOT_LEAK'), '', 'Internal Error');
      return { stdout: { on: () => {} }, stderr: { on: () => {} } } as unknown as import('child_process').ChildProcess;
    });

    const res = await request(app)
      .post('/events')
      .send({
        type: 'integrity.summary.published.v1',
        payload: { summary_url: 'https://example.com/summary.json' }
      });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Refresh failed');
    expect(res.body.details).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('SENSITIVE_INFO');
  });
});

describe('GET /observatory', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfig();
  });

  it('should return generic 503 Service Unavailable on strict mode failure', async () => {
    // Force a strict failure by stubbing getObservatoryData to throw a strict message
    const observatoryController = await import('../src/controllers/observatory.js');
    vi.spyOn(observatoryController, 'getObservatoryData').mockRejectedValueOnce(new Error('Strict Fail: SENSITIVE_PATH_LEAK'));

    const res = await request(app).get('/observatory');

    expect(res.status).toBe(503);
    expect(res.text).toBe('Service Unavailable');
    expect(res.text).not.toContain('SENSITIVE_PATH');
  });
});
