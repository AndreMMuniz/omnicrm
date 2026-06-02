import { describe, expect, it } from "vitest";

import {
  buildCompaniesQuery,
  getCompaniesQuickFilter,
  getCompaniesSort,
  isCompanyRowMatch,
  sortCompanyRows,
} from "@/lib/companiesWorkspace";
import type { ClientListDto } from "@/types/client";

const rows: ClientListDto[] = [
  {
    id: "1",
    name: "Zulu Labs",
    company_name: "Zulu",
    country: "US",
    client_type: "company",
    currency: "USD",
    website: "https://zulu.example.com",
    owner_user_id: "owner-1",
    owner_name: "Alex",
    created_at: "2026-05-01T10:00:00Z",
    updated_at: "2026-06-01T10:00:00Z",
  },
  {
    id: "2",
    name: "Acme Brasil",
    company_name: "Acme",
    country: "BR",
    client_type: "company",
    currency: "BRL",
    owner_user_id: null,
    owner_name: null,
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-02T10:00:00Z",
  },
];

describe("companiesWorkspace helpers", () => {
  it("builds bookmarkable query state for company workspace", () => {
    const params = buildCompaniesQuery({
      companyId: "company-1",
      search: " acme ",
      quickFilter: "my-accounts",
      country: "br",
      sort: "company-asc",
    });

    expect(params.toString()).toBe("companyId=company-1&search=acme&filter=my-accounts&country=BR&sort=company-asc");
  });

  it("normalizes quick filter and sort fallbacks", () => {
    expect(getCompaniesQuickFilter("unassigned")).toBe("unassigned");
    expect(getCompaniesQuickFilter("unknown")).toBe("all");
    expect(getCompaniesSort("created-at")).toBe("created-at");
    expect(getCompaniesSort("unknown")).toBe("last-activity");
  });

  it("matches rows by owner scope, search, and country", () => {
    expect(
      isCompanyRowMatch(rows[0], {
        search: "alex",
        quickFilter: "my-accounts",
        currentUserId: "owner-1",
        country: "us",
      }),
    ).toBe(true);

    expect(
      isCompanyRowMatch(rows[1], {
        search: "",
        quickFilter: "unassigned",
        currentUserId: "owner-1",
        country: "",
      }),
    ).toBe(true);

    expect(
      isCompanyRowMatch(rows[0], {
        search: "",
        quickFilter: "unassigned",
        currentUserId: "owner-1",
        country: "",
      }),
    ).toBe(false);

    expect(
      isCompanyRowMatch(rows[1], {
        search: "",
        quickFilter: "all",
        currentUserId: "owner-1",
        country: "us",
      }),
    ).toBe(false);
  });

  it("sorts rows by workspace sort mode", () => {
    expect(sortCompanyRows(rows, "last-activity").map((row) => row.id)).toEqual(["2", "1"]);
    expect(sortCompanyRows(rows, "created-at").map((row) => row.id)).toEqual(["2", "1"]);
    expect(sortCompanyRows(rows, "company-asc").map((row) => row.id)).toEqual(["2", "1"]);
  });
});
