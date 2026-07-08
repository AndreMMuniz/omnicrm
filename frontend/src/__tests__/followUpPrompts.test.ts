import { describe, expect, it } from "vitest";

import {
  buildFollowUpPatch,
  formatFollowUpDueLabel,
  getFollowUpCueLabel,
  matchesFollowUpFilter,
} from "@/lib/followUpPrompts";
import type { Conversation } from "@/types/chat";

function makeConversation(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation-1",
    contact_id: "contact-1",
    channel: "WEB",
    status: "OPEN",
    tags: [],
    is_unread: false,
    needs_follow_up: false,
    follow_up_note: null,
    follow_up_at: null,
    created_at: "2026-07-08T10:00:00Z",
    updated_at: "2026-07-08T10:00:00Z",
    contact: {
      id: "contact-1",
      name: "Ana Client",
    },
    ...patch,
  };
}

describe("follow-up prompts", () => {
  it("builds a mark-follow-up patch with a trimmed note", () => {
    expect(buildFollowUpPatch("  Confirm proposal acceptance.  ")).toEqual({
      needs_follow_up: true,
      follow_up_note: "Confirm proposal acceptance.",
    });
  });

  it("clears empty notes to null while keeping the cue active", () => {
    expect(buildFollowUpPatch("   ")).toEqual({
      needs_follow_up: true,
      follow_up_note: null,
    });
  });

  it("formats a clear cue label from note first", () => {
    const conversation = makeConversation({
      needs_follow_up: true,
      follow_up_note: "Send revised quote.",
      follow_up_at: "2026-07-09T12:30:00Z",
    });

    expect(getFollowUpCueLabel(conversation)).toBe("Send revised quote.");
  });

  it("falls back to due date when no note exists", () => {
    const conversation = makeConversation({
      needs_follow_up: true,
      follow_up_at: "2026-07-09T12:30:00Z",
    });

    expect(getFollowUpCueLabel(conversation)).toBe("Follow up Jul 9, 12:30 PM");
  });

  it("does not show a cue label when follow-up is inactive", () => {
    expect(getFollowUpCueLabel(makeConversation())).toBeNull();
  });

  it("matches the follow-up inbox filter", () => {
    expect(matchesFollowUpFilter(makeConversation({ needs_follow_up: true }), "FOLLOW_UP")).toBe(true);
    expect(matchesFollowUpFilter(makeConversation({ needs_follow_up: false }), "FOLLOW_UP")).toBe(false);
    expect(matchesFollowUpFilter(makeConversation({ needs_follow_up: false }), "ALL")).toBe(true);
  });

  it("formats compact due labels", () => {
    expect(formatFollowUpDueLabel("2026-07-09T12:30:00Z")).toBe("Jul 9, 12:30 PM");
    expect(formatFollowUpDueLabel(null)).toBeNull();
  });
});
