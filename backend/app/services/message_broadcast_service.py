"""WebSocket fan-out for new messages."""
from app.models.models import Message
from app.core.websocket import manager
from app.schemas.chat import AssignedUserSlim


class BroadcastService:
    async def broadcast_new_message(self, message: Message) -> None:
        """Broadcast message to subscribers + lightweight notification to all other clients."""
        data = {
            "id": str(message.id),
            "sequence": message.conversation_sequence,
            "conversation_id": str(message.conversation_id),
            "content": message.content,
            "inbound": message.inbound,
            "message_type": message.message_type.value if message.message_type else "text",
            "is_internal": message.is_internal,
            "image": message.image,
            "file": message.file,
            "owner_id": str(message.owner_id) if message.owner_id else None,
            "owner": AssignedUserSlim.model_validate(message.owner).model_dump(mode="json") if message.owner else None,
            "created_at": message.created_at.isoformat() if message.created_at else None,
            "delivery_status": message.delivery_status.value if message.delivery_status else None,
            "delivery_error": message.delivery_error,
            "retry_count": message.retry_count,
        }
        await manager.notify_new_message(
            conversation_id=str(message.conversation_id),
            message_data=data,
            preview="Internal note added" if message.is_internal else (message.content or ""),
        )
