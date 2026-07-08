export type LeadQualificationLabel = "cold" | "warm" | "hot" | "low_confidence" | string;

export interface LeadScoreBreakdownItem {
  component: string;
  points: number;
  max_points?: number;
  source: string;
  rationale: string;
}

export interface LeadDto {
  id: string;
  conversation_id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source_channel: string;
  status: string;
  extraction_confidence: Record<string, unknown>;
  duplicate_risk: boolean;
  role?: string | null;
  pain_points?: string[];
  qualification_notes?: string | null;
  source_facts?: Record<string, unknown>;
  ai_inferences?: Record<string, unknown>;
  enrichment_status?: string;
  enrichment_error?: string | null;
  enriched_at?: string | null;
  score?: number | null;
  qualification_label?: LeadQualificationLabel | null;
  score_confidence?: number | null;
  low_confidence: boolean;
  score_breakdown: LeadScoreBreakdownItem[];
  score_rationale?: string | null;
  scoring_version?: string | null;
  scored_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface LeadScoringConfig {
  version: string;
  thresholds: {
    hot: number;
    warm: number;
    cold: number;
  };
  low_confidence_threshold: number;
  components: Record<string, number>;
}
