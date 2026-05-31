"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Modal from "@/components/shared/Modal";
import { clientsApi } from "@/lib/api";
import type { ClientDto, ClientListDto, ClientCreateRequest, ClientUpdateRequest } from "@/types/client";

// ─── helpers ─────────────────────────────────────────────────────────────────

const COUNTRY_FLAG: Record<string, string> = {
  BR: "🇧🇷", US: "🇺🇸", DE: "🇩🇪", GB: "🇬🇧",
  FR: "🇫🇷", AR: "🇦🇷", MX: "🇲🇽", PT: "🇵🇹",
};

function countryLabel(code: string) {
  return `${COUNTRY_FLAG[code] ?? "🌐"} ${code}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Client form (rendered inside Modal) ────────────────────────────────────

interface ClientFormProps {
  initial?: ClientDto | null;
  onSave: (data: ClientCreateRequest) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}

function ClientForm({ initial, onSave, onClose, saving, error }: ClientFormProps) {
  const [form, setForm] = useState<ClientCreateRequest>({
    name: initial?.name ?? "",
    country: initial?.country ?? "BR",
    client_type: initial?.client_type ?? "company",
    tax_id: initial?.tax_id ?? "",
    tax_id_type: initial?.tax_id_type ?? "",
    currency: initial?.currency ?? "BRL",
    company_name: initial?.company_name ?? "",
    website: initial?.website ?? "",
    notes: initial?.notes ?? "",
  });

  const isBrazilian = form.country === "BR";

  function set(field: keyof ClientCreateRequest, value: string) {
    setForm((prev) => ({ ...prev, [field]: value || null }));
  }

  function handleCountryToggle(isBR: boolean) {
    setForm((prev) => ({
      ...prev,
      country: isBR ? "BR" : "",
      tax_id: null,
      tax_id_type: null,
      currency: isBR ? "BRL" : prev.currency,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {/* Origin toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => handleCountryToggle(true)}
          className={`py-2 px-3 rounded-xl text-sm font-medium border transition-colors ${
            isBrazilian
              ? "bg-indigo-50 border-indigo-300 text-indigo-700"
              : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
          }`}
        >
          🇧🇷 Brazilian company
        </button>
        <button
          type="button"
          onClick={() => handleCountryToggle(false)}
          className={`py-2 px-3 rounded-xl text-sm font-medium border transition-colors ${
            !isBrazilian
              ? "bg-indigo-50 border-indigo-300 text-indigo-700"
              : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
          }`}
        >
          🌐 International
        </button>
      </div>

      {/* Name */}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
          Name / Company name <span className="text-rose-500">*</span>
        </span>
        <input
          required
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Alfa Corp Ltd"
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </label>

      {/* Entity type */}
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-600">
          <input
            type="radio" name="client_type" value="company"
            checked={form.client_type === "company"}
            onChange={() => setForm((p) => ({ ...p, client_type: "company" }))}
            className="accent-slate-900"
          />
          Company
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-slate-600">
          <input
            type="radio" name="client_type" value="individual"
            checked={form.client_type === "individual"}
            onChange={() => setForm((p) => ({ ...p, client_type: "individual" }))}
            className="accent-slate-900"
          />
          Individual
        </label>
      </div>

      {/* Document */}
      {isBrazilian ? (
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
            {form.client_type === "company" ? "CNPJ" : "CPF"}
            <span className="ml-1 text-slate-300">(optional)</span>
          </span>
          <input
            value={form.tax_id ?? ""}
            onChange={(e) => {
              const type = form.client_type === "company" ? "CNPJ" : "CPF";
              setForm((p) => ({ ...p, tax_id: e.target.value || null, tax_id_type: type }));
            }}
            placeholder={form.client_type === "company" ? "00.000.000/0001-00" : "000.000.000-00"}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Country code</span>
            <input
              value={form.country === "BR" ? "" : (form.country ?? "")}
              onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))}
              placeholder="US, DE, MX…"
              maxLength={2}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Tax ID / Registration</span>
            <input
              value={form.tax_id ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, tax_id: e.target.value || null, tax_id_type: "OTHER" }))}
              placeholder="VAT, EIN, etc."
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </label>
        </div>
      )}

      {/* Trade name + Currency */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Trade name</span>
          <input
            value={form.company_name ?? ""}
            onChange={(e) => set("company_name", e.target.value)}
            placeholder="Alfa"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Currency</span>
          <select
            value={form.currency ?? "BRL"}
            onChange={(e) => set("currency", e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
          >
            <option value="BRL">BRL — Real</option>
            <option value="USD">USD — Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — Pound</option>
          </select>
        </label>
      </div>

      {/* Website */}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Website</span>
        <input
          value={form.website ?? ""}
          onChange={(e) => set("website", e.target.value)}
          placeholder="https://company.com"
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </label>

      {/* Notes */}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">Internal notes</span>
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          placeholder="Relevant information about this client…"
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none resize-none focus:ring-2 focus:ring-slate-900/10"
        />
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-2xl bg-slate-900 hover:bg-slate-800 px-5 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60"
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Create client"}
        </button>
      </div>
    </form>
  );
}

// ─── Client detail panel ─────────────────────────────────────────────────────

function ClientDetail({
  client, onEdit, onDelete,
}: { client: ClientDto; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{client.name}</h2>
          {client.company_name && (
            <p className="text-sm text-slate-500 mt-0.5">{client.company_name}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 font-medium transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">edit</span>
            Edit
          </button>
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 rounded-xl border border-rose-100 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 font-medium transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">archive</span>
            Archive
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3">Information</p>
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon="public"  label="Country"  value={countryLabel(client.country)} />
            <InfoRow icon="payments" label="Currency" value={client.currency} />
            <InfoRow icon="badge"   label={client.client_type === "company" ? "CNPJ / Tax ID" : "CPF / Tax ID"} value={client.tax_id ?? "Not provided"} />
            <InfoRow icon="person"  label="Type"     value={client.client_type === "company" ? "Company" : "Individual"} />
            {client.website && <InfoRow icon="link" label="Website" value={client.website} />}
          </div>
        </section>

        {client.notes && (
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3">Notes</p>
            <p className="text-sm text-slate-600 bg-slate-50 rounded-2xl p-4 leading-relaxed">{client.notes}</p>
          </section>
        )}

        <section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3">Record</p>
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon="calendar_today" label="Created"  value={formatDate(client.created_at)} />
            <InfoRow icon="update"         label="Updated"  value={formatDate(client.updated_at)} />
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="material-symbols-outlined text-[16px] text-slate-400 mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-slate-700 mt-0.5 break-all">{value}</p>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const searchParams = useSearchParams();
  const requestedClientId = searchParams.get("clientId");
  const [clients, setClients] = useState<ClientListDto[]>([]);
  const [selected, setSelected] = useState<ClientDto | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "company" | "individual">("");

  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<ClientDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (typeFilter) params.client_type = typeFilter;
      const res = await clientsApi.listClients(params);
      setClients(res.data ?? []);
    } catch {
      setMessage({ type: "error", text: "Failed to load clients." });
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter]);

  useEffect(() => { loadClients(); }, [loadClients]);

  async function selectClient(id: string) {
    if (selected?.id === id) return;
    setLoadingDetail(true);
    try {
      setSelected(await clientsApi.getClient(id));
    } catch {
      setMessage({ type: "error", text: "Failed to load client details." });
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (!requestedClientId || selected?.id === requestedClientId) return;
    void selectClient(requestedClientId);
  }, [requestedClientId, selected?.id]);

  async function handleSave(data: ClientCreateRequest) {
    setSaving(true);
    setFormError(null);
    try {
      if (editTarget) {
        const updated = await clientsApi.updateClient(editTarget.id, data as ClientUpdateRequest);
        setSelected(updated);
        setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        setMessage({ type: "success", text: "Client updated." });
      } else {
        await clientsApi.createClient(data);
        setMessage({ type: "success", text: "Client created." });
        await loadClients();
      }
      setShowForm(false);
      setEditTarget(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save client.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Archive this client? They will no longer appear in searches.")) return;
    try {
      await clientsApi.deleteClient(id);
      setSelected(null);
      setClients((prev) => prev.filter((c) => c.id !== id));
      setMessage({ type: "success", text: "Client archived." });
    } catch {
      setMessage({ type: "error", text: "Failed to archive client." });
    }
  }

  const filteredClients = clients.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.company_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <main className="flex flex-col h-full bg-[#F6F8FC]">
      {/* Header */}
      <header className="bg-white border-b border-[#E6EBF3] px-6 py-4 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>groups</span>
            </div>
            <div>
              <h1 className="text-[18px] font-semibold leading-5 text-slate-900">Clients</h1>
              <p className="mt-0.5 text-[13px] text-slate-500">Manage your commercial client base.</p>
            </div>
            <span className="ml-1 text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              {filteredClients.length}
            </span>
          </div>
          <button
            onClick={() => { setShowForm(true); setEditTarget(null); setFormError(null); }}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New client
          </button>
        </div>

        {/* Search + type filter */}
        <div className="flex gap-3">
          <label className="flex min-w-[280px] items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 shadow-sm">
            <span className="material-symbols-outlined text-[18px] text-slate-400">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or company…"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>
          <div className="flex gap-1.5">
            {(["", "company", "individual"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-2 text-xs font-medium rounded-2xl transition-colors border shadow-sm ${
                  typeFilter === type
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                {type === "" ? "All" : type === "company" ? "Company" : "Individual"}
              </button>
            ))}
          </div>
        </div>

        {message && (
          <div className={`mt-3 text-sm px-3 py-2 rounded-xl border flex items-center justify-between ${
            message.type === "success"
              ? "bg-emerald-50 border-emerald-100 text-emerald-700"
              : "bg-rose-50 border-rose-100 text-rose-600"
          }`}>
            {message.text}
            <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100 ml-3">✕</button>
          </div>
        )}
      </header>

      {/* Body: list + detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className="w-[380px] shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredClients.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
              <span className="material-symbols-outlined text-[40px]">group_off</span>
              <p className="text-sm">No clients found</p>
            </div>
          ) : (
            filteredClients.map((client) => {
              const active = selected?.id === client.id;
              return (
                <button
                  key={client.id}
                  onClick={() => selectClient(client.id)}
                  className={`w-full text-left px-5 py-4 border-b border-slate-100 transition-colors flex items-start gap-3 ${
                    active ? "bg-amber-50/50 border-l-[3px] border-l-slate-900" : "hover:bg-slate-50"
                  }`}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold ${
                    active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
                  }`}>
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{client.name}</p>
                    {client.company_name && <p className="text-xs text-slate-500 truncate">{client.company_name}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400">{countryLabel(client.country)}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        {client.client_type === "company" ? "Company" : "Individual"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto bg-white">
          {loadingDetail ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : selected ? (
            <ClientDetail
              client={selected}
              onEdit={() => { setEditTarget(selected); setShowForm(true); setFormError(null); }}
              onDelete={() => handleDelete(selected.id)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
              <span className="material-symbols-outlined text-[48px]">person_search</span>
              <p className="text-sm">Select a client to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {showForm && (
        <Modal
          title={editTarget ? "Edit client" : "New client"}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          maxWidth="max-w-lg"
        >
          <ClientForm
            initial={editTarget}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditTarget(null); }}
            saving={saving}
            error={formError}
          />
        </Modal>
      )}
    </main>
  );
}
