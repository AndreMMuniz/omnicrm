"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { dashboardApi } from "@/lib/api/index";
import type { DashboardStats } from "@/types/chat";

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  surface: "#f8fafc",
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
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        color,
        lineHeight: 1,
        fontVariationSettings: `'FILL' ${fill}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
        userSelect: "none",
      }}
    >
      {name}
    </span>
  );
}

// ── Popover ──────────────────────────────────────────────────────────────────
function Popover({ open, onClose, anchor, align = "left", children, width }: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLButtonElement | null>;
  align?: "left" | "right";
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        !anchor.current?.contains(e.target as Node)
      ) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onClose, anchor]);
  if (!open) return null;
  const alignStyle = align === "right" ? { right: 0 } : { left: 0 };
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        ...alignStyle,
        minWidth: width ?? 220,
        background: "white",
        border: `1px solid ${C.outlineVariant}`,
        borderRadius: 12,
        boxShadow: "0 12px 32px -8px rgba(15,23,42,0.18), 0 4px 8px -4px rgba(15,23,42,0.08)",
        padding: 6,
        zIndex: 50,
      }}
    >
      {children}
    </div>
  );
}

// ── Date range picker ────────────────────────────────────────────────────────
const RANGES = [
  { id: "today", label: "Today" },
  { id: "7d",    label: "Last 7 days" },
  { id: "30d",   label: "Last 30 days" },
  { id: "90d",   label: "Last 90 days" },
  { id: "mtd",   label: "Month to date" },
];

function DateRangePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = RANGES.find((r) => r.id === value) ?? RANGES[1];
  return (
    <div style={{ position: "relative" }}>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-[10px] bg-white border border-[#E9ECEF] text-[#1d1a24] text-[13px] font-medium cursor-pointer"
      >
        <Icon name="calendar_month" size={16} color="#64748b" />
        {current.label}
        <Icon name="expand_more" size={16} color="#94a3b8" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={200}>
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => { onChange(r.id); setOpen(false); }}
            className="flex items-center justify-between w-full px-[10px] py-2 rounded-lg text-[13px] font-medium cursor-pointer border-none text-left"
            style={{
              background: value === r.id ? C.surfaceContainer : "transparent",
              color: value === r.id ? C.primary : C.onSurface,
            }}
          >
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
  const label = isAll
    ? "All channels"
    : selected.length === 1
      ? CHANNEL_MAP[selected[0]]?.label ?? "1 channel"
      : `${selected.length} channels`;
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };
  return (
    <div style={{ position: "relative" }}>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 h-9 px-3 rounded-[10px] bg-white border border-[#E9ECEF] text-[#1d1a24] text-[13px] font-medium cursor-pointer"
      >
        <Icon name="filter_alt" size={16} color="#64748b" />
        {label}
        <Icon name="expand_more" size={16} color="#94a3b8" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} width={220}>
        {CHANNELS.map((ch) => {
          const on = isAll || selected.includes(ch.id);
          return (
            <button
              key={ch.id}
              onClick={() => toggle(ch.id)}
              className="flex items-center gap-[10px] w-full px-[10px] py-2 rounded-lg text-[13px] font-medium cursor-pointer border-none text-left"
              style={{ background: "transparent", color: C.onSurface }}
            >
              <span style={{
                width: 16, height: 16, borderRadius: 4,
                border: `1.5px solid ${on ? ch.color : "#cbd5e1"}`,
                background: on ? ch.color : "white",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
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

// ── KPI card ─────────────────────────────────────────────────────────────────
function KPICard({ icon, iconBg, iconColor, value, label, trend, sub, sparkline }: {
  icon: string;
  iconBg: string;
  iconColor: string;
  value: string;
  label: string;
  trend?: { dir: "up" | "down" | "flat"; value: string } | null;
  sub?: string;
  sparkline?: number[];
}) {
  return (
    <div className="bg-white border border-[#E9ECEF] rounded-2xl p-5 flex flex-col gap-[14px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 10, background: iconBg }}>
          <Icon name={icon} size={20} fill={1} color={iconColor} />
        </div>
        {trend && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={{
              background: trend.dir === "up" ? "#f0fdf4" : trend.dir === "down" ? "#fff1f2" : "#f1f5f9",
              color: trend.dir === "up" ? "#15803d" : trend.dir === "down" ? "#be123c" : "#475569",
            }}
          >
            <Icon
              name={trend.dir === "up" ? "trending_up" : trend.dir === "down" ? "trending_down" : "trending_flat"}
              size={12}
            />
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
              points={sparkline
                .map((v, i) => `${(i / (sparkline.length - 1)) * 64},${28 - (v / Math.max(...sparkline, 1)) * 22 - 3}`)
                .join(" ")}
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
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="bg-white border border-[#E9ECEF] rounded-2xl flex flex-col overflow-hidden" style={style}>
      <div className="flex items-center justify-between px-5 pt-[18px] pb-[10px]">
        <h3 style={{ fontSize: 14, fontWeight: 600, color: C.onSurface, letterSpacing: -0.1 }}>{title}</h3>
        {action}
      </div>
      <div className="flex-1 px-5 pb-5 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

// ── Volume chart ──────────────────────────────────────────────────────────────
function VolumeChart() {
  const hours = ["8a", "9a", "10a", "11a", "12p", "1p", "2p", "3p", "4p", "5p", "6p", "7p"];
  const rng = (s: number) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
  const series = useMemo(() => [
    { id: "WHATSAPP", data: hours.map((_, i) => 18 + rng(i + 1) * 38) },
    { id: "TELEGRAM", data: hours.map((_, i) => 8 + rng(i + 100) * 22) },
    { id: "EMAIL",    data: hours.map((_, i) => 14 + rng(i + 200) * 18) },
    { id: "SMS",      data: hours.map((_, i) => 4 + rng(i + 300) * 12) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);
  const totals = hours.map((_, i) => series.reduce((s, ch) => s + ch.data[i], 0));
  const yMax = Math.ceil(Math.max(...totals) / 20) * 20;
  const [hover, setHover] = useState<number | null>(null);

  const W = 720, H = 220, padL = 36, padR = 8, padT = 8, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const barW = (innerW / hours.length) * 0.55;
  const gap = innerW / hours.length - barW;

  return (
    <div>
      <div className="flex items-center gap-4 flex-wrap mb-1.5">
        {series.map((s) => {
          const ch = CHANNEL_MAP[s.id]!;
          return (
            <div key={s.id} className="inline-flex items-center gap-1.5" style={{ fontSize: 11, color: C.secondary, fontWeight: 500 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: ch.color, display: "inline-block" }} />
              {ch.label}
            </div>
          );
        })}
        <div style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>Conversations · per hour</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={240} style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + innerH * (1 - t);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={t === 0 ? "#cbd5e1" : "#f1f5f9"} strokeWidth={1} />
              <text x={padL - 8} y={y + 4} fontSize={10} fill="#94a3b8" textAnchor="end" fontFamily="Inter">{Math.round(yMax * t)}</text>
            </g>
          );
        })}
        {hours.map((h, i) => {
          const x = padL + i * (innerW / hours.length) + gap / 2;
          let yCursor = padT + innerH;
          return (
            <g key={h} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * (innerW / hours.length)} y={padT} width={innerW / hours.length} height={innerH} fill="transparent" />
              {series.map((s) => {
                const v = s.data[i];
                const segH = (v / yMax) * innerH;
                yCursor -= segH;
                const ch = CHANNEL_MAP[s.id]!;
                return (
                  <rect key={s.id} x={x} y={yCursor} width={barW} height={segH}
                    fill={ch.color} opacity={hover === null || hover === i ? 1 : 0.4}
                  />
                );
              })}
              <text x={x + barW / 2} y={H - 10} fontSize={10} fill="#94a3b8" textAnchor="middle" fontFamily="Inter">{h}</text>
            </g>
          );
        })}
        {hover !== null && (() => {
          const x = padL + hover * (innerW / hours.length) + gap / 2 + barW / 2;
          const total = totals[hover];
          const y = padT + innerH - (total / yMax) * innerH - 12;
          return (
            <g>
              <rect x={x - 26} y={y - 16} width={52} height={20} rx={6} fill="#0f172a" />
              <text x={x} y={y - 2} fontSize={11} fill="white" textAnchor="middle" fontFamily="Inter" fontWeight={600}>{Math.round(total)} msg</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ── Channel donut ─────────────────────────────────────────────────────────────
function ChannelDonut({ channels }: { channels: Record<string, number> }) {
  const data = useMemo(() => {
    const fromApi = CHANNELS.map((ch) => ({
      ...ch,
      value: channels[ch.id] ?? channels[ch.id.toLowerCase()] ?? 0,
    })).filter((d) => d.value > 0);
    if (fromApi.length > 0) return fromApi;
    // fallback mock
    return [
      { ...CHANNEL_MAP["WHATSAPP"]!, value: 42 },
      { ...CHANNEL_MAP["TELEGRAM"]!, value: 22 },
      { ...CHANNEL_MAP["EMAIL"]!,    value: 18 },
      { ...CHANNEL_MAP["SMS"]!,      value: 12 },
      { ...CHANNEL_MAP["WEB"]!,      value: 6  },
    ];
  }, [channels]);

  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 64, r = 44, cx = 90, cy = 90;
  let cursor = -90;
  const arcs = data.map((d) => {
    const pct = d.value / total;
    const start = cursor, end = cursor + pct * 360;
    cursor = end;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const x1 = cx + R * Math.cos(toRad(start)), y1 = cy + R * Math.sin(toRad(start));
    const x2 = cx + R * Math.cos(toRad(end)),   y2 = cy + R * Math.sin(toRad(end));
    const x3 = cx + r * Math.cos(toRad(end)),   y3 = cy + r * Math.sin(toRad(end));
    const x4 = cx + r * Math.cos(toRad(start)), y4 = cy + r * Math.sin(toRad(start));
    const large = pct > 0.5 ? 1 : 0;
    return {
      id: d.id, color: d.color, label: d.label, value: d.value, pct,
      path: `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${large} 0 ${x4} ${y4} Z`,
    };
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
    { id: "open",    label: "Open",          value: stats?.open_conversations ?? 247,      color: "#7C4DFF", bg: "#f5f3ff", icon: "mark_chat_unread" },
    { id: "pending", label: "Pending reply", value: stats?.pending_conversations ?? 84,    color: "#F59E0B", bg: "#fffbeb", icon: "schedule" },
    { id: "closed",  label: "Closed today",  value: stats?.closed_conversations ?? 196,    color: "#10B981", bg: "#ecfdf5", icon: "check_circle" },
    { id: "risk",    label: "SLA at risk",   value: stats?.sla_at_risk ?? 12,              color: "#EF4444", bg: "#fef2f2", icon: "warning" },
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
              <span style={{ fontSize: 14, color: C.onSurface, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {s.value.toLocaleString()}
              </span>
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

// ── Heatmap ───────────────────────────────────────────────────────────────────
function Heatmap() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hours = ["12a", "2a", "4a", "6a", "8a", "10a", "12p", "2p", "4p", "6p", "8p", "10p"];
  const data = useMemo(() => days.map((_, di) => hours.map((_, hi) => {
    const isWeekend = di >= 5;
    const dayFactor = isWeekend ? 0.5 : 1;
    const hourFactor = Math.max(0.1, 1 - Math.pow((hi - 8) / 6, 2));
    const rr = Math.sin(di * 7 + hi * 13) * 10000;
    const noise = (rr - Math.floor(rr)) * 0.35 + 0.65;
    return Math.round(dayFactor * hourFactor * noise * 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), []);
  const max = Math.max(...data.flat(), 1);
  const tint = (v: number) => {
    if (v / max < 0.05) return "#f8fafc";
    const t = v / max;
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
    return `rgb(${lerp(245, 124)},${lerp(243, 77)},${lerp(255, 255)})`;
  };
  const [hover, setHover] = useState<{ di: number; hi: number; v: number } | null>(null);

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-3" style={{ fontSize: 11, color: "#94a3b8" }}>
        <span>Less</span>
        {[0.1, 0.3, 0.55, 0.8, 1].map((t) => (
          <span key={t} style={{ width: 14, height: 14, borderRadius: 3, background: tint(t * max), display: "inline-block" }} />
        ))}
        <span>More</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "40px 1fr", gap: 4 }}>
        <div />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 4, marginBottom: 4 }}>
          {hours.map((h, i) => (
            <div key={i} style={{ fontSize: 10, color: "#94a3b8", textAlign: "center" }}>
              {i % 2 === 0 ? h : ""}
            </div>
          ))}
        </div>
        {days.map((d, di) => (
          <React.Fragment key={d}>
            <div style={{ fontSize: 11, color: C.secondary, fontWeight: 500, display: "flex", alignItems: "center" }}>{d}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 4 }}>
              {data[di].map((v, hi) => (
                <div
                  key={hi}
                  onMouseEnter={() => setHover({ di, hi, v })}
                  onMouseLeave={() => setHover(null)}
                  style={{
                    aspectRatio: "1.6", borderRadius: 4, background: tint(v), cursor: "pointer",
                    border: hover?.di === di && hover?.hi === hi
                      ? `1.5px solid ${C.accent}`
                      : "1px solid rgba(0,0,0,0.02)",
                  }}
                  title={`${d} ${hours[hi]} · ${v} msg`}
                />
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="flex items-center justify-between mt-[10px]" style={{ fontSize: 11, color: "#94a3b8" }}>
        <span>
          {hover ? `${days[hover.di]} · ${hours[hover.hi]} · ${hover.v} messages` : "Hover a cell for details"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Icon name="local_fire_department" size={12} color="#F59E0B" />
          Peak: Tue 2p · 96 msg
        </span>
      </div>
    </div>
  );
}

// ── Tags bar ──────────────────────────────────────────────────────────────────
const TAGS = [
  { label: "Billing",  value: 184, color: "#F59E0B" },
  { label: "Support",  value: 156, color: "#3B82F6" },
  { label: "Sales",    value: 112, color: "#10B981" },
  { label: "Feedback", value: 78,  color: "#8B5CF6" },
  { label: "Refund",   value: 64,  color: "#EF4444" },
  { label: "General",  value: 49,  color: "#64748B" },
];

function TagsBar() {
  const max = Math.max(...TAGS.map((t) => t.value));
  return (
    <div className="flex flex-col gap-[10px]">
      {TAGS.map((t) => (
        <div key={t.label}>
          <div className="flex justify-between mb-1">
            <span style={{ fontSize: 12, color: C.onSurface, fontWeight: 500 }}>{t.label}</span>
            <span style={{ fontSize: 12, color: C.secondary, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{t.value}</span>
          </div>
          <div style={{ height: 8, background: "#f1f5f9", borderRadius: 100, overflow: "hidden" }}>
            <div style={{ width: `${(t.value / max) * 100}%`, height: "100%", background: t.color, borderRadius: 100 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Activity feed ─────────────────────────────────────────────────────────────
const ACTIVITY_ITEMS = [
  { kind: "reply",  who: "Mariana Costa", initials: "MC", avatarBg: "#fef3c7", avatarColor: "#92400e", time: "2m ago",  channel: "WHATSAPP", text: "replied to Rafael Oliveira",       preview: '"I\'m escalating this to the shipping team…"' },
  { kind: "open",   who: "Diego Almeida", initials: "DA", avatarBg: "#dbeafe", avatarColor: "#1d4ed8", time: "5m ago",  channel: "TELEGRAM", text: "picked up Ana Lima",               preview: "Tag: Support · Priority: medium" },
  { kind: "sla",    who: "System",        initials: "S",  avatarBg: "#fee2e2", avatarColor: "#b91c1c", time: "8m ago",  channel: "EMAIL",    text: "SLA breach — Carlos Mendez",      preview: "Pending reply for 4h 12m" },
  { kind: "close",  who: "Patricia Lin",  initials: "PL", avatarBg: "#dcfce7", avatarColor: "#15803d", time: "14m ago", channel: "SMS",      text: "closed Sofia Carvalho",           preview: "Resolved — Pricing inquiry" },
  { kind: "ai",     who: "AI Assistant",  initials: "AI", avatarBg: "#ede9fe", avatarColor: "#7C4DFF", time: "17m ago", channel: "TELEGRAM", text: "suggested reply for Marco Reyes", preview: '"We offer a 14-day free trial…"' },
  { kind: "assign", who: "Lucas Vieira",  initials: "LV", avatarBg: "#fce7f3", avatarColor: "#be185d", time: "22m ago", channel: "WHATSAPP", text: "assigned to Beatriz Souza",       preview: "Moved from queue → Lucas Vieira" },
];
const KIND_ICON: Record<string, string>  = { reply: "reply", open: "mark_chat_unread", sla: "warning", close: "check_circle", ai: "auto_awesome", assign: "swap_horiz" };
const KIND_COLOR: Record<string, string> = { reply: "#4f46e5", open: "#F59E0B", sla: "#EF4444", close: "#10B981", ai: "#7C4DFF", assign: "#0EA5E9" };

function ActivityFeed() {
  return (
    <div className="flex flex-col">
      {ACTIVITY_ITEMS.map((it, i) => {
        const ch = CHANNEL_MAP[it.channel]!;
        return (
          <div key={i} className="flex gap-3 py-[10px]"
            style={{ borderBottom: i === ACTIVITY_ITEMS.length - 1 ? "none" : `1px solid ${C.outlineVariant}` }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div
                className="flex items-center justify-center text-[11px] font-bold"
                style={{ width: 32, height: 32, borderRadius: "50%", background: it.avatarBg, color: it.avatarColor }}
              >
                {it.initials}
              </div>
              <div
                className="flex items-center justify-center absolute"
                style={{ bottom: -2, right: -2, width: 16, height: 16, borderRadius: "50%", background: "white", border: "1.5px solid white" }}
              >
                <span className="flex items-center justify-center"
                  style={{ width: 12, height: 12, borderRadius: "50%", background: KIND_COLOR[it.kind] ?? "#64748b" }}>
                  <Icon name={KIND_ICON[it.kind] ?? "info"} size={8} fill={1} color="white" />
                </span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <div style={{ fontSize: 13, color: C.onSurface, lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600 }}>{it.who}</span>
                  <span style={{ color: C.secondary }}> {it.text}</span>
                </div>
                <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{it.time}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: ch.bg, color: ch.text, border: `1px solid ${ch.border}`, borderRadius: 100, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: ch.color, display: "inline-block" }} />
                  {ch.label}
                </span>
                <span style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.preview}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── AI insights ───────────────────────────────────────────────────────────────
const AI_ITEMS = [
  { tone: "warning",  icon: "warning",      title: "Email backlog rising",  text: "Email response time is up 28% vs. last week. Consider reassigning 2 agents." },
  { tone: "positive", icon: "trending_up",  title: "WhatsApp resolution ↑", text: "CSAT for WhatsApp tickets reached 94% — your best in 30 days." },
  { tone: "info",     icon: "auto_awesome", title: "Suggested macro",       text: '"Order tracking" template would have applied to 18 conversations today.' },
];
const TONES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  warning:  { bg: "#fffbeb", border: "#fde68a", text: "#92400e", icon: "#F59E0B" },
  positive: { bg: "#ecfdf5", border: "#bbf7d0", text: "#15803d", icon: "#10B981" },
  info:     { bg: "#f5f3ff", border: "#ddd6fe", text: "#6d28d9", icon: "#7C4DFF" },
};

function AIInsights() {
  return (
    <div className="flex flex-col gap-[10px]">
      {AI_ITEMS.map((it, i) => {
        const t = TONES[it.tone]!;
        return (
          <div key={i} style={{ display: "flex", gap: 10, padding: 12, borderRadius: 12, background: t.bg, border: `1px solid ${t.border}` }}>
            <div className="flex items-center justify-center shrink-0"
              style={{ width: 24, height: 24, borderRadius: 6, background: "rgba(255,255,255,0.7)" }}>
              <Icon name={it.icon} size={14} fill={1} color={t.icon} />
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 2 }}>{it.title}</div>
              <div style={{ fontSize: 11, color: C.secondary, lineHeight: 1.5 }}>{it.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("7d");
  const [channelFilter, setChannelFilter] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const days = ({ today: 1, "7d": 7, "30d": 30, "90d": 90, mtd: 30 } as Record<string, number>)[range] ?? 7;
    setLoading(true);
    void dashboardApi.getDashboardStats(days).then((data) => {
      if (active) { setStats(data); setLoading(false); }
    }).catch(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [range]);

  const convsSparkline = stats?.daily_conversations?.map((d) => d.count) ?? [12, 18, 14, 22, 28, 24, 32, 30, 38, 36];
  const msgsSparkline  = stats?.daily_messages?.map((d) => d.count)      ?? [4, 8, 12, 16, 22, 28, 30, 26, 32, 38];

  const pctTrend = (cur: number, prev: number): { dir: "up" | "down" | "flat"; value: string } | null => {
    if (!prev) return null;
    const diff = Math.round(((cur - prev) / prev) * 100);
    return { dir: diff > 0 ? "up" : diff < 0 ? "down" : "flat", value: `${Math.abs(diff)}%` };
  };

  const convTrend = stats
    ? pctTrend(stats.current_period_conversations, stats.prev_period_conversations)
    : { dir: "up" as const, value: "12%" };
  const msgTrend = stats
    ? pctTrend(stats.current_period_messages, stats.prev_period_messages)
    : { dir: "up" as const, value: "8%" };

  return (
    <>
      <style>{`@keyframes pulse-live { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.85)} }`}</style>
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
            <KPICard
              icon="forum" iconBg="#f5f3ff" iconColor="#7C4DFF"
              value={(stats?.current_period_conversations ?? 1284).toLocaleString()}
              label="Total conversations"
              trend={convTrend ?? { dir: "up", value: "12%" }}
              sub={`vs. previous period`}
              sparkline={convsSparkline}
            />
            <KPICard
              icon="chat_bubble" iconBg="#eff6ff" iconColor="#3B82F6"
              value={(stats?.messages_today ?? 3128).toLocaleString()}
              label="Messages today"
              trend={msgTrend ?? { dir: "up", value: "8%" }}
              sub="Across all channels"
              sparkline={msgsSparkline}
            />
            <KPICard
              icon="mark_chat_unread" iconBg="#fff7ed" iconColor="#F97316"
              value={(stats?.unread_conversations ?? 84).toLocaleString()}
              label="Backlog"
              trend={{ dir: "down", value: "5%" }}
              sub={`${(stats?.sla_at_risk ?? 12).toLocaleString()} SLA at risk`}
              sparkline={[24, 22, 26, 20, 18, 22, 16, 14, 12, 10]}
            />
            <KPICard
              icon="support_agent" iconBg="#ecfdf5" iconColor="#10B981"
              value={stats?.agent_stats ? `${stats.agent_stats.length}` : "14 / 18"}
              label="Agents active"
              sub={stats?.avg_resolution_hours != null ? `Avg resolution: ${stats.avg_resolution_hours.toFixed(1)}h` : "4 on break"}
              sparkline={[10, 12, 14, 14, 14, 13, 14, 14, 14, 14]}
            />
          </div>

          {/* Row 1: Volume + Donut */}
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <Card
              title="Conversation volume"
              action={
                <div className="flex gap-1 p-[3px] bg-slate-100 rounded-lg">
                  {["Hour", "Day", "Week"].map((opt, i) => (
                    <button key={opt} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: i === 0 ? "white" : "transparent", color: i === 0 ? C.primary : C.secondary, border: "none", cursor: "pointer", boxShadow: i === 0 ? "0 1px 2px rgba(0,0,0,0.06)" : "none" }}>
                      {opt}
                    </button>
                  ))}
                </div>
              }
            >
              <VolumeChart />
            </Card>
            <Card title="Conversations by channel" action={<Icon name="more_horiz" size={18} color="#94a3b8" />}>
              <ChannelDonut channels={stats?.channels ?? {}} />
            </Card>
          </div>

          {/* Row 2: Heatmap + Funnel */}
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <Card title="Peak hours" action={<span style={{ fontSize: 11, color: "#94a3b8" }}>Last 7 days · message volume</span>}>
              <Heatmap />
            </Card>
            <Card title="Status funnel" action={<Icon name="more_horiz" size={18} color="#94a3b8" />}>
              <StatusFunnel stats={stats} />
            </Card>
          </div>

          {/* Row 3: Activity + Tags + AI */}
          <div className="grid gap-4" style={{ gridTemplateColumns: "5fr 4fr 3fr" }}>
            <Card
              title="Recent activity"
              action={
                <a href="/messages" style={{ fontSize: 12, color: C.primary, fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 2 }}>
                  View all <Icon name="chevron_right" size={14} color={C.primary} />
                </a>
              }
            >
              <ActivityFeed />
            </Card>
            <Card title="Top tags" action={<span style={{ fontSize: 11, color: "#94a3b8" }}>by volume</span>}>
              <TagsBar />
            </Card>
            <Card
              title="AI Insights"
              action={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: C.accent, background: "#f5f3ff", border: "1px solid #ddd6fe", padding: "2px 8px", borderRadius: 100 }}>
                  <Icon name="auto_awesome" size={11} fill={1} color={C.accent} />
                  BETA
                </span>
              }
            >
              <AIInsights />
            </Card>
          </div>
        </main>
      </div>
    </>
  );
}
