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
    listPeople: vi.fn().mockResolvedValue({
      data: [
        {
          id: "contact-1",
          name: "Marina Costa",
          email: "marina@example.com",
          phone: null,
          avatar: null,
          channel_identifier: "@marina",
          client_id: "client-1",
          client_name: "Acme Brasil",
          client_company_name: "Acme",
          created_at: "2026-06-01T10:00:00Z",
          last_conversation_at: "2026-06-02T10:00:00Z",
          conversation_count: 3,
        },
      ],
    }),
    getPeopleContext: vi.fn().mockResolvedValue({
      id: "contact-1",
      name: "Marina Costa",
      email: "marina@example.com",
      phone: null,
      avatar: null,
      channel_identifier: "@marina",
      created_at: "2026-06-01T10:00:00Z",
      conversation_count: 3,
      last_conversation_at: "2026-06-02T10:00:00Z",
      linked_company: {
        id: "client-1",
        name: "Acme Brasil",
        company_name: "Acme",
        country: "BR",
      },
      related_conversations: [],
      projects_count: 2,
      proposals_count: 1,
    }),
    getClient: vi.fn(),
    createClient: vi.fn(),
    updateClient: vi.fn(),
  },
  projectsApi: {
    listProjects: vi.fn().mockResolvedValue({
      data: [
        {
          id: "project-1",
          reference: "PRJ-001",
          title: "Expansion Retainer",
          stage: "proposal",
          priority: "high",
          status: "open",
          source_type: "manual",
          client_id: "client-1",
          client: {
            id: "client-1",
            name: "Acme Brasil",
            company_name: "Acme",
            country: "BR",
            client_type: "company",
            currency: "BRL",
            created_at: "2026-06-01T10:00:00Z",
          },
          contact_name: "Marina Costa",
          channel: "email",
          owner_name: "Owner User",
          value: 42000,
          progress: 55,
          created_at: "2026-06-01T10:00:00Z",
          updated_at: "2026-06-02T10:00:00Z",
        },
      ],
    }),
  },
  proposalsApi: {
    listProposals: vi.fn().mockResolvedValue({
      data: [
        {
          id: "proposal-1",
          reference: "PROP-001",
          title: "Acme Expansion Proposal",
          status: "sent",
          subtotal_amount: 42000,
          discount_amount: 0,
          total_amount: 42000,
          created_by_id: "user-1",
          created_by_name: "Owner User",
          items_count: 3,
          client_id: "client-1",
          currency: "BRL",
          created_at: "2026-06-01T10:00:00Z",
          updated_at: "2026-06-02T12:00:00Z",
        },
      ],
    }),
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

  it("renders the People workspace over customer contacts instead of the placeholder", async () => {
    render(<PeoplePage />);

    expect(screen.getByRole("heading", { name: "People" }).textContent).toBe("People");
    expect(await screen.findByText("Marina Costa")).toBeTruthy();
    expect(screen.getByPlaceholderText("Search by person, identifier, email, phone, or linked company...")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Company" }).textContent).toBe("Company");
  });

  it("renders the Opportunities workspace over projects and proposals instead of the placeholder", async () => {
    render(<OpportunitiesPage />);

    expect(screen.getByRole("heading", { name: "Opportunities" }).textContent).toBe("Opportunities");
    expect((await screen.findAllByText("Expansion Retainer")).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Search by company, project, owner, or proposal signal...")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Proposal signal" }).textContent).toBe("Proposal signal");
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
