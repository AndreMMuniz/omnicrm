import type { ClientListDto } from "@/types/client";

export type CompaniesQuickFilter = "all" | "my-accounts";

export type CompaniesWorkspaceState = {
  companyId: string | null;
  search: string;
  quickFilter: CompaniesQuickFilter;
};

export type CompanyRowMatchContext = {
  search: string;
  quickFilter: CompaniesQuickFilter;
  currentUserId: string | null;
};

export type CompanyDraft = {
  name: string;
  company_name: string;
  country: string;
  currency: string;
  website: string;
  notes: string;
  owner_user_id: string;
};

export type CompanyRecord = ClientListDto;
