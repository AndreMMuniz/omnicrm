"""
ConversationService — business logic for conversation state management.
"""

import asyncio
import logging
from typing import Optional
from sqlalchemy import inspect
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.models.models import Conversation, ConversationStatus, ConversationTag
from app.core.websocket import manager
from app.schemas.chat import normalize_conversation_tags, serialize_conversation_status

log = logging.getLogger(__name__)


def _serialize_assigned_user(conversation: Conversation) -> Optional[dict]:
    user = conversation.assigned_user
    if not user:
        return None
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "avatar": user.avatar,
    }


def _serialize_tags(conversation: Conversation) -> list[str]:
    return normalize_conversation_tags(getattr(conversation, "tags", None))


def _conversation_has_tags_column(db: Session) -> bool:
    columns = inspect(db.bind).get_columns("conversations")
    return any(column["name"] == "tags" for column in columns)


def _hydrate_legacy_tags(conversation: Conversation) -> Conversation:
    legacy_tag = getattr(conversation, "tag", None)
    derived_tags = []
    if legacy_tag:
        derived_tags = normalize_conversation_tags([
            legacy_tag.value if hasattr(legacy_tag, "value") else legacy_tag
        ])

    set_committed_value(conversation, "tags", derived_tags)
    return conversation


class ConversationService:
    """Manages conversation state changes and real-time notifications."""

    def __init__(self, db: Session):
        self.db = db

    def update_conversation(self, conversation: Conversation, data: dict) -> Conversation:
        """Apply field updates and persist."""
        has_tags_column = _conversation_has_tags_column(self.db)
        if "tags" in data:
            normalized_tags = normalize_conversation_tags(data.get("tags"))
            data["tag"] = ConversationTag[normalized_tags[0].upper()] if normalized_tags else None
            if has_tags_column:
                data["tags"] = normalized_tags
            else:
                data.pop("tags", None)
        elif "tag" in data:
            normalized_tag = data.get("tag")
            if normalized_tag is None:
                if has_tags_column:
                    data["tags"] = []
            else:
                value = normalized_tag.value if hasattr(normalized_tag, "value") else str(normalized_tag).lower()
                normalized_tags = normalize_conversation_tags([value])
                if has_tags_column:
                    data["tags"] = normalized_tags
                data["tag"] = ConversationTag[normalized_tags[0].upper()] if normalized_tags else None

        if data.get("needs_follow_up") is False:
            data["follow_up_note"] = None
            data["follow_up_at"] = None

        for key, value in data.items():
            setattr(conversation, key, value)
        self.db.commit()
        if has_tags_column:
            self.db.refresh(conversation)
        else:
            _hydrate_legacy_tags(conversation)
        return conversation

    async def broadcast_update(self, conversation: Conversation) -> None:
        """Notify all clients about a conversation state change."""
        await manager.broadcast_global("conversation_updated", {
            "id": str(conversation.id),
            "status": serialize_conversation_status(conversation.status),
            "tag": conversation.tag.value if conversation.tag else None,
            "tags": _serialize_tags(conversation),
            "needs_follow_up": conversation.needs_follow_up,
            "follow_up_note": conversation.follow_up_note,
            "follow_up_at": conversation.follow_up_at.isoformat() if conversation.follow_up_at else None,
            "is_unread": conversation.is_unread,
            "assigned_user_id": str(conversation.assigned_user_id) if conversation.assigned_user_id else None,
            "assigned_user": _serialize_assigned_user(conversation),
        })

    async def update_and_broadcast(
        self, conversation: Conversation, data: dict
    ) -> Conversation:
        """Update state + broadcast in one call.

        If the conversation is being closed, fires a lead detection task
        as fire-and-forget (does not block or affect the response).
        """
        closing = _is_closing(conversation, data)
        updated = self.update_conversation(conversation, data)
        await self.broadcast_update(updated)

        if closing:
            channel = updated.channel.value if updated.channel else "web"
            asyncio.create_task(
                _run_lead_detection(str(updated.id), channel)
            )

        return updated


def get_conversation_service(db: Session) -> ConversationService:
    """FastAPI dependency factory."""
    return ConversationService(db)


# ── Lead detection fire-and-forget ────────────────────────────────────────────

def _is_closing(conversation: Conversation, data: dict) -> bool:
    """Return True if this update transitions the conversation to CLOSED."""
    new_status = data.get("status")
    if new_status is None:
        return False
    if isinstance(new_status, ConversationStatus):
        return new_status == ConversationStatus.CLOSED
    return str(new_status).lower() in {"closed", "resolved"}


async def _run_lead_detection(conversation_id: str, channel: str) -> None:
    """Detect and persist a lead from a newly closed conversation.

    Creates its own DB session so it is fully decoupled from the request
    session (which will be closed before this task finishes).
    Times out after 45 s to avoid runaway tasks.
    """
    from app.core.database import SessionLocal
    from app.ai_engine.adapters.sqlalchemy_adapter import SQLAlchemyLeadAdapter
    from app.ai_engine.graphs.lead_detector import build_lead_detector
    from app.ai_engine.schemas.lead_state import ConversationLeadState

    db = SessionLocal()
    try:
        async with asyncio.timeout(45):
            adapter  = SQLAlchemyLeadAdapter(db)
            detector = build_lead_detector(repo=adapter)

            initial: ConversationLeadState = {
                "conversation_id": conversation_id,
                "channel": channel,
                "messages": [],
                "extracted_entities": {},
                "extraction_confidence": {},
                "extraction_error": False,
                "existing_lead_id": None,
                "should_create_lead": False,
                "lead_result": None,
                "errors": [],
            }

            final = detector.invoke(initial)

            result = final.get("lead_result") or {}
            if result.get("created") and result.get("lead_id"):
                # Notify all connected clients — fire-and-forget inside fire-and-forget
                asyncio.create_task(
                    manager.broadcast_global("new_lead", {
                        "lead_id":    result["lead_id"],
                        "name":       final.get("extracted_entities", {}).get("name"),
                        "channel":    channel,
                        "conversation_id": conversation_id,
                    })
                )
                log.info("lead_detector: lead %s created from conversation %s",
                         result["lead_id"], conversation_id)
            else:
                log.debug("lead_detector: no lead created for conversation %s", conversation_id)

    except TimeoutError:
        log.warning("lead_detector: timeout for conversation %s", conversation_id)
    except Exception:
        log.exception("lead_detector: unexpected error for conversation %s", conversation_id)
    finally:
        db.close()
