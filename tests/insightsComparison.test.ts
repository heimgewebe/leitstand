import { describe, it, expect } from 'vitest';
import { compareInsights, previousDateOf } from '../src/insightsComparison.js';
import type { DailyInsights } from '../src/insights.js';

function insights(partial: Partial<DailyInsights>): DailyInsights {
  return {
    ts: '2025-12-28',
    topics: [],
    questions: [],
    deltas: [],
    ...partial,
  };
}

describe('compareInsights', () => {
  it('classifies topics into added, removed, changed and unchanged', () => {
    const current = insights({
      ts: '2025-12-28',
      topics: [
        ['observatory', 0.9],
        ['insights.daily', 0.7],
        ['leitstand-ui', 0.5],
      ],
    });
    const previous = insights({
      ts: '2025-12-27',
      topics: [
        ['observatory', 0.8],
        ['insights.daily', 0.7],
        ['chronik-events', 0.6],
      ],
    });

    const result = compareInsights(current, previous);

    expect(result.current_ts).toBe('2025-12-28');
    expect(result.previous_ts).toBe('2025-12-27');
    expect(result.topics.added).toEqual([{ name: 'leitstand-ui', score: 0.5 }]);
    expect(result.topics.removed).toEqual([{ name: 'chronik-events', score: 0.6 }]);
    expect(result.topics.changed).toEqual([
      { name: 'observatory', previous: 0.8, current: 0.9, diff: 0.1, direction: 'up' },
    ]);
    expect(result.topics.unchanged).toBe(1);
    expect(result.has_changes).toBe(true);
  });

  it('captures downward score movement', () => {
    const result = compareInsights(
      insights({ topics: [['ci', 0.3]] }),
      insights({ topics: [['ci', 0.75]] }),
    );

    expect(result.topics.changed).toHaveLength(1);
    expect(result.topics.changed[0]).toMatchObject({ name: 'ci', direction: 'down', diff: -0.45 });
  });

  it('treats sub-epsilon score noise as unchanged', () => {
    const result = compareInsights(
      insights({ topics: [['x', 0.5000001]] }),
      insights({ topics: [['x', 0.5]] }),
    );

    expect(result.topics.changed).toHaveLength(0);
    expect(result.topics.unchanged).toBe(1);
    expect(result.has_changes).toBe(false);
  });

  it('diffs questions by trimmed text, preserving order and de-duplicating', () => {
    const current = insights({
      questions: ['  Stabil?  ', 'Neu heute?', 'Neu heute?'],
    });
    const previous = insights({
      questions: ['Stabil?', 'Gestern offen?'],
    });

    const result = compareInsights(current, previous);

    expect(result.questions.added).toEqual(['Neu heute?']);
    expect(result.questions.resolved).toEqual(['Gestern offen?']);
  });

  it('sorts added/removed by score desc and changed by absolute delta desc', () => {
    const current = insights({
      topics: [
        ['low', 0.2],
        ['high', 0.9],
        ['big-mover', 0.95],
        ['small-mover', 0.55],
      ],
    });
    const previous = insights({
      topics: [
        ['gone-small', 0.1],
        ['gone-big', 0.8],
        ['big-mover', 0.15],
        ['small-mover', 0.5],
      ],
    });

    const result = compareInsights(current, previous);

    expect(result.topics.added.map((t) => t.name)).toEqual(['high', 'low']);
    expect(result.topics.removed.map((t) => t.name)).toEqual(['gone-big', 'gone-small']);
    expect(result.topics.changed.map((t) => t.name)).toEqual(['big-mover', 'small-mover']);
  });

  it('keeps only the first occurrence of a duplicated topic name', () => {
    const result = compareInsights(
      insights({ topics: [['dup', 0.9], ['dup', 0.1]] }),
      insights({ topics: [['dup', 0.9]] }),
    );

    expect(result.topics.changed).toHaveLength(0);
    expect(result.topics.unchanged).toBe(1);
  });

  it('reports no changes for identical payloads', () => {
    const payload = insights({ topics: [['a', 0.5]], questions: ['q?'] });
    const result = compareInsights(payload, insights({ topics: [['a', 0.5]], questions: ['q?'] }));

    expect(result.has_changes).toBe(false);
    expect(result.topics.added).toEqual([]);
    expect(result.topics.removed).toEqual([]);
    expect(result.topics.changed).toEqual([]);
    expect(result.questions.added).toEqual([]);
    expect(result.questions.resolved).toEqual([]);
  });

  it('exposes null ts when a payload has an empty date', () => {
    const result = compareInsights(insights({ ts: '' }), insights({ ts: '2025-12-27' }));
    expect(result.current_ts).toBeNull();
    expect(result.previous_ts).toBe('2025-12-27');
  });
});

describe('previousDateOf', () => {
  it('returns the day before a valid date', () => {
    expect(previousDateOf('2025-12-28')).toBe('2025-12-27');
  });

  it('handles month and year boundaries', () => {
    expect(previousDateOf('2026-01-01')).toBe('2025-12-31');
    expect(previousDateOf('2025-03-01')).toBe('2025-02-28');
  });

  it('trims surrounding whitespace', () => {
    expect(previousDateOf('  2025-12-28  ')).toBe('2025-12-27');
  });

  it('rejects malformed or non-calendar dates', () => {
    expect(previousDateOf('')).toBeNull();
    expect(previousDateOf('2025-12')).toBeNull();
    expect(previousDateOf('not-a-date')).toBeNull();
    expect(previousDateOf('2025-13-40')).toBeNull();
    expect(previousDateOf('2025-02-30')).toBeNull();
  });
});
