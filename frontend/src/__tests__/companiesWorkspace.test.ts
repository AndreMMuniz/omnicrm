import { describe, expect, it } from "vitest";

import {
  buildCompaniesQuery,
  getCompaniesQuickFilter,
  isCompanyRowMatch,
} from "@/lib/companiesWorkspace";

describe("companies workspace query state", () => {
  it("stores companyId, search and quick filter in URL params", () => {
    expect(
      buildCompaniesQuery({
        companyId: "abc",
        search: "acme",
        quickFilter: "my-accounts",
      }).toString(),
    ).toBe("companyId=abc&search=acme&filter=my-accounts");
  });

  it("normalizes unknown filter values to all", () => {
    expect(getCompaniesQuickFilter("my-accounts")).toBe("my-accounts");
    expect(getCompaniesQuickFilter("anything-else")).toBe("all");
    expect(getCompaniesQuickFilter(null)).toBe("all");
  });

  it("matches only company records for the companies workspace", () => {
    expect(
      isCompanyRowMatch(
        { id: "1", client_type: "company", name: "Acme", company_name: null, country: "BR", currency: "BRL", created_at: "", updated_at: "" },
        { search: "", quickFilter: "all", currentUserId: null },
      ),
    ).toBe(true);
    expect(
      isCompanyRowMatch(
        { id: "2", client_type: "individual", name: "Jane", company_name: null, country: "BR", currency: "BRL", created_at: "", updated_at: "" },
        { search: "", quickFilter: "all", currentUserId: null },
      ),
    ).toBe(false);
  });

  it("supports the my-accounts quick filter", () => {
    expect(
      isCompanyRowMatch(
        { id: "1", client_type: "company", name: "Acme", company_name: null, country: "BR", currency: "BRL", created_at: "", updated_at: "", owner_user_id: "u-1" },
        { search: "", quickFilter: "my-accounts", currentUserId: "u-1" },
      ),
    ).toBe(true);
    expect(
      isCompanyRowMatch(
        { id: "2", client_type: "company", name: "Beta", company_name: null, country: "BR", currency: "BRL", created_at: "", updated_at: "", owner_user_id: "u-2" },
        { search: "", quickFilter: "my-accounts", currentUserId: "u-1" },
      ),
    ).toBe(false);
  });
});
