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

export interface PeopleListDto {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
  channel_identifier?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  client_company_name?: string | null;
  created_at: string;
  last_conversation_at?: string | null;
  conversation_count: number;
}

export interface PersonLinkedCompanyDto {
  id: string;
  name: string;
  company_name?: string | null;
  country: string;
}

export interface PersonConversationSummaryDto {
  id: string;
  channel: string;
  status: string;
  last_message?: string | null;
  last_message_date?: string | null;
  updated_at: string;
}

export interface PeopleDetailDto {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
  channel_identifier?: string | null;
  created_at: string;
  conversation_count: number;
  last_conversation_at?: string | null;
  linked_company?: PersonLinkedCompanyDto | null;
  related_conversations: PersonConversationSummaryDto[];
  projects_count: number;
  proposals_count: number;
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
