import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';

const oldPath = process.env.LEITSTAND_STORAGE_HEALTH_PATH;
const oldFallback = process.env.LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  vi.unstubAllEnvs();
  restore('LEITSTAND_STORAGE_HEALTH_PATH', oldPath);
  restore('LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK', oldFallback);
});

describe('GET /storage-health', () => {
  it('renders the bounded read-only surface from explicit fixture data', async () => {
    vi.stubEnv('LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK', 'true');
    delete process.env.LEITSTAND_STORAGE_HEALTH_PATH;
    const response = await request(app).get('/storage-health');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Speicherzustand – Leitstand</title>');
    expect(response.text).toContain('Beobachtung, keine Wirkung.');
    expect(response.text).toContain('Größte Erzeuger');
    expect(response.text).toContain('Deduplizierte Meldungen');
    expect(response.text).toContain('href="/storage-health"');
    expect(response.text).toContain('aria-current="page"');
  });

  it('renders missing runtime evidence as degraded rather than failing or claiming green', async () => {
    vi.stubEnv('LEITSTAND_STORAGE_HEALTH_PATH', '/tmp/leitstand-storage-health-definitely-missing.json');
    const response = await request(app).get('/storage-health');
    expect(response.status).toBe(200);
    expect(response.text).toContain('storage_health_missing');
    expect(response.text).toContain('Kein gültiges Speicherzustands-Artefakt verfügbar');
    expect(response.text).not.toContain('Keine Verstöße beobachtet.');
  });
});
