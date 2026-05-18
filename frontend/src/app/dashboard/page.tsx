"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { dashboardApi } from "@/lib/api/index";
import type { AgentStat, DashboardStats, DayPoint } from "@/types/chat";

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  surfaceContainer: "#eef2ff",
  outlineVariant: "#E9ECEF",
  onSurface: "#1d1a24",
  secondary: "#575f67",
  primary: "#4338ca",
  primaryContainer: "#4f46e5",
  accent: "#7C4DFF",
};

const CHANNELS = [
  { id: "WHATSAPP", label: "WhatsApp", color: "#25D366", bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  { id: "TELEGRAM", label: "Telegram", color: "#0088CC", bg: "#f0f9ff", text: "#0369a1", border: "#bae6fd" },
  { id: "EMAIL",    label: "Email",    color: "#F97316", bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" },
  { id: "SMS",      label: "SMS",      color: "#8B5CF6", bg: "#f5f3ff", text: "#6d28d9", border: "#ddd6fe" },
  { id: "WEB",      label: "Web Chat", color: "#64748B", bg: "#f8fafc", text: "#475569", border: "#e2e8f0" },
];
const CHANNEL_MAP = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));

// ── Icon ─────────────────────────────────────────────────────────────────────
function Icon({ name, size = 20, fill = 0, color }: {
  name: string; size?: number; fill?: number; color?: string;
}) {
  return (
    <span className="material-symbols-outlined" style={{
      fontSize: size, color, lineHeight: 1,
      fontVariationSettings: `'FILL' ${fill}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
      userSelect: "none",
    }}>
      {name}
    </span>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function NoData({ message = "No data available for this period." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2">
      <Icon name="bar_chart" size={32} color="#cbd5e1" />
      <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center" }}>{message}</p>
    </div>
  );
}

// ── Popover ──────────────────────────────────────────────────────────────────
function Popover({ open, onClose, anchor, align = "left", children, width }: {
  open: boolean; onClose: () => void;
  anchor: React.RefObject<HTMLButtonElement | null>;
  align?: "left" | "right"; children: React.ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          !anchor.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose, anchor]);
  if (!open) return null;
  const alignStyle = align === "right" ? { right: 0 } : { left: 0 };
  return (
    <div ref={ref} style={{
      position: "absolute", top: "calc(100% + 6px)", ...alignStyle, minWidth: width ?? 220,
      background: "white", border: `1px solid ${C.outlineVariant}`, borderRadius: 12,
      boxShadow: "0 12px 32px -8px rgba(15,23,42,0.18), 0 4px 8px -4px rgba(15,23,42,0.08)",
      padding: 6, zIndex: 50,
    }}>
      {children}
    </div>
  );
}

// ── Date range picker ────────────────────────────────────────────────────────
const RANGES = [
  { id: "today", label: "Today",         days: 1  },
  { id: "7d",    label: "Last 7 days",   days: 7  },
  { id: "30d",   label: "Last 30 days",  days: 30 },
  { id: "90d",   label: "Last 90 days",  days: 90 },
  { id: "mtd",   label: "Month to date", days: 30 },
];

function DateRangePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = RANGES.find((r) => r.id === value) ?? RANGES[1];
  return (
    <div style={{ position: "relative" }}>
      <button ref={anchor} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-[10px] bg-white border border-[#E9ECEF] text-[#1d1a24] text-[13px] font-medium cursor-pointer">
        <Icon name="calendar_month" size={16} color="#64748b" />
        {current.label}
        <Icon name="expand_more" size={16} color="#94a3b8" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={200}>
        {RANGES.map((r) => (
          <button key={r.id} onClick={() => { onChange(r.id); setOpen(false); }}
            className="flex items-center justify-between w-full px-[10px] py-2 rounded-lg text-[13px] font-medium cursor-pointer border-none text-left"
            style={{ background: value === r.id ? C.surfaceContainer : "transparent", color: value === r.id ? C.primary : C.onSurface }}>
            <span>{r.label}</span>
            {value === r.id && <Icon name="check" size={16} color={C.primary} />}
          </button>
        ))}
      </Popover>
    </div>
  );
}

// ── Channel filter ────────────────────────────────────────────────────────────
function ChannelFilter({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const isAll = selected.length === 0 || selected.length === CHANNELS.length;
  const label = isAll ? "All channels"
    : selected.length === 1 ? (CHANNEL_MAP[selected[0]]?.label ?? "1 channel")
    : `${selected.length} channels`;
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div style={{ position: "relative" }}>
      <button ref={anchor} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-[10px] bg-white border border-[#E9ECEF] text-[#1d1a24] text-[13px] font-medium cursor-pointer">
        <Icon name="filter_alt" size={16} color="#64748b" />
        {label}
        <Icon name="expand_more" size={16} color="#94a3b8" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={220}>
        {CHANNELS.map((ch) => {
          const on = isAll || selected.includes(ch.id);
          return (
            <button key={ch.id} onClick={() => toggle(ch.id)}
              className="flex items-center gap-[10px] w-full px-[10px] py-2 rounded-lg text-[13px] font-medium cursor-pointer border-none text-left"
              style={{ background: "transparent", color: C.onSurface }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${on ? ch.color : "#cbd5e1"}`, background: on ? ch.color : "white", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {on && <Icon name="check" size={12} color="white" />}
              </span>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: ch.color, flexShrink: 0, display: "inline-block" }} />
              <span className="flex-1">{ch.label}</span>
            </button>
          );
        })}
      </Popover>
    </div>
  );
}

// ── Agent filter ──────────────────────────────────────────────────────────────
function agentInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function AgentFilter({ agents, value, onChange }: {
  agents: AgentStat[]; value: string | null; onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const selected = agents.find((a) => a.id === value) ?? null;
  return (
    <div style={{ position: "relative" }}>
      <button ref={anchor} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 h-9 pl-[6px] pr-3 rounded-[10px] bg-white border border-[#E9ECEF] text-[#1d1a24] text-[13px] font-medium cursor-pointer">
        <span className="flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ width: 22, height: 22, borderRadius: "50%", background: "#ede9fe", color: C.accent }}>
          {selected ? agentInitials(selected.full_name) : "AA"}
        </span>
        {selected ? selected.full_name : "All agents"}
        <Icon name="expand_more" size={16} color="#94a3b8" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={220}>
        <button onClick={() => { onChange(null); setOpen(false); }}
          className="flex items-center gap-[10px] w-full px-[10px] py-2 rounded-lg text-[13px] font-medium cursor-pointer border-none text-left"
          style={{ background: value === null ? C.surfaceContainer : "transparent", color: value === null ? C.primary : C.onSurface }}>
          <span className="flex items-center justify-center text-[10px] font-bold shrink-0"
            style={{ width: 24, height: 24, borderRadius: "50%", background: "#ede9fe", color: C.accent }}>AA</span>
          <span className="flex-1">All agents</span>
          {value === null && <Icon name="check" size={16} color={C.primary} />}
        </button>
        {agents.map((a) => (
          <button key={a.id} onClick={() => { onChange(a.id); setOpen(false); }}
            className="flex items-center gap-[10px] w-full px-[10px] py-2 rounded-lg text-[13px] font-medium cursor-pointer border-none text-left"
            style={{ background: value === a.id ? C.surfaceContainer : "transparent", color: value === a.id ? C.primary : C.onSurface }}>
            <span className="flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ width: 24, height: 24, borderRadius: "50%", background: "#ede9fe", color: C.accent }}>
              {agentInitials(a.full_name)}
            </span>
            <span className="flex-1">{a.full_name}</span>
            {value === a.id && <Icon name="check" size={16} color={C.primary} />}
          </button>
        ))}
      </Popover>
    </div>
  );
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function KPICard({ icon, iconBg, iconColor, value, label, trend, sub, sparkline }: {
  icon: string; iconBg: string; iconColor: string; value: string; label: string;
  trend?: { dir: "up" | "down" | "flat"; value: string } | null; sub?: string; sparkline?: number[];
}) {
  return (
    <div className="bg-white border border-[#E9ECEF] rounded-2xl p-5 flex flex-col gap-[14px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 10, background: iconBg }}>
          <Icon name={icon} size={20} fill={1} color={iconColor} />
        </div>
        {trend && (
          <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{
            background: trend.dir === "up" ? "#f0fdf4" : trend.dir === "down" ? "#fff1f2" : "#f1f5f9",
            color:      trend.dir === "up" ? "#15803d" : trend.dir === "down" ? "#be123c" : "#475569",
          }}>
            <Icon name={trend.dir === "up" ? "trending_up" : trend.dir === "down" ? "trending_down" : "trending_flat"} size={12} />
            {trend.value}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-[10px]">
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.onSurface, lineHeight: 1, marginBottom: 6, letterSpacing: -0.5 }}>{value}</div>
          <div style={{ fontSize: 13, color: C.secondary, fontWeight: 500 }}>{label}</div>
          {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{sub}</div>}
        </div>
        {sparkline && sparkline.length > 1 && (
          <svg width={64} height={28} viewBox="0 0 64 28" style={{ flexShrink: 0 }}>
            <polyline
              points={sparkline.map((v, i) => `${(i / (sparkline.length - 1)) * 64},${28 - (v / Math.max(...sparkline, 1)) * 22 - 3}`).join(" ")}
              fill="none" stroke={iconColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────
function Card({ title, action, children, style }: {
  title: string; action?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div className="bg-white border border-[#E9ECEF] rounded-2xl flex flex-col overflow-hidden" style={style}>
      <div className="flex items-center justify-between px-5 pt-[18px] pb-[10px]">
        <h3 style={{ fontSize: 14, fontWeight: 600, color: C.onSurface, letterSpacing: -0.1 }}>{title}</h3>
        {action}
      </div>
      <div className="flex-1 px-5 pb-5 overflow-hidden">{children}</div>
    </div>
  );
}

// ── Volume chart (Hour / Day / Week) ──────────────────────────────────────────
type VolumeView = "hour" | "day" | "week";

function aggregateWeekly(daily: DayPoint[]): DayPoint[] {
  const weeks: DayPoint[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    weeks.push({ date: chunk[0].date, count: chunk.reduce((s, d) => s + d.count, 0) });
  }
  return weeks;
}

function BarChart({ current, previous, xLabel, yLabel }: {
  current: DayPoint[]; previous: DayPoint[]; xLabel: (d: DayPoint, i: number) => string; yLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!current.length) return <NoData />;

  const allValues = [...current.map((d) => d.count), ...previous.map((d) => d.count)];
  const yMax = Math.ceil(Math.max(...allValues, 1) / 10) * 10;
  const hasPrev = previous.length > 0;

  const W = 720, H = 200, padL = 36, padR = 8, padT = 8, padB = 32;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const groupW = innerW / current.length;
  const barW = hasPrev ? groupW * 0.36 : groupW * 0.55;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={220} style={{ display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const y = padT + innerH * (1 - t);
        return (
          <g key={t}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={t === 0 ? "#cbd5e1" : "#f1f5f9"} strokeWidth={1} />
            <text x={padL - 8} y={y + 4} fontSize={10} fill="#94a3b8" textAnchor="end" fontFamily="Inter">{Math.round(yMax * t)}</text>
          </g>
        );
      })}
      {current.map((d, i) => {
        const prevD = previous[i];
        const barH = (d.count / yMax) * innerH;
        const prevBarH = prevD ? (prevD.count / yMax) * innerH : 0;
        const gx = padL + i * groupW;
        return (
          <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={gx} y={padT} width={groupW} height={innerH} fill="transparent" />
            {hasPrev && prevD && (
              <rect x={gx + groupW * 0.05} y={padT + innerH - prevBarH}
                width={barW} height={Math.max(prevBarH, 1)}
                fill="#e2e8f0" opacity={hover === null || hover === i ? 1 : 0.4} rx={2} />
            )}
            <rect
              x={gx + (hasPrev ? groupW * 0.05 + barW + 3 : groupW * 0.22)}
              y={padT + innerH - barH}
              width={barW} height={Math.max(barH, 1)}
              fill={C.primaryContainer} opacity={hover === null || hover === i ? 1 : 0.4} rx={2}
            />
            {(current.length <= 14 || i % 2 === 0) && (
              <text x={gx + groupW / 2} y={H - 8} fontSize={9} fill="#94a3b8" textAnchor="middle" fontFamily="Inter">
                {xLabel(d, i)}
              </text>
            )}
          </g>
        );
      })}
      {hover !== null && (() => {
        const d = current[hover];
        const prevD = previous[hover];
        const x = padL + hover * groupW + groupW / 2;
        const y = padT + innerH - (d.count / yMax) * innerH - 14;
        const txt = prevD ? `${d.count} / ${prevD.count}` : String(d.count);
        const w = prevD ? 72 : 52;
        return (
          <g>
            <rect x={x - w / 2} y={y - 16} width={w} height={20} rx={6} fill="#0f172a" />
            <text x={x} y={y - 2} fontSize={11} fill="white" textAnchor="middle" fontFamily="Inter" fontWeight={600}>{txt}</text>
          </g>
        );
      })()}
      <text x={W - padR} y={H - 2} fontSize={9} fill="#94a3b8" textAnchor="end" fontFamily="Inter">{yLabel}</text>
    </svg>
  );
}

function VolumeChart({ daily, prevDaily }: { daily: DayPoint[]; prevDaily: DayPoint[] }) {
  const [view, setView] = useState<VolumeView>("day");

  const fmtDay  = (d: DayPoint, _i: number) => { const dt = new Date(d.date + "T00:00:00"); return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }); };
  const fmtWeek = (_d: DayPoint, i: number) => `W${i + 1}`;

  const weekly     = useMemo(() => aggregateWeekly(daily), [daily]);
  const prevWeekly = useMemo(() => aggregateWeekly(prevDaily), [prevDaily]);

  const legend = (
    <div className="flex items-center gap-4 mb-1.5">
      <div className="inline-flex items-center gap-1.5" style={{ fontSize: 11, color: C.secondary, fontWeight: 500 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: C.primaryContainer, display: "inline-block" }} />
        Current period
      </div>
      {(view === "day" ? prevDaily : prevWeekly).length > 0 && (
        <div className="inline-flex items-center gap-1.5" style={{ fontSize: 11, color: C.secondary, fontWeight: 500 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: "#e2e8f0", display: "inline-block" }} />
          Previous period
        </div>
      )}
    </div>
  );

  return (
    <div>
      {legend}
      {view === "hour" && <NoData message="Hourly breakdown is not available for this period." />}
      {view === "day"  && <BarChart current={daily}  previous={prevDaily}  xLabel={fmtDay}  yLabel="conversations · per day" />}
      {view === "week" && (weekly.length === 0
        ? <NoData />
        : <BarChart current={weekly} previous={prevWeekly} xLabel={fmtWeek} yLabel="conversations · per week" />
      )}
    </div>
  );
}

// ── Channel donut ─────────────────────────────────────────────────────────────
function ChannelDonut({ channels }: { channels: Record<string, number> }) {
  const data = useMemo(() => Object.entries(channels)
    .map(([id, value]) => { const ch = CHANNEL_MAP[id.toUpperCase()]; return ch ? { ...ch, value } : null; })
    .filter((d): d is NonNullable<typeof d> => d !== null && d.value > 0)
    .sort((a, b) => b.value - a.value), [channels]);

  if (!data.length) return <NoData />;

  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 64, r = 44, cx = 90, cy = 90;
  let cursor = -90;
  const arcs = data.map((d) => {
    const pct = d.value / total;
    const start = cursor, end = cursor + pct * 360;
    cursor = end;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const [x1, y1] = [cx + R * Math.cos(rad(start)), cy + R * Math.sin(rad(start))];
    const [x2, y2] = [cx + R * Math.cos(rad(end)),   cy + R * Math.sin(rad(end))];
    const [x3, y3] = [cx + r * Math.cos(rad(end)),   cy + r * Math.sin(rad(end))];
    const [x4, y4] = [cx + r * Math.cos(rad(start)), cy + r * Math.sin(rad(start))];
    return { ...d, pct, path: `M ${x1} ${y1} A ${R} ${R} 0 ${pct > 0.5 ? 1 : 0} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${pct > 0.5 ? 1 : 0} 0 ${x4} ${y4} Z` };
  });

  return (
    <div className="flex items-center gap-4">
      <svg width={180} height={180} viewBox="0 0 180 180" style={{ flexShrink: 0 }}>
        {arcs.map((a) => <path key={a.id} d={a.path} fill={a.color} />)}
        <text x={cx} y={cy - 4} fontSize={26} fontWeight={700} fill={C.onSurface} textAnchor="middle" fontFamily="Inter">{total}</text>
        <text x={cx} y={cy + 14} fontSize={10} fill="#94a3b8" textAnchor="middle" fontFamily="Inter" letterSpacing={0.8}>TOTAL</text>
      </svg>
      <div className="flex-1 flex flex-col gap-2">
        {data.map((d) => (
          <div key={d.id} className="flex items-center gap-2" style={{ fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0, display: "inline-block" }} />
            <span className="flex-1" style={{ color: C.secondary, fontWeight: 500 }}>{d.label}</span>
            <span style={{ color: C.onSurface, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Status funnel ─────────────────────────────────────────────────────────────
function StatusFunnel({ stats }: { stats: DashboardStats | null }) {
  const stages = [
    { id: "open",    label: "Open",          value: stats?.open_conversations ?? 0,    color: "#7C4DFF", bg: "#f5f3ff", icon: "mark_chat_unread" },
    { id: "pending", label: "Pending reply", value: stats?.pending_conversations ?? 0, color: "#F59E0B", bg: "#fffbeb", icon: "schedule" },
    { id: "closed",  label: "Closed",        value: stats?.closed_conversations ?? 0,  color: "#10B981", bg: "#ecfdf5", icon: "check_circle" },
    { id: "risk",    label: "SLA at risk",   value: stats?.sla_at_risk ?? 0,           color: "#EF4444", bg: "#fef2f2", icon: "warning" },
  ];
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="flex flex-col gap-3">
      {stages.map((s) => (
        <div key={s.id} className="flex items-center gap-3">
          <div className="flex items-center justify-center shrink-0" style={{ width: 32, height: 32, borderRadius: 8, background: s.bg }}>
            <Icon name={s.icon} size={16} fill={1} color={s.color} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between mb-1">
              <span style={{ fontSize: 12, color: C.secondary, fontWeight: 500 }}>{s.label}</span>
              <span style={{ fontSize: 14, color: C.onSurface, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{s.value.toLocaleString()}</span>
            </div>
            <div style={{ height: 6, background: "#f1f5f9", borderRadius: 100, overflow: "hidden" }}>
              <div style={{ width: `${(s.value / max) * 100}%`, height: "100%", background: s.color, borderRadius: 100 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Peak hours heatmap ────────────────────────────────────────────────────────
// No hourly API endpoint exists yet — shows empty state.
function Heatmap() {
  return <NoData message="Hourly message data is not available yet." />;
}

// ── Agent table ───────────────────────────────────────────────────────────────
function AgentTable({ agents }: { agents: AgentStat[] }) {
  if (!agents.length) return <NoData message="No agent data for this period." />;
  const initials = (name: string) => name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="overflow-x-auto">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Agent", "Handled", "Resolved", "Resolution", "Avg response"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "6px 8px 10px", fontSize: 11, fontWeight: 700, color: C.secondary, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${C.outlineVariant}` }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agents.map((a, i) => (
            <tr key={a.id} style={{ borderBottom: i === agents.length - 1 ? "none" : `1px solid ${C.outlineVariant}` }}>
              <td style={{ padding: "10px 8px" }}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center shrink-0 text-[11px] font-bold"
                    style={{ width: 28, height: 28, borderRadius: "50%", background: "#ede9fe", color: C.accent }}>
                    {initials(a.full_name)}
                  </div>
                  <span style={{ fontWeight: 500, color: C.onSurface }}>{a.full_name}</span>
                </div>
              </td>
              <td style={{ padding: "10px 8px", color: C.onSurface, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{a.conversations_handled.toLocaleString()}</td>
              <td style={{ padding: "10px 8px", color: C.onSurface, fontVariantNumeric: "tabular-nums" }}>{a.resolved.toLocaleString()}</td>
              <td style={{ padding: "10px 8px" }}>
                <div className="flex items-center gap-2">
                  <div style={{ height: 4, width: 56, background: "#f1f5f9", borderRadius: 100, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(a.resolution_rate, 100)}%`, height: "100%", background: "#10B981", borderRadius: 100 }} />
                  </div>
                  <span style={{ fontSize: 12, color: C.onSurface, fontVariantNumeric: "tabular-nums" }}>{Math.round(a.resolution_rate)}%</span>
                </div>
              </td>
              <td style={{ padding: "10px 8px", color: C.secondary, fontVariantNumeric: "tabular-nums" }}>
                {a.avg_first_response_min != null ? `${Math.round(a.avg_first_response_min)} min` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Queue by channel ──────────────────────────────────────────────────────────
function QueueByChannel({ queue }: { queue: Record<string, number> }) {
  const entries = useMemo(() => Object.entries(queue)
    .map(([id, value]) => { const ch = CHANNEL_MAP[id.toUpperCase()]; return { id, label: ch?.label ?? id, color: ch?.color ?? "#64748B", value }; })
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value), [queue]);

  if (!entries.length) return <NoData message="No queued conversations." />;
  const max = Math.max(...entries.map((e) => e.value), 1);
  return (
    <div className="flex flex-col gap-[10px]">
      {entries.map((e) => (
        <div key={e.id}>
          <div className="flex justify-between mb-1">
            <span style={{ fontSize: 12, color: C.onSurface, fontWeight: 500 }}>{e.label}</span>
            <span style={{ fontSize: 12, color: C.secondary, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{e.value.toLocaleString()}</span>
          </div>
          <div style={{ height: 8, background: "#f1f5f9", borderRadius: 100, overflow: "hidden" }}>
            <div style={{ width: `${(e.value / max) * 100}%`, height: "100%", background: e.color, borderRadius: 100 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Recent activity ───────────────────────────────────────────────────────────
// No real-time feed API exists yet — shows empty state.
function RecentActivity() {
  return <NoData message="Recent activity feed is not available yet." />;
}

// ── Top tags ──────────────────────────────────────────────────────────────────
// No tag analytics API exists yet — shows empty state.
function TopTags() {
  return <NoData message="Tag analytics are not available yet." />;
}

// ── AI insights ───────────────────────────────────────────────────────────────
function AIInsights({ stats }: { stats: DashboardStats | null }) {
  if (!stats) return <NoData />;

  const items = [
    { label: "AI suggestions generated", value: stats.ai_suggestions_generated.toLocaleString(), icon: "auto_awesome", color: "#7C4DFF", bg: "#f5f3ff" },
    { label: "Conversations with AI",    value: stats.convs_with_ai.toLocaleString(),            icon: "smart_toy",    color: "#3B82F6", bg: "#eff6ff" },
    { label: "AI adoption rate",         value: `${stats.ai_adoption_pct.toFixed(1)}%`,          icon: "insights",     color: "#10B981", bg: "#ecfdf5" },
    { label: "Overall resolution rate",  value: `${(stats.resolution_rate * 100).toFixed(1)}%`,  icon: "check_circle", color: "#F59E0B", bg: "#fffbeb" },
  ];
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-3">
          <div className="flex items-center justify-center shrink-0" style={{ width: 32, height: 32, borderRadius: 8, background: it.bg }}>
            <Icon name={it.icon} size={16} fill={1} color={it.color} />
          </div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 11, color: C.secondary, fontWeight: 500 }}>{it.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.onSurface, fontVariantNumeric: "tabular-nums", lineHeight: 1.3 }}>{it.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Segmented control ─────────────────────────────────────────────────────────
function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 p-[3px] bg-slate-100 rounded-lg">
      {options.map((opt) => (
        <button key={opt.id} onClick={() => onChange(opt.id)} style={{
          padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer",
          background: value === opt.id ? "white" : "transparent",
          color: value === opt.id ? C.primary : C.secondary,
          boxShadow: value === opt.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
        }}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats]                 = useState<DashboardStats | null>(null);
  const [loading, setLoading]             = useState(true);
  const [range, setRange]                 = useState("7d");
  const [channelFilter, setChannelFilter] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [volumeView, setVolumeView]       = useState<VolumeView>("day");

  useEffect(() => {
    let active = true;
    const days = RANGES.find((r) => r.id === range)?.days ?? 7;
    setLoading(true);
    void dashboardApi.getDashboardStats(days).then((data) => {
      if (active) { setStats(data); setLoading(false); }
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range]);

  const pctTrend = (cur: number, prev: number): { dir: "up" | "down" | "flat"; value: string } | null => {
    if (!prev) return null;
    const diff = Math.round(((cur - prev) / prev) * 100);
    return { dir: diff > 0 ? "up" : diff < 0 ? "down" : "flat", value: `${Math.abs(diff)}%` };
  };

  const convTrend = stats ? pctTrend(stats.current_period_conversations, stats.prev_period_conversations) : null;
  const msgTrend  = stats ? pctTrend(stats.current_period_messages, stats.prev_period_messages) : null;

  return (
    <>
      <style>{`@keyframes pulse-live{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.85)}}`}</style>
      <div className="flex flex-col h-full overflow-hidden">

        {/* ── Header ── */}
        <header className="h-16 border-b border-[#E9ECEF] bg-white flex items-center px-6 gap-4 shrink-0">
          <div className="flex-1 min-w-0">
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.onSurface, letterSpacing: -0.2 }}>Dashboard</h1>
            <div className="inline-flex items-center gap-1.5 mt-0.5" style={{ fontSize: 12, color: "#94a3b8" }}>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" style={{ animation: "pulse-live 1.6s infinite" }} />
                Live
              </span>
              <span>·</span>
              <span>Updated just now</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ChannelFilter selected={channelFilter} onChange={setChannelFilter} />
            <AgentFilter agents={stats?.agent_stats ?? []} value={selectedAgent} onChange={setSelectedAgent} />
            <DateRangePicker value={range} onChange={setRange} />
            <div className="w-px h-6 bg-[#E9ECEF] mx-1" />
            <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] bg-white border border-[#E9ECEF] text-[#1d1a24] text-[13px] font-medium cursor-pointer">
              <Icon name="file_download" size={16} color="#64748b" />
              Export
            </button>
          </div>
        </header>

        {/* ── Body ── */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#f8fafc] scrollbar-hide">
          {loading && (
            <div className="flex items-center justify-center h-32 text-sm text-slate-500">
              <span className="material-symbols-outlined mr-2 animate-spin text-[20px] text-indigo-600">progress_activity</span>
              Loading…
            </div>
          )}

          {/* KPI row */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <KPICard icon="forum" iconBg="#f5f3ff" iconColor="#7C4DFF"
              value={(stats?.current_period_conversations ?? 0).toLocaleString()}
              label="Total conversations" trend={convTrend} sub="vs. previous period"
              sparkline={stats?.daily_conversations?.map((d) => d.count) ?? []} />
            <KPICard icon="chat_bubble" iconBg="#eff6ff" iconColor="#3B82F6"
              value={(stats?.messages_today ?? 0).toLocaleString()}
              label="Messages today" trend={msgTrend} sub="Across all channels"
              sparkline={stats?.daily_messages?.map((d) => d.count) ?? []} />
            <KPICard icon="mark_chat_unread" iconBg="#fff7ed" iconColor="#F97316"
              value={(stats?.unread_conversations ?? 0).toLocaleString()}
              label="Unread conversations"
              sub={stats ? `${stats.sla_at_risk} SLA at risk · ${stats.unassigned_open} unassigned` : undefined} />
            <KPICard icon="timer" iconBg="#ecfdf5" iconColor="#10B981"
              value={stats?.avg_first_response_minutes != null ? `${Math.round(stats.avg_first_response_minutes)} min` : "—"}
              label="Avg first response"
              sub={stats?.avg_resolution_hours != null ? `Avg resolution: ${stats.avg_resolution_hours.toFixed(1)}h` : undefined} />
          </div>

          {/* Row 1: Volume + Donut */}
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <Card title="Conversation volume"
              action={
                <SegmentedControl<VolumeView>
                  options={[{ id: "hour", label: "Hour" }, { id: "day", label: "Day" }, { id: "week", label: "Week" }]}
                  value={volumeView}
                  onChange={setVolumeView}
                />
              }>
              <VolumeChart
                daily={stats?.daily_conversations ?? []}
                prevDaily={stats?.prev_daily_conversations ?? []}
              />
            </Card>
            <Card title="Conversations by channel" action={<Icon name="more_horiz" size={18} color="#94a3b8" />}>
              <ChannelDonut channels={stats?.channels ?? {}} />
            </Card>
          </div>

          {/* Row 2: Peak hours + Status funnel */}
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <Card title="Peak hours" action={<span style={{ fontSize: 11, color: "#94a3b8" }}>Last 7 days · message volume</span>}>
              <Heatmap />
            </Card>
            <Card title="Status funnel" action={<Icon name="more_horiz" size={18} color="#94a3b8" />}>
              <StatusFunnel stats={stats} />
            </Card>
          </div>

          {/* Row 3: Agent table + Queue */}
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <Card title="Agent performance" action={<span style={{ fontSize: 11, color: "#94a3b8" }}>This period</span>}>
              <AgentTable agents={stats?.agent_stats ?? []} />
            </Card>
            <Card title="Queue by channel" action={<span style={{ fontSize: 11, color: "#94a3b8" }}>Open · waiting for reply</span>}>
              <QueueByChannel queue={stats?.queue_by_channel ?? {}} />
            </Card>
          </div>

          {/* Row 4: Recent activity + Top tags + AI insights */}
          <div className="grid gap-4" style={{ gridTemplateColumns: "5fr 4fr 3fr" }}>
            <Card title="Recent activity"
              action={<span style={{ fontSize: 12, color: C.primary, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 2 }}>
                View all <Icon name="chevron_right" size={14} color={C.primary} />
              </span>}>
              <RecentActivity />
            </Card>
            <Card title="Top tags" action={<span style={{ fontSize: 11, color: "#94a3b8" }}>by volume</span>}>
              <TopTags />
            </Card>
            <Card title="AI Insights"
              action={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: C.accent, background: "#f5f3ff", border: "1px solid #ddd6fe", padding: "2px 8px", borderRadius: 100 }}>
                  <Icon name="auto_awesome" size={11} fill={1} color={C.accent} />
                  BETA
                </span>
              }>
              <AIInsights stats={stats} />
            </Card>
          </div>
        </main>
      </div>
    </>
  );
}
