export interface ReflexionMetaState {
  confidence: number;
  fatigue: number;
  risk_tension: number;
  autonomy_level: string;
  basis_signals: string[];
}

export interface DriftMarker {
  id: string;
  time_context: string;
  description: string;
  evidence_ref?: string;
}

export interface KnowledgeGap {
  id: string;
  category: string;
  description: string;
  confidence_impact?: number;
}

export interface Hypothesis {
  id: string;
  diagnose: string;
  is_hypothesis: boolean;
  recommendations: string[];
}

export interface ReflexionBundle {
  schema: string;
  generated_at?: string;
  meta_state?: ReflexionMetaState;
  drift_markers?: DriftMarker[];
  knowledge_gaps?: KnowledgeGap[];
  hypotheses?: Hypothesis[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asUnitIntervalNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function sanitizeMetaState(raw: unknown): ReflexionMetaState | null {
  if (!isRecord(raw)) return null;

  const confidence = asUnitIntervalNumber(raw.confidence);
  const fatigue = asUnitIntervalNumber(raw.fatigue);
  const riskTension = asUnitIntervalNumber(raw.risk_tension);
  const autonomyLevel = asNonEmptyString(raw.autonomy_level);

  if (confidence === null || fatigue === null || riskTension === null || autonomyLevel === null) {
    return null;
  }

  if (!Array.isArray(raw.basis_signals)) {
    return null;
  }

  const basisSignals = raw.basis_signals
    .map(asNonEmptyString)
    .filter((signal): signal is string => signal !== null);

  return {
    confidence,
    fatigue,
    risk_tension: riskTension,
    autonomy_level: autonomyLevel,
    basis_signals: basisSignals,
  };
}

function sanitizeDriftMarker(raw: unknown): DriftMarker | null {
  if (!isRecord(raw)) return null;

  const id = asNonEmptyString(raw.id);
  const timeContext = asNonEmptyString(raw.time_context);
  const description = asNonEmptyString(raw.description);
  if (id === null || timeContext === null || description === null) return null;

  const evidenceRef = asNonEmptyString(raw.evidence_ref);
  return evidenceRef
    ? { id, time_context: timeContext, description, evidence_ref: evidenceRef }
    : { id, time_context: timeContext, description };
}

function sanitizeKnowledgeGap(raw: unknown): KnowledgeGap | null {
  if (!isRecord(raw)) return null;

  const id = asNonEmptyString(raw.id);
  const category = asNonEmptyString(raw.category);
  const description = asNonEmptyString(raw.description);
  if (id === null || category === null || description === null) return null;

  const confidenceImpact = raw.confidence_impact === undefined ? undefined : asUnitIntervalNumber(raw.confidence_impact);
  return typeof confidenceImpact === 'number'
    ? { id, category, description, confidence_impact: confidenceImpact }
    : { id, category, description };
}

function sanitizeHypothesis(raw: unknown): Hypothesis | null {
  if (!isRecord(raw)) return null;

  const id = asNonEmptyString(raw.id);
  const diagnose = asNonEmptyString(raw.diagnose);
  const isHypothesis = raw.is_hypothesis;
  if (id === null || diagnose === null || typeof isHypothesis !== 'boolean') return null;
  if (!Array.isArray(raw.recommendations)) return null;

  const recommendations = raw.recommendations
    .map(asNonEmptyString)
    .filter((recommendation): recommendation is string => recommendation !== null);

  return {
    id,
    diagnose,
    is_hypothesis: isHypothesis,
    recommendations,
  };
}

/**
 * Ensures that the raw parsed JSON at least resembles a ReflexionBundle.
 * Invalid structures return null to trigger fallback mechanisms.
 */
export function sanitizeReflexionBundle(raw: unknown): ReflexionBundle | null {
  if (!isRecord(raw)) {
    return null;
  }

  if (raw.schema !== undefined && typeof raw.schema !== 'string') {
    return null;
  }

  if (raw.meta_state !== undefined && !isRecord(raw.meta_state)) return null;
  if (raw.drift_markers !== undefined && !Array.isArray(raw.drift_markers)) return null;
  if (raw.knowledge_gaps !== undefined && !Array.isArray(raw.knowledge_gaps)) return null;
  if (raw.hypotheses !== undefined && !Array.isArray(raw.hypotheses)) return null;

  const metaState = raw.meta_state === undefined ? undefined : sanitizeMetaState(raw.meta_state);
  if (raw.meta_state !== undefined && metaState === null) return null;

  const driftMarkers = (raw.drift_markers ?? [])
    .map(sanitizeDriftMarker)
    .filter((entry): entry is DriftMarker => entry !== null);

  const knowledgeGaps = (raw.knowledge_gaps ?? [])
    .map(sanitizeKnowledgeGap)
    .filter((entry): entry is KnowledgeGap => entry !== null);

  const hypotheses = (raw.hypotheses ?? [])
    .map(sanitizeHypothesis)
    .filter((entry): entry is Hypothesis => entry !== null);

  return {
    schema: typeof raw.schema === 'string' ? raw.schema : 'heimgeist.reflexion.bundle.v1',
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : undefined,
    meta_state: metaState,
    drift_markers: driftMarkers,
    knowledge_gaps: knowledgeGaps,
    hypotheses,
  };
}
