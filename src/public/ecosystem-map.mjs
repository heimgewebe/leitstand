import mermaid from '/vendor/mermaid/mermaid.esm.min.mjs';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

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

function navigateTo(href) {
  window.location.assign(href);
}

function bindNodeNavigation(svgRoot, navigation) {
  let linkedNodes = 0;

  for (const target of navigation) {
    const node = findRenderedNode(svgRoot, target.mermaid_id);
    if (!node) continue;

    node.classList.add('navigable-node');
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'link');
    node.setAttribute('aria-label', `${target.label}: ${target.title}`);
    node.dataset.navigationHref = target.href;
    node.dataset.navigationKind = target.target_kind;
    addAccessibleTitle(node, target.title);

    node.addEventListener('click', () => navigateTo(target.href));
    node.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      navigateTo(target.href);
    });
    linkedNodes += 1;
  }

  return linkedNodes;
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

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark',
    flowchart: {
      htmlLabels: true,
      useMaxWidth: true,
    },
  });

  try {
    const renderId = `ecosystem-map-svg-${Date.now()}`;
    const { svg, bindFunctions } = await mermaid.render(renderId, definition);
    canvas.innerHTML = svg;
    bindFunctions?.(canvas);

    const linkedNodes = bindNodeNavigation(canvas, navigation);
    status.textContent = `SVG gerendert · ${linkedNodes} von ${navigation.length} Knoten verlinkt`;
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
