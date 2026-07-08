export type CampaignChannel = "whatsapp" | "telegram" | "email" | "sms" | string;

export interface CampaignCadence {
  start_at?: string;
  timezone?: string;
  follow_up_interval_days?: number;
  planned_steps?: number;
  [key: string]: unknown;
}

export interface CampaignLaunchRequest {
  objective: string;
  channel: CampaignChannel;
  cadence: CampaignCadence;
  owner_user_id?: string;
  lead_ids?: string[];
  segment_filter?: Record<string, unknown>;
}

export interface CampaignSkippedLead {
  lead_id: string;
  reason: string;
}

export interface CampaignMembership {
  id: string;
  lead_id: string;
  lead_identity_id?: string | null;
  status: string;
  skip_reason?: string | null;
}

export interface CampaignStepDto {
  id: string;
  campaign_id: string;
  lead_id: string;
  campaign_lead_id?: string | null;
  step_type: "initial_outreach" | "follow_up" | string;
  channel: CampaignChannel;
  position: number;
  due_at?: string | null;
  status: "draft" | "needs_review" | "approved" | "sending" | "sent" | "failed" | "skipped" | string;
  generated_content: string;
  reviewed_content?: string | null;
  generation_metadata: Record<string, unknown>;
  reviewed_by_id?: string | null;
  reviewed_at?: string | null;
  message_id?: string | null;
  failure_reason?: string | null;
  skip_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CampaignStepReviewRequest {
  reviewed_content?: string | null;
  approve?: boolean;
}

export interface CampaignDto {
  id: string;
  objective: string;
  channel: CampaignChannel;
  cadence: CampaignCadence;
  status: string;
  owner_user_id: string;
  created_by_user_id: string;
  source_type: string;
  source_filter: Record<string, unknown>;
  included_count: number;
  skipped_count: number;
  skipped: CampaignSkippedLead[];
  memberships?: CampaignMembership[];
  steps?: CampaignStepDto[];
  created_at?: string | null;
  updated_at?: string | null;
}
