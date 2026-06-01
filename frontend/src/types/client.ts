export type ClientType = "individual" | "company";

export interface ClientDto {
  id: string;
  name: string;
  country: string;
  client_type: ClientType;
  tax_id?: string | null;
  tax_id_type?: string | null;
  currency: string;
  company_name?: string | null;
  website?: string | null;
  notes?: string | null;
  contact_id?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  created_by_user_id: string;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ClientListDto {
  id: string;
  name: string;
  company_name?: string | null;
  country: string;
  client_type: ClientType;
  currency: string;
  website?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface ClientContactDto {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  channel_identifier?: string | null;
  created_at: string;
}

export interface ClientCreateRequest {
  name: string;
  country?: string;
  client_type?: ClientType;
  tax_id?: string | null;
  tax_id_type?: string | null;
  currency?: string;
  company_name?: string | null;
  website?: string | null;
  notes?: string | null;
  contact_id?: string | null;
  owner_user_id?: string | null;
}

export type ClientUpdateRequest = Partial<ClientCreateRequest>;
