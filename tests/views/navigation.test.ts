import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderFile } from 'ejs';
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

const navViews = [
  'index.ejs',
  'bureau.ejs',
  'checkouts.ejs',
  'observatory.ejs',
  'ecosystem-map.ejs',
  'repobriefs.ejs',
  'anatomy.ejs',
  'timeline.ejs',
  'insights.ejs',
  'reflexion.ejs',
  'ops.ejs',
  'intent.ejs',
];

const viewsRoot = join(process.cwd(), 'src', 'views');
const navPartial = join(viewsRoot, '_nav.ejs');

function readView(file: string): string {
  return readFileSync(join(viewsRoot, file), 'utf-8');
}

describe('canonical navigation parity', () => {
  it.each(navViews)('%s consumes the shared shell without a private nav copy', (file) => {
    const view = readView(file);
    expect(view).toContain("<%- include('_nav') %>");
    expect(view).toContain('href="/assets/shell.css"');
    expect(view).toContain('src="/assets/shell.mjs"');
    expect(view).not.toContain('<nav aria-label="Hauptnavigation">');
  });

  it('the shared partial exposes the canonical read-only route set', () => {
    const partial = readFileSync(navPartial, 'utf-8');
    for (const route of canonicalRoutes) {
      expect(partial).toContain(`href: '${route}'`);
    }
    expect(partial).not.toContain('<form');
    expect(partial).not.toContain('method="post"');
    expect(partial).not.toContain('data-action');
  });

  it.each(canonicalRoutes)('marks only %s as the active canonical route', async (route) => {
    const html = await renderFile(navPartial, { currentPath: route });
    const activeMatches = [
      ...html.matchAll(/<a class="leitstand-nav__link active"\s+href="([^"]+)"\s+aria-current="page">/g),
    ].map((match) => match[1]);
    expect(activeMatches).toEqual([route]);
  });

  it.each(['/intent', '/intent/example'])('maps %s back to the Observatorium section', async (currentPath) => {
    const html = await renderFile(navPartial, { currentPath });
    expect(html).toMatch(/href="\/observatory"\s+aria-current="page"/);
  });

  it('provides progressive mobile navigation and a keyboard skip target', () => {
    const partial = readFileSync(navPartial, 'utf-8');
    const css = readFileSync(join(process.cwd(), 'src', 'public', 'shell.css'), 'utf-8');
    const script = readFileSync(join(process.cwd(), 'src', 'public', 'shell.mjs'), 'utf-8');

    expect(partial).toContain('data-leitstand-nav-toggle');
    expect(partial).toContain('aria-controls="leitstand-nav-links"');
    expect(partial).toContain('href="#leitstand-content"');
    expect(partial).toContain('id="leitstand-content"');
    expect(css).toContain('@media (max-width: 960px)');
    expect(css).toContain('prefers-reduced-motion');
    expect(script).toContain("event.key === 'Escape'");
    expect(script).toContain("window.matchMedia('(max-width: 960px)')");
  });

  it('copies the shared shell into the supported static mirror', () => {
    const buildScript = readFileSync(join(process.cwd(), 'scripts', 'build-static.mjs'), 'utf-8');

    expect(buildScript).toContain('const STATIC_ASSETS = ["shell.css", "shell.mjs"]');
    expect(buildScript).toContain('copyFile(join(ROOT, "src", "public", name), join(assetsOut, name))');
    expect(buildScript).toContain('await copyStaticAssets()');
    expect(buildScript).toContain('{ currentPath: "/" }');
    expect(buildScript).toContain('currentPath: "/observatory"');
    expect(buildScript).toContain('{ currentPath: "/intent" }');
  });
});
