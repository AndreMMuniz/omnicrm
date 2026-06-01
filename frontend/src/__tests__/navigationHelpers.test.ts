import { describe, expect, it } from "vitest";

import type { NavigationItem } from "@/config/adminNavigation";
import { getInitialExpandedGroups } from "@/lib/navigation";

const clientsItem: NavigationItem = {
  href: "/clients",
  icon: "groups",
  title: "Clients",
  activePaths: ["/clients", "/clients/companies", "/clients/people", "/clients/opportunities"],
  children: [
    { href: "/clients/companies", label: "Companies" },
    { href: "/clients/people", label: "People" },
    { href: "/clients/opportunities", label: "Opportunities" },
  ],
};

describe("getInitialExpandedGroups", () => {
  it("starts the clients group expanded when a child route is active", () => {
    expect(getInitialExpandedGroups([clientsItem], "/clients/people")).toEqual({
      "/clients": true,
    });
  });

  it("keeps grouped items collapsed when no child route is active", () => {
    expect(getInitialExpandedGroups([clientsItem], "/dashboard")).toEqual({
      "/clients": false,
    });
  });
});
