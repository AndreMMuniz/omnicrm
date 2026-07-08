"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { authApi } from "@/lib/api/index";

interface PasswordRule {
  label: string;
  test: (v: string) => boolean;
}

const PASSWORD_RULES: PasswordRule[] = [
  { label: "At least 8 characters",      test: (v) => v.length >= 8 },
  { label: "Uppercase letter (A-Z)",      test: (v) => /[A-Z]/.test(v) },
  { label: "Lowercase letter (a-z)",      test: (v) => /[a-z]/.test(v) },
  { label: "Number (0-9)",                test: (v) => /\d/.test(v) },
  { label: "Special character (!@#$...)", test: (v) => /[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(v) },
];

function PasswordStrength({ password }: { password: string }) {
  const results = PASSWORD_RULES.map((r) => ({ ...r, passed: r.test(password) }));
  const score = results.filter((r) => r.passed).length;
  const colors = ["bg-slate-200", "bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-blue-400", "bg-green-500"];
  const activeColor = colors[score];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= score ? activeColor : "bg-slate-200"}`} />
        ))}
      </div>
      <ul className="space-y-1">
        {results.map((r) => (
          <li key={r.label} className={`flex items-center gap-1.5 text-xs transition-colors ${r.passed ? "text-green-600" : "text-slate-400"}`}>
            <span className="material-symbols-outlined text-[14px]">{r.passed ? "check_circle" : "radio_button_unchecked"}</span>
            {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

type State = "loading" | "ready" | "invalid_token" | "success";

export default function RecoveryPage() {
  const [state, setState] = useState<State>("loading");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Supabase appends the recovery token as a URL hash fragment:
    // #access_token=TOKEN&type=recovery&...
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const type = params.get("type");

    if (accessToken && type === "recovery") {
      setToken(accessToken);
      setState("ready");
      // Clean the token from the URL bar without triggering a reload
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      setState("invalid_token");
    }
  }, []);

  const passwordStrong = useMemo(() => PASSWORD_RULES.every((r) => r.test(password)), [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!passwordStrong) {
      setError("Please meet all password requirements.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await authApi.setPassword(token, password);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen bg-white">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-12 overflow-hidden bg-gradient-to-br from-[#4A1DB5] via-[#632ce5] to-[#7C4DFF]">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(circle at 20% 80%, #fff 1px, transparent 1px), radial-gradient(circle at 80% 20%, #fff 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="relative flex items-center">
          <img src="/brand/omnicrm-logo.png" alt="omnicrm.chat" className="h-12 w-[180px] rounded-2xl object-cover object-center shadow-lg" />
        </div>
        <div className="relative">
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">Set your password</h1>
          <p className="text-white/70 text-lg leading-relaxed">
            Create a strong password to secure your account.
          </p>
        </div>
        <p className="relative text-white/35 text-xs">© 2026 omnicrm.chat. All rights reserved.</p>
      </div>

      {/* Content panel */}
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-[380px]">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center mb-8">
            <img src="/brand/omnicrm-logo.png" alt="omnicrm.chat" className="h-11 w-[165px] rounded-xl object-cover object-center shadow-sm" />
          </div>

          {/* Loading */}
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <span className="material-symbols-outlined text-4xl animate-spin">progress_activity</span>
              <p className="text-sm">Validating your recovery link...</p>
            </div>
          )}

          {/* Invalid token */}
          {state === "invalid_token" && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-red-500 text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>link_off</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Invalid or expired link</h2>
              <p className="text-sm text-slate-500 mb-6">
                This recovery link is invalid or has already been used. Ask an administrator to send a new one.
              </p>
              <Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-[#7C4DFF] hover:text-[#632ce5] transition-colors">
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Back to sign in
              </Link>
            </div>
          )}

          {/* Success */}
          {state === "success" && (
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-green-500 text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Password set!</h2>
              <p className="text-sm text-slate-500 mb-6">
                Your password has been configured. You can now sign in to your account.
              </p>
              <a
                href="/login"
                className="inline-flex items-center justify-center gap-2 w-full h-11 bg-[#7C4DFF] hover:bg-[#632ce5] text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Sign in
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </a>
            </div>
          )}

          {/* Form */}
          {state === "ready" && (
            <>
              <h2 className="text-2xl font-bold text-slate-900 mb-1">Set your password</h2>
              <p className="text-slate-500 text-sm mb-8">Create a strong password to access your account.</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">New password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      autoFocus
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a strong password"
                      className="w-full h-11 px-3.5 pr-10 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm outline-none focus:bg-white focus:border-[#7C4DFF] focus:ring-2 focus:ring-[#7C4DFF]/15 transition-all placeholder:text-slate-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <span className="material-symbols-outlined text-[18px]">{showPassword ? "visibility_off" : "visibility"}</span>
                    </button>
                  </div>
                  <PasswordStrength password={password} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    className={`w-full h-11 px-3.5 rounded-lg bg-slate-50 border text-slate-900 text-sm outline-none focus:bg-white focus:ring-2 transition-all placeholder:text-slate-400 ${
                      confirmPassword && confirmPassword !== password
                        ? "border-red-300 focus:border-red-400 focus:ring-red-400/15"
                        : "border-slate-200 focus:border-[#7C4DFF] focus:ring-[#7C4DFF]/15"
                    }`}
                  />
                  {confirmPassword && confirmPassword !== password && (
                    <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting || !passwordStrong || confirmPassword !== password}
                  className="w-full h-11 bg-[#7C4DFF] hover:bg-[#632ce5] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
                >
                  {submitting ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    "Set password"
                  )}
                </button>

                {error && (
                  <p className="flex items-center gap-1.5 text-xs text-red-500">
                    <span className="material-symbols-outlined text-[14px]">error</span>
                    {error}
                  </p>
                )}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
