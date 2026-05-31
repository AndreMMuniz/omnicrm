import { apiGet, apiGetList, apiMutate } from "@/lib/apiClient";
import type { CustomerTimeline } from "@/types/chat";
import type { ClientContactDto, ClientCreateRequest, ClientDto, ClientListDto, ClientUpdateRequest } from "@/types/client";

export async function listClients(params?: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiGetList<ClientListDto>(`/admin/clients${suffix}`);
}

export async function getClient(clientId: string): Promise<ClientDto> {
  return apiGet<ClientDto>(`/admin/clients/${clientId}`);
}

export async function listClientContacts(clientId: string): Promise<ClientContactDto[]> {
  return apiGet<ClientContactDto[]>(`/admin/clients/${clientId}/contacts`);
}

export async function getClientTimeline(
  clientId: string,
  params?: Record<string, string | number | undefined>,
): Promise<CustomerTimeline> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiGet<CustomerTimeline>(`/admin/clients/${clientId}/timeline${suffix}`);
}

export async function createClient(body: ClientCreateRequest): Promise<ClientDto> {
  return apiMutate<ClientCreateRequest, ClientDto>("/admin/clients", "POST", body);
}

export async function updateClient(clientId: string, body: ClientUpdateRequest): Promise<ClientDto> {
  return apiMutate<ClientUpdateRequest, ClientDto>(`/admin/clients/${clientId}`, "PATCH", body);
}

export async function deleteClient(clientId: string): Promise<void> {
  return apiMutate<undefined, void>(`/admin/clients/${clientId}`, "DELETE");
}
