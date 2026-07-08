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
  lead_identity_id?: string | null;
  identity_resolution_status?: string;
  identity_confidence?: number | null;
  identity_match_reasons?: string[];
  identity_review_required?: boolean;
  identity_candidates?: Record<string, unknown>[];
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
  active_campaign_id?: string | null;
  active_campaign_name?: string | null;
  active_campaign_channel?: string | null;
  active_campaign_status?: string | null;
  active_sequence_active: boolean;
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
