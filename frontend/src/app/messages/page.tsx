"use client";

import Image from 'next/image';
import { startTransition, useState, useRef, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ChevronLeft } from 'lucide-react';
import type { IconType } from 'react-icons';
import { FaWhatsapp, FaCommentDots } from 'react-icons/fa';
import { FaTelegram, FaGlobe } from 'react-icons/fa6';
import { MdOutlineEmail } from 'react-icons/md';
import { TbSparkles } from 'react-icons/tb';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import Modal from '@/components/shared/Modal';
import { useAuth } from '@/hooks/useAuth';
import { useAISuggestions } from '@/hooks/useAISuggestions';
import { useQuickReplySearch } from '@/hooks/useQuickReplies';
import { conversationsApi, quickRepliesApi, projectsApi, clientsApi } from '@/lib/api/index';
import type { ChannelType, Conversation, ConversationStatus, ConversationTag, Message } from '@/types/chat';
import type { ClientListDto } from '@/types/client';
import type { ProjectDto, ProjectPriority, ProjectStage, ProjectStageKey, ProjectTaskDto, ProjectTaskStatus } from '@/types/project';
import AudioMessage from '@/components/AudioMessage';
import { useState as useLocalState } from 'react';
import { useMessagesSessionContext } from '@/contexts/MessagesSessionContext';

// ── Assignment Panel (Story 3.5) ──────────────────────────────────────────────

function AssignmentPanel({ conversation, agents, onAssign }: {
  conversation: Conversation;
  agents: { id: string; full_name: string }[];
  onAssign: (userId: string | null) => Promise<void>;
}) {
  const [saving, setSaving] = useLocalState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSaving(true);
    await onAssign(e.target.value || null).catch(() => {});
    setSaving(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Owner</span>
        <ConversationOwnerBadge conversation={conversation} />
      </div>
      <select
        value={conversation.assigned_user_id ?? ''}
        onChange={handleChange}
        disabled={saving}
        className="flex-1 h-9 px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-indigo-500 outline-none cursor-pointer text-slate-700 disabled:opacity-50"
      >
        <option value="">— Unassigned —</option>
        {agents.map(a => (
          <option key={a.id} value={a.id}>{a.full_name}</option>
        ))}
      </select>
      {saving && <span className="material-symbols-outlined text-[16px] text-slate-400 animate-spin">progress_activity</span>}
    </div>
  );
}

function ConversationOwnerBadge({
  conversation,
  className,
}: {
  conversation: Conversation;
  className?: string;
}) {
  const assignedUser = conversation.assigned_user;
  const isAssigned = Boolean(assignedUser);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        isAssigned
          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
          : "border-dashed border-slate-300 bg-slate-50 text-slate-500",
        className
      )}
    >
      <span className="material-symbols-outlined text-[12px]">
        {isAssigned ? "person" : "person_off"}
      </span>
      <span>{assignedUser?.full_name ?? "Unassigned"}</span>
    </span>
  );
}

function InboxOwnerSelect({
  conversation,
  agents,
  onAssign,
}: {
  conversation: Conversation;
  agents: { id: string; full_name: string }[];
  onAssign: (userId: string | null) => Promise<void>;
}) {
  const [saving, setSaving] = useLocalState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    setSaving(true);
    await onAssign(e.target.value || null).catch(() => {});
    setSaving(false);
  };

  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <select
        value={conversation.assigned_user_id ?? ""}
        onChange={handleChange}
        disabled={saving}
        className="h-7 max-w-[132px] rounded-full border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-600 outline-none transition focus:border-indigo-300"
      >
        <option value="">Unassigned</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.full_name}
          </option>
        ))}
      </select>
      {saving ? (
        <span className="material-symbols-outlined text-[13px] text-slate-400 animate-spin">progress_activity</span>
      ) : null}
    </div>
  );
}

function InboxStatusSelect({
  conversation,
  onChange,
}: {
  conversation: Conversation;
  onChange: (status: ConversationStatus) => Promise<void>;
}) {
  const [saving, setSaving] = useLocalState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    setSaving(true);
    await onChange(e.target.value as ConversationStatus).catch(() => {});
    setSaving(false);
  };

  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <select
        value={conversation.status}
        onChange={handleChange}
        disabled={saving}
        className={cn(
          "h-7 rounded-full border px-2 text-[10px] font-semibold outline-none transition",
          getConversationStatusMeta(conversation.status).selectClassName
        )}
      >
        {STATUS_OPTIONS.map((status) => (
          <option key={status} value={status}>
            {getConversationStatusMeta(status).label}
          </option>
        ))}
      </select>
      {saving ? (
        <span className="material-symbols-outlined text-[13px] text-slate-400 animate-spin">progress_activity</span>
      ) : null}
    </div>
  );
}


function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const AVATAR_PALETTE = [
  { bg: '#ede9fe', text: '#7C4DFF' },
  { bg: '#fce7f3', text: '#be185d' },
  { bg: '#dcfce7', text: '#15803d' },
  { bg: '#fef9c3', text: '#854d0e' },
  { bg: '#dbeafe', text: '#1e40af' },
  { bg: '#fee2e2', text: '#b91c1c' },
  { bg: '#d1fae5', text: '#065f46' },
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

const SLA_THRESHOLD_MINUTES = 60;
const STATUS_OPTIONS: ConversationStatus[] = ['OPEN', 'PENDING', 'RESOLVED'];
const TAG_OPTIONS: ConversationTag[] = ['SUPPORT', 'BILLING', 'FEEDBACK', 'SALES', 'GENERAL', 'SPAM'];

const CHANNEL_META: Record<ChannelType, {
  label: string;
  badgeClass: string;
  iconClass: string;
  icon: IconType;
  dot: string;
  bg: string;
  text: string;
  border: string;
}> = {
  TELEGRAM: {
    label: 'Telegram',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-100',
    iconClass: 'text-[#0088CC]',
    icon: FaTelegram,
    dot: '#0088CC', bg: '#f0f9ff', text: '#0369a1', border: '#bae6fd',
  },
  WHATSAPP: {
    label: 'WhatsApp',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    iconClass: 'text-[#25D366]',
    icon: FaWhatsapp,
    dot: '#25D366', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0',
  },
  EMAIL: {
    label: 'Email',
    badgeClass: 'bg-red-50 text-red-700 border-red-100',
    iconClass: 'text-[#EA4335]',
    icon: MdOutlineEmail,
    dot: '#F97316', bg: '#fff7ed', text: '#c2410c', border: '#fed7aa',
  },
  SMS: {
    label: 'SMS',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-100',
    iconClass: 'text-[#F59E0B]',
    icon: FaCommentDots,
    dot: '#8B5CF6', bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe',
  },
  WEB: {
    label: 'Web Chat',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    iconClass: 'text-slate-500',
    icon: FaGlobe,
    dot: '#94a3b8', bg: '#f8fafc', text: '#475569', border: '#e2e8f0',
  },
};

const TAG_META: Record<ConversationTag, { label: string; className: string; activeBg: string; activeText: string; activeBorder: string }> = {
  SUPPORT:  { label: 'Support',  className: 'bg-blue-50 text-blue-700 border-blue-100',      activeBg: '#eff6ff', activeText: '#1d4ed8', activeBorder: '#bfdbfe' },
  BILLING:  { label: 'Billing',  className: 'bg-amber-50 text-amber-700 border-amber-100',   activeBg: '#fffbeb', activeText: '#92400e', activeBorder: '#fde68a' },
  FEEDBACK: { label: 'Feedback', className: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100', activeBg: '#fdf4ff', activeText: '#7e22ce', activeBorder: '#e9d5ff' },
  SALES:    { label: 'Sales',    className: 'bg-emerald-50 text-emerald-700 border-emerald-100', activeBg: '#f0fdf4', activeText: '#15803d', activeBorder: '#bbf7d0' },
  GENERAL:  { label: 'General',  className: 'bg-slate-100 text-slate-700 border-slate-200',   activeBg: '#f8fafc', activeText: '#475569', activeBorder: '#e2e8f0' },
  SPAM:     { label: 'Spam',     className: 'bg-rose-50 text-rose-700 border-rose-100',       activeBg: '#fff1f2', activeText: '#be123c', activeBorder: '#fecdd3' },
};

const STATUS_META: Record<ConversationStatus, {
  label: string;
  shortLabel: string;
  badgeClassName: string;
  textClassName: string;
  buttonActiveClassName: string;
  selectClassName: string;
}> = {
  OPEN: {
    label: 'Open',
    shortLabel: 'Open',
    badgeClassName: 'border-violet-200 bg-violet-50 text-violet-700',
    textClassName: 'text-violet-700',
    buttonActiveClassName: 'bg-[#fdf4ff] text-[#7C4DFF] border-[#e9d5ff]',
    selectClassName: 'border-violet-200 bg-violet-50 text-violet-700 focus:border-violet-300',
  },
  PENDING: {
    label: 'Pending',
    shortLabel: 'Pending',
    badgeClassName: 'border-amber-200 bg-amber-50 text-amber-700',
    textClassName: 'text-amber-700',
    buttonActiveClassName: 'bg-[#fffbeb] text-[#92400e] border-[#fde68a]',
    selectClassName: 'border-amber-200 bg-amber-50 text-amber-700 focus:border-amber-300',
  },
  RESOLVED: {
    label: 'Resolved',
    shortLabel: 'Resolved',
    badgeClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    textClassName: 'text-emerald-700',
    buttonActiveClassName: 'bg-[#f0fdf4] text-[#15803d] border-[#bbf7d0]',
    selectClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700 focus:border-emerald-300',
  },
};

function getConversationStatusMeta(status: ConversationStatus | null | undefined) {
  return STATUS_META[status ?? 'OPEN'];
}

function ConversationStatusBadge({
  status,
  className,
}: {
  status: ConversationStatus;
  className?: string;
}) {
  const meta = getConversationStatusMeta(status);
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", meta.badgeClassName, className)}>
      {status === 'RESOLVED' ? '✓ ' : ''}{meta.shortLabel}
    </span>
  );
}

function waitingTime(lastMessageDate: string | undefined, isUnread: boolean): { label: string; color: string; slaBreached: boolean } | null {
  if (!isUnread || !lastMessageDate) return null;
  const diffMs = Date.now() - new Date(lastMessageDate).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 15) return null;
  const slaBreached = diffMin >= SLA_THRESHOLD_MINUTES;
  if (diffMin < 60) return { label: `${diffMin}m ago`, color: 'text-yellow-600', slaBreached };
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return { label: `${diffH}h ago`, color: diffH >= 2 ? 'text-red-500' : 'text-orange-500', slaBreached };
  return { label: `${Math.floor(diffH / 24)}d ago`, color: 'text-red-600', slaBreached: true };
}

function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(dateStr).toLocaleDateString([], { weekday: 'short' });
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function TagBadge({ tag, className }: { tag?: ConversationTag | null; className?: string }) {
  if (!tag) return null;
  const meta = TAG_META[tag];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', meta.className, className)}>
      {meta.label}
    </span>
  );
}

function getChannelMeta(channel: string) {
  return CHANNEL_META[channel.toUpperCase() as ChannelType] ?? CHANNEL_META['WEB'];
}

function ChannelBadge({ channel, compact = false }: { channel: ChannelType; compact?: boolean }) {
  const meta = getChannelMeta(channel);
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center border font-medium',
        compact ? 'gap-1 rounded-full px-2 py-1 text-[11px]' : 'gap-1.5 rounded-full px-2.5 py-1 text-xs',
        meta.badgeClass
      )}
    >
      <Icon className={cn(compact ? 'text-[11px]' : 'text-[12px]', meta.iconClass)} />
      <span>{meta.label}</span>
    </span>
  );
}

function TagPills({
  value,
  onChange,
}: {
  value?: ConversationTag | null;
  onChange: (value: ConversationTag | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TAG_OPTIONS.map((tag) => {
        const m = TAG_META[tag];
        const active = value === tag;
        return (
          <button
            key={tag}
            onClick={() => onChange(active ? null : tag)}
            className="rounded-full px-3 py-1 text-[11px] font-semibold border transition-all cursor-pointer"
            style={active
              ? { background: m.activeBg, color: m.activeText, borderColor: m.activeBorder }
              : { background: 'white', color: '#575f67', borderColor: '#e2e8f0' }
            }
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

type MessageActionId = 'create-card' | 'open-linked-card' | 'create-task' | 'add-tag' | 'delete' | 'create-quick-reply';
type CreateCardRouteMode = 'current-conversation-project' | 'existing-project' | 'new-project';

type CreateCardModalState = {
  message: Message;
  title: string;
  description: string;
  stage: ProjectStageKey;
  priority: ProjectPriority;
  routeMode: CreateCardRouteMode;
  selectedProjectId: string;
  relatedProjects: ProjectDto[];
};

type QuickReplyFromMessageState = {
  message: Message;
  shortcut: string;
  content: string;
};

type DeleteMessageState = {
  message: Message;
};

type CreateTaskModalState = {
  message: Message;
  title: string;
  description: string;
  priority: ProjectPriority;
  status: ProjectTaskStatus;
  dueDate: string;
  routeMode: CreateCardRouteMode;
  selectedProjectId: string;
  relatedProjects: ProjectDto[];
  newProjectTitle: string;
};

type ContextActionHintState = {
  message: string;
  projectId?: string;
  projectReference?: string;
};

function MessageContextMenu({
  message,
  outbound,
  linkedProject,
  onSelect,
}: {
  message: Message;
  outbound: boolean;
  linkedProject?: ProjectDto;
  onSelect: (action: MessageActionId, message: Message) => void;
}) {
  const items: Array<{ id: MessageActionId; label: string; icon: string; tone?: 'default' | 'danger' }> = [
    linkedProject
      ? { id: 'open-linked-card', label: `Open ${linkedProject.reference}`, icon: 'open_in_new' }
      : { id: 'create-card', label: 'Create Card', icon: 'add_card' },
    { id: 'create-task', label: 'Create Task', icon: 'checklist' },
    { id: 'add-tag', label: 'Add Tag', icon: 'sell' },
    ...(outbound ? [{ id: 'create-quick-reply' as const, label: 'Create Quick Reply', icon: 'quickreply' }] : []),
    { id: 'delete', label: 'Delete', icon: 'delete', tone: 'danger' },
  ];

  return (
    <div
      className="min-w-[188px] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(15,23,42,0.14)] ring-1 ring-black/5"
      role="menu"
      aria-label="Message actions"
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          autoFocus={index === 0}
          onClick={() => onSelect(item.id, message)}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
            item.tone === 'danger'
              ? 'text-rose-600 hover:bg-rose-50'
              : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
          )}
        >
          <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function suggestCardTitle(message: Message, conversation: Conversation) {
  const source = message.content.trim();
  if (!source) return `${conversation.contact.name || 'Contact'} demand`;
  const compact = source.replace(/\s+/g, ' ').trim();
  return compact.length <= 72 ? compact : `${compact.slice(0, 69).trimEnd()}...`;
}

function suggestTaskTitle(message: Message, conversation: Conversation) {
  const base = suggestCardTitle(message, conversation);
  return base.length <= 72 ? base : `${base.slice(0, 69).trimEnd()}...`;
}

function CreateCardFromMessageModal({
  state,
  stages,
  projects,
  loadingProjects,
  submitting,
  onClose,
  onChange,
  onSubmit,
}: {
  state: CreateCardModalState;
  stages: ProjectStage[];
  projects: ProjectDto[];
  loadingProjects: boolean;
  submitting: boolean;
  onClose: () => void;
  onChange: (patch: Partial<CreateCardModalState>) => void;
  onSubmit: () => void;
}) {
  const selectedProject = projects.find(project => project.id === state.selectedProjectId);
  const hasCurrentConversationProject = state.relatedProjects.length > 0;

  return (
    <Modal title="Create Card from Message" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <span className="material-symbols-outlined text-[16px] text-indigo-600">forum</span>
            Source message
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{state.message.content || 'No message content available.'}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Card title</span>
            <input
              value={state.title}
              onChange={(event) => onChange({ title: event.target.value })}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              placeholder="Describe the demand to track"
            />
          </label>

          <label className="flex flex-col gap-2 md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Demand summary</span>
            <textarea
              value={state.description}
              onChange={(event) => onChange({ description: event.target.value })}
              className="min-h-[110px] rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              placeholder="Add context that should follow this card into Projects"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Initial stage</span>
            <select
              value={state.stage}
              onChange={(event) => onChange({ stage: event.target.value as ProjectStageKey })}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              {stages.map(stage => (
                <option key={stage.key} value={stage.key}>{stage.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Priority</span>
            <select
              value={state.priority}
              onChange={(event) => onChange({ priority: event.target.value as ProjectPriority })}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Project routing</p>
            <p className="mt-1 text-sm text-slate-500">
              This first release routes the new card using the current conversation context or an existing Projects context.
            </p>
          </div>

          {hasCurrentConversationProject ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
              <input
                type="radio"
                checked={state.routeMode === 'current-conversation-project'}
                onChange={() => onChange({ routeMode: 'current-conversation-project' })}
                className="mt-1 accent-indigo-600"
              />
              <div>
                <p className="text-sm font-semibold text-indigo-900">Use the current conversation project context</p>
                <p className="mt-1 text-sm text-indigo-700">
                  The card will inherit the routing context of the existing project already linked to this conversation.
                </p>
              </div>
            </label>
          ) : null}

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3">
            <input
              type="radio"
              checked={state.routeMode === 'new-project'}
              onChange={() => onChange({ routeMode: 'new-project', selectedProjectId: '' })}
              className="mt-1 accent-indigo-600"
            />
            <div>
              <p className="text-sm font-semibold text-slate-900">Create a new project card</p>
              <p className="mt-1 text-sm text-slate-500">
                Best for new conversations that are not yet tied to any existing project context.
              </p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3">
            <input
              type="radio"
              checked={state.routeMode === 'existing-project'}
              onChange={() => onChange({ routeMode: 'existing-project' })}
              className="mt-1 accent-indigo-600"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">Use an existing project context</p>
              <p className="mt-1 text-sm text-slate-500">
                The new card will inherit routing defaults from a selected existing project.
              </p>
              <select
                value={state.selectedProjectId}
                onChange={(event) => onChange({ selectedProjectId: event.target.value })}
                disabled={loadingProjects || state.routeMode !== 'existing-project'}
                className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">{loadingProjects ? 'Loading project contexts...' : 'Select an existing project'}</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.reference} — {project.title}
                  </option>
                ))}
              </select>
              {selectedProject ? (
                <p className="mt-2 text-xs text-slate-500">
                  Context: {selectedProject.reference} · {selectedProject.priority} priority · {selectedProject.stage}
                </p>
              ) : null}
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || !state.title.trim() || !state.description.trim() || (state.routeMode === 'existing-project' && !state.selectedProjectId)}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {submitting ? 'Creating...' : 'Create Card'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CreateTaskFromMessageModal({
  state,
  projects,
  loadingProjects,
  submitting,
  onClose,
  onChange,
  onSubmit,
}: {
  state: CreateTaskModalState;
  projects: ProjectDto[];
  loadingProjects: boolean;
  submitting: boolean;
  onClose: () => void;
  onChange: (patch: Partial<CreateTaskModalState>) => void;
  onSubmit: () => void;
}) {
  const selectedProject = projects.find(project => project.id === state.selectedProjectId);
  const hasCurrentConversationProject = state.relatedProjects.length > 0;

  return (
    <Modal title="Create Task from Message" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <span className="material-symbols-outlined text-[16px] text-indigo-600">forum</span>
            Source message
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{state.message.content || 'No message content available.'}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Task title</span>
            <input
              value={state.title}
              onChange={(event) => onChange({ title: event.target.value })}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              placeholder="Describe the action to execute"
            />
          </label>

          <label className="flex flex-col gap-2 md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Task notes</span>
            <textarea
              value={state.description}
              onChange={(event) => onChange({ description: event.target.value })}
              className="min-h-[110px] rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              placeholder="Add execution notes that should stay linked to this message"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Priority</span>
            <select
              value={state.priority}
              onChange={(event) => onChange({ priority: event.target.value as ProjectPriority })}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Status</span>
            <select
              value={state.status}
              onChange={(event) => onChange({ status: event.target.value as ProjectTaskStatus })}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>

          <label className="flex flex-col gap-2 md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Due date</span>
            <input
              type="date"
              value={state.dueDate}
              onChange={(event) => onChange({ dueDate: event.target.value })}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Project routing</p>
            <p className="mt-1 text-sm text-slate-500">
              Tasks must belong to a project. Use the current conversation project, route to an existing one, or create a new project context first.
            </p>
          </div>

          {hasCurrentConversationProject ? (
            <label className="flex items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
              <input
                type="radio"
                name="task-project-routing"
                checked={state.routeMode === 'current-conversation-project'}
                onChange={() => onChange({ routeMode: 'current-conversation-project' })}
                className="mt-1 h-4 w-4 accent-indigo-600"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900">Use current conversation project</p>
                <p className="mt-1 text-sm text-slate-500">
                  The task will be attached to {state.relatedProjects[0]?.reference ?? 'the linked project'}.
                </p>
              </div>
            </label>
          ) : null}

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4">
            <input
              type="radio"
              name="task-project-routing"
              checked={state.routeMode === 'existing-project'}
              onChange={() => onChange({ routeMode: 'existing-project' })}
              className="mt-1 h-4 w-4 accent-indigo-600"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">Use existing project context</p>
              <p className="mt-1 text-sm text-slate-500">Attach the task to a project that already exists in Projects.</p>
              {state.routeMode === 'existing-project' ? (
                <select
                  value={state.selectedProjectId}
                  onChange={(event) => onChange({ selectedProjectId: event.target.value })}
                  disabled={loadingProjects}
                  className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="">Select a project</option>
                  {projects.map(project => (
                    <option key={project.id} value={project.id}>
                      {project.reference} — {project.title}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 p-4">
            <input
              type="radio"
              name="task-project-routing"
              checked={state.routeMode === 'new-project'}
              onChange={() => onChange({ routeMode: 'new-project' })}
              className="mt-1 h-4 w-4 accent-indigo-600"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">Create a new project context first</p>
              <p className="mt-1 text-sm text-slate-500">A new project will be created and this task will be attached to it immediately.</p>
              {state.routeMode === 'new-project' ? (
                <input
                  value={state.newProjectTitle}
                  onChange={(event) => onChange({ newProjectTitle: event.target.value })}
                  className="mt-3 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  placeholder="New project title"
                />
              ) : null}
            </div>
          </label>

          {state.routeMode === 'existing-project' && selectedProject ? (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Task will be routed to <span className="font-semibold">{selectedProject.reference}</span>.
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddTagFromMessageModal({
  currentTag,
  onClose,
  onSelect,
  saving,
}: {
  currentTag?: ConversationTag | null;
  onClose: () => void;
  onSelect: (tag: ConversationTag | null) => void;
  saving: boolean;
}) {
  return (
    <Modal title="Tag Conversation from Message" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-5">
        <p className="text-sm leading-6 text-slate-500">
          This action applies a tag to the whole conversation. Current release supports one tag per conversation.
        </p>

        <TagPills value={currentTag} onChange={onSelect} />

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            {saving ? 'Saving...' : currentTag ? 'Remove tag' : 'Close'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function QuickReplyFromMessageModal({
  state,
  onClose,
  onChange,
  onSubmit,
  saving,
}: {
  state: QuickReplyFromMessageState;
  onClose: () => void;
  onChange: (patch: Partial<QuickReplyFromMessageState>) => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  return (
    <Modal title="Create Quick Reply from Message" onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <span className="material-symbols-outlined text-[16px] text-indigo-600">quickreply</span>
            Source message
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{state.message.content || 'No message content available.'}</p>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Shortcut</span>
          <input
            value={state.shortcut}
            onChange={(event) => onChange({ shortcut: event.target.value })}
            className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            placeholder="/followup"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Content</span>
          <textarea
            value={state.content}
            onChange={(event) => onChange({ content: event.target.value })}
            className="min-h-[140px] rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            placeholder="Quick reply text"
          />
        </label>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving || !state.shortcut.trim() || !state.content.trim()}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {saving ? 'Creating...' : 'Create Quick Reply'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteMessageModal({
  state,
  deleting,
  onDelete,
  onClose,
}: {
  state: DeleteMessageState;
  deleting: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Delete Message" onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-5">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Selected message</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{state.message.content || 'No message content available.'}</p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
          >
            {deleting ? 'Deleting...' : 'Delete Message'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  // ── UI-only state ─────────────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<'ALL' | ChannelType>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | ConversationStatus>('ALL');
  const [selectedTag, setSelectedTag] = useState<'ALL' | ConversationTag>('ALL');
  const [selectedOwner, setSelectedOwner] = useState<'ALL' | 'UNASSIGNED' | string>('ALL');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [slaAlert, setSlaAlert] = useState<{ count: number; threshold: number } | null>(null);
  const [deliveryAlert, setDeliveryAlert] = useState<{ channel: string; count: number } | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
  const [showAIDesktop, setShowAIDesktop] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<'contact' | 'details' | 'history'>('contact');
  const [clientMatches, setClientMatches] = useState<import('@/types/chat').ClientMatch[]>([]);
  const [clientAlreadyLinked, setClientAlreadyLinked] = useState(false);
  const [clientDetecting, setClientDetecting] = useState(false);
  const [clientLinking, setClientLinking] = useState(false);
  const [clientHistory, setClientHistory] = useState<import('@/lib/api/conversations').ConversationSummary[]>([]);
  const [clientHistoryLoading, setClientHistoryLoading] = useState(false);
  const [showQuickClientForm, setShowQuickClientForm] = useState(false);
  const [showExistingClientPicker, setShowExistingClientPicker] = useState(false);
  const [existingClientSearch, setExistingClientSearch] = useState('');
  const [existingClientResults, setExistingClientResults] = useState<ClientListDto[]>([]);
  const [existingClientLoading, setExistingClientLoading] = useState(false);
  const [existingClientError, setExistingClientError] = useState<string | null>(null);
  const [quickClientForm, setQuickClientForm] = useState({ name: '', company_name: '' });
  const [quickClientSaving, setQuickClientSaving] = useState(false);
  const [quickClientError, setQuickClientError] = useState<string | null>(null);
  const [allQuickReplies, setAllQuickReplies] = useState<import('@/types/quickReply').QuickReply[]>([]);
  const [newQRModal, setNewQRModal] = useState(false);
  const [newQRShortcut, setNewQRShortcut] = useState('');
  const [newQRContent, setNewQRContent] = useState('');
  const [savingNewQR, setSavingNewQR] = useState(false);
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [contextActionHint, setContextActionHint] = useState<ContextActionHintState | null>(null);
  const [projectStages, setProjectStages] = useState<ProjectStage[]>([]);
  const [availableProjects, setAvailableProjects] = useState<ProjectDto[]>([]);
  const [linkedProjectsByMessageId, setLinkedProjectsByMessageId] = useState<Record<string, ProjectDto[]>>({});
  const [linkedTasksByMessageId, setLinkedTasksByMessageId] = useState<Record<string, ProjectTaskDto[]>>({});
  const [loadingProjectRouting, setLoadingProjectRouting] = useState(false);
  const [submittingProjectCard, setSubmittingProjectCard] = useState(false);
  const [submittingProjectTask, setSubmittingProjectTask] = useState(false);
  const [createCardModal, setCreateCardModal] = useState<CreateCardModalState | null>(null);
  const [createTaskModal, setCreateTaskModal] = useState<CreateTaskModalState | null>(null);
  const [savingConversationTag, setSavingConversationTag] = useState(false);
  const [tagMessageModal, setTagMessageModal] = useState<Message | null>(null);
  const [quickReplyModal, setQuickReplyModal] = useState<QuickReplyFromMessageState | null>(null);
  const [creatingQuickReply, setCreatingQuickReply] = useState(false);
  const [deleteMessageModal, setDeleteMessageModal] = useState<DeleteMessageState | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const [savingInternalNote, setSavingInternalNote] = useState(false);
  const [internalNoteDraft, setInternalNoteDraft] = useState('');
  const [handledQueryConversationId, setHandledQueryConversationId] = useState<string | null>(null);
  const [showConnectionBanner, setShowConnectionBanner] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; full_name: string }[]>([]);

  useEffect(() => {
    quickRepliesApi.listQuickReplies().then(r => setAllQuickReplies(r.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    conversationsApi.getAssignableUsers()
      .then((users) => {
        setAssignableUsers(users.map((item) => ({ id: item.id, full_name: item.full_name })));
      })
      .catch(() => {
        setAssignableUsers([]);
      });
  }, []);


  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const messageActionsRef = useRef<HTMLDivElement | null>(null);
  const lastAIFetchedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!openMessageMenuId) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!messageActionsRef.current?.contains(event.target as Node)) {
        setOpenMessageMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMessageMenuId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMessageMenuId]);

  useEffect(() => {
    if (!contextActionHint) return;
    const timeout = window.setTimeout(
      () => setContextActionHint(null),
      contextActionHint.projectId ? 6000 : 2500
    );
    return () => window.clearTimeout(timeout);
  }, [contextActionHint]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, []);

  const handleQuickReplyCreate = useCallback(async () => {
    if (!quickReplyModal) return;

    try {
      setCreatingQuickReply(true);
      const normalizedShortcut = quickReplyModal.shortcut.trim().startsWith('/')
        ? quickReplyModal.shortcut.trim()
        : `/${quickReplyModal.shortcut.trim()}`;

      const created = await quickRepliesApi.createQuickReply({
        shortcut: normalizedShortcut,
        content: quickReplyModal.content.trim(),
      });

      setAllQuickReplies((current) => [created, ...current]);
      setQuickReplyModal(null);
      setContextActionHint({ message: `Quick reply ${created.shortcut} created.` });
    } catch (error) {
      setContextActionHint({ message: error instanceof Error ? error.message : 'Failed to create quick reply.' });
    } finally {
      setCreatingQuickReply(false);
    }
  }, [quickReplyModal]);

  // ── Domain hooks ──────────────────────────────────────────────────────────
  const {
    conversationsState: {
      conversations,
      activeConversation,
      fetchConversations,
      updateConversation,
      notifCounts,
      activeViewers,
    },
    messagesState: {
      messages,
      sendStatus,
      sending,
      fetchMessages,
      createInternalNote,
      sendText,
      sendFile,
      sendAudio,
      retryMessage,
    },
    connectionState,
    activateConversation,
  } = useMessagesSessionContext();
  const canDeleteConversations = Boolean(user?.user_type?.can_delete_conversations);

  // Story 3.3 — sort by SLA risk: breached first, then by wait time desc
  const sortedConversations = [...conversations].sort((a, b) => {
    const wtA = waitingTime(a.last_message_date, a.is_unread);
    const wtB = waitingTime(b.last_message_date, b.is_unread);
    if (wtA?.slaBreached && !wtB?.slaBreached) return -1;
    if (!wtA?.slaBreached && wtB?.slaBreached) return 1;
    const tA = a.last_message_date ? new Date(a.last_message_date).getTime() : 0;
    const tB = b.last_message_date ? new Date(b.last_message_date).getTime() : 0;
    return tA - tB; // oldest unread first within same risk tier
  });

  // Detecta cliente vinculado ao trocar de conversa ativa
  useEffect(() => {
    if (!activeConversation?.id) {
      setClientMatches([]);
      setClientAlreadyLinked(false);
      setClientHistory([]);
      setShowQuickClientForm(false);
      setShowExistingClientPicker(false);
      setExistingClientSearch('');
      setExistingClientResults([]);
      setExistingClientError(null);
      return;
    }
    setShowQuickClientForm(false);
    setShowExistingClientPicker(false);
    setExistingClientSearch('');
    setExistingClientResults([]);
    setExistingClientError(null);
    const convId = activeConversation.id;
    setClientDetecting(true);
    conversationsApi.detectClientForConversation(convId)
      .then(res => {
        setClientMatches(res.matches ?? []);
        setClientAlreadyLinked(res.already_linked ?? false);
        if (res.already_linked && res.matches?.[0]) {
          const linkedClientId = res.matches[0].id;
          setClientHistoryLoading(true);
          conversationsApi.getClientConversations(linkedClientId, { limit: 20 })
            .then(r => setClientHistory((r.data ?? []).filter(c => c.id !== convId)))
            .catch(() => setClientHistory([]))
            .finally(() => setClientHistoryLoading(false));
        } else {
          setClientHistory([]);
        }
      })
      .catch(() => { setClientMatches([]); setClientAlreadyLinked(false); })
      .finally(() => setClientDetecting(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversation?.id]);

  useEffect(() => {
    if (!showExistingClientPicker || !activeConversation?.contact_id) return;

    const timeout = window.setTimeout(() => {
      setExistingClientLoading(true);
      const rawName = activeConversation.contact.name?.trim() ?? '';
      const extractedEmail = rawName.match(/<([^>]+)>/)?.[1]?.trim() ?? '';
      const cleanedName = rawName.replace(/<[^>]+>/g, '').trim();
      const fallbackSearch =
        activeConversation.contact.email?.trim()
        || extractedEmail
        || cleanedName
        || activeConversation.contact.channel_identifier?.trim()
        || '';

      clientsApi.listClients({
        limit: 8,
        search: existingClientSearch.trim() || fallbackSearch || undefined,
      })
        .then((response) => {
          setExistingClientResults(response.data ?? []);
          setExistingClientError(null);
        })
        .catch(() => {
          setExistingClientResults([]);
          setExistingClientError('Failed to load clients.');
        })
        .finally(() => setExistingClientLoading(false));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [
    activeConversation?.contact.channel_identifier,
    activeConversation?.contact.email,
    activeConversation?.contact.name,
    activeConversation?.contact_id,
    existingClientSearch,
    showExistingClientPicker,
  ]);

  const availableChannels = Object.keys(CHANNEL_META) as ChannelType[];
  const hasActiveFilters = Boolean(searchQuery.trim()) || selectedChannel !== 'ALL' || selectedStatus !== 'ALL' || selectedTag !== 'ALL' || selectedOwner !== 'ALL';
  const selectedTagLabel = selectedTag === 'ALL' ? null : TAG_META[selectedTag].label;
  const selectedStatusLabel = selectedStatus === 'ALL' ? null : getConversationStatusMeta(selectedStatus).label.toLowerCase();
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const canUseAISuggestions = Boolean(activeConversation && lastMessage?.inbound);
  const emptyStateMessage = !hasActiveFilters
    ? 'No conversations yet'
    : selectedTag !== 'ALL'
      ? `No conversations match the ${selectedTagLabel} tag with the current filters`
      : selectedStatus !== 'ALL'
        ? `No conversations match the ${selectedStatusLabel} status with the current filters`
      : selectedChannel !== 'ALL'
        ? `No conversations match the ${getChannelMeta(selectedChannel).label} channel with the current filters`
        : selectedOwner === 'UNASSIGNED'
          ? 'No unassigned conversations match the current filters'
          : selectedOwner !== 'ALL'
            ? 'No conversations match the selected owner with the current filters'
        : 'No conversations match the current filters';

  const filteredConversations = sortedConversations.filter((c) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || (
      c.contact.name?.toLowerCase().includes(q) ||
      c.contact.channel_identifier?.toLowerCase().includes(q)
    );
    const matchesChannel = selectedChannel === 'ALL' || c.channel.toUpperCase() === selectedChannel;
    const matchesStatus = selectedStatus === 'ALL' || c.status === selectedStatus;
    const matchesTag = selectedTag === 'ALL' || c.tag === selectedTag;
    const matchesOwner = selectedOwner === 'ALL'
      || (selectedOwner === 'UNASSIGNED' ? !c.assigned_user_id : c.assigned_user_id === selectedOwner);

    return matchesSearch && matchesChannel && matchesStatus && matchesTag && matchesOwner;
  });

  const assignConversationOwner = useCallback(async (conversationId: string, userId: string | null) => {
    await conversationsApi.assignConversation(conversationId, userId);
    await fetchConversations();
  }, [fetchConversations]);

  const openCreateCardModalForMessage = useCallback(async (message: Message) => {
    if (!activeConversation) return;

    setLoadingProjectRouting(true);
    try {
      const [stages, projectsResponse] = await Promise.all([
        projectsApi.getProjectStages(),
        projectsApi.listProjects({ limit: 200 }),
      ]);

      const projects = projectsResponse.data;
      const rootProjects = projects.filter(project => !project.project_context_id);
      const relatedProjects = activeConversation.project_context_id
        ? rootProjects.filter(project => project.id === activeConversation.project_context_id)
        : [];
      const primaryRelatedProject = relatedProjects[0];
      const suggestedTitle = suggestCardTitle(message, activeConversation);

      setProjectStages(stages);
      setAvailableProjects(rootProjects);
      setCreateCardModal({
        message,
        title: suggestedTitle,
        description: message.content || suggestedTitle,
        stage: 'lead',
        priority: primaryRelatedProject?.priority ?? 'medium',
        routeMode: activeConversation.project_context_id ? 'current-conversation-project' : 'new-project',
        selectedProjectId: '',
        relatedProjects,
      });
    } catch (error) {
      setContextActionHint({ message: error instanceof Error ? error.message : 'Failed to load project routing context.' });
    } finally {
      setLoadingProjectRouting(false);
    }
  }, [activeConversation]);

  const openCreateTaskModalForMessage = useCallback(async (message: Message) => {
    if (!activeConversation) return;

    setLoadingProjectRouting(true);
    try {
      const projectsResponse = await projectsApi.listProjects({ limit: 200 });
      const projects = projectsResponse.data;
      const rootProjects = projects.filter(project => !project.project_context_id);
      const relatedProjects = activeConversation.project_context_id
        ? rootProjects.filter(project => project.id === activeConversation.project_context_id)
        : [];
      const primaryRelatedProject = relatedProjects[0];
      const suggestedTitle = suggestTaskTitle(message, activeConversation);

      setAvailableProjects(rootProjects);
      setCreateTaskModal({
        message,
        title: suggestedTitle,
        description: message.content || suggestedTitle,
        priority: primaryRelatedProject?.priority ?? 'medium',
        status: 'open',
        dueDate: '',
        routeMode: activeConversation.project_context_id ? 'current-conversation-project' : 'new-project',
        selectedProjectId: '',
        relatedProjects,
        newProjectTitle: primaryRelatedProject?.title ?? suggestedTitle,
      });
    } catch (error) {
      setContextActionHint({ message: error instanceof Error ? error.message : 'Failed to load task routing context.' });
    } finally {
      setLoadingProjectRouting(false);
    }
  }, [activeConversation]);

  const handleCreateCardSubmit = useCallback(async () => {
    if (!createCardModal || !activeConversation) return;

    const routingProject =
      createCardModal.routeMode === 'current-conversation-project'
        ? createCardModal.relatedProjects[0]
        : createCardModal.routeMode === 'existing-project'
          ? availableProjects.find(project => project.id === createCardModal.selectedProjectId)
          : undefined;

    try {
      setSubmittingProjectCard(true);
      const createdProject = await projectsApi.createProjectFromMessage(createCardModal.message.id, {
        title: createCardModal.title.trim(),
        description: createCardModal.description.trim(),
        stage: createCardModal.stage,
        priority: createCardModal.priority,
        project_context_id: routingProject?.id ?? undefined,
        attach_conversation_to_project: createCardModal.routeMode !== 'current-conversation-project',
        owner_user_id: routingProject?.owner_id ?? undefined,
        due_date: null,
        value: 0,
        progress: 0,
        tag: routingProject?.tag ?? undefined,
      });
      setCreateCardModal(null);
      setLinkedProjectsByMessageId((current) => ({
        ...current,
        [createCardModal.message.id]: [...(current[createCardModal.message.id] ?? []), createdProject],
      }));
      setContextActionHint({
        message: routingProject
          ? `Card created using ${routingProject.reference} routing context.`
          : `Card ${createdProject.reference} created from message in Projects.`,
        projectId: createdProject.id,
        projectReference: createdProject.reference,
      });
    } catch (error) {
      setContextActionHint({ message: error instanceof Error ? error.message : 'Failed to create card from message.' });
    } finally {
      setSubmittingProjectCard(false);
    }
  }, [activeConversation, availableProjects, createCardModal]);

  const handleCreateTaskSubmit = useCallback(async () => {
    if (!createTaskModal || !activeConversation) return;

    const routingProject =
      createTaskModal.routeMode === 'current-conversation-project'
        ? createTaskModal.relatedProjects[0]
        : createTaskModal.routeMode === 'existing-project'
          ? availableProjects.find(project => project.id === createTaskModal.selectedProjectId)
          : undefined;

    try {
      setSubmittingProjectTask(true);
      const createdTask = await projectsApi.createProjectTaskFromMessage(createTaskModal.message.id, {
        title: createTaskModal.title.trim(),
        description: createTaskModal.description.trim(),
        priority: createTaskModal.priority,
        status: createTaskModal.status,
        project_context_id: routingProject?.id ?? undefined,
        attach_conversation_to_project: createTaskModal.routeMode !== 'current-conversation-project',
        create_project_context: createTaskModal.routeMode === 'new-project',
        new_project_title: createTaskModal.routeMode === 'new-project' ? createTaskModal.newProjectTitle.trim() || createTaskModal.title.trim() : undefined,
        owner_user_id: routingProject?.owner_id ?? undefined,
        due_date: createTaskModal.dueDate ? `${createTaskModal.dueDate}T00:00:00Z` : undefined,
      });
      setCreateTaskModal(null);
      setLinkedTasksByMessageId((current) => ({
        ...current,
        [createTaskModal.message.id]: [...(current[createTaskModal.message.id] ?? []), createdTask],
      }));
      await fetchConversations();
      setContextActionHint({
        message: createdTask.project_reference
          ? `Task created inside ${createdTask.project_reference}.`
          : 'Task created from message.',
        projectId: createdTask.project_id,
        projectReference: createdTask.project_reference ?? undefined,
      });
    } catch (error) {
      setContextActionHint({ message: error instanceof Error ? error.message : 'Failed to create task from message.' });
    } finally {
      setSubmittingProjectTask(false);
    }
  }, [activeConversation, availableProjects, createTaskModal, fetchConversations]);

  const handleConversationTagFromMessage = useCallback(async (tag: ConversationTag | null) => {
    if (!activeConversation) return;

    try {
      setSavingConversationTag(true);
      await updateConversation(activeConversation.id, { tag });
      setTagMessageModal(null);
      setContextActionHint({ message: tag ? `Conversation tagged as ${TAG_META[tag].label}.` : 'Conversation tag removed.' });
    } catch (error) {
      setContextActionHint({ message: error instanceof Error ? error.message : 'Failed to update conversation tag.' });
    } finally {
      setSavingConversationTag(false);
    }
  }, [activeConversation, updateConversation]);

  const handleMessageActionSelect = useCallback((action: MessageActionId, message: Message) => {
    setOpenMessageMenuId(null);

    const linkedProject = linkedProjectsByMessageId[message.id]?.[0];

    if (action === 'create-quick-reply' && message.inbound) return;

    if (action === 'open-linked-card' && linkedProject) {
      router.push(`/projects?projectId=${linkedProject.id}`);
      return;
    }

    if (action === 'create-card') {
      void openCreateCardModalForMessage(message);
      return;
    }

    if (action === 'create-task') {
      void openCreateTaskModalForMessage(message);
      return;
    }

    if (action === 'add-tag') {
      setTagMessageModal(message);
      return;
    }

    if (action === 'create-quick-reply') {
      const seed = message.content.trim().replace(/\s+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'reply';
      setQuickReplyModal({
        message,
        shortcut: `/${seed}`,
        content: message.content,
      });
      return;
    }

    if (action === 'delete') {
      setDeleteMessageModal({ message });
    }
  }, [linkedProjectsByMessageId, openCreateCardModalForMessage, openCreateTaskModalForMessage, router]);

  const {
    suggestions,
    source: aiSource,
    generatedAt: aiGeneratedAt,
    generating: aiGenerating,
    loading: aiLoading,
    fetchCached: fetchAICached,
    generate: generateAI,
    clear: clearAI,
  } = useAISuggestions();

  const { matches: qrMatches, open: qrOpen, search: qrSearch, close: qrClose } = useQuickReplySearch();

  useEffect(() => {
    if (!activeConversation || messages.length === 0) return;
    scrollToBottom();
  }, [activeConversation?.id, messages, scrollToBottom]);

  useEffect(() => {
    if (!activeConversation || !lastMessage || !canUseAISuggestions) {
      lastAIFetchedKeyRef.current = null;
      setShowAIDesktop(false);
      setAiSheetOpen(false);
      clearAI();
      return;
    }

    const nextKey = `${activeConversation.id}:${lastMessage.id}`;
    if (lastAIFetchedKeyRef.current === nextKey) return;

    lastAIFetchedKeyRef.current = nextKey;
    fetchAICached(activeConversation.id);
  }, [activeConversation, lastMessage, canUseAISuggestions, fetchAICached, clearAI]);

  useEffect(() => {
    if (!activeConversation) return;

    const conversationId = activeConversation.id;
    const projectContextId = activeConversation.project_context_id;

    let cancelled = false;

    async function loadLinkedOperationalItems() {
      try {
        const [projectsResponse, tasksResponse] = await Promise.all([
          projectsApi.listProjects({ limit: 200, source_type: 'message' }),
          projectContextId ? projectsApi.listProjectTasks(projectContextId) : Promise.resolve([]),
        ]);
        if (cancelled) return;

        const projectMap = projectsResponse.data
          .filter((project) => project.conversation_id === conversationId && project.source_message_id)
          .reduce<Record<string, ProjectDto[]>>((acc, project) => {
            const messageId = project.source_message_id as string;
            acc[messageId] = [...(acc[messageId] ?? []), project];
            return acc;
          }, {});

        const taskMap = tasksResponse
          .filter((task) => task.source_conversation_id === conversationId && task.source_message_id)
          .reduce<Record<string, ProjectTaskDto[]>>((acc, task) => {
            const messageId = task.source_message_id as string;
            acc[messageId] = [...(acc[messageId] ?? []), task];
            return acc;
          }, {});

        setLinkedProjectsByMessageId(projectMap);
        setLinkedTasksByMessageId(taskMap);
      } catch {
        if (!cancelled) {
          setLinkedProjectsByMessageId({});
          setLinkedTasksByMessageId({});
        }
      }
    }

    void loadLinkedOperationalItems();
    return () => {
      cancelled = true;
    };
  }, [activeConversation]);

  const handleDeleteMessage = useCallback(async () => {
    if (!deleteMessageModal || !activeConversation) return;

    try {
      setDeletingMessage(true);
      await conversationsApi.deleteMessage(activeConversation.id, deleteMessageModal.message.id);
      setDeleteMessageModal(null);
      await fetchMessages(activeConversation.id);
      await fetchConversations();
      setContextActionHint({ message: 'Message deleted.' });
    } catch (error) {
      setContextActionHint({ message: error instanceof Error ? error.message : 'Failed to delete message.' });
    } finally {
      setDeletingMessage(false);
    }
  }, [activeConversation, deleteMessageModal, fetchConversations, fetchMessages]);

  // ── WebSocket event dispatcher ─────────────────────────────────────────────
  useEffect(() => {
    if (connectionState === 'connected' || connectionState === 'connecting') {
      setShowConnectionBanner(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowConnectionBanner(true);
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [connectionState]);


  // ── Conversation selection ────────────────────────────────────────────────
  const handleSelectConversation = useCallback(async (conv: Conversation) => {
    cancelAttachment();
    clearAI();
    lastAIFetchedKeyRef.current = null;
    setInternalNoteDraft('');
    await activateConversation(conv);
    setMobileView('chat');
  }, [activateConversation, clearAI]);

  useEffect(() => {
    const queryConversationId = searchParams.get('conversationId');
    if (!queryConversationId || handledQueryConversationId === queryConversationId || conversations.length === 0) return;

    const targetConversation = conversations.find((conversation) => conversation.id === queryConversationId);
    if (!targetConversation) return;

    const timeout = window.setTimeout(() => {
      startTransition(() => {
        setHandledQueryConversationId(queryConversationId);
      });
      void handleSelectConversation(targetConversation);
    }, 0);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('conversationId');
    router.replace(nextParams.toString() ? `/?${nextParams.toString()}` : '/', { scroll: false });
    return () => window.clearTimeout(timeout);
  }, [conversations, handleSelectConversation, handledQueryConversationId, router, searchParams]);

  const handleMobileBack = useCallback(() => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
    setShowEmojiPicker(false);
    setMobileView('list');
  }, [isRecording]);

  // ── Attachment helpers ────────────────────────────────────────────────────
  function cancelAttachment() {
    setSelectedFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const handleFileSelect = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreviewUrl(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    setShowEmojiPicker(false);
  };

  const onEmojiClick = (emojiData: { emoji: string }) =>
    setInput(prev => prev + emojiData.emoji);

  // ── Recording ─────────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      audioChunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/mpeg' });
        if (activeConversation) await sendAudio(activeConversation.id, blob);
        stream.getTracks().forEach(t => t.stop());
      };
      rec.start();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration(p => p + 1), 1000);
    } catch {
      alert('Microphone access denied or not available.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSendMessage = async () => {
    if (!activeConversation || (!input.trim() && !selectedFile)) return;
    if (selectedFile) {
      await sendFile(activeConversation.id, selectedFile);
      cancelAttachment();
    } else {
      await sendText(activeConversation.id, input.trim());
      setInput('');
    }
  };

  const handleCreateInternalNote = useCallback(async () => {
    if (!activeConversation || !internalNoteDraft.trim()) return;
    try {
      setSavingInternalNote(true);
      await createInternalNote(activeConversation.id, internalNoteDraft);
      setInternalNoteDraft('');
      setContextActionHint({ message: 'Internal note added to the conversation.' });
    } catch (error) {
      setContextActionHint({ message: error instanceof Error ? error.message : 'Failed to create internal note.' });
    } finally {
      setSavingInternalNote(false);
    }
  }, [activeConversation, createInternalNote, internalNoteDraft]);

  const loading = sending || savingInternalNote;
  const effectiveMobileView = activeConversation ? mobileView : 'list';
  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="h-14 border-b border-[#E9ECEF] bg-white shrink-0 flex items-center px-5 gap-2.5">
        <span className="material-symbols-outlined text-[20px] text-[#7C4DFF]" style={{ fontVariationSettings: "'FILL' 1" }}>chat_bubble</span>
        <span className="text-[16px] font-bold text-slate-900">Messages</span>
        {conversations.filter(c => c.is_unread).length > 0 && (
          <div className="ml-2 bg-[#eef2ff] text-[#4338ca] border border-[#c7d2fe] rounded-full px-2.5 py-0.5 text-[11px] font-bold">
            {conversations.filter(c => c.is_unread).length} unread
          </div>
        )}
      </header>

      {/* Connection state banner — P0-2 */}
      {showConnectionBanner && (
        <div className={cn(
          "shrink-0 flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium",
          connectionState === 'disconnected'
            ? "bg-rose-50 text-rose-700 border-b border-rose-200"
            : "bg-amber-50 text-amber-700 border-b border-amber-200"
        )}>
          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
          {connectionState === 'disconnected' ? 'Connection lost. Trying to reconnect…' : 'Reconnecting in background…'}
        </div>
      )}

      {/* SLA Risk Alert banner — Story 4.5 */}
      {slaAlert && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 text-xs font-medium bg-amber-50 text-amber-800 border-b border-amber-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px]">schedule</span>
            <span><strong>{slaAlert.count}</strong> conversation{slaAlert.count !== 1 ? 's' : ''} unanswered for more than {slaAlert.threshold} min</span>
          </div>
          <button onClick={() => setSlaAlert(null)} className="ml-2 text-amber-600 hover:text-amber-900">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Delivery Failure Alert banner — Story 4.4 */}
      {deliveryAlert && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 text-xs font-medium bg-red-50 text-red-800 border-b border-red-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px]">error</span>
            <span><strong>{deliveryAlert.count}</strong> delivery failure{deliveryAlert.count !== 1 ? 's' : ''} on <strong className="uppercase">{deliveryAlert.channel}</strong> in the last few minutes</span>
          </div>
          <button onClick={() => setDeliveryAlert(null)} className="ml-2 text-red-600 hover:text-red-900">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Main Workspace (3-Column Layout) */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left Column: Conversation List */}
        <aside
          data-testid="conversation-list"
          className={cn(
            "h-full flex flex-col bg-surface-container-lowest border-r border-outline-variant",
            // Desktop: fixed 320px in flex flow
            "md:static md:w-[320px] md:shrink-0 md:translate-x-0",
            // Mobile: absolute overlay, full width, slide transition
            "absolute inset-y-0 left-0 right-0 w-full z-10",
            "transition-transform duration-300 ease-in-out",
            effectiveMobileView === 'chat' ? "-translate-x-full md:translate-x-0" : "translate-x-0"
          )}
        >
          <div className="px-3 pt-3 pb-2">
            <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 shadow-sm transition-all focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100">
              <span className="material-symbols-outlined text-[18px] text-slate-400 shrink-0">search</span>
              <input
                className="h-full w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="Search conversations…"
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="shrink-0 text-slate-400 hover:text-slate-600">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>
            <div className="mt-2 space-y-1.5">
              {/* Channel filter chips */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
                <button onClick={() => setSelectedChannel('ALL')}
                  className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer"
                  style={selectedChannel === 'ALL' ? { background: '#eef2ff', color: '#4338ca', borderColor: '#c7d2fe' } : { background: 'white', color: '#575f67', borderColor: '#e2e8f0' }}>
                  All
                </button>
                {availableChannels.map((ch) => {
                  const m = CHANNEL_META[ch];
                  const Icon = m.icon;
                  const active = selectedChannel === ch;
                  return (
                    <button
                      key={ch}
                      onClick={() => setSelectedChannel(ch)}
                      title={m.label}
                      aria-label={m.label}
                      className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer flex items-center justify-center"
                      style={active ? { background: '#eef2ff', color: '#4338ca', borderColor: '#c7d2fe' } : { background: 'white', color: '#575f67', borderColor: '#e2e8f0' }}>
                      <Icon className={cn('text-[14px]', active ? 'text-[#4338ca]' : m.iconClass)} />
                    </button>
                  );
                })}
              </div>
              {/* Tag filter dropdown */}
              <div className="relative">
                <select
                  value={selectedStatus}
                  onChange={(event) => setSelectedStatus(event.target.value as ConversationStatus | 'ALL')}
                  className="h-8 w-full appearance-none rounded-full border border-emerald-200 bg-emerald-50 px-3 pr-8 text-[11px] font-semibold text-emerald-700 outline-none transition-colors"
                >
                  <option value="ALL">All statuses</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {getConversationStatusMeta(status).label}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-emerald-700">
                  expand_more
                </span>
              </div>
              <div className="relative">
                <select
                  value={selectedTag}
                  onChange={(event) => setSelectedTag(event.target.value as ConversationTag | 'ALL')}
                  className="h-8 w-full appearance-none rounded-full border border-[#c7d2fe] bg-[#eef2ff] px-3 pr-8 text-[11px] font-semibold text-[#4338ca] outline-none transition-colors"
                >
                  <option value="ALL">All tags</option>
                  {TAG_OPTIONS.map((tag) => (
                    <option key={tag} value={tag}>
                      {TAG_META[tag].label}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-[#4338ca]">
                  expand_more
                </span>
              </div>
              <div className="relative">
                <select
                  value={selectedOwner}
                  onChange={(event) => setSelectedOwner(event.target.value)}
                  className="h-8 w-full appearance-none rounded-full border border-slate-200 bg-white px-3 pr-8 text-[11px] font-semibold text-slate-600 outline-none transition-colors"
                >
                  <option value="ALL">All owners</option>
                  <option value="UNASSIGNED">Unassigned</option>
                  {assignableUsers.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.full_name}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[16px] text-slate-500">
                  expand_more
                </span>
              </div>
            </div>
          </div>
          
          {/* List */}
          <div className="flex-1 overflow-y-auto p-sm space-y-sm">
            {filteredConversations.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">
                <p>{emptyStateMessage}</p>
                {hasActiveFilters && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedChannel('ALL');
                      setSelectedStatus('ALL');
                      setSelectedTag('ALL');
                      setSelectedOwner('ALL');
                    }}
                    className="mt-3 inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
            {filteredConversations.map((conv) => {
              const chMeta = getChannelMeta(conv.channel);
              const isActive = activeConversation?.id === conv.id;
              const displayName = conv.contact.name || conv.contact.channel_identifier || 'U';
              const initials = displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
              const avColor = avatarColor(displayName);
              const sla = waitingTime(conv.last_message_date, conv.is_unread);
              return (
                <div
                  key={conv.id}
                  data-testid="conversation-item"
                  onClick={() => handleSelectConversation(conv)}
                  style={isActive ? { background: '#eef2ff', borderColor: '#c7d2fe' } : {}}
                  className={cn(
                    "relative rounded-[9px] border cursor-pointer flex gap-2.5 items-start transition-colors",
                    "pl-[13px] pr-2.5 py-2.5 mb-0.5",
                    isActive ? "border-[#c7d2fe]" : "border-transparent hover:bg-[#e8ecf8]"
                  )}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 bg-[#4f46e5] rounded-r-[4px]"></div>
                  )}
                  {/* Avatar with channel dot */}
                  <div className="relative shrink-0">
                    {conv.contact.avatar ? (
                      <Image alt={initials} className="w-[38px] h-[38px] rounded-full object-cover"
                        src={conv.contact.avatar} width={38} height={38} />
                    ) : (
                      <div className="w-[38px] h-[38px] rounded-full flex items-center justify-center text-[13px] font-bold uppercase"
                        style={{ background: avColor.bg, color: avColor.text }}>
                        {initials}
                      </div>
                    )}
                    {/* Channel dot */}
                    <div className="absolute -bottom-0.5 -right-0.5 w-[14px] h-[14px] bg-white border border-[#E9ECEF] rounded-full flex items-center justify-center">
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: chMeta.dot, display: 'block' }} />
                    </div>
                    {conv.is_unread && (
                      <div className="absolute -top-0.5 -left-0.5 w-2.5 h-2.5 border-2 border-white rounded-full bg-green-500"></div>
                    )}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span className="text-[13px] truncate max-w-[130px]"
                        style={{ fontWeight: conv.is_unread ? 600 : 500, color: '#1d1a24' }}>
                        {conv.contact.name || conv.contact.channel_identifier}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {notifCounts[conv.id] > 0 && (
                          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#4f46e5] text-white text-[10px] font-bold">
                            {notifCounts[conv.id] > 99 ? '99+' : notifCounts[conv.id]}
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: sla?.slaBreached ? '#ef4444' : '#94a3b8', fontWeight: sla?.slaBreached ? 600 : 400 }}>
                          {formatRelativeTime(conv.last_message_date)}
                        </span>
                      </div>
                    </div>
                    {/* Tag + SLA row */}
                    <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                      <ConversationStatusBadge status={conv.status} />
                      <TagBadge tag={conv.tag ?? undefined} />
                      <ConversationOwnerBadge conversation={conv} />
                      {sla && (
                        <span className="inline-flex items-center gap-[1px] text-[9px] font-bold text-[#ef4444]">
                          <span className="material-symbols-outlined text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                          {sla.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 text-[12px] truncate"
                        style={{ color: conv.is_unread ? '#374151' : '#94a3b8', fontWeight: conv.is_unread ? 500 : 400 }}>
                        {conv.last_message || 'No messages'}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <InboxStatusSelect
                          conversation={conv}
                          onChange={(status) => updateConversation(conv.id, { status })}
                        />
                        <InboxOwnerSelect
                          conversation={conv}
                          agents={assignableUsers}
                          onAssign={(userId) => assignConversationOwner(conv.id, userId)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Center Column: Active Chat Window */}
        <section
          data-testid="chat-area"
          className={cn(
            "flex flex-col bg-surface-container-low min-w-0",
            // Desktop: flex-1 in flow
            "md:static md:flex-1 md:translate-x-0",
            // Mobile: absolute overlay, full width, slide transition
            "absolute inset-y-0 left-0 right-0 w-full",
            "transition-transform duration-300 ease-in-out",
            effectiveMobileView === 'list' ? "translate-x-full md:translate-x-0" : "translate-x-0"
          )}
        >
          {activeConversation ? (
            <>
              {/* Chat Header */}
              <div className="h-16 px-[18px] border-b border-[#E9ECEF] bg-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  {/* Back button — mobile only */}
                  <button
                    data-testid="back-button"
                    onClick={handleMobileBack}
                    className="md:hidden flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0"
                    aria-label="Back to conversations"
                  >
                    <ChevronLeft size={22} />
                  </button>
                  <div className="relative">
                    {activeConversation.contact.avatar ? (
                      <Image
                        alt={activeConversation.contact.name || 'Contact avatar'}
                        className="w-10 h-10 rounded-full object-cover"
                        src={activeConversation.contact.avatar}
                        width={40}
                        height={40}
                      />
                    ) : (() => {
                      const ac = avatarColor(activeConversation.contact.name || activeConversation.contact.channel_identifier || 'U');
                      const ini = (activeConversation.contact.name || activeConversation.contact.channel_identifier || 'U')
                        .split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
                      return (
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold uppercase"
                          style={{ background: ac.bg, color: ac.text }}>{ini}</div>
                      );
                    })()}
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold text-[#1d1a24]" style={{ letterSpacing: '-0.2px' }}>{activeConversation.contact.name || activeConversation.contact.channel_identifier}</h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <ChannelBadge channel={activeConversation.channel} compact />
                      <TagBadge tag={activeConversation.tag} />
                      <ConversationOwnerBadge conversation={activeConversation} />
                      {(() => {
                        const wt = waitingTime(activeConversation.last_message_date, activeConversation.is_unread);
                        if (!wt?.slaBreached) return null;
                        return (
                          <span className="inline-flex items-center gap-[3px] text-[10px] font-bold text-[#dc2626]">
                            <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                            SLA: {wt.label}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                {/* Header actions */}
                <div className="flex items-center gap-2">
                  {/* Presence indicator (right-side, matches prototype) */}
                  {/* Status select — uses inline styles + appearance-none so browser can't override bg/color */}
                  {/* AI toggle — desktop */}
                  <button
                    title={canUseAISuggestions ? "Sugestões de IA" : "AI suggestions are only available after an inbound customer message"}
                    disabled={!canUseAISuggestions}
                    onClick={() => {
                      if (!canUseAISuggestions) return;
                      setShowAIDesktop(v => !v);
                    }}
                    className={cn(
                      "hidden md:flex w-8 h-8 items-center justify-center rounded-lg border transition-colors",
                      !canUseAISuggestions
                        ? "cursor-not-allowed border-[#E9ECEF] text-[#cbd5e1] bg-[#f8fafc]"
                        : showAIDesktop
                          ? "bg-[#f5f3ff] text-[#7C4DFF] border-[#e9d5ff]"
                          : "text-[#94a3b8] border-[#E9ECEF] hover:text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: `'FILL' ${showAIDesktop && canUseAISuggestions ? 1 : 0}` }}>auto_awesome</span>
                  </button>
                  <button
                    title="Marcar como não lida"
                    onClick={() => updateConversation(activeConversation.id, { is_unread: true })}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#E9ECEF] text-[#94a3b8] hover:text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">mark_email_unread</span>
                  </button>
                  {canDeleteConversations ? (
                    <button
                      title="Excluir conversa"
                      onClick={async () => {
                        if (!window.confirm('Delete this conversation and all its messages? This cannot be undone.')) return;
                        try {
                          await conversationsApi.deleteConversation(activeConversation.id);
                          handleMobileBack();
                          await fetchConversations();
                          setContextActionHint({ message: 'Conversation deleted.' });
                        } catch (error) {
                          alert(error instanceof Error ? error.message : 'Failed to delete conversation.');
                        }
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#E9ECEF] text-[#94a3b8] hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  ) : null}
                </div>
              </div>
              
              {/* Message History */}
              <div className="flex-1 overflow-y-auto pt-5 px-5 pb-2.5 flex flex-col gap-3.5 bg-[#f8fafc]">
                {(contextActionHint || loadingProjectRouting) && (
                  <div className="sticky top-0 z-10 flex justify-center pb-1">
                    <div className="flex items-center gap-2 rounded-full border border-indigo-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm backdrop-blur">
                      <span>{loadingProjectRouting ? 'Loading project routing...' : contextActionHint?.message}</span>
                      {!loadingProjectRouting && contextActionHint?.projectId ? (
                        <button
                          type="button"
                          onClick={() => router.push(`/projects?projectId=${contextActionHint.projectId}`)}
                          className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-700"
                        >
                          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                          Open {contextActionHint.projectReference ?? 'card'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
                {messages.map((msg) => (
                  (() => {
                    const linkedProjects = linkedProjectsByMessageId[msg.id] ?? [];
                    const primaryLinkedProject = linkedProjects[0];
                    const linkedTasks = linkedTasksByMessageId[msg.id] ?? [];
                    const primaryLinkedTask = linkedTasks[0];
                    const isInternalNote = Boolean(msg.is_internal);
                    const authorLabel = isInternalNote
                      ? (msg.owner?.full_name || 'Internal note')
                      : msg.inbound
                        ? (activeConversation.contact.name || 'User').split(' ')[0]
                        : 'You';
                    return (
                  <div key={msg.id} className={cn("group/message relative flex max-w-[72%]", isInternalNote ? "self-start max-w-[82%]" : !msg.inbound ? "self-end" : "self-start")}>
                    <div className={cn("relative flex flex-col gap-1", isInternalNote ? "items-start" : !msg.inbound ? "items-end" : "items-start")}>
                      <div className={cn("flex items-baseline gap-2", isInternalNote ? "" : !msg.inbound ? "flex-row-reverse" : "")}>
                        <span className="text-[11px] font-semibold text-[#374151]">
                          {authorLabel}
                        </span>
                        <span className="text-[10px] text-[#94a3b8]">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div
                        ref={openMessageMenuId === msg.id ? messageActionsRef : null}
                        className={cn(
                          'absolute z-20',
                          msg.inbound ? '-right-3 top-6' : '-left-3 top-6'
                        )}
                      >
                        <button
                          type="button"
                          aria-label="Message actions"
                          aria-haspopup="menu"
                          aria-expanded={openMessageMenuId === msg.id}
                          onClick={() => setOpenMessageMenuId((current) => current === msg.id ? null : msg.id)}
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-200',
                            openMessageMenuId === msg.id
                              ? 'scale-100 opacity-100 text-indigo-700 border-indigo-200 ring-2 ring-indigo-100'
                              : 'pointer-events-none scale-95 opacity-0 group-hover/message:pointer-events-auto group-hover/message:scale-100 group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:scale-100 group-focus-within/message:opacity-100 hover:text-indigo-700 hover:border-indigo-200'
                          )}
                        >
                          <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>

                        {openMessageMenuId === msg.id && (
                          <div className={cn('absolute top-10', msg.inbound ? 'left-0 origin-top-left' : 'right-0 origin-top-right')}>
                            <MessageContextMenu
                              message={msg}
                              outbound={!msg.inbound}
                              linkedProject={primaryLinkedProject}
                              onSelect={handleMessageActionSelect}
                            />
                          </div>
                        )}
                      </div>

                      <div className={cn(
                        "px-3.5 py-2.5 text-[14px] leading-[1.5] shadow-sm",
                        isInternalNote
                          ? "border border-amber-200 bg-amber-50 text-amber-900"
                          : !msg.inbound
                          ? "bg-[#4f46e5] text-white"
                          : "bg-white border border-[#E9ECEF] text-[#1d1a24]",
                        sendStatus[msg.id] === 'failed' && "opacity-60 border-red-300"
                      )}
                      style={{ borderRadius: isInternalNote ? '12px' : msg.inbound ? '4px 14px 14px 14px' : '14px 4px 14px 14px' }}>
                        {isInternalNote && (
                          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                            <span className="material-symbols-outlined text-[13px]">sticky_note_2</span>
                            Internal note
                          </div>
                        )}
                        <p>{msg.content}</p>
                        {msg.image && <img src={msg.image} alt="Attachment" className="mt-2 rounded-lg max-w-xs cursor-zoom-in" />}
                        {msg.message_type === 'audio' && msg.file && (
                          <AudioMessage src={msg.file} inbound={msg.inbound} />
                        )}
                        {msg.message_type === 'file' && msg.file && (
                          <a href={msg.file} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 mt-2 p-2.5 bg-black/5 rounded-lg hover:bg-black/10 transition-colors">
                            <span className="material-symbols-outlined text-[20px]">description</span>
                            <span className="text-sm truncate max-w-[180px]">{msg.file.split('/').pop()}</span>
                            <span className="material-symbols-outlined text-[16px] ml-auto opacity-50">download</span>
                          </a>
                        )}
                        {/* Send failure indicator + retry — Stories 4.2 + 4.3 */}
                        {!isInternalNote && (sendStatus[msg.id] === 'failed' || msg.delivery_status === 'failed') && (
                          <div className="mt-1.5 flex items-center gap-2 text-red-500 text-xs">
                            <span className="material-symbols-outlined text-[14px]">error</span>
                            <span title={msg.delivery_error || 'Unknown error'}>
                              Send failed
                              {msg.delivery_error && <span className="ml-1 opacity-60 font-mono">({msg.delivery_error.split(':').pop()})</span>}
                            </span>
                            {(msg.retry_count ?? 0) < 3 && (
                              <button
                                onClick={() => retryMessage(msg.conversation_id, msg.id)}
                                className="underline hover:text-red-700 transition-colors"
                              >
                                Retry {msg.retry_count ? `(${msg.retry_count}/3)` : ''}
                              </button>
                            )}
                            {(msg.retry_count ?? 0) >= 3 && (
                              <span className="opacity-60">Retry limit reached</span>
                            )}
                          </div>
                        )}
                        {sendStatus[msg.id] === 'sending' && (
                          <div className="mt-1 flex justify-end">
                            <span className="material-symbols-outlined text-[12px] opacity-50 animate-spin">progress_activity</span>
                          </div>
                        )}
                      </div>
                      {!isInternalNote && !msg.inbound && sendStatus[msg.id] !== 'failed' && msg.delivery_status !== 'failed' && (
                        <div className="flex items-center gap-[3px]">
                          <span className="material-symbols-outlined text-[12px]"
                            style={{ fontVariationSettings: "'FILL' 1", color: msg.delivery_status === 'delivered' ? '#7C4DFF' : '#94a3b8' }}>
                            {msg.delivery_status === 'delivered' ? 'done_all' : 'done'}
                          </span>
                          <span className="text-[10px] text-[#94a3b8]">
                            {msg.delivery_status === 'delivered' ? 'Read' : 'Sent'}
                          </span>
                        </div>
                      )}

                      {primaryLinkedProject || primaryLinkedTask ? (
                        <div className={cn("flex items-center gap-2", !msg.inbound ? "justify-end" : "justify-start")}>
                          {primaryLinkedProject ? (
                            <>
                              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">
                                <span className="material-symbols-outlined text-[12px]">add_card</span>
                                Already a card
                              </span>
                              <button
                                type="button"
                                onClick={() => router.push(`/projects?projectId=${primaryLinkedProject.id}`)}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 transition hover:text-indigo-800"
                              >
                                <span>Open {primaryLinkedProject.reference}</span>
                                <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                              </button>
                            </>
                          ) : null}
                          {primaryLinkedTask ? (
                            <>
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                                <span className="material-symbols-outlined text-[12px]">checklist</span>
                                Already a task
                              </span>
                              <button
                                type="button"
                                onClick={() => router.push(`/projects?projectId=${primaryLinkedTask.project_id}`)}
                                className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 transition hover:text-emerald-900"
                              >
                                <span>Open {primaryLinkedTask.project_reference ?? 'project'}</span>
                                <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                    );
                  })()
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Reply chip strip — desktop */}
              <div className="hidden md:flex items-center gap-1.5 pt-1.5 px-3.5 bg-white border-t border-[#E9ECEF] overflow-x-auto [&::-webkit-scrollbar]:hidden">
                {allQuickReplies.slice(0, 4).map(qr => (
                  <button
                    key={qr.id}
                    onClick={() => setInput(qr.content)}
                    className="shrink-0 flex items-center gap-1 h-[26px] px-2.5 rounded-full border border-[#e2e8f0] bg-white text-[11px] font-semibold text-[#575f67] hover:border-[#a5b4fc] hover:bg-[#eef2ff] hover:text-[#4338ca] transition-colors whitespace-nowrap"
                  >
                    <span style={{ background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 4, padding: '0 4px', fontSize: 9, fontWeight: 700 }}>{qr.shortcut}</span>
                    {qr.shortcut.replace('/', '').charAt(0).toUpperCase() + qr.shortcut.replace('/', '').slice(1)}
                  </button>
                ))}
                {allQuickReplies.length > 4 && (
                  <button className="shrink-0 flex items-center gap-1 h-[26px] px-2.5 rounded-full border border-[#e2e8f0] bg-white text-[11px] font-semibold text-[#575f67] hover:bg-slate-50 transition-colors">
                    <span className="material-symbols-outlined text-[14px]">more_horiz</span>
                    More
                  </button>
                )}
                {/* Add new quick reply */}
                <button
                  onClick={() => { setNewQRShortcut(''); setNewQRContent(''); setNewQRModal(true); }}
                  title="Add quick reply"
                  className="shrink-0 ml-auto flex items-center justify-center w-[26px] h-[26px] rounded-full border border-[#e2e8f0] bg-white text-[#94a3b8] hover:border-[#c7d2fe] hover:bg-[#eef2ff] hover:text-[#4338ca] transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">add</span>
                </button>
              </div>

              {/* Input Area */}
              <div
                className="pt-2.5 px-3.5 pb-3 bg-white relative"
                style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) qrClose(); }}
              >
                {/* Emoji Picker */}
                {showEmojiPicker && (
                  <div className="absolute bottom-full mb-2 left-md z-50 shadow-2xl rounded-2xl overflow-hidden border border-outline-variant">
                    <EmojiPicker 
                      onEmojiClick={onEmojiClick} 
                      theme={Theme.LIGHT} 
                      width={320} 
                      height={400}
                      previewConfig={{ showPreview: false }}
                    />
                  </div>
                )}

                {/* File Preview */}
                {selectedFile && (
                  <div className="mb-2 p-2 flex items-center gap-3 bg-[#F8F9FA] rounded-xl border border-[#E9ECEF] animate-in fade-in slide-in-from-bottom-2">
                    {previewUrl ? (
                      <img src={previewUrl} className="w-12 h-12 rounded-lg object-cover border border-white shadow-sm" alt="Preview" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-slate-200 flex items-center justify-center text-slate-500">
                        <span className="material-symbols-outlined">description</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{selectedFile.name}</p>
                      <p className="text-[10px] text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button onClick={cancelAttachment} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-500">
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-1.5 bg-[#f1f5f9] rounded-xl py-[5px] px-1.5 border border-transparent focus-within:bg-white focus-within:border-[#c7d2fe] transition-colors">
                  {isRecording ? (
                    <div className="flex-1 flex items-center gap-3 px-3 py-2 text-indigo-600">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-sm font-semibold tabular-nums">Recording: {formatDuration(recordingDuration)}</span>
                      <button onClick={() => { setIsRecording(false); if(timerRef.current) clearInterval(timerRef.current); }} className="ml-auto text-xs font-medium hover:underline">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className={cn("w-8 h-8 flex items-center justify-center rounded-[7px] text-[#94a3b8] hover:bg-[#e2e8f0] transition-colors", showEmojiPicker && "text-[#7C4DFF] bg-[#f5f3ff]")}>
                          <span className="material-symbols-outlined text-[19px]">mood</span>
                        </button>
                        <button onClick={handleFileSelect} className="w-8 h-8 flex items-center justify-center rounded-[7px] text-[#94a3b8] hover:bg-[#e2e8f0] transition-colors">
                          <span className="material-symbols-outlined text-[19px]">attach_file</span>
                        </button>
                      </div>
                      {/* Quick Reply autocomplete dropdown */}
                      {qrOpen && (
                        <div className="absolute bottom-full left-0 right-0 mb-2 mx-3 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
                          {qrMatches.map(qr => (
                            <button
                              key={qr.id}
                              className="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0 transition-colors"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setInput(qr.content);
                                qrClose();
                              }}
                            >
                              <span className="text-xs font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md shrink-0 mt-0.5">{qr.shortcut}</span>
                              <span className="text-sm text-slate-700 truncate">{qr.content}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <textarea
                        data-testid="message-input"
                        className="flex-1 bg-transparent border-none text-[13px] text-[#1d1a24] focus:ring-0 outline-none resize-none py-1 pl-1 max-h-[120px] overflow-y-auto"
                        placeholder="Type a message or / for quick replies…"
                        rows={1}
                        value={input}
                        onFocus={() => setShowEmojiPicker(false)}
                        onChange={(e) => {
                          const val = e.target.value;
                          setInput(val);
                          qrSearch(val);
                          e.target.style.height = 'auto';
                          e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { qrClose(); return; }
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); qrClose(); handleSendMessage(); }
                        }}
                      />
                    </>
                  )}

                  <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />

                  <div className="flex items-center gap-0.5 shrink-0">
                    {/* Quick reply shortcut button */}
                    <button
                      onClick={() => { setInput('/'); qrSearch('/'); }}
                      title="Respostas rápidas"
                      className="w-8 h-8 flex items-center justify-center rounded-[7px] text-[#94a3b8] hover:bg-[#e2e8f0] hover:text-[#4338ca] transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">quick_phrases</span>
                    </button>
                    {/* AI toggle — desktop */}
                    <button
                      title={canUseAISuggestions ? "Sugestões de IA" : "AI suggestions are only available after an inbound customer message"}
                      disabled={!canUseAISuggestions}
                      onClick={() => {
                        if (!canUseAISuggestions) return;
                        setShowAIDesktop(v => !v);
                      }}
                      className="hidden md:flex w-8 h-8 items-center justify-center rounded-[7px] transition-colors"
                      style={!canUseAISuggestions
                        ? { background: '#f8fafc', color: '#cbd5e1', cursor: 'not-allowed' }
                        : showAIDesktop
                          ? { background: '#f5f3ff', color: '#7C4DFF' }
                          : { color: '#94a3b8' }}
                    >
                      <span className="material-symbols-outlined text-[18px]"
                        style={{ fontVariationSettings: `'FILL' ${showAIDesktop && canUseAISuggestions ? 1 : 0}` }}>auto_awesome</span>
                    </button>
                    {/* Mobile AI sheet button */}
                    <button
                      data-testid="ai-sparkles-button"
                      type="button"
                      onClick={() => {
                        if (!canUseAISuggestions) return;
                        if (activeConversation && suggestions.length === 0 && !aiGenerating && !aiLoading) {
                          generateAI(activeConversation.id);
                        }
                        setAiSheetOpen(true);
                      }}
                      disabled={!canUseAISuggestions || aiGenerating || aiLoading}
                      className={cn("md:hidden w-8 h-8 flex items-center justify-center rounded-[7px] transition-all",
                        !canUseAISuggestions
                          ? "text-[#cbd5e1]"
                          : aiGenerating || aiLoading
                            ? "text-[#7C4DFF]"
                            : "text-[#94a3b8] hover:text-[#7C4DFF]")}
                    >
                      {aiGenerating || aiLoading
                        ? <span className="w-3.5 h-3.5 border-2 border-[#7C4DFF]/30 border-t-[#7C4DFF] rounded-full animate-spin" />
                        : <TbSparkles size={17} />
                      }
                    </button>
                    {/* Send / mic / stop */}
                    {!input.trim() && !selectedFile && !isRecording ? (
                      <button onClick={startRecording}
                        className="w-8 h-8 rounded-[7px] text-[#94a3b8] flex items-center justify-center hover:bg-[#e2e8f0] transition-colors">
                        <span className="material-symbols-outlined text-[19px]">mic</span>
                      </button>
                    ) : (
                      <button
                        onClick={isRecording ? stopRecording : handleSendMessage}
                        disabled={loading}
                        className={cn(
                          "w-9 h-9 rounded-[9px] flex items-center justify-center shrink-0 transition-all ml-0.5",
                          isRecording ? "bg-red-500 text-white hover:bg-red-600"
                            : input.trim() || selectedFile ? "bg-[#4f46e5] text-white hover:bg-[#4338ca]"
                            : "bg-[#e2e8f0] text-[#94a3b8]",
                          loading && "opacity-50 cursor-not-allowed"
                        )}
                        style={{ boxShadow: (input.trim() || selectedFile) && !isRecording ? '0 2px 8px rgba(79,70,229,0.3)' : 'none' }}
                      >
                        {loading
                          ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          : <span className="material-symbols-outlined text-[17px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                              {isRecording ? 'stop' : 'send'}
                            </span>
                        }
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* AI Panel — desktop, below composer */}
              {showAIDesktop && canUseAISuggestions && (
                <div className="hidden md:block border-t border-[#E9ECEF] bg-white">
                  <div className="pt-2.5 px-3.5 pb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-[5px] bg-gradient-to-br from-[#7C4DFF] to-[#4338ca] flex items-center justify-center">
                        <TbSparkles size={11} color="white" />
                      </div>
                      <span className="text-[11px] font-bold text-[#7C4DFF] uppercase tracking-wider">AI Suggestions</span>
                      {(aiGenerating || aiLoading) && (
                        <span className="w-3 h-3 border-2 border-[#7C4DFF]/30 border-t-[#7C4DFF] rounded-full animate-spin" />
                      )}
                      {aiSource && aiGeneratedAt && (
                        <span className="text-[10px] text-slate-400">
                          {aiSource === 'generated' ? 'Generated' : 'Cached'} · {aiGeneratedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => generateAI(activeConversation!.id)}
                      disabled={!canUseAISuggestions || aiGenerating || aiLoading}
                      className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-[7px] border border-[#e9d5ff] bg-white text-[11px] font-semibold text-[#7C4DFF] hover:bg-[#f5f3ff] disabled:opacity-50 transition-colors"
                    >
                      <span className={cn("material-symbols-outlined text-[13px]", (aiGenerating || aiLoading) && "animate-spin")}>
                        {(aiGenerating || aiLoading) ? "progress_activity" : "refresh"}
                      </span>
                      {(aiGenerating || aiLoading) ? 'Generating…' : 'Generate'}
                    </button>
                  </div>
                  <div className="px-2.5 pb-2.5 flex flex-col gap-[5px]">
                    {(aiGenerating || aiLoading) && (
                      [1,2].map(i => <div key={i} className="h-14 rounded-[9px] bg-slate-100 animate-pulse" />)
                    )}
                    {!aiGenerating && !aiLoading && suggestions.length === 0 && (
                      <button
                        onClick={() => generateAI(activeConversation!.id)}
                        disabled={!canUseAISuggestions}
                        className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 text-xs text-slate-400 hover:border-[#7C4DFF] hover:text-[#7C4DFF] transition-colors flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                        Generate AI suggestions
                      </button>
                    )}
                    {!aiGenerating && !aiLoading && suggestions.map((s, i) => {
                      const confidence = Math.max(70, 97 - i * 8);
                      return (
                        <button
                          key={i}
                          onClick={() => setInput(s)}
                          className="w-full text-left py-[9px] px-[11px] rounded-[9px] bg-[#faf5ff] border border-[#ede9fe] text-[12px] text-[#374151] leading-[1.5] hover:bg-[#ede9fe] hover:border-[#c4b5fd] transition-colors"
                        >
                          <p className="mb-1">{s}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-[#94a3b8]">Confiança</span>
                            <div className="flex items-center gap-1.5">
                              <div style={{ width: 50, height: 3, background: '#e9d5ff', borderRadius: 99 }}>
                                <div style={{ width: `${confidence}%`, height: '100%', background: confidence > 85 ? '#7C4DFF' : '#a78bfa', borderRadius: 99 }} />
                              </div>
                              <span className="text-[10px] font-bold text-[#7C4DFF]">{confidence}%</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Mobile AI Suggestions Sheet — bottom drawer, md:hidden */}
              {aiSheetOpen && canUseAISuggestions && (
                <div className="fixed inset-0 z-50 md:hidden">
                  {/* Backdrop */}
                  <div
                    className="absolute inset-0 bg-black/40 transition-opacity"
                    onClick={() => setAiSheetOpen(false)}
                  />
                  {/* Sheet panel */}
                  <div
                    data-testid="ai-suggestions-sheet"
                    className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl overflow-y-auto"
                    style={{ maxHeight: '50vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
                  >
                    {/* Handle bar */}
                    <div className="flex justify-center pt-3 pb-1">
                      <div className="w-10 h-1 rounded-full bg-slate-200" />
                    </div>
                    <div className="px-4 pb-4">
                      {/* Header */}
                      <div className="flex items-center gap-2 py-3 border-b border-slate-100 mb-3">
                        <TbSparkles size={16} className="text-indigo-600" />
                        <span className="text-sm font-semibold text-indigo-600">AI Suggestions</span>
                        <button
                          onClick={() => setAiSheetOpen(false)}
                          className="ml-auto w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400"
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      </div>
                      {/* Suggestions list */}
                      <div className="space-y-2">
                        {(aiGenerating || aiLoading) && (
                          <div className="flex flex-col gap-2">
                            {[1, 2, 3].map(i => (
                              <div key={i} className="h-10 bg-slate-100 rounded-xl animate-pulse" />
                            ))}
                          </div>
                        )}
                        {!aiGenerating && !aiLoading && suggestions.length === 0 && (
                          <p className="text-sm text-slate-400 text-center py-4">No suggestions available</p>
                        )}
                        {!aiGenerating && !aiLoading && suggestions.map((s, i) => (
                          <button
                            key={i}
                            data-testid="ai-suggestion-item"
                            onClick={() => { setInput(s); setAiSheetOpen(false); }}
                            className="w-full text-left px-4 py-3 rounded-xl bg-indigo-50 border border-indigo-100 text-sm text-slate-700 hover:bg-indigo-100 transition-colors"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#94a3b8]">
              <div className="text-center">
                <span className="material-symbols-outlined text-[40px]" style={{ color: '#c7d2fe' }}>chat_bubble_outline</span>
                <p className="text-sm mt-2">Selecione uma conversa</p>
              </div>
            </div>
          )}
        </section>

        {/* Right Column — Tabbed panel, hidden on mobile */}
        <aside className="hidden md:flex w-[280px] h-full flex-col bg-white border-l border-outline-variant shrink-0 overflow-hidden">
          {activeConversation ? (
            <>
              {/* Tab bar */}
              <div className="flex border-b border-[#E9ECEF] shrink-0 pt-2">
                {([
                  ['contact', 'person', 'Contact'],
                  ['details', 'info', 'Details'],
                  ['history', 'history', 'History'],
                ] as const).map(([t, icon, label]) => (
                  <button
                    key={t}
                    onClick={() => setRightPanelTab(t)}
                    className={cn(
                      "flex-1 h-11 flex flex-col items-center justify-center gap-0.5 border-none bg-transparent cursor-pointer transition-all",
                      rightPanelTab === t ? "text-[#7C4DFF]" : "text-[#94a3b8] hover:text-slate-600"
                    )}
                    style={{ borderBottom: rightPanelTab === t ? '2px solid #7C4DFF' : '2px solid transparent' }}
                  >
                    <span className="material-symbols-outlined text-[16px]" style={rightPanelTab === t ? { fontVariationSettings: "'FILL' 1" } : {}}>{icon}</span>
                    <span className="text-[10px] font-semibold">{label}</span>
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto">
                {/* ── Contact tab ── */}
                {rightPanelTab === 'contact' && (
                  <div className="pt-4 px-4">
                    <div className="flex flex-col items-center gap-2 pb-4 mb-4 border-b border-[#E9ECEF]">
                      {(() => {
                        const rpName = activeConversation.contact.name || activeConversation.contact.channel_identifier || 'U';
                        const rpColor = avatarColor(rpName);
                        const rpIni = rpName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
                        return (
                          <div className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-[18px] font-bold"
                            style={{ background: rpColor.bg, color: rpColor.text }}>{rpIni}</div>
                        );
                      })()}
                      <div className="text-center">
                        <p className="text-[15px] font-bold text-[#1d1a24]">{activeConversation.contact.name || '-'}</p>
                        <p className="text-[12px] text-[#7a7487] mt-0.5 truncate max-w-[220px]">{activeConversation.contact.channel_identifier}</p>
                      </div>
                      <ChannelBadge channel={activeConversation.channel} />
                    </div>
                    <div className="mb-3.5">
                      <p className="text-[10px] font-bold text-[#575f67] uppercase mb-2" style={{ letterSpacing: '0.06em' }}>Contact details</p>
                      <div className="space-y-2 text-[12px]">
                        {[
                          { label: 'Name', value: activeConversation.contact.name || '-' },
                          { label: 'Identifier', value: activeConversation.contact.channel_identifier },
                          { label: 'Channel', value: getChannelMeta(activeConversation.channel).label },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-center">
                            <span className="text-[#7a7487]">{label}</span>
                            <span className="font-medium text-[#1d1a24] text-right max-w-[150px] truncate">{value}</span>
                          </div>
                        ))}
                        {activeConversation.first_response_at && (
                          <div className="flex justify-between items-center">
                            <span className="text-[#7a7487]">First response</span>
                            <span className="font-medium text-[#1d1a24]">
                              {Math.round((new Date(activeConversation.first_response_at).getTime() - new Date(activeConversation.created_at).getTime()) / 60000)}m
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ── Linked client section ── */}
                    <div className="border-t border-[#E9ECEF] pt-3.5 mt-1">
                      <p className="text-[10px] font-bold text-[#575f67] uppercase mb-2" style={{ letterSpacing: '0.06em' }}>Linked client</p>

                      {clientDetecting ? (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                          Detecting…
                        </div>

                      ) : clientAlreadyLinked && clientMatches[0] ? (
                        /* ── Já vinculado ── */
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[12px] font-semibold text-slate-800 truncate">{clientMatches[0].name}</p>
                              {clientMatches[0].company_name && (
                                <p className="text-[11px] text-slate-500 truncate">{clientMatches[0].company_name}</p>
                              )}
                            </div>
                            <button
                              onClick={async () => {
                                if (!activeConversation.contact_id) return;
                                if (!confirm('Unlink this client?')) return;
                                await conversationsApi.linkContactToClient(activeConversation.contact_id, null).catch(() => {});
                                setClientAlreadyLinked(false);
                                setClientMatches([]);
                                setClientHistory([]);
                              }}
                              className="shrink-0 text-[10px] text-slate-400 hover:text-red-500 transition-colors"
                              title="Unlink"
                            >
                              <span className="material-symbols-outlined text-[14px]">link_off</span>
                            </button>
                          </div>
                          <button
                            onClick={() => setRightPanelTab('history')}
                            className="text-[11px] text-indigo-600 hover:underline"
                          >
                            See full history →
                          </button>
                        </div>

                      ) : clientMatches.length > 0 && !showQuickClientForm ? (
                        /* ── Match detectado ── */
                        <div className="space-y-2">
                          <p className="text-[11px] text-slate-500">Existing client found:</p>
                          {clientMatches.slice(0, 2).map(m => (
                            <div key={m.id} className="rounded-xl border border-indigo-100 bg-indigo-50 p-2.5">
                              <p className="text-[12px] font-semibold text-slate-800">{m.name}</p>
                              {m.company_name && <p className="text-[11px] text-slate-500">{m.company_name}</p>}
                              <p className="text-[10px] text-slate-400 mb-1.5">Matched by {m.match_field}</p>
                              <button
                                disabled={clientLinking}
                                onClick={async () => {
                                  if (!activeConversation.contact_id) return;
                                  setClientLinking(true);
                                  try {
                                    await conversationsApi.linkContactToClient(activeConversation.contact_id, m.id);
                                    setClientAlreadyLinked(true);
                                    setClientMatches([m]);
                                    setClientHistoryLoading(true);
                                    const r = await conversationsApi.getClientConversations(m.id, { limit: 20 });
                                    setClientHistory((r.data ?? []).filter(c => c.id !== activeConversation.id));
                                  } catch { /* ignore */ } finally {
                                    setClientLinking(false);
                                    setClientHistoryLoading(false);
                                  }
                                }}
                                className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-medium py-1.5 transition-colors disabled:opacity-60"
                              >
                                {clientLinking ? 'Linking…' : 'Link to this client'}
                              </button>
                            </div>
                          ))}
                          <div className="text-center">
                            <button
                              onClick={() => {
                                setShowQuickClientForm(true);
                                setShowExistingClientPicker(false);
                                setQuickClientForm({
                                  name: activeConversation.contact.name ?? '',
                                  company_name: '',
                                });
                                setQuickClientError(null);
                              }}
                              className="text-[11px] text-slate-500 hover:text-slate-700 underline"
                            >
                              + Create new client instead
                            </button>
                          </div>
                        </div>

                      ) : showQuickClientForm ? (
                        /* ── Formulário rápido de criação ── */
                        <div className="space-y-2">
                          {quickClientError && (
                            <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-2 py-1">{quickClientError}</p>
                          )}
                          <input
                            value={quickClientForm.name}
                            onChange={e => setQuickClientForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Name *"
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:border-slate-400"
                          />
                          <input
                            value={quickClientForm.company_name}
                            onChange={e => setQuickClientForm(f => ({ ...f, company_name: e.target.value }))}
                            placeholder="Company name (optional)"
                            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:border-slate-400"
                          />
                          <div className="flex gap-2 pt-1">
                            <button
                              onClick={() => { setShowQuickClientForm(false); setQuickClientError(null); }}
                              className="flex-1 rounded-lg border border-slate-200 text-[11px] text-slate-600 py-1.5 hover:bg-slate-50 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              disabled={quickClientSaving || !quickClientForm.name}
                              onClick={async () => {
                                if (!activeConversation.contact_id) return;
                                setQuickClientSaving(true);
                                setQuickClientError(null);
                                try {
                                  const newClient = await clientsApi.createClient({
                                    name: quickClientForm.name,
                                    company_name: quickClientForm.company_name || null,
                                  });
                                  await conversationsApi.linkContactToClient(activeConversation.contact_id, newClient.id);
                                  setClientAlreadyLinked(true);
                                  setClientMatches([{ id: newClient.id, name: newClient.name, company_name: newClient.company_name ?? null, match_field: 'linked' }]);
                                  setShowQuickClientForm(false);
                                } catch (err: unknown) {
                                  setQuickClientError(err instanceof Error ? err.message : 'Failed to create client.');
                                } finally {
                                  setQuickClientSaving(false);
                                }
                              }}
                              className="flex-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-medium py-1.5 transition-colors disabled:opacity-60"
                            >
                              {quickClientSaving ? 'Saving…' : 'Create & link'}
                            </button>
                          </div>
                        </div>

                      ) : (
                        /* ── Sem cliente, sem match ── */
                        <div className="space-y-2 py-1">
                          <p className="text-[11px] text-slate-400 text-center">No client linked.</p>
                          <button
                            onClick={() => {
                              setShowExistingClientPicker((prev) => !prev);
                              setShowQuickClientForm(false);
                              setQuickClientError(null);
                              setExistingClientSearch('');
                              setExistingClientError(null);
                            }}
                            className="w-full rounded-lg border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-50 py-2 transition-colors"
                          >
                            {showExistingClientPicker ? 'Hide existing clients' : 'Link to existing client'}
                          </button>
                          {showExistingClientPicker && (
                            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                              <input
                                value={existingClientSearch}
                                onChange={(e) => setExistingClientSearch(e.target.value)}
                                placeholder="Search by client name or company"
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:border-slate-400"
                              />
                              {existingClientError && (
                                <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-2 py-1">{existingClientError}</p>
                              )}
                              {existingClientLoading ? (
                                <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-slate-400">
                                  <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                  Loading clients...
                                </div>
                              ) : existingClientResults.length > 0 ? (
                                <div className="space-y-1.5">
                                  {existingClientResults.map((client) => (
                                    <button
                                      key={client.id}
                                      type="button"
                                      disabled={clientLinking}
                                      onClick={async () => {
                                        if (!activeConversation.contact_id) return;
                                        setClientLinking(true);
                                        setExistingClientError(null);
                                        try {
                                          await conversationsApi.linkContactToClient(activeConversation.contact_id, client.id);
                                          setClientAlreadyLinked(true);
                                          setClientMatches([{
                                            id: client.id,
                                            name: client.name,
                                            company_name: client.company_name ?? null,
                                            match_field: 'linked',
                                          }]);
                                          setShowExistingClientPicker(false);
                                          setClientHistoryLoading(true);
                                          const response = await conversationsApi.getClientConversations(client.id, { limit: 20 });
                                          setClientHistory((response.data ?? []).filter(c => c.id !== activeConversation.id));
                                        } catch (err: unknown) {
                                          setExistingClientError(err instanceof Error ? err.message : 'Failed to link client.');
                                        } finally {
                                          setClientLinking(false);
                                          setClientHistoryLoading(false);
                                        }
                                      }}
                                      className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate text-[12px] font-medium text-slate-800">{client.name}</p>
                                        {client.company_name && (
                                          <p className="truncate text-[11px] text-slate-500">{client.company_name}</p>
                                        )}
                                      </div>
                                      <span className="text-[11px] font-medium text-slate-500">
                                        {clientLinking ? 'Linking...' : 'Link'}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="py-2 text-center text-[11px] text-slate-400">No clients found.</p>
                              )}
                            </div>
                          )}
                          <button
                            onClick={() => {
                              setShowQuickClientForm(true);
                              setShowExistingClientPicker(false);
                              setQuickClientForm({
                                name: activeConversation.contact.name ?? '',
                                company_name: '',
                              });
                              setQuickClientError(null);
                            }}
                            className="w-full rounded-lg border border-dashed border-slate-300 text-[11px] text-slate-500 hover:border-slate-400 hover:text-slate-700 py-2 transition-colors"
                          >
                            + Create client from contact
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Details tab ── */}
                {rightPanelTab === 'details' && (
                  <div className="p-4 space-y-5">
                    {/* Status */}
                    <div>
                      <p className="text-[10px] font-bold text-[#575f67] uppercase mb-2" style={{ letterSpacing: '0.06em' }}>Status</p>
                      <div className="flex gap-1.5">
                        {STATUS_OPTIONS.map((s) => {
                          const meta = getConversationStatusMeta(s);
                          const isActive = activeConversation.status === s;
                          return (
                            <button
                              key={s}
                              onClick={() => updateConversation(activeConversation.id, { status: s })}
                              className={cn(
                                "flex-1 py-[5px] rounded-[7px] border text-[11px] font-semibold transition-all",
                                isActive ? meta.buttonActiveClassName : "bg-white text-[#575f67] border-[#e2e8f0] hover:border-slate-300"
                              )}
                            >
                              {meta.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Assigned Agent */}
                    <div>
                      <p className="text-[10px] font-bold text-[#575f67] uppercase mb-2" style={{ letterSpacing: '0.06em' }}>Assigned Agent</p>
                      <AssignmentPanel
                        conversation={activeConversation}
                        agents={assignableUsers}
                        onAssign={async (userId) => {
                          await assignConversationOwner(activeConversation.id, userId);
                        }}
                      />
                    </div>

                    {/* Tag */}
                    <div>
                      <p className="text-[10px] font-bold text-[#575f67] uppercase mb-2" style={{ letterSpacing: '0.06em' }}>Conversation Tag</p>
                      <TagPills
                        value={activeConversation.tag}
                        onChange={(tag: ConversationTag | null) => updateConversation(activeConversation.id, { tag })}
                      />
                      <p className="mt-1.5 text-[10px] text-slate-400">One tag per conversation in this release.</p>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="material-symbols-outlined text-[14px] text-amber-600">sticky_note_2</span>
                        <p className="text-[10px] font-bold text-[#575f67] uppercase" style={{ letterSpacing: '0.06em' }}>Internal Note</p>
                      </div>
                      <textarea
                        value={internalNoteDraft}
                        onChange={(event) => setInternalNoteDraft(event.target.value)}
                        placeholder="Add handoff context or an internal observation. This note is never sent to the customer."
                        className="min-h-[96px] w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-slate-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
                      />
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-[10px] text-slate-400">Visible only to internal operators in this conversation.</p>
                        <button
                          type="button"
                          onClick={handleCreateInternalNote}
                          disabled={!internalNoteDraft.trim() || savingInternalNote}
                          className="inline-flex h-9 items-center justify-center rounded-xl bg-amber-600 px-3 text-[11px] font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
                        >
                          {savingInternalNote ? 'Saving...' : 'Add Note'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── History tab ── */}
                {rightPanelTab === 'history' && (
                  <div className="p-4 space-y-4">
                    {/* Same contact, same channel */}
                    {(() => {
                      const sameContact = conversations.filter(
                        c => c.contact_id === activeConversation.contact_id && c.id !== activeConversation.id
                      );
                      return (
                        <div>
                          <p className="text-[10px] font-bold text-[#575f67] uppercase mb-2" style={{ letterSpacing: '0.06em' }}>
                            This channel
                          </p>
                          {sameContact.length === 0 ? (
                            <p className="text-xs text-slate-400 py-2">No previous conversations on this channel</p>
                          ) : (
                            <div className="flex flex-col divide-y divide-slate-100">
                              {sameContact.map(c => (
                                <button
                                  key={c.id}
                                  onClick={() => handleSelectConversation(c)}
                                  className="flex flex-col gap-1.5 py-2.5 text-left hover:bg-slate-50 transition-colors px-1 rounded-lg"
                                >
                                  <div className="flex items-center justify-between">
                                    <ChannelBadge channel={c.channel} compact />
                                    <span className="text-[10px] text-slate-400">
                                      {c.last_message_date ? new Date(c.last_message_date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-600 truncate">{c.last_message || 'No messages'}</p>
                                  <ConversationStatusBadge status={c.status} className="w-fit" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Client history — all channels */}
                    <div className="border-t border-[#E9ECEF] pt-3">
                      <p className="text-[10px] font-bold text-[#575f67] uppercase mb-2" style={{ letterSpacing: '0.06em' }}>
                        Client history
                      </p>
                      {!clientAlreadyLinked ? (
                        <div className="text-center py-3 space-y-1.5">
                          <p className="text-xs text-slate-400">Link a client to see history across all channels.</p>
                          <button
                            onClick={() => setRightPanelTab('contact')}
                            className="text-[11px] text-indigo-600 hover:underline"
                          >
                            + Link client
                          </button>
                        </div>
                      ) : clientHistoryLoading ? (
                        <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                          Loading…
                        </div>
                      ) : clientHistory.length === 0 ? (
                        <p className="text-xs text-slate-400 py-2">First conversation with this client.</p>
                      ) : (
                        <div className="flex flex-col divide-y divide-slate-100">
                          {clientHistory.map(c => {
                            const ch = (c.channel?.toUpperCase() ?? 'WEB') as ChannelType;
                            const status = (c.status?.toUpperCase() ?? 'OPEN') as ConversationStatus;
                            return (
                              <div key={c.id} className="flex flex-col gap-1.5 py-2.5 px-1">
                                <div className="flex items-center justify-between">
                                  <ChannelBadge channel={ch} compact />
                                  <span className="text-[10px] text-slate-400">
                                    {c.last_message_date ? new Date(c.last_message_date).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                                  </span>
                                </div>
                                {c.contact_name && (
                                  <p className="text-[10px] text-slate-400 truncate">{c.contact_name} · {c.channel_identifier}</p>
                                )}
                                <p className="text-xs text-slate-600 truncate">{c.last_message || 'No messages'}</p>
                                <ConversationStatusBadge status={status} className="w-fit" />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-5 opacity-50">
              <p className="text-sm text-slate-400">No contact selected.</p>
            </div>
          )}
        </aside>
      </main>

      {createCardModal && (
        <CreateCardFromMessageModal
          state={createCardModal}
          stages={projectStages}
          projects={availableProjects}
          loadingProjects={loadingProjectRouting}
          submitting={submittingProjectCard}
          onClose={() => setCreateCardModal(null)}
          onChange={(patch) => setCreateCardModal(current => current ? { ...current, ...patch } : current)}
          onSubmit={handleCreateCardSubmit}
        />
      )}

      {createTaskModal && (
        <CreateTaskFromMessageModal
          state={createTaskModal}
          projects={availableProjects}
          loadingProjects={loadingProjectRouting}
          submitting={submittingProjectTask}
          onClose={() => setCreateTaskModal(null)}
          onChange={(patch) => setCreateTaskModal(current => current ? { ...current, ...patch } : current)}
          onSubmit={handleCreateTaskSubmit}
        />
      )}

      {tagMessageModal && (
        <AddTagFromMessageModal
          currentTag={activeConversation?.tag}
          saving={savingConversationTag}
          onClose={() => setTagMessageModal(null)}
          onSelect={handleConversationTagFromMessage}
        />
      )}

      {quickReplyModal && (
        <QuickReplyFromMessageModal
          state={quickReplyModal}
          saving={creatingQuickReply}
          onClose={() => setQuickReplyModal(null)}
          onChange={(patch) => setQuickReplyModal(current => current ? { ...current, ...patch } : current)}
          onSubmit={handleQuickReplyCreate}
        />
      )}

      {deleteMessageModal && (
        <DeleteMessageModal
          state={deleteMessageModal}
          deleting={deletingMessage}
          onDelete={handleDeleteMessage}
          onClose={() => setDeleteMessageModal(null)}
        />
      )}

      {/* New Quick Reply modal */}
      {newQRModal && (
        <Modal title="New Quick Reply" onClose={() => setNewQRModal(false)} maxWidth="max-w-lg">
          <div className="space-y-5">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Shortcut</span>
              <input
                autoFocus
                value={newQRShortcut}
                onChange={e => {
                  let v = e.target.value;
                  if (v && !v.startsWith('/')) v = '/' + v;
                  setNewQRShortcut(v);
                }}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                placeholder="/greeting"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Content</span>
              <textarea
                value={newQRContent}
                onChange={e => setNewQRContent(e.target.value)}
                className="min-h-[120px] rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 resize-none"
                placeholder="Quick reply text…"
              />
            </label>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={() => setNewQRModal(false)}
                disabled={savingNewQR}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingNewQR || !newQRShortcut.trim() || !newQRContent.trim()}
                onClick={async () => {
                  setSavingNewQR(true);
                  try {
                    await quickRepliesApi.createQuickReply({ shortcut: newQRShortcut.trim(), content: newQRContent.trim() });
                    const fresh = await quickRepliesApi.listQuickReplies();
                    setAllQuickReplies(fresh.data ?? []);
                    setNewQRModal(false);
                  } catch {
                    alert('Failed to create quick reply.');
                  } finally {
                    setSavingNewQR(false);
                  }
                }}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#4f46e5] px-4 text-sm font-semibold text-white transition hover:bg-[#4338ca] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingNewQR ? 'Creating…' : 'Create Quick Reply'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
