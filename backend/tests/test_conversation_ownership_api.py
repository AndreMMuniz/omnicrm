from fastapi import FastAPI
from fastapi.testclient import TestClient
from datetime import datetime, timezone
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.websocket import manager
from app.models.models import (
    AuditLog,
    Base,
    ChannelType,
    Client,
    Contact,
    Conversation,
    ConversationStatus,
    ConversationTag,
    DefaultRole,
    Message,
    Project,
    ProjectPriority,
    ProjectStage,
    ProjectSourceType,
    ProjectStatus,
    Proposal,
    ProposalStatusHistory,
    ProposalStatus,
    User,
    UserType,
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
        AuditLog.__table__,
        Client.__table__,
        Contact.__table__,
        Message.__table__,
        ProjectStage.__table__,
        Project.__table__,
        Proposal.__table__,
        ProposalStatusHistory.__table__,
        Conversation.__table__,
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


def _seed_user(db, email: str, name: str, *, can_manage_users: bool = False, is_active: bool = True):
    user_type = UserType(
        name=f"Role {email}",
        base_role=DefaultRole.ADMIN if can_manage_users else DefaultRole.USER,
        is_system=False,
        can_manage_users=can_manage_users,
    )
    db.add(user_type)
    db.flush()

    user = User(
        auth_id=f"auth-{email}",
        email=email,
        full_name=name,
        user_type_id=user_type.id,
        is_active=is_active,
        is_approved=True,
    )
    db.add(user)
    db.flush()
    return user


def _seed_manager(db, email: str, name: str):
    user_type = UserType(
        name=f"Manager {email}",
        base_role=DefaultRole.MANAGER,
        is_system=False,
        can_view_all_conversations=True,
    )
    db.add(user_type)
    db.flush()

    user = User(
        auth_id=f"auth-{email}",
        email=email,
        full_name=name,
        user_type_id=user_type.id,
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_client(db, current_user):
    app = FastAPI()
    app.include_router(api_router, prefix="/api/v1")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    async def override_current_user():
        return current_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_current_user
    return TestClient(app, raise_server_exceptions=True)


def _seed_project_stage(db, key: str = "lead", label: str = "Lead", position: int = 1):
    stage = ProjectStage(key=key, label=label, position=position, is_active=True)
    db.add(stage)
    db.flush()
    return stage


def test_list_assignable_users_returns_active_approved_users(db):
    current_user = _seed_user(db, "current@example.com", "Current User")
    _seed_user(db, "zoe@example.com", "Zoe Agent")
    _seed_user(db, "ana@example.com", "Ana Agent")
    _seed_user(db, "inactive@example.com", "Inactive Agent", is_active=False)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get("/api/v1/chat/assignable-users")

    assert response.status_code == 200
    data = response.json()["data"]
    names = [item["full_name"] for item in data]
    assert names == ["Ana Agent", "Current User", "Zoe Agent"]
    assert "Inactive Agent" not in names


def test_assign_conversation_updates_owner_audits_and_broadcasts(db, monkeypatch):
    current_user = _seed_user(db, "manager@example.com", "Manager User")
    assigned_user = _seed_user(db, "owner@example.com", "Owner User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
        is_unread=True,
    )
    db.add(conversation)
    db.commit()

    events = []

    async def fake_broadcast_global(event_type, data):
        events.append((event_type, data))

    monkeypatch.setattr(manager, "broadcast_global", fake_broadcast_global)

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}/assign",
        json={"assigned_user_id": str(assigned_user.id)},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["assigned_user_id"] == str(assigned_user.id)
    assert payload["assigned_user"]["full_name"] == "Owner User"

    db.refresh(conversation)
    assert conversation.assigned_user_id == assigned_user.id

    audit_entry = db.query(AuditLog).filter(AuditLog.action == "assign_conversation").one()
    assert audit_entry.resource_type == "conversation"
    assert audit_entry.resource_id == str(conversation.id)
    assert audit_entry.details["assigned_user_id"] == str(assigned_user.id)
    assert audit_entry.details["assigned_user_name"] == "Owner User"

    assert len(events) == 1
    event_type, data = events[0]
    assert event_type == "conversation_updated"
    assert data["id"] == str(conversation.id)
    assert data["assigned_user_id"] == str(assigned_user.id)
    assert data["assigned_user"]["full_name"] == "Owner User"


def test_assign_conversation_supports_unassign(db, monkeypatch):
    current_user = _seed_user(db, "manager@example.com", "Manager User")
    assigned_user = _seed_user(db, "owner@example.com", "Owner User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=assigned_user.id,
        channel=ChannelType.EMAIL,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    events = []

    async def fake_broadcast_global(event_type, data):
        events.append((event_type, data))

    monkeypatch.setattr(manager, "broadcast_global", fake_broadcast_global)

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}/assign",
        json={"assigned_user_id": None},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["assigned_user_id"] is None
    assert payload["assigned_user"] is None

    db.refresh(conversation)
    assert conversation.assigned_user_id is None

    audit_entry = db.query(AuditLog).filter(AuditLog.action == "assign_conversation").one()
    assert audit_entry.details["previous_assigned_user_id"] == str(assigned_user.id)
    assert audit_entry.details["assigned_user_id"] is None

    assert events[0][1]["assigned_user_id"] is None
    assert events[0][1]["assigned_user"] is None


def test_update_conversation_accepts_resolved_and_broadcasts_public_status(db, monkeypatch):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    events = []

    async def fake_broadcast_global(event_type, data):
        events.append((event_type, data))

    monkeypatch.setattr(manager, "broadcast_global", fake_broadcast_global)

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}",
        json={"status": "resolved"},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["status"] == "resolved"

    db.refresh(conversation)
    assert conversation.status == ConversationStatus.CLOSED

    assert len(events) == 1
    event_type, data = events[0]
    assert event_type == "conversation_updated"
    assert data["status"] == "resolved"


def test_update_conversation_blocks_non_manager_from_changing_other_users_conversation(db):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    owner_user = _seed_user(db, "owner@example.com", "Owner User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=owner_user.id,
        channel=ChannelType.EMAIL,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}",
        json={"status": "pending"},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["error"]["code"] == "FORBIDDEN"


def test_manager_can_change_status_for_other_users_conversation(db, monkeypatch):
    current_user = _seed_manager(db, "manager@example.com", "Manager User")
    owner_user = _seed_user(db, "owner@example.com", "Owner User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=owner_user.id,
        channel=ChannelType.WEB,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    async def fake_broadcast_global(event_type, data):
        return None

    monkeypatch.setattr(manager, "broadcast_global", fake_broadcast_global)

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}",
        json={"status": "pending"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "pending"


def test_update_conversation_marks_follow_up_and_broadcasts_state(db, monkeypatch):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    events = []

    async def fake_broadcast_global(event_type, data):
        events.append((event_type, data))

    monkeypatch.setattr(manager, "broadcast_global", fake_broadcast_global)

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}",
        json={
            "needs_follow_up": True,
            "follow_up_note": "Confirm proposal acceptance tomorrow.",
            "follow_up_at": "2026-07-09T12:30:00Z",
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["needs_follow_up"] is True
    assert payload["follow_up_note"] == "Confirm proposal acceptance tomorrow."
    assert payload["follow_up_at"].startswith("2026-07-09T12:30:00")

    db.refresh(conversation)
    assert conversation.needs_follow_up is True
    assert conversation.follow_up_note == "Confirm proposal acceptance tomorrow."

    assert len(events) == 1
    event_type, data = events[0]
    assert event_type == "conversation_updated"
    assert data["needs_follow_up"] is True
    assert data["follow_up_note"] == "Confirm proposal acceptance tomorrow."
    assert data["follow_up_at"].startswith("2026-07-09T12:30:00")


def test_update_conversation_clears_follow_up_state(db, monkeypatch):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.EMAIL,
        status=ConversationStatus.OPEN,
        needs_follow_up=True,
        follow_up_note="Call back after contract review.",
    )
    db.add(conversation)
    db.commit()

    async def fake_broadcast_global(event_type, data):
        return None

    monkeypatch.setattr(manager, "broadcast_global", fake_broadcast_global)

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}",
        json={
            "needs_follow_up": False,
            "follow_up_note": None,
            "follow_up_at": None,
        },
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["needs_follow_up"] is False
    assert payload["follow_up_note"] is None
    assert payload["follow_up_at"] is None

    db.refresh(conversation)
    assert conversation.needs_follow_up is False
    assert conversation.follow_up_note is None
    assert conversation.follow_up_at is None


def test_update_conversation_clears_follow_up_details_with_partial_patch(db, monkeypatch):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.EMAIL,
        status=ConversationStatus.OPEN,
        needs_follow_up=True,
        follow_up_note="Call back after contract review.",
        follow_up_at=datetime.now(timezone.utc),
    )
    db.add(conversation)
    db.commit()

    async def fake_broadcast_global(event_type, data):
        return None

    monkeypatch.setattr(manager, "broadcast_global", fake_broadcast_global)

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}",
        json={"needs_follow_up": False},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["needs_follow_up"] is False
    assert payload["follow_up_note"] is None
    assert payload["follow_up_at"] is None

    db.refresh(conversation)
    assert conversation.needs_follow_up is False
    assert conversation.follow_up_note is None
    assert conversation.follow_up_at is None


def test_list_conversations_filters_by_follow_up_state(db):
    current_user = _seed_manager(db, "manager@example.com", "Manager User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    follow_up_conversation = Conversation(
        contact_id=contact.id,
        channel=ChannelType.WEB,
        status=ConversationStatus.OPEN,
        needs_follow_up=True,
        follow_up_note="Needs renewal answer.",
    )
    normal_conversation = Conversation(
        contact_id=contact.id,
        channel=ChannelType.EMAIL,
        status=ConversationStatus.OPEN,
        needs_follow_up=False,
    )
    db.add_all([follow_up_conversation, normal_conversation])
    db.commit()

    client = _make_client(db, current_user)
    response = client.get("/api/v1/chat/conversations?needs_follow_up=true")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["total"] == 1
    assert payload["data"][0]["id"] == str(follow_up_conversation.id)
    assert payload["data"][0]["needs_follow_up"] is True


def test_follow_up_update_respects_conversation_ownership_permissions(db):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    owner_user = _seed_user(db, "owner@example.com", "Owner User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=owner_user.id,
        channel=ChannelType.EMAIL,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}",
        json={"needs_follow_up": True},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["error"]["code"] == "FORBIDDEN"


def test_create_internal_note_persists_author_without_changing_preview(db, monkeypatch):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
        last_message="Customer visible message",
    )
    db.add(conversation)
    db.commit()

    notifications = []

    async def fake_notify_new_message(conversation_id, message_data, preview=""):
        notifications.append((conversation_id, message_data, preview))

    monkeypatch.setattr(manager, "notify_new_message", fake_notify_new_message)

    client = _make_client(db, current_user)
    response = client.post(
        f"/api/v1/chat/conversations/{conversation.id}/internal-notes",
        json={"content": "Need manager follow-up before replying."},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["is_internal"] is True
    assert payload["owner_id"] == str(current_user.id)
    assert payload["owner"]["full_name"] == "Agent User"
    assert payload["inbound"] is False

    db.refresh(conversation)
    assert conversation.last_message == "Customer visible message"

    note = db.query(Message).filter(Message.conversation_id == conversation.id).one()
    assert note.is_internal is True
    assert note.owner_id == current_user.id

    assert len(notifications) == 1
    assert notifications[0][0] == str(conversation.id)
    assert notifications[0][1]["is_internal"] is True
    assert notifications[0][1]["owner"]["full_name"] == "Agent User"
    assert notifications[0][2] == "Internal note added"


def test_create_internal_note_respects_ownership_permissions(db):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    owner_user = _seed_user(db, "owner@example.com", "Owner User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=owner_user.id,
        channel=ChannelType.EMAIL,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    client = _make_client(db, current_user)
    response = client.post(
        f"/api/v1/chat/conversations/{conversation.id}/internal-notes",
        json={"content": "Private handoff note."},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["error"]["code"] == "FORBIDDEN"


def test_update_conversation_supports_multiple_tags_and_legacy_primary_tag(db, monkeypatch):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    contact = Contact(name="Client")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WEB,
        status=ConversationStatus.OPEN,
        tag=ConversationTag.SUPPORT,
        tags=["support"],
    )
    db.add(conversation)
    db.commit()

    events = []

    async def fake_broadcast_global(event_type, data):
        events.append((event_type, data))

    monkeypatch.setattr(manager, "broadcast_global", fake_broadcast_global)

    client = _make_client(db, current_user)
    response = client.patch(
        f"/api/v1/chat/conversations/{conversation.id}",
        json={"tags": ["sales", "billing", "sales"]},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["tags"] == ["sales", "billing"]
    assert payload["tag"] == "sales"

    db.refresh(conversation)
    assert conversation.tags == ["sales", "billing"]
    assert conversation.tag == ConversationTag.SALES

    assert events[0][1]["tags"] == ["sales", "billing"]
    assert events[0][1]["tag"] == "sales"


def test_get_conversation_context_returns_empty_linked_state_without_client(db):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    contact = Contact(name="Client", email="client@example.com", phone="+5511999999999", channel_identifier="client-001")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WEB,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/chat/conversations/{conversation.id}/context")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["contact"]["name"] == "Client"
    assert payload["contact"]["email"] == "client@example.com"
    assert payload["client"] is None
    assert payload["proposals"] == []
    assert payload["projects"] == []
    assert payload["signals"] == {
        "has_linked_client": False,
        "has_project_context": False,
        "recent_proposals_count": 0,
        "open_projects_count": 0,
    }


def test_get_conversation_context_includes_linked_client_proposals_and_projects(db):
    from datetime import datetime, timedelta, timezone

    current_user = _seed_user(db, "agent@example.com", "Agent User")
    _seed_project_stage(db, "lead", "Lead", 1)
    _seed_project_stage(db, "proposal", "Proposal", 3)

    linked_client = Client(
        name="Acme",
        company_name="Acme Corp",
        country="BR",
        client_type="company",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(linked_client)
    db.flush()

    contact = Contact(
        name="Ana",
        email="ana@acme.com",
        phone="+5511888888888",
        channel_identifier="ana-acme",
        client_id=linked_client.id,
    )
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.flush()

    current_project = Project(
        title="Migration kickoff",
        description="Current scoped project",
        stage="lead",
        status=ProjectStatus.OPEN,
        priority=ProjectPriority.HIGH,
        source_type=ProjectSourceType.MANUAL,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
    )
    older_project = Project(
        title="Renewal plan",
        description="Previous project",
        stage="proposal",
        status=ProjectStatus.DONE,
        priority=ProjectPriority.MEDIUM,
        source_type=ProjectSourceType.MANUAL,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
    )
    db.add_all([current_project, older_project])
    db.flush()

    conversation.project_context_id = current_project.id

    newer_proposal = Proposal(
        title="Support expansion",
        customer_name="Acme",
        status=ProposalStatus.SENT,
        total_amount=150000,
        client_id=linked_client.id,
        created_by_user_id=current_user.id,
    )
    older_proposal = Proposal(
        title="Onboarding package",
        customer_name="Acme",
        status=ProposalStatus.DRAFT,
        total_amount=90000,
        client_id=linked_client.id,
        created_by_user_id=current_user.id,
    )
    db.add_all([newer_proposal, older_proposal])
    db.flush()

    older_time = datetime.now(timezone.utc) - timedelta(days=2)
    current_project.updated_at = datetime.now(timezone.utc)
    older_project.updated_at = older_time
    newer_proposal.updated_at = datetime.now(timezone.utc)
    older_proposal.updated_at = older_time
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/chat/conversations/{conversation.id}/context")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["client"]["name"] == "Acme"
    assert payload["signals"]["has_linked_client"] is True
    assert payload["signals"]["has_project_context"] is True
    assert payload["signals"]["recent_proposals_count"] == 2
    assert payload["signals"]["open_projects_count"] == 1
    assert [proposal["title"] for proposal in payload["proposals"]] == [
        "Support expansion",
        "Onboarding package",
    ]
    assert payload["projects"][0]["reference"] == current_project.reference_code
    assert payload["projects"][0]["is_current_context"] is True
    assert {project["title"] for project in payload["projects"]} == {
        "Migration kickoff",
        "Renewal plan",
    }


def test_get_conversation_timeline_returns_mixed_events_in_reverse_chronological_order(db):
    from datetime import datetime, timedelta, timezone

    current_user = _seed_user(db, "agent@example.com", "Agent User")
    _seed_project_stage(db, "lead", "Lead", 1)

    linked_client = Client(
        name="Acme",
        company_name="Acme Corp",
        country="BR",
        client_type="company",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(linked_client)
    db.flush()

    contact = Contact(
        name="Ana",
        email="ana@acme.com",
        phone="+5511888888888",
        channel_identifier="ana-acme",
        client_id=linked_client.id,
    )
    db.add(contact)
    db.flush()

    base_time = datetime.now(timezone.utc) - timedelta(days=3)
    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
        created_at=base_time,
    )
    db.add(conversation)
    db.flush()

    inbound_message = Message(
        conversation_id=conversation.id,
        content="Need help with the proposal",
        inbound=True,
        is_internal=False,
        created_at=base_time + timedelta(hours=1),
    )
    internal_note = Message(
        conversation_id=conversation.id,
        owner_id=current_user.id,
        content="Customer asked for payment flexibility",
        inbound=False,
        is_internal=True,
        created_at=base_time + timedelta(hours=2),
    )
    db.add_all([inbound_message, internal_note])

    proposal = Proposal(
        title="Support expansion",
        customer_name="Acme",
        status=ProposalStatus.SENT,
        total_amount=150000,
        client_id=linked_client.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=3),
        updated_at=base_time + timedelta(hours=4),
    )
    db.add(proposal)
    db.flush()

    proposal_status = ProposalStatusHistory(
        proposal_id=proposal.id,
        from_status="draft",
        to_status="sent",
        changed_by_user_id=current_user.id,
        reason="Customer requested a formal quote",
        created_at=base_time + timedelta(hours=4),
    )
    db.add(proposal_status)

    project = Project(
        title="Migration kickoff",
        description="Current scoped project",
        stage="lead",
        status=ProjectStatus.OPEN,
        priority=ProjectPriority.HIGH,
        source_type=ProjectSourceType.MANUAL,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=5),
        updated_at=base_time + timedelta(hours=6),
    )
    db.add(project)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/chat/conversations/{conversation.id}/timeline")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["scope"] == "conversation"
    event_types = [event["event_type"] for event in payload["events"]]
    assert "internal_note" in event_types
    assert "proposal_status_changed" in event_types
    assert "project_updated" in event_types
    occurred_at = [event["occurred_at"] for event in payload["events"]]
    assert occurred_at == sorted(occurred_at, reverse=True)
    assert payload["events"][0]["href"] is not None


def test_get_conversation_timeline_includes_other_client_conversations_when_linked(db):
    from datetime import datetime, timedelta, timezone

    current_user = _seed_user(db, "agent@example.com", "Agent User")

    linked_client = Client(
        name="Acme",
        company_name="Acme Corp",
        country="BR",
        client_type="company",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(linked_client)
    db.flush()

    first_contact = Contact(
        name="Ana",
        email="ana@acme.com",
        phone="+5511888888888",
        channel_identifier="ana-acme",
        client_id=linked_client.id,
    )
    second_contact = Contact(
        name="Bia",
        email="bia@acme.com",
        phone="+5511777777777",
        channel_identifier="bia-acme",
        client_id=linked_client.id,
    )
    db.add_all([first_contact, second_contact])
    db.flush()

    base_time = datetime.now(timezone.utc) - timedelta(days=2)
    primary_conversation = Conversation(
        contact_id=first_contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
        created_at=base_time,
        updated_at=base_time + timedelta(hours=1),
    )
    secondary_conversation = Conversation(
        contact_id=second_contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.EMAIL,
        status=ConversationStatus.OPEN,
        created_at=base_time + timedelta(hours=3),
        updated_at=base_time + timedelta(hours=4),
    )
    db.add_all([primary_conversation, secondary_conversation])
    db.flush()

    db.add_all([
        Message(
            conversation_id=primary_conversation.id,
            content="Primary conversation message",
            inbound=True,
            is_internal=False,
            created_at=base_time + timedelta(hours=1),
        ),
        Message(
            conversation_id=secondary_conversation.id,
            content="Secondary conversation note",
            inbound=False,
            is_internal=True,
            owner_id=current_user.id,
            created_at=base_time + timedelta(hours=5),
        ),
    ])
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/chat/conversations/{primary_conversation.id}/timeline")

    assert response.status_code == 200
    payload = response.json()["data"]
    conversation_event_ids = {
        event["conversation_id"]
        for event in payload["events"]
        if event["conversation_id"] is not None
    }
    assert str(primary_conversation.id) in conversation_event_ids
    assert str(secondary_conversation.id) in conversation_event_ids
    assert any(event["description"] == "Secondary conversation note" for event in payload["events"])


def test_get_conversation_linked_artifacts_surfaces_direct_and_client_relationships(db):
    from datetime import datetime, timedelta, timezone

    current_user = _seed_user(db, "agent@example.com", "Agent User")
    _seed_project_stage(db, "lead", "Lead", 1)

    linked_client = Client(
        name="Acme",
        company_name="Acme Corp",
        country="BR",
        client_type="company",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(linked_client)
    db.flush()

    contact = Contact(
        name="Ana",
        email="ana@acme.com",
        phone="+5511888888888",
        channel_identifier="ana-acme",
        client_id=linked_client.id,
    )
    db.add(contact)
    db.flush()

    base_time = datetime.now(timezone.utc) - timedelta(days=1)
    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
        created_at=base_time,
        updated_at=base_time,
    )
    db.add(conversation)
    db.flush()

    source_message = Message(
        conversation_id=conversation.id,
        content="Please convert this thread into a project",
        inbound=True,
        is_internal=False,
        created_at=base_time + timedelta(minutes=20),
    )
    db.add(source_message)
    db.flush()

    current_project = Project(
        title="Implementation rollout",
        description="Scoped delivery project",
        stage="lead",
        status=ProjectStatus.OPEN,
        priority=ProjectPriority.HIGH,
        source_type=ProjectSourceType.MANUAL,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=1),
        updated_at=base_time + timedelta(hours=3),
    )
    db.add(current_project)
    db.flush()
    conversation.project_context_id = current_project.id

    message_project = Project(
        title="Follow-up workstream",
        description="Created from the inbound request",
        stage="lead",
        status=ProjectStatus.OPEN,
        priority=ProjectPriority.MEDIUM,
        source_type=ProjectSourceType.MESSAGE,
        source_message_id=source_message.id,
        source_conversation_id=conversation.id,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=2),
        updated_at=base_time + timedelta(hours=4),
    )
    client_project = Project(
        title="Account expansion",
        description="Visible from the client relationship only",
        stage="lead",
        status=ProjectStatus.DONE,
        priority=ProjectPriority.LOW,
        source_type=ProjectSourceType.MANUAL,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=3),
        updated_at=base_time + timedelta(hours=5),
    )
    proposal = Proposal(
        title="Renewal proposal",
        customer_name="Acme",
        status=ProposalStatus.SENT,
        total_amount=150000,
        client_id=linked_client.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=1),
        updated_at=base_time + timedelta(hours=6),
    )
    db.add_all([message_project, client_project, proposal])
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/chat/conversations/{conversation.id}/linked-artifacts")

    assert response.status_code == 200
    payload = response.json()["data"]
    artifacts = payload["artifacts"]
    origins_by_reference = {artifact["reference"]: artifact["origin_type"] for artifact in artifacts}

    assert origins_by_reference[current_project.reference_code] == "conversation_context"
    assert origins_by_reference[message_project.reference_code] == "message_action"
    assert origins_by_reference[client_project.reference_code] == "client_relationship"
    assert origins_by_reference[proposal.reference_code] == "client_relationship"
    assert payload["gaps"] == []


def test_get_conversation_linked_artifacts_surfaces_missing_linkage_gaps(db):
    current_user = _seed_user(db, "agent@example.com", "Agent User")
    contact = Contact(name="Client", email="client@example.com", phone="+5511999999999", channel_identifier="client-001")
    db.add(contact)
    db.flush()

    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WEB,
        status=ConversationStatus.OPEN,
    )
    db.add(conversation)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/chat/conversations/{conversation.id}/linked-artifacts")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["artifacts"] == []
    assert {gap["code"] for gap in payload["gaps"]} == {
        "missing_client_link",
        "missing_project_context",
    }


def test_get_conversation_linked_artifacts_uses_project_client_when_contact_is_not_linked(db):
    from datetime import datetime, timedelta, timezone

    current_user = _seed_user(db, "agent@example.com", "Agent User")
    _seed_project_stage(db, "lead", "Lead", 1)

    linked_client = Client(
        name="Acme",
        company_name="Acme Corp",
        country="BR",
        client_type="company",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(linked_client)
    db.flush()

    contact = Contact(
        name="Ana",
        email="ana@acme.com",
        phone="+5511888888888",
        channel_identifier="ana-acme",
    )
    db.add(contact)
    db.flush()

    base_time = datetime.now(timezone.utc) - timedelta(days=1)
    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
        created_at=base_time,
        updated_at=base_time,
    )
    db.add(conversation)
    db.flush()

    project = Project(
        title="Implementation rollout",
        description="Scoped delivery project",
        stage="lead",
        status=ProjectStatus.OPEN,
        priority=ProjectPriority.HIGH,
        source_type=ProjectSourceType.MANUAL,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
        source_conversation_id=conversation.id,
        created_at=base_time + timedelta(hours=1),
        updated_at=base_time + timedelta(hours=2),
    )
    db.add(project)
    db.flush()
    conversation.project_context_id = project.id

    proposal = Proposal(
        title="Renewal proposal",
        customer_name="Acme",
        status=ProposalStatus.SENT,
        total_amount=150000,
        client_id=linked_client.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=1),
        updated_at=base_time + timedelta(hours=3),
    )
    db.add(proposal)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/chat/conversations/{conversation.id}/linked-artifacts")

    assert response.status_code == 200
    payload = response.json()["data"]
    references = {artifact["reference"] for artifact in payload["artifacts"]}

    assert payload["client_id"] == str(linked_client.id)
    assert proposal.reference_code in references
    assert "missing_client_link" not in {gap["code"] for gap in payload["gaps"]}


def test_get_conversation_linked_artifacts_does_not_flag_missing_project_context_when_direct_project_exists(db):
    from datetime import datetime, timedelta, timezone

    current_user = _seed_user(db, "agent@example.com", "Agent User")
    _seed_project_stage(db, "lead", "Lead", 1)

    linked_client = Client(
        name="Acme",
        company_name="Acme Corp",
        country="BR",
        client_type="company",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(linked_client)
    db.flush()

    contact = Contact(
        name="Ana",
        email="ana@acme.com",
        phone="+5511888888888",
        channel_identifier="ana-acme",
        client_id=linked_client.id,
    )
    db.add(contact)
    db.flush()

    base_time = datetime.now(timezone.utc) - timedelta(days=1)
    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WHATSAPP,
        status=ConversationStatus.OPEN,
        created_at=base_time,
        updated_at=base_time,
    )
    db.add(conversation)
    db.flush()

    direct_project = Project(
        title="Follow-up workstream",
        description="Created from the inbound request",
        stage="lead",
        status=ProjectStatus.OPEN,
        priority=ProjectPriority.MEDIUM,
        source_type=ProjectSourceType.MESSAGE,
        source_conversation_id=conversation.id,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=1),
        updated_at=base_time + timedelta(hours=2),
    )
    db.add(direct_project)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/chat/conversations/{conversation.id}/linked-artifacts")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert "missing_project_context" not in {gap["code"] for gap in payload["gaps"]}


def test_get_client_timeline_includes_conversation_and_related_records(db):
    from datetime import datetime, timedelta, timezone

    current_user = _seed_user(db, "agent@example.com", "Agent User")
    _seed_project_stage(db, "lead", "Lead", 1)

    linked_client = Client(
        name="Acme",
        company_name="Acme Corp",
        country="BR",
        client_type="company",
        currency="BRL",
        created_by_user_id=current_user.id,
    )
    db.add(linked_client)
    db.flush()

    contact = Contact(
        name="Ana",
        email="ana@acme.com",
        phone="+5511888888888",
        channel_identifier="ana-acme",
        client_id=linked_client.id,
    )
    db.add(contact)
    db.flush()

    base_time = datetime.now(timezone.utc) - timedelta(days=2)
    conversation = Conversation(
        contact_id=contact.id,
        assigned_user_id=current_user.id,
        channel=ChannelType.WEB,
        status=ConversationStatus.OPEN,
        created_at=base_time,
    )
    db.add(conversation)
    db.flush()

    db.add(Message(
        conversation_id=conversation.id,
        content="Initial inbound message",
        inbound=True,
        is_internal=False,
        created_at=base_time + timedelta(hours=1),
    ))

    proposal = Proposal(
        title="Onboarding package",
        customer_name="Acme",
        status=ProposalStatus.DRAFT,
        total_amount=90000,
        client_id=linked_client.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=2),
    )
    db.add(proposal)

    project = Project(
        title="Renewal project",
        description="Current scoped project",
        stage="lead",
        status=ProjectStatus.OPEN,
        priority=ProjectPriority.MEDIUM,
        source_type=ProjectSourceType.MANUAL,
        client_id=linked_client.id,
        contact_id=contact.id,
        created_by_user_id=current_user.id,
        created_at=base_time + timedelta(hours=3),
    )
    db.add(project)
    db.commit()

    client = _make_client(db, current_user)
    response = client.get(f"/api/v1/admin/clients/{linked_client.id}/timeline")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["scope"] == "client"
    event_types = {event["event_type"] for event in payload["events"]}
    assert "conversation_created" in event_types
    assert "message_inbound" in event_types
    assert "proposal_created" in event_types
    assert "project_created" in event_types
