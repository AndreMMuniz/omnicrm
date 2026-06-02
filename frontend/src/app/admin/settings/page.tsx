"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ConfigAreaShell from "@/components/admin/ConfigAreaShell";
import { settingsApi } from "@/lib/api/index";
import type { Settings } from "@/types/settings";
import QuickRepliesPage from "@/app/admin/quick-replies/page";

type TabId = "general" | "visual" | "ai" | "quick-replies";
const ALLOWED_TABS: TabId[] = ["general", "visual", "ai", "quick-replies"];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full h-11 px-4 rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all outline-none text-slate-900 text-sm";

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputCls} />;
}

function SectionCard({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E9ECEF] bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-[#E9ECEF] bg-slate-50/50 px-6 py-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{title}</h2>
        {badge && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            {badge}
          </span>
        )}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const searchTab = searchParams.get("tab");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const activeTab: TabId = searchTab && ALLOWED_TABS.includes(searchTab as TabId) ? (searchTab as TabId) : "general";

  useEffect(() => {
    settingsApi
      .getSettings()
      .then((data) =>
        setSettings({
          app_name: "",
          app_email: "",
          app_logo: "",
          primary_color: "#0F172A",
          secondary_color: "#3B82F6",
          accent_color: "#10B981",
          ai_model: "gpt-4o-mini",
          ai_provider: "openrouter",
          telegram_bot_token: "",
          whatsapp_phone_id: "",
          whatsapp_account_id: "",
          whatsapp_access_token: "",
          whatsapp_webhook_token: "",
          email_imap_host: "",
          email_imap_port: "993",
          email_smtp_host: "",
          email_smtp_port: "587",
          email_address: "",
          email_password: "",
          twilio_account_sid: "",
          twilio_auth_token: "",
          twilio_phone_number: "",
          ...Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k, v ?? ""])),
        }),
      )
      .catch((err: Error) => setError(err.message || "Failed to load settings."))
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setSettings((s) => (s ? { ...s, [key]: e.target.value } : null));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setSaving(true);
    setError("");
    setSuccess(false);

    try {
      await settingsApi.updateSettings({
        ...settings,
        email_imap_port: settings.email_imap_port ? String(Number(settings.email_imap_port)) : "",
        email_smtp_port: settings.email_smtp_port ? String(Number(settings.email_smtp_port)) : "",
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined animate-spin text-4xl text-indigo-600">progress_activity</span>
          <p className="font-medium text-slate-500">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-4xl text-red-400">error</span>
          <p className="font-medium text-slate-700">Failed to load settings</p>
          <p className="text-sm text-slate-500">{error || "Could not connect to the backend."}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const s = settings;
  return (
    <ConfigAreaShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center border-b border-[#E9ECEF] bg-white px-6">
          <h1 className="text-[18px] font-semibold text-slate-900">Platform Configuration</h1>
        </header>

        {activeTab === "quick-replies" && (
          <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
            <QuickRepliesPage />
          </div>
        )}

        <div className={activeTab === "quick-replies" ? "hidden" : "flex-1"}>
          <form onSubmit={handleSave}>
            <div className="mx-auto max-w-3xl space-y-6 p-6 pb-12">
              {error && (
                <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
                  <span className="material-symbols-outlined">error</span>
                  <p className="text-sm font-medium">{error}</p>
                </div>
              )}
              {success && (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
                  <span className="material-symbols-outlined">check_circle</span>
                  <p className="text-sm font-medium">Settings saved successfully!</p>
                </div>
              )}

              {activeTab === "general" && (
                <SectionCard title="General Information">
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <Field label="Application Name">
                      <TextInput value={s.app_name} onChange={set("app_name")} placeholder="omnicrm.chat" />
                    </Field>
                    <Field label="Support Email">
                      <TextInput type="email" value={s.app_email} onChange={set("app_email")} placeholder="support@company.com" />
                    </Field>
                  </div>
                </SectionCard>
              )}

              {activeTab === "visual" && (
                <SectionCard title="Visual Identity">
                  <div className="space-y-8">
                    <div className="flex flex-col items-start gap-6 md:flex-row">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                        {s.app_logo ? (
                          <img src={s.app_logo} alt="Logo" className="h-full w-full object-contain p-2" />
                        ) : (
                          <span className="material-symbols-outlined text-3xl text-slate-400">image</span>
                        )}
                      </div>
                      <div className="flex-1">
                        <Field label="Logo URL" hint="Recommended: 256x256px PNG or SVG">
                          <TextInput value={s.app_logo} onChange={set("app_logo")} placeholder="https://example.com/logo.png" />
                        </Field>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                      {(["primary_color", "secondary_color", "accent_color"] as const).map((key) => (
                        <Field key={key} label={key.replace("_color", "").replace("_", " ").replace(/^\w/, (c) => c.toUpperCase()) + " Color"}>
                          <div className="flex gap-2">
                            <input
                              type="color"
                              value={s[key]}
                              onChange={set(key)}
                              className="h-11 w-11 cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                            />
                            <TextInput value={s[key]} onChange={set(key)} className={inputCls + " font-mono"} />
                          </div>
                        </Field>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              )}

              {activeTab === "ai" && (
                <SectionCard title="AI Configuration">
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <Field label="Model Provider">
                        <select value={s.ai_provider} onChange={set("ai_provider")} className={inputCls + " cursor-pointer"}>
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="google">Google Gemini</option>
                          <option value="openrouter">OpenRouter (Recommended)</option>
                          <option value="groq">Groq</option>
                        </select>
                      </Field>
                      <Field label="Global AI Model">
                        <select value={s.ai_model} onChange={set("ai_model")} className={inputCls + " cursor-pointer"}>
                          <option value="gpt-4o">GPT-4o</option>
                          <option value="gpt-4o-mini">GPT-4o mini</option>
                          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
                          <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                          <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                        </select>
                      </Field>
                    </div>
                    <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                      <span className="font-bold text-slate-700">Note:</span> This model will be used by all agents across the platform unless overridden individually.
                    </p>
                  </div>
                </SectionCard>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-[#E9ECEF] pt-2">
                <button
                  type="button"
                  onClick={() => setSuccess(false)}
                  className="h-11 rounded-xl border border-[#E9ECEF] px-6 text-sm font-medium text-slate-600 transition-all hover:bg-white hover:shadow-sm"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-11 items-center gap-2 rounded-xl bg-indigo-600 px-8 text-sm font-bold text-white shadow-lg shadow-indigo-200 transition-all hover:bg-indigo-700 disabled:opacity-60"
                >
                  {saving ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[20px]">save</span>
                      Save Configuration
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </ConfigAreaShell>
  );
}
