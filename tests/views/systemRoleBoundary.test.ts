import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath: string): string => readFileSync(resolve(root, relativePath), 'utf8');

describe('System role source boundary', () => {
  it('keeps current Leitstand surfaces free of unmarked organism-role claims', () => {
    const currentSurfaces = [
      'README.md',
      'src/views/index.ejs',
      'src/views/timeline.ejs',
      'src/controllers/dashboard.ts',
      'src/server.ts',
      'src/anatomy.ts',
    ].map(read).join('\n');

    expect(currentSurfaces).not.toMatch(/Heimgewebe[- ](?:organism|organismus)/i);
    expect(currentSurfaces).not.toContain('Strukturmodell des Organismus');
    expect(currentSurfaces).toContain('Systemkatalog');
  });

  it('marks the legacy anatomy surface and fixture as historical and non-normative', () => {
    const view = read('src/views/anatomy.ejs');
    expect(view).toContain('Historischer, nicht normativer Strukturstand.');
    expect(view).toContain('href="/ecosystem-map"');
    expect(view).toContain('Systemkarte aus dem Systemkatalog');

    const fixture = JSON.parse(read('src/fixtures/anatomy.snapshot.json')) as {
      nodes: Array<{ role: string; description: string }>;
    };
    expect(fixture.nodes.length).toBeGreaterThan(0);
    for (const node of fixture.nodes) {
      expect(node.role).toMatch(/^Historisch: /);
      expect(node.description).toMatch(/^Historischer, nicht normativer Fixture-Stand\. /);
    }
  });
});
