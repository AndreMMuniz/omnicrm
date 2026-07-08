"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { authApi } from "@/lib/api/index";

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

function Field({
  label,
  icon,
  type = "text",
  placeholder,
  value,
  onChange,
  autoFocus,
  hint,
  trailing,
}: {
  label: string;
  icon: string;
  type?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  hint?: string;
  trailing?: ReactNode;
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
      {hint ? <p className="mt-1.5 text-[11.5px] leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const score = useMemo(() => {
    let points = 0;
    if (password.length >= 8) points += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) points += 1;
    if (/\d/.test(password)) points += 1;
    if (/[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(password)) points += 1;
    return points;
  }, [password]);

  const strength = [
    { max: 0, label: "Weak", color: "#EF4444" },
    { max: 1, label: "Weak", color: "#F97316" },
    { max: 2, label: "Fair", color: "#F59E0B" },
    { max: 3, label: "Strong", color: "#2563EB" },
    { max: 4, label: "Very strong", color: "#10B981" },
  ].find((item) => score <= item.max) ?? { label: "Weak", color: "#EF4444" };

  if (!password) return null;

  return (
    <div className="mt-2">
      <div className="mb-1.5 flex gap-1">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-1 flex-1 rounded-full bg-[#eef2f6]"
            style={{ backgroundColor: index < Math.max(1, score) ? strength.color : "#eef2f6" }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 text-[11.5px]">
        <span className="text-slate-500">Use 8+ chars with mixed case, numbers and symbols.</span>
        <span className="font-semibold" style={{ color: strength.color }}>
          {strength.label}
        </span>
      </div>
    </div>
  );
}

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

function BrandPanel() {
  const steps = [
    {
      number: "01",
      title: "Request access",
      description: "Tell us about you and your team.",
      active: true,
    },
    {
      number: "02",
      title: "Verify your email",
      description: "Confirm the address you signed up with.",
    },
    {
      number: "03",
      title: "Workspace review",
      description: "Our team validates the request, usually within 24 hours.",
    },
    {
      number: "04",
      title: "Start using",
      description: "Connect WhatsApp, Telegram, email and SMS.",
    },
  ];

  return (
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

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            Back to landing
          </Link>
        </div>

        <div className="max-w-[500px] pt-2">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 py-1.5 text-xs font-semibold text-white/90">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22C55E]" />
            Now accepting new workspaces
          </div>

          <h1 className="max-w-[11ch] text-[38px] font-bold leading-[1.08] tracking-[-0.03em] text-white">
            Bring every customer conversation into one workspace.
          </h1>
          <p className="mt-4 max-w-[430px] text-[15px] leading-7 text-white/80">
            WhatsApp, Telegram, email and SMS centralized with AI-assisted replies and a built-in sales pipeline.
          </p>
        </div>

        <div className="flex max-w-[470px] flex-1 flex-col gap-4 pt-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/60">What happens next</div>

          {steps.map((step, index) => (
            <div key={step.number} className="relative flex gap-4" style={{ animation: `stepIn 0.4s ease ${index * 0.08}s both` }}>
              <div
                className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[11px] font-bold ${
                  step.active ? "bg-white text-[#7C4DFF] shadow-[0_4px_14px_-4px_rgba(255,255,255,0.6)]" : "border border-white/20 bg-white/10 text-white/85"
                }`}
              >
                {step.number}
              </div>
              {index < steps.length - 1 ? <div className="absolute left-4 top-8 h-[calc(100%-12px)] w-px bg-white/20" /> : null}
              <div className="pt-0.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  {step.title}
                  {step.active ? (
                    <span className="rounded-full bg-white/18 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-white">
                      You&apos;re here
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12.5px] leading-5 text-white/72">{step.description}</p>
              </div>
            </div>
          ))}
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
              GDPR / LGPD
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
  );
}

function SuccessCard({ email }: { email: string }) {
  return (
    <div className="w-full max-w-[420px] rounded-[28px] border border-white/70 bg-white/92 p-7 shadow-[0_28px_60px_-24px_rgba(15,23,42,0.22)] backdrop-blur sm:p-8">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#ecfdf5] text-[#10B981]">
        <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>
          mark_email_read
        </span>
      </div>

      <h2 className="text-[28px] font-bold tracking-[-0.03em] text-slate-900">Request received</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        We sent a confirmation link to <strong className="text-slate-900">{email || "your inbox"}</strong>. Once your email is verified,
        our team will review the workspace and release access, usually within 24 hours.
      </p>

      <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#e9ecef] bg-slate-50 px-4 py-3">
        <span className="material-symbols-outlined mt-0.5 text-[18px] text-[#7C4DFF]" style={{ fontVariationSettings: "'FILL' 1" }}>
          info
        </span>
        <p className="text-sm leading-6 text-slate-500">
          Didn&apos;t get the email? Check your spam folder or <a href="#" className="font-semibold text-[#7C4DFF]">resend it</a>.
        </p>
      </div>

      <Link
        href="/login"
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7C4DFF] text-sm font-semibold text-white shadow-[0_10px_20px_-8px_rgba(124,77,255,0.5)] transition hover:bg-[#632ce5]"
      >
        Go to sign in
        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
      </Link>
    </div>
  );
}

export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const passwordScore = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(password)) score += 1;
    return score;
  }, [password]);

  const passwordsMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (!fullName || !email || !password || !confirmPassword) {
      setError("Fill in all fields to continue.");
      return;
    }

    if (passwordScore < 3) {
      setError("Please choose a stronger password with mixed case, numbers and symbols.");
      return;
    }

    if (passwordsMismatch) {
      setError("Passwords don't match.");
      return;
    }

    if (!termsAccepted) {
      setError("You need to accept the terms to continue.");
      return;
    }

    setLoading(true);
    try {
      await authApi.signup({ email, password, full_name: fullName });
      setSubmitted(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Registration failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] lg:flex">
      <BrandPanel />

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

          {submitted ? (
            <SuccessCard email={email} />
          ) : (
            <div className="rounded-[28px] border border-white/70 bg-white/92 p-7 shadow-[0_28px_60px_-24px_rgba(15,23,42,0.22)] backdrop-blur sm:p-8">
              <div className="mb-6">
                <h2 className="text-[28px] font-bold tracking-[-0.03em] text-slate-900">Request workspace access</h2>
                <p className="mt-1.5 text-sm leading-6 text-slate-500">
                  Tell us about you and your team so we can review and release platform access.
                </p>
              </div>

              <div className="space-y-2.5">
                <SocialButton provider="google" label="Sign up with Google" />
                <SocialButton provider="microsoft" label="Sign up with Microsoft" />
              </div>

              <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                <div className="h-px flex-1 bg-[#e9ecef]" />
                <span className="font-medium text-slate-500">or sign up with email</span>
                <div className="h-px flex-1 bg-[#e9ecef]" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <Field
                  label="Full name"
                  icon="person"
                  placeholder="Jane Doe"
                  value={fullName}
                  onChange={setFullName}
                  autoFocus
                />

                <Field
                  label="Work email"
                  icon="mail"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={setEmail}
                />

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-900">Password</label>
                  <Field
                    label=""
                    icon="lock"
                    type={showPassword ? "text" : "password"}
                    placeholder="Create a strong password"
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
                  <PasswordStrength password={password} />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-slate-900">Confirm password</label>
                  <div
                    className={`flex h-12 items-center rounded-xl border bg-slate-50 transition ${
                      passwordsMismatch
                        ? "border-[#ba1a1a] ring-4 ring-[#ba1a1a]/15"
                        : "border-[#d7deea] focus-within:border-[#7C4DFF] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#7C4DFF]/12"
                    }`}
                  >
                    <span className={`material-symbols-outlined ml-4 text-[18px] ${passwordsMismatch ? "text-[#ba1a1a]" : "text-slate-400"}`}>lock</span>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Repeat your password"
                      className="h-full flex-1 border-0 bg-transparent px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    />
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
                  </div>
                  {passwordsMismatch ? (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-[#ba1a1a]">
                      <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        error
                      </span>
                      Passwords don&apos;t match
                    </p>
                  ) : null}
                </div>

                {error ? (
                  <div className="flex items-center gap-2 rounded-xl bg-[#ffdad6] px-3 py-2.5 text-sm font-medium text-[#93000a]">
                    <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      error
                    </span>
                    {error}
                  </div>
                ) : null}

                <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-sm leading-6 text-slate-500">
                  <span className="relative mt-1 flex h-4 w-4 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                      className="peer absolute inset-0 cursor-pointer opacity-0"
                    />
                    <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-slate-300 bg-white transition peer-checked:border-[#7C4DFF] peer-checked:bg-[#7C4DFF]">
                      {termsAccepted ? (
                        <span className="material-symbols-outlined text-[12px] text-white" style={{ fontVariationSettings: "'FILL' 1,'wght' 700" }}>
                          check
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span>
                    I agree to the{" "}
                    <a href="#" className="font-semibold text-[#7C4DFF]">
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a href="#" className="font-semibold text-[#7C4DFF]">
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#7C4DFF] text-sm font-semibold text-white shadow-[0_10px_20px_-8px_rgba(124,77,255,0.5)] transition hover:bg-[#632ce5] active:scale-[0.985] disabled:cursor-wait disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      Submit request
                      <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 border-t border-[#e9ecef] pt-5 text-center text-sm text-slate-500">
                Already have an account?{" "}
                <Link href="/login" className="font-semibold text-[#7C4DFF] transition hover:text-[#632ce5]">
                  Sign in
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="absolute bottom-6 right-6 hidden items-center gap-1.5 text-xs text-slate-500 lg:flex">
          <span className="material-symbols-outlined text-[14px]">language</span>
          English (US)
          <span className="material-symbols-outlined text-[14px]">expand_more</span>
        </div>
      </div>

      <style jsx global>{`
        @keyframes stepIn {
          from {
            opacity: 0;
            transform: translateX(8px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
