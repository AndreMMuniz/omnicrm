"use client";

import { useState } from "react";
import Link from "next/link";
import { authApi } from "@/lib/api/index";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSuccess(true);
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
            Reset your password
          </h1>
          <p className="text-white/70 text-lg leading-relaxed mb-10">
            Enter your email address and we'll send you a link to reset your password.
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

          <h2 className="text-2xl font-bold text-slate-900 mb-1">Forgot password</h2>
          <p className="text-slate-500 text-sm mb-8">Enter your email to receive a reset link.</p>

          {success ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-green-600 text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Check your email</h3>
              <p className="text-slate-500 text-sm mb-6">
                We've sent a password reset link to <strong>{email}</strong>
              </p>
              <Link href="/login" className="inline-flex items-center gap-2 bg-[#7C4DFF] hover:bg-[#632ce5] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
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
                    Sending...
                  </>
                ) : (
                  <>
                    Send reset link
                    <span className="material-symbols-outlined text-[18px]">send</span>
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
