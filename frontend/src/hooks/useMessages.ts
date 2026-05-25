"use client";

import { useState, useCallback, useRef } from "react";

import { conversationsApi, uploadApi } from "@/lib/api/index";
import type { DeliveryStatus } from "@/types/chat";
import { getStoredUser } from "@/lib/api";
import { getCachedMessagesForConversation, saveMessagesToSessionCache } from "@/lib/messagesSessionCache";
import type { Message, MessageType, SendMessageRequest } from "@/types/chat";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;
const MAX_FILE_SIZE  = 20 * 1024 * 1024;

async function compressImage(file: File, maxDim = 1920, quality = 0.82): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }) : file),
        "image/jpeg", quality
      );
    };
    img.onerror = () => resolve(file);
    img.src = objectUrl;
  });
}

export type MessageSendStatus = "sending" | "sent" | "failed";

export interface UseMessagesReturn {
  messages: Message[];
  sendStatus: Record<string, MessageSendStatus>;
  sending: boolean;
  fetchMessages: (conversationId: string) => Promise<void>;
  createInternalNote: (conversationId: string, content: string) => Promise<void>;
  sendText: (conversationId: string, content: string) => Promise<void>;
  sendFile: (conversationId: string, file: File) => Promise<void>;
  sendAudio: (conversationId: string, blob: Blob) => Promise<void>;
  retryMessage: (conversationId: string, tempId: string) => void;
  /** Append a message received via WebSocket (deduplicates + keeps order) */
  appendMessage: (msg: Message) => void;
}

export function useMessages(scrollToBottom: () => void = () => {}): UseMessagesReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<Record<string, MessageSendStatus>>({});
  // Stores pending payloads for retry keyed by tempId
  const pendingRef = useRef<Record<string, { conversationId: string; payload: Omit<SendMessageRequest, "conversation_id"> }>>({});
  const currentConversationIdRef = useRef<string | null>(null);
  const requestConversationIdRef = useRef<string | null>(null);
  const userId = getStoredUser<{ id: string }>()?.id ?? null;

  const fetchMessages = useCallback(async (conversationId: string) => {
    currentConversationIdRef.current = conversationId;
    requestConversationIdRef.current = conversationId;

    const cached = getCachedMessagesForConversation(userId, conversationId);
    setMessages(cached);
    if (cached.length > 0) scrollToBottom();

    try {
      const { data } = await conversationsApi.getMessages(conversationId);
      if (requestConversationIdRef.current !== conversationId) return;
      const sorted = [...data].sort((a, b) => a.conversation_sequence - b.conversation_sequence);
      setMessages(sorted);
      saveMessagesToSessionCache(userId, conversationId, sorted);
      scrollToBottom();
    } catch (err) {
      console.error("fetchMessages:", err);
    }
  }, [scrollToBottom, userId]);

  const appendMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev;
      const next = [...prev, msg].sort((a, b) => a.conversation_sequence - b.conversation_sequence);
      if (currentConversationIdRef.current === msg.conversation_id) {
        saveMessagesToSessionCache(userId, msg.conversation_id, next);
      }
      return next;
    });
    scrollToBottom();
  }, [scrollToBottom, userId]);

  // ── Core send ──────────────────────────────────────────────────────────────

  const sendCore = useCallback(async (
    conversationId: string,
    payload: Omit<SendMessageRequest, "conversation_id">
  ) => {
    const user = getStoredUser<{ id: string }>();
    const tempId = `temp-${Date.now()}`;

    const optimistic: Message = {
      id: tempId,
      conversation_id: conversationId,
      content: payload.content,
      inbound: false,
      message_type: payload.message_type,
      conversation_sequence: Date.now(),
      created_at: new Date().toISOString(),
      image: payload.image,
      file: payload.file,
    };

    // Store payload for potential retry
    pendingRef.current[tempId] = { conversationId, payload };
    setMessages(prev => {
      const next = [...prev, optimistic];
      saveMessagesToSessionCache(userId, conversationId, next);
      return next;
    });
    setSendStatus(prev => ({ ...prev, [tempId]: "sending" }));
    scrollToBottom();

    try {
      const real = await conversationsApi.sendMessage(conversationId, {
        ...payload,
        owner_id: user?.id,
        inbound: false,
      });
      delete pendingRef.current[tempId];
      setSendStatus(prev => {
        const next = { ...prev };
        delete next[tempId];
        return next;
      });
      setMessages(prev => {
        if (prev.some(m => m.id === real.id)) {
          const next = prev.filter(m => m.id !== tempId);
          saveMessagesToSessionCache(userId, conversationId, next);
          return next;
        }
        const next = prev
          .map(m => (m.id === tempId ? real : m))
          .sort((a, b) => a.conversation_sequence - b.conversation_sequence);
        saveMessagesToSessionCache(userId, conversationId, next);
        return next;
      });
    } catch {
      setSendStatus(prev => ({ ...prev, [tempId]: "failed" }));
    }
  }, [scrollToBottom, userId]);

  const retryMessage = useCallback(async (conversationId: string, messageId: string) => {
    // If it's a temp (optimistic) message, re-send via client-side pending payload
    const pending = pendingRef.current[messageId];
    if (pending) {
      setMessages(prev => {
        const next = prev.filter(m => m.id !== messageId);
        saveMessagesToSessionCache(userId, conversationId, next);
        return next;
      });
      setSendStatus(prev => { const n = { ...prev }; delete n[messageId]; return n; });
      delete pendingRef.current[messageId];
      sendCore(conversationId, pending.payload);
      return;
    }
    // Persisted failed message — call backend retry endpoint
    setSendStatus(prev => ({ ...prev, [messageId]: "sending" }));
    try {
      const updated = await conversationsApi.retryMessage(conversationId, messageId);
      setMessages(prev => {
        const next = prev.map(m => m.id === messageId ? updated : m);
        saveMessagesToSessionCache(userId, conversationId, next);
        return next;
      });
      setSendStatus(prev => { const n = { ...prev }; delete n[messageId]; return n; });
    } catch {
      setSendStatus(prev => ({ ...prev, [messageId]: "failed" }));
    }
  }, [sendCore, userId]);

  // ── Public send actions ────────────────────────────────────────────────────

  const sendText = useCallback(async (conversationId: string, content: string) => {
    setSending(true);
    try {
      await sendCore(conversationId, { content, message_type: "text" });
    } finally { setSending(false); }
  }, [sendCore]);

  const createInternalNote = useCallback(async (conversationId: string, content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      const note = await conversationsApi.createInternalNote(conversationId, { content: trimmed });
      setMessages(prev => {
        if (prev.some(message => message.id === note.id)) return prev;
        const next = [...prev, note].sort((a, b) => a.conversation_sequence - b.conversation_sequence);
        saveMessagesToSessionCache(userId, conversationId, next);
        return next;
      });
      scrollToBottom();
    } catch (err) {
      console.error("createInternalNote:", err);
      throw err;
    }
  }, [scrollToBottom, userId]);

  const sendFile = useCallback(async (conversationId: string, file: File) => {
    const isImage = file.type.startsWith("image/");
    const limit = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
    if (file.size > limit) {
      alert(`File too large. Maximum is ${isImage ? 5 : 20} MB.`);
      return;
    }
    setSending(true);
    try {
      const toUpload = isImage ? await compressImage(file) : file;
      const url = await uploadApi.uploadFile(toUpload);
      const type: MessageType = isImage ? "image" : "file";
      await sendCore(conversationId, {
        content: isImage ? "Image" : `File: ${file.name}`,
        message_type: type,
        image: isImage ? url : undefined,
        file: !isImage ? url : undefined,
      });
    } finally { setSending(false); }
  }, [sendCore]);

  const sendAudio = useCallback(async (conversationId: string, blob: Blob) => {
    if (blob.size > MAX_AUDIO_SIZE) {
      alert("Audio too large. Maximum is 10 MB.");
      return;
    }
    setSending(true);
    try {
      const url = await uploadApi.uploadFile(blob, "recording.mp3");
      await sendCore(conversationId, {
        content: "Audio message",
        message_type: "audio",
        file: url,
      });
    } finally { setSending(false); }
  }, [sendCore]);

  return { messages, sendStatus, sending, fetchMessages, createInternalNote, sendText, sendFile, sendAudio, retryMessage, appendMessage };
}
