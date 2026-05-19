import { describe, it, expect } from 'vitest';
import { getEventFamily, listEventFamilies } from '../../src/utils/eventKind.js';

describe('getEventFamily', () => {
  it('classifies CI events by the leading namespace segment', () => {
    expect(getEventFamily('ci.test.pass').id).toBe('ci');
    expect(getEventFamily('ci.guard.pass').id).toBe('ci');
    expect(getEventFamily('ci.deploy.success').id).toBe('ci');
  });

  it('classifies producer-specific kinds deterministically', () => {
    expect(getEventFamily('knowledge.observatory.published.v1').id).toBe('knowledge');
    expect(getEventFamily('insights.daily.generated').id).toBe('insights');
    expect(getEventFamily('fleet.health.snapshot').id).toBe('fleet');
    expect(getEventFamily('heimgeist.self_state.update').id).toBe('heimgeist');
    expect(getEventFamily('integrity.summary.published.v1').id).toBe('integrity');
    expect(getEventFamily('plexer.delivery.complete').id).toBe('plexer');
    expect(getEventFamily('vault.sync.complete').id).toBe('vault');
    expect(getEventFamily('hauski.decision.v1').id).toBe('hauski');
  });

  it('is case-insensitive on the namespace segment', () => {
    expect(getEventFamily('CI.test.pass').id).toBe('ci');
    expect(getEventFamily('Knowledge.observatory.published').id).toBe('knowledge');
  });

  it('returns the same family for the same kind across calls (stability)', () => {
    const a = getEventFamily('ci.test.pass');
    const b = getEventFamily('ci.test.pass');
    expect(a).toBe(b);
    expect(a.color).toBe(b.color);
    expect(a.icon).toBe(b.icon);
  });

  it('does NOT depend on insertion order across different kinds', () => {
    // Regression guard for the previous timeline behavior which assigned colors
    // by insertion order — different filter selections could change the color
    // of a given kind. With deterministic classification this is impossible.
    const ciFirst = getEventFamily('ci.test.pass').color;
    const fleetFirst = getEventFamily('fleet.health.snapshot').color;
    const ciAgain = getEventFamily('ci.guard.pass').color;
    const fleetAgain = getEventFamily('fleet.health.snapshot').color;
    expect(ciAgain).toBe(ciFirst);
    expect(fleetAgain).toBe(fleetFirst);
    expect(ciFirst).not.toBe(fleetFirst);
  });

  it('falls back to "other" for unknown kinds, empty strings and non-strings', () => {
    expect(getEventFamily('unknown.producer.something').id).toBe('other');
    expect(getEventFamily('').id).toBe('other');
    expect(getEventFamily(undefined).id).toBe('other');
    expect(getEventFamily(null).id).toBe('other');
    // @ts-expect-error – testing defensive fallback for non-string input
    expect(getEventFamily(42).id).toBe('other');
  });

  it('treats single-segment kinds (no dot) as that segment', () => {
    expect(getEventFamily('ci').id).toBe('ci');
    expect(getEventFamily('fleet').id).toBe('fleet');
  });
});

describe('listEventFamilies', () => {
  it('returns the canonical list sorted alphabetically by label', () => {
    const families = listEventFamilies();
    const labels = families.map((f) => f.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b, 'de'));
    expect(labels).toEqual(sorted);
  });

  it('includes all distinct family IDs with non-empty color and icon', () => {
    const families = listEventFamilies();
    const ids = new Set(families.map((f) => f.id));
    expect(ids.has('ci')).toBe(true);
    expect(ids.has('other')).toBe(true);
    expect(families.length).toBe(ids.size); // no duplicates
    for (const f of families) {
      expect(f.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(f.icon.length).toBeGreaterThan(0);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });
});
