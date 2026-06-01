"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";
import { clientsApi, usersApi } from "@/lib/api";
import { buildCompaniesQuery, getCompaniesQuickFilter, isCompanyRowMatch } from "@/lib/companiesWorkspace";
import type { User } from "@/types/auth";
import type { CompanyDraft, CompaniesQuickFilter } from "@/types/companyWorkspace";
import type { ClientCreateRequest, ClientDto, ClientListDto, ClientUpdateRequest } from "@/types/client";

const COUNTRY_FLAG: Record<string, string> = {
  BR: "BR",
  US: "US",
  DE: "DE",
  GB: "GB",
  FR: "FR",
  AR: "AR",
  MX: "MX",
  PT: "PT",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function createEmptyDraft(defaultOwnerId = ""): CompanyDraft {
  return {
    name: "",
    company_name: "",
    country: "BR",
    currency: "BRL",
    website: "",
    notes: "",
    owner_user_id: defaultOwnerId,
  };
}

function normalizeDraftToRequest(draft: CompanyDraft): ClientCreateRequest {
  return {
    name: draft.name.trim(),
    company_name: draft.company_name.trim() || null,
    country: draft.country.trim().toUpperCase() || "BR",
    currency: draft.currency.trim().toUpperCase() || "BRL",
    website: draft.website.trim() || null,
    notes: draft.notes.trim() || null,
    client_type: "company",
    owner_user_id: draft.owner_user_id || null,
  };
}

function deriveDraftFromClient(client: ClientDto): CompanyDraft {
  return {
    name: client.name ?? "",
    company_name: client.company_name ?? "",
    country: client.country ?? "BR",
    currency: client.currency ?? "BRL",
    website: client.website ?? "",
    notes: client.notes ?? "",
    owner_user_id: client.owner_user_id ?? "",
  };
}

function FieldLabel({ label }: { label: string }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>;
}

function DetailInput({
  label,
  value,
  placeholder,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <label className="block space-y-1.5">
      <FieldLabel label={label} />
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/5"
      />
    </label>
  );
}

function DetailTextArea({
  label,
  value,
  placeholder,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <label className="block space-y-1.5">
      <FieldLabel label={label} />
      <textarea
        value={value}
        placeholder={placeholder}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/5"
      />
    </label>
  );
}

export default function ClientCompaniesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const selectedCompanyId = searchParams.get("companyId");
  const search = searchParams.get("search") ?? "";
  const quickFilter = getCompaniesQuickFilter(searchParams.get("filter"));

  const [companies, setCompanies] = useState<ClientListDto[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<ClientDto | null>(null);
  const [owners, setOwners] = useState<User[]>([]);
  const [draft, setDraft] = useState<CompanyDraft | null>(null);
  const [createDraft, setCreateDraft] = useState<CompanyDraft>(() => createEmptyDraft(user?.id ?? ""));
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const currentUserId = user?.id ?? null;

  const visibleCompanies = useMemo(
    () =>
      companies.filter((row) =>
        isCompanyRowMatch(row, {
          search,
          quickFilter,
          currentUserId,
        }),
      ),
    [companies, currentUserId, quickFilter, search],
  );

  function updateUrl(next: { companyId?: string | null; search?: string; filter?: CompaniesQuickFilter }) {
    const params = buildCompaniesQuery({
      companyId: next.companyId === undefined ? selectedCompanyId : next.companyId,
      search: next.search === undefined ? search : next.search,
      quickFilter: next.filter === undefined ? quickFilter : next.filter,
    });

    startTransition(() => {
      router.replace(params.toString() ? `/clients/companies?${params.toString()}` : "/clients/companies");
    });
  }

  async function loadCompanies() {
    setLoadingList(true);
    setError(null);
    try {
      const response = await clientsApi.listClients({ client_type: "company", limit: 200, search });
      setCompanies(response.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load companies.");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadOwners() {
    try {
      const response = await usersApi.listUsers(200);
      setOwners((response.data ?? []).filter((candidate) => candidate.is_active));
    } catch {
      setOwners([]);
    }
  }

  async function loadCompanyDetail(companyId: string) {
    setLoadingDetail(true);
    setError(null);
    try {
      const company = await clientsApi.getClient(companyId);
      setSelectedCompany(company);
      setDraft(deriveDraftFromClient(company));
      setIsCreateMode(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load company details.");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    void loadCompanies();
    void loadOwners();
  }, [search]);

  useEffect(() => {
    if (selectedCompanyId) {
      void loadCompanyDetail(selectedCompanyId);
      return;
    }

    setSelectedCompany(null);
    setDraft(null);

    if (!isCreateMode && visibleCompanies.length > 0) {
      updateUrl({ companyId: visibleCompanies[0].id });
    }
  }, [selectedCompanyId, visibleCompanies.length]);

  useEffect(() => {
    if (!isCreateMode) return;
    setSelectedCompany(null);
    setDraft(null);
  }, [isCreateMode]);

  useEffect(() => {
    setCreateDraft(createEmptyDraft(user?.id ?? ""));
  }, [user?.id]);

  async function saveField<K extends keyof CompanyDraft>(field: K) {
    if (!selectedCompany || !draft) return;

    const nextValue = draft[field];
    const currentValue = deriveDraftFromClient(selectedCompany)[field];
    if (nextValue === currentValue) return;

    setSavingField(String(field));
    setError(null);
    try {
      const payload = normalizeDraftToRequest(draft) as ClientUpdateRequest;
      const updated = await clientsApi.updateClient(selectedCompany.id, payload);
      setSelectedCompany(updated);
      setDraft(deriveDraftFromClient(updated));
      setCompanies((current) =>
        current.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                name: updated.name,
                company_name: updated.company_name,
                country: updated.country,
                currency: updated.currency,
                website: updated.website,
                owner_user_id: updated.owner_user_id,
                owner_name: updated.owner_name,
                updated_at: updated.updated_at,
              }
            : row,
        ),
      );
      setBanner(`Saved ${String(field).replaceAll("_", " ")}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save company.");
      setDraft(deriveDraftFromClient(selectedCompany));
    } finally {
      setSavingField(null);
    }
  }

  async function handleCreateCompany() {
    setCreating(true);
    setError(null);
    try {
      const created = await clientsApi.createClient(normalizeDraftToRequest(createDraft));
      setCompanies((current) => [
        {
          id: created.id,
          name: created.name,
          company_name: created.company_name,
          country: created.country,
          client_type: created.client_type,
          currency: created.currency,
          website: created.website,
          owner_user_id: created.owner_user_id,
          owner_name: created.owner_name,
          created_at: created.created_at,
          updated_at: created.updated_at,
          deleted_at: created.deleted_at,
        },
        ...current,
      ]);
      setCreateDraft(createEmptyDraft(user?.id ?? ""));
      setBanner("Company created.");
      setIsCreateMode(false);
      updateUrl({ companyId: created.id });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create company.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-[#F6F8FC]">
      <header className="border-b border-[#E6EBF3] bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                domain
              </span>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Clients</p>
              <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-slate-900">Companies</h1>
              <p className="mt-1 text-sm text-slate-500">Manage company accounts with a split-view CRM workspace.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsCreateMode(true);
              setError(null);
              setBanner(null);
              updateUrl({ companyId: null });
            }}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New company
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex min-w-[320px] flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            <span className="material-symbols-outlined text-[18px] text-slate-400">search</span>
            <input
              value={search}
              onChange={(event) => updateUrl({ search: event.target.value })}
              placeholder="Search by company, trade name, owner, or country..."
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>

          <div className="flex gap-2">
            {[
              { id: "all" as CompaniesQuickFilter, label: "All companies" },
              { id: "my-accounts" as CompaniesQuickFilter, label: "My accounts" },
            ].map((filterOption) => (
              <button
                key={filterOption.id}
                type="button"
                onClick={() => updateUrl({ filter: filterOption.id })}
                className={`rounded-2xl border px-3 py-2 text-xs font-medium transition ${
                  quickFilter === filterOption.id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {filterOption.label}
              </button>
            ))}
          </div>
        </div>

        {(error || banner) && (
          <div
            className={`mt-4 flex items-center justify-between rounded-2xl border px-3 py-2 text-sm ${
              error
                ? "border-rose-100 bg-rose-50 text-rose-700"
                : "border-emerald-100 bg-emerald-50 text-emerald-700"
            }`}
          >
            <span>{error ?? banner}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setBanner(null);
              }}
              className="ml-3 opacity-70 transition hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-[380px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
          {loadingList ? (
            <div className="flex h-40 items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
            </div>
          ) : visibleCompanies.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-slate-400">
              <span className="material-symbols-outlined text-[40px]">domain_disabled</span>
              <p className="text-sm">No companies found</p>
            </div>
          ) : (
            visibleCompanies.map((company) => {
              const active = selectedCompanyId === company.id && !isCreateMode;
              return (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => updateUrl({ companyId: company.id })}
                  className={`w-full border-b border-slate-100 px-5 py-4 text-left transition ${
                    active ? "border-l-[3px] border-l-slate-900 bg-indigo-50/50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${
                        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {company.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{company.name}</p>
                          {company.company_name ? (
                            <p className="truncate text-xs text-slate-500">{company.company_name}</p>
                          ) : null}
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          {COUNTRY_FLAG[company.country] ?? company.country}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{company.owner_name ?? "Unassigned"}</span>
                        <span>•</span>
                        <span>{company.currency}</span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </aside>

        <section className="flex-1 overflow-y-auto bg-white">
          {loadingDetail ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
            </div>
          ) : isCreateMode ? (
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-8 py-8">
              <div className="flex items-center justify-between border-b border-slate-100 pb-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Create company</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-900">New account</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateMode(false);
                    setCreateDraft(createEmptyDraft(user?.id ?? ""));
                    if (visibleCompanies[0]) updateUrl({ companyId: visibleCompanies[0].id });
                  }}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600"
                >
                  Cancel
                </button>
              </div>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <DetailInput label="Legal name" value={createDraft.name} onChange={(value) => setCreateDraft((current) => ({ ...current, name: value }))} />
                <DetailInput label="Trade name" value={createDraft.company_name} onChange={(value) => setCreateDraft((current) => ({ ...current, company_name: value }))} />
                <DetailInput label="Country" value={createDraft.country} onChange={(value) => setCreateDraft((current) => ({ ...current, country: value.toUpperCase() }))} />
                <DetailInput label="Currency" value={createDraft.currency} onChange={(value) => setCreateDraft((current) => ({ ...current, currency: value.toUpperCase() }))} />
                <label className="block space-y-1.5">
                  <FieldLabel label="Account owner" />
                  <select
                    value={createDraft.owner_user_id}
                    onChange={(event) => setCreateDraft((current) => ({ ...current, owner_user_id: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/5"
                  >
                    <option value="">Unassigned</option>
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <DetailInput label="Website" value={createDraft.website} onChange={(value) => setCreateDraft((current) => ({ ...current, website: value }))} />
              </div>

              <div className="mt-5">
                <DetailTextArea label="Internal notes" value={createDraft.notes} onChange={(value) => setCreateDraft((current) => ({ ...current, notes: value }))} />
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  disabled={creating || !createDraft.name.trim()}
                  onClick={() => void handleCreateCompany()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? "Creating..." : "Create company"}
                </button>
              </div>
            </div>
          ) : selectedCompany && draft ? (
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-8 py-8">
              <div className="flex items-start justify-between border-b border-slate-100 pb-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Company record</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-900">{selectedCompany.name}</h2>
                  <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                    <span>{selectedCompany.owner_name ?? "Unassigned"}</span>
                    <span>•</span>
                    <span>Created {formatDate(selectedCompany.created_at)}</span>
                    <span>•</span>
                    <span>Updated {formatDate(selectedCompany.updated_at)}</span>
                  </div>
                </div>

                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                  {savingField ? `Saving ${savingField.replaceAll("_", " ")}...` : "Auto-save on blur"}
                </div>
              </div>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <DetailInput
                  label="Legal name"
                  value={draft.name}
                  onChange={(value) => setDraft((current) => current ? { ...current, name: value } : current)}
                  onBlur={() => void saveField("name")}
                />
                <DetailInput
                  label="Trade name"
                  value={draft.company_name}
                  onChange={(value) => setDraft((current) => current ? { ...current, company_name: value } : current)}
                  onBlur={() => void saveField("company_name")}
                />
                <DetailInput
                  label="Country"
                  value={draft.country}
                  onChange={(value) => setDraft((current) => current ? { ...current, country: value.toUpperCase() } : current)}
                  onBlur={() => void saveField("country")}
                />
                <DetailInput
                  label="Currency"
                  value={draft.currency}
                  onChange={(value) => setDraft((current) => current ? { ...current, currency: value.toUpperCase() } : current)}
                  onBlur={() => void saveField("currency")}
                />

                <label className="block space-y-1.5">
                  <FieldLabel label="Account owner" />
                  <select
                    value={draft.owner_user_id}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((current) => current ? { ...current, owner_user_id: value } : current);
                      setTimeout(() => {
                        void saveField("owner_user_id");
                      }, 0);
                    }}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/5"
                  >
                    <option value="">Unassigned</option>
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.full_name}
                      </option>
                    ))}
                  </select>
                </label>

                <DetailInput
                  label="Website"
                  value={draft.website}
                  onChange={(value) => setDraft((current) => current ? { ...current, website: value } : current)}
                  onBlur={() => void saveField("website")}
                />
              </div>

              <div className="mt-5">
                <DetailTextArea
                  label="Internal notes"
                  value={draft.notes}
                  onChange={(value) => setDraft((current) => current ? { ...current, notes: value } : current)}
                  onBlur={() => void saveField("notes")}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
              <span className="material-symbols-outlined text-[48px]">domain</span>
              <p className="text-sm">Select a company to view its details.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
