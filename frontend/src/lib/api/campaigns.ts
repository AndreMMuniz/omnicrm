import { apiGet, apiMutate } from "@/lib/apiClient";
import type {
  CampaignDto,
  CampaignLaunchRequest,
  CampaignStepDto,
  CampaignStepReviewRequest,
} from "@/types/campaign";

export async function createCampaign(payload: CampaignLaunchRequest): Promise<CampaignDto> {
  return apiMutate<CampaignLaunchRequest, CampaignDto>("/campaigns", "POST", payload);
}

export async function getCampaign(campaignId: string): Promise<CampaignDto> {
  return apiGet<CampaignDto>(`/campaigns/${campaignId}`);
}

export async function generateCampaignSteps(
  campaignId: string,
  stepTypes?: string[],
): Promise<CampaignStepDto[]> {
  const response = await apiMutate<{ step_types?: string[] }, { steps: CampaignStepDto[] }>(
    `/campaigns/${campaignId}/steps/generate`,
    "POST",
    { step_types: stepTypes },
  );
  return response.steps;
}

export async function reviewCampaignStep(
  stepId: string,
  payload: CampaignStepReviewRequest,
): Promise<CampaignStepDto> {
  return apiMutate<CampaignStepReviewRequest, CampaignStepDto>(
    `/campaigns/steps/${stepId}/review`,
    "PATCH",
    payload,
  );
}

export async function sendCampaignStep(stepId: string): Promise<CampaignStepDto> {
  return apiMutate<undefined, CampaignStepDto>(`/campaigns/steps/${stepId}/send`, "POST", undefined);
}

export async function skipCampaignStep(stepId: string, reason: string): Promise<CampaignStepDto> {
  return apiMutate<{ reason: string }, CampaignStepDto>(
    `/campaigns/steps/${stepId}/skip`,
    "POST",
    { reason },
  );
}
