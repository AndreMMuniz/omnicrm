"""Message persistence — sequencing, idempotency, DB writes."""
from typing import Optional
from uuid import UUID
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Conversation, Message


class MessageCreationService:
    def __init__(self, db: Session):
        self.db = db

    def _next_sequence(self, conversation_id: UUID) -> int:
        """Compute next conversation_sequence (thread-safe within single process)."""
        max_seq = self.db.query(
            func.coalesce(func.max(Message.conversation_sequence), 0)
        ).filter(Message.conversation_id == conversation_id).scalar()
        return (max_seq or 0) + 1

    def _find_by_idempotency_key(self, key: str) -> Optional[Message]:
        return self.db.query(Message).filter(Message.idempotency_key == key).first()

    def find_by_idempotency_key(self, key: str) -> Optional[Message]:
        return self._find_by_idempotency_key(key)

    def create_message(
        self,
        conversation: Conversation,
        content: str,
        inbound: bool = False,
        owner_id: Optional[UUID] = None,
        message_type: str = "TEXT",
        image: Optional[str] = None,
        file: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        is_internal: bool = False,
        update_last_message: bool = True,
    ) -> Message:
        """
        Create and persist a message with an auto-incremented sequence number.
        Returns existing message if idempotency_key was already used.
        """
        if idempotency_key:
            existing = self._find_by_idempotency_key(idempotency_key)
            if existing:
                return existing

        from app.models.models import MessageType as MsgType
        msg_type_enum = MsgType[message_type.upper()] if isinstance(message_type, str) else message_type

        sequence = self._next_sequence(conversation.id)
        message = Message(
            conversation_id=conversation.id,
            content=content,
            inbound=inbound,
            owner_id=owner_id,
            message_type=msg_type_enum,
            is_internal=is_internal,
            image=image,
            file=file,
            conversation_sequence=sequence,
            idempotency_key=idempotency_key,
        )
        self.db.add(message)
        if update_last_message:
            conversation.last_message = content
        conversation.is_unread = inbound
        self.db.commit()
        self.db.refresh(message)
        return message
