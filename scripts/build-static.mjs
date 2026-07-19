import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import ejs from 'ejs';

const ROOT = process.cwd();
const VIEWS = join(ROOT, 'src', 'views');
const OUT = join(ROOT, 'dist', 'site');
const STATIC_ASSETS = ['shell.css', 'shell.mjs'];

const STATIC_MIRROR_SUPPORTED_ROUTES = [
  { route: '/', output: 'index.html', view: 'index', reason: 'static landing page' },
];

const STATIC_MIRROR_RUNTIME_ONLY_ROUTES = [
  { route: '/bureau', reason: 'Bureau snapshot projection requires runtime artifacts' },
  { route: '/checkouts', reason: 'Grabowski checkout projection requires runtime artifacts' },
  { route: '/storage-health', reason: 'storage-health projection requires runtime artifacts' },
  { route: '/ecosystem-map', reason: 'Systemkatalog projection requires runtime artifacts' },
  { route: '/repoground', reason: 'RepoGround bundle projection requires runtime artifacts' },
];

function buildTimestamp() {
  const rawEpoch = process.env.SOURCE_DATE_EPOCH;
  if (rawEpoch && /^\d+$/.test(rawEpoch)) {
    return new Date(Number(rawEpoch) * 1000).toISOString();
  }
  return new Date().toISOString();
}

async function copyStaticAssets() {
  const assetsOut = join(OUT, 'assets');
  await mkdir(assetsOut, { recursive: true });
  await Promise.all(STATIC_ASSETS.map((name) => (
    copyFile(join(ROOT, 'src', 'public', name), join(assetsOut, name))
  )));
}

async function renderTo(outPath, viewName, data = {}, extraLocals = {}) {
  const html = await ejs.renderFile(join(VIEWS, `${viewName}.ejs`), { ...data, ...extraLocals }, {
    async: false,
    rmWhitespace: false,
    localsName: 'locals',
  });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf-8');
}

async function writeStaticBoundaryManifest() {
  await writeFile(
    join(OUT, '_static-boundary.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'leitstand_static_mirror_boundary',
      generatedAt: buildTimestamp(),
      deploymentMode: 'Mode B — Public Static Mirror / Preview',
      supportedRoutes: STATIC_MIRROR_SUPPORTED_ROUTES,
      runtimeOnlyRoutes: STATIC_MIRROR_RUNTIME_ONLY_ROUTES,
      removedRoutes: ['/events', '/ops', '/observatory', '/intent', '/anatomy', '/timeline', '/insights', '/reflexion'],
      doesNotEstablish: [
        'canonical_runtime_availability',
        'bureau_snapshot_truth',
        'grabowski_checkout_truth',
        'storage_health_snapshot_truth',
        'system_catalog_truth',
        'route_parity_with_runtime',
      ],
    }, null, 2)}\n`,
    'utf-8',
  );
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await copyStaticAssets();
  await renderTo(join(OUT, 'index.html'), 'index', { sources: [] }, { currentPath: '/' });
  await writeStaticBoundaryManifest();
  console.log('Static site generated at:', OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
