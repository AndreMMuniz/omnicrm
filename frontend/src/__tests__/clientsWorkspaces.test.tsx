import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ClientsPage from "@/app/clients/page";
import CompaniesPage from "@/app/clients/companies/page";
import PeoplePage from "@/app/clients/people/page";
import OpportunitiesPage from "@/app/clients/opportunities/page";
import { ClientsWorkspacePlaceholder } from "@/components/clients/ClientsWorkspacePlaceholder";

const redirectMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (href: string) => redirectMock(href),
}));

describe("clients workspace routes", () => {
  it("redirects the legacy /clients route to /clients/companies", () => {
    ClientsPage();

    expect(redirectMock).toHaveBeenCalledWith("/clients/companies");
  });

  it("renders a dedicated Companies workspace instead of the legacy Clients page", () => {
    render(<CompaniesPage />);

    expect(screen.getByRole("heading", { name: "Companies workspace" }).textContent).toBe("Companies workspace");
    expect(screen.queryByRole("heading", { name: "Clients" })).toBeNull();
    expect(screen.queryByText("Search by name or company...")).toBeNull();
  });

  it("renders the People workspace placeholder with a normal-width content card", () => {
    render(<PeoplePage />);

    expect(screen.getByRole("heading", { name: "People workspace" }).textContent).toBe("People workspace");
    expect(screen.getByTestId("clients-workspace-card").className).toContain("w-full");
  });

  it("renders the Opportunities workspace placeholder with a normal-width content card", () => {
    render(<OpportunitiesPage />);

    expect(screen.getByRole("heading", { name: "Opportunities workspace" }).textContent).toBe("Opportunities workspace");
    expect(screen.getByTestId("clients-workspace-card").className).toContain("w-full");
  });

  it("keeps the shared placeholder card wide enough for readable text", () => {
    render(
      <ClientsWorkspacePlaceholder
        title="People"
        summary="Resumo"
        description="Detalhes do workspace."
      />,
    );

    const card = screen.getByTestId("clients-workspace-card");
    expect(card.className).toContain("w-full");
    expect(card.className).toContain("max-w-2xl");
  });
});
