"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";

import { campaignsApi, getStoredUser, leadsApi } from "@/lib/api";
import { getDefaultCampaignChannel, getLeadLaunchBlockReason } from "@/lib/campaignLaunch";
import { canSendCampaignStep, getCampaignStepStatusLabel } from "@/lib/campaignSteps";
import type { CampaignDto, CampaignStepDto } from "@/types/campaign";
import type { StoredUser } from "@/types/auth";
import type { LeadDto } from "@/types/lead";

const LABEL_META: Record<string, { label: string; className: string }> = {
  hot: { label: "Hot", className: "bg-rose-50 text-rose-700 ring-1 ring-rose-100" },
  warm: { label: "Warm", className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
  cold: { label: "Cold", className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200" },
  low_confidence: { label: "Low confidence", className: "bg-violet-50 text-violet-700 ring-1 ring-violet-100" },
};
const MAX_PLANNED_STEPS = 8;

function formatScore(value: number | null | undefined) {
  return typeof value === "number" ? `${value}/100` : "Not scored";
}

function formatConfidence(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "No confidence";
}

function labelMeta(label: string | null | undefined) {
  if (!label) return { label: "Unscored", className: "bg-slate-100 text-slate-500 ring-1 ring-slate-200" };
  return LABEL_META[label] ?? { label, className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200" };
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<LeadDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [stepWorkingId, setStepWorkingId] = useState<string | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchResult, setLaunchResult] = useState<CampaignDto | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [objective, setObjective] = useState("Re-engage qualified lead for discovery call");
  const [channel, setChannel] = useState("whatsapp");
  const [followUpIntervalDays, setFollowUpIntervalDays] = useState(2);
  const [plannedSteps, setPlannedSteps] = useState(2);

  async function loadLeads() {
    setLoading(true);
    setError(null);
    try {
      const response = await leadsApi.listLeads({ limit: 100 });
      setLeads(response.data ?? []);
      setSelectedId((current) => current ?? response.data?.[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load leads.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLeads();
  }, []);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedId) ?? leads[0] ?? null,
    [leads, selectedId],
  );
  const launchBlockReason = getLeadLaunchBlockReason(selectedLead);

  async function handleScoreLead() {
    if (!selectedLead) return;
    setScoring(true);
    setError(null);
    try {
      const scored = await leadsApi.scoreLead(selectedLead.id);
      setLeads((current) => current.map((lead) => (lead.id === scored.id ? scored : lead)));
      setSelectedId(scored.id);
    } catch (scoreError) {
      setError(scoreError instanceof Error ? scoreError.message : "Failed to score lead.");
    } finally {
      setScoring(false);
    }
  }

  useEffect(() => {
    setChannel(getDefaultCampaignChannel(selectedLead));
    setLaunchResult(null);
    setReviewDrafts({});
    if (!selectedLead?.active_campaign_id) return;

    let cancelled = false;
    async function loadCampaign() {
      try {
        const campaign = await campaignsApi.getCampaign(selectedLead.active_campaign_id as string);
        if (cancelled) return;
        setLaunchResult(campaign);
        setReviewDrafts(Object.fromEntries((campaign.steps ?? []).map((step) => [
          step.id,
          step.reviewed_content ?? step.generated_content,
        ])));
      } catch {
        if (!cancelled) setLaunchResult(null);
      }
    }

    void loadCampaign();
    return () => {
      cancelled = true;
    };
  }, [selectedLead?.id, selectedLead?.active_campaign_id]);

  async function handleLaunchCampaign() {
    if (!selectedLead) return;
    const blockReason = getLeadLaunchBlockReason(selectedLead);
    if (blockReason) {
      setError(blockReason);
      return;
    }

    const currentUser = getStoredUser<StoredUser>();
    if (!currentUser?.id) {
      setError("Sign in again before launching a campaign.");
      return;
    }

    setLaunching(true);
    setError(null);
    setLaunchResult(null);
    try {
      const result = await campaignsApi.createCampaign({
        objective: objective.trim(),
        channel,
        cadence: {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          follow_up_interval_days: followUpIntervalDays,
          planned_steps: plannedSteps,
        },
        owner_user_id: currentUser.id,
        lead_ids: [selectedLead.id],
      });
      const steps = await campaignsApi.generateCampaignSteps(result.id);
      setLaunchResult({ ...result, steps });
      setReviewDrafts(Object.fromEntries(steps.map((step) => [step.id, step.generated_content])));
      await loadLeads();
      setLaunchOpen(false);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Failed to launch campaign.");
    } finally {
      setLaunching(false);
    }
  }

  function updateLaunchStep(step: CampaignStepDto) {
    setLaunchResult((current) => {
      if (!current) return current;
      const steps = current.steps?.map((item) => (item.id === step.id ? step : item)) ?? [step];
      return { ...current, steps };
    });
    setReviewDrafts((current) => ({
      ...current,
      [step.id]: step.reviewed_content ?? step.generated_content,
    }));
  }

  async function handleApproveStep(step: CampaignStepDto) {
    setStepWorkingId(step.id);
    setError(null);
    try {
      const reviewed = await campaignsApi.reviewCampaignStep(step.id, {
        reviewed_content: reviewDrafts[step.id] ?? step.generated_content,
        approve: true,
      });
      updateLaunchStep(reviewed);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to review campaign step.");
    } finally {
      setStepWorkingId(null);
    }
  }

  async function handleSendStep(step: CampaignStepDto) {
    setStepWorkingId(step.id);
    setError(null);
    try {
      const draft = (reviewDrafts[step.id] ?? step.reviewed_content ?? "").trim();
      const persistedReview = (step.reviewed_content ?? "").trim();
      if (draft && draft !== persistedReview) {
        const reviewed = await campaignsApi.reviewCampaignStep(step.id, {
          reviewed_content: draft,
          approve: true,
        });
        updateLaunchStep(reviewed);
      }
      const sent = await campaignsApi.sendCampaignStep(step.id);
      updateLaunchStep(sent);
      await loadLeads();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send campaign step.");
    } finally {
      setStepWorkingId(null);
    }
  }

  async function handleSkipStep(step: CampaignStepDto) {
    setStepWorkingId(step.id);
    setError(null);
    try {
      const skipped = await campaignsApi.skipCampaignStep(step.id, "operator_skipped");
      updateLaunchStep(skipped);
      await loadLeads();
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : "Failed to skip campaign step.");
    } finally {
      setStepWorkingId(null);
    }
  }

  const meta = labelMeta(selectedLead?.qualification_label);

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-6">
        <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-950">Leads</h1>
              <p className="mt-1 text-sm text-slate-500">Captured commercial intake records with inspectable qualification scoring.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadLeads()}
              className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300"
            >
              Refresh
            </button>
          </div>

          {error ? <p className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}

          <div className="overflow-x-auto">
            <table className="min-w-[820px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                <tr>
                  {["Lead", "Company", "Channel", "Score", "Confidence", "Status", "Sequence"].map((column) => (
                    <th key={column} className="px-5 py-3">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="px-5 py-16 text-center text-slate-500">Loading leads...</td></tr>
                ) : leads.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-16 text-center text-slate-500">No leads captured yet.</td></tr>
                ) : leads.map((lead) => {
                  const active = lead.id === selectedLead?.id;
                  const rowMeta = labelMeta(lead.qualification_label);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedId(lead.id)}
                      className={`cursor-pointer transition hover:bg-slate-50 ${active ? "bg-slate-50 shadow-[inset_3px_0_0_0_rgb(79,70,229)]" : ""}`}
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-900">{lead.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{lead.email ?? lead.phone ?? "No contact signal"}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-600">{lead.company ?? "No company"}</td>
                      <td className="px-5 py-4 text-slate-600">{lead.source_channel}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${rowMeta.className}`}>{rowMeta.label}</span>
                        <p className="mt-1 text-xs text-slate-500">{formatScore(lead.score)}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-600">{formatConfidence(lead.score_confidence)}</td>
                      <td className="px-5 py-4 text-slate-600">{lead.status}</td>
                      <td className="px-5 py-4">
                        {lead.active_sequence_active ? (
                          <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                            Active
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">None</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          {selectedLead ? (
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Lead score</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">{selectedLead.name}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">{formatScore(selectedLead.score)}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">{formatConfidence(selectedLead.score_confidence)}</span>
                </div>
              </div>

              {selectedLead.low_confidence ? (
                <p className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700">
                  This score is low-confidence. Review missing inputs before using it for qualification decisions.
                </p>
              ) : null}

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Rationale</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{selectedLead.score_rationale ?? "No scoring rationale yet."}</p>
                <p className="mt-3 text-xs text-slate-500">Version: {selectedLead.scoring_version ?? "n/a"}</p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">Composition</p>
                  <button
                    type="button"
                    disabled={scoring}
                    onClick={() => void handleScoreLead()}
                    className="inline-flex min-h-9 items-center rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {scoring ? "Scoring..." : "Recalculate"}
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {selectedLead.score_breakdown.length === 0 ? (
                    <p className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">No score composition yet.</p>
                  ) : selectedLead.score_breakdown.map((item) => (
                    <div key={item.component} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">{item.component.replaceAll("_", " ")}</p>
                        <p className="text-sm font-semibold text-slate-700">{item.points}{typeof item.max_points === "number" && item.max_points > 0 ? `/${item.max_points}` : ""}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{item.source}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Outreach</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {selectedLead.active_sequence_active
                        ? `Active ${selectedLead.active_campaign_channel ?? "campaign"} sequence${selectedLead.active_campaign_name ? `: ${selectedLead.active_campaign_name}` : "."}`
                        : "No active outreach sequence for this lead."}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(launchBlockReason)}
                    onClick={() => setLaunchOpen((open) => !open)}
                    className="inline-flex min-h-9 items-center rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Launch
                  </button>
                </div>

                {launchBlockReason ? <p className="mt-3 text-xs text-slate-500">{launchBlockReason}</p> : null}
                {launchResult ? (
                  <div className="mt-3 space-y-3">
                    <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      Campaign launched with {launchResult.included_count} lead{launchResult.included_count === 1 ? "" : "s"}.
                    </p>
                    {launchResult.steps?.length ? (
                      <div className="space-y-3">
                        {launchResult.steps.map((step) => {
                          const working = stepWorkingId === step.id;
                          const canApprove = step.status === "needs_review";
                          const reviewedContent = reviewDrafts[step.id] ?? step.reviewed_content ?? "";
                          const canSend = canSendCampaignStep({ ...step, reviewed_content: reviewedContent.trim() });
                          return (
                            <div key={step.id} className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  {step.position}. {step.step_type.replaceAll("_", " ")}
                                </p>
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                  {getCampaignStepStatusLabel(step)}
                                </span>
                              </div>
                              {step.status === "skipped" || step.status === "failed" ? (
                                <p className="mt-2 text-xs text-rose-600">{step.failure_reason ?? step.skip_reason}</p>
                              ) : (
                                <>
                                  <textarea
                                    value={reviewDrafts[step.id] ?? step.reviewed_content ?? step.generated_content}
                                    onChange={(event) => setReviewDrafts((current) => ({ ...current, [step.id]: event.target.value }))}
                                    rows={5}
                                    disabled={step.status === "sent" || working}
                                    className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100 disabled:text-slate-500"
                                  />
                                  <div className="mt-3 flex gap-2">
                                    <button
                                      type="button"
                                      disabled={!canApprove || working}
                                      onClick={() => void handleApproveStep(step)}
                                      className="inline-flex min-h-9 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                      {working && canApprove ? "Approving..." : "Approve"}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={!canSend || working}
                                      onClick={() => void handleSendStep(step)}
                                      className="inline-flex min-h-9 flex-1 items-center justify-center rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                                    >
                                      {working && canSend ? "Sending..." : "Send"}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={step.status === "sent" || step.status === "skipped" || working}
                                      onClick={() => void handleSkipStep(step)}
                                      className="inline-flex min-h-9 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-500 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                                    >
                                      {working && !canApprove && !canSend ? "Skipping..." : "Skip"}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {launchOpen && !launchBlockReason ? (
                  <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                    <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Objective
                      <textarea
                        value={objective}
                        onChange={(event) => setObjective(event.target.value)}
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Channel
                        <select
                          value={channel}
                          onChange={(event) => setChannel(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        >
                          <option value="whatsapp">WhatsApp</option>
                          <option value="telegram">Telegram</option>
                          <option value="email">Email</option>
                          <option value="sms">SMS</option>
                        </select>
                      </label>
                      <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Interval
                        <input
                          type="number"
                          min={1}
                          value={followUpIntervalDays}
                          onChange={(event) => setFollowUpIntervalDays(Math.max(1, Number(event.target.value) || 1))}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        />
                      </label>
                      <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Steps
                        <input
                          type="number"
                          min={1}
                          max={MAX_PLANNED_STEPS}
                          value={plannedSteps}
                          onChange={(event) => setPlannedSteps(Math.min(MAX_PLANNED_STEPS, Math.max(1, Number(event.target.value) || 1)))}
                          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      disabled={launching || objective.trim().length === 0}
                      onClick={() => void handleLaunchCampaign()}
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {launching ? "Launching..." : "Create campaign"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a lead to inspect scoring composition.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
