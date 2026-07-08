"""
MessageService — thin orchestrator that composes creation, delivery, and broadcast.

All public method signatures are preserved unchanged so callers need no modification.
"""
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID
from sqlalchemy.orm import Session

from app.models.models import Conversation, Message
from app.core.websocket import manager  # re-exported to preserve existing patch targets in tests
from app.services.conversation_event_service import (
    ConversationBusinessEvent,
    ConversationBusinessEventType,
    conversation_event_dispatcher,
)
from app.services.message_creation_service import MessageCreationService
from app.services.message_delivery_service import DeliveryService
from app.services.message_broadcast_service import BroadcastService


class MessageService:
    MAX_RETRIES = 3

    def __init__(self, db: Session):
        self.db = db
        self._creation = MessageCreationService(db)
        self._delivery = DeliveryService(db)
        self._broadcast = BroadcastService()

    # ── Delegated methods (preserve public interface) ─────────────────────────

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
        return self._creation.create_message(
            conversation=conversation, content=content, inbound=inbound,
            owner_id=owner_id, message_type=message_type, image=image,
            file=file, idempotency_key=idempotency_key,
            is_internal=is_internal, update_last_message=update_last_message,
        )

    async def dispatch_to_channel(
        self, conversation: Conversation, content: str, message: Optional[Message] = None
    ) -> None:
        return await self._delivery.dispatch_to_channel(conversation, content, message)

    async def broadcast_new_message(self, message: Message) -> None:
        return await self._broadcast.broadcast_new_message(message)

    # ── Retry ─────────────────────────────────────────────────────────────────

    async def retry_message(self, message: Message, conversation: Conversation) -> Message:
        from app.models.models import DeliveryStatus

        if message.delivery_status != DeliveryStatus.FAILED:
            raise ValueError("Only FAILED messages can be retried")
        if message.retry_count >= self.MAX_RETRIES:
            raise ValueError(f"Max retries ({self.MAX_RETRIES}) reached")

        message.retry_count += 1
        message.last_retry_at = datetime.now(timezone.utc)
        message.delivery_status = DeliveryStatus.PENDING
        self.db.commit()

        try:
            await self._delivery.dispatch_to_channel(conversation, message.content, message)
        except Exception:
            pass

        self.db.refresh(message)
        await self._broadcast.broadcast_new_message(message)
        return message

    # ── Orchestration flows ───────────────────────────────────────────────────

    async def send_from_dashboard(
        self,
        conversation: Conversation,
        content: str,
        owner_id: Optional[UUID] = None,
        message_type: str = "TEXT",
        image: Optional[str] = None,
        file: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Message:
        from app.models.models import DeliveryStatus

        if idempotency_key:
            existing = self._creation.find_by_idempotency_key(idempotency_key)
            if existing:
                return existing

        message = self._creation.create_message(
            conversation=conversation, content=content, inbound=False,
            owner_id=owner_id, message_type=message_type, image=image,
            file=file, idempotency_key=idempotency_key,
        )
        message.delivery_status = DeliveryStatus.PENDING
        if conversation.first_response_at is None:
            conversation.first_response_at = datetime.now(timezone.utc)
        self.db.commit()

        await self._emit_new_message_event(
            conversation=conversation,
            message=message,
            direction="outbound",
            source="dashboard",
            actor_user_id=owner_id,
            idempotency_key=idempotency_key,
        )

        try:
            await self._delivery.dispatch_to_channel(conversation, content, message)
        except Exception:
            pass  # failure already persisted and broadcast inside dispatch_to_channel

        self.db.refresh(message)
        await self._broadcast.broadcast_new_message(message)
        return message

    async def receive_from_channel(
        self,
        conversation: Conversation,
        content: str,
        message_type: str = "TEXT",
        idempotency_key: Optional[str] = None,
        agent_content: Optional[str] = None,
    ) -> Message:
        if idempotency_key:
            existing = self._creation.find_by_idempotency_key(idempotency_key)
            if existing:
                return existing

        message = self._creation.create_message(
            conversation=conversation, content=content, inbound=True,
            message_type=message_type, idempotency_key=idempotency_key,
        )
        await self._emit_new_message_event(
            conversation=conversation,
            message=message,
            direction="inbound",
            source="channel",
            idempotency_key=idempotency_key,
        )
        await self._broadcast.broadcast_new_message(message)
        await self._enqueue_for_agent(message, conversation, agent_content=agent_content)
        return message

    async def create_internal_note(
        self,
        conversation: Conversation,
        content: str,
        owner_id: UUID,
    ) -> Message:
        message = self._creation.create_message(
            conversation=conversation,
            content=content,
            inbound=False,
            owner_id=owner_id,
            message_type="TEXT",
            is_internal=True,
            update_last_message=False,
        )
        self.db.refresh(message, attribute_names=["owner"])
        await self._emit_note_created_event(conversation, message, owner_id)
        await self._broadcast.broadcast_new_message(message)
        return message

    async def _emit_new_message_event(
        self,
        *,
        conversation: Conversation,
        message: Message,
        direction: str,
        source: str,
        actor_user_id: Optional[UUID] = None,
        idempotency_key: Optional[str] = None,
    ) -> None:
        await conversation_event_dispatcher.emit(ConversationBusinessEvent(
            event_type=ConversationBusinessEventType.NEW_MESSAGE,
            conversation_id=str(conversation.id),
            channel=conversation.channel.value if conversation.channel else "web",
            actor_user_id=str(actor_user_id) if actor_user_id else None,
            source=source,
            payload={
                "message_id": str(message.id),
                "direction": direction,
                "message_type": message.message_type.value if message.message_type else "text",
                "is_internal": bool(message.is_internal),
                "idempotency_key": idempotency_key,
            },
        ))

    async def _emit_note_created_event(
        self,
        conversation: Conversation,
        message: Message,
        owner_id: UUID,
    ) -> None:
        preview = " ".join((message.content or "").strip().split())
        await conversation_event_dispatcher.emit(ConversationBusinessEvent(
            event_type=ConversationBusinessEventType.NOTE_CREATED,
            conversation_id=str(conversation.id),
            channel=conversation.channel.value if conversation.channel else "web",
            actor_user_id=str(owner_id),
            source="dashboard",
            payload={
                "message_id": str(message.id),
                "is_internal": True,
                "content_preview": preview[:160],
            },
        ))

    async def _enqueue_for_agent(
        self,
        message: Message,
        conversation: Conversation,
        agent_content: Optional[str] = None,
    ) -> None:
        try:
            from src.shared.queue import agent_queue
            from src.shared.models import AgentTask, ChannelType as AgentChannel

            task = AgentTask(
                message_id=str(message.id),
                conversation_id=str(conversation.id),
                channel=AgentChannel(conversation.channel.value.upper()),
                content=agent_content if agent_content is not None else (message.content or ""),
            )
            agent_queue().put_nowait(task)
        except Exception:
            pass


def get_message_service(db: Session) -> MessageService:
    """FastAPI dependency factory."""
    return MessageService(db)
