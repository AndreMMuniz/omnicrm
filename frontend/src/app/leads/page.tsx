"use client";

import { useEffect, useMemo, useState } from "react";

import { leadsApi } from "@/lib/api";
import type { LeadDto } from "@/types/lead";

const LABEL_META: Record<string, { label: string; className: string }> = {
  hot: { label: "Hot", className: "bg-rose-50 text-rose-700 ring-1 ring-rose-100" },
  warm: { label: "Warm", className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
  cold: { label: "Cold", className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200" },
  low_confidence: { label: "Low confidence", className: "bg-violet-50 text-violet-700 ring-1 ring-violet-100" },
};

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
  const [error, setError] = useState<string | null>(null);

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
                  {["Lead", "Company", "Channel", "Score", "Confidence", "Status"].map((column) => (
                    <th key={column} className="px-5 py-3">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={6} className="px-5 py-16 text-center text-slate-500">Loading leads...</td></tr>
                ) : leads.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-16 text-center text-slate-500">No leads captured yet.</td></tr>
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
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select a lead to inspect scoring composition.</p>
          )}
        </aside>
      </div>
    </main>
  );
}
