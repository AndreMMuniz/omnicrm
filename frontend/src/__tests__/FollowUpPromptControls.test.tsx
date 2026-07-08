import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FollowUpActionPanel, FollowUpBadge } from "@/components/messages/FollowUpPromptControls";
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

describe("FollowUpBadge", () => {
  it("renders the follow-up cue label when active", () => {
    render(<FollowUpBadge conversation={makeConversation({ needs_follow_up: true, follow_up_note: "Call tomorrow." })} />);

    expect(screen.getByText("Call tomorrow.")).toBeTruthy();
    expect(screen.getByTitle("Call tomorrow.")).toBeTruthy();
  });

  it("renders nothing when follow-up is inactive", () => {
    const { container } = render(<FollowUpBadge conversation={makeConversation()} />);

    expect(container.textContent).toBe("");
  });
});

describe("FollowUpActionPanel", () => {
  it("shows Mark controls and sends note changes for inactive follow-up", () => {
    const onNoteChange = vi.fn();
    const onSave = vi.fn();
    const onClear = vi.fn();

    render(
      <FollowUpActionPanel
        conversation={makeConversation()}
        note=""
        saving={false}
        onNoteChange={onNoteChange}
        onSave={onSave}
        onClear={onClear}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Add a short next action for this conversation."), {
      target: { value: "Confirm acceptance." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark" }));

    expect(onNoteChange).toHaveBeenCalledWith("Confirm acceptance.");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("shows Update and Clear controls for active follow-up", () => {
    const onSave = vi.fn();
    const onClear = vi.fn();

    render(
      <FollowUpActionPanel
        conversation={makeConversation({ needs_follow_up: true, follow_up_note: "Send renewal." })}
        note="Send renewal."
        saving={false}
        onNoteChange={() => undefined}
        onSave={onSave}
        onClear={onClear}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByText("Follow-up")).toBeTruthy();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("disables actions while saving", () => {
    render(
      <FollowUpActionPanel
        conversation={makeConversation({ needs_follow_up: true })}
        note=""
        saving={true}
        onNoteChange={() => undefined}
        onSave={() => undefined}
        onClear={() => undefined}
      />
    );

    expect((screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Clear" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
