import { apiGet, apiGetList, apiMutate } from "@/lib/apiClient";
import type { LeadDto, LeadScoringConfig } from "@/types/lead";
import type { OutreachGroundingRequest, OutreachGroundingResponse } from "@/types/outreach";

export async function listLeads(params?: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiGetList<LeadDto>(`/leads${suffix}`);
}

export async function getLead(leadId: string): Promise<LeadDto> {
  return apiGet<LeadDto>(`/leads/${leadId}`);
}

export async function scoreLead(leadId: string): Promise<LeadDto> {
  return apiMutate<undefined, LeadDto>(`/leads/${leadId}/score`, "POST");
}

export async function getScoringConfig(): Promise<LeadScoringConfig> {
  return apiGet<LeadScoringConfig>("/leads/scoring/config");
}

export async function updateScoringConfig(config: LeadScoringConfig): Promise<LeadScoringConfig> {
  return apiMutate<LeadScoringConfig, LeadScoringConfig>("/leads/scoring/config", "PATCH", config);
}

export async function buildLeadOutreachGrounding(
  leadId: string,
  payload: OutreachGroundingRequest = {},
): Promise<OutreachGroundingResponse> {
  return apiMutate<OutreachGroundingRequest, OutreachGroundingResponse>(
    `/leads/${leadId}/outreach-grounding`,
    "POST",
    payload,
  );
}
