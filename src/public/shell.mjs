const nav = document.querySelector('[data-leitstand-nav]');
const toggle = nav?.querySelector('[data-leitstand-nav-toggle]');
const links = nav?.querySelector('[data-leitstand-nav-links]');
const toggleIcon = toggle?.querySelector('.leitstand-nav__toggle-icon');
const activeLink = links?.querySelector('[aria-current="page"]');

if (nav && toggle && links) {
  const mobileQuery = window.matchMedia('(max-width: 960px)');
  document.documentElement.classList.add('leitstand-shell-ready');

  const keepActiveLinkVisible = () => {
    activeLink?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const setExpanded = (expanded, { restoreFocus = false } = {}) => {
    const mobile = mobileQuery.matches;
    const next = mobile && expanded;
    nav.dataset.expanded = String(next);
    toggle.setAttribute('aria-expanded', String(next));
    toggle.setAttribute('aria-label', next ? 'Navigation schließen' : 'Navigation öffnen');
    links.hidden = mobile && !next;
    if (toggleIcon) toggleIcon.textContent = next ? '×' : '☰';
    if (!mobile || next) window.requestAnimationFrame(keepActiveLinkVisible);
    if (restoreFocus) toggle.focus();
  };

  const syncViewport = () => setExpanded(false);

  toggle.addEventListener('click', () => {
    setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
  });

  links.addEventListener('click', (event) => {
    if (event.target.closest('a') && mobileQuery.matches) setExpanded(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setExpanded(false, { restoreFocus: true });
    }
  });

  document.addEventListener('click', (event) => {
    if (
      mobileQuery.matches
      && toggle.getAttribute('aria-expanded') === 'true'
      && !nav.contains(event.target)
    ) {
      setExpanded(false);
    }
  });

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', syncViewport);
  } else {
    mobileQuery.addListener(syncViewport);
  }

  syncViewport();
}

const skipLink = document.querySelector('.leitstand-skip-link');
const mainAnchor = document.querySelector('#leitstand-content');
if (skipLink && mainAnchor) {
  skipLink.addEventListener('click', () => {
    window.requestAnimationFrame(() => mainAnchor.focus({ preventScroll: true }));
  });
}
