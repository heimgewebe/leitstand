import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1280, height: 900, mobile: false },
];

async function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known browser path.
    }
  }
  throw new Error('No supported Chrome/Chromium executable found. Set CHROME_BIN.');
}

function createHarness(navHtml, shellCss, shellScript) {
  const script = shellScript.replaceAll('</script', '<\\/script');
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Leitstand shell regression</title>
  <style>${shellCss}</style>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #0a0e1a; color: #f1f5f9; font-family: sans-serif; }
    main { min-width: 0; padding: 24px; }
  </style>
</head>
<body>
  ${navHtml}
  <main><button id="outside-target" type="button">Outside</button><p>Browser shell regression surface.</p></main>
  <script>${script}</script>
</body>
</html>`;
}

async function waitFrames(page) {
  await page.evaluate(() => new Promise((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));
}

async function readState(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('[data-leitstand-nav]');
    const toggle = document.querySelector('[data-leitstand-nav-toggle]');
    const links = document.querySelector('[data-leitstand-nav-links]');
    const skipLink = document.querySelector('.leitstand-skip-link');
    const mainAnchor = document.querySelector('#leitstand-content');
    const active = document.querySelectorAll('[aria-current="page"]');
    const navRect = nav?.getBoundingClientRect();
    return {
      elementsExist: Boolean(nav && toggle && links && skipLink && mainAnchor),
      mobileMatches: window.matchMedia('(max-width: 960px)').matches,
      ready: document.documentElement.classList.contains('leitstand-shell-ready'),
      activeCount: active.length,
      activeHref: active[0]?.getAttribute('href') ?? null,
      expanded: toggle?.getAttribute('aria-expanded') ?? null,
      toggleLabel: toggle?.getAttribute('aria-label') ?? null,
      toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
      linksHidden: links?.hidden ?? null,
      navExpanded: nav?.getAttribute('data-expanded') ?? null,
      focusedToggle: document.activeElement === toggle,
      focusedMain: document.activeElement === mainAnchor,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      navLeft: navRect?.left ?? null,
      navRight: navRect?.right ?? null,
      navPosition: nav ? getComputedStyle(nav).position : null,
    };
  });
}

function record(checks, name, pass, detail = '') {
  checks.push({ name, pass: Boolean(pass), detail: String(detail) });
}

async function runViewport(browser, viewport, html) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const checks = [];

  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.classList.contains('leitstand-shell-ready'));
    await waitFrames(page);

    let state = await readState(page);
    record(checks, 'shell elements exist', state.elementsExist);
    record(checks, 'viewport mode matches', state.mobileMatches === viewport.mobile, `${state.innerWidth}`);
    record(checks, 'one active route', state.activeCount === 1, state.activeCount);
    record(checks, 'intent maps to observatory', state.activeHref === '/observatory', state.activeHref);
    record(checks, 'shell ready class', state.ready);
    record(checks, 'initial expansion false', state.expanded === 'false', state.expanded);
    record(checks, 'initial link visibility', state.linksHidden === viewport.mobile, state.linksHidden);
    record(checks, 'toggle visibility', (state.toggleDisplay !== 'none') === viewport.mobile, state.toggleDisplay);
    record(checks, 'no document overflow', state.scrollWidth <= state.innerWidth + 1, `${state.scrollWidth}/${state.innerWidth}`);
    record(checks, 'nav inside viewport', state.navLeft !== null && state.navRight !== null && state.navLeft >= -1 && state.navRight <= state.innerWidth + 1, `${state.navLeft}/${state.navRight}`);
    record(checks, 'sticky shell', state.navPosition === 'sticky', state.navPosition);

    if (viewport.mobile) {
      await page.locator('[data-leitstand-nav-toggle]').click();
      await waitFrames(page);
      state = await readState(page);
      record(checks, 'mobile opens', state.expanded === 'true' && state.linksHidden === false && state.navExpanded === 'true');
      record(checks, 'open label is explicit', state.toggleLabel === 'Navigation schließen', state.toggleLabel);
      record(checks, 'open menu has no overflow', state.scrollWidth <= state.innerWidth + 1, `${state.scrollWidth}/${state.innerWidth}`);

      await page.keyboard.press('Escape');
      await waitFrames(page);
      state = await readState(page);
      record(checks, 'escape closes', state.expanded === 'false' && state.linksHidden === true);
      record(checks, 'escape restores focus', state.focusedToggle);

      await page.locator('[data-leitstand-nav-toggle]').click();
      await waitFrames(page);
      await page.locator('#outside-target').click();
      await waitFrames(page);
      state = await readState(page);
      record(checks, 'outside click closes', state.expanded === 'false' && state.linksHidden === true);

      await page.evaluate(() => document.querySelector('.leitstand-skip-link')?.click());
      await waitFrames(page);
      state = await readState(page);
      record(checks, 'skip link focuses target', state.focusedMain);

      await page.locator('[data-leitstand-nav-toggle]').click();
      await page.setViewportSize({ width: 1280, height: 900 });
      await waitFrames(page);
      state = await readState(page);
      record(checks, 'desktop resize resets menu', state.expanded === 'false' && state.linksHidden === false && state.toggleDisplay === 'none');

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await waitFrames(page);
      state = await readState(page);
      record(checks, 'mobile resize restores collapsed state', state.expanded === 'false' && state.linksHidden === true && state.toggleDisplay !== 'none');
    } else {
      await page.evaluate(() => document.querySelector('.leitstand-skip-link')?.click());
      await waitFrames(page);
      state = await readState(page);
      record(checks, 'skip link focuses target', state.focusedMain);
    }
  } finally {
    await context.close();
  }

  return { viewport: viewport.name, checks, ok: checks.every((check) => check.pass) };
}

async function main() {
  const chrome = await findChrome();
  const [navHtml, shellCss, shellScript] = await Promise.all([
    ejs.renderFile(join(ROOT, 'src', 'views', '_nav.ejs'), { currentPath: '/intent/example' }),
    readFile(join(ROOT, 'src', 'public', 'shell.css'), 'utf-8'),
    readFile(join(ROOT, 'src', 'public', 'shell.mjs'), 'utf-8'),
  ]);
  const html = createHarness(navHtml, shellCss, shellScript);
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'],
  });

  try {
    const results = [];
    for (const viewport of VIEWPORTS) results.push(await runViewport(browser, viewport, html));

    const failures = results.flatMap((result) => result.checks
      .filter((check) => !check.pass)
      .map((check) => ({ viewport: result.viewport, ...check })));
    for (const result of results) {
      const passed = result.checks.filter((check) => check.pass).length;
      console.log(`${result.viewport}: ${result.ok ? 'PASS' : 'FAIL'} (${passed}/${result.checks.length})`);
    }
    if (failures.length > 0) {
      for (const failure of failures) console.error(`${failure.viewport}: ${failure.name}: ${failure.detail}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
