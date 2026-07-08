import type { UserType } from "@/types/auth";

export function applyQuickReplyToDraft(currentDraft: string, quickReplyContent: string): string {
  const draft = currentDraft.trimEnd();
  if (!draft || draft.startsWith("/")) return quickReplyContent;
  return `${draft}\n${quickReplyContent}`;
}

export function canManageQuickReplies(userType?: Pick<UserType, "can_change_settings"> | null): boolean {
  return Boolean(userType?.can_change_settings);
}

export function shouldShowQuickReplyCreationControls(userType?: Pick<UserType, "can_change_settings"> | null): boolean {
  return canManageQuickReplies(userType);
}
