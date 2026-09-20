import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('retirement truth', () => {
  it('does not list deleted repositories as current related repos', async () => {
    const meta = await readFile('repo.meta.yaml', 'utf8');
    expect(meta).not.toMatch(/^\s*- hausKI\s*$/m);
    expect(meta).not.toMatch(/^\s*- heimlern\s*$/m);
  });

  it('vendors the surviving Observatory consumer set', async () => {
    const contract = JSON.parse(
      await readFile('vendor/contracts/knowledge/observatory.schema.json', 'utf8'),
    );
    expect(contract['x-consumers']).toEqual(['leitstand']);
  });

  it('keeps the observer boundary free of retired decision authority', async () => {
    const nonGoals = await readFile('docs/architecture/non-goals.md', 'utf8');
    expect(nonGoals).not.toContain('bei HausKI');
  });
});
