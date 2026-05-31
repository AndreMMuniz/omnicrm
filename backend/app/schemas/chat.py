from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator
from typing import List, Optional
from datetime import datetime
from uuid import UUID
from app.models.models import ChannelType, ConversationStatus, ConversationTag, MessageType, DeliveryStatus


def serialize_conversation_status(status: ConversationStatus | str | None) -> str | None:
    if status is None:
        return None
    if isinstance(status, ConversationStatus):
        normalized = status.value
    else:
        normalized = str(status).lower()
    return "resolved" if normalized == "closed" else normalized


def _normalize_conversation_tag_value(value: ConversationTag | str) -> str:
    if isinstance(value, ConversationTag):
        return value.value

    raw_value = str(value).strip()
    if not raw_value:
        return ""

    upper_value = raw_value.upper()
    if upper_value in ConversationTag.__members__:
        return ConversationTag[upper_value].value

    return raw_value.lower()


def normalize_conversation_tags(value: Optional[List[ConversationTag | str]]) -> List[str]:
    if not value:
        return []

    normalized: list[str] = []
    allowed = {item.value for item in ConversationTag}
    for item in value:
        clean = _normalize_conversation_tag_value(item).strip().lower()
        if clean and clean in allowed and clean not in normalized:
            normalized.append(clean)
    return normalized

# --- Contacts ---
class ContactBase(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    channel_identifier: Optional[str] = None

class ContactResponse(ContactBase):
    id: UUID
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CustomerContextClientResponse(BaseModel):
    id: UUID
    name: str
    company_name: Optional[str] = None
    country: str
    client_type: str
    currency: str


class CustomerContextProposalSummary(BaseModel):
    id: UUID
    reference: str
    title: str
    status: str
    total_amount: int
    updated_at: datetime


class CustomerContextProjectSummary(BaseModel):
    id: UUID
    reference: str
    title: str
    stage: str
    status: str
    priority: str
    updated_at: datetime
    is_current_context: bool = False


class CustomerContextSignalsResponse(BaseModel):
    has_linked_client: bool
    has_project_context: bool
    recent_proposals_count: int
    open_projects_count: int


class ConversationCustomerContextResponse(BaseModel):
    contact: ContactResponse
    client: Optional[CustomerContextClientResponse] = None
    proposals: List[CustomerContextProposalSummary] = Field(default_factory=list)
    projects: List[CustomerContextProjectSummary] = Field(default_factory=list)
    signals: CustomerContextSignalsResponse


class CustomerTimelineEventResponse(BaseModel):
    id: str
    event_type: str
    occurred_at: datetime
    title: str
    description: Optional[str] = None
    source_entity_type: str
    source_entity_id: UUID
    source_entity_label: Optional[str] = None
    is_internal: bool = False
    conversation_id: Optional[UUID] = None
    client_id: Optional[UUID] = None
    proposal_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    href: Optional[str] = None


class CustomerTimelineResponse(BaseModel):
    scope: str
    conversation_id: Optional[UUID] = None
    client_id: Optional[UUID] = None
    events: List[CustomerTimelineEventResponse] = Field(default_factory=list)


class AssignedUserSlim(BaseModel):
    id: UUID
    full_name: str
    email: str
    avatar: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

# --- Messages ---
class MessageBase(BaseModel):
    content: str
    inbound: bool
    message_type: MessageType
    image: Optional[str] = None
    file: Optional[str] = None
    is_internal: bool = False

class MessageCreate(MessageBase):
    conversation_id: UUID
    owner_id: Optional[UUID] = None
    inbound: bool = False
    idempotency_key: Optional[str] = None


class InternalNoteCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)

class MessageResponse(MessageBase):
    id: UUID
    conversation_id: UUID
    owner_id: Optional[UUID] = None
    owner: Optional[AssignedUserSlim] = None
    conversation_sequence: int = 0
    delivery_status: Optional[DeliveryStatus] = None
    delivery_error: Optional[str] = None
    retry_count: int = 0
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

# --- Conversations ---
class ConversationBase(BaseModel):
    channel: ChannelType
    status: ConversationStatus
    tag: Optional[ConversationTag] = None
    tags: List[ConversationTag] = Field(default_factory=list)
    is_unread: bool = False

    @field_validator("tag", mode="before")
    @classmethod
    def normalize_base_tag(cls, value):
        if value is None:
            return value
        if isinstance(value, str):
            return _normalize_conversation_tag_value(value)
        return value

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_base_tags(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            return [_normalize_conversation_tag_value(value)]
        return [_normalize_conversation_tag_value(item) for item in value]

    @field_serializer("status")
    def serialize_status(self, status: ConversationStatus):
        return serialize_conversation_status(status)

    @field_serializer("tags")
    def serialize_tags(self, tags: List[ConversationTag]):
        return [_normalize_conversation_tag_value(tag) for tag in tags]

class ConversationCreate(ConversationBase):
    contact_id: UUID
    thread_id: Optional[str] = None

class ConversationUpdate(BaseModel):
    status: Optional[ConversationStatus] = None
    tag: Optional[ConversationTag] = None
    tags: Optional[List[ConversationTag]] = None
    is_unread: Optional[bool] = None
    assigned_user_id: Optional[UUID] = None

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value):
        if isinstance(value, str):
            normalized = value.lower()
            return "closed" if normalized == "resolved" else normalized
        return value

    @field_validator("tag", mode="before")
    @classmethod
    def normalize_tag(cls, value):
        if isinstance(value, str):
            return value.lower()
        return value

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value):
        if value is None:
            return value
        if isinstance(value, str):
            return [value.lower()]
        return [_normalize_conversation_tag_value(item) for item in value]


class ConversationAssignmentUpdate(BaseModel):
    assigned_user_id: Optional[UUID] = None


class ConversationResponse(ConversationBase):
    id: UUID
    contact_id: UUID
    project_context_id: Optional[UUID] = None
    thread_id: Optional[str] = None
    last_message: Optional[str] = None
    last_message_date: Optional[datetime] = None
    first_response_at: Optional[datetime] = None
    assigned_user_id: Optional[UUID] = None
    assigned_user: Optional[AssignedUserSlim] = None
    created_at: datetime
    updated_at: datetime
    contact: Optional[ContactResponse] = None
    model_config = ConfigDict(from_attributes=True)

class ConversationWithMessagesResponse(ConversationResponse):
    messages: List[MessageResponse] = []

class AISuggestionResponse(BaseModel):
    suggestions: List[str]
    conversation_id: UUID
    model_config = ConfigDict(from_attributes=True)
