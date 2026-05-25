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

# --- Messages ---
class MessageBase(BaseModel):
    content: str
    inbound: bool
    message_type: MessageType
    image: Optional[str] = None
    file: Optional[str] = None

class MessageCreate(MessageBase):
    conversation_id: UUID
    owner_id: Optional[UUID] = None
    inbound: bool = False
    idempotency_key: Optional[str] = None

class MessageResponse(MessageBase):
    id: UUID
    conversation_id: UUID
    owner_id: Optional[UUID] = None
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
    is_unread: bool = False

    @field_serializer("status")
    def serialize_status(self, status: ConversationStatus):
        return serialize_conversation_status(status)

class ConversationCreate(ConversationBase):
    contact_id: UUID
    thread_id: Optional[str] = None

class ConversationUpdate(BaseModel):
    status: Optional[ConversationStatus] = None
    tag: Optional[ConversationTag] = None
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


class ConversationAssignmentUpdate(BaseModel):
    assigned_user_id: Optional[UUID] = None

class AssignedUserSlim(BaseModel):
    id: UUID
    full_name: str
    email: str
    avatar: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


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
