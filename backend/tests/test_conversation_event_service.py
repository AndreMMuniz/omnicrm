import pytest

from app.services.conversation_event_service import (
    ConversationBusinessEvent,
    ConversationBusinessEventType,
    ConversationEventDispatcher,
)


@pytest.mark.asyncio
async def test_dispatcher_delivers_stable_payload_to_consumers():
    dispatcher = ConversationEventDispatcher()
    received = []

    async def consumer(event):
        received.append(event.to_payload())

    dispatcher.register(consumer)
    event = ConversationBusinessEvent(
        event_type=ConversationBusinessEventType.NEW_MESSAGE,
        conversation_id="conversation-1",
        channel="whatsapp",
        source="channel",
        payload={"message_id": "message-1", "direction": "inbound"},
    )

    await dispatcher.emit(event)

    assert received == [{
        "schema_version": 1,
        "event_type": "new_message",
        "occurred_at": event.occurred_at.isoformat(),
        "conversation_id": "conversation-1",
        "channel": "whatsapp",
        "actor_user_id": None,
        "source": "channel",
        "message_id": "message-1",
        "direction": "inbound",
    }]


@pytest.mark.asyncio
async def test_dispatcher_logs_and_swallows_consumer_failures(caplog):
    dispatcher = ConversationEventDispatcher()
    received = []

    async def failing_consumer(event):
        raise RuntimeError("consumer exploded")

    async def healthy_consumer(event):
        received.append(event.event_type.value)

    dispatcher.register(failing_consumer)
    dispatcher.register(healthy_consumer)

    await dispatcher.emit(ConversationBusinessEvent(
        event_type=ConversationBusinessEventType.STATUS_CHANGED,
        conversation_id="conversation-1",
        channel="email",
        source="dashboard",
        payload={"previous_status": "open", "status": "resolved"},
    ))

    assert received == ["status_changed"]
    assert "conversation business-event consumer failed" in caplog.text
