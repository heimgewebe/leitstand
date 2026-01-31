import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

const execPromise = promisify(exec);

describe('scripts/fetch-observatory.mjs', () => {
    let server;
    let port;
    let baseUrl;
    let testDir;
    let artifactPath;

    // Deterministic content for SHA test
    const staticContent = JSON.stringify({
        generated_at: "2023-01-01T00:00:00.000Z",
        source: "test-static",
        observatory_id: "test-static-id",
        topics: [{ name: "t1" }],
        signals: {},
        blind_spots: [],
        considered_but_rejected: []
    });
    const staticSha = createHash('sha256').update(staticContent).digest('hex');

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
        app.get('/static.json', (req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.send(staticContent);
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

        testDir = join(tmpdir(), `leitstand-test-script-${Date.now()}`);
        await mkdir(testDir, { recursive: true });
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

        const { stdout } = await execPromise(cmd, { env, cwd: process.cwd() });
        expect(stdout).toContain('Fetch complete');
        expect(stdout).toContain('Validated against schema');
        expect(stdout).toContain('Artifact valid');
    }, 10000);

    it('should verify SHA checksum if provided (failure case)', async () => {
        const cmd = `node scripts/fetch-observatory.mjs`;
        // Valid SHA format (64 chars) but wrong value
        const wrongSha = 'a'.repeat(64);

        const env = {
            ...process.env,
            OBSERVATORY_URL: `${baseUrl}/valid.json`,
            OBSERVATORY_ARTIFACT_PATH: artifactPath,
            LEITSTAND_STRICT: '1',
            OBSERVATORY_SHA: wrongSha
        };

        try {
            await execPromise(cmd, { env, cwd: process.cwd() });
            throw new Error("Script should have failed due to SHA mismatch");
        } catch (error: any) {
            expect(error.code).not.toBe(0);
            expect(error.stderr).toContain('SHA mismatch');
        }
    }, 10000);

    it('should reject SCHEMA_REF with a non-allowlisted hostname', async () => {
        const cmd = `node scripts/fetch-observatory.mjs`;

        const env = {
            ...process.env,
            OBSERVATORY_URL: `${baseUrl}/valid.json`,
            OBSERVATORY_ARTIFACT_PATH: artifactPath,
            LEITSTAND_STRICT: '1',
            OBSERVATORY_SCHEMA_REF: 'https://evil.example.test/schema.json',
            // default is schemas.heimgewebe.org; set explicitly to avoid surprises
            OBSERVATORY_SCHEMA_REF_ALLOWED_HOSTS: 'schemas.heimgewebe.org'
        };

        try {
            await execPromise(cmd, { env, cwd: process.cwd() });
            throw new Error("Script should have failed due to SCHEMA_REF allowlist violation");
        } catch (error: any) {
            expect(error.code).not.toBe(0);
            const output = (error.stderr || '') + (error.stdout || '');
            // Either the hostname message or the wrapper "Invalid SCHEMA_REF" is acceptable
            expect(output).toMatch(/not in allowlist|Invalid SCHEMA_REF/i);
        }
    }, 10000);

    it('should accept SCHEMA_REF with an allowlisted hostname', async () => {
        const cmd = `node scripts/fetch-observatory.mjs`;

        const env = {
            ...process.env,
            OBSERVATORY_URL: `${baseUrl}/valid.json`,
            OBSERVATORY_ARTIFACT_PATH: artifactPath,
            LEITSTAND_STRICT: '1',
            OBSERVATORY_SCHEMA_REF: 'https://trusted.example.test/schema.json',
            OBSERVATORY_SCHEMA_REF_ALLOWED_HOSTS: 'trusted.example.test, other.test'
        };

        await execPromise(cmd, { env, cwd: process.cwd() });

        // Verify artifact was created (implicit success check)
        expect(existsSync(artifactPath)).toBe(true);
    }, 10000);

    it('should verify SHA checksum if provided (success case)', async () => {
        const cmd = `node scripts/fetch-observatory.mjs`;
        const env = {
            ...process.env,
            OBSERVATORY_URL: `${baseUrl}/static.json`,
            OBSERVATORY_ARTIFACT_PATH: artifactPath,
            LEITSTAND_STRICT: '1',
            OBSERVATORY_SHA: staticSha
        };

        const { stdout } = await execPromise(cmd, { env, cwd: process.cwd() });
        expect(stdout).toContain(`SHA verified: ${staticSha}`);
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
            await execPromise(cmd, { env, cwd: process.cwd() });
            throw new Error("Script should have failed");
        } catch (error: any) {
            expect(error.code).not.toBe(0);
            // exec error might put output in stdout or stderr depending on how it failed
            const output = (error.stderr || '') + (error.stdout || '');
            expect(output).toContain('Schema violation');
            // Check specific errors
            expect(output).toContain('source');
            // generated_at is just invalid date format in this case, might fail differently?
            // "generated_at": "not-a-date" -> format: date-time violation
        }
    }, 10000);
});
