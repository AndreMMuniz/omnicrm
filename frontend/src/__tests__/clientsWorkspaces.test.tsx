import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ClientsPage from "@/app/clients/page";
import CompaniesPage from "@/app/clients/companies/page";
import PeoplePage from "@/app/clients/people/page";
import OpportunitiesPage from "@/app/clients/opportunities/page";
import { ClientsWorkspacePlaceholder } from "@/components/clients/ClientsWorkspacePlaceholder";

const redirectMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (href: string) => redirectMock(href),
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", full_name: "Owner User" },
  }),
}));

vi.mock("@/lib/api", () => ({
  clientsApi: {
    listClients: vi.fn().mockResolvedValue({ data: [] }),
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
  },
  usersApi: {
    listUsers: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

describe("clients workspace routes", () => {
  it("redirects the legacy /clients route to /clients/companies", () => {
    ClientsPage();

    expect(redirectMock).toHaveBeenCalledWith("/clients/companies");
  });

  it("renders a dedicated Companies workspace instead of the legacy Clients page", async () => {
    render(<CompaniesPage />);

    expect(screen.getByRole("heading", { name: "Companies" }).textContent).toBe("Companies");
    expect(await screen.findByText("Table-first CRM workspace for account scanning, ownership review, and quick company context.")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search by company, trade name, owner, or country...")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Company" }).textContent).toBe("Company");
    expect(screen.getByRole("columnheader", { name: "Open opportunities" }).textContent).toBe("Open opportunities");
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
