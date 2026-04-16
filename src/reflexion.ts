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

/**
 * Ensures that the raw parsed JSON at least resembles a ReflexionBundle.
 * Invalid structures return null to trigger fallback mechanisms.
 */
export function sanitizeReflexionBundle(raw: unknown): ReflexionBundle | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Optional string validation for schema
  if (obj.schema !== undefined && typeof obj.schema !== 'string') {
    return null;
  }

  // Ensure arrays exist if properties are present, else map to empty arrays for UI safety
  return {
    schema: typeof obj.schema === 'string' ? obj.schema : 'heimgeist.reflexion.bundle.v1',
    generated_at: typeof obj.generated_at === 'string' ? obj.generated_at : undefined,
    meta_state: typeof obj.meta_state === 'object' && obj.meta_state !== null
        ? obj.meta_state as ReflexionMetaState 
        : undefined,
    drift_markers: Array.isArray(obj.drift_markers) ? obj.drift_markers as DriftMarker[] : [],
    knowledge_gaps: Array.isArray(obj.knowledge_gaps) ? obj.knowledge_gaps as KnowledgeGap[] : [],
    hypotheses: Array.isArray(obj.hypotheses) ? obj.hypotheses as Hypothesis[] : []
  };
}
