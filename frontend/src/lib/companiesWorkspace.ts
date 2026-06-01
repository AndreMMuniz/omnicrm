import type { CompanyRowMatchContext, CompaniesQuickFilter, CompaniesWorkspaceState } from "@/types/companyWorkspace";
import type { ClientListDto } from "@/types/client";

export function getCompaniesQuickFilter(value: string | null | undefined): CompaniesQuickFilter {
  return value === "my-accounts" ? "my-accounts" : "all";
}

export function buildCompaniesQuery(state: CompaniesWorkspaceState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.companyId) params.set("companyId", state.companyId);
  if (state.search.trim()) params.set("search", state.search.trim());
  if (state.quickFilter !== "all") params.set("filter", state.quickFilter);
  return params;
}

export function isCompanyRowMatch(row: ClientListDto, context: CompanyRowMatchContext): boolean {
  if (row.client_type !== "company") return false;

  if (context.quickFilter === "my-accounts" && row.owner_user_id !== context.currentUserId) {
    return false;
  }

  const query = context.search.trim().toLowerCase();
  if (!query) return true;

  return [row.name, row.company_name ?? "", row.owner_name ?? "", row.country]
    .some((value) => value.toLowerCase().includes(query));
}
