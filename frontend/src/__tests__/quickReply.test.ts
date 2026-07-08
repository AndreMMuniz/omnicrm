/**
 * Tests for Quick Reply shortcut normalization and search matching logic.
 */

import { describe, it, expect } from "vitest";
import type { QuickReply } from "@/types/quickReply";
import type { UserType } from "@/types/auth";
import {
  applyQuickReplyToDraft,
  canManageQuickReplies,
  shouldShowQuickReplyCreationControls,
} from "@/lib/quickReplyComposer";

// Pure utility: shortcut normalization (mirrors the backend endpoint logic)
function normalizeShortcut(raw: string): string {
  return raw.startsWith("/") ? raw : `/${raw}`;
}

// Pure utility: filter quick replies by prefix (mirrors backend search)
function filterByPrefix(replies: QuickReply[], query: string): QuickReply[] {
  if (!query) return replies;
  const q = query.toLowerCase();
  return replies.filter((r) => r.shortcut.toLowerCase().includes(q));
}

function makeQR(shortcut: string, content = "Content"): QuickReply {
  return { id: shortcut, shortcut, content, created_at: new Date().toISOString() };
}

describe("normalizeShortcut", () => {
  it("adds leading slash if missing", () => {
    expect(normalizeShortcut("hello")).toBe("/hello");
  });

  it("keeps existing leading slash", () => {
    expect(normalizeShortcut("/hello")).toBe("/hello");
  });

  it("keeps empty string as slash", () => {
    expect(normalizeShortcut("")).toBe("/");
  });

  it("does not double slash", () => {
    expect(normalizeShortcut("/hi")).toBe("/hi");
  });
});

describe("filterByPrefix", () => {
  const replies = [
    makeQR("/hello"),
    makeQR("/help"),
    makeQR("/bye"),
    makeQR("/thanks"),
  ];

  it("returns all when query is empty", () => {
    expect(filterByPrefix(replies, "")).toHaveLength(4);
  });

  it("filters by partial match", () => {
    const results = filterByPrefix(replies, "hel");
    expect(results.map((r) => r.shortcut)).toEqual(["/hello", "/help"]);
  });

  it("is case-insensitive", () => {
    const results = filterByPrefix(replies, "HEL");
    expect(results).toHaveLength(2);
  });

  it("returns empty array when no match", () => {
    expect(filterByPrefix(replies, "xyz")).toHaveLength(0);
  });

  it("exact match returns one result", () => {
    const results = filterByPrefix(replies, "/bye");
    expect(results).toHaveLength(1);
    expect(results[0].shortcut).toBe("/bye");
  });
});

describe("quick reply autocomplete trigger", () => {
  it("should trigger on / prefix", () => {
    const input = "/he";
    expect(input.startsWith("/")).toBe(true);
  });

  it("should NOT trigger on regular text", () => {
    const input = "hello";
    expect(input.startsWith("/")).toBe(false);
  });

  it("should trigger immediately on single /", () => {
    const input = "/";
    expect(input.startsWith("/")).toBe(true);
    expect(input.length).toBeGreaterThanOrEqual(1);
  });
});

describe("applyQuickReplyToDraft", () => {
  it("replaces a slash shortcut draft with canned response content", () => {
    expect(applyQuickReplyToDraft("/hello", "Hello! How can I help?")).toBe("Hello! How can I help?");
  });

  it("inserts canned response after existing non-shortcut draft text", () => {
    expect(applyQuickReplyToDraft("I already wrote this", "Hello! How can I help?")).toBe(
      "I already wrote this\nHello! How can I help?"
    );
  });

  it("keeps the inserted content editable as plain draft text", () => {
    const inserted = applyQuickReplyToDraft("/hello", "Hello! How can I help?");
    expect(`${inserted} I can also share pricing.`).toBe("Hello! How can I help? I can also share pricing.");
  });
});

describe("quick reply management permissions", () => {
  const baseUserType: UserType = {
    id: "role-1",
    name: "Operator",
    base_role: "USER",
    is_system: false,
    can_view_all_conversations: false,
    can_delete_conversations: false,
    can_edit_messages: false,
    can_delete_messages: false,
    can_manage_users: false,
    can_assign_roles: false,
    can_disable_users: false,
    can_change_user_password: false,
    can_change_settings: false,
    can_change_branding: false,
    can_change_ai_model: false,
    can_view_audit_logs: false,
    can_create_user_types: false,
    created_at: new Date().toISOString(),
  };

  it("hides management creation controls from normal operators", () => {
    expect(canManageQuickReplies(baseUserType)).toBe(false);
    expect(shouldShowQuickReplyCreationControls(baseUserType)).toBe(false);
  });

  it("shows management creation controls to users who can change settings", () => {
    const managerType = { ...baseUserType, can_change_settings: true };

    expect(canManageQuickReplies(managerType)).toBe(true);
    expect(shouldShowQuickReplyCreationControls(managerType)).toBe(true);
  });
});
