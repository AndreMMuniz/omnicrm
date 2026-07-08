from __future__ import annotations
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, field_validator, model_validator


class ClientBase(BaseModel):
    name: str
    country: str = "BR"
    client_type: str = "company"      # individual | company
    tax_id: Optional[str] = None
    tax_id_type: Optional[str] = None  # CPF | CNPJ | VAT | EIN | OTHER
    currency: str = "BRL"
    company_name: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    contact_id: Optional[UUID] = None
    owner_user_id: Optional[UUID] = None

    @field_validator("company_name", "website", "notes", "tax_id", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v

    @model_validator(mode="after")
    def tax_id_consistency(self) -> "ClientBase":
        if self.tax_id and not self.tax_id_type:
            raise ValueError("tax_id_type é obrigatório quando tax_id é informado")
        return self


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    country: Optional[str] = None
    client_type: Optional[str] = None
    tax_id: Optional[str] = None
    tax_id_type: Optional[str] = None
    currency: Optional[str] = None
    company_name: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    contact_id: Optional[UUID] = None
    owner_user_id: Optional[UUID] = None

    @field_validator("company_name", "website", "notes", "tax_id", mode="before")
    @classmethod
    def empty_str_to_none(cls, v: object) -> object:
        if isinstance(v, str) and v.strip() == "":
            return None
        return v


class ClientResponse(ClientBase):
    id: UUID
    created_by_user_id: UUID
    owner_name: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ClientListResponse(BaseModel):
    id: UUID
    name: str
    company_name: Optional[str] = None
    country: str
    client_type: str
    currency: str
    website: Optional[str] = None
    owner_user_id: Optional[UUID] = None
    owner_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ClientContactListResponse(BaseModel):
    id: UUID
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    channel_identifier: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PeopleListResponse(BaseModel):
    id: UUID
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    channel_identifier: Optional[str] = None
    client_id: Optional[UUID] = None
    client_name: Optional[str] = None
    client_company_name: Optional[str] = None
    created_at: datetime
    last_conversation_at: Optional[datetime] = None
    conversation_count: int

    model_config = {"from_attributes": True}


class PeopleLinkedCompanyResponse(BaseModel):
    id: UUID
    name: str
    company_name: Optional[str] = None
    country: str

    model_config = {"from_attributes": True}


class PersonConversationSummaryResponse(BaseModel):
    id: UUID
    channel: str
    status: str
    last_message: Optional[str] = None
    last_message_date: Optional[datetime] = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class PeopleLeadEnrichmentResponse(BaseModel):
    id: UUID
    role: Optional[str] = None
    company: Optional[str] = None
    pain_points: list[str] = Field(default_factory=list)
    qualification_notes: Optional[str] = None
    source_facts: dict = Field(default_factory=dict)
    ai_inferences: dict = Field(default_factory=dict)
    enrichment_status: str = "pending"
    enrichment_error: Optional[str] = None
    enriched_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PeopleDetailResponse(BaseModel):
    id: UUID
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    channel_identifier: Optional[str] = None
    created_at: datetime
    conversation_count: int
    last_conversation_at: Optional[datetime] = None
    linked_company: Optional[PeopleLinkedCompanyResponse] = None
    related_conversations: list[PersonConversationSummaryResponse]
    projects_count: int = 0
    proposals_count: int = 0
    lead_enrichment: Optional[PeopleLeadEnrichmentResponse] = None

    model_config = {"from_attributes": True}
