import type { LeadDto } from "@/types/lead";

const SUPPORTED_CHANNELS = new Set(["whatsapp", "telegram", "email", "sms"]);

export function getLeadLaunchBlockReason(lead: Pick<LeadDto, "active_sequence_active" | "source_channel"> | null): string | null {
  if (!lead) return "Select a lead before launching a campaign.";
  if (lead.active_sequence_active) return "Lead is already in an active sequence.";
  if (!SUPPORTED_CHANNELS.has(lead.source_channel)) return "Lead channel is not supported for outreach campaigns.";
  return null;
}

export function getDefaultCampaignChannel(lead: Pick<LeadDto, "source_channel"> | null): string {
  if (lead && SUPPORTED_CHANNELS.has(lead.source_channel)) return lead.source_channel;
  return "whatsapp";
}
