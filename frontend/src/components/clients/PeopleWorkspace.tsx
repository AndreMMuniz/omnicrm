"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { clientsApi } from "@/lib/api";
import type { PeopleDetailDto, PeopleListDto } from "@/types/client";

type PeopleFilter = "all" | "linked" | "unlinked";

function getPeopleFilter(value: string | null | undefined): PeopleFilter {
  if (value === "linked" || value === "unlinked") return value;
  return "all";
}

function formatDateLabel(iso: string | null | undefined) {
  if (!iso) return "No activity yet";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getPersonLabel(person: { name?: string | null; email?: string | null; phone?: string | null; channel_identifier?: string | null }) {
  return person.name?.trim() || person.email?.trim() || person.phone?.trim() || person.channel_identifier?.trim() || "Unnamed contact";
}

function getIdentityHint(person: { email?: string | null; phone?: string | null; channel_identifier?: string | null }) {
  return person.channel_identifier?.trim() || person.email?.trim() || person.phone?.trim() || "No identity clue";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatFieldName(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const displayValues = value.filter((item) => ["string", "number", "boolean"].includes(typeof item)).slice(0, 3);
    return displayValues.length > 0 ? displayValues.join(", ") : null;
  }
  return null;
}

function getSourceFactItems(facts: Record<string, unknown>) {
  const items: { label: string; value: string }[] = [];
  Object.entries(facts).forEach(([group, groupValue]) => {
    if (!isRecord(groupValue)) return;
    Object.entries(groupValue).forEach(([key, value]) => {
      if (key === "id" || key === "extraction_confidence") return;
      const displayValue = formatDetailValue(value);
      if (!displayValue) return;
      items.push({ label: `${formatFieldName(group)}: ${formatFieldName(key)}`, value: displayValue });
    });
  });
  return items.slice(0, 8);
}

function getInferenceItems(inferences: Record<string, unknown>) {
  const items: { label: string; value: string; detail?: string | null }[] = [];
  Object.entries(inferences).forEach(([key, value]) => {
    const entries = Array.isArray(value) ? value : [value];
    entries.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const displayValue = formatDetailValue(entry.value);
      if (!displayValue) return;
      const confidence = typeof entry.confidence === "number" ? `${Math.round(entry.confidence * 100)}%` : null;
      const rationale = formatDetailValue(entry.rationale);
      items.push({
        label: entries.length > 1 ? `${formatFieldName(key)} ${index + 1}` : formatFieldName(key),
        value: confidence ? `${displayValue} (${confidence})` : displayValue,
        detail: rationale,
      });
    });
  });
  return items.slice(0, 8);
}

export function PeopleWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedPersonId = searchParams.get("personId");
  const search = searchParams.get("search") ?? "";
  const filter = getPeopleFilter(searchParams.get("filter"));

  const [people, setPeople] = useState<PeopleListDto[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PeopleDetailDto | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPanel, setLoadingPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visiblePeopleIds = people.map((person) => person.id).join("|");
  const linkedCount = people.filter((person) => person.client_id).length;
  const unlinkedCount = people.filter((person) => !person.client_id).length;
  const leadFactItems = selectedPerson?.lead_enrichment ? getSourceFactItems(selectedPerson.lead_enrichment.source_facts) : [];
  const leadInferenceItems = selectedPerson?.lead_enrichment ? getInferenceItems(selectedPerson.lead_enrichment.ai_inferences) : [];

  function updateUrl(next: { personId?: string | null; search?: string; filter?: PeopleFilter }) {
    const params = new URLSearchParams();
    const nextPersonId = next.personId === undefined ? selectedPersonId : next.personId;
    const nextSearch = next.search === undefined ? search : next.search;
    const nextFilter = next.filter === undefined ? filter : next.filter;

    if (nextPersonId) params.set("personId", nextPersonId);
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    if (nextFilter !== "all") params.set("filter", nextFilter);

    startTransition(() => {
      router.replace(params.toString() ? `/clients/people?${params.toString()}` : "/clients/people");
    });
  }

  async function loadPeople() {
    setLoadingList(true);
    setError(null);
    try {
      const response = await clientsApi.listPeople({ limit: 200, search, linked: filter === "all" ? undefined : filter });
      setPeople(response.data ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load people.");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadPersonDetail(contactId: string) {
    setLoadingPanel(true);
    setError(null);
    try {
      const detail = await clientsApi.getPeopleContext(contactId);
      setSelectedPerson(detail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load person details.");
    } finally {
      setLoadingPanel(false);
    }
  }

  useEffect(() => {
    void loadPeople();
  }, [search, filter]);

  useEffect(() => {
    if (selectedPersonId && people.some((person) => person.id === selectedPersonId)) {
      void loadPersonDetail(selectedPersonId);
      return;
    }

    setSelectedPerson(null);
    if (people.length > 0) {
      updateUrl({ personId: people[0].id });
    }
  }, [selectedPersonId, visiblePeopleIds]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-6">
        <section className="rounded-[32px] border border-white/70 bg-white/80 p-5 shadow-[0_30px_80px_-48px_rgba(15,23,42,0.55)] backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Clients</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">People</h1>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  {people.length} contacts
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Customer-contact workspace built over channel identities, linked companies, and relationship continuity.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                {[
                  { value: "all" as const, label: "All people" },
                  { value: "linked" as const, label: "Linked company" },
                  { value: "unlinked" as const, label: "Unlinked" },
                ].map((option) => {
                  const active = filter === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateUrl({ filter: option.value, personId: null })}
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
          </div>

          <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <label className="flex min-h-12 flex-1 items-center rounded-2xl border border-slate-200 bg-slate-50 px-4">
              <span className="mr-3 text-slate-400">Search</span>
              <input
                value={search}
                onChange={(event) => updateUrl({ search: event.target.value, personId: null })}
                placeholder="Search by person, identifier, email, phone, or linked company..."
                className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-2">Linked: {linkedCount}</span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-2">Unlinked: {unlinkedCount}</span>
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
                <p className="text-sm font-semibold text-slate-900">People table</p>
                <p className="mt-1 text-xs text-slate-500">Separate customer identities from internal users and keep relationship context visible.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {loadingList ? "Loading..." : `${people.length} rows`}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  <tr>
                    {["Person", "Identity", "Company", "Conversations", "Last activity"].map((column) => (
                      <th key={column} className="px-4 py-3 first:px-5">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingList ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-16 text-center text-sm text-slate-500">Loading people...</td>
                    </tr>
                  ) : people.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-16 text-center text-sm text-slate-500">No people matched this workspace view.</td>
                    </tr>
                  ) : (
                    people.map((person) => {
                      const selected = person.id === selectedPersonId;
                      return (
                        <tr
                          key={person.id}
                          aria-selected={selected}
                          onClick={() => updateUrl({ personId: person.id })}
                          className={`cursor-pointer transition hover:bg-slate-50 ${selected ? "bg-slate-50/90 shadow-[inset_3px_0_0_0_rgb(15,23,42)]" : ""}`}
                        >
                          <td className="px-5 py-4">
                            <div className="font-semibold text-slate-900">{getPersonLabel(person)}</div>
                            <div className="mt-1 text-xs text-slate-500">Customer contact identity</div>
                          </td>
                          <td className="px-4 py-4 text-slate-600">{getIdentityHint(person)}</td>
                          <td className="px-4 py-4 text-slate-600">{person.client_name || "No linked company"}</td>
                          <td className="px-4 py-4 text-slate-600">{person.conversation_count}</td>
                          <td className="px-4 py-4 text-slate-600">{formatDateLabel(person.last_conversation_at)}</td>
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Relationship panel</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  {selectedPerson ? getPersonLabel(selectedPerson) : "Select a person"}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {selectedPerson
                    ? "Use this panel to understand linked company context and jump back into the right conversation."
                    : "Choose a customer person from the list to inspect identity, company linkage, and recent conversations."}
                </p>
              </div>
              {loadingPanel ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">Loading</span> : null}
            </div>

            {selectedPerson ? (
              <div className="mt-5 space-y-5">
                <div className="grid gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-900">{getPersonLabel(selectedPerson)}</span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">{selectedPerson.conversation_count} conversations</span>
                  </div>
                  <div className="grid gap-2 text-xs">
                    <p>Identifier: {getIdentityHint(selectedPerson)}</p>
                    <p>Email: {selectedPerson.email || "-"}</p>
                    <p>Phone: {selectedPerson.phone || "-"}</p>
                    <p>Last activity: {formatDateLabel(selectedPerson.last_conversation_at)}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Linked company</p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {selectedPerson.linked_company?.name || "No company linked yet"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {selectedPerson.linked_company
                          ? `${selectedPerson.linked_company.company_name || "Primary company record"} · ${selectedPerson.linked_company.country}`
                          : "This person still exists as a valid contact identity even before company linkage."}
                      </p>
                    </div>
                    {selectedPerson.linked_company ? (
                      <Link
                        href={`/clients/companies?companyId=${selectedPerson.linked_company.id}`}
                        className="inline-flex rounded-full border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                      >
                        Open company
                      </Link>
                    ) : null}
                  </div>
                  {selectedPerson.linked_company ? (
                    <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2">Projects: {selectedPerson.projects_count}</span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2">Proposals: {selectedPerson.proposals_count}</span>
                    </div>
                  ) : null}
                </div>

                {selectedPerson.lead_enrichment ? (
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-500">Lead intelligence</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {selectedPerson.lead_enrichment.role || "Role not inferred yet"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Status: {selectedPerson.lead_enrichment.enrichment_status}
                        </p>
                      </div>
                      {selectedPerson.lead_enrichment.enriched_at ? (
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500">
                          {formatDateLabel(selectedPerson.lead_enrichment.enriched_at)}
                        </span>
                      ) : null}
                    </div>
                    {selectedPerson.lead_enrichment.qualification_notes ? (
                      <p className="mt-3 text-sm leading-6 text-slate-700">{selectedPerson.lead_enrichment.qualification_notes}</p>
                    ) : null}
                    {selectedPerson.lead_enrichment.pain_points.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedPerson.lead_enrichment.pain_points.map((painPoint, index) => (
                          <span key={`${painPoint}-${index}`} className="rounded-full border border-indigo-100 bg-white px-3 py-1.5 text-xs text-slate-600">
                            {painPoint}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 grid gap-3 text-xs md:grid-cols-2">
                      <div className="rounded-2xl border border-white/80 bg-white/70 p-3">
                        <p className="font-semibold uppercase tracking-[0.14em] text-slate-400">Source facts</p>
                        <div className="mt-3 space-y-2">
                          {leadFactItems.length > 0 ? (
                            leadFactItems.map((item) => (
                              <div key={`${item.label}-${item.value}`} className="flex justify-between gap-3 text-slate-600">
                                <span className="text-slate-400">{item.label}</span>
                                <span className="text-right font-medium text-slate-700">{item.value}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-slate-500">No source facts recorded.</p>
                          )}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/70 p-3">
                        <p className="font-semibold uppercase tracking-[0.14em] text-slate-400">AI inferences</p>
                        <div className="mt-3 space-y-2">
                          {leadInferenceItems.length > 0 ? (
                            leadInferenceItems.map((item) => (
                              <div key={`${item.label}-${item.value}`} className="text-slate-600">
                                <div className="flex justify-between gap-3">
                                  <span className="text-slate-400">{item.label}</span>
                                  <span className="text-right font-medium text-slate-700">{item.value}</span>
                                </div>
                                {item.detail ? <p className="mt-1 text-slate-500">{item.detail}</p> : null}
                              </div>
                            ))
                          ) : (
                            <p className="text-slate-500">No AI inferences recorded.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Recent conversations</p>
                      <p className="mt-2 text-sm text-slate-600">Continue the relationship from the right message thread.</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {selectedPerson.related_conversations.length === 0 ? (
                      <p className="text-sm text-slate-500">No conversations linked to this person yet.</p>
                    ) : (
                      selectedPerson.related_conversations.map((conversation) => (
                        <Link
                          key={conversation.id}
                          href={`/messages?conversationId=${conversation.id}`}
                          className="block rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-slate-900">{conversation.channel}</span>
                            <span className="text-xs text-slate-500">{formatDateLabel(conversation.updated_at)}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">Status: {conversation.status}</p>
                          <p className="mt-2 line-clamp-2 text-sm text-slate-600">{conversation.last_message || "Open this conversation to continue the context."}</p>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[28px] border border-dashed border-slate-300 bg-white/70 p-6 text-sm text-slate-500">
                Select a person to inspect customer identity, company linkage, and recent conversation context.
              </div>
            )}
          </aside>
        </section>
      </div>
    </div>
  );
}
