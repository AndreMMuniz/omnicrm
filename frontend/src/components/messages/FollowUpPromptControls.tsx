import type { Conversation } from "@/types/chat";
import { getFollowUpCueLabel } from "@/lib/followUpPrompts";

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function FollowUpBadge({
  conversation,
  compact = false,
  className,
}: {
  conversation: Pick<Conversation, "needs_follow_up" | "follow_up_note" | "follow_up_at">;
  compact?: boolean;
  className?: string;
}) {
  const label = getFollowUpCueLabel(conversation);
  if (!label) return null;

  return (
    <span
      className={joinClasses(
        "inline-flex max-w-full items-center gap-1 rounded-full border border-amber-200 bg-amber-50 font-semibold text-amber-800",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        className
      )}
      title={label}
    >
      <span className={joinClasses("material-symbols-outlined", compact ? "text-[12px]" : "text-[14px]")}>flag</span>
      <span className="truncate">{compact ? "Follow-up" : label}</span>
    </span>
  );
}

export function FollowUpActionPanel({
  conversation,
  note,
  saving,
  onNoteChange,
  onSave,
  onClear,
}: {
  conversation: Pick<Conversation, "id" | "needs_follow_up" | "follow_up_note" | "follow_up_at">;
  note: string;
  saving: boolean;
  onNoteChange: (note: string) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px] text-amber-600">flag</span>
          <p className="text-[10px] font-bold text-[#575f67] uppercase" style={{ letterSpacing: "0.06em" }}>Next Action</p>
        </div>
        <FollowUpBadge conversation={conversation} compact />
      </div>
      <textarea
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="Add a short next action for this conversation."
        className="min-h-[76px] w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-slate-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[10px] text-slate-400">Shows as a follow-up cue in the inbox and conversation header.</p>
        <div className="flex shrink-0 items-center gap-2">
          {conversation.needs_follow_up ? (
            <button
              type="button"
              onClick={onClear}
              disabled={saving}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-amber-600 px-3 text-[11px] font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
          >
            {saving ? "Saving..." : conversation.needs_follow_up ? "Update" : "Mark"}
          </button>
        </div>
      </div>
    </div>
  );
}
