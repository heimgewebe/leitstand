import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { resetEnvConfig } from '../src/config.js';
import { isLoopbackAddress } from '../src/utils/network.js';

describe('Security Fix: Event Authentication Localhost Restriction', () => {
  describe('Unit Tests: isLoopbackAddress', () => {
    it('should return true for localhost IPv4', () => {
      expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    });

    it('should return true for localhost IPv6', () => {
      expect(isLoopbackAddress('::1')).toBe(true);
    });

    it('should return true for IPv4-mapped localhost IPv6', () => {
      expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    });

    it('should return false for remote IPv4', () => {
      expect(isLoopbackAddress('192.168.1.10')).toBe(false);
      expect(isLoopbackAddress('10.0.0.5')).toBe(false);
      expect(isLoopbackAddress('203.0.113.7')).toBe(false);
    });

    it('should return false for undefined or empty address', () => {
      expect(isLoopbackAddress(undefined)).toBe(false);
      expect(isLoopbackAddress('')).toBe(false);
    });
  });

  describe('Integration Tests: /events Route', () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
      resetEnvConfig();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      resetEnvConfig();
    });

    it('should allow unauthenticated request from localhost in permissive mode', async () => {
      vi.stubEnv('LEITSTAND_STRICT', '0');
      vi.stubEnv('NODE_ENV', 'development');
      resetEnvConfig();

      // supertest uses internal address (usually ::ffff:127.0.0.1 or 127.0.0.1)
      const res = await request(app)
        .post('/events')
        .send({ type: 'test.event', payload: {} });

      // Should be allowed because supertest requests are local
      expect(res.status).toBe(200);
    });

    it('should still allow remote access with a valid token regardless of origin', async () => {
      vi.stubEnv('LEITSTAND_EVENTS_TOKEN', 'secret-token');
      resetEnvConfig();

      const res = await request(app)
        .post('/events')
        .set('Authorization', 'Bearer secret-token')
        .send({ type: 'test.event', payload: {} });

      // Token bypasses the localhost check
      expect(res.status).toBe(200);
    });

    it('should reject unauthenticated request when LEITSTAND_STRICT is 1', async () => {
      vi.stubEnv('LEITSTAND_STRICT', '1');
      resetEnvConfig();

      const res = await request(app)
        .post('/events')
        .send({ type: 'test.event', payload: {} });

      expect(res.status).toBe(403);
    });
  });
});
