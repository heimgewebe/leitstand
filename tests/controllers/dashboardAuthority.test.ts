import { describe, expect, it } from 'vitest';
import { getDashboardData } from '../../src/controllers/dashboard.js';

describe('dashboard authority boundaries', () => {
  it('names the primary source and non-authoritative boundary for every general panel', async () => {
    const { sources } = await getDashboardData();
    const byId = Object.fromEntries(sources.map((source) => [source.id, source]));

    expect(byId.bureau.primary_source).toBe('Bureau');
    expect(byId.checkouts.primary_source).toBe('Grabowski');
    expect(byId.storage_health.primary_source).toBe('Storage-Health-Producer');
    expect(byId.ecosystem_map.primary_source).toBe('Systemkatalog');
    expect(byId.repo_ground.primary_source).toBe('RepoGround');

    for (const source of sources) {
      expect(source.primary_source.length).toBeGreaterThan(0);
      expect(source.authority_boundary).toContain('Nur Projektion');
      expect(source.authority_boundary).toContain('bleibt bei');
    }
  });
});
