from fastapi import FastAPI
from fastapi.testclient import TestClient
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
    DefaultRole,
    Message,
    Project,
    ProjectStage,
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
