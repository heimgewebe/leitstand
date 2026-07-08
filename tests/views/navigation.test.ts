import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const canonicalRoutes = [
  '/',
  '/bureau',
  '/checkouts',
  '/observatory',
  '/ecosystem-map',
  '/repobriefs',
  '/anatomy',
  '/timeline',
  '/insights',
  '/reflexion',
  '/ops',
];

const navViews: Array<{ file: string; active?: string }> = [
  { file: 'index.ejs', active: '/' },
  { file: 'bureau.ejs', active: '/bureau' },
  { file: 'checkouts.ejs', active: '/checkouts' },
  { file: 'observatory.ejs', active: '/observatory' },
  { file: 'ecosystem-map.ejs', active: '/ecosystem-map' },
  { file: 'repobriefs.ejs', active: '/repobriefs' },
  { file: 'anatomy.ejs', active: '/anatomy' },
  { file: 'timeline.ejs', active: '/timeline' },
  { file: 'insights.ejs', active: '/insights' },
  { file: 'reflexion.ejs', active: '/reflexion' },
  { file: 'ops.ejs', active: '/ops' },
  { file: 'intent.ejs' },
];

function readView(file: string): string {
  return readFileSync(join(process.cwd(), 'src', 'views', file), 'utf-8');
}

function navBlock(html: string): string {
  const match = html.match(/<nav[^>]*aria-label="Hauptnavigation"[^>]*>[\s\S]*?<\/nav>/);
  if (!match) throw new Error('missing canonical navigation block');
  return match[0];
}

describe('canonical navigation parity', () => {
  it.each(navViews)('$file exposes the canonical read-only route set', ({ file }) => {
    const nav = navBlock(readView(file));
    for (const route of canonicalRoutes) {
      expect(nav).toContain(`href="${route}"`);
    }
  });

  it.each(navViews.filter((view) => view.active))('$file marks only its active route', ({ file, active }) => {
    const nav = navBlock(readView(file));
    const activeMatches = [...nav.matchAll(/<a href="([^"]+)" class="active" aria-current="page">/g)].map((match) => match[1]);
    expect(activeMatches).toEqual([active]);
  });

  it('canonical navigation contains links only and no action forms', () => {
    for (const view of navViews) {
      const nav = navBlock(readView(view.file));
      expect(nav).not.toContain('<form');
      expect(nav).not.toContain('method="post"');
      expect(nav).not.toContain('data-action');
    }
  });
});
