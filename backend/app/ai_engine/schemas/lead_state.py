from __future__ import annotations

from typing import Annotated, Optional
from typing_extensions import TypedDict
from operator import add


class ConversationMessage(TypedDict):
    role: str       # "customer" | "agent" | "bot"
    content: str
    created_at: str  # ISO 8601


class ExtractedEntities(TypedDict, total=False):
    name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    company: Optional[str]


class ExtractionConfidence(TypedDict, total=False):
    name: float
    email: float
    phone: float
    company: float


class LeadCreationResult(TypedDict):
    lead_id: Optional[str]
    created: bool
    duplicate: bool
    error: Optional[str]


class ConversationLeadState(TypedDict):
    # ── Input (required to start the graph) ──────────────────────────────────
    conversation_id: str
    channel: str   # "whatsapp" | "telegram" | "email" | "web" | ...

    # ── Populated by load_messages node ──────────────────────────────────────
    messages: list[ConversationMessage]

    # ── Populated by extract_entities node ───────────────────────────────────
    extracted_entities: ExtractedEntities
    extraction_confidence: ExtractionConfidence
    extraction_error: bool

    # ── Populated by check_duplicate node ────────────────────────────────────
    existing_lead_id: Optional[str]
    should_create_lead: bool

    # ── Populated by create_lead node ────────────────────────────────────────
    lead_result: Optional[LeadCreationResult]

    # ── Internal error tracking (accumulated across nodes) ───────────────────
    errors: Annotated[list[str], add]
