import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app, __wait_for_meta_queue } from '../src/server.js';
import { resetEnvConfig } from '../src/config.js';
import { resetValidators } from '../src/validation/validators.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('POST /events concurrency', () => {
    const metaPath = path.join(process.cwd(), 'artifacts', '_meta.json');
    const artifactPath = path.join(process.cwd(), 'artifacts', 'plexer.delivery.report.json');

    beforeEach(async () => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
        resetEnvConfig();
        resetValidators();

        // Ensure clean state for artifacts
        try {
            await fs.unlink(metaPath);
        } catch {
            // Ignore ENOENT
        }
        try {
            await fs.unlink(artifactPath);
        } catch {
            // Ignore ENOENT
        }
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        resetEnvConfig();
        resetValidators();
    });

    it('should correctly handle concurrent plexer reports and maintain valid _meta.json', async () => {
        const iterations = 10;
        const promises = [];

        for (let i = 0; i < iterations; i++) {
            const report = {
                counts: { pending: i, failed: 0 },
                last_error: null,
                last_retry_at: new Date().toISOString()
            };

            promises.push(request(app)
                .post('/events')
                .send({
                    type: 'plexer.delivery.report.v1',
                    payload: report
                }));
        }

        const results = await Promise.all(promises);

        // All requests should succeed with 200
        results.forEach(res => {
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: 'saved' });
        });

        // Deterministically wait for all queued updates to finish
        await __wait_for_meta_queue();

        // Verify _meta.json integrity and existence
        const metaContent = await fs.readFile(metaPath, 'utf8');
        const meta = JSON.parse(metaContent);

        expect(meta.plexer_report).toBeDefined();
        expect(meta.plexer_report.source_kind).toBe('event');
        // The last request might not be the last write due to async jitter,
        // but it MUST be a valid JSON and have the expected structure.
    });
});
