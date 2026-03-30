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

describe('GET /insights', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render the insights view when the controller succeeds', async () => {
    const insightsController = await import('../src/controllers/insights.js');
    vi.spyOn(insightsController, 'getInsightsData').mockResolvedValueOnce({
      insights: {
        ts: '2026-03-30',
        topics: [['leitstand', 0.8]],
        questions: ['What changed?'],
        deltas: ['New insights route wired'],
        metadata: { observatory_ref: 'obs-001', uncertainty: 0.2 },
      },
      view_meta: {
        source_kind: 'artifact',
        missing_reason: 'ok',
        is_strict: false,
        data_timestamp: '2026-03-30T10:00:00.000Z',
        data_age_minutes: 120,
        freshness_state: 'fresh',
        freshness_source: 'metadata.generated_at',
        freshness_degraded: false,
        stale_after_hours: 30,
        uncertainty: 0.2,
        observatory_ref: 'obs-001',
      },
    });

    const res = await request(app).get('/insights');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Erkenntnisse');
    expect(res.text).toContain('New insights route wired');
  });

  it('should show transport-time wording when freshness falls back to mtime', async () => {
    const insightsController = await import('../src/controllers/insights.js');
    vi.spyOn(insightsController, 'getInsightsData').mockResolvedValueOnce({
      insights: {
        ts: '',
        topics: [['leitstand', 0.6]],
        questions: [],
        deltas: [],
        metadata: { observatory_ref: 'obs-transport' },
      },
      view_meta: {
        source_kind: 'artifact',
        missing_reason: 'ok',
        is_strict: false,
        data_timestamp: '2026-03-30T06:00:00.000Z',
        data_age_minutes: 360,
        freshness_state: 'fresh',
        freshness_source: 'mtime',
        freshness_degraded: true,
        stale_after_hours: 30,
        uncertainty: null,
        observatory_ref: 'obs-transport',
      },
    });

    const res = await request(app).get('/insights');

    expect(res.status).toBe(200);
    expect(res.text).toContain('via mtime (Transportzeit)');
    expect(res.text).toContain('degradierter Fallback');
  });

  it('should return generic 503 Service Unavailable on strict mode failure', async () => {
    const insightsController = await import('../src/controllers/insights.js');
    vi.spyOn(insightsController, 'getInsightsData').mockRejectedValueOnce(new Error('Strict Fail: SENSITIVE_PATH_LEAK'));

    const res = await request(app).get('/insights');

    expect(res.status).toBe(503);
    expect(res.text).toBe('Service Unavailable');
    expect(res.text).not.toContain('SENSITIVE_PATH');
  });
});

describe('GET /timeline – until UTC contract', () => {
  const minimalTimelineData = () => ({
    events: [],
    view_meta: {
      source_kind: 'fixture' as const,
      window_state: 'empty_window',
      missing_reason: 'chronik_enoent',
      is_strict: false,
      hours_back: 48,
      max_events: 200,
      total_loaded: 0,
      replay_mode: false,
      replay_until: null,
      since: '2026-01-01T00:00:00.000Z',
      until: '2026-01-03T00:00:00.000Z',
    },
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should forward a valid Date to getTimelineData when until has explicit UTC (Z suffix)', async () => {
    const timelineController = await import('../src/controllers/timeline.js');
    vi.spyOn(timelineController, 'getTimelineData').mockResolvedValueOnce(minimalTimelineData());

    await request(app).get('/timeline?until=2026-01-01T12:00:00.000Z');

    expect(timelineController.getTimelineData).toHaveBeenCalledOnce();
    const untilArg = vi.mocked(timelineController.getTimelineData).mock.calls[0][2];
    expect(untilArg).toBeInstanceOf(Date);
    expect((untilArg as Date).toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });

  it('should pass undefined to getTimelineData when until has no explicit TZ indicator', async () => {
    const timelineController = await import('../src/controllers/timeline.js');
    vi.spyOn(timelineController, 'getTimelineData').mockResolvedValueOnce(minimalTimelineData());

    await request(app).get('/timeline?until=2026-01-01T14:00');

    expect(timelineController.getTimelineData).toHaveBeenCalledOnce();
    const untilArg = vi.mocked(timelineController.getTimelineData).mock.calls[0][2];
    expect(untilArg).toBeUndefined();
  });

  it('should pass undefined to getTimelineData when until param is absent', async () => {
    const timelineController = await import('../src/controllers/timeline.js');
    vi.spyOn(timelineController, 'getTimelineData').mockResolvedValueOnce(minimalTimelineData());

    await request(app).get('/timeline');

    expect(timelineController.getTimelineData).toHaveBeenCalledOnce();
    const untilArg = vi.mocked(timelineController.getTimelineData).mock.calls[0][2];
    expect(untilArg).toBeUndefined();
  });
});
