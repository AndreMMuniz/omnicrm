import type { Conversation, UpdateConversationRequest } from "@/types/chat";

export type FollowUpFilter = "ALL" | "FOLLOW_UP";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildFollowUpPatch(note: string): UpdateConversationRequest {
  const trimmedNote = note.trim();
  return {
    needs_follow_up: true,
    follow_up_note: trimmedNote || null,
  };
}

export function buildClearFollowUpPatch(): UpdateConversationRequest {
  return {
    needs_follow_up: false,
    follow_up_note: null,
    follow_up_at: null,
  };
}

export function formatFollowUpDueLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  const displayMinutes = String(minutes).padStart(2, "0");

  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${displayHour}:${displayMinutes} ${period}`;
}

export function getFollowUpCueLabel(conversation: Pick<Conversation, "needs_follow_up" | "follow_up_note" | "follow_up_at">): string | null {
  if (!conversation.needs_follow_up) return null;

  const note = conversation.follow_up_note?.trim();
  if (note) return note;

  const due = formatFollowUpDueLabel(conversation.follow_up_at);
  return due ? `Follow up ${due}` : "Needs follow-up";
}

export function matchesFollowUpFilter(
  conversation: Pick<Conversation, "needs_follow_up">,
  filter: FollowUpFilter,
): boolean {
  return filter === "ALL" || conversation.needs_follow_up;
}
