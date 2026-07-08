"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { authApi } from "@/lib/api/index";

function ResetPasswordPageInner() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  const passwordChecks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/.test(password),
  };

  const allChecksPass = Object.values(passwordChecks).every(Boolean);

  useEffect(() => {
    console.log('Reset password page loaded at:', window.location.href);
    const queryToken = searchParams.get("token") || searchParams.get("access_token") || searchParams.get("code");

    // Parse hash as query string
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const hashToken = hashParams.get("access_token") || hashParams.get("token") || hashParams.get("code");

    const finalToken = queryToken || hashToken;
    setToken(finalToken);

    console.log('Search params:', Object.fromEntries(searchParams.entries()));
    console.log('Hash:', window.location.hash);
    console.log('Hash params:', Object.fromEntries(hashParams.entries()));
    console.log('Final token:', finalToken);

    if (!finalToken) {
      setError("Invalid reset link. Missing token.");
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!allChecksPass) {
      setError("Password does not meet all requirements. Check the list above.");
      return;
    }
    setError("");
    setLoading(true);
    if (!token) { setError("Missing recovery token."); setLoading(false); return; }
    try {
      await authApi.setPassword(token, password);
      setSuccess(true);
      setTimeout(() => router.push("/login"), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error.");
    } finally {
      setLoading(false);
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
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/15 rounded-full text-white/80 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-green-300 animate-pulse" />
            Platform powered by AI
          </div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Set your new password
          </h1>
          <p className="text-white/70 text-lg leading-relaxed mb-10">
            Choose a strong password for your account.
          </p>
        </div>

        <p className="relative text-white/35 text-xs">© 2026 omnicrm.chat. All rights reserved.</p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-[380px]">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center mb-8">
            <img src="/brand/omnicrm-logo.png" alt="omnicrm.chat" className="h-11 w-[165px] rounded-xl object-cover object-center shadow-sm" />
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-1">Reset password</h2>
          <p className="text-slate-500 text-sm mb-8">Enter your new password below.</p>

          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-green-600 text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Password updated!</h3>
              <p className="text-slate-500 text-sm mb-6">
                Your password has been successfully reset. You can now sign in with your new password.
              </p>
              <p className="text-sm text-slate-400">Redirecting to login...</p>
            </div>
          ) : token === null ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-red-600 text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Invalid link</h3>
              <p className="text-slate-500 text-sm mb-6">
                This password reset link is invalid or expired.
              </p>
              <Link href="/forgot-password" className="inline-flex items-center gap-2 bg-[#7C4DFF] hover:bg-[#632ce5] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                Request new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  New password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 px-3.5 pr-10 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm outline-none focus:bg-white focus:border-[#7C4DFF] focus:ring-2 focus:ring-[#7C4DFF]/15 transition-all placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>

                {/* Password strength checklist */}
                <div className="mt-3 space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`material-symbols-outlined text-[16px] ${passwordChecks.length ? 'text-green-500' : 'text-slate-400'}`}>
                      {passwordChecks.length ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className={passwordChecks.length ? 'text-green-700' : 'text-slate-500'}>
                      At least 8 characters
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`material-symbols-outlined text-[16px] ${passwordChecks.uppercase ? 'text-green-500' : 'text-slate-400'}`}>
                      {passwordChecks.uppercase ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className={passwordChecks.uppercase ? 'text-green-700' : 'text-slate-500'}>
                      One uppercase letter (A-Z)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`material-symbols-outlined text-[16px] ${passwordChecks.lowercase ? 'text-green-500' : 'text-slate-400'}`}>
                      {passwordChecks.lowercase ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className={passwordChecks.lowercase ? 'text-green-700' : 'text-slate-500'}>
                      One lowercase letter (a-z)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`material-symbols-outlined text-[16px] ${passwordChecks.number ? 'text-green-500' : 'text-slate-400'}`}>
                      {passwordChecks.number ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className={passwordChecks.number ? 'text-green-700' : 'text-slate-500'}>
                      One number (0-9)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`material-symbols-outlined text-[16px] ${passwordChecks.special ? 'text-green-500' : 'text-slate-400'}`}>
                      {passwordChecks.special ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <span className={passwordChecks.special ? 'text-green-700' : 'text-slate-500'}>
                      One special character (!@#$%^&*)
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Confirm new password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 px-3.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm outline-none focus:bg-white focus:border-[#7C4DFF] focus:ring-2 focus:ring-[#7C4DFF]/15 transition-all placeholder:text-slate-400"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-[#7C4DFF] hover:bg-[#632ce5] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    Update password
                    <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      lock_reset
                    </span>
                  </>
                )}
              </button>

              {error && (
                <p className="flex items-center gap-1.5 text-xs text-red-500 mt-2">
                  <span className="material-symbols-outlined text-[14px]">error</span>
                  {error}
                </p>
              )}
            </form>
          )}

          <p className="text-center text-sm text-slate-500 mt-6">
            Remember your password?{" "}
            <Link href="/login" className="font-semibold text-[#7C4DFF] hover:text-[#632ce5] transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400"><span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span></div>}>
      <ResetPasswordPageInner />
    </Suspense>
  );
}
