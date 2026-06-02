"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/hooks/useAuth";
import { clientsApi, usersApi } from "@/lib/api";
import { buildCompaniesQuery, getCompaniesQuickFilter, getCompaniesSort, isCompanyRowMatch, sortCompanyRows } from "@/lib/companiesWorkspace";
import type { User } from "@/types/auth";
import type { CompanyDraft, CompaniesQuickFilter, CompaniesSort } from "@/types/companyWorkspace";
import type { ClientCreateRequest, ClientDto, ClientListDto, ClientUpdateRequest } from "@/types/client";

const TABLE_COLUMNS = [
  "Company",
  "Domain",
  "People",
  "Open opportunities",
  "Owner",
  "Last activity",
  "Country",
  "Status",
  "Created at",
] as const;

function formatDateLabel(iso: string | null | undefined) {
  if (!iso) return "No activity";
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

function getOwnerLabel(company: ClientListDto | ClientDto | null) {
  return company?.owner_name || "Unassigned";
}

function getCompanyDomain(company: ClientListDto | ClientDto) {
  if (company.website) {
    return company.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  return "No domain";
}

function updateListRow(company: ClientDto): ClientListDto {
  return {
    id: company.id,
    name: company.name,
    company_name: company.company_name,
    country: company.country,
    client_type: company.client_type,
    currency: company.currency,
    website: company.website,
    owner_user_id: company.owner_user_id,
    owner_name: company.owner_name,
    created_at: company.created_at,
    updated_at: company.updated_at,
    deleted_at: company.deleted_at,
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/5"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/5"
      />
    </label>
  );
}

function EmptyPanel({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/70 p-6 text-sm text-slate-500">
      <p className="text-base font-semibold text-slate-900">Select a company</p>
      <p className="mt-2">Use the table to scan accounts, compare owners, and open a lightweight side panel for context.</p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
      >
        New company
      </button>
    </div>
  );
}

export function CompaniesWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const selectedCompanyId = searchParams.get("companyId");
  const search = searchParams.get("search") ?? "";
  const quickFilter = getCompaniesQuickFilter(searchParams.get("filter"));
  const country = searchParams.get("country") ?? "";
  const sort = getCompaniesSort(searchParams.get("sort"));

  const [companies, setCompanies] = useState<ClientListDto[]>([]);
  const [owners, setOwners] = useState<User[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<ClientDto | null>(null);
  const [draft, setDraft] = useState<CompanyDraft | null>(null);
  const [createDraft, setCreateDraft] = useState<CompanyDraft>(() => createEmptyDraft());
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPanel, setLoadingPanel] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const currentUserId = user?.id ?? null;
  const visibleCompanies = sortCompanyRows(
    companies.filter((row) =>
      isCompanyRowMatch(row, {
        search,
        quickFilter,
        currentUserId,
        country,
      }),
    ),
    sort,
  );
  const visibleCompanyIds = visibleCompanies.map((company) => company.id).join("|");
  const countries = Array.from(new Set(companies.map((company) => company.country).filter(Boolean))).sort();
  const unassignedCount = companies.filter((company) => !company.owner_user_id).length;
  const myAccountsCount = companies.filter((company) => company.owner_user_id === currentUserId).length;

  function updateUrl(next: {
    companyId?: string | null;
    search?: string;
    filter?: CompaniesQuickFilter;
    country?: string;
    sort?: CompaniesSort;
  }) {
    const params = buildCompaniesQuery({
      companyId: next.companyId === undefined ? selectedCompanyId : next.companyId,
      search: next.search === undefined ? search : next.search,
      quickFilter: next.filter === undefined ? quickFilter : next.filter,
      country: next.country === undefined ? country : next.country,
      sort: next.sort === undefined ? sort : next.sort,
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
    setLoadingPanel(true);
    setError(null);
    try {
      const company = await clientsApi.getClient(companyId);
      setSelectedCompany(company);
      setDraft(deriveDraftFromClient(company));
      setIsCreateMode(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load company details.");
    } finally {
      setLoadingPanel(false);
    }
  }

  useEffect(() => {
    void loadCompanies();
    void loadOwners();
  }, [search]);

  useEffect(() => {
    setCreateDraft(createEmptyDraft(user?.id ?? ""));
  }, [user?.id]);

  useEffect(() => {
    if (selectedCompanyId && visibleCompanies.some((company) => company.id === selectedCompanyId)) {
      void loadCompanyDetail(selectedCompanyId);
      return;
    }

    setSelectedCompany(null);
    setDraft(null);

    if (!isCreateMode && visibleCompanies.length > 0) {
      updateUrl({ companyId: visibleCompanies[0].id });
    }
  }, [selectedCompanyId, visibleCompanyIds, isCreateMode]);

  async function saveSelectedCompany() {
    if (!selectedCompany || !draft) return;

    setIsSaving(true);
    setError(null);
    setBanner(null);

    try {
      const updated = await clientsApi.updateClient(selectedCompany.id, normalizeDraftToRequest(draft) as ClientUpdateRequest);
      setSelectedCompany(updated);
      setDraft(deriveDraftFromClient(updated));
      setCompanies((current) => current.map((row) => (row.id === updated.id ? updateListRow(updated) : row)));
      setBanner("Company changes saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save company.");
    } finally {
      setIsSaving(false);
    }
  }

  async function createCompany() {
    if (!createDraft.name.trim()) {
      setError("Add a company name before creating the record.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setBanner(null);

    try {
      const created = await clientsApi.createClient(normalizeDraftToRequest(createDraft));
      const row = updateListRow(created);
      setCompanies((current) => [row, ...current]);
      setBanner("Company created.");
      setIsCreateMode(false);
      setCreateDraft(createEmptyDraft(user?.id ?? ""));
      updateUrl({ companyId: created.id });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create company.");
    } finally {
      setIsSaving(false);
    }
  }

  const panelTitle = isCreateMode ? "New company" : selectedCompany?.name || "Company overview";

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
        <section className="rounded-[32px] border border-white/70 bg-white/80 p-5 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.55)] backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Clients</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Companies</h1>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {visibleCompanies.length} accounts
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Table-first CRM workspace for account scanning, ownership review, and quick company context.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                {[
                  { value: "all" as const, label: "All companies" },
                  { value: "my-accounts" as const, label: "My accounts" },
                  { value: "unassigned" as const, label: "Unassigned" },
                ].map((option) => {
                  const active = quickFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateUrl({ filter: option.value, companyId: null })}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsCreateMode(true);
                  setSelectedCompany(null);
                  setDraft(null);
                  updateUrl({ companyId: null });
                }}
                className="inline-flex rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                New company
              </button>
            </div>
          </div>

              <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <label className="flex min-h-12 flex-1 items-center rounded-2xl border border-slate-200 bg-slate-50 px-4">
              <span className="mr-3 text-slate-400">Search</span>
              <input
                value={search}
                onChange={(event) => updateUrl({ search: event.target.value, companyId: null })}
                placeholder="Search by company, trade name, owner, or country..."
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                <span>Country</span>
                <select
                  value={country}
                  onChange={(event) => updateUrl({ country: event.target.value, companyId: null })}
                  className="bg-transparent text-xs font-medium text-slate-700 outline-none"
                >
                  <option value="">All</option>
                  {countries.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                <span>Sort</span>
                <select
                  value={sort}
                  onChange={(event) => updateUrl({ sort: event.target.value as CompaniesSort })}
                  className="bg-transparent text-xs font-medium text-slate-700 outline-none"
                >
                  <option value="last-activity">Last activity</option>
                  <option value="created-at">Created at</option>
                  <option value="company-asc">Company A-Z</option>
                </select>
              </label>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                My accounts: {myAccountsCount}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                Unassigned: {unassignedCount}
              </span>
            </div>
          </div>

          {(error || banner) && (
            <div className="mt-4 flex flex-col gap-2">
              {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
              {banner ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{banner}</p> : null}
            </div>
          )}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_360px]">
          <div className="overflow-hidden rounded-[32px] border border-white/70 bg-white/85 shadow-[0_22px_55px_-44px_rgba(15,23,42,0.7)] backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Account table</p>
                <p className="mt-1 text-xs text-slate-500">Scan companies, compare ownership, and move across records without losing the collection view.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {loadingList ? "Loading..." : `${visibleCompanies.length} rows`}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full text-sm">
                <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  <tr>
                    {TABLE_COLUMNS.map((column) => (
                      <th key={column} className="px-4 py-3 first:px-5">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingList ? (
                    <tr>
                      <td colSpan={TABLE_COLUMNS.length} className="px-5 py-16 text-center text-sm text-slate-500">
                        Loading companies...
                      </td>
                    </tr>
                  ) : visibleCompanies.length === 0 ? (
                    <tr>
                      <td colSpan={TABLE_COLUMNS.length} className="px-5 py-16 text-center text-sm text-slate-500">
                        No companies matched this view.
                      </td>
                    </tr>
                  ) : (
                    visibleCompanies.map((company) => {
                      const selected = !isCreateMode && company.id === selectedCompanyId;

                      return (
                        <tr
                          key={company.id}
                          aria-selected={selected}
                          onClick={() => updateUrl({ companyId: company.id })}
                          className={`cursor-pointer transition hover:bg-slate-50 ${
                            selected ? "bg-slate-50/90 shadow-[inset_3px_0_0_0_rgb(15,23,42)]" : ""
                          }`}
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold text-slate-900">{company.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{company.company_name || "Primary legal record"}</div>
                          </td>
                          <td className="px-4 py-4 text-slate-600">{getCompanyDomain(company)}</td>
                          <td className="px-4 py-4 text-slate-600">0 linked</td>
                          <td className="px-4 py-4 text-slate-600">0 open</td>
                          <td className="px-4 py-4 text-slate-600">{getOwnerLabel(company)}</td>
                          <td className="px-4 py-4 text-slate-600">{formatDateLabel(company.updated_at)}</td>
                          <td className="px-4 py-4 text-slate-600">{company.country}</td>
                          <td className="px-4 py-4">
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                              Active account
                            </span>
                          </td>
                          <td className="px-4 py-4 text-slate-600">{formatDateLabel(company.created_at)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-[32px] border border-white/70 bg-white/85 p-5 shadow-[0_22px_55px_-44px_rgba(15,23,42,0.7)] backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {isCreateMode ? "Create record" : "Context panel"}
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{panelTitle}</h2>
                <p className="mt-2 text-sm text-slate-500">
                  {isCreateMode
                    ? "Create a new account without leaving the table-oriented workspace."
                    : "Context stays secondary here so the table remains the operational center of gravity."}
                </p>
              </div>
              {loadingPanel ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">Loading</span> : null}
            </div>

            <div className="mt-5 space-y-5">
              {isCreateMode ? (
                <>
                  <div className="grid gap-4">
                    <Field
                      label="Company"
                      value={createDraft.name}
                      onChange={(value) => setCreateDraft((current) => ({ ...current, name: value }))}
                      placeholder="Acme Brasil"
                    />
                    <Field
                      label="Trade name"
                      value={createDraft.company_name}
                      onChange={(value) => setCreateDraft((current) => ({ ...current, company_name: value }))}
                      placeholder="Acme"
                    />
                    <Field
                      label="Website"
                      value={createDraft.website}
                      onChange={(value) => setCreateDraft((current) => ({ ...current, website: value }))}
                      placeholder="https://acme.com"
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Country"
                        value={createDraft.country}
                        onChange={(value) => setCreateDraft((current) => ({ ...current, country: value }))}
                      />
                      <Field
                        label="Currency"
                        value={createDraft.currency}
                        onChange={(value) => setCreateDraft((current) => ({ ...current, currency: value }))}
                      />
                    </div>
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Owner</span>
                      <select
                        value={createDraft.owner_user_id}
                        onChange={(event) => setCreateDraft((current) => ({ ...current, owner_user_id: event.target.value }))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/5"
                      >
                        <option value="">Unassigned</option>
                        {owners.map((owner) => (
                          <option key={owner.id} value={owner.id}>
                            {owner.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TextAreaField
                      label="Internal notes"
                      value={createDraft.notes}
                      onChange={(value) => setCreateDraft((current) => ({ ...current, notes: value }))}
                      placeholder="Capture commercial context, next step, or qualification notes."
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void createCompany()}
                      disabled={isSaving}
                      className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isSaving ? "Creating..." : "Create company"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreateMode(false)}
                      className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : selectedCompany && draft ? (
                <>
                  <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-sm text-slate-600">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-900">{selectedCompany.name}</span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">{selectedCompany.country}</span>
                    </div>
                    <div className="grid gap-2 text-xs">
                      <p>Owner: {getOwnerLabel(selectedCompany)}</p>
                      <p>Last activity: {formatDateLabel(selectedCompany.updated_at)}</p>
                      <p>Workspace status: Active account</p>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <Field
                      label="Company"
                      value={draft.name}
                      onChange={(value) => setDraft((current) => (current ? { ...current, name: value } : current))}
                    />
                    <Field
                      label="Trade name"
                      value={draft.company_name}
                      onChange={(value) => setDraft((current) => (current ? { ...current, company_name: value } : current))}
                    />
                    <Field
                      label="Website"
                      value={draft.website}
                      onChange={(value) => setDraft((current) => (current ? { ...current, website: value } : current))}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Country"
                        value={draft.country}
                        onChange={(value) => setDraft((current) => (current ? { ...current, country: value } : current))}
                      />
                      <Field
                        label="Currency"
                        value={draft.currency}
                        onChange={(value) => setDraft((current) => (current ? { ...current, currency: value } : current))}
                      />
                    </div>
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Owner</span>
                      <select
                        value={draft.owner_user_id}
                        onChange={(event) => setDraft((current) => (current ? { ...current, owner_user_id: event.target.value } : current))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-900/5"
                      >
                        <option value="">Unassigned</option>
                        {owners.map((owner) => (
                          <option key={owner.id} value={owner.id}>
                            {owner.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TextAreaField
                      label="Internal notes"
                      value={draft.notes}
                      onChange={(value) => setDraft((current) => (current ? { ...current, notes: value } : current))}
                      placeholder="Capture commercial context, next step, or qualification notes."
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void saveSelectedCompany()}
                      disabled={isSaving}
                      className="inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isSaving ? "Saving..." : "Save changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(deriveDraftFromClient(selectedCompany))}
                      className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      Reset
                    </button>
                  </div>
                </>
              ) : (
                <EmptyPanel
                  onCreate={() => {
                    setIsCreateMode(true);
                    updateUrl({ companyId: null });
                  }}
                />
              )}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
