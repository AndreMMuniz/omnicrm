"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { projectsApi, proposalsApi } from "@/lib/api";
import type { ProjectDto, ProjectStageKey } from "@/types/project";
import type { ProposalDto, ProposalStatus } from "@/types/proposal";

type OpportunityStageFilter = "all" | ProjectStageKey;

type OpportunitySummary = {
  id: string;
  project: ProjectDto;
  companyId: string | null;
  companyLabel: string;
  ownerLabel: string;
  relatedProposals: ProposalDto[];
  proposalSignal: string;
  nextAction: string;
};

const STAGE_META: Record<ProjectStageKey, { label: string; className: string }> = {
  lead: { label: "Lead", className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200" },
  qualification: { label: "Qualification", className: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100" },
  proposal: { label: "Proposal", className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
  negotiation: { label: "Negotiation", className: "bg-orange-50 text-orange-700 ring-1 ring-orange-100" },
  closed: { label: "Closed", className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" },
};

const PROPOSAL_STATUS_META: Record<ProposalStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200" },
  sent: { label: "Sent", className: "bg-sky-50 text-sky-700 ring-1 ring-sky-100" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" },
  rejected: { label: "Rejected", className: "bg-rose-50 text-rose-700 ring-1 ring-rose-100" },
  archived: { label: "Archived", className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
  expired: { label: "Expired", className: "bg-orange-50 text-orange-700 ring-1 ring-orange-100" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-500 ring-1 ring-gray-200" },
};

function getStageFilter(value: string | null | undefined): OpportunityStageFilter {
  if (value === "lead" || value === "qualification" || value === "proposal" || value === "negotiation" || value === "closed") {
    return value;
  }
  return "all";
}

function formatDateLabel(iso: string | null | undefined) {
  if (!iso) return "No activity";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(value: number | null | undefined) {
  if (!value) return "Value not set";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

function buildProposalCreateHref(opportunity: OpportunitySummary) {
  if (!opportunity.companyId) return "/proposals?create=1";
  const params = new URLSearchParams({
    create: "1",
    clientId: opportunity.companyId,
    title: opportunity.project.title,
  });
  return `/proposals?${params.toString()}`;
}

function getProposalSignal(proposals: ProposalDto[], hasCompany: boolean) {
  if (!hasCompany) return "Link company first";
  if (proposals.some((proposal) => proposal.status === "approved")) return "Approved proposal";
  if (proposals.some((proposal) => proposal.status === "sent")) return "Sent proposal";
  if (proposals.some((proposal) => proposal.status === "draft")) return "Draft proposal";
  if (proposals.some((proposal) => proposal.status === "rejected" || proposal.status === "cancelled")) return "Needs proposal rework";
  if (proposals.length > 0) return `${proposals.length} proposal records`;
  return "No proposal yet";
}

function getNextAction(project: ProjectDto, proposals: ProposalDto[], hasCompany: boolean) {
  if (!hasCompany) return "Link a company before commercial follow-up.";
  if (project.stage === "lead") return "Qualify the account and confirm scope.";
  if (project.stage === "qualification" && proposals.length === 0) return "Create the first proposal draft.";
  if (proposals.some((proposal) => proposal.status === "sent")) return "Follow up on the sent proposal.";
  if (proposals.some((proposal) => proposal.status === "approved")) return "Move the opportunity toward delivery handoff.";
  if (project.stage === "closed") return "Confirm outcome and preserve account context.";
  return "Keep project, company, and proposal context aligned.";
}

function matchesOpportunity(summary: OpportunitySummary, search: string, stageFilter: OpportunityStageFilter) {
  if (stageFilter !== "all" && summary.project.stage !== stageFilter) return false;
  if (!search.trim()) return true;

  const query = search.trim().toLowerCase();
  const searchable = [
    summary.project.reference,
    summary.project.title,
    summary.companyLabel,
    summary.ownerLabel,
    summary.project.contact_name ?? "",
    summary.project.owner_name ?? "",
    summary.project.client?.company_name ?? "",
    summary.proposalSignal,
    ...summary.relatedProposals.flatMap((proposal) => [proposal.reference, proposal.title, proposal.status]),
  ]
    .join(" ")
    .toLowerCase();

  return searchable.includes(query);
}

export function OpportunitiesWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedOpportunityId = searchParams.get("opportunityId");
  const search = searchParams.get("search") ?? "";
  const stage = getStageFilter(searchParams.get("stage"));

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [proposals, setProposals] = useState<ProposalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function updateUrl(next: { opportunityId?: string | null; search?: string; stage?: OpportunityStageFilter }) {
    const params = new URLSearchParams();
    const nextOpportunityId = next.opportunityId === undefined ? selectedOpportunityId : next.opportunityId;
    const nextSearch = next.search === undefined ? search : next.search;
    const nextStage = next.stage === undefined ? stage : next.stage;

    if (nextOpportunityId) params.set("opportunityId", nextOpportunityId);
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    if (nextStage !== "all") params.set("stage", nextStage);

    startTransition(() => {
      router.replace(params.toString() ? `/clients/opportunities?${params.toString()}` : "/clients/opportunities");
    });
  }

  useEffect(() => {
    async function loadWorkspace() {
      setLoading(true);
      setError(null);
      try {
        const [projectsResponse, proposalsResponse] = await Promise.all([
          projectsApi.listProjects({ limit: 200 }),
          proposalsApi.listProposals({ limit: 200 }),
        ]);
        setProjects(projectsResponse.data ?? []);
        setProposals(proposalsResponse.data ?? []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load opportunities.");
      } finally {
        setLoading(false);
      }
    }

    void loadWorkspace();
  }, []);

  const opportunities = useMemo(() => {
    const proposalsByClient = new Map<string, ProposalDto[]>();

    for (const proposal of proposals) {
      if (!proposal.client_id) continue;
      const current = proposalsByClient.get(proposal.client_id) ?? [];
      current.push(proposal);
      current.sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
      proposalsByClient.set(proposal.client_id, current);
    }

    return projects.map((project) => {
      const companyId = project.client?.deleted_at ? null : (project.client_id ?? project.client?.id ?? null);
      const companyLabel = project.client?.name || project.client?.company_name || "No linked company";
      const ownerLabel = project.owner_name || "Unassigned";
      const relatedProposals = companyId ? proposalsByClient.get(companyId) ?? [] : [];

      return {
        id: project.id,
        project,
        companyId,
        companyLabel,
        ownerLabel,
        relatedProposals,
        proposalSignal: getProposalSignal(relatedProposals, Boolean(companyId)),
        nextAction: getNextAction(project, relatedProposals, Boolean(companyId)),
      } satisfies OpportunitySummary;
    });
  }, [projects, proposals]);

  const visibleOpportunities = useMemo(
    () => opportunities.filter((summary) => matchesOpportunity(summary, search, stage)),
    [opportunities, search, stage],
  );

  const selectedOpportunity =
    visibleOpportunities.find((summary) => summary.id === selectedOpportunityId)
    ?? visibleOpportunities[0]
    ?? null;

  const proposalStageCount = opportunities.filter((summary) => summary.project.stage === "proposal" || summary.project.stage === "negotiation").length;
  const activeProposalCount = opportunities.filter((summary) => summary.relatedProposals.some((proposal) => proposal.status === "draft" || proposal.status === "sent")).length;
  const linkedCompanyCount = opportunities.filter((summary) => summary.companyId).length;

  useEffect(() => {
    if (!selectedOpportunity && selectedOpportunityId) {
      updateUrl({ opportunityId: null });
      return;
    }
    if (!selectedOpportunity || selectedOpportunity.id === selectedOpportunityId) return;
    updateUrl({ opportunityId: selectedOpportunity.id });
  }, [selectedOpportunity, selectedOpportunityId]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eff6ff_48%,#eef2ff_100%)]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
        <section className="rounded-[32px] border border-white/70 bg-white/80 p-5 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.55)] backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Clients</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Opportunities</h1>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {visibleOpportunities.length} visible
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                CRM-oriented layer over the current project pipeline, proposal queue, and linked company context.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/projects"
                className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
              >
                Open pipeline board
              </Link>
              <Link
                href="/proposals?create=1"
                className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                New proposal draft
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Commercial motion</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{proposalStageCount}</p>
              <p className="mt-1 text-sm text-slate-500">Opportunities sitting in proposal or negotiation stages.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Proposal-ready accounts</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{linkedCompanyCount}</p>
              <p className="mt-1 text-sm text-slate-500">Opportunities already linked to a company record.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Active proposal signal</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{activeProposalCount}</p>
              <p className="mt-1 text-sm text-slate-500">Projects with draft or sent proposals ready for follow-up.</p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <label className="flex min-h-12 flex-1 items-center rounded-2xl border border-slate-200 bg-slate-50 px-4">
              <span className="mr-3 text-slate-400">Search</span>
              <input
                value={search}
                onChange={(event) => updateUrl({ search: event.target.value, opportunityId: null })}
                placeholder="Search by company, project, owner, or proposal signal..."
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>

            <div className="inline-flex flex-wrap rounded-full border border-slate-200 bg-slate-50 p-1">
              {[
                { value: "all" as const, label: "All stages" },
                { value: "lead" as const, label: "Lead" },
                { value: "proposal" as const, label: "Proposal" },
                { value: "negotiation" as const, label: "Negotiation" },
                { value: "closed" as const, label: "Closed" },
              ].map((option) => {
                const active = stage === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateUrl({ stage: option.value, opportunityId: null })}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? (
            <div className="mt-4">
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
            </div>
          ) : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_380px]">
          <div className="overflow-hidden rounded-[32px] border border-white/70 bg-white/85 shadow-[0_22px_55px_-44px_rgba(15,23,42,0.7)] backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Opportunity table</p>
                <p className="mt-1 text-xs text-slate-500">Use project stages as the commercial backbone, then layer proposal and account context on top.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {loading ? "Loading..." : `${visibleOpportunities.length} rows`}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full text-sm">
                <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  <tr>
                    {["Opportunity", "Company", "Stage", "Proposal signal", "Owner", "Next action"].map((column) => (
                      <th key={column} className="px-4 py-3 first:px-5">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-sm text-slate-500">Loading opportunities...</td>
                    </tr>
                  ) : visibleOpportunities.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center text-sm text-slate-500">No opportunities matched this CRM view.</td>
                    </tr>
                  ) : (
                    visibleOpportunities.map((summary) => {
                      const selected = summary.id === selectedOpportunity?.id;
                      return (
                        <tr
                          key={summary.id}
                          aria-selected={selected}
                          onClick={() => updateUrl({ opportunityId: summary.id })}
                          className={`cursor-pointer transition hover:bg-slate-50 ${selected ? "bg-slate-50/90 shadow-[inset_3px_0_0_0_rgb(15,23,42)]" : ""}`}
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold text-slate-900">{summary.project.title}</div>
                            <div className="mt-1 text-xs text-slate-500">{summary.project.reference} · {formatCurrency(summary.project.value ?? null)}</div>
                          </td>
                          <td className="px-4 py-4 text-slate-600">{summary.companyLabel}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STAGE_META[summary.project.stage].className}`}>
                              {STAGE_META[summary.project.stage].label}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-slate-600">{summary.proposalSignal}</td>
                          <td className="px-4 py-4 text-slate-600">{summary.ownerLabel}</td>
                          <td className="px-4 py-4 text-slate-600">{summary.nextAction}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_22px_55px_-44px_rgba(15,23,42,0.7)] backdrop-blur">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Opportunity panel</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {selectedOpportunity?.project.title ?? "Select an opportunity"}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {selectedOpportunity
                  ? "Jump between pipeline context, linked company, and proposal follow-up without leaving the CRM group."
                  : "Choose a row to inspect its current stage, account context, and proposal path."}
              </p>
            </div>

            {selectedOpportunity ? (
              <div className="mt-5 space-y-5">
                <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-900">{selectedOpportunity.project.reference}</span>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STAGE_META[selectedOpportunity.project.stage].className}`}>
                      {STAGE_META[selectedOpportunity.project.stage].label}
                    </span>
                  </div>
                  <div className="grid gap-2 text-xs">
                    <p>Owner: {selectedOpportunity.ownerLabel}</p>
                    <p>Value: {formatCurrency(selectedOpportunity.project.value ?? null)}</p>
                    <p>Updated: {formatDateLabel(selectedOpportunity.project.updated_at)}</p>
                    <p>Next action: {selectedOpportunity.nextAction}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Linked company</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{selectedOpportunity.companyLabel}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {selectedOpportunity.companyId
                          ? `${selectedOpportunity.project.client?.company_name || "Primary account record"} · ${selectedOpportunity.project.client?.country || "Country n/a"}`
                          : "This opportunity still needs a company record before proposal work becomes reliable."}
                      </p>
                    </div>
                    {selectedOpportunity.companyId ? (
                      <Link
                        href={`/clients/companies?companyId=${selectedOpportunity.companyId}`}
                        className="inline-flex rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                      >
                        Open company
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Proposal relationship</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{selectedOpportunity.proposalSignal}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {selectedOpportunity.relatedProposals.length > 0
                          ? "Open the live proposal queue from the same company context."
                          : "No proposal linked through the company context yet."}
                      </p>
                    </div>
                    <Link
                      href={buildProposalCreateHref(selectedOpportunity)}
                      className="inline-flex rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                    >
                      Create proposal
                    </Link>
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedOpportunity.relatedProposals.length === 0 ? (
                      <p className="text-sm text-slate-500">No related proposals yet.</p>
                    ) : (
                      selectedOpportunity.relatedProposals.slice(0, 3).map((proposal) => (
                        <Link
                          key={proposal.id}
                          href={`/proposals?proposalId=${proposal.id}`}
                          className="block rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-900">{proposal.title}</span>
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${PROPOSAL_STATUS_META[proposal.status].className}`}>
                              {PROPOSAL_STATUS_META[proposal.status].label}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{proposal.reference} · {formatCurrency(proposal.total_amount)}</p>
                        </Link>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Project context</p>
                      <p className="mt-2 text-sm text-slate-600">
                        Use the underlying pipeline artifact whenever the opportunity needs deeper editing or stage movement.
                      </p>
                    </div>
                    <Link
                      href={`/projects?projectId=${selectedOpportunity.project.id}`}
                      className="inline-flex rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      Open project
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2 text-xs text-slate-500">
                    <p>Contact: {selectedOpportunity.project.contact_name || selectedOpportunity.project.contact?.name || "No contact linked"}</p>
                    <p>Origin: {selectedOpportunity.project.source_type === "message" ? "Conversation-created" : "Manual project"}</p>
                    <p>Channel: {selectedOpportunity.project.channel || "Not specified"}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      </div>
    </div>
  );
}
