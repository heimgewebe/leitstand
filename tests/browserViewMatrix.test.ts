import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface BrowserViewMatrix {
  schemaVersion: number;
  kind: string;
  taskId: string;
  contract: {
    server: string;
    productCssOnly: boolean;
    failClosedOn: string[];
    doesNotEstablish: string[];
  };
  viewports: Array<{ id: string; width: number; height: number }>;
  views: Array<{
    id: string;
    path: string;
    activeHref: string;
    heading: string;
    modal?: boolean;
  }>;
  scenarios: Array<{
    id: string;
    path: string;
    source: string;
    expectedText: string;
  }>;
}

const MATRIX_PATH = join(process.cwd(), 'scripts', 'browser-view-matrix.v1.json');
const PACKAGE_PATH = join(process.cwd(), 'package.json');
const CI_PATH = join(process.cwd(), '.github', 'workflows', 'ci.yml');

async function readMatrix(): Promise<BrowserViewMatrix> {
  return JSON.parse(await readFile(MATRIX_PATH, 'utf-8')) as BrowserViewMatrix;
}

describe('LSV-V1-T009 browser view matrix', () => {
  it('is versioned and bound to the browser regression task', async () => {
    const matrix = await readMatrix();

    expect(matrix).toMatchObject({
      schemaVersion: 1,
      kind: 'leitstand_browser_view_matrix',
      taskId: 'LSV-V1-T009',
    });
    expect(matrix.contract.server).toContain('Express');
    expect(matrix.contract.productCssOnly).toBe(true);
    expect(matrix.contract.failClosedOn).toEqual(expect.arrayContaining([
      'pageerror',
      'console-error',
      'requestfailed',
      'same-origin-http-4xx-5xx',
      'document-overflow',
      'missing-product-asset',
    ]));
    expect(matrix.contract.doesNotEstablish).toEqual(expect.arrayContaining([
      'visual-perfection',
      'source-truth',
      'write-authority',
    ]));
  });

  it('covers the required mobile and desktop viewports', async () => {
    const matrix = await readMatrix();

    expect(matrix.viewports).toEqual([
      { id: 'mobile', width: 390, height: 844 },
      { id: 'desktop', width: 1440, height: 900 },
    ]);
  });

  it('covers every primary read-only Leitstand view exactly once', async () => {
    const matrix = await readMatrix();
    const paths = matrix.views.map((view) => view.path);

    expect(paths).toEqual([
      '/',
      '/repoground',
      '/bureau',
      '/checkouts',
      '/storage-health',
      '/ecosystem-map',
    ]);
    expect(new Set(paths).size).toBe(paths.length);
    for (const view of matrix.views) {
      expect(view.id).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(view.activeHref).toBe(view.path);
      expect(view.heading.length).toBeGreaterThan(2);
    }
    expect(matrix.views.find((view) => view.id === 'ecosystem-map')?.modal).toBe(true);
  });

  it('covers valid, degraded, empty and reduced-motion states without claiming live incidents', async () => {
    const matrix = await readMatrix();
    const ids = matrix.scenarios.map((scenario) => scenario.id);

    expect(ids).toEqual([
      'valid',
      'missing',
      'corrupt',
      'stale',
      'empty',
      'reduced-motion',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scenario of matrix.scenarios) {
      expect(scenario.path).toMatch(/^\//);
      expect(scenario.source.length).toBeGreaterThan(10);
      expect(scenario.expectedText.length).toBeGreaterThan(2);
    }
  });

  it('exposes the built-product browser command after the CI build step', async () => {
    const [packageJson, workflow] = await Promise.all([
      readFile(PACKAGE_PATH, 'utf-8').then((raw) => JSON.parse(raw) as { scripts: Record<string, string> }),
      readFile(CI_PATH, 'utf-8'),
    ]);

    expect(packageJson.scripts['test:browser-views']).toBe('node scripts/browser-view-regression.mjs');
    expect(workflow).toContain('name: Browser view regression');
    expect(workflow.indexOf('name: Build')).toBeLessThan(workflow.indexOf('name: Browser view regression'));
  });
});
