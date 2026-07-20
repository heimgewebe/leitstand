import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const VIEWS = [
  'index.ejs',
  'bureau.ejs',
  'checkouts.ejs',
  'repobriefs.ejs',
  'storage-health.ejs',
  'ecosystem-map.ejs',
] as const;

async function readView(name: (typeof VIEWS)[number]): Promise<string> {
  return readFile(join(ROOT, 'src', 'views', name), 'utf-8');
}

function inlineCss(view: string): string {
  return [...view.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
}

describe('LSV-V1-T008 shared UI system', () => {
  it('loads the shared shell and UI assets through one versioned head partial', async () => {
    const head = await readFile(join(ROOT, 'src', 'views', '_ui-head.ejs'), 'utf-8');
    expect(head).toContain('/assets/shell.css');
    expect(head).toContain('/assets/ui-system.css');
    expect(head.indexOf('/assets/shell.css')).toBeLessThan(head.indexOf('/assets/ui-system.css'));

    for (const name of VIEWS) {
      const view = await readView(name);
      expect(view).toContain("include('_ui-head')");
      expect(view).not.toContain('href="/assets/shell.css"');
      expect(view).not.toMatch(/style="[^"]+"/);
    }
  });

  it('keeps shared foundations out of view-specific style blocks', async () => {
    for (const name of VIEWS) {
      const css = inlineCss(await readView(name));
      expect(css, name).not.toMatch(/(^|\n)\s*body\s*\{/);
      expect(css, name).not.toMatch(/(^|\n)\s*main\s*\{/);
      expect(css, name).not.toMatch(/(^|\n)\s*\.meta-grid\s*\{/);
      expect(css, name).not.toMatch(/(^|\n)\s*\.label\s*\{/);
    }
    expect(inlineCss(await readView('repobriefs.ejs'))).toBe('');
  });

  it('defines focus, action sizing, responsive and reduced-motion contracts centrally', async () => {
    const css = await readFile(join(ROOT, 'src', 'public', 'ui-system.css'), 'utf-8');
    expect(css).toContain('--ui-bg:');
    expect(css).toContain('--ui-border:');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.ui-provenance');
  });

  it('places primary operational content before collapsible technical provenance', async () => {
    const cases = [
      ['bureau.ejs', '<section class="board"'],
      ['checkouts.ejs', '<section class="card table-wrap"'],
      ['repobriefs.ejs', 'data-repo="<%= bundle.repo %>"'],
    ] as const;

    for (const [name, marker] of cases) {
      const view = await readView(name);
      expect(view.indexOf(marker), name).toBeGreaterThan(-1);
      expect(view.indexOf('.ui-provenance'), name).toBe(-1);
      expect(view.indexOf('ui-provenance'), name).toBeGreaterThan(view.indexOf(marker));
    }
  });
});
