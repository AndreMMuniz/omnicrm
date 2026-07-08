"""SQLAlchemy implementation of LeadRepositoryBase.

This is the only file inside ai_engine/ that imports SQLAlchemy or ORM models.
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.core.hashing import hash_identifier
from app.models.models import Lead, LeadStatus, Message
from app.services.lead_enrichment_service import LeadEnrichmentService
from app.services.lead_identity_resolution_service import LeadIdentityResolutionService
from app.ai_engine.schemas.lead_state import (
    ConversationMessage,
    ExtractedEntities,
    ExtractionConfidence,
)

logger = logging.getLogger(__name__)


class SQLAlchemyLeadAdapter:
    def __init__(self, db: Session) -> None:
        self._db = db

    def get_conversation_messages(self, conversation_id: str) -> list[ConversationMessage]:
        rows = (
            self._db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.is_internal == False,
            )
            .order_by(Message.created_at.asc())
            .all()
        )
        return [
            ConversationMessage(
                role="customer" if row.inbound else "agent",
                content=row.content or "",
                created_at=row.created_at.isoformat() if row.created_at else "",
            )
            for row in rows
        ]

    def find_lead_by_identifier(
        self,
        email: Optional[str] = None,
        phone: Optional[str] = None,
    ) -> Optional[str]:
        email_h = hash_identifier(email) if email else None
        phone_h = hash_identifier(phone) if phone else None

        if not email_h and not phone_h:
            return None

        q = self._db.query(Lead.id)
        if email_h and phone_h:
            q = q.filter((Lead.email_hash == email_h) | (Lead.phone_hash == phone_h))
        elif email_h:
            q = q.filter(Lead.email_hash == email_h)
        else:
            q = q.filter(Lead.phone_hash == phone_h)

        row = q.first()
        return str(row[0]) if row else None

    def create_lead(
        self,
        conversation_id: str,
        channel: str,
        entities: ExtractedEntities,
        confidence: ExtractionConfidence,
    ) -> str:
        email = entities.get("email")
        phone = entities.get("phone")

        lead = Lead(
            conversation_id=conversation_id,
            name=entities.get("name"),
            email=email,          # EncryptedString TypeDecorator handles AES-256
            phone=phone,
            company=entities.get("company"),
            email_hash=hash_identifier(email),
            phone_hash=hash_identifier(phone),
            source_channel=channel,
            extraction_confidence=dict(confidence),
            status=LeadStatus.NEW,
        )
        self._db.add(lead)
        self._db.flush()   # populate lead.id without committing — caller owns the transaction
        self._db.commit()
        self.resolve_lead_identity(str(lead.id))
        try:
            LeadEnrichmentService(self._db).enrich_lead(lead.id)
        except Exception:
            # Lead creation must remain successful even when enrichment fails.
            logger.exception("Lead enrichment failed after lead creation for lead %s", lead.id)
        return str(lead.id)

    def resolve_lead_identity(self, lead_id: str) -> Optional[str]:
        try:
            result = LeadIdentityResolutionService(self._db).resolve_for_lead(lead_id)
            return result.lead_identity_id
        except Exception:
            # Identity resolution must not break lead creation.
            return None
