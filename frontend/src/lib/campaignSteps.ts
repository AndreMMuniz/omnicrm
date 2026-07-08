import type { CampaignStepDto } from "@/types/campaign";

export function getCampaignStepStatusLabel(step: Pick<CampaignStepDto, "status" | "failure_reason" | "skip_reason">) {
  if (step.status === "failed") return step.failure_reason ? `Failed: ${step.failure_reason}` : "Failed";
  if (step.status === "skipped") return step.skip_reason ? `Skipped: ${step.skip_reason}` : "Skipped";
  if (step.status === "needs_review") return "Needs review";
  if (step.status === "approved") return "Approved";
  if (step.status === "sent") return "Sent";
  if (step.status === "sending") return "Sending";
  return step.status;
}

export function canSendCampaignStep(step: Pick<CampaignStepDto, "status" | "reviewed_content">) {
  return step.status === "approved" && Boolean(step.reviewed_content?.trim());
}

export function getEditableStepContent(step: Pick<CampaignStepDto, "reviewed_content" | "generated_content">) {
  return step.reviewed_content ?? step.generated_content;
}
