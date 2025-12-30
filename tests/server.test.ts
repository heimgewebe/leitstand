import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';

describe('POST /events', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should allow request with correct Bearer token', async () => {
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'valid-token');

    const res = await request(app)
      .post('/events')
      .set('Authorization', 'Bearer valid-token')
      .send({ kind: 'test.event', payload: {} });

    expect(res.status).toBe(200);
  });

  it('should allow request with correct X-Events-Token', async () => {
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'valid-token');

    const res = await request(app)
      .post('/events')
      .set('X-Events-Token', 'valid-token')
      .send({ kind: 'test.event', payload: {} });

    expect(res.status).toBe(200);
  });

  it('should reject request with invalid token (401)', async () => {
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'valid-token');

    const res = await request(app)
      .post('/events')
      .set('Authorization', 'Bearer wrong-token')
      .send({ kind: 'test.event' });

    expect(res.status).toBe(401);
  });

  it('should reject request with missing token when token is configured (401)', async () => {
    vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'valid-token');

    const res = await request(app)
      .post('/events')
      .send({ kind: 'test.event' });

    expect(res.status).toBe(401);
  });

  it('should be disabled in STRICT mode if no token configured (403)', async () => {
    vi.stubEnv('LEITSTAND_STRICT', '1');
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
});
