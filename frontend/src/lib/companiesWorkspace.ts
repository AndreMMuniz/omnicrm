import type { CompanyRowMatchContext, CompaniesQuickFilter, CompaniesSort, CompaniesWorkspaceState } from "@/types/companyWorkspace";
import type { ClientListDto } from "@/types/client";

export function getCompaniesQuickFilter(value: string | null | undefined): CompaniesQuickFilter {
  if (value === "unassigned") return "unassigned";
  return value === "my-accounts" ? "my-accounts" : "all";
}

export function getCompaniesSort(value: string | null | undefined): CompaniesSort {
  if (value === "created-at") return "created-at";
  if (value === "company-asc") return "company-asc";
  return "last-activity";
}

export function buildCompaniesQuery(state: CompaniesWorkspaceState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.companyId) params.set("companyId", state.companyId);
  if (state.search.trim()) params.set("search", state.search.trim());
  if (state.quickFilter !== "all") params.set("filter", state.quickFilter);
  if (state.country.trim()) params.set("country", state.country.trim().toUpperCase());
  if (state.sort !== "last-activity") params.set("sort", state.sort);
  return params;
}

export function isCompanyRowMatch(row: ClientListDto, context: CompanyRowMatchContext): boolean {
  if (row.client_type !== "company") return false;

  if (context.quickFilter === "my-accounts" && row.owner_user_id !== context.currentUserId) {
    return false;
  }
  if (context.quickFilter === "unassigned" && row.owner_user_id) {
    return false;
  }

  if (context.country.trim() && row.country.toLowerCase() !== context.country.trim().toLowerCase()) {
    return false;
  }

  const query = context.search.trim().toLowerCase();
  if (!query) return true;

  return [row.name, row.company_name ?? "", row.owner_name ?? "", row.country]
    .some((value) => value.toLowerCase().includes(query));
}

export function sortCompanyRows(rows: ClientListDto[], sort: CompaniesSort): ClientListDto[] {
  const collator = new Intl.Collator("en", { sensitivity: "base" });

  return [...rows].sort((left, right) => {
    if (sort === "company-asc") {
      return collator.compare(left.name, right.name);
    }

    const leftDate = sort === "created-at" ? left.created_at : left.updated_at;
    const rightDate = sort === "created-at" ? right.created_at : right.updated_at;
    const dateDiff = new Date(rightDate).getTime() - new Date(leftDate).getTime();
    if (dateDiff !== 0) return dateDiff;

    return collator.compare(left.name, right.name);
  });
}
