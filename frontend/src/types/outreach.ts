export type GroundingSourceType =
  | "lead"
  | "lead_identity"
  | "lead_enrichment"
  | "lead_scoring"
  | "conversation"
  | "contact"
  | "client"
  | "project"
  | "proposal"
  | "catalog_item";

export interface GroundingCitation {
  source_type: GroundingSourceType;
  source_id: string;
  source_field: string;
}

export interface GroundedFact {
  key: string;
  value: unknown;
  source_type: GroundingSourceType;
  source_id: string;
  source_field: string;
  confidence?: number | null;
}

export interface GroundedInference {
  key: string;
  value: unknown;
  source_type: GroundingSourceType;
  source_id: string;
  source_field: string;
  confidence?: number | null;
  rationale?: string | null;
}

export interface OmittedGroundingSource {
  source_type: string;
  reason: string;
}

export interface OutreachGroundingRequest {
  channel?: string | null;
  scope?: string;
}

export interface OutreachGroundingResponse {
  entity_type: "lead";
  entity_id: string;
  scope: string;
  channel?: string | null;
  fallback_mode: boolean;
  facts: GroundedFact[];
  inferences: GroundedInference[];
  citations: GroundingCitation[];
  omitted_sources: OmittedGroundingSource[];
  prompt_inputs: Record<string, unknown>;
}
