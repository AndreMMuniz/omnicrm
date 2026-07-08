"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { authApi } from "@/lib/api/index";

function BrandPreviewCard({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/55 bg-white/95 p-4 text-slate-900 shadow-[0_24px_48px_-16px_rgba(20,8,60,0.42),0_8px_18px_-8px_rgba(0,0,0,0.18)] backdrop-blur ${className ?? ""}`}
      style={style}
    >
      {children}
    </div>
  );
}

function SocialButton({
  provider,
  label,
}: {
  provider: "google" | "microsoft";
  label: string;
}) {
  return (
    <button
      type="button"
      className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-[#d7deea] bg-white text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
    >
      {provider === "google" ? (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
          <path fill="#EA4335" d="M12 5.04c1.62 0 3.07.56 4.21 1.65l3.15-3.15C17.45 1.7 14.97.62 12 .62 7.7.62 3.99 3.08 2.18 6.67l3.66 2.84C6.7 6.91 9.13 5.04 12 5.04z" />
          <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.28 1.4-1.04 2.59-2.21 3.42v2.77h3.57c2.08-1.92 3.66-4.74 3.66-8.43z" />
          <path fill="#FBBC05" d="M5.84 14.09a7.06 7.06 0 0 1 0-4.18L2.18 7.07a11.94 11.94 0 0 0 0 9.86l3.66-2.84z" />
          <path fill="#34A853" d="M12 23.38c3.24 0 5.95-1.07 7.93-2.91l-3.57-2.77c-.99.67-2.27 1.07-4.36 1.07-2.87 0-5.3-1.88-6.16-4.51l-3.66 2.84C3.99 20.92 7.7 23.38 12 23.38z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
          <rect x="1" y="1" width="10" height="10" fill="#F25022" />
          <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
          <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
          <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
        </svg>
      )}
      {label}
    </button>
  );
}

function IconInput({
  label,
  icon,
  type,
  placeholder,
  value,
  onChange,
  autoFocus,
  trailing,
}: {
  label: string;
  icon: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div>
      {label ? <label className="mb-1.5 block text-sm font-semibold text-slate-900">{label}</label> : null}
      <div className="flex h-12 items-center rounded-xl border border-[#d7deea] bg-slate-50 transition focus-within:border-[#7C4DFF] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#7C4DFF]/12">
        <span className="material-symbols-outlined ml-4 text-[18px] text-slate-400">{icon}</span>
        <input
          type={type}
          value={value}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-full flex-1 border-0 bg-transparent px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
        {trailing}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authApi.login(email, password);
      window.location.href = "/projects";
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Connection error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] lg:flex">
      <div className="relative hidden min-h-screen min-w-[620px] flex-[0_0_54%] overflow-hidden bg-gradient-to-br from-[#4A1DB5] via-[#632ce5] to-[#7C4DFF] lg:flex">
        <div
          className="absolute inset-0 opacity-45"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        />
        <div className="pointer-events-none absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.2),transparent_60%)] blur-sm" />
        <div className="pointer-events-none absolute -bottom-40 -left-16 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(199,210,254,0.2),transparent_60%)] blur-md" />

        <div className="relative flex w-full flex-col gap-6 px-14 py-10 text-white">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/brand/omnicrm-logo.png" alt="omnicrm.chat" className="h-12 w-[180px] rounded-2xl object-cover object-center shadow-lg" />
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold tracking-[0.03em] text-white/90">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22C55E]" />
              Operational status
            </div>
          </div>

          <div className="max-w-[500px] pt-4">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 py-1.5 text-xs font-semibold text-white/90">
              <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                auto_awesome
              </span>
              AI-native support workspace
            </div>

            <h1 className="max-w-[11ch] text-[40px] font-bold leading-[1.08] tracking-[-0.03em] text-white">
              Every customer conversation, in one calm inbox.
            </h1>
            <p className="mt-4 max-w-[430px] text-[15px] leading-7 text-white/80">
              WhatsApp, Telegram, email and SMS live in one operational surface, with AI suggestions and pipeline context
              ready when your team needs it.
            </p>
          </div>

          <div className="relative mt-2 min-h-[330px] flex-1">
            <BrandPreviewCard
              className="absolute left-0 top-0 w-[322px] -rotate-[1.5deg]"
              style={{ animation: "floatY 6s ease-in-out infinite", ["--card-rotation" as string]: "-1.5deg" }}
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#f0fdf4] to-[#dcfce7] text-[#15803d]">
                  <span className="material-symbols-outlined text-[17px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    chat
                  </span>
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#25D366]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold">Mariana Costa</p>
                    <span className="text-[10px] text-slate-500">now</span>
                  </div>
                  <p className="truncate text-xs text-slate-500">Can I move my invoice due date to next Friday?</p>
                </div>
                <span className="h-2 w-2 rounded-full bg-[#7C4DFF]" />
              </div>
              <div className="flex gap-2">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
                  Billing
                </span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                  VIP
                </span>
              </div>
            </BrandPreviewCard>

            <div
              className="absolute right-2 top-20 w-[282px] rotate-[2deg] overflow-hidden rounded-2xl border border-[#7C4DFF]/35 bg-[linear-gradient(160deg,#1d1238,#2d1c5c)] p-4 text-white shadow-[0_24px_48px_-16px_rgba(20,8,60,0.55),0_8px_16px_-8px_rgba(0,0,0,0.2)]"
              style={{ animation: "floatY 7s ease-in-out infinite -2s", ["--card-rotation" as string]: "2deg" }}
            >
              <div className="absolute inset-0 overflow-hidden">
                <div className="absolute inset-y-0 w-24 -translate-x-[120%] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.35)_50%,transparent_100%)] animate-[shineBar_2.6s_ease-in-out_infinite_1s]" />
              </div>
              <div className="relative mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-[#c7d2fe]">
                  <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    auto_awesome
                  </span>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#c7d2fe]">AI suggestion</span>
              </div>
              <p className="relative text-[12.5px] leading-5 text-white/90">
                Absolutely. I can prepare the updated billing steps and ask which date works best for your team.
              </p>
              <div className="relative mt-3 flex gap-2">
                <button type="button" className="flex-1 rounded-lg bg-[#7C4DFF] px-3 py-2 text-[11px] font-semibold text-white">
                  Insert
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[#c7d2fe]/30 px-3 py-2 text-[11px] font-semibold text-[#c7d2fe]"
                >
                  Refine
                </button>
              </div>
            </div>

            <BrandPreviewCard
              className="absolute bottom-0 left-14 w-[302px] -rotate-[1deg]"
              style={{ animation: "floatY 8s ease-in-out infinite -4s", ["--card-rotation" as string]: "-1deg" }}
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">Pipeline</p>
                <span className="text-[10px] font-semibold text-[#7C4DFF]">$142.8k</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  ["New", "8", "#7C4DFF"],
                  ["Qualify", "5", "#0088CC"],
                  ["Negotiate", "3", "#F59E0B"],
                  ["Closed", "12", "#10B981"],
                ].map(([label, value, color]) => (
                  <div key={label} className="rounded-lg border border-[#eef2ff] bg-[#f8fafc] px-2 py-2">
                    <div className="mb-1 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-[9px] font-semibold text-slate-500">{label}</span>
                    </div>
                    <div className="text-sm font-bold tracking-[-0.02em] text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
            </BrandPreviewCard>
          </div>

          <div className="mt-auto flex items-center justify-between gap-6 border-t border-white/15 pt-4 text-xs text-white/70">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  shield
                </span>
                SOC 2 Type II
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  lock
                </span>
                LGPD-ready
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  bolt
                </span>
                99.98% uptime
              </span>
            </div>
            <span className="text-white/55">© 2026 omnicrm.chat</span>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-screen flex-1 items-center justify-center px-6 py-10 sm:px-8 lg:px-12">
        <div className="absolute right-6 top-6 hidden items-center gap-2 lg:flex">
          <span className="text-sm text-slate-500">Need help?</span>
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-full border border-[#d7deea] bg-white px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
          >
            <span className="material-symbols-outlined text-[16px] text-[#7C4DFF]" style={{ fontVariationSettings: "'FILL' 1" }}>
              support_agent
            </span>
            Contact support
          </a>
        </div>

        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center lg:hidden">
            <img src="/brand/omnicrm-logo.png" alt="omnicrm.chat" className="h-12 w-[180px] rounded-2xl object-cover object-center shadow-sm" />
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/92 p-7 shadow-[0_28px_60px_-24px_rgba(15,23,42,0.22)] backdrop-blur sm:p-8">
            <div className="mb-7">
              <h2 className="text-[30px] font-bold tracking-[-0.03em] text-slate-900">Welcome back</h2>
              <p className="mt-1.5 text-sm leading-6 text-slate-500">
                Sign in to your workspace and keep every conversation moving.
              </p>
            </div>

            <div className="space-y-2.5">
              <SocialButton provider="google" label="Continue with Google" />
              <SocialButton provider="microsoft" label="Continue with Microsoft" />
            </div>

            <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
              <div className="h-px flex-1 bg-[#e9ecef]" />
              <span className="font-medium text-slate-500">or continue with email</span>
              <div className="h-px flex-1 bg-[#e9ecef]" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <IconInput
                label="Work email"
                icon="mail"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={setEmail}
                autoFocus
              />

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-slate-900">Password</label>
                  <Link href="/forgot-password" className="text-xs font-semibold text-[#7C4DFF] transition hover:text-[#632ce5]">
                    Forgot password?
                  </Link>
                </div>
                <IconInput
                  label=""
                  icon="lock"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={setPassword}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {showPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  }
                />
              </div>

              {error ? (
                <div className="flex items-center gap-2 rounded-xl bg-[#ffdad6] px-3 py-2.5 text-sm font-medium text-[#93000a]">
                  <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    error
                  </span>
                  {error}
                </div>
              ) : null}

              <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-sm text-slate-500">
                <span className="relative flex h-4 w-4 items-center justify-center">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="peer absolute inset-0 cursor-pointer opacity-0"
                  />
                  <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-slate-300 bg-white transition peer-checked:border-[#7C4DFF] peer-checked:bg-[#7C4DFF]">
                    {remember ? (
                      <span className="material-symbols-outlined text-[12px] text-white" style={{ fontVariationSettings: "'FILL' 1,'wght' 700" }}>
                        check
                      </span>
                    ) : null}
                  </span>
                </span>
                Remember me for 30 days
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7C4DFF] text-sm font-semibold text-white shadow-[0_10px_20px_-8px_rgba(124,77,255,0.5)] transition hover:bg-[#632ce5] active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 border-t border-[#e9ecef] pt-5 text-center text-sm text-slate-500">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-semibold text-[#7C4DFF] transition hover:text-[#632ce5]">
                Request access
              </Link>
            </div>
          </div>
        </div>

        <div className="absolute bottom-6 right-6 hidden items-center gap-1.5 text-xs text-slate-500 lg:flex">
          <span className="material-symbols-outlined text-[14px]">language</span>
          English
          <span className="material-symbols-outlined text-[14px]">expand_more</span>
        </div>
      </div>

      <style jsx global>{`
        @keyframes floatY {
          0%,
          100% {
            transform: translateY(0) rotate(var(--card-rotation, 0deg));
          }
          50% {
            transform: translateY(-8px) rotate(var(--card-rotation, 0deg));
          }
        }

        @keyframes shineBar {
          0% {
            transform: translateX(-120%);
          }
          100% {
            transform: translateX(220%);
          }
        }
      `}</style>
    </div>
  );
}
