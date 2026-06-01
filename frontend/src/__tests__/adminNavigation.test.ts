import { describe, expect, it } from "vitest";

import { MAIN_NAV_ITEMS } from "@/config/adminNavigation";

describe("MAIN_NAV_ITEMS", () => {
  it("puts Pipeline first, Messages second, and Dashboard third", () => {
    expect(MAIN_NAV_ITEMS.slice(0, 3).map((item) => item.title)).toEqual([
      "Pipeline",
      "Messages",
      "Dashboard",
    ]);
  });

  it("defines Clients as a grouped menu with the expected CRM submenus", () => {
    const clientsItem = MAIN_NAV_ITEMS.find((item) => item.title === "Clients");

    expect(clientsItem).toBeDefined();
    expect(clientsItem?.children?.map((child) => child.label)).toEqual([
      "Companies",
      "People",
      "Opportunities",
    ]);
    expect(clientsItem?.children?.map((child) => child.href)).toEqual([
      "/clients/companies",
      "/clients/people",
      "/clients/opportunities",
    ]);
  });
});
