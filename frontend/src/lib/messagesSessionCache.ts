"use client";

import type { Conversation, Message } from "@/types/chat";

const CACHE_PREFIX = "messages-cache";
const CACHE_VERSION = 1;
const MAX_MESSAGES_PER_CONVERSATION = 150;

type MessagesSessionCache = {
  version: number;
  conversations: Conversation[];
  messagesByConversation: Record<string, Message[]>;
  activeConversationId: string | null;
  filters: MessagesWorkspaceFilters;
  updatedAt: string;
};

export type MessagesWorkspaceFilters = {
  searchQuery: string;
  selectedChannel: string;
  selectedStatus: string;
  selectedTag: string;
  selectedOwner: string;
  selectedFollowUp: string;
};

const memoryCache = new Map<string, MessagesSessionCache>();
const DEFAULT_FILTERS: MessagesWorkspaceFilters = {
  searchQuery: "",
  selectedChannel: "ALL",
  selectedStatus: "ALL",
  selectedTag: "ALL",
  selectedOwner: "ALL",
  selectedFollowUp: "ALL",
};

function buildKey(userId: string) {
  return `${CACHE_PREFIX}:${userId}`;
}

function isBrowser() {
  return typeof window !== "undefined";
}

function normalizeMessages(messages: Message[]) {
  const deduped = new Map<string, Message>();
  for (const message of messages) {
    deduped.set(message.id, message);
  }
  return [...deduped.values()]
    .sort((a, b) => a.conversation_sequence - b.conversation_sequence)
    .slice(-MAX_MESSAGES_PER_CONVERSATION);
}

function emptyCache(): MessagesSessionCache {
  return {
    version: CACHE_VERSION,
    conversations: [],
    messagesByConversation: {},
    activeConversationId: null,
    filters: DEFAULT_FILTERS,
    updatedAt: new Date().toISOString(),
  };
}

export function readMessagesSessionCache(userId: string | null | undefined): MessagesSessionCache | null {
  if (!userId) return null;

  const inMemory = memoryCache.get(userId);
  if (inMemory) return inMemory;

  if (!isBrowser()) return null;

  try {
    const raw = window.sessionStorage.getItem(buildKey(userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as MessagesSessionCache;
    if (parsed.version !== CACHE_VERSION) {
      window.sessionStorage.removeItem(buildKey(userId));
      return null;
    }

    const normalized: MessagesSessionCache = {
      version: CACHE_VERSION,
      conversations: parsed.conversations ?? [],
      messagesByConversation: Object.fromEntries(
        Object.entries(parsed.messagesByConversation ?? {}).map(([conversationId, messages]) => [
          conversationId,
          normalizeMessages(messages ?? []),
        ])
      ),
      activeConversationId: parsed.activeConversationId ?? null,
      filters: {
        ...DEFAULT_FILTERS,
        ...(parsed.filters ?? {}),
      },
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };

    memoryCache.set(userId, normalized);
    return normalized;
  } catch {
    window.sessionStorage.removeItem(buildKey(userId));
    return null;
  }
}

export function writeMessagesSessionCache(
  userId: string | null | undefined,
  updater: (current: MessagesSessionCache) => MessagesSessionCache,
): MessagesSessionCache | null {
  if (!userId) return null;

  const next = updater(readMessagesSessionCache(userId) ?? emptyCache());
  memoryCache.set(userId, next);

  if (isBrowser()) {
    window.sessionStorage.setItem(buildKey(userId), JSON.stringify(next));
  }

  return next;
}

export function saveConversationsToSessionCache(userId: string | null | undefined, conversations: Conversation[]) {
  writeMessagesSessionCache(userId, (current) => ({
    ...current,
    conversations,
    updatedAt: new Date().toISOString(),
  }));
}

export function saveMessagesToSessionCache(
  userId: string | null | undefined,
  conversationId: string,
  messages: Message[],
) {
  writeMessagesSessionCache(userId, (current) => ({
    ...current,
    messagesByConversation: {
      ...current.messagesByConversation,
      [conversationId]: normalizeMessages(messages),
    },
    updatedAt: new Date().toISOString(),
  }));
}

export function saveActiveConversationToSessionCache(
  userId: string | null | undefined,
  activeConversationId: string | null,
) {
  writeMessagesSessionCache(userId, (current) => ({
    ...current,
    activeConversationId,
    updatedAt: new Date().toISOString(),
  }));
}

export function getCachedMessagesForConversation(
  userId: string | null | undefined,
  conversationId: string,
): Message[] {
  return readMessagesSessionCache(userId)?.messagesByConversation[conversationId] ?? [];
}

export function getMessagesWorkspaceFilters(
  userId: string | null | undefined,
): MessagesWorkspaceFilters {
  return readMessagesSessionCache(userId)?.filters ?? DEFAULT_FILTERS;
}

export function saveMessagesWorkspaceFilters(
  userId: string | null | undefined,
  filters: Partial<MessagesWorkspaceFilters>,
) {
  writeMessagesSessionCache(userId, (current) => ({
    ...current,
    filters: {
      ...current.filters,
      ...filters,
    },
    updatedAt: new Date().toISOString(),
  }));
}

export function clearMessagesSessionCache(userId?: string | null) {
  if (userId) {
    memoryCache.delete(userId);
    if (isBrowser()) {
      window.sessionStorage.removeItem(buildKey(userId));
    }
    return;
  }

  memoryCache.clear();
  if (!isBrowser()) return;

  const keysToRemove: string[] = [];
  for (let index = 0; index < window.sessionStorage.length; index += 1) {
    const key = window.sessionStorage.key(index);
    if (key?.startsWith(`${CACHE_PREFIX}:`)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    window.sessionStorage.removeItem(key);
  }
}
