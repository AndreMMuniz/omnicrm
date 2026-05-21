"""LeadRepositoryBase — the only interface the LangGraph touches.

SQLAlchemy is a detail hidden behind this Protocol. No node inside
ai_engine/ may import from app.models or app.core.database directly.
"""

from typing import Optional, Protocol, runtime_checkable

from app.ai_engine.schemas.lead_state import (
    ConversationMessage,
    ExtractedEntities,
    ExtractionConfidence,
)


@runtime_checkable
class LeadRepositoryBase(Protocol):

    def get_conversation_messages(
        self, conversation_id: str
    ) -> list[ConversationMessage]:
        """Return all messages for a conversation, ordered by created_at ASC."""
        ...

    def find_lead_by_identifier(
        self,
        email: Optional[str] = None,
        phone: Optional[str] = None,
    ) -> Optional[str]:
        """Return existing lead_id if a lead with this email OR phone exists, else None."""
        ...

    def create_lead(
        self,
        conversation_id: str,
        channel: str,
        entities: ExtractedEntities,
        confidence: ExtractionConfidence,
    ) -> str:
        """Persist a new lead. Returns the new lead_id (str UUID)."""
        ...
