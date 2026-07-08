import type { Metadata } from "next";
import Link from "next/link";
import HowItWorksSection from "@/components/landing/HowItWorksSection";

export const metadata: Metadata = {
  title: "omnicrm.chat | Every customer conversation, in one inbox",
  description:
    "A multi-channel customer support platform for WhatsApp, Telegram, Email, SMS, and web chat with AI suggestions, quick replies, and operational visibility.",
};

const navLinks = [
  { label: "Product", href: "#product" },
  { label: "Channels", href: "#channels" },
  { label: "How it works", href: "#how" },
  { label: "FAQ", href: "#faq" },
];

const trustedBy = ["Northwind", "Acumen", "Lumen.io", "Riverstone", "Beacon", "Halcyon"];

const features = [
  {
    icon: "forum",
    title: "One inbox for every channel",
    body: "WhatsApp, Telegram, Email, SMS, and web chat flow into one focused workspace instead of five disconnected tools.",
    tone: "bg-indigo-100 text-indigo-700",
  },
  {
    icon: "auto_awesome",
    title: "AI that drafts, never decides",
    body: "Generate contextual reply suggestions, summaries, and rewrites while keeping agents in control of every send.",
    tone: "bg-sky-100 text-sky-700",
  },
  {
    icon: "quick_phrases",
    title: "Quick replies at speed",
    body: "Use slash shortcuts and shared templates so the team responds consistently without repeating manual work.",
    tone: "bg-emerald-100 text-emerald-700",
  },
  {
    icon: "group",
    title: "Role-aware operations",
    body: "Admins, managers, and agents each see the controls they need with auditability built into daily work.",
    tone: "bg-orange-100 text-orange-700",
  },
  {
    icon: "timer",
    title: "SLA-aware routing",
    body: "Highlight risky conversations early and keep response promises visible across the whole operation.",
    tone: "bg-fuchsia-100 text-fuchsia-700",
  },
  {
    icon: "monitoring",
    title: "Metrics teams actually use",
    body: "Volume, response times, channel mix, and workload surface in a language operators and leaders can act on.",
    tone: "bg-amber-100 text-amber-700",
  },
];

const channels = [
  { name: "WhatsApp", icon: "chat", tone: "bg-green-50 text-green-600" },
  { name: "Telegram", icon: "send", tone: "bg-sky-50 text-sky-600" },
  { name: "Email", icon: "mail", tone: "bg-orange-50 text-orange-600" },
  { name: "SMS", icon: "sms", tone: "bg-violet-50 text-violet-600" },
  { name: "Web chat", icon: "language", tone: "bg-slate-100 text-slate-600" },
];

const faqs = [
  {
    q: "Which channels do you support today?",
    a: "WhatsApp, Telegram, Email, SMS, and a hosted web chat experience are supported in the core product direction shown here.",
  },
  {
    q: "How does AI assist work?",
    a: "AI suggests replies, summaries, and rewrites, but agents remain the final decision-makers before anything is sent.",
  },
  {
    q: "Can teams use quick replies and tags together?",
    a: "Yes. The workspace is designed so quick replies, channel filters, and tag-based organization reinforce each other in one flow.",
  },
  {
    q: "Is omnicrm.chat built for internal support teams?",
    a: "Yes. The landing and the product both position omnicrm.chat as an operational workspace for real internal business teams.",
  },
  {
    q: "Can this evolve into broader CRM and commercial workflows?",
    a: "Yes. The wider product already points toward projects, proposals, tasks, and client management connected to conversations.",
  },
  {
    q: "What should happen after this page?",
    a: "The intended next step is a sales conversation or controlled demo access so buyers can evaluate the real product feeling.",
  },
];

const footerColumns = [
  { title: "Product", items: ["Inbox", "AI assist", "Quick replies", "Analytics", "Projects", "Clients"] },
  { title: "Channels", items: ["WhatsApp", "Telegram", "Email", "SMS", "Web chat"] },
  { title: "Company", items: ["About", "Customers", "Pricing", "Contact"] },
  { title: "Resources", items: ["Docs", "Security", "Status", "Roadmap"] },
];

function MaterialIcon({
  name,
  className,
  filled = false,
}: {
  name: string;
  className?: string;
  filled?: boolean;
}) {
  return (
    <span
      className={`material-symbols-outlined ${className ?? ""}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}

function BrandIcon({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  return <img src="/brand/omnicrm-logo.png" alt="omnicrm.chat" width={size * 1.5} height={size} className={className} />;
}

function Wordmark() {
  return (
    <div className="flex items-center">
      <BrandIcon className="h-12 w-[180px] rounded-2xl object-cover object-center shadow-[0_10px_25px_rgba(15,23,42,0.18)]" />
    </div>
  );
}

function ChannelBadge({
  kind,
  compact = false,
}: {
  kind: "whatsapp" | "telegram" | "email";
  compact?: boolean;
}) {
  const styles = {
    whatsapp: {
      wrap: "border-emerald-200 bg-emerald-50 text-emerald-700",
      dot: "bg-emerald-500",
      label: "WA",
    },
    telegram: {
      wrap: "border-sky-200 bg-sky-50 text-sky-700",
      dot: "bg-sky-500",
      label: "TG",
    },
    email: {
      wrap: "border-orange-200 bg-orange-50 text-orange-700",
      dot: "bg-orange-500",
      label: "@",
    },
  } as const;

  const current = styles[kind];

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border font-semibold ${current.wrap} ${
        compact ? "h-8 w-8 text-[11px]" : "gap-2 px-3 py-1.5 text-[11px]"
      }`}
      aria-label={kind}
      title={kind}
    >
      {compact ? (
        <span className="leading-none">{current.label}</span>
      ) : (
        <>
          <span className={`h-1.5 w-1.5 rounded-full ${current.dot}`} />
          <span className="leading-none">{current.label}</span>
        </>
      )}
    </span>
  );
}

function InboxMock() {
  return (
    <div className="h-[540px] w-full max-w-[640px] overflow-hidden rounded-[24px] border border-[#E9ECEF] bg-white shadow-[0_32px_64px_-24px_rgba(67,56,202,0.28),0_12px_24px_-12px_rgba(15,23,42,0.08)]">
      <div className="grid h-full grid-cols-[64px_280px_minmax(0,1fr)]">
        <aside className="flex flex-col items-center gap-5 border-r border-[#E9ECEF] bg-white py-4">
          <BrandIcon className="h-9 w-9 rounded-xl object-cover object-left" size={36} />
          {["grid_view", "chat", "inventory_2", "group", "monitoring", "settings"].map((icon, index) => (
            <div
              key={icon}
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                index === 1 ? "bg-indigo-100 text-[#5b3df6]" : "text-slate-400"
              }`}
            >
              <MaterialIcon name={icon} filled={index === 1} className="text-[20px]" />
            </div>
          ))}
        </aside>

        <aside className="overflow-hidden border-r border-[#E9ECEF] bg-[#fbfcff]">
          <div className="flex items-center justify-between px-4 py-4">
            <p className="text-[30px] font-semibold tracking-[-0.03em] text-slate-900">Inbox</p>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-indigo-100 px-2 text-[11px] font-bold text-[#5b3df6]">
              12
            </span>
          </div>
          <div className="px-4">
            <div className="flex items-center gap-3 rounded-xl border border-[#E9ECEF] bg-white px-4 py-3 text-sm text-slate-400">
              <MaterialIcon name="search" className="text-[18px]" />
              Search conversations...
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 px-4">
            <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-semibold text-[#5b3df6]">
              All
            </span>
            <ChannelBadge kind="whatsapp" compact />
            <ChannelBadge kind="telegram" compact />
            <ChannelBadge kind="email" compact />
          </div>

          <div className="mt-4">
            {[
              {
                name: "Rafael Oliveira",
                initials: "RO",
                time: "14:32",
                preview: "Hi, I need help with my order #4821...",
                tags: ["Billing"],
                active: true,
                tone: "bg-violet-500",
              },
              {
                name: "Ana Lima",
                initials: "AL",
                time: "14:08",
                preview: "Ainda não recebi o reembolso, p...",
                tags: ["Support"],
                active: false,
                tone: "bg-sky-500",
              },
              {
                name: "Carlos Mendez",
                initials: "CM",
                time: "11:55",
                preview: "Thanks for the help, much appre...",
                tags: ["Feedback"],
                active: false,
                tone: "bg-orange-500",
              },
              {
                name: "Sofia Carvalho",
                initials: "SC",
                time: "Yest.",
                preview: "What are the pricing options for ...",
                tags: ["Sales"],
                active: false,
                tone: "bg-violet-500",
              },
            ].map((item) => (
              <div
                key={item.name}
                className={`border-t border-[#E9ECEF] px-4 py-4 ${
                  item.active ? "border-l-4 border-l-[#6d4aff] bg-indigo-50/80 pl-3" : "bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`relative flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white ${item.tone}`}>
                    {item.initials}
                    <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                      <span className={`text-xs ${item.active ? "font-semibold text-red-500" : "text-slate-400"}`}>{item.time}</span>
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-500">{item.preview}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                            tag === "Billing"
                              ? "bg-orange-50 text-orange-700"
                              : tag === "Support"
                                  ? "bg-blue-50 text-blue-700"
                                  : tag === "Feedback"
                                    ? "bg-fuchsia-50 text-fuchsia-700"
                                    : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col overflow-hidden bg-white">
          <div className="flex items-center justify-between border-b border-[#E9ECEF] px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500 text-sm font-bold text-white">RO</div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold leading-5 text-slate-900">Rafael Oliveira</p>
                <p className="truncate text-[11px] leading-4 text-slate-500">+55 11 9421-xxxx</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ChannelBadge kind="whatsapp" />
              <MaterialIcon name="more_horiz" className="text-[18px] text-slate-400" />
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-hidden bg-[#fbfcff] px-5 py-5">
            <div className="max-w-[260px] rounded-2xl border border-[#E9ECEF] bg-white px-4 py-3 text-sm leading-7 text-slate-800 shadow-sm">
              Hi, I need help with my order #4821. It&apos;s been 5 days and still no tracking update.
            </div>
            <p className="text-xs text-slate-400">14:10</p>

            <div className="ml-auto max-w-[310px] rounded-2xl bg-[#6d4aff] px-4 py-4 text-sm leading-7 text-white shadow-sm">
              Hello Rafael! Let me look into that right away. Can you confirm your email so I can pull up the order?
            </div>
            <p className="text-right text-xs text-slate-400">14:14 · Sent</p>

            <div className="max-w-[210px] rounded-2xl border border-[#E9ECEF] bg-white px-4 py-3 text-sm leading-7 text-slate-800 shadow-sm">
              Sure, it&apos;s rafael@email.com
            </div>
          </div>

          <div className="border-t border-[#E9ECEF] bg-white px-4 py-3">
            <div className="ml-auto max-w-[340px] rounded-[20px] border border-[#E9ECEF] bg-white p-3 shadow-[0_12px_24px_-18px_rgba(15,23,42,0.18)]">
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400">
                Type a message or use / for quick replies...
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-slate-400">
                  <MaterialIcon name="sentiment_satisfied" className="text-[18px]" />
                  <MaterialIcon name="attach_file" className="text-[18px]" />
                </div>
                <span className="rounded-full bg-indigo-100 px-3 py-1.5 text-xs font-semibold text-[#5b3df6]">✦ AI draft</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6d4aff] text-white">
                  <MaterialIcon name="send" filled className="text-[18px]" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function DashboardMock() {
  return (
    <div className="overflow-hidden rounded-[20px] border border-[#E9ECEF] bg-white">
      <div className="grid min-h-[520px] grid-cols-[72px_1fr]">
        <aside className="flex flex-col items-center gap-4 border-r border-[#E9ECEF] bg-white py-4">
          <BrandIcon className="h-9 w-9 rounded-xl object-cover object-left" size={36} />
          {["dashboard", "chat_bubble", "inventory_2", "group", "monitoring", "settings"].map((icon, index) => (
            <div
              key={icon}
              className={`relative flex h-10 w-10 items-center justify-center rounded-xl ${
                index === 0 ? "bg-indigo-100 text-[#5b3df6]" : "text-slate-400"
              }`}
            >
              {index === 0 ? <span className="absolute -left-[13px] h-6 w-1 rounded-r-full bg-[#5b3df6]" /> : null}
              <MaterialIcon name={icon} filled={index === 0} className="text-[20px]" />
            </div>
          ))}
        </aside>

        <section className="bg-[#fbfcff]">
          <div className="flex items-center justify-between border-b border-[#E9ECEF] px-6 py-4">
            <div>
              <p className="text-[34px] font-semibold tracking-[-0.04em] text-slate-900">Dashboard</p>
              <p className="mt-1 text-xs text-slate-500">Overview · Last 7 days</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-[#E9ECEF] bg-white px-4 py-2 text-xs font-medium text-slate-600">Last 7 days</span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-400">
                <MaterialIcon name="download" className="text-[18px]" />
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div className="grid gap-4 md:grid-cols-4">
              {[
                ["chat", "247", "Open conversations", "+12.4%", "text-emerald-600", "bg-violet-100 text-[#6d4aff]"],
                ["timer", "1m 42s", "Avg. response time", "-18%", "text-emerald-600", "bg-emerald-100 text-emerald-600"],
                ["auto_awesome", "68%", "AI-assisted", "+9.2%", "text-emerald-600", "bg-indigo-100 text-[#6d4aff]"],
                ["warning", "3", "SLA at risk", "-2", "text-emerald-600", "bg-red-100 text-red-500"],
              ].map(([icon, value, label, delta, deltaTone, iconTone]) => (
                <div key={label} className="rounded-[24px] border border-[#E9ECEF] bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${iconTone}`}>
                      <MaterialIcon name={icon} filled className="text-[20px]" />
                    </div>
                    <span className={`rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold ${deltaTone}`}>{delta}</span>
                  </div>
                  <p className="mt-4 text-[18px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[20px]">{value}</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">{label}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
              <div className="rounded-[24px] border border-[#E9ECEF] bg-white p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Conversation volume</p>
                    <p className="mt-1 text-xs text-slate-500">Daily inbound, all channels</p>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-[3px] bg-[#5b4ce6]" />
                      Inbound
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-[3px] bg-indigo-200" />
                      Resolved
                    </span>
                  </div>
                </div>
                <div className="mt-8 flex h-[170px] items-end gap-7 px-2">
                  {[
                    [52, 38],
                    [68, 55],
                    [84, 66],
                    [64, 52],
                    [102, 80],
                    [76, 61],
                    [60, 48],
                  ].map(([primary, secondary], index) => (
                    <div key={index} className="flex flex-1 flex-col items-center gap-3">
                      <div className="flex h-full w-full items-end justify-center gap-1.5">
                        <div className="w-6 rounded-t-md bg-[#5b4ce6]" style={{ height: `${primary}%` }} />
                        <div className="w-6 rounded-t-md bg-indigo-200" style={{ height: `${secondary}%` }} />
                      </div>
                      <span className="text-xs text-slate-400">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index]}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-[#E9ECEF] bg-white p-5">
                <p className="text-sm font-semibold text-slate-900">Channel mix</p>
                <p className="mt-1 text-xs text-slate-500">Share of conversations</p>

                <div className="mt-6 grid items-center gap-4 md:grid-cols-[180px_1fr]">
                  <div className="flex items-center justify-center">
                    <div className="relative h-44 w-44 rounded-full bg-[conic-gradient(#22c55e_0_42%,#0ea5e9_42%_66%,#f97316_66%_88%,#8b5cf6_88%_100%)]">
                      <div className="absolute inset-8 flex flex-col items-center justify-center rounded-full bg-white">
                        <span className="text-2xl font-semibold tracking-[-0.03em] text-slate-900">2,481</span>
                        <span className="text-[11px] text-slate-400">conversations</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {[
                      ["WhatsApp", "42%", "bg-green-500"],
                      ["Telegram", "24%", "bg-sky-500"],
                      ["Email", "22%", "bg-orange-500"],
                      ["SMS", "12%", "bg-violet-500"],
                    ].map(([label, share, swatch]) => (
                      <div key={label} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-3">
                          <span className={`h-2.5 w-2.5 rounded-full ${swatch}`} />
                          <span className="text-slate-700">{label}</span>
                        </div>
                        <span className="font-medium text-slate-900">{share}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="bg-white text-slate-900">
      <nav className="sticky top-0 z-40 border-b border-[#E9ECEF] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
          <Wordmark />

          <div className="hidden items-center gap-7 md:flex">
            {navLinks.map((item) => (
              <a key={item.label} href={item.href} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
                {item.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-100"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#7C4DFF] px-4 text-sm font-semibold text-white shadow-[0_10px_15px_-3px_rgba(124,77,255,0.2)] transition hover:bg-[#632ce5]"
            >
              Talk to sales
            </Link>
          </div>
        </div>
      </nav>

      <section className="overflow-hidden py-20 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[minmax(0,520px)_minmax(0,640px)] lg:justify-between lg:items-center lg:px-10">
          <div className="min-w-0 max-w-[520px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-100 px-3 py-1.5 text-xs font-semibold text-indigo-700">
              <span className="h-1.5 w-1.5 rounded-full bg-[#7C4DFF] shadow-[0_0_0_4px_rgba(124,77,255,0.18)]" />
              Multi-channel customer support
            </span>

            <h1 className="mt-6 max-w-[10ch] text-5xl font-bold leading-[0.98] tracking-[-0.04em] text-slate-900 sm:text-6xl">
              Every customer conversation,
              <span className="block text-[#7C4DFF]">in one calm inbox.</span>
            </h1>

            <p className="mt-6 max-w-[520px] text-[17px] leading-8 text-slate-600 sm:text-lg">
              WhatsApp, Telegram, Email and SMS — handled by your team in a single workspace, with AI ready when you need it.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#7C4DFF] px-6 text-sm font-semibold text-white shadow-[0_10px_15px_-3px_rgba(124,77,255,0.2)] transition hover:bg-[#632ce5]"
              >
                Talk to sales
                <MaterialIcon name="arrow_forward" className="text-[18px]" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#E9ECEF] bg-white px-6 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
              >
                <MaterialIcon name="play_arrow" filled className="text-[18px]" />
                See a live demo
              </Link>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-4 text-sm text-slate-500">
              <span className="inline-flex items-center gap-2">
                <MaterialIcon name="check_circle" filled className="text-[18px] text-emerald-600" />
                No credit card needed
              </span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span className="inline-flex items-center gap-2">
                <MaterialIcon name="check_circle" filled className="text-[18px] text-emerald-600" />
                14-day trial on all plans
              </span>
            </div>
          </div>

          <div className="min-w-0 lg:justify-self-end">
            <InboxMock />
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-7xl px-6 lg:px-10">
          <div className="border-t border-[#E9ECEF] pt-8">
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
              Trusted by support teams at
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
              {trustedBy.map((brand) => (
                <span key={brand} className="inline-flex items-center gap-2 text-lg font-semibold tracking-[-0.03em] text-slate-500/80">
                  <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded bg-slate-500 text-[11px] font-bold text-white">
                    {brand[0]}
                  </span>
                  {brand}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7C4DFF]">Why teams switch to omnicrm.chat</p>
            <h2 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-slate-900 sm:text-5xl">
              A workspace built around your customer, not your tabs.
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              The handoff design leaned into a minimal, flat product language. This landing now follows that same rule:
              clear structure, product-led visuals, and a message rooted in the actual operator workflow.
            </p>
          </div>

          <div className="mt-14 overflow-hidden rounded-[24px] border border-[#E9ECEF] bg-[#E9ECEF]">
            <div className="grid gap-px md:grid-cols-2 xl:grid-cols-3">
              {features.map((feature) => (
                <article key={feature.title} className="bg-white p-8">
                  <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${feature.tone}`}>
                    <MaterialIcon name={feature.icon} filled className="text-[22px]" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-[-0.01em] text-slate-900">{feature.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7C4DFF]">See it in action</p>
            <h2 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-slate-900 sm:text-5xl">
              A workspace your team will actually enjoy opening.
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              The original landing prototype asked for a large product visual, so this section keeps that emphasis with
              a dashboard-style surface rooted in the same design system as the app.
            </p>
          </div>

          <div className="mt-14 rounded-[24px] border border-[#E9ECEF] bg-white p-4 shadow-[0_24px_48px_-24px_rgba(67,56,202,0.18),0_8px_16px_-8px_rgba(15,23,42,0.04)]">
            <DashboardMock />
          </div>
        </div>
      </section>

      <section id="channels" className="py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7C4DFF]">Channels</p>
            <h2 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-slate-900 sm:text-5xl">
              Meet your customers where they already are.
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              One shell for the channels that matter most to support and commercial operations, without pushing users
              back into disconnected provider-specific tools.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {channels.map((channel) => (
              <article
                key={channel.name}
                className="rounded-[24px] border border-[#E9ECEF] bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-sm"
              >
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${channel.tone}`}>
                  <MaterialIcon name={channel.icon} filled className="text-[20px]" />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">{channel.name}</h3>
                <p className="mt-1 text-xs text-slate-500">Native integration</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="bg-slate-50 py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7C4DFF]">How it works</p>
            <h2 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-slate-900 sm:text-5xl">
              From scattered to centralized in an afternoon.
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">
              The design brief asked for a simple, readable step-by-step story. This version keeps that structure and
              pairs it with one composite visual instead of a noisy carousel.
            </p>
          </div>

          <HowItWorksSection />
        </div>
      </section>

      <section id="faq" className="py-24">
        <div className="mx-auto max-w-5xl px-6 lg:px-10">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7C4DFF]">FAQ</p>
            <h2 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-slate-900 sm:text-5xl">
              Questions you might be thinking right now.
            </h2>
          </div>

          <div className="mt-12 border-t border-[#E9ECEF]">
            {faqs.map((item) => (
              <details key={item.q} className="group border-b border-[#E9ECEF]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-6 text-left text-lg font-semibold tracking-[-0.01em] text-slate-900">
                  <span>{item.q}</span>
                  <MaterialIcon name="add" className="text-[22px] text-slate-500 transition group-open:rotate-45 group-open:text-[#7C4DFF]" />
                </summary>
                <p className="max-w-3xl pb-6 text-[15px] leading-8 text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-24 lg:px-10">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[28px] bg-gradient-to-br from-[#4A1DB5] via-[#632ce5] to-[#7C4DFF] px-8 py-14 text-white sm:px-12">
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/75">Ready to move?</p>
              <h2 className="mt-3 text-4xl font-bold tracking-[-0.03em] sm:text-5xl">
                Ready to give your team one calm inbox?
              </h2>
              <p className="mt-4 text-lg leading-8 text-white/80">
                Talk to us about your stack, your channels, and your team. We&apos;ll show you how this product language
                maps onto your real operation.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
              >
                Talk to sales
                <MaterialIcon name="arrow_forward" className="text-[18px]" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center rounded-2xl border border-white/30 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#E9ECEF] bg-slate-50 py-16">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="grid gap-12 lg:grid-cols-[minmax(280px,1.55fr)_repeat(4,minmax(120px,1fr))]">
            <div className="min-w-0">
              <Wordmark />
              <p className="mt-4 max-w-[290px] text-sm leading-7 text-slate-600">
                A multi-channel customer support platform for WhatsApp, Telegram, Email, SMS, and web chat, with AI on
                every conversation.
              </p>
              <div className="mt-5 flex gap-2">
                {["alternate_email", "rss_feed", "code"].map((icon) => (
                  <a
                    key={icon}
                    href="#"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E9ECEF] bg-white text-slate-500 transition hover:text-slate-900"
                  >
                    <MaterialIcon name={icon} className="text-[16px]" />
                  </a>
                ))}
              </div>
            </div>

            {footerColumns.map((column) => (
              <div key={column.title}>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{column.title}</h3>
                <ul className="mt-4 space-y-3">
                  {column.items.map((item) => (
                    <li key={item}>
                      <a href="#" className="text-sm text-slate-600 transition hover:text-slate-900">
                        {item}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-col gap-4 border-t border-[#E9ECEF] pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 omnicrm.chat. All rights reserved.</p>
            <div className="flex flex-wrap gap-5">
              {["Privacy", "Terms", "Security", "Status"].map((item) => (
                <a key={item} href="#" className="transition hover:text-slate-900">
                  {item}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
