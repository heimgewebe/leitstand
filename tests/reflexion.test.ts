import { describe, expect, it } from 'vitest';
import { sanitizeReflexionBundle } from '../src/reflexion.js';

describe('sanitizeReflexionBundle', () => {
  it('accepts a valid reflexion payload', () => {
    const result = sanitizeReflexionBundle({
      schema: 'heimgeist.reflexion.bundle.v1',
      generated_at: '2026-04-15T04:20:00Z',
      meta_state: {
        confidence: 0.85,
        fatigue: 0.1,
        risk_tension: 0.2,
        autonomy_level: 'aware',
        basis_signals: ['CI success rate 99%'],
      },
      drift_markers: [
        { id: 'd-1', time_context: '72h', description: 'Drift observed', evidence_ref: 'chronik:event.line' },
      ],
      knowledge_gaps: [
        { id: 'g-1', category: 'coverage', description: 'Missing repo metrics', confidence_impact: 0.15 },
      ],
      hypotheses: [
        { id: 'h-1', diagnose: 'Cron stalled', is_hypothesis: true, recommendations: ['Check logs'] },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.meta_state?.autonomy_level).toBe('aware');
    expect(result?.drift_markers).toHaveLength(1);
    expect(result?.knowledge_gaps).toHaveLength(1);
    expect(result?.hypotheses).toHaveLength(1);
  });

  it('removes invalid array items element-wise', () => {
    const result = sanitizeReflexionBundle({
      meta_state: {
        confidence: 0.5,
        fatigue: 0.4,
        risk_tension: 0.3,
        autonomy_level: 'active',
        basis_signals: ['signal', '', 42, 'other'],
      },
      drift_markers: [
        { id: 'd-1', time_context: '24h', description: 'ok' },
        { id: '', time_context: '24h', description: 'invalid' },
      ],
      knowledge_gaps: [
        { id: 'g-1', category: 'coverage', description: 'ok', confidence_impact: 'bad' },
        { id: 'g-2', category: '', description: 'invalid' },
      ],
      hypotheses: [
        { id: 'h-1', diagnose: 'ok', is_hypothesis: true, recommendations: ['do', '', 3] },
        { id: 'h-2', diagnose: 'invalid', is_hypothesis: 'yes', recommendations: [] },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.meta_state?.basis_signals).toEqual(['signal', 'other']);
    expect(result?.drift_markers).toEqual([{ id: 'd-1', time_context: '24h', description: 'ok' }]);
    expect(result?.knowledge_gaps).toEqual([{ id: 'g-1', category: 'coverage', description: 'ok' }]);
    expect(result?.knowledge_gaps?.[0]).not.toHaveProperty('confidence_impact');
    expect(result?.hypotheses).toEqual([
      { id: 'h-1', diagnose: 'ok', is_hypothesis: true, recommendations: ['do'] },
    ]);
  });

  it('normalizes out-of-range numeric meta values into 0..1', () => {
    const result = sanitizeReflexionBundle({
      meta_state: {
        confidence: 999,
        fatigue: -10,
        risk_tension: 0.25,
        autonomy_level: 'aware',
        basis_signals: [],
      },
    });

    expect(result?.meta_state?.confidence).toBe(1);
    expect(result?.meta_state?.fatigue).toBe(0);
    expect(result?.meta_state?.risk_tension).toBe(0.25);
  });

  it('returns null for broken root structures', () => {
    expect(sanitizeReflexionBundle(null)).toBeNull();
    expect(sanitizeReflexionBundle('bad')).toBeNull();
    expect(sanitizeReflexionBundle([])).toBeNull();
    expect(sanitizeReflexionBundle({ schema: 1 })).toBeNull();
    expect(sanitizeReflexionBundle({ schema: 'wrong.schema.v1' })).toBeNull();
    expect(sanitizeReflexionBundle({ meta_state: 'bad' })).toBeNull();
    expect(sanitizeReflexionBundle({ meta_state: [] })).toBeNull();
    expect(sanitizeReflexionBundle({ drift_markers: {} })).toBeNull();
    const nestedArrayResult = sanitizeReflexionBundle({ drift_markers: [[]] });
    expect(nestedArrayResult).not.toBeNull();
    expect(nestedArrayResult?.drift_markers).toEqual([]);
    expect(sanitizeReflexionBundle({
      meta_state: {
        confidence: Number.NaN,
        fatigue: 0.1,
        risk_tension: 0.1,
        autonomy_level: 'ok',
        basis_signals: ['s'],
      },
    })).toBeNull();
  });

  it('returns null when passed an array at root (arrays are not records)', () => {
    expect(sanitizeReflexionBundle([])).toBeNull();
    expect(sanitizeReflexionBundle([{ schema: 'heimgeist.reflexion.bundle.v1' }])).toBeNull();
  });

  it('rejects nested arrays masquerading as meta_state or drift_markers objects', () => {
    // An array at meta_state must not be treated as a Record
    expect(sanitizeReflexionBundle({ meta_state: [] })).toBeNull();
    // An array at drift_markers is rejected because drift_markers must be an array of records
    const result = sanitizeReflexionBundle({
      meta_state: {
        confidence: 0.5,
        fatigue: 0.3,
        risk_tension: 0.2,
        autonomy_level: 'aware',
        basis_signals: ['s'],
      },
      drift_markers: [[]],
    });
    // The inner array is not a record, so it is filtered out — not silently accepted
    expect(result).not.toBeNull();
    expect(result?.drift_markers).toHaveLength(0);
  });
});
