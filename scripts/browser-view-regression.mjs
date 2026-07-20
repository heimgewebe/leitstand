import { constants } from 'node:fs';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const execFile = promisify(execFileCallback);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX_PATH = join(ROOT, 'scripts', 'browser-view-matrix.v1.json');
const DIST_SERVER = join(ROOT, 'dist', 'server.js');
const ARTIFACT_CONTRACT = [
  ['canonical_ecosystem_map_mermaid', 'rendered/ecosystem-registry-map.mmd', 'text/mermaid'],
  ['rendered_catalog_markdown', 'rendered/system-catalog.md', 'text/markdown'],
  ['registry_nodes', 'registry/ecosystem/nodes.json', 'application/json'],
  ['registry_edges', 'registry/ecosystem/edges.json', 'application/json'],
  ['authority_matrix', 'registry/ecosystem/authority-matrix.v1.json', 'application/json'],
];
const DOES_NOT_ESTABLISH = [
  'claim_truth',
  'runtime_correctness',
  'merge_readiness',
  'system_catalog_registry_correctness',
  'consumer_view_correctness',
  'render_success_validates_map',
];

function assert(condition, message, detail = '') {
  if (!condition) throw new Error(`${message}${detail ? `: ${detail}` : ''}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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
      // Continue with the next fixed browser path.
    }
  }
  throw new Error('No supported Chrome/Chromium executable found. Set CHROME_BIN.');
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function directoryDigest(root) {
  const hash = createHash('sha256');
  for (const path of await listFiles(root)) {
    const rel = relative(root, path).replaceAll('\\', '/');
    const raw = await readFile(path);
    hash.update(`${rel}\0${raw.byteLength}\0`);
    hash.update(raw);
  }
  return hash.digest('hex');
}

async function runGit(cwd, args) {
  const { stdout } = await execFile('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    maxBuffer: 1_000_000,
  });
  return stdout.trim();
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function createEcosystemFixture(root) {
  const contents = new Map([
    ['rendered/ecosystem-registry-map.mmd', 'flowchart LR\n  systemkatalog["Systemkatalog"] --> repoground["RepoGround"]\n'],
    ['rendered/system-catalog.md', '# System Catalog\n\nBrowser regression fixture.\n'],
    ['registry/ecosystem/nodes.json', '{"schemaVersion":1,"nodes":[]}\n'],
    ['registry/ecosystem/edges.json', '{"schemaVersion":1,"edges":[]}\n'],
    ['registry/ecosystem/authority-matrix.v1.json', '{"schemaVersion":1,"authorities":[]}\n'],
  ]);

  for (const [rel, content] of contents) {
    const path = join(root, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf-8');
  }

  await execFile('git', ['init', '--quiet', root]);
  await runGit(root, ['config', 'user.name', 'Leitstand Browser Regression']);
  await runGit(root, ['config', 'user.email', 'browser-regression@invalid.local']);
  await runGit(root, ['add', '--', ...contents.keys()]);
  await runGit(root, ['commit', '--quiet', '-m', 'browser fixture']);
  const commit = await runGit(root, ['rev-parse', 'HEAD']);

  const artifacts = [];
  for (const [role, rel, contentType] of ARTIFACT_CONTRACT) {
    const raw = await readFile(join(root, rel));
    artifacts.push({ role, path: rel, contentType, bytes: raw.byteLength, sha256: sha256(raw) });
  }
  const manifestPath = join(root, 'rendered', 'ecosystem-map-artifact-manifest.json');
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: 'system_catalog_map_artifact_manifest',
    contractVersion: '1',
    schemaPath: 'catalog/ecosystem-map-artifact-manifest.schema.v1.json',
    mode: 'read_only_projection_source',
    source: {
      repository: 'heimgewebe/systemkatalog',
      commit,
      generatedAt: new Date().toISOString(),
    },
    artifactCount: artifacts.length,
    artifacts,
    doesNotEstablish: DOES_NOT_ESTABLISH,
  });
  return { root, manifestPath, commit };
}

async function createFixtures(tempRoot) {
  const sourceFixtures = join(ROOT, 'src', 'fixtures');
  const bureau = JSON.parse(await readFile(join(sourceFixtures, 'bureau-tasks.json'), 'utf-8'));
  const staleBureauPath = join(tempRoot, 'bureau-stale.json');
  const emptyBureauPath = join(tempRoot, 'bureau-empty.json');
  const corruptCheckoutPath = join(tempRoot, 'checkout-corrupt.json');
  const missingBureauPath = join(tempRoot, 'does-not-exist', 'bureau.json');
  await writeJson(staleBureauPath, { ...bureau, generatedAt: '2020-01-01T00:00:00Z' });
  await writeJson(emptyBureauPath, { ...bureau, generatedAt: new Date().toISOString(), tasks: [] });
  await writeFile(corruptCheckoutPath, '{not valid json\n', 'utf-8');
  const ecosystem = await createEcosystemFixture(join(tempRoot, 'systemkatalog-source'));

  return {
    sourceFixtures,
    ecosystem,
    staleBureauPath,
    emptyBureauPath,
    corruptCheckoutPath,
    missingBureauPath,
  };
}

function baselineEnvironment(fixtures) {
  return {
    LEITSTAND_STRICT: '0',
    LEITSTAND_BUREAU_FIXTURE_FALLBACK: '0',
    LEITSTAND_BUREAU_SNAPSHOT_PATH: join(fixtures.sourceFixtures, 'bureau-tasks.json'),
    LEITSTAND_CHECKOUT_FIXTURE_FALLBACK: '0',
    LEITSTAND_CHECKOUT_SNAPSHOT_PATH: join(fixtures.sourceFixtures, 'checkout-inventory.json'),
    LEITSTAND_STORAGE_HEALTH_FIXTURE_FALLBACK: '0',
    LEITSTAND_STORAGE_HEALTH_PATH: join(fixtures.sourceFixtures, 'storage-health.json'),
    LEITSTAND_REPOBRIEF_BUNDLES_PATH: join(fixtures.sourceFixtures, 'repobrief-bundles.json'),
    LEITSTAND_ECOSYSTEM_MAP_MANIFEST_PATH: fixtures.ecosystem.manifestPath,
    LEITSTAND_ECOSYSTEM_MAP_SOURCE_ROOT: fixtures.ecosystem.root,
    LEITSTAND_ECOSYSTEM_MAP_STALE_AFTER_HOURS: '168',
  };
}

function applyEnvironment(baseline, overrides = {}) {
  for (const [key, value] of Object.entries({ ...baseline, ...overrides })) {
    process.env[key] = value;
  }
}

async function waitForListening(server) {
  if (server.listening) return;
  await new Promise((resolveListening, rejectListening) => {
    server.once('listening', resolveListening);
    server.once('error', rejectListening);
  });
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
}

function attachDiagnostics(page, origin) {
  const diagnostics = [];
  const assets = new Map();
  page.on('pageerror', (error) => diagnostics.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.startsWith('Failed to load resource: the server responded with a status of')) return;
    diagnostics.push(`console-error:${text}`);
  });
  page.on('requestfailed', (request) => {
    diagnostics.push(`requestfailed:${request.url()}:${request.failure()?.errorText || 'unknown'}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin) return;
    if (response.status() >= 400) diagnostics.push(`http-${response.status()}:${url.pathname}`);
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/vendor/')) {
      assets.set(url.pathname, {
        status: response.status(),
        contentType: response.headers()['content-type'] || '',
      });
    }
  });
  return { diagnostics, assets };
}

async function waitFrames(page) {
  await page.evaluate(() => new Promise((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));
}

async function waitForView(page, view) {
  await page.locator('h1').waitFor({ state: 'visible' });
  if (view.id === 'ecosystem-map') {
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-ecosystem-map-render-status]');
      return status && status.getAttribute('data-state') !== 'loading';
    });
  }
  await waitFrames(page);
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector('#leitstand-content');
    const nav = document.querySelector('[data-leitstand-nav]');
    const offenders = [...document.querySelectorAll('body *')]
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: typeof element.className === 'string' ? element.className : '',
        rect: element.getBoundingClientRect(),
      }))
      .filter((entry) => entry.rect.right > window.innerWidth + 1 || entry.rect.left < -1)
      .slice(0, 8)
      .map((entry) => `${entry.tag}#${entry.id}.${entry.className}:${entry.rect.left}/${entry.rect.right}`);
    const stylesheets = [...document.styleSheets]
      .map((sheet) => sheet.href)
      .filter(Boolean)
      .map((href) => new URL(href).pathname);
    return {
      scrollWidth: root.scrollWidth,
      innerWidth: window.innerWidth,
      mainExists: Boolean(main),
      mainLeft: main?.getBoundingClientRect().left ?? null,
      mainRight: main?.getBoundingClientRect().right ?? null,
      navBoxSizing: nav ? getComputedStyle(nav).boxSizing : null,
      stylesheets,
      injectedHarnessStyles: document.querySelectorAll('[data-browser-regression-style]').length,
      offenders,
    };
  });
}

async function checkSkipLink(page) {
  const skip = page.locator('.leitstand-skip-link');
  await skip.focus();
  await page.keyboard.press('Enter');
  await waitFrames(page);
  return page.evaluate(() => document.activeElement === document.querySelector('#leitstand-content'));
}

async function checkMobileNavigation(page) {
  const toggle = page.locator('[data-leitstand-nav-toggle]');
  await toggle.focus();
  await toggle.click();
  assert(await toggle.getAttribute('aria-expanded') === 'true', 'mobile navigation did not open');
  await page.keyboard.press('Escape');
  assert(await toggle.getAttribute('aria-expanded') === 'false', 'Escape did not close mobile navigation');
  assert(await page.evaluate(() => document.activeElement === document.querySelector('[data-leitstand-nav-toggle]')), 'Escape did not restore navigation focus');
}

async function runView(browser, origin, viewport, view, baseline) {
  applyEnvironment(baseline);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page, origin);
  try {
    const response = await page.goto(`${origin}${view.path}`, { waitUntil: 'networkidle' });
    assert(response?.status() === 200, `route ${view.path} did not return 200`, response?.status());
    await waitForView(page, view);
    const heading = (await page.locator('h1').first().textContent())?.trim();
    assert(heading === view.heading, `unexpected heading for ${view.id}`, heading);
    const activeHref = await page.locator('[aria-current="page"]').first().getAttribute('href');
    assert(activeHref === view.activeHref, `unexpected active route for ${view.id}`, activeHref);
    const layout = await inspectLayout(page);
    assert(layout.mainExists, `main landmark missing for ${view.id}`);
    assert(layout.scrollWidth <= layout.innerWidth + 1, `document overflow for ${view.id}`, `${layout.scrollWidth}/${layout.innerWidth}; ${layout.offenders.join(', ')}`);
    assert(layout.mainLeft !== null && layout.mainRight !== null && layout.mainLeft >= -1 && layout.mainRight <= layout.innerWidth + 1, `main outside viewport for ${view.id}`, `${layout.mainLeft}/${layout.mainRight}`);
    assert(layout.navBoxSizing === 'border-box', `product shell does not own border-box sizing for ${view.id}`, layout.navBoxSizing);
    assert(layout.stylesheets.includes('/assets/shell.css'), `product shell stylesheet missing for ${view.id}`, layout.stylesheets.join(','));
    assert(layout.injectedHarnessStyles === 0, `test harness style detected for ${view.id}`);
    assert(await checkSkipLink(page), `skip link did not focus main for ${view.id}`);
    if (viewport.id === 'mobile' && view.id === 'dashboard') await checkMobileNavigation(page);
    assert(diagnostics.diagnostics.length === 0, `browser diagnostics failed for ${view.id}/${viewport.id}`, diagnostics.diagnostics.join(' | '));
    return {
      viewport: viewport.id,
      view: view.id,
      path: view.path,
      assetPaths: [...diagnostics.assets.keys()].sort(),
      checks: 10 + (viewport.id === 'mobile' && view.id === 'dashboard' ? 3 : 0),
    };
  } finally {
    await context.close();
  }
}

async function checkFullscreen(browser, origin, viewport, baseline) {
  applyEnvironment(baseline);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page, origin);
  try {
    await page.goto(`${origin}/ecosystem-map`, { waitUntil: 'networkidle' });
    await waitForView(page, { id: 'ecosystem-map' });
    const toggle = page.locator('[data-map-fullscreen-toggle]');
    await toggle.focus();
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-ecosystem-map-workspace]')?.classList.contains('is-map-fullscreen'));
    const open = await page.evaluate(() => {
      const workspace = document.querySelector('[data-ecosystem-map-workspace]');
      return {
        role: workspace?.getAttribute('role'),
        modal: workspace?.getAttribute('aria-modal'),
        bodyLocked: document.body.classList.contains('map-fullscreen-open') && getComputedStyle(document.body).overflow === 'hidden',
        focusInside: Boolean(workspace?.contains(document.activeElement)),
      };
    });
    assert(open.role === 'dialog' && open.modal === 'true', `fullscreen dialog semantics missing for ${viewport.id}`);
    assert(open.bodyLocked, `fullscreen body scroll lock missing for ${viewport.id}`);
    assert(open.focusInside, `fullscreen did not move focus inside for ${viewport.id}`);
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.querySelector('[data-ecosystem-map-workspace]')?.contains(document.activeElement)), `fullscreen focus escaped for ${viewport.id}`, index);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-ecosystem-map-workspace]')?.classList.contains('is-map-fullscreen'));
    assert(await page.evaluate(() => document.activeElement === document.querySelector('[data-map-fullscreen-toggle]')), `fullscreen Escape did not restore focus for ${viewport.id}`);
    assert(diagnostics.diagnostics.length === 0, `fullscreen browser diagnostics failed for ${viewport.id}`, diagnostics.diagnostics.join(' | '));
    return { viewport: viewport.id, checks: 18 };
  } finally {
    await context.close();
  }
}

async function runScenario(browser, origin, scenario, baseline, fixtures) {
  const overrides = {};
  if (scenario.id === 'missing') overrides.LEITSTAND_BUREAU_SNAPSHOT_PATH = fixtures.missingBureauPath;
  if (scenario.id === 'corrupt') overrides.LEITSTAND_CHECKOUT_SNAPSHOT_PATH = fixtures.corruptCheckoutPath;
  if (scenario.id === 'stale') overrides.LEITSTAND_BUREAU_SNAPSHOT_PATH = fixtures.staleBureauPath;
  if (scenario.id === 'empty') overrides.LEITSTAND_BUREAU_SNAPSHOT_PATH = fixtures.emptyBureauPath;
  applyEnvironment(baseline, overrides);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: scenario.id === 'reduced-motion' ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page, origin);
  try {
    const response = await page.goto(`${origin}${scenario.path}`, { waitUntil: 'networkidle' });
    assert(response?.status() === 200, `scenario ${scenario.id} did not return 200`, response?.status());
    if (scenario.path === '/ecosystem-map') await waitForView(page, { id: 'ecosystem-map' });
    else await page.locator('h1').waitFor({ state: 'visible' });
    const body = await page.locator('body').innerText();
    assert(body.includes(scenario.expectedText), `scenario ${scenario.id} did not expose expected state`, scenario.expectedText);
    if (scenario.id === 'empty') {
      const emptyState = await page.evaluate(() => {
        const taskMeta = [...document.querySelectorAll('.meta-item')].find((item) =>
          item.querySelector('.label')?.textContent?.trim() === 'Tasks'
        );
        const taskCount = taskMeta?.querySelector('.value')?.textContent?.trim() ?? null;
        const columnCounts = [...document.querySelectorAll('.board .column .count')].map((item) => item.textContent?.trim());
        return { taskCount, columnCounts };
      });
      assert(emptyState.taskCount === '0', 'empty Bureau fixture did not expose task count 0', JSON.stringify(emptyState));
      assert(emptyState.columnCounts.length > 0 && emptyState.columnCounts.every((value) => value === '0'), 'empty Bureau fixture left non-empty columns', JSON.stringify(emptyState));
    }
    const layout = await inspectLayout(page);
    assert(layout.scrollWidth <= layout.innerWidth + 1, `scenario ${scenario.id} overflow`, `${layout.scrollWidth}/${layout.innerWidth}`);
    if (scenario.id === 'reduced-motion') {
      const motion = await page.evaluate(() => {
        const node = document.querySelector('.map-canvas g.node');
        const edge = document.querySelector('.map-canvas [data-edge="true"], .map-canvas g.edgeLabel');
        return {
          matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
          nodeTransition: node ? getComputedStyle(node).transitionDuration : null,
          edgeTransition: edge ? getComputedStyle(edge).transitionDuration : null,
        };
      });
      assert(motion.matches, 'reduced-motion media query not active');
      assert(motion.nodeTransition === '0s' && motion.edgeTransition === '0s', 'map transitions remain active under reduced motion', JSON.stringify(motion));
    }
    assert(diagnostics.diagnostics.length === 0, `scenario diagnostics failed for ${scenario.id}`, diagnostics.diagnostics.join(' | '));
    return { scenario: scenario.id, path: scenario.path, checks: scenario.id === 'reduced-motion' ? 6 : 4 };
  } finally {
    await context.close();
  }
}

async function main() {
  await access(DIST_SERVER, constants.R_OK).catch(() => {
    throw new Error('dist/server.js is missing. Run pnpm build before test:browser-views.');
  });
  const [matrixRaw, chrome, commit, distInfo] = await Promise.all([
    readFile(MATRIX_PATH, 'utf-8'),
    findChrome(),
    runGit(ROOT, ['rev-parse', 'HEAD']),
    stat(DIST_SERVER),
  ]);
  const matrix = JSON.parse(matrixRaw);
  const tempRoot = await mkdtemp(join(tmpdir(), 'leitstand-browser-views-'));
  const originalEnvironment = { ...process.env };
  let server;
  let browser;
  try {
    const fixtures = await createFixtures(tempRoot);
    const baseline = baselineEnvironment(fixtures);
    applyEnvironment(baseline);
    const serverModule = await import(`${pathToFileURL(DIST_SERVER).href}?browser-view-regression=${Date.now()}`);
    server = serverModule.startServer({ port: 0, bindHost: '127.0.0.1', log: false });
    await waitForListening(server);
    const address = server.address();
    assert(address && typeof address === 'object', 'server address unavailable');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'],
    });

    const views = [];
    for (const viewport of matrix.viewports) {
      for (const view of matrix.views) views.push(await runView(browser, origin, viewport, view, baseline));
    }
    const fullscreen = [];
    for (const viewport of matrix.viewports) fullscreen.push(await checkFullscreen(browser, origin, viewport, baseline));
    const scenarios = [];
    for (const scenario of matrix.scenarios) scenarios.push(await runScenario(browser, origin, scenario, baseline, fixtures));

    const payload = {
      schemaVersion: 1,
      kind: 'leitstand_browser_view_regression_receipt',
      taskId: matrix.taskId,
      commit,
      build: {
        distSha256: await directoryDigest(join(ROOT, 'dist')),
        serverBytes: distInfo.size,
      },
      matrix: {
        path: relative(ROOT, MATRIX_PATH),
        sha256: sha256(matrixRaw),
        viewports: matrix.viewports,
        viewCount: matrix.views.length,
        scenarioCount: matrix.scenarios.length,
      },
      browser: {
        executable: basename(chrome),
      },
      results: { views, fullscreen, scenarios },
      totals: {
        routeViewportPairs: views.length,
        fullscreenViewports: fullscreen.length,
        scenarios: scenarios.length,
        checks: [...views, ...fullscreen, ...scenarios].reduce((total, result) => total + result.checks, 0),
      },
      boundary: {
        bindHost: '127.0.0.1',
        productCssOnly: true,
        externalMutations: false,
      },
      doesNotEstablish: matrix.contract.doesNotEstablish,
    };
    const receiptSha256 = sha256(JSON.stringify(payload));
    console.log(JSON.stringify({ ...payload, receiptSha256 }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) await closeServer(server);
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) delete process.env[key];
    }
    Object.assign(process.env, originalEnvironment);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
