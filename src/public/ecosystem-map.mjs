import mermaid from '/vendor/mermaid/mermaid.esm.min.mjs';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const TYPE_LABELS = {
  repo: 'Repos',
  service: 'Dienste',
  artifact: 'Artefakte',
  concept: 'Konzepte',
  actor: 'Menschen',
};

function findRenderedNode(svgRoot, mermaidId) {
  return [...svgRoot.querySelectorAll('g.node')].find((node) => (
    node.getAttribute('data-id') === mermaidId
    || node.id === mermaidId
    || node.id.includes(`-${mermaidId}-`)
  ));
}

function addAccessibleTitle(node, title) {
  let titleElement = [...node.children].find((child) => child.tagName.toLowerCase() === 'title');
  if (!titleElement) {
    titleElement = document.createElementNS(SVG_NAMESPACE, 'title');
    node.prepend(titleElement);
  }
  titleElement.textContent = title;
}

function nodeType(nodeId) {
  return nodeId.includes(':') ? nodeId.split(':', 1)[0] : 'other';
}

function normalize(value) {
  return String(value || '').normalize('NFKD').toLocaleLowerCase('de');
}

function installExplorerStyles() {
  if (document.querySelector('[data-ecosystem-explorer-styles]')) return;
  const style = document.createElement('style');
  style.dataset.ecosystemExplorerStyles = '';
  style.textContent = `
    .map-explorer { display:grid; gap:14px; margin:0 0 16px; padding:16px; border:1px solid rgba(255,255,255,.09); border-radius:12px; background:rgba(2,6,23,.55); }
    .map-explorer-row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
    .map-search { flex:1 1 280px; min-width:0; padding:10px 12px; border-radius:9px; border:1px solid rgba(255,255,255,.16); background:#0f172a; color:#f8fafc; font:inherit; }
    .map-search:focus, .map-filter:focus, .map-detail button:focus, .map-detail a:focus { outline:2px solid #60a5fa; outline-offset:2px; }
    .map-filter { border:1px solid rgba(255,255,255,.14); border-radius:999px; background:#111827; color:#cbd5e1; padding:7px 11px; cursor:pointer; }
    .map-filter[aria-pressed="true"] { color:#dbeafe; border-color:#60a5fa; background:rgba(59,130,246,.18); }
    .map-result-count { color:#94a3b8; font-size:.86rem; }
    .map-empty { margin:0; color:#fca5a5; }
    .map-detail { display:grid; gap:10px; padding:15px; border-radius:12px; border:1px solid rgba(96,165,250,.38); background:rgba(30,41,59,.94); }
    .map-detail[hidden] { display:none; }
    .map-detail h3 { margin:0; }
    .map-detail-meta { margin:0; color:#94a3b8; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.82rem; overflow-wrap:anywhere; }
    .map-detail-description { margin:0; color:#cbd5e1; line-height:1.5; }
    .map-detail-actions { display:flex; flex-wrap:wrap; gap:10px; }
    .map-detail-actions a, .map-detail-actions button { border:1px solid rgba(255,255,255,.16); border-radius:8px; padding:8px 12px; font:inherit; text-decoration:none; cursor:pointer; }
    .map-detail-actions a { color:#dbeafe; background:rgba(59,130,246,.2); }
    .map-detail-actions button { color:#cbd5e1; background:#111827; }
    .map-canvas g.node { transition:opacity .15s ease, filter .15s ease; }
    .map-canvas g.node.is-filtered-out { opacity:.08; pointer-events:none; }
    .map-canvas g.node.is-selected > rect, .map-canvas g.node.is-selected > polygon { stroke:#f8fafc !important; stroke-width:4px !important; filter:drop-shadow(0 0 7px rgba(96,165,250,.8)); }
    .map-canvas [data-edge="true"].is-filtered-out, .map-canvas g.edgeLabel.is-filtered-out { opacity:.06; }
    @media (max-width:720px) { .map-explorer { padding:12px; } .map-filter { padding:9px 12px; } }
  `;
  document.head.append(style);
}

function createExplorer(canvas, navigation) {
  installExplorerStyles();
  const explorer = document.createElement('section');
  explorer.className = 'map-explorer';
  explorer.setAttribute('aria-label', 'Karte durchsuchen und filtern');
  explorer.innerHTML = `
    <div class="map-explorer-row">
      <label for="ecosystem-map-search">System suchen</label>
      <input id="ecosystem-map-search" class="map-search" type="search" autocomplete="off" placeholder="Name, ID oder Beschreibung" aria-describedby="ecosystem-map-result-count">
    </div>
    <div class="map-explorer-row" data-map-filters role="group" aria-label="Nach Systemart filtern"></div>
    <div id="ecosystem-map-result-count" class="map-result-count" aria-live="polite"></div>
    <p class="map-empty" data-map-empty hidden>Keine Knoten entsprechen Suche und Filter.</p>
    <aside class="map-detail" data-map-detail hidden aria-live="polite" aria-labelledby="ecosystem-map-detail-title">
      <h3 id="ecosystem-map-detail-title" data-map-detail-label></h3>
      <p class="map-detail-meta" data-map-detail-meta></p>
      <p class="map-detail-description" data-map-detail-description></p>
      <div class="map-detail-actions">
        <a data-map-detail-open href="#">Öffnen</a>
        <button type="button" data-map-detail-clear>Auswahl lösen</button>
      </div>
    </aside>
  `;
  canvas.before(explorer);

  const types = [...new Set(navigation.map((item) => nodeType(item.node_id)))].filter((type) => TYPE_LABELS[type]);
  const filters = explorer.querySelector('[data-map-filters]');
  for (const [type, label] of [['all', 'Alle'], ...types.map((type) => [type, TYPE_LABELS[type]])]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-filter';
    button.dataset.mapType = type;
    button.setAttribute('aria-pressed', type === 'all' ? 'true' : 'false');
    button.textContent = label;
    filters.append(button);
  }
  return explorer;
}

function edgeNodeIds(element) {
  return normalize(`${element.id} ${element.getAttribute('data-id') || ''}`);
}

function bindExplorer(svgRoot, navigation, explorer) {
  const search = explorer.querySelector('.map-search');
  const resultCount = explorer.querySelector('.map-result-count');
  const empty = explorer.querySelector('[data-map-empty]');
  const detail = explorer.querySelector('[data-map-detail]');
  const detailLabel = explorer.querySelector('[data-map-detail-label]');
  const detailMeta = explorer.querySelector('[data-map-detail-meta]');
  const detailDescription = explorer.querySelector('[data-map-detail-description]');
  const detailOpen = explorer.querySelector('[data-map-detail-open]');
  const detailClear = explorer.querySelector('[data-map-detail-clear]');
  const filters = [...explorer.querySelectorAll('[data-map-type]')];
  const records = navigation.map((target) => ({
    target,
    type: nodeType(target.node_id),
    node: findRenderedNode(svgRoot, target.mermaid_id),
    haystack: normalize(`${target.label} ${target.node_id} ${target.title}`),
  })).filter((record) => record.node);
  let activeType = 'all';
  let selected = null;

  function clearSelection({ focus = false } = {}) {
    if (selected?.node) selected.node.classList.remove('is-selected');
    const previous = selected;
    selected = null;
    detail.hidden = true;
    if (focus && previous?.node) previous.node.focus();
  }

  function selectRecord(record, { scroll = false } = {}) {
    clearSelection();
    selected = record;
    record.node.classList.add('is-selected');
    detailLabel.textContent = record.target.label;
    detailMeta.textContent = `${record.target.node_id} · ${record.type} · Ziel: ${record.target.target_kind}`;
    detailDescription.textContent = record.target.title;
    detailOpen.href = record.target.href;
    detail.hidden = false;
    if (scroll) {
      record.node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      record.node.focus({ preventScroll: true });
    }
  }

  function applyFilter() {
    const query = normalize(search.value.trim());
    const visible = new Set();
    for (const record of records) {
      const matches = (activeType === 'all' || record.type === activeType) && (!query || record.haystack.includes(query));
      record.node.classList.toggle('is-filtered-out', !matches);
      record.node.setAttribute('aria-hidden', matches ? 'false' : 'true');
      if (matches) visible.add(record.target.mermaid_id);
      if (!matches && selected === record) clearSelection();
    }
    for (const edge of svgRoot.querySelectorAll('[data-edge="true"], g.edgeLabel')) {
      const identity = edgeNodeIds(edge);
      const touchesVisible = [...visible].some((id) => identity.includes(normalize(id)));
      edge.classList.toggle('is-filtered-out', visible.size !== records.length && !touchesVisible);
    }
    resultCount.textContent = `${visible.size} von ${records.length} Knoten sichtbar`;
    empty.hidden = visible.size !== 0;
  }

  for (const record of records) {
    const { node, target } = record;
    node.classList.add('navigable-node');
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `${target.label} auswählen: ${target.title}`);
    node.dataset.navigationHref = target.href;
    node.dataset.navigationKind = target.target_kind;
    addAccessibleTitle(node, `${target.label}: ${target.title}`);
    node.addEventListener('click', () => selectRecord(record));
    node.addEventListener('dblclick', () => window.location.assign(target.href));
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectRecord(record);
    });
  }

  search.addEventListener('input', applyFilter);
  for (const filter of filters) {
    filter.addEventListener('click', () => {
      activeType = filter.dataset.mapType;
      for (const candidate of filters) candidate.setAttribute('aria-pressed', candidate === filter ? 'true' : 'false');
      applyFilter();
    });
  }
  detailClear.addEventListener('click', () => clearSelection({ focus: true }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selected) clearSelection({ focus: true });
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && !document.activeElement?.isContentEditable) {
        event.preventDefault();
        search.focus();
      }
    }
  });

  applyFilter();
  const initialNode = new URLSearchParams(window.location.search).get('node');
  if (initialNode) {
    const record = records.find((candidate) => candidate.target.node_id === initialNode);
    if (record) selectRecord(record, { scroll: true });
  }
  return records.length;
}

async function renderEcosystemMap() {
  const canvas = document.querySelector('[data-ecosystem-map-canvas]');
  const source = document.querySelector('[data-ecosystem-map-source]');
  const navigationData = document.querySelector('[data-ecosystem-map-navigation]');
  const status = document.querySelector('[data-ecosystem-map-render-status]');
  const sourceDetails = document.querySelector('[data-ecosystem-map-source-details]');
  if (!canvas || !source || !navigationData || !status) return;

  const navigation = JSON.parse(navigationData.textContent || '[]');
  const definition = source.textContent || '';
  if (!definition.trim()) {
    status.textContent = 'Keine Mermaid-Quelle verfügbar.';
    status.dataset.state = 'error';
    return;
  }

  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', flowchart: { htmlLabels: true, useMaxWidth: true } });
  try {
    const renderId = `ecosystem-map-svg-${Date.now()}`;
    const { svg, bindFunctions } = await mermaid.render(renderId, definition);
    canvas.innerHTML = svg;
    bindFunctions?.(canvas);
    const explorer = createExplorer(canvas, navigation);
    const linkedNodes = bindExplorer(canvas, navigation, explorer);
    status.textContent = `SVG gerendert · ${linkedNodes} von ${navigation.length} Knoten interaktiv`;
    status.dataset.state = linkedNodes === navigation.length ? 'ready' : 'warning';
    canvas.dataset.renderState = 'ready';
  } catch (error) {
    console.error('[EcosystemMap] Mermaid render failed:', error);
    canvas.replaceChildren();
    canvas.dataset.renderState = 'error';
    status.textContent = 'SVG-Rendering fehlgeschlagen. Die geprüfte Mermaid-Quelle bleibt unten lesbar.';
    status.dataset.state = 'error';
    if (sourceDetails) sourceDetails.open = true;
  }
}

void renderEcosystemMap();
