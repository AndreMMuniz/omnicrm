"""
Unit tests for MessageService — sequencing, idempotency, dispatch routing.
"""

import pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services.message_service import MessageService
from app.services.conversation_event_service import ConversationBusinessEventType
from app.models.models import (
    Base, Client, Contact, Conversation, Message, ChannelType, Project, ProjectStage, User, UserType
)


TEST_DB_URL = "sqlite://"
engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest.fixture(scope="function")
def db():
    tables = [
        UserType.__table__,
        User.__table__,
        Client.__table__,
        Contact.__table__,
        ProjectStage.__table__,
        Project.__table__,
        Conversation.__table__,
        Message.__table__,
    ]
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        Base.metadata.drop_all(bind=connection, tables=tables)
        Base.metadata.create_all(bind=connection, tables=tables)
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        with engine.begin() as connection:
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            Base.metadata.drop_all(bind=connection, tables=tables)
            connection.exec_driver_sql("PRAGMA foreign_keys=ON")


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_conversation(db, channel=ChannelType.TELEGRAM) -> Conversation:
    contact = Contact(name="Customer", channel_identifier="12345")
    db.add(contact)
    db.commit()
    db.refresh(contact)

    conv = Conversation(contact_id=contact.id, channel=channel)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


# ── Sequencing ────────────────────────────────────────────────────────────────

class TestMessageSequencing:
    def test_first_message_gets_sequence_1(self, db):
        conv = make_conversation(db)
        svc = MessageService(db)
        msg = svc.create_message(conv, "Hello")
        assert msg.conversation_sequence == 1

    def test_second_message_gets_sequence_2(self, db):
        conv = make_conversation(db)
        svc = MessageService(db)
        svc.create_message(conv, "First")
        msg2 = svc.create_message(conv, "Second")
        assert msg2.conversation_sequence == 2

    def test_messages_across_conversations_are_independent(self, db):
        conv1 = make_conversation(db)
        conv2 = make_conversation(db)
        svc = MessageService(db)
        svc.create_message(conv1, "Conv1 msg1")
        svc.create_message(conv1, "Conv1 msg2")
        msg = svc.create_message(conv2, "Conv2 msg1")
        assert msg.conversation_sequence == 1

    def test_sequence_increments_correctly_after_5_messages(self, db):
        conv = make_conversation(db)
        svc = MessageService(db)
        for i in range(5):
            svc.create_message(conv, f"Message {i}")
        last = db.query(Message).filter(
            Message.conversation_id == conv.id
        ).order_by(Message.conversation_sequence.desc()).first()
        assert last.conversation_sequence == 5


# ── Idempotency ───────────────────────────────────────────────────────────────

class TestIdempotency:
    def test_duplicate_key_returns_existing_message(self, db):
        conv = make_conversation(db)
        svc = MessageService(db)
        key = "unique-key-123"
        msg1 = svc.create_message(conv, "Hello", idempotency_key=key)
        msg2 = svc.create_message(conv, "Duplicate", idempotency_key=key)
        assert msg1.id == msg2.id

    def test_duplicate_does_not_create_second_message(self, db):
        conv = make_conversation(db)
        svc = MessageService(db)
        key = "no-dupe-key"
        svc.create_message(conv, "Hello", idempotency_key=key)
        svc.create_message(conv, "Hello again", idempotency_key=key)
        count = db.query(Message).filter(Message.conversation_id == conv.id).count()
        assert count == 1

    def test_different_keys_create_separate_messages(self, db):
        conv = make_conversation(db)
        svc = MessageService(db)
        svc.create_message(conv, "Msg1", idempotency_key="key-a")
        svc.create_message(conv, "Msg2", idempotency_key="key-b")
        count = db.query(Message).filter(Message.conversation_id == conv.id).count()
        assert count == 2


# ── Conversation update on send ───────────────────────────────────────────────

class TestConversationUpdate:
    def test_outbound_sets_is_unread_false(self, db):
        conv = make_conversation(db)
        conv.is_unread = True
        db.commit()
        MessageService(db).create_message(conv, "Reply", inbound=False)
        db.refresh(conv)
        assert conv.is_unread is False

    def test_inbound_sets_is_unread_true(self, db):
        conv = make_conversation(db)
        MessageService(db).create_message(conv, "Customer message", inbound=True)
        db.refresh(conv)
        assert conv.is_unread is True

    def test_last_message_updated(self, db):
        conv = make_conversation(db)
        MessageService(db).create_message(conv, "Latest message")
        db.refresh(conv)
        assert conv.last_message == "Latest message"


# ── send_from_dashboard ───────────────────────────────────────────────────────

class TestSendFromDashboard:
    @pytest.mark.asyncio
    async def test_send_creates_message_and_dispatches(self, db):
        conv = make_conversation(db, channel=ChannelType.TELEGRAM)

        with patch(
            "app.services.channel_service.ChannelService.send",
            new_callable=AsyncMock,
        ) as mock_dispatch, patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ) as mock_broadcast:
            msg = await MessageService(db).send_from_dashboard(conv, "Hi there")

        assert msg.id is not None
        assert msg.content == "Hi there"
        assert msg.inbound is False
        mock_dispatch.assert_called_once()
        mock_broadcast.assert_called_once()

    @pytest.mark.asyncio
    async def test_receive_from_channel_sets_inbound_true(self, db):
        conv = make_conversation(db)

        with patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ):
            msg = await MessageService(db).receive_from_channel(conv, "Customer says hi")

        assert msg.inbound is True


class TestMessageBusinessEvents:
    @pytest.mark.asyncio
    async def test_receive_from_channel_emits_inbound_new_message_event(self, db, monkeypatch):
        conv = make_conversation(db, channel=ChannelType.WHATSAPP)
        emitted = []

        async def fake_emit(event):
            emitted.append(event)

        monkeypatch.setattr(
            "app.services.message_service.conversation_event_dispatcher.emit",
            fake_emit,
        )

        with patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ):
            msg = await MessageService(db).receive_from_channel(
                conv,
                "Customer says hi",
                idempotency_key="channel-msg-1",
            )

        assert len(emitted) == 1
        event = emitted[0]
        assert event.event_type == ConversationBusinessEventType.NEW_MESSAGE
        payload = event.to_payload()
        assert payload["conversation_id"] == str(conv.id)
        assert payload["channel"] == "whatsapp"
        assert payload["source"] == "channel"
        assert payload["message_id"] == str(msg.id)
        assert payload["direction"] == "inbound"
        assert payload["message_type"] == "text"
        assert payload["is_internal"] is False
        assert payload["idempotency_key"] == "channel-msg-1"

    @pytest.mark.asyncio
    async def test_send_from_dashboard_emits_outbound_new_message_event(self, db, monkeypatch):
        conv = make_conversation(db, channel=ChannelType.TELEGRAM)
        emitted = []

        async def fake_emit(event):
            emitted.append(event)

        monkeypatch.setattr(
            "app.services.message_service.conversation_event_dispatcher.emit",
            fake_emit,
        )

        with patch(
            "app.services.channel_service.ChannelService.send",
            new_callable=AsyncMock,
        ), patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ):
            msg = await MessageService(db).send_from_dashboard(
                conv,
                "Hi there",
                idempotency_key="dashboard-msg-1",
            )

        payload = emitted[0].to_payload()
        assert payload["event_type"] == "new_message"
        assert payload["source"] == "dashboard"
        assert payload["actor_user_id"] is None
        assert payload["message_id"] == str(msg.id)
        assert payload["direction"] == "outbound"
        assert payload["idempotency_key"] == "dashboard-msg-1"

    @pytest.mark.asyncio
    async def test_send_from_dashboard_idempotent_duplicate_does_not_reemit_or_redispatch(self, db, monkeypatch):
        conv = make_conversation(db, channel=ChannelType.TELEGRAM)
        emitted = []

        async def fake_emit(event):
            emitted.append(event)

        monkeypatch.setattr(
            "app.services.message_service.conversation_event_dispatcher.emit",
            fake_emit,
        )

        with patch(
            "app.services.channel_service.ChannelService.send",
            new_callable=AsyncMock,
        ) as mock_dispatch, patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ) as mock_broadcast:
            first = await MessageService(db).send_from_dashboard(
                conv,
                "Hi there",
                idempotency_key="dashboard-idempotent-1",
            )
            duplicate = await MessageService(db).send_from_dashboard(
                conv,
                "Duplicate body should not matter",
                idempotency_key="dashboard-idempotent-1",
            )

        assert duplicate.id == first.id
        assert len(emitted) == 1
        mock_dispatch.assert_called_once()
        mock_broadcast.assert_called_once()

    @pytest.mark.asyncio
    async def test_receive_from_channel_idempotent_duplicate_does_not_reemit_or_rebroadcast(self, db, monkeypatch):
        conv = make_conversation(db, channel=ChannelType.WHATSAPP)
        emitted = []

        async def fake_emit(event):
            emitted.append(event)

        monkeypatch.setattr(
            "app.services.message_service.conversation_event_dispatcher.emit",
            fake_emit,
        )

        with patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ) as mock_broadcast, patch(
            "app.services.message_service.MessageService._enqueue_for_agent",
            new_callable=AsyncMock,
        ) as mock_enqueue:
            first = await MessageService(db).receive_from_channel(
                conv,
                "Customer says hi",
                idempotency_key="channel-idempotent-1",
            )
            duplicate = await MessageService(db).receive_from_channel(
                conv,
                "Duplicate inbound should not matter",
                idempotency_key="channel-idempotent-1",
            )

        assert duplicate.id == first.id
        assert len(emitted) == 1
        mock_broadcast.assert_called_once()
        mock_enqueue.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_internal_note_emits_note_created_event_with_preview(self, db, monkeypatch):
        conv = make_conversation(db, channel=ChannelType.EMAIL)
        role = UserType(name="Agent")
        user = User(auth_id="auth-agent", email="agent@example.com", full_name="Agent User", user_type=role)
        db.add_all([role, user])
        db.commit()
        emitted = []

        async def fake_emit(event):
            emitted.append(event)

        monkeypatch.setattr(
            "app.services.message_service.conversation_event_dispatcher.emit",
            fake_emit,
        )

        with patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ):
            note = await MessageService(db).create_internal_note(
                conv,
                "Need manager follow-up before replying.",
                owner_id=user.id,
            )

        payload = emitted[0].to_payload()
        assert payload["event_type"] == "note_created"
        assert payload["source"] == "dashboard"
        assert payload["actor_user_id"] == str(user.id)
        assert payload["message_id"] == str(note.id)
        assert payload["is_internal"] is True
        assert payload["content_preview"] == "Need manager follow-up before replying."


# ── retry_message ─────────────────────────────────────────────────────────────

class TestRetryMessage:
    @pytest.mark.asyncio
    async def test_retry_only_allowed_on_failed_messages(self, db):
        from app.models.models import DeliveryStatus
        conv = make_conversation(db)
        svc = MessageService(db)
        msg = svc.create_message(conv, "hello", inbound=False)
        msg.delivery_status = DeliveryStatus.SENT
        db.commit()

        with pytest.raises(ValueError, match="FAILED"):
            await svc.retry_message(msg, conv)

    @pytest.mark.asyncio
    async def test_retry_increments_retry_count(self, db):
        from app.models.models import DeliveryStatus
        conv = make_conversation(db)
        svc = MessageService(db)
        msg = svc.create_message(conv, "hello", inbound=False)
        msg.delivery_status = DeliveryStatus.FAILED
        db.commit()

        with patch(
            "app.services.channel_service.ChannelService.send",
            new_callable=AsyncMock,
        ), patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ), patch(
            "app.services.message_service.manager.notify_new_message",
            new_callable=AsyncMock,
        ):
            await svc.retry_message(msg, conv)

        db.refresh(msg)
        assert msg.retry_count == 1

    @pytest.mark.asyncio
    async def test_retry_blocked_after_max_retries(self, db):
        from app.models.models import DeliveryStatus
        conv = make_conversation(db)
        svc = MessageService(db)
        msg = svc.create_message(conv, "hello", inbound=False)
        msg.delivery_status = DeliveryStatus.FAILED
        msg.retry_count = 3  # already at max
        db.commit()

        with pytest.raises(ValueError, match="Max retries"):
            await svc.retry_message(msg, conv)


# ── dispatch_to_channel delivery status ───────────────────────────────────────

class TestDispatchDeliveryStatus:
    @pytest.mark.asyncio
    async def test_successful_dispatch_marks_sent(self, db):
        from app.models.models import DeliveryStatus
        conv = make_conversation(db, channel=ChannelType.TELEGRAM)
        svc = MessageService(db)
        msg = svc.create_message(conv, "hello")

        with patch(
            "app.services.channel_service.ChannelService.send",
            new_callable=AsyncMock,
        ):
            await svc.dispatch_to_channel(conv, "hello", msg)

        db.refresh(msg)
        assert msg.delivery_status == DeliveryStatus.SENT

    @pytest.mark.asyncio
    async def test_failed_dispatch_marks_failed(self, db):
        from app.models.models import DeliveryStatus
        from app.services.channel_service import ChannelDeliveryError
        conv = make_conversation(db, channel=ChannelType.TELEGRAM)
        svc = MessageService(db)
        msg = svc.create_message(conv, "hello")

        with patch(
            "app.services.channel_service.ChannelService.send",
            new_callable=AsyncMock,
            side_effect=ChannelDeliveryError("timeout"),
        ), patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ), pytest.raises(ChannelDeliveryError):
            await svc.dispatch_to_channel(conv, "hello", msg)

        db.refresh(msg)
        assert msg.delivery_status == DeliveryStatus.FAILED
        assert "timeout" in msg.delivery_error


# ── first_response_at (SLA) ───────────────────────────────────────────────────

class TestFirstResponseAt:
    @pytest.mark.asyncio
    async def test_send_from_dashboard_sets_first_response_at(self, db):
        conv = make_conversation(db, channel=ChannelType.TELEGRAM)
        assert conv.first_response_at is None

        with patch(
            "app.services.channel_service.ChannelService.send",
            new_callable=AsyncMock,
        ), patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ), patch(
            "app.services.message_service.manager.notify_new_message",
            new_callable=AsyncMock,
        ):
            await MessageService(db).send_from_dashboard(conv, "Hi!")

        db.refresh(conv)
        assert conv.first_response_at is not None

    @pytest.mark.asyncio
    async def test_second_send_does_not_overwrite_first_response_at(self, db):
        from datetime import datetime, timezone
        conv = make_conversation(db, channel=ChannelType.TELEGRAM)
        original_time = datetime(2026, 1, 1, tzinfo=timezone.utc)
        conv.first_response_at = original_time
        db.commit()

        with patch(
            "app.services.channel_service.ChannelService.send",
            new_callable=AsyncMock,
        ), patch(
            "app.services.message_service.manager.broadcast_to_conversation",
            new_callable=AsyncMock,
        ), patch(
            "app.services.message_service.manager.notify_new_message",
            new_callable=AsyncMock,
        ):
            await MessageService(db).send_from_dashboard(conv, "Second reply")

        db.refresh(conv)
        # SQLite strips timezone info — compare naive values
        assert conv.first_response_at == original_time.replace(tzinfo=None)
