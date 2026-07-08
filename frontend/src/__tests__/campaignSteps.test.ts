import { describe, expect, it } from "vitest";

import { canSendCampaignStep, getCampaignStepStatusLabel, getEditableStepContent } from "@/lib/campaignSteps";

describe("campaign step helpers", () => {
  it("renders visible failure and skip reasons", () => {
    expect(getCampaignStepStatusLabel({ status: "failed", failure_reason: "channel rejected" })).toBe(
      "Failed: channel rejected",
    );
    expect(getCampaignStepStatusLabel({ status: "skipped", skip_reason: "unsupported_channel" })).toBe(
      "Skipped: unsupported_channel",
    );
  });

  it("requires reviewed content before send", () => {
    expect(canSendCampaignStep({ status: "approved", reviewed_content: "Ready" })).toBe(true);
    expect(canSendCampaignStep({ status: "approved", reviewed_content: "" })).toBe(false);
    expect(canSendCampaignStep({ status: "needs_review", reviewed_content: "Ready" })).toBe(false);
  });

  it("prefers reviewed copy over generated copy", () => {
    expect(getEditableStepContent({ generated_content: "Generated", reviewed_content: "Reviewed" })).toBe("Reviewed");
    expect(getEditableStepContent({ generated_content: "Generated", reviewed_content: null })).toBe("Generated");
  });
});
