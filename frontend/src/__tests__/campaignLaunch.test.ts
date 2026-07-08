import { describe, expect, it } from "vitest";

import { getDefaultCampaignChannel, getLeadLaunchBlockReason } from "@/lib/campaignLaunch";

describe("campaign launch helpers", () => {
  it("blocks launch when no lead is selected", () => {
    expect(getLeadLaunchBlockReason(null)).toBe("Select a lead before launching a campaign.");
  });

  it("blocks leads that are already in an active sequence", () => {
    expect(getLeadLaunchBlockReason({ active_sequence_active: true, source_channel: "whatsapp" })).toBe(
      "Lead is already in an active sequence.",
    );
  });

  it("blocks unsupported channels", () => {
    expect(getLeadLaunchBlockReason({ active_sequence_active: false, source_channel: "web" })).toBe(
      "Lead channel is not supported for outreach campaigns.",
    );
  });

  it("uses the lead channel when supported", () => {
    expect(getDefaultCampaignChannel({ source_channel: "email" })).toBe("email");
    expect(getDefaultCampaignChannel({ source_channel: "web" })).toBe("whatsapp");
  });
});
