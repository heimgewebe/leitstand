import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ejs from 'ejs';
import { describe, expect, it } from 'vitest';

describe('ecosystem-map view', () => {
  it('renders verified artifact alignment separately from age and repository progress', async () => {
    const commit = 'a'.repeat(40);
    const head = 'c'.repeat(40);
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
          source_head: head,
          commits_ahead: 4,
          alignment_state: 'compatible',
          alignment_reason: 'current_head_preserves_declared_artifact_bytes',
          verified_artifact_count: 5,
          generated_at: '2026-07-14T00:00:00Z',
          data_age_minutes: 12,
          freshness_state: 'fresh',
          freshness_reason: 'artifact_alignment_verified',
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
    expect(html).toContain(head);
    expect(html).toContain('Inhalt aktuell, Repository weiterentwickelt');
    expect(html).toContain('4 spätere Commits');
    expect(html).toContain('aktuelle HEAD und der Arbeitsbaum enthalten weiterhin exakt dieselben fünf Kartenartefakte');
    expect(html).toContain('compatible · 5/5 Artefakte');
    expect(html).toContain('fresh · artifact_alignment_verified');
    expect(html).toContain('12 min · Grenze 168 h');
    expect(html).not.toContain('cdn.jsdelivr');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('contenteditable');
  });

  it('renders an explicit drift warning instead of presenting an age-only fresh label', async () => {
    const html = await ejs.renderFile(
      join(process.cwd(), 'src/views/ecosystem-map.ejs'),
      {
        map: null,
        cross_links: [],
        cross_link_meta: {
          source_kind: 'artifact',
          source_path: '/tmp/cross-links.json',
          missing_reason: 'ok',
          does_not_establish: [],
        },
        view_meta: {
          source_kind: 'missing',
          missing_reason: 'artifact_integrity_mismatch',
          manifest_path: '/tmp/manifest.json',
          source_root: '/tmp/systemkatalog',
          source_repository: 'heimgewebe/systemkatalog',
          source_commit: 'a'.repeat(40),
          source_head: 'c'.repeat(40),
          commits_ahead: null,
          alignment_state: 'drifted',
          alignment_reason: 'current_artifact_mismatch:rendered/ecosystem-registry-map.mmd',
          verified_artifact_count: 4,
          generated_at: '2026-07-14T00:00:00Z',
          data_age_minutes: 12,
          freshness_state: 'stale',
          freshness_reason: 'current_artifact_mismatch:rendered/ecosystem-registry-map.mmd',
          stale_after_hours: 168,
          does_not_establish: ['runtime_correctness'],
        },
        node_navigation_json: '[]',
      },
      { async: true, localsName: 'locals' },
    );

    expect(html).toContain('Drift erkannt');
    expect(html).toContain('current_artifact_mismatch:rendered/ecosystem-registry-map.mmd');
    expect(html).toContain('stale · current_artifact_mismatch:rendered/ecosystem-registry-map.mmd');
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
