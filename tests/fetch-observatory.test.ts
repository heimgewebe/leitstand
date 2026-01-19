import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';

const execPromise = promisify(exec);

describe('scripts/fetch-observatory.mjs', () => {
    let server;
    let port;
    let baseUrl;
    let testDir;
    let artifactPath;

    beforeAll(async () => {
        // Setup simple server to serve JSON artifacts
        const app = express();
        app.get('/valid.json', (req, res) => {
            res.json({
                generated_at: new Date().toISOString(),
                source: "test-source",
                observatory_id: "test-obs",
                topics: [{ name: "t1" }],
                signals: {},
                blind_spots: [],
                considered_but_rejected: []
            });
        });
        app.get('/invalid.json', (req, res) => {
            res.json({
                generated_at: "not-a-date",
                source: "", // minLength violation
                // missing required fields
            });
        });

        await new Promise((resolve) => {
            server = app.listen(0, () => {
                port = server.address().port;
                baseUrl = `http://localhost:${port}`;
                resolve();
            });
        });

        testDir = await mkdir(join(tmpdir(), `leitstand-test-script-${Date.now()}`), { recursive: true });
        artifactPath = join(testDir, 'observatory.json');
    });

    afterAll(async () => {
        server.close();
        if (testDir) {
            // cleanup if needed, though usually tmp is fine
            // await rm(testDir, { recursive: true, force: true });
        }
    });

    it('should validate and download a valid artifact', async () => {
        const cmd = `node scripts/fetch-observatory.mjs`;
        const env = {
            ...process.env,
            OBSERVATORY_URL: `${baseUrl}/valid.json`,
            OBSERVATORY_ARTIFACT_PATH: artifactPath,
            LEITSTAND_STRICT: '1' // Enforce strict validation
        };

        const { stdout, stderr } = await execPromise(cmd, { env });
        expect(stdout).toContain('Fetch complete');
        expect(stdout).toContain('Validated against schema');
        expect(stdout).toContain('Artifact valid');
    }, 10000);

    it('should verify SHA checksum if provided', async () => {
        // Pre-calculate SHA for valid.json response
        // Note: Express res.json() serialization is usually deterministic but spacing might vary.
        // For robustness, we can just assume the content or calculate it if possible.
        // Or simpler: use a static file server?
        // Let's assume standard JSON stringify.
        const validObj = {
            generated_at: new Date().toISOString(), // This will drift if we call new Date() again inside the test
            source: "test-source",
            observatory_id: "test-obs",
            topics: [{ name: "t1" }],
            signals: {},
            blind_spots: [],
            considered_but_rejected: []
        };
        // We can't easily predict the exact bytes served by express res.json() without controlling it fully.
        // Let's skip SHA matching for the "success" case unless we serve a static buffer.
        // Instead, let's test the FAILURE case (mismatch) which is easier.

        const cmd = `node scripts/fetch-observatory.mjs`;
        const env = {
            ...process.env,
            OBSERVATORY_URL: `${baseUrl}/valid.json`,
            OBSERVATORY_ARTIFACT_PATH: artifactPath,
            LEITSTAND_STRICT: '1',
            OBSERVATORY_SHA: 'invalid-sha-123'
        };

        try {
            await execPromise(cmd, { env });
            throw new Error("Script should have failed due to SHA mismatch");
        } catch (error) {
            expect(error.code).not.toBe(0);
            expect(error.stderr).toContain('SHA mismatch');
        }
    }, 10000);

    it('should fail strict validation for an invalid artifact', async () => {
        const cmd = `node scripts/fetch-observatory.mjs`;
        const env = {
            ...process.env,
            OBSERVATORY_URL: `${baseUrl}/invalid.json`,
            OBSERVATORY_ARTIFACT_PATH: artifactPath,
            LEITSTAND_STRICT: '1' // Enforce strict validation
        };

        try {
            await execPromise(cmd, { env });
            throw new Error("Script should have failed");
        } catch (error) {
            expect(error.code).not.toBe(0);
            expect(error.stderr).toContain('Schema violation');
            // Check specific errors
            expect(error.stderr).toContain('source');
            expect(error.stderr).toContain('generated_at');
        }
    }, 10000);
});
