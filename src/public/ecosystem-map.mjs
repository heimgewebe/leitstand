import mermaid from '/vendor/mermaid/mermaid.esm.min.mjs';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const TYPE_LABELS = {
  repo: 'Repos',
  service: 'Dienste',
  artifact: 'Artefakte',
  concept: 'Konzepte',
  actor: 'Menschen',
};
const EDGE_DEFINITION = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*-->\|([^|\n]+)\|\s*([A-Za-z][A-Za-z0-9_]*)\s*$/;
const VIEWBOX_MIN_SCALE = 0.08;
const VIEWBOX_MAX_SCALE = 4;

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

function parseRelationships(definition, recordsByMermaidId) {
  const relationships = [];
  for (const line of definition.split('\n')) {
    const match = EDGE_DEFINITION.exec(line);
    if (!match) continue;
    const [, sourceId, labelValue, targetId] = match;
    const source = recordsByMermaidId.get(sourceId);
    const target = recordsByMermaidId.get(targetId);
    if (!source || !target) continue;
    relationships.push({
      source,
      target,
      label: labelValue.trim(),
      pairKey: `${sourceId}_${targetId}`,
    });
  }
  return relationships;
}

function installExplorerStyles() {
  if (document.querySelector('[data-ecosystem-explorer-styles]')) return;
  const style = document.createElement('style');
  style.dataset.ecosystemExplorerStyles = '';
  style.textContent = `
    .map-explorer { display:grid; align-content:start; gap:14px; margin:0; padding:16px; max-height:620px; overflow:auto; border:1px solid rgba(255,255,255,.09); border-radius:12px; background:rgba(2,6,23,.55); }
    .map-explorer-row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
    .map-search { flex:1 1 280px; min-width:0; padding:10px 12px; border-radius:9px; border:1px solid rgba(255,255,255,.16); background:#0f172a; color:#f8fafc; font:inherit; }
    .map-search:focus, .map-filter:focus, .map-control:focus, .map-result-button:focus, .map-relation-button:focus, .map-detail button:focus, .map-detail a:focus { outline:2px solid #60a5fa; outline-offset:2px; }
    .map-filter, .map-control { border:1px solid rgba(255,255,255,.14); border-radius:999px; background:#111827; color:#cbd5e1; padding:8px 12px; cursor:pointer; font:inherit; }
    .map-filter[aria-pressed="true"], .map-control[aria-pressed="true"] { color:#dbeafe; border-color:#60a5fa; background:rgba(59,130,246,.18); }
    .map-control[disabled] { opacity:.45; cursor:not-allowed; }
    .map-result-count, .map-focus-summary { color:#94a3b8; font-size:.86rem; }
    .map-empty { margin:0; color:#fca5a5; }
    .map-results { display:grid; gap:8px; max-height:260px; overflow:auto; padding:2px; }
    .map-result-button { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 12px; width:100%; text-align:left; padding:10px 12px; border:1px solid rgba(255,255,255,.1); border-radius:9px; background:rgba(15,23,42,.76); color:#e2e8f0; cursor:pointer; font:inherit; }
    .map-result-button[aria-pressed="true"] { border-color:#60a5fa; background:rgba(59,130,246,.16); }
    .map-result-title { overflow-wrap:anywhere; }
    .map-result-meta { color:#94a3b8; font-size:.78rem; }
    .map-result-relations { grid-row:1 / span 2; grid-column:2; align-self:center; color:#bfdbfe; font-size:.78rem; }
    .map-detail { display:grid; gap:12px; padding:15px; border-radius:12px; border:1px solid rgba(96,165,250,.38); background:rgba(30,41,59,.94); }
    .map-detail[hidden] { display:none; }
    .map-detail h3, .map-detail h4 { margin:0; }
    .map-detail-meta { margin:0; color:#94a3b8; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.82rem; overflow-wrap:anywhere; }
    .map-detail-description { margin:0; color:#cbd5e1; line-height:1.5; }
    .map-relations { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
    .map-relation-list { display:grid; gap:7px; margin:7px 0 0; padding:0; list-style:none; }
    .map-relation-button { width:100%; display:grid; gap:2px; text-align:left; border:1px solid rgba(255,255,255,.1); border-radius:8px; background:#111827; color:#e2e8f0; padding:8px 10px; cursor:pointer; font:inherit; }
    .map-relation-kind { color:#94a3b8; font-size:.76rem; }
    .map-detail-actions { display:flex; flex-wrap:wrap; gap:10px; }
    .map-detail-actions a, .map-detail-actions button { border:1px solid rgba(255,255,255,.16); border-radius:8px; padding:8px 12px; font:inherit; text-decoration:none; cursor:pointer; }
    .map-detail-actions a { color:#dbeafe; background:rgba(59,130,246,.2); }
    .map-detail-actions button { color:#cbd5e1; background:#111827; }
    .map-workspace.is-map-fullscreen .map-explorer { max-height:none; height:100%; min-height:0; }
    .map-workspace.is-map-fullscreen .map-results { max-height:min(32vh, 320px); }
    .map-canvas { touch-action:none; cursor:grab; min-width:0; }
    .map-canvas.is-panning { cursor:grabbing; user-select:none; }
    .map-canvas svg { min-width:100%; }
    .map-canvas g.node { transition:opacity .15s ease, filter .15s ease; }
    .map-canvas g.node.is-filtered-out { opacity:.055; pointer-events:none; }
    .map-canvas g.node.is-second-order { opacity:.45; }
    .map-canvas g.node.is-selected rect, .map-canvas g.node.is-selected polygon, .map-canvas g.node.is-selected path, .map-canvas g.node.is-selected circle { stroke:#f8fafc !important; stroke-width:4px !important; filter:drop-shadow(0 0 7px rgba(96,165,250,.8)); }
    .map-canvas [data-edge="true"], .map-canvas g.edgeLabel { transition:opacity .15s ease; }
    .map-canvas [data-edge="true"].is-filtered-out, .map-canvas g.edgeLabel.is-filtered-out { opacity:.035; }
    .map-canvas [data-edge="true"].is-outgoing { stroke:#60a5fa !important; stroke-width:3px !important; opacity:1; }
    .map-canvas [data-edge="true"].is-incoming { stroke:#fbbf24 !important; stroke-width:3px !important; stroke-dasharray:7 4; opacity:1; }
    .map-canvas g.edgeLabel.is-outgoing, .map-canvas g.edgeLabel.is-incoming { opacity:1; font-weight:700; }
    @media (max-width:1100px) {
      .map-explorer { max-height:none; }
    }
    @media (max-width:720px) {
      .map-explorer { padding:12px; }
      .map-workspace.is-map-fullscreen .map-explorer { height:auto; max-height:44vh; }
      .map-filter, .map-control { padding:10px 13px; }
      .map-relations { grid-template-columns:1fr; }
      .map-results { max-height:220px; }
    }
  `;
  document.head.append(style);
}

function createExplorer(canvas, navigation) {
  installExplorerStyles();
  const explorer = document.createElement('section');
  explorer.className = 'map-explorer';
  explorer.setAttribute('aria-label', 'Karte durchsuchen, fokussieren und bewegen');
  explorer.innerHTML = `
    <div class="map-explorer-row">
      <label for="ecosystem-map-search">System suchen</label>
      <input id="ecosystem-map-search" class="map-search" type="search" autocomplete="off" placeholder="Name, ID oder Beschreibung" aria-describedby="ecosystem-map-result-count">
    </div>
    <div class="map-explorer-row" data-map-filters role="group" aria-label="Nach Systemart filtern"></div>
    <div class="map-explorer-row" data-map-controls role="group" aria-label="Kartenausschnitt steuern">
      <button type="button" class="map-control" data-map-view-action="zoom-in" aria-label="Karte vergrößern">Vergrößern</button>
      <button type="button" class="map-control" data-map-view-action="zoom-out" aria-label="Karte verkleinern">Verkleinern</button>
      <button type="button" class="map-control" data-map-view-action="fit-all">Alles einpassen</button>
      <button type="button" class="map-control" data-map-view-action="fit-focus" disabled>Fokus einpassen</button>
    </div>
    <div id="ecosystem-map-result-count" class="map-result-count" aria-live="polite"></div>
    <div class="map-focus-summary" data-map-focus-summary aria-live="polite">Kein Knoten fokussiert.</div>
    <p class="map-empty" data-map-empty hidden>Keine Knoten entsprechen Suche und Filter.</p>
    <div class="map-results" data-map-results role="list" aria-label="Such- und Filterergebnisse"></div>
    <aside class="map-detail" data-map-detail hidden aria-live="polite" aria-labelledby="ecosystem-map-detail-title">
      <h3 id="ecosystem-map-detail-title" data-map-detail-label></h3>
      <p class="map-detail-meta" data-map-detail-meta></p>
      <p class="map-detail-description" data-map-detail-description></p>
      <div class="map-relations" data-map-relations></div>
      <div class="map-detail-actions">
        <a data-map-detail-open href="#">Öffnen</a>
        <a data-map-detail-source href="#">Kanonische Quelle</a>
        <button type="button" data-map-detail-depth>Umfeld erweitern</button>
        <button type="button" data-map-detail-clear>Auswahl lösen</button>
      </div>
    </aside>
  `;
  const workspaceContent = canvas.closest('[data-map-workspace-content]');
  (workspaceContent || canvas.parentElement).prepend(explorer);

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

function createFullscreenController(workspace, toggleButton, closeButton) {
  if (!workspace || !toggleButton || !closeButton) return null;

  let fallbackActive = false;
  let previousFocus = null;

  function nativeActive() {
    return document.fullscreenElement === workspace;
  }

  function active() {
    return fallbackActive || nativeActive();
  }

  function focusableElements() {
    return [...workspace.querySelectorAll(
      'button:not([disabled]):not([hidden]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
  }

  function applyState(nextActive, { restoreFocus = false } = {}) {
    workspace.classList.toggle('is-map-fullscreen', nextActive);
    document.body.classList.toggle('map-fullscreen-open', nextActive);
    toggleButton.setAttribute('aria-pressed', nextActive ? 'true' : 'false');
    toggleButton.textContent = nextActive ? 'Vollbild schließen' : 'Vollbild öffnen';
    closeButton.hidden = !nextActive;

    if (nextActive) {
      workspace.setAttribute('role', 'dialog');
      workspace.setAttribute('aria-modal', 'true');
      workspace.setAttribute('aria-label', 'Ökosystemkarte im Vollbild');
      window.requestAnimationFrame(() => {
        if (active()) closeButton.focus({ preventScroll: true });
      });
    } else {
      workspace.removeAttribute('role');
      workspace.removeAttribute('aria-modal');
      workspace.removeAttribute('aria-label');
      if (restoreFocus && previousFocus?.focus) {
        window.requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
      }
    }
    window.dispatchEvent(new Event('resize'));
  }

  async function enter() {
    if (active()) return;
    previousFocus = document.activeElement;
    if (typeof workspace.requestFullscreen === 'function') {
      try {
        await workspace.requestFullscreen();
        return;
      } catch {
        // iPadOS and restricted browsers may reject element fullscreen. Use the viewport overlay.
      }
    }
    fallbackActive = true;
    applyState(true);
  }

  async function exit() {
    if (!active()) return;
    if (nativeActive() && typeof document.exitFullscreen === 'function') {
      await document.exitFullscreen();
      return;
    }
    fallbackActive = false;
    applyState(false, { restoreFocus: true });
  }

  async function toggle() {
    if (active()) await exit();
    else await enter();
  }

  toggleButton.addEventListener('click', () => void toggle());
  closeButton.addEventListener('click', () => void exit());
  document.addEventListener('fullscreenchange', () => {
    if (nativeActive()) {
      fallbackActive = false;
      applyState(true);
    } else if (!fallbackActive) {
      applyState(false, { restoreFocus: true });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void exit();
      return;
    }

    const target = event.target;
    let currentTarget = target instanceof Element ? target : null;
    let isTyping = false;
    while (currentTarget) {
      if (currentTarget.matches('input, textarea, select') || currentTarget.isContentEditable) {
        isTyping = true;
        break;
      }
      currentTarget = currentTarget.parentElement;
    }
    if (event.key.toLocaleLowerCase('de') === 'f' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTyping) {
      event.preventDefault();
      void toggle();
      return;
    }

    if (event.key !== 'Tab' || !active()) return;
    const focusable = focusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      workspace.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }, true);

  return { active, enter, exit, toggle };
}

function edgeIdentity(element) {
  return normalize(`${element.id} ${element.getAttribute('data-id') || ''}`);
}

function relationElements(svgRoot, relationship) {
  const pair = normalize(relationship.pairKey);
  return [...svgRoot.querySelectorAll('[data-edge="true"], g.edgeLabel')]
    .filter((element) => edgeIdentity(element).includes(pair));
}

function relationshipIndex(records, relationships) {
  const index = new Map(records.map((record) => [record.target.mermaid_id, []]));
  for (const relationship of relationships) {
    index.get(relationship.source.target.mermaid_id)?.push({
      relationship,
      neighbor: relationship.target,
      direction: 'outgoing',
    });
    index.get(relationship.target.target.mermaid_id)?.push({
      relationship,
      neighbor: relationship.source,
      direction: 'incoming',
    });
  }
  return index;
}

function parseViewBox(value) {
  if (!value) return null;
  const parts = value.split(',').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function serializeViewBox(box) {
  return [box.x, box.y, box.width, box.height]
    .map((value) => Number(value.toFixed(2)))
    .join(',');
}

function createViewportController(canvas, onChange) {
  const svg = canvas.querySelector('svg');
  if (!svg?.viewBox?.baseVal) return null;
  const base = svg.viewBox.baseVal;
  const original = { x: base.x, y: base.y, width: base.width, height: base.height };
  let current = { ...original };
  const pointers = new Map();
  let lastGesture = null;
  let moved = false;
  let gestureTravel = 0;
  let pendingTapTarget = null;
  let suppressClickUntil = 0;

  function clamp(box) {
    const minWidth = original.width * VIEWBOX_MIN_SCALE;
    const maxWidth = original.width * VIEWBOX_MAX_SCALE;
    const aspect = original.width / original.height;
    const centerX = Number.isFinite(box.x + box.width / 2)
      ? box.x + box.width / 2
      : original.x + original.width / 2;
    const centerY = Number.isFinite(box.y + box.height / 2)
      ? box.y + box.height / 2
      : original.y + original.height / 2;
    let width = box.width;
    let height = box.height;
    if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    width = Math.min(maxWidth, Math.max(minWidth, width));
    height = width / aspect;
    const x = Math.min(
      original.x + original.width - width * 0.1,
      Math.max(original.x - width * 0.9, centerX - width / 2),
    );
    const y = Math.min(
      original.y + original.height - height * 0.1,
      Math.max(original.y - height * 0.9, centerY - height / 2),
    );
    return { x, y, width, height };
  }

  function set(box, { notify = true } = {}) {
    current = clamp(box);
    svg.setAttribute('viewBox', `${current.x} ${current.y} ${current.width} ${current.height}`);
    if (notify) onChange?.({ ...current }, original);
  }

  function zoom(factor, clientX = null, clientY = null) {
    const rect = svg.getBoundingClientRect();
    const ratioX = rect.width > 0 && clientX !== null ? (clientX - rect.left) / rect.width : 0.5;
    const ratioY = rect.height > 0 && clientY !== null ? (clientY - rect.top) / rect.height : 0.5;
    const width = current.width * factor;
    const height = current.height * factor;
    set({
      x: current.x + ratioX * (current.width - width),
      y: current.y + ratioY * (current.height - height),
      width,
      height,
    });
  }

  function fitAll() {
    set({ ...original });
  }

  function fitNodes(nodes) {
    const boxes = nodes.map((node) => {
      try {
        return node.getBBox();
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (boxes.length === 0) return;
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    const padding = Math.max(40, Math.max(maxX - minX, maxY - minY) * 0.12);
    set({
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    });
  }

  function gestureSnapshot() {
    const values = [...pointers.values()];
    if (values.length === 1) return { kind: 'pan', x: values[0].x, y: values[0].y };
    if (values.length >= 2) {
      const [first, second] = values;
      return {
        kind: 'pinch',
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
    }
    return null;
  }

  svg.addEventListener('pointerdown', (event) => {
    const startsGesture = pointers.size === 0;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      svg.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic and partially cancelled pointer streams may not be capturable.
    }
    pendingTapTarget = startsGesture ? event.target.closest?.('g.node') || null : null;
    lastGesture = gestureSnapshot();
    moved = false;
    gestureTravel = 0;
    canvas.classList.add('is-panning');
  });

  svg.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const next = gestureSnapshot();
    const rect = svg.getBoundingClientRect();
    if (!next || !lastGesture || rect.width <= 0 || rect.height <= 0) {
      lastGesture = next;
      return;
    }
    if (next.kind === 'pan' && lastGesture.kind === 'pan') {
      const dx = next.x - lastGesture.x;
      const dy = next.y - lastGesture.y;
      gestureTravel += Math.abs(dx) + Math.abs(dy);
      if (gestureTravel > 6) {
        moved = true;
        pendingTapTarget = null;
      }
      set({
        x: current.x - (dx / rect.width) * current.width,
        y: current.y - (dy / rect.height) * current.height,
        width: current.width,
        height: current.height,
      });
    } else if (next.kind === 'pinch' && lastGesture.kind === 'pinch' && next.distance > 0 && lastGesture.distance > 0) {
      moved = true;
      pendingTapTarget = null;
      const factor = lastGesture.distance / next.distance;
      const ratioX = (next.x - rect.left) / rect.width;
      const ratioY = (next.y - rect.top) / rect.height;
      const width = current.width * factor;
      const height = current.height * factor;
      const panX = ((next.x - lastGesture.x) / rect.width) * width;
      const panY = ((next.y - lastGesture.y) / rect.height) * height;
      set({
        x: current.x + ratioX * (current.width - width) - panX,
        y: current.y + ratioY * (current.height - height) - panY,
        width,
        height,
      });
    }
    lastGesture = next;
  });

  function finishPointer(event) {
    const tapTarget = pendingTapTarget;
    pointers['delete'](event.pointerId);
    if (moved) suppressClickUntil = Date.now() + 250;
    lastGesture = gestureSnapshot();
    if (pointers.size === 0) {
      canvas.classList.remove('is-panning');
      if (!moved && event.pointerType === 'touch' && tapTarget) {
        tapTarget.dispatchEvent(new CustomEvent('ecosystem-map-touch-tap'));
      }
      pendingTapTarget = null;
    }
  }

  svg.addEventListener('pointerup', finishPointer);
  svg.addEventListener('pointercancel', finishPointer);
  svg.addEventListener('click', (event) => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.86 : 1.16, event.clientX, event.clientY);
  }, { passive: false });

  return {
    fitAll,
    fitNodes,
    zoomIn: () => zoom(0.78),
    zoomOut: () => zoom(1.28),
    restore: (box) => set(box, { notify: false }),
    current: () => ({ ...current }),
    original: () => ({ ...original }),
  };
}

function bindExplorer(svgRoot, navigation, explorer, definition) {
  const search = explorer.querySelector('.map-search');
  const resultCount = explorer.querySelector('.map-result-count');
  const focusSummary = explorer.querySelector('[data-map-focus-summary]');
  const empty = explorer.querySelector('[data-map-empty]');
  const results = explorer.querySelector('[data-map-results]');
  const detail = explorer.querySelector('[data-map-detail]');
  const detailLabel = explorer.querySelector('[data-map-detail-label]');
  const detailMeta = explorer.querySelector('[data-map-detail-meta]');
  const detailDescription = explorer.querySelector('[data-map-detail-description]');
  const detailRelations = explorer.querySelector('[data-map-relations]');
  const detailOpen = explorer.querySelector('[data-map-detail-open]');
  const detailSource = explorer.querySelector('[data-map-detail-source]');
  const detailDepth = explorer.querySelector('[data-map-detail-depth]');
  const detailClear = explorer.querySelector('[data-map-detail-clear]');
  const fitFocusButton = explorer.querySelector('[data-map-view-action="fit-focus"]');
  const filters = [...explorer.querySelectorAll('[data-map-type]')];
  const records = navigation.map((target) => ({
    target,
    type: nodeType(target.node_id),
    node: findRenderedNode(svgRoot, target.mermaid_id),
    haystack: normalize(`${target.label} ${target.node_id} ${target.title}`),
  })).filter((record) => record.node);
  const recordsByMermaidId = new Map(records.map((record) => [record.target.mermaid_id, record]));
  const relationships = parseRelationships(definition, recordsByMermaidId);
  const relationsByNode = relationshipIndex(records, relationships);
  const elementsByRelationship = new Map(relationships.map((relationship) => [relationship, relationElements(svgRoot, relationship)]));
  const initialParameters = new URLSearchParams(window.location.search);
  let activeType = filters.some((filter) => filter.dataset.mapType === initialParameters.get('type'))
    ? initialParameters.get('type')
    : 'all';
  let selected = null;
  let focusDepth = initialParameters.get('depth') === '2' ? 2 : 1;
  let viewport = null;
  let scheduledUrlUpdate = false;

  search.value = initialParameters.get('q') || '';
  for (const filter of filters) filter.setAttribute('aria-pressed', filter.dataset.mapType === activeType ? 'true' : 'false');

  function focusSet(record, depth = focusDepth) {
    if (!record) return new Set();
    const visited = new Set([record.target.mermaid_id]);
    let frontier = [record.target.mermaid_id];
    for (let level = 0; level < depth; level += 1) {
      const next = [];
      for (const id of frontier) {
        for (const relation of relationsByNode.get(id) || []) {
          const neighborId = relation.neighbor.target.mermaid_id;
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);
          next.push(neighborId);
        }
      }
      frontier = next;
    }
    return visited;
  }

  function directFocusSet(record) {
    if (!record) return new Set();
    const direct = new Set([record.target.mermaid_id]);
    for (const relation of relationsByNode.get(record.target.mermaid_id) || []) {
      direct.add(relation.neighbor.target.mermaid_id);
    }
    return direct;
  }

  function updateUrlNow() {
    scheduledUrlUpdate = false;
    const url = new URL(window.location.href);
    const query = search.value.trim();
    if (query) url.searchParams.set('q', query); else url.searchParams['delete']('q');
    if (activeType !== 'all') url.searchParams.set('type', activeType); else url.searchParams['delete']('type');
    if (selected) url.searchParams.set('node', selected.target.node_id); else url.searchParams['delete']('node');
    if (selected && focusDepth === 2) url.searchParams.set('depth', '2'); else url.searchParams['delete']('depth');
    const currentView = viewport?.current();
    const originalView = viewport?.original();
    if (currentView && originalView && serializeViewBox(currentView) !== serializeViewBox(originalView)) {
      url.searchParams.set('view', serializeViewBox(currentView));
    } else {
      url.searchParams['delete']('view');
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function scheduleUrlUpdate() {
    if (scheduledUrlUpdate) return;
    scheduledUrlUpdate = true;
    window.requestAnimationFrame(updateUrlNow);
  }

  viewport = createViewportController(svgRoot, scheduleUrlUpdate);

  function relevantNodes() {
    const ids = selected ? focusSet(selected) : new Set(records.map((record) => record.target.mermaid_id));
    return records.filter((record) => ids.has(record.target.mermaid_id)).map((record) => record.node);
  }

  function resetRelationshipClasses() {
    for (const element of svgRoot.querySelectorAll('[data-edge="true"], g.edgeLabel')) {
      element.classList.remove('is-filtered-out', 'is-incoming', 'is-outgoing');
    }
  }

  function renderResults(baseVisible) {
    results.replaceChildren();
    const ordered = records
      .filter((record) => baseVisible.has(record.target.mermaid_id))
      .sort((left, right) => left.target.label.localeCompare(right.target.label, 'de'));
    for (const record of ordered) {
      const relationCount = (relationsByNode.get(record.target.mermaid_id) || []).length;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-result-button';
      button.setAttribute('aria-pressed', selected === record ? 'true' : 'false');
      const title = document.createElement('span');
      title.className = 'map-result-title';
      title.textContent = record.target.label;
      const meta = document.createElement('span');
      meta.className = 'map-result-meta';
      meta.textContent = `${record.target.node_id} · ${TYPE_LABELS[record.type] || record.type}`;
      const relationMeta = document.createElement('span');
      relationMeta.className = 'map-result-relations';
      relationMeta.textContent = `${relationCount} ${relationCount === 1 ? 'Beziehung' : 'Beziehungen'}`;
      button.append(title, meta, relationMeta);
      button.addEventListener('click', () => selectRecord(record, { fit: true, focus: true }));
      const item = document.createElement('div');
      item.setAttribute('role', 'listitem');
      item.append(button);
      results.append(item);
    }
  }

  function renderRelationColumn(title, entries) {
    const section = document.createElement('section');
    const heading = document.createElement('h4');
    heading.textContent = title;
    const list = document.createElement('ul');
    list.className = 'map-relation-list';
    if (entries.length === 0) {
      const item = document.createElement('li');
      item.className = 'map-result-meta';
      item.textContent = 'Keine Beziehungen';
      list.append(item);
    }
    for (const entry of entries) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-relation-button';
      const neighbor = document.createElement('span');
      neighbor.textContent = entry.neighbor.target.label;
      const kind = document.createElement('span');
      kind.className = 'map-relation-kind';
      kind.textContent = entry.relationship.label;
      button.append(neighbor, kind);
      button.addEventListener('click', () => selectRecord(entry.neighbor, { fit: true, focus: true }));
      item.append(button);
      list.append(item);
    }
    section.append(heading, list);
    return section;
  }

  function renderDetail() {
    if (!selected) {
      detail.hidden = true;
      fitFocusButton.disabled = true;
      focusSummary.textContent = 'Kein Knoten fokussiert.';
      return;
    }
    const entries = relationsByNode.get(selected.target.mermaid_id) || [];
    const outgoing = entries.filter((entry) => entry.direction === 'outgoing');
    const incoming = entries.filter((entry) => entry.direction === 'incoming');
    const visibleFocus = focusSet(selected);
    detailLabel.textContent = selected.target.label;
    detailMeta.textContent = `${selected.target.node_id} · ${selected.type} · Ziel: ${selected.target.target_kind} · ${outgoing.length} ausgehend · ${incoming.length} eingehend`;
    detailDescription.textContent = selected.target.title;
    detailOpen.href = selected.target.href;
    detailSource.href = selected.target.source_href;
    detailDepth.textContent = focusDepth === 1 ? 'Umfeld erweitern' : 'Nur direkte Beziehungen';
    detailDepth.setAttribute('aria-pressed', focusDepth === 2 ? 'true' : 'false');
    detailRelations.replaceChildren(
      renderRelationColumn('Ausgehend', outgoing),
      renderRelationColumn('Eingehend', incoming),
    );
    detail.hidden = false;
    fitFocusButton.disabled = false;
    focusSummary.textContent = focusDepth === 1
      ? `${selected.target.label}: ${visibleFocus.size - 1} direkte Nachbarn im Fokus.`
      : `${selected.target.label}: ${visibleFocus.size - 1} Knoten bis zur zweiten Beziehungsebene im Fokus.`;
  }

  function applyVisualState() {
    const query = normalize(search.value.trim());
    const baseVisible = new Set(records
      .filter((record) => (activeType === 'all' || record.type === activeType) && (!query || record.haystack.includes(query)))
      .map((record) => record.target.mermaid_id));
    if (selected && !baseVisible.has(selected.target.mermaid_id)) selected = null;
    const focused = selected ? focusSet(selected) : baseVisible;
    const direct = selected ? directFocusSet(selected) : new Set();

    for (const record of records) {
      const visible = focused.has(record.target.mermaid_id);
      record.node.classList.toggle('is-filtered-out', !visible);
      record.node.classList.toggle('is-second-order', Boolean(selected) && visible && !direct.has(record.target.mermaid_id));
      record.node.classList.toggle('is-selected', selected === record);
      record.node.setAttribute('aria-hidden', visible ? 'false' : 'true');
      record.node.setAttribute('aria-pressed', selected === record ? 'true' : 'false');
    }

    resetRelationshipClasses();
    for (const relationship of relationships) {
      const sourceVisible = focused.has(relationship.source.target.mermaid_id);
      const targetVisible = focused.has(relationship.target.target.mermaid_id);
      const directOutgoing = selected === relationship.source;
      const directIncoming = selected === relationship.target;
      for (const element of elementsByRelationship.get(relationship) || []) {
        element.classList.toggle('is-filtered-out', !(sourceVisible && targetVisible));
        element.classList.toggle('is-outgoing', directOutgoing);
        element.classList.toggle('is-incoming', directIncoming);
      }
    }

    resultCount.textContent = `${baseVisible.size} von ${records.length} Knoten entsprechen Suche und Filter`;
    empty.hidden = baseVisible.size !== 0;
    renderResults(baseVisible);
    renderDetail();
  }

  function clearSelection({ focus = false } = {}) {
    const previous = selected;
    selected = null;
    focusDepth = 1;
    applyVisualState();
    scheduleUrlUpdate();
    if (focus && previous?.node) previous.node.focus({ preventScroll: true });
  }

  function selectRecord(record, { fit = false, focus = false, updateUrl = true } = {}) {
    const query = normalize(search.value.trim());
    if (activeType !== 'all' && record.type !== activeType) {
      activeType = 'all';
      for (const filter of filters) filter.setAttribute('aria-pressed', filter.dataset.mapType === 'all' ? 'true' : 'false');
    }
    if (query && !record.haystack.includes(query)) search.value = '';
    selected = record;
    applyVisualState();
    if (fit) viewport?.fitNodes(relevantNodes());
    if (focus) record.node.focus({ preventScroll: true });
    if (updateUrl) scheduleUrlUpdate();
  }

  for (const record of records) {
    const { node, target } = record;
    node.classList.add('navigable-node');
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'button');
    node.setAttribute('aria-pressed', 'false');
    node.setAttribute('aria-label', `${target.label} auswählen: ${target.title}`);
    node.dataset.navigationHref = target.href;
    node.dataset.navigationKind = target.target_kind;
    addAccessibleTitle(node, `${target.label}: ${target.title}`);
    node.addEventListener('click', () => selectRecord(record));
    node.addEventListener('ecosystem-map-touch-tap', () => selectRecord(record));
    node.addEventListener('dblclick', () => window.location.assign(target.href));
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectRecord(record, { fit: true });
    });
  }

  search.addEventListener('input', () => {
    applyVisualState();
    scheduleUrlUpdate();
  });
  for (const filter of filters) {
    filter.addEventListener('click', () => {
      activeType = filter.dataset.mapType;
      for (const candidate of filters) candidate.setAttribute('aria-pressed', candidate === filter ? 'true' : 'false');
      applyVisualState();
      scheduleUrlUpdate();
    });
  }
  explorer.querySelector('[data-map-view-action="zoom-in"]').addEventListener('click', () => viewport?.zoomIn());
  explorer.querySelector('[data-map-view-action="zoom-out"]').addEventListener('click', () => viewport?.zoomOut());
  explorer.querySelector('[data-map-view-action="fit-all"]').addEventListener('click', () => viewport?.fitAll());
  fitFocusButton.addEventListener('click', () => viewport?.fitNodes(relevantNodes()));
  detailDepth.addEventListener('click', () => {
    focusDepth = focusDepth === 1 ? 2 : 1;
    applyVisualState();
    viewport?.fitNodes(relevantNodes());
    scheduleUrlUpdate();
  });
  detailClear.addEventListener('click', () => clearSelection({ focus: true }));
  document.addEventListener('keydown', (event) => {
    const activeTag = document.activeElement?.tagName?.toLowerCase();
    const isTyping = activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable;
    if (event.key === 'Escape' && selected) clearSelection({ focus: true });
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (!isTyping) {
        event.preventDefault();
        search.focus();
      }
    }
    if ((event.key === '+' || event.key === '=') && !event.ctrlKey && !event.metaKey && !isTyping) viewport?.zoomIn();
    if (event.key === '-' && !event.ctrlKey && !event.metaKey && !isTyping) viewport?.zoomOut();
    if (event.key === '0' && !event.ctrlKey && !event.metaKey && !isTyping) viewport?.fitAll();
  });

  applyVisualState();
  const initialNode = initialParameters.get('node');
  if (initialNode) {
    const record = records.find((candidate) => candidate.target.node_id === initialNode);
    if (record) selectRecord(record, { updateUrl: false });
  }
  const initialView = parseViewBox(initialParameters.get('view'));
  if (initialView) viewport?.restore(initialView);
  else if (selected) viewport?.fitNodes(relevantNodes());
  updateUrlNow();
  return { linkedNodes: records.length, relationshipCount: relationships.length };
}

async function renderEcosystemMap() {
  const canvas = document.querySelector('[data-ecosystem-map-canvas]');
  const source = document.querySelector('[data-ecosystem-map-source]');
  const navigationData = document.querySelector('[data-ecosystem-map-navigation]');
  const status = document.querySelector('[data-ecosystem-map-render-status]');
  const sourceDetails = document.querySelector('[data-ecosystem-map-source-details]');
  const workspace = document.querySelector('[data-ecosystem-map-workspace]');
  const fullscreenToggle = document.querySelector('[data-map-fullscreen-toggle]');
  const fullscreenClose = document.querySelector('[data-map-fullscreen-close]');
  if (!canvas || !source || !navigationData || !status) return;

  createFullscreenController(workspace, fullscreenToggle, fullscreenClose);
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
    const result = bindExplorer(canvas, navigation, explorer, definition);
    status.textContent = `SVG gerendert · ${result.linkedNodes} von ${navigation.length} Knoten interaktiv · ${result.relationshipCount} Beziehungen aus kanonischer Quelle`;
    status.dataset.state = result.linkedNodes === navigation.length ? 'ready' : 'warning';
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
