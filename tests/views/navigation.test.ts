import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderFile } from 'ejs';
import { describe, expect, it } from 'vitest';

const canonicalRoutes = [
  '/',
  '/bureau',
  '/checkouts',
  '/storage-health',
  '/ecosystem-map',
  '/repobriefs',
];

const navViews = [
  'index.ejs',
  'bureau.ejs',
  'checkouts.ejs',
  'storage-health.ejs',
  'ecosystem-map.ejs',
  'repobriefs.ejs',
];

const viewsRoot = join(process.cwd(), 'src', 'views');
const navPartial = join(viewsRoot, '_nav.ejs');

function readView(file: string): string {
  return readFileSync(join(viewsRoot, file), 'utf-8');
}

function inlineStyles(view: string): string {
  return [...view.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
}

describe('canonical navigation parity', () => {
  it.each(navViews)('%s consumes only the shared shell navigation', (file) => {
    const view = readView(file);
    expect(view).toContain("<%- include('_nav') %>");
    expect(view).toContain('href="/assets/shell.css"');
    expect(view).toContain('src="/assets/shell.mjs"');
    expect(view).not.toContain('<nav aria-label="Hauptnavigation">');
    expect(inlineStyles(view)).not.toMatch(/(^|\n)\s*nav(?:\s|[.#:[>+~])/m);
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

  it('binds the real browser shell regression into CI', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const browserRegression = readFileSync(join(process.cwd(), 'scripts', 'browser-shell-regression.mjs'), 'utf-8');
    const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf-8');

    expect(packageJson.scripts?.['test:browser-shell']).toBe('node scripts/browser-shell-regression.mjs');
    expect(browserRegression).toContain("from 'playwright-core'");
    expect(browserRegression).toContain("{ name: 'mobile', width: 390");
    expect(browserRegression).toContain("{ name: 'desktop', width: 1280");
    expect(browserRegression).toContain("record(checks, 'escape restores focus'");
    expect(browserRegression).toContain("record(checks, 'no document overflow'");
    expect(browserRegression).toContain("record(checks, 'desktop resize resets menu'");
    expect(ci).toContain('name: Browser shell regression');
    expect(ci).toContain('run: pnpm run test:browser-shell');
  });

  it('copies the shared shell into the supported static mirror', () => {
    const buildScript = readFileSync(join(process.cwd(), 'scripts', 'build-static.mjs'), 'utf-8');

    expect(buildScript).toContain('const STATIC_ASSETS = ["shell.css", "shell.mjs"]');
    expect(buildScript).toContain('copyFile(join(ROOT, "src", "public", name), join(assetsOut, name))');
    expect(buildScript).toContain('await copyStaticAssets()');
    expect(buildScript).toContain('{ currentPath: "/" }');
  });
});
