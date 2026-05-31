/** Conversations & messages API */

import { apiGet, apiGetList, apiMutate } from "@/lib/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  AssignedUser,
  ClientMatch,
  Conversation,
  ConversationCustomerContext,
  CustomerTimeline,
  CreateInternalNoteRequest,
  Message,
  SendMessageRequest,
  UpdateConversationRequest,
} from "@/types/chat";

function normalizeConversation(conversation: Conversation): Conversation {
  const normalizedTags = (conversation.tags ?? [])
    .map((tag) => tag?.toUpperCase() as Conversation["tags"][number])
    .filter(Boolean);
  const fallbackTag = conversation.tag ? (conversation.tag.toUpperCase() as NonNullable<Conversation["tag"]>) : null;
  return {
    ...conversation,
    channel: conversation.channel?.toUpperCase() as Conversation["channel"],
    status: conversation.status?.toUpperCase() as Conversation["status"],
    tag: fallbackTag ?? normalizedTags[0] ?? null,
    tags: normalizedTags.length > 0 ? normalizedTags : (fallbackTag ? [fallbackTag] : []),
  };
}

function toBackendConversationUpdate(data: UpdateConversationRequest) {
  return {
    ...data,
    status: data.status?.toLowerCase(),
    tag: data.tag?.toLowerCase() ?? data.tag,
    tags: data.tags?.map((tag) => tag.toLowerCase()),
  };
}

export async function getConversations(
  limit = 100,
  params?: { assigned_user_id?: string | null; status?: string | null }
): Promise<ApiResponse<Conversation[]>> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (params?.assigned_user_id) {
    query.set("assigned_user_id", params.assigned_user_id);
  }
  if (params?.status) {
    query.set("status", params.status);
  }
  const response = await apiGetList<Conversation>(`/chat/conversations?${query.toString()}`);
  return {
    ...response,
    data: response.data.map(normalizeConversation),
  };
}

export async function getMessages(
  conversationId: string,
  limit = 100
): Promise<ApiResponse<Message[]>> {
  return apiGetList<Message>(
    `/chat/conversations/${conversationId}/messages?limit=${limit}`
  );
}

export async function getConversationContext(
  conversationId: string,
): Promise<ConversationCustomerContext> {
  return apiGet<ConversationCustomerContext>(`/chat/conversations/${conversationId}/context`);
}

export async function getConversationTimeline(
  conversationId: string,
  params?: { limit?: number },
): Promise<CustomerTimeline> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiGet<CustomerTimeline>(`/chat/conversations/${conversationId}/timeline${suffix}`);
}

export async function sendMessage(
  conversationId: string,
  payload: Omit<SendMessageRequest, "conversation_id">
): Promise<Message> {
  return apiMutate<SendMessageRequest, Message>(
    `/chat/conversations/${conversationId}/messages`,
    "POST",
    { conversation_id: conversationId, ...payload }
  );
}

export async function createInternalNote(
  conversationId: string,
  payload: CreateInternalNoteRequest
): Promise<Message> {
  return apiMutate<CreateInternalNoteRequest, Message>(
    `/chat/conversations/${conversationId}/internal-notes`,
    "POST",
    payload
  );
}

export async function updateConversation(
  conversationId: string,
  data: UpdateConversationRequest
): Promise<Conversation> {
  const updated = await apiMutate<ReturnType<typeof toBackendConversationUpdate>, Conversation>(
    `/chat/conversations/${conversationId}`,
    "PATCH",
    toBackendConversationUpdate(data)
  );
  return normalizeConversation(updated);
}

export async function assignConversation(
  conversationId: string,
  assignedUserId: string | null
): Promise<import("@/types/chat").Conversation> {
  const updated = await apiMutate<{ assigned_user_id: string | null }, import("@/types/chat").Conversation>(
    `/chat/conversations/${conversationId}/assign`,
    "PATCH",
    { assigned_user_id: assignedUserId }
  );
  return normalizeConversation(updated);
}

export async function getAssignableUsers(): Promise<AssignedUser[]> {
  return apiGet<AssignedUser[]>("/chat/assignable-users");
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await apiMutate<undefined, void>(
    `/chat/conversations/${conversationId}`,
    "DELETE"
  );
}

export async function retryMessage(
  conversationId: string,
  messageId: string
): Promise<Message> {
  return apiMutate<undefined, Message>(
    `/chat/conversations/${conversationId}/messages/${messageId}/retry`,
    "POST"
  );
}

// ── Client ↔ Contact linking ────────────────────────────────────────────────

export async function detectClientForConversation(
  conversationId: string
): Promise<{ matches: ClientMatch[]; already_linked: boolean }> {
  return apiGet<{ matches: ClientMatch[]; already_linked: boolean }>(
    `/admin/conversations/${conversationId}/detect-client`
  );
}

export async function linkContactToClient(
  contactId: string,
  clientId: string | null
): Promise<{ contact_id: string; client_id: string | null }> {
  return apiMutate(
    `/admin/contacts/${contactId}/client`,
    "PATCH",
    { client_id: clientId }
  );
}

export async function getClientConversations(
  clientId: string,
  params?: { skip?: number; limit?: number }
): Promise<ApiResponse<ConversationSummary[]>> {
  const q = new URLSearchParams();
  if (params?.skip) q.set("skip", String(params.skip));
  if (params?.limit) q.set("limit", String(params.limit));
  const suffix = q.toString() ? `?${q}` : "";
  return apiGetList<ConversationSummary>(`/admin/clients/${clientId}/conversations${suffix}`);
}

export interface ConversationSummary {
  id: string;
  channel: string;
  status: string;
  last_message?: string | null;
  last_message_date?: string | null;
  created_at: string;
  updated_at: string;
  contact_id: string;
  contact_name?: string | null;
  channel_identifier?: string | null;
}

export async function deleteMessage(
  conversationId: string,
  messageId: string
): Promise<{ deleted: boolean; id: string }> {
  return apiMutate<undefined, { deleted: boolean; id: string }>(
    `/chat/conversations/${conversationId}/messages/${messageId}`,
    "DELETE"
  );
}
