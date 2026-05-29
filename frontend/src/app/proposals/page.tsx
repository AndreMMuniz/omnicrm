"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Modal from "@/components/shared/Modal";
import { useAuth } from "@/hooks/useAuth";
import { clientsApi, proposalsApi } from "@/lib/api/index";
import type {
  ProposalCreateRequest, ProposalDetailDto, ProposalDto, ProposalItemDto,
  ProposalServiceDetailsDto, ProposalServiceDetailsRequest,
  ProposalStatusHistoryDto, ProposalStatus, ProposalType,
} from "@/types/proposal";
import type { ClientListDto } from "@/types/client";

// ─── status meta ─────────────────────────────────────────────────────────────

const STATUS_META: Record<ProposalStatus, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200" },
  sent:      { label: "Sent",      className: "bg-sky-50 text-sky-700 ring-1 ring-sky-100" },
  approved:  { label: "Approved",  className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" },
  rejected:  { label: "Rejected",  className: "bg-rose-50 text-rose-700 ring-1 ring-rose-100" },
  archived:  { label: "Archived",  className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
  expired:   { label: "Expired",   className: "bg-orange-50 text-orange-700 ring-1 ring-orange-100" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-500 ring-1 ring-gray-200" },
};

const PAYMENT_PRESETS = [
  "Upfront (full payment)",
  "50% upfront + 50% on delivery",
  "30/60/90 days",
  "Monthly (recurring)",
  "Custom",
];

// ─── tipos locais ─────────────────────────────────────────────────────────────

type ProposalFormState = {
  title: string;
  customer_name: string;
  notes: string;
  client_id: string;
  proposal_type: ProposalType | "";
  payment_method: string;
  payment_terms: string;
  payment_installments: string;
  delivery_mode: "date" | "days";
  delivery_deadline: string;
  delivery_days: string;
  valid_until: string;
};

const EMPTY_FORM: ProposalFormState = {
  title: "", customer_name: "", notes: "",
  client_id: "", proposal_type: "",
  payment_method: "", payment_terms: "", payment_installments: "",
  delivery_mode: "days", delivery_deadline: "", delivery_days: "",
  valid_until: "",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number, currency = "BRL") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function proposalToForm(p: ProposalDetailDto): ProposalFormState {
  return {
    title: p.title,
    customer_name: p.customer_name ?? "",
    notes: p.notes ?? "",
    client_id: p.client_id ?? "",
    proposal_type: (p.proposal_type as ProposalType) ?? "",
    payment_method: p.payment_method ?? "",
    payment_terms: p.payment_terms ?? "",
    payment_installments: p.payment_installments ? String(p.payment_installments) : "",
    delivery_mode: p.delivery_deadline ? "date" : "days",
    delivery_deadline: p.delivery_deadline ?? "",
    delivery_days: p.delivery_days ? String(p.delivery_days) : "",
    valid_until: p.valid_until ?? "",
  };
}

function formToPayload(f: ProposalFormState): Partial<ProposalCreateRequest> {
  return {
    title: f.title.trim() || undefined,
    customer_name: f.customer_name.trim() || null,
    notes: f.notes.trim() || null,
    client_id: f.client_id || null,
    proposal_type: (f.proposal_type as ProposalType) || null,
    payment_method: f.payment_method || null,
    payment_terms: f.payment_terms || null,
    payment_installments: f.payment_installments ? Number(f.payment_installments) : null,
    delivery_deadline: f.delivery_mode === "date" ? (f.delivery_deadline || null) : null,
    delivery_days: f.delivery_mode === "days" ? (f.delivery_days ? Number(f.delivery_days) : null) : null,
    valid_until: f.valid_until || null,
  };
}

// ─── Seletor de cliente ───────────────────────────────────────────────────────

function ClientSelector({
  value,
  onChange,
  clients,
}: {
  value: string;
  onChange: (id: string, name: string) => void;
  clients: ClientListDto[];
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const selected = clients.find((c) => c.id === value);
  const filtered = clients.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.company_name ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="relative">
      <div
        className="w-full flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? (
          <span className="text-slate-700 truncate">{selected.name}</span>
        ) : (
          <span className="text-slate-400">Selecionar cliente...</span>
        )}
        <span className="material-symbols-outlined text-[16px] text-slate-400 shrink-0">
          {open ? "expand_less" : "expand_more"}
        </span>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou e-mail..."
              className="w-full px-2 py-1.5 text-sm text-slate-700 outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange("", ""); setOpen(false); setSearch(""); }}
              className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:bg-slate-50"
            >
              Nenhum cliente
            </button>
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id, c.name); setOpen(false); setSearch(""); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${value === c.id ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-700"}`}
              >
                <span className="block truncate">{c.name}</span>
                {c.company_name && <span className="block text-xs text-slate-400 truncate">{c.company_name}</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-sm text-slate-400 text-center">Nenhum cliente encontrado</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ProposalsPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const requestedProposalId = searchParams.get("proposalId");
  const shouldOpenCreate = searchParams.get("create") === "1";
  const prefillClientId = searchParams.get("clientId") ?? "";
  const prefillTitle = searchParams.get("title") ?? "";
  const requestedStatus = searchParams.get("status");

  const [proposals, setProposals] = useState<ProposalDto[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<ProposalDetailDto | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(requestedProposalId);
  const [proposalForm, setProposalForm] = useState<ProposalFormState>(EMPTY_FORM);
  const [createForm, setCreateForm] = useState<ProposalFormState>(EMPTY_FORM);
  const [clients, setClients] = useState<ClientListDto[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [proposalPendingDelete, setProposalPendingDelete] = useState<ProposalDto | ProposalDetailDto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | "ALL">("ALL");
  const [appliedCreatePrefill, setAppliedCreatePrefill] = useState(false);
  const canDeleteProposal = useMemo(() => Boolean(user), [user]);

  // carrega clientes para o seletor
  useEffect(() => {
    clientsApi.listClients({ limit: 500 }).then((r: { data: ClientListDto[] }) => setClients(r.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!shouldOpenCreate || appliedCreatePrefill) return;
    setCreateForm((current) => ({
      ...current,
      title: prefillTitle || current.title,
      client_id: prefillClientId || current.client_id,
    }));
    setIsCreateModalOpen(true);
    setAppliedCreatePrefill(true);
  }, [appliedCreatePrefill, prefillClientId, prefillTitle, shouldOpenCreate]);

  useEffect(() => {
    if (!requestedStatus) return;
    if (
      requestedStatus === "draft" ||
      requestedStatus === "sent" ||
      requestedStatus === "approved" ||
      requestedStatus === "rejected" ||
      requestedStatus === "archived" ||
      requestedStatus === "expired" ||
      requestedStatus === "cancelled"
    ) {
      setStatusFilter(requestedStatus);
    }
  }, [requestedStatus]);

  const loadProposals = useCallback(async (preserveSelection: boolean) => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await proposalsApi.listProposals({ limit: 200 });
      setProposals(response.data);
      if (!preserveSelection) {
        setSelectedProposalId(requestedProposalId ?? response.data[0]?.id ?? null);
        return;
      }
      if (!response.data.some((p) => p.id === selectedProposalId)) {
        setSelectedProposalId(response.data[0]?.id ?? null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar propostas.");
    } finally {
      setIsLoading(false);
    }
  }, [requestedProposalId, selectedProposalId]);

  const loadProposalDetail = useCallback(async (proposalId: string) => {
    try {
      setIsDetailLoading(true);
      const proposal = await proposalsApi.getProposal(proposalId);
      setSelectedProposal(proposal);
      setProposalForm(proposalToForm(proposal));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao carregar detalhes.");
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => { void loadProposals(false); }); }, [loadProposals]);
  useEffect(() => {
    if (!selectedProposalId) return;
    queueMicrotask(() => { void loadProposalDetail(selectedProposalId); });
  }, [loadProposalDetail, selectedProposalId]);

  async function handleStatusChange(status: ProposalStatus) {
    if (!selectedProposal) return;
    try {
      setIsUpdating(true);
      setActionMessage(null);
      await proposalsApi.updateProposal(selectedProposal.id, { status } satisfies Partial<ProposalCreateRequest>);
      await Promise.all([loadProposals(true), loadProposalDetail(selectedProposal.id)]);
      setActionMessage(`Proposal marked as ${STATUS_META[status].label}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update status.");
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleProposalMetaSave() {
    if (!selectedProposal) return;
    try {
      setIsUpdating(true);
      setActionMessage(null);
      await proposalsApi.updateProposal(selectedProposal.id, formToPayload(proposalForm));
      await Promise.all([loadProposals(true), loadProposalDetail(selectedProposal.id)]);
      setActionMessage("Proposal updated.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleItemUpdate(proposalItemId: string, payload: { quantity?: number; discount_amount?: number }) {
    if (!selectedProposal) return;
    try {
      setIsUpdating(true);
      const updated = await proposalsApi.updateProposalItem(selectedProposal.id, proposalItemId, payload);
      setSelectedProposal(updated);
      setProposalForm(proposalToForm(updated));
      await loadProposals(true);
      setActionMessage("Item atualizado.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao atualizar item.");
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleItemRemove(proposalItemId: string) {
    if (!selectedProposal) return;
    try {
      setIsUpdating(true);
      const updated = await proposalsApi.deleteProposalItem(selectedProposal.id, proposalItemId);
      setSelectedProposal(updated);
      setProposalForm(proposalToForm(updated));
      await loadProposals(true);
      setActionMessage("Item removed.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to remove item.");
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleCreateProposal() {
    if (!createForm.title.trim()) {
      setErrorMessage("Proposal title is required.");
      return;
    }
    if (!createForm.client_id) {
      setErrorMessage("Client is required.");
      return;
    }
    try {
      setIsCreating(true);
      setErrorMessage(null);
      const created = await proposalsApi.createProposal(formToPayload(createForm) as ProposalCreateRequest);
      setSelectedProposalId(created.id);
      setIsCreateModalOpen(false);
      setCreateForm(EMPTY_FORM);
      await Promise.all([loadProposals(true), loadProposalDetail(created.id)]);
      setActionMessage("Draft proposal created.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create proposal.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteProposal() {
    if (!proposalPendingDelete) return;
    try {
      setIsUpdating(true);
      setErrorMessage(null);
      await proposalsApi.deleteProposal(proposalPendingDelete.id);
      const nextProposals = proposals.filter((proposal) => proposal.id !== proposalPendingDelete.id);
      setProposals(nextProposals);
      if (selectedProposal?.id === proposalPendingDelete.id) {
        setSelectedProposal(null);
        setProposalForm(EMPTY_FORM);
        setSelectedProposalId(nextProposals[0]?.id ?? null);
      }
      setIsDeleteModalOpen(false);
      setProposalPendingDelete(null);
      setActionMessage("Proposal deleted.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete proposal.");
    } finally {
      setIsUpdating(false);
    }
  }

  const visibleProposals = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return proposals.filter((p) => {
      const matchesQuery =
        !query ||
        [p.reference, p.title, p.customer_name ?? "", p.created_by_name ?? ""]
          .join(" ").toLowerCase().includes(query);
      const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [proposals, searchQuery, statusFilter]);

  const summary = useMemo(() => ({
    total: proposals.length,
    draft: proposals.filter((p) => p.status === "draft").length,
    sent: proposals.filter((p) => p.status === "sent").length,
    value: proposals.reduce((sum, p) => sum + p.total_amount, 0),
  }), [proposals]);

  return (
    <main className="flex-1 overflow-y-auto bg-[#F6F8FC]">
      <div className="flex min-h-full flex-col">
        <header className="border-b border-[#E6EBF3] bg-white">
          <div className="flex flex-col gap-4 px-6 py-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  request_quote
                </span>
              </div>
              <div className="min-w-0">
                <h1 className="text-[18px] font-semibold leading-5 text-slate-900">Proposals</h1>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  Draft and reusable commercial proposals linked to clients and catalog items.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => { setErrorMessage(null); setActionMessage(null); setCreateForm(EMPTY_FORM); setIsCreateModalOpen(true); }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                New proposal
              </button>
              <label className="flex min-w-[280px] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 shadow-sm">
                <span className="material-symbols-outlined text-[18px] text-slate-400">search</span>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by reference, title or client"
                  className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ProposalStatus | "ALL")}
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none"
              >
                <option value="ALL">All statuses</option>
                {(Object.keys(STATUS_META) as ProposalStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 border-t border-[#EEF2F7] px-6 py-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total proposals", value: summary.total, accent: "text-slate-900", icon: "description" },
              { label: "Drafts", value: summary.draft, accent: "text-slate-700", icon: "edit_note" },
              { label: "Sent", value: summary.sent, accent: "text-sky-700", icon: "send" },
              { label: "Pipeline value", value: formatCurrency(summary.value), accent: "text-emerald-700", icon: "payments" },
            ].map((card) => (
              <div key={card.label} className="rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{card.label}</p>
                  <span className={`material-symbols-outlined text-[18px] ${card.accent}`}>{card.icon}</span>
                </div>
                <p className={`mt-3 text-2xl font-semibold ${card.accent}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {errorMessage && (
            <div className="border-t border-rose-100 bg-rose-50 px-6 py-3 text-sm text-rose-700">{errorMessage}</div>
          )}
          {actionMessage && (
            <div className="border-t border-emerald-100 bg-emerald-50 px-6 py-3 text-sm text-emerald-700">{actionMessage}</div>
          )}
        </header>

        <div className="grid flex-1 gap-4 px-4 py-4 lg:px-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          {/* Proposal queue */}
          <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Proposal queue</h2>
              <p className="mt-1 text-xs text-slate-500">
                {isLoading ? "Loading…" : `${visibleProposals.length} proposal(s) in current view`}
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {visibleProposals.map((proposal) => {
                const isSelected = proposal.id === selectedProposalId;
                const statusMeta = STATUS_META[proposal.status] ?? STATUS_META.draft;
                const clientName = clients.find((c) => c.id === proposal.client_id)?.name;
                return (
                  <div
                    key={proposal.id}
                    onClick={() => setSelectedProposalId(proposal.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedProposalId(proposal.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer px-5 py-4 transition hover:bg-slate-50 ${isSelected ? "bg-amber-50/50" : "bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{proposal.reference}</p>
                        <p className="truncate text-sm font-semibold text-slate-900">{proposal.title}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {clientName ?? proposal.customer_name ?? "No client"} · {proposal.items_count} item(s)
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusMeta.className}`}>
                          {statusMeta.label}
                        </span>
                        {canDeleteProposal ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedProposalId(proposal.id);
                              setProposalPendingDelete(proposal);
                              setIsDeleteModalOpen(true);
                            }}
                            disabled={isUpdating}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                            aria-label={`Delete proposal ${proposal.reference}`}
                            title="Delete proposal"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>{formatDate(proposal.updated_at)}</span>
                      <span className="font-semibold text-slate-700">
                        {formatCurrency(proposal.total_amount, proposal.currency)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {!isLoading && visibleProposals.length === 0 && (
                <div className="px-5 py-16 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                    <span className="material-symbols-outlined">request_quote</span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900">No proposals found</h3>
                  <p className="mt-1 text-sm text-slate-500">Create one manually or from the catalog to start the commercial flow.</p>
                </div>
              )}
            </div>
          </section>

          {/* Painel de detalhe */}
          <aside className="rounded-[28px] border border-slate-200 bg-white shadow-sm overflow-y-auto">
            {selectedProposalId && selectedProposal ? (
              <ProposalDetail
                proposal={selectedProposal}
                proposalForm={proposalForm}
                clients={clients}
                isLoading={isDetailLoading}
                isUpdating={isUpdating}
                canDeleteProposal={canDeleteProposal}
                onProposalFormChange={setProposalForm}
                onProposalMetaSave={handleProposalMetaSave}
                onStatusChange={handleStatusChange}
                onItemUpdate={handleItemUpdate}
                onItemRemove={handleItemRemove}
                onDeleteProposal={() => {
                  setProposalPendingDelete(selectedProposal);
                  setIsDeleteModalOpen(true);
                }}
              />
            ) : (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <span className="material-symbols-outlined">description</span>
                </div>
                <h2 className="mt-4 text-sm font-semibold text-slate-900">Selecione uma proposta</h2>
                <p className="mt-1 text-sm text-slate-500">Escolha uma proposta na lista para ver os detalhes.</p>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* New proposal modal */}
      {isCreateModalOpen && (
        <Modal title="New proposal" onClose={() => !isCreating && setIsCreateModalOpen(false)} maxWidth="max-w-lg">
          <div className="space-y-4">
            {/* Type */}
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400 mb-2">Proposal type</p>
              <div className="grid grid-cols-2 gap-2">
                {([["product", "📦 Product"], ["service", "🔧 Service"]] as const).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setCreateForm((f) => ({ ...f, proposal_type: type }))}
                    className={`py-2.5 rounded-2xl text-sm font-medium border transition-colors ${
                      createForm.proposal_type === type
                        ? "bg-slate-900 border-slate-900 text-white"
                        : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Title <span className="text-rose-500">*</span></span>
              <input
                value={createForm.title}
                onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. ERP system implementation"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
              />
            </label>

            {/* Client */}
            <div className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Client <span className="text-rose-500">*</span></span>
              <ClientSelector
                value={createForm.client_id}
                onChange={(id) => setCreateForm((f) => ({ ...f, client_id: id }))}
                clients={clients}
              />
            </div>

            {/* Valid until */}
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                Valid until
              </span>
              <input
                type="date"
                value={createForm.valid_until}
                onChange={(e) => setCreateForm((f) => ({ ...f, valid_until: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
              />
            </label>

            {/* Notes */}
            <label className="block space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Internal notes</span>
              <textarea
                value={createForm.notes}
                onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional internal notes for this proposal…"
                className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none resize-none"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isCreating}
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isCreating || !createForm.client_id}
                onClick={handleCreateProposal}
                className="rounded-2xl bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 transition-colors"
              >
                {isCreating ? "Creating…" : "Create draft"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {isDeleteModalOpen && proposalPendingDelete ? (
        <Modal
          title="Delete proposal"
          onClose={() => {
            if (isUpdating) return;
            setIsDeleteModalOpen(false);
            setProposalPendingDelete(null);
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-slate-600">
              Delete this proposal permanently? This action cannot be undone.
            </p>
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{proposalPendingDelete.title}</p>
              <p className="mt-1 text-xs text-slate-500">{proposalPendingDelete.reference}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setProposalPendingDelete(null);
                }}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleDeleteProposal}
                className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
              >
                {isUpdating ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}

// ─── Editor de responsabilidades (lista dinâmica) ────────────────────────────

function ResponsibilityList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function addItem() {
    const val = inputRef.current?.value.trim();
    if (!val) return;
    onChange([...items, val]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400 mb-2">{label}</p>
      <div className="space-y-1.5 mb-2">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-start gap-2 group">
            <span className="mt-0.5 text-indigo-400 shrink-0">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
            </span>
            <p className="flex-1 text-sm text-slate-700 leading-snug">{item}</p>
            <button
              type="button"
              onClick={() => removeItem(idx)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-rose-400"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-xs text-slate-400 italic">Nenhum item adicionado</p>
        )}
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          placeholder="Adicionar item..."
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
        />
        <button
          type="button"
          onClick={addItem}
          className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
        </button>
      </div>
    </div>
  );
}

// ─── Seção de detalhes de serviço ─────────────────────────────────────────────

function ServiceDetailsSection({
  proposalId,
  initial,
  onSaved,
}: {
  proposalId: string;
  initial?: ProposalServiceDetailsDto | null;
  onSaved: (sd: ProposalServiceDetailsDto) => void;
}) {
  const [form, setForm] = useState<ProposalServiceDetailsRequest>({
    service_name: initial?.service_name ?? "",
    scope_of_work: initial?.scope_of_work ?? "",
    methodology: initial?.methodology ?? "",
    hourly_rate: initial?.hourly_rate ?? null,
    estimated_hours: initial?.estimated_hours ?? null,
    client_responsibilities: initial?.client_responsibilities ?? [],
    delivery_responsibilities: initial?.delivery_responsibilities ?? [],
    revision_rounds: initial?.revision_rounds ?? null,
    support_period_days: initial?.support_period_days ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof ProposalServiceDetailsRequest, value: unknown) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    if (!form.service_name.trim()) { setError("Service name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      let sd: ProposalServiceDetailsDto;
      if (initial) {
        sd = await proposalsApi.updateServiceDetails(proposalId, form);
      } else {
        sd = await proposalsApi.createServiceDetails(proposalId, form);
      }
      onSaved(sd);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save service details.");
    } finally {
      setSaving(false);
    }
  }

  const totalValue =
    (form.hourly_rate ?? 0) * (form.estimated_hours ?? 0);

  return (
    <div className="border-b border-slate-100 px-5 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          🔧 Service Details
        </p>
        {initial && (
          <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            Saved
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Nome + escopo */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Service name <span className="text-rose-400">*</span>
          </span>
          <input
            value={form.service_name}
            onChange={(e) => set("service_name", e.target.value)}
            placeholder="e.g. System development"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Methodology
          </span>
          <input
            value={form.methodology ?? ""}
            onChange={(e) => set("methodology", e.target.value || null)}
            placeholder="e.g. Scrum, Kanban…"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
          Scope of work
        </span>
        <textarea
          value={form.scope_of_work ?? ""}
          onChange={(e) => set("scope_of_work", e.target.value || null)}
          rows={3}
          placeholder="Describe in detail what will be delivered…"
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none resize-none"
        />
      </label>

      {/* Valor hora + horas + total calculado */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Hourly rate
          </span>
          <input
            type="number"
            min={0}
            value={form.hourly_rate ?? ""}
            onChange={(e) => set("hourly_rate", e.target.value ? Number(e.target.value) : null)}
            placeholder="0.00"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Estimated hours
          </span>
          <input
            type="number"
            min={0}
            value={form.estimated_hours ?? ""}
            onChange={(e) => set("estimated_hours", e.target.value ? Number(e.target.value) : null)}
            placeholder="0"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </label>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Calculated total
          </p>
          <p className="mt-1 text-base font-semibold text-slate-900">
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(totalValue)}
          </p>
        </div>
      </div>

      {/* Revisões + suporte */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Revision rounds
          </span>
          <input
            type="number"
            min={0}
            value={form.revision_rounds ?? ""}
            onChange={(e) => set("revision_rounds", e.target.value ? Number(e.target.value) : null)}
            placeholder="Ex: 2"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Post-delivery support (days)
          </span>
          <input
            type="number"
            min={0}
            value={form.support_period_days ?? ""}
            onChange={(e) => set("support_period_days", e.target.value ? Number(e.target.value) : null)}
            placeholder="Ex: 30"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </label>
      </div>

      {/* Responsabilidades */}
      <ResponsibilityList
        label="Client responsibilities"
        items={form.client_responsibilities}
        onChange={(items) => set("client_responsibilities", items)}
      />

      <ResponsibilityList
        label="Delivery responsibilities"
        items={form.delivery_responsibilities}
        onChange={(items) => set("delivery_responsibilities", items)}
      />

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-2xl bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 transition-colors"
        >
          {saving ? "Saving…" : initial ? "Update service" : "Save service details"}
        </button>
      </div>
    </div>
  );
}

// ─── Timeline de histórico de status ─────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  draft:     "edit_note",
  sent:      "send",
  approved:  "check_circle",
  rejected:  "cancel",
  archived:  "archive",
  expired:   "schedule",
  cancelled: "block",
};

function StatusTimeline({ history }: { history: ProposalStatusHistoryDto[] }) {
  if (!history || history.length === 0) return null;

  return (
    <div className="border-b border-slate-100 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 mb-4">
        🕐 Status history
      </p>
      <div className="relative">
        {/* linha vertical */}
        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-slate-100" />

        <div className="space-y-4">
          {history.map((entry, idx) => {
            const isLast = idx === history.length - 1;
            const statusMeta = STATUS_META[entry.to_status as ProposalStatus];
            const icon = STATUS_ICONS[entry.to_status] ?? "circle";
            const date = new Date(entry.created_at);
            const label = statusMeta?.label ?? entry.to_status;

            return (
              <div key={entry.id} className="flex items-start gap-3 relative">
                {/* ícone do nó */}
                <div className={`relative z-10 w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0 ${
                  isLast
                    ? "bg-indigo-100 text-indigo-600"
                    : "bg-slate-100 text-slate-400"
                }`}>
                  <span className="material-symbols-outlined text-[14px]"
                    style={isLast ? { fontVariationSettings: "'FILL' 1" } : {}}>
                    {icon}
                  </span>
                </div>

                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {entry.from_status ? (
                        <>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            STATUS_META[entry.from_status as ProposalStatus]?.className ?? "bg-slate-100 text-slate-600"
                          }`}>
                            {STATUS_META[entry.from_status as ProposalStatus]?.label ?? entry.from_status}
                          </span>
                          <span className="material-symbols-outlined text-[14px] text-slate-300">arrow_forward</span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">Created as</span>
                      )}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        statusMeta?.className ?? "bg-slate-100 text-slate-600"
                      }`}>
                        {label}
                      </span>
                    </div>
                    <time className="text-[10px] text-slate-400 shrink-0" title={date.toLocaleString("pt-BR")}>
                      {date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </time>
                  </div>
                  {entry.reason && (
                    <p className="mt-1 text-xs text-slate-500 italic">"{entry.reason}"</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Painel de detalhe ────────────────────────────────────────────────────────

function ProposalDetail({
  proposal, proposalForm, clients, isLoading, isUpdating,
  canDeleteProposal, onProposalFormChange, onProposalMetaSave, onStatusChange, onItemUpdate, onItemRemove, onDeleteProposal,
}: {
  proposal: ProposalDetailDto;
  proposalForm: ProposalFormState;
  clients: ClientListDto[];
  isLoading: boolean;
  isUpdating: boolean;
  canDeleteProposal: boolean;
  onProposalFormChange: React.Dispatch<React.SetStateAction<ProposalFormState>>;
  onProposalMetaSave: () => void;
  onStatusChange: (status: ProposalStatus) => void;
  onItemUpdate: (proposalItemId: string, payload: { quantity?: number; discount_amount?: number }) => void;
  onItemRemove: (proposalItemId: string) => void;
  onDeleteProposal: () => void;
}) {
  const statusMeta = STATUS_META[proposal.status] ?? STATUS_META.draft;
  const selectedClient = clients.find((c) => c.id === proposalForm.client_id);
  const [serviceDetails, setServiceDetails] = useState<ProposalServiceDetailsDto | null | undefined>(
    proposal.service_details
  );
  const [paymentCustom, setPaymentCustom] = useState(
    !PAYMENT_PRESETS.slice(0, -1).includes(proposalForm.payment_terms)
  );

  function setField(field: keyof ProposalFormState, value: string) {
    onProposalFormChange((f) => ({ ...f, [field]: value }));
  }

  return (
    <div className="flex flex-col">
      {/* Cabeçalho */}
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{proposal.reference}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{proposal.title}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {selectedClient?.name ?? proposal.customer_name ?? "No client assigned"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusMeta.className}`}>
              {statusMeta.label}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={proposal.status}
                onChange={(e) => onStatusChange(e.target.value as ProposalStatus)}
                disabled={isUpdating}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm outline-none disabled:opacity-60"
              >
                {(Object.keys(STATUS_META) as ProposalStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
              {canDeleteProposal ? (
                <button
                  type="button"
                  onClick={onDeleteProposal}
                  disabled={isUpdating}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                  aria-label="Delete proposal"
                  title="Delete proposal"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid gap-3 border-b border-slate-100 px-5 py-4 sm:grid-cols-3">
        <Metric label="Subtotal" value={formatCurrency(proposal.subtotal_amount, proposal.currency)} />
        <Metric label="Discount" value={formatCurrency(proposal.discount_amount, proposal.currency)} />
        <Metric label="Total" value={formatCurrency(proposal.total_amount, proposal.currency)} />
      </div>

      {/* Informações gerais */}
      <div className="border-b border-slate-100 px-5 py-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">General info</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Title</span>
            <input
              value={proposalForm.title}
              onChange={(e) => setField("title", e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Type</span>
            <select
              value={proposalForm.proposal_type}
              onChange={(e) => setField("proposal_type", e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
            >
              <option value="">Not defined</option>
              <option value="product">📦 Product</option>
              <option value="service">🔧 Service</option>
            </select>
          </label>
        </div>

        {/* Cliente */}
        <div className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Client</span>
          <ClientSelector
            value={proposalForm.client_id}
            onChange={(id) => onProposalFormChange((f) => ({ ...f, client_id: id }))}
            clients={clients}
          />
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Internal notes</span>
          <textarea
            value={proposalForm.notes}
            onChange={(e) => setField("notes", e.target.value)}
            className="min-h-20 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none resize-none"
          />
        </label>
      </div>

      {/* Termos comerciais */}
      <div className="border-b border-slate-100 px-5 py-4 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          💳 Commercial terms
        </p>

        {/* Payment terms */}
        <div className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Payment terms</span>
          <select
            value={paymentCustom ? "Custom" : (proposalForm.payment_terms || "")}
            onChange={(e) => {
              if (e.target.value === "Custom") {
                setPaymentCustom(true);
                setField("payment_terms", "");
              } else {
                setPaymentCustom(false);
                setField("payment_terms", e.target.value);
              }
            }}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          >
            <option value="">Select…</option>
            {PAYMENT_PRESETS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {paymentCustom && (
            <input
              value={proposalForm.payment_terms}
              onChange={(e) => setField("payment_terms", e.target.value)}
              placeholder="Describe the payment conditions…"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none mt-2"
            />
          )}
        </div>

        {/* Método + Parcelas */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Method</span>
            <select
              value={proposalForm.payment_method}
              onChange={(e) => setField("payment_method", e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
            >
              <option value="">Select…</option>
              <option value="pix">PIX</option>
              <option value="boleto">Boleto</option>
              <option value="credit_card">Credit card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="wire_transfer">Wire transfer</option>
              <option value="check">Check</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Installments</span>
            <input
              type="number"
              min={1}
              value={proposalForm.payment_installments}
              onChange={(e) => setField("payment_installments", e.target.value)}
              placeholder="1 = upfront"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
            />
          </div>
        </div>

        {/* Prazo de entrega */}
        <div className="space-y-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Delivery deadline</span>
            <div className="flex gap-2">
              {(["date", "days"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onProposalFormChange((f) => ({ ...f, delivery_mode: mode }))}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                    proposalForm.delivery_mode === mode
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {mode === "date" ? "Specific date" : "Relative"}
                </button>
              ))}
            </div>
          </div>
          {proposalForm.delivery_mode === "date" ? (
            <input
              type="date"
              value={proposalForm.delivery_deadline}
              onChange={(e) => setField("delivery_deadline", e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
            />
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={proposalForm.delivery_days}
                onChange={(e) => setField("delivery_days", e.target.value)}
                placeholder="e.g. 30"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
              />
              <span className="text-sm text-slate-500 shrink-0">days after approval</span>
            </div>
          )}
        </div>

        {/* Validade */}
        <div className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            Valid until
          </span>
          <input
            type="date"
            value={proposalForm.valid_until}
            onChange={(e) => setField("valid_until", e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            disabled={isUpdating}
            onClick={onProposalMetaSave}
            className="rounded-2xl bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 transition-colors"
          >
            {isUpdating ? "Saving…" : "Save proposal"}
          </button>
        </div>
      </div>

      {/* Detalhes do serviço — exibido apenas se tipo = service */}
      {(proposalForm.proposal_type === "service" || proposal.proposal_type === "service") && (
        <ServiceDetailsSection
          proposalId={proposal.id}
          initial={serviceDetails}
          onSaved={(sd) => setServiceDetails(sd)}
        />
      )}

      {/* Itens */}
      <div className="flex-1 space-y-4 px-5 py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Catalog items</p>
            <p className="mt-1 text-xs text-slate-500">{proposal.items.length} item(s) preserved from catalog.</p>
          </div>
          {isLoading && <span className="text-xs font-medium text-slate-500">Refreshing…</span>}
        </div>
        <div className="space-y-3">
          {proposal.items.map((item) => (
            <ProposalItemCard
              key={`${item.id}:${item.quantity}:${item.discount_amount}`}
              item={item}
              currency={proposal.currency}
              isUpdating={isUpdating}
              onItemUpdate={onItemUpdate}
              onItemRemove={onItemRemove}
            />
          ))}
        </div>
      </div>

      {/* Histórico de status */}
      {proposal.status_history && proposal.status_history.length > 0 && (
        <StatusTimeline history={proposal.status_history} />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-2 text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ProposalItemCard({
  item, currency, isUpdating, onItemUpdate, onItemRemove,
}: {
  item: ProposalItemDto;
  currency: string;
  isUpdating: boolean;
  onItemUpdate: (proposalItemId: string, payload: { quantity?: number; discount_amount?: number }) => void;
  onItemRemove: (proposalItemId: string) => void;
}) {
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [discountAmount, setDiscountAmount] = useState(String(item.discount_amount));

  return (
    <article className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{item.commercial_name_snapshot}</p>
          <p className="mt-1 text-xs text-slate-500">
            {item.catalog_reference_code || item.sku_snapshot || item.category_snapshot} · {item.type_snapshot}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">x{item.quantity}</span>
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => onItemRemove(item.id)}
            className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 disabled:opacity-60"
          >
            Remove
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{item.commercial_description_snapshot}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Quantity</span>
          <div className="flex gap-2">
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
            />
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => onItemUpdate(item.id, { quantity: Math.max(Number(quantity || 1), 1) })}
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
            >
              OK
            </button>
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Discount</span>
          <div className="flex gap-2">
            <input
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
            />
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => onItemUpdate(item.id, { discount_amount: Math.max(Number(discountAmount || 0), 0) })}
              className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
            >
              OK
            </button>
          </div>
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="Unit price" value={formatCurrency(item.unit_price, currency)} />
        <Metric label="Discount" value={formatCurrency(item.discount_amount, currency)} />
        <Metric label="Line total" value={formatCurrency(item.total_amount, currency)} />
      </div>
    </article>
  );
}
