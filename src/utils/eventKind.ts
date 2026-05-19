/**
 * Deterministic classification of chronik event kinds into visual families.
 *
 * Event kinds follow a dotted namespace convention (e.g. `ci.test.pass`,
 * `knowledge.observatory.published.v1`). The first segment identifies the
 * producing domain; we use it to assign a stable color, icon and badge so the
 * timeline view stays visually consistent across reloads, filters and replays
 * (Phase 4 roadmap item from `docs/blueprints/leitstand_visualization.md`).
 *
 * Observer boundary: this is a pure presentation helper — it does not load,
 * mutate or fetch any data.
 */

export interface EventFamily {
  /** Stable machine identifier — usable for filtering and tests. */
  id: string;
  /** Human-readable short label for badges. */
  label: string;
  /** Hex color used for dot/border and badge accent. */
  color: string;
  /** Single-character Unicode glyph used as the badge icon. */
  icon: string;
}

/**
 * Canonical registry of event families.
 *
 * IDs are stable identifiers and must not be renamed without updating the
 * timeline view filter and any consumer that persists family selections.
 */
const FAMILIES: Record<string, EventFamily> = {
  ci: { id: 'ci', label: 'CI', color: '#3b82f6', icon: '⚙' },
  knowledge: { id: 'knowledge', label: 'Wissen', color: '#8b5cf6', icon: '◎' },
  insights: { id: 'insights', label: 'Insights', color: '#a855f7', icon: '✦' },
  fleet: { id: 'fleet', label: 'Fleet', color: '#10b981', icon: '◉' },
  heimgeist: { id: 'heimgeist', label: 'Heimgeist', color: '#ec4899', icon: '☉' },
  heimlern: { id: 'heimlern', label: 'Heimlern', color: '#f472b6', icon: '∿' },
  hauski: { id: 'hauski', label: 'HausKI', color: '#06b6d4', icon: '◇' },
  plexer: { id: 'plexer', label: 'Plexer', color: '#14b8a6', icon: '⇉' },
  integrity: { id: 'integrity', label: 'Integrität', color: '#f59e0b', icon: '✓' },
  sichter: { id: 'sichter', label: 'Sichter', color: '#ef4444', icon: '⌖' },
  vault: { id: 'vault', label: 'Vault', color: '#6366f1', icon: '▣' },
  aussen: { id: 'aussen', label: 'Außen', color: '#22d3ee', icon: '◐' },
  os: { id: 'os', label: 'System', color: '#94a3b8', icon: '▤' },
  lenskit: { id: 'lenskit', label: 'Lenskit', color: '#f97316', icon: '⟁' },
  other: { id: 'other', label: 'Sonstiges', color: '#64748b', icon: '·' },
};

/**
 * Returns the visual family for a given event kind.
 *
 * The first segment of the dotted namespace is matched against the canonical
 * registry. Unknown or malformed kinds fall back to the `other` family so the
 * UI always has a defined color/icon and never crashes on novel producers.
 */
export function getEventFamily(kind: string | undefined | null): EventFamily {
  if (typeof kind !== 'string' || kind.length === 0) {
    return FAMILIES.other;
  }
  const head = kind.split('.', 1)[0]?.toLowerCase() ?? '';
  return FAMILIES[head] ?? FAMILIES.other;
}

/**
 * Returns the sorted list of all known families.
 *
 * Used by the timeline view to render a stable "Familie"-filter dropdown
 * independent of which events happen to be inside the current window.
 */
export function listEventFamilies(): EventFamily[] {
  return Object.values(FAMILIES)
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}
