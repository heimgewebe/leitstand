import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ejs from 'ejs';
import { describe, expect, it } from 'vitest';

describe('ecosystem-map view', () => {
  it('renders a local read-only SVG canvas while preserving source identity and freshness', async () => {
    const commit = 'a'.repeat(40);
    const html = await ejs.renderFile(
      join(process.cwd(), 'src/views/ecosystem-map.ejs'),
      {
        map: {
          path: 'rendered/ecosystem-registry-map.mmd',
          bytes: 42,
          sha256: 'b'.repeat(64),
          content: 'flowchart TD\n  repo_bureau["Bureau"]\n',
          missing_reason: null,
        },
        cross_links: [],
        cross_link_meta: {
          source_kind: 'artifact',
          source_path: '/tmp/cross-links.json',
          missing_reason: 'ok',
          does_not_establish: [],
        },
        view_meta: {
          source_kind: 'artifact',
          missing_reason: 'ok',
          manifest_path: '/tmp/manifest.json',
          source_root: '/tmp/systemkatalog',
          source_repository: 'heimgewebe/systemkatalog',
          source_commit: commit,
          generated_at: '2026-07-14T00:00:00Z',
          data_age_minutes: 12,
          freshness_state: 'fresh',
          stale_after_hours: 168,
          does_not_establish: ['runtime_correctness'],
        },
        node_navigation_json: '[{"mermaid_id":"repo_bureau","href":"/bureau"}]',
      },
      { async: true, localsName: 'locals' },
    );

    expect(html).toContain('data-ecosystem-map-canvas');
    expect(html).toContain('data-ecosystem-map-source');
    expect(html).toContain('data-ecosystem-map-navigation');
    expect(html).toContain('/assets/ecosystem-map.mjs');
    expect(html).toContain(commit);
    expect(html).toContain('fresh · 12 min');
    expect(html).not.toContain('cdn.jsdelivr');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('contenteditable');
  });

  it('uses the lockfile-local Mermaid module with strict rendering and no remote fetch', async () => {
    const browserModule = await readFile(
      join(process.cwd(), 'src/public/ecosystem-map.mjs'),
      'utf-8',
    );

    expect(browserModule).toContain("from '/vendor/mermaid/mermaid.esm.min.mjs'");
    expect(browserModule).toContain("securityLevel: 'strict'");
    expect(browserModule).toContain("setAttribute('role', 'link')");
    expect(browserModule).not.toContain('fetch(');
    expect(browserModule).not.toContain('contenteditable');
  });
});
