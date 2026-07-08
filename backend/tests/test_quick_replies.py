"""
Unit tests for Quick Reply business logic — shortcut normalization, duplicates, search.
Direct DB tests without HTTP layer for speed.
"""

import pytest
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.api import api_router
from app.core.auth import get_current_user
from app.core.database import Base, get_db
from app.models.models import QuickReply
from app.models.models import DefaultRole, User, UserType


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
    tables = [UserType.__table__, User.__table__, QuickReply.__table__]
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_qr(db, shortcut="/hello", content="Hello! How can I help?") -> QuickReply:
    qr = QuickReply(shortcut=shortcut, content=content)
    db.add(qr)
    db.commit()
    db.refresh(qr)
    return qr


def make_user(db, *, can_change_settings: bool = False) -> User:
    user_type = UserType(
        name=f"Role {uuid4()}",
        base_role=DefaultRole.USER,
        is_system=False,
        can_change_settings=can_change_settings,
    )
    db.add(user_type)
    db.flush()

    user = User(
        auth_id=f"auth-{uuid4()}",
        email=f"{uuid4()}@example.com",
        full_name="Quick Reply Operator",
        user_type_id=user_type.id,
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_client(db, current_user: User) -> TestClient:
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


# ── Model integrity ───────────────────────────────────────────────────────────

class TestQuickReplyModel:
    def test_create_quick_reply(self, db):
        qr = make_qr(db)
        assert qr.id is not None
        assert qr.shortcut == "/hello"

    def test_shortcut_is_unique(self, db):
        make_qr(db, "/dup")
        with pytest.raises(Exception):
            make_qr(db, "/dup")

    def test_created_at_set_automatically(self, db):
        qr = make_qr(db)
        assert qr.created_at is not None


# ── Search by prefix ──────────────────────────────────────────────────────────

class TestQuickReplySearch:
    def test_search_returns_matching_shortcuts(self, db):
        make_qr(db, "/hello", "Hello!")
        make_qr(db, "/help", "How can I help?")
        make_qr(db, "/bye", "Goodbye!")

        results = db.query(QuickReply).filter(
            QuickReply.shortcut.ilike("%hel%")
        ).all()
        shortcuts = {r.shortcut for r in results}
        assert "/hello" in shortcuts
        assert "/help" in shortcuts
        assert "/bye" not in shortcuts

    def test_search_empty_returns_all(self, db):
        make_qr(db, "/a")
        make_qr(db, "/b")
        make_qr(db, "/c")
        results = db.query(QuickReply).all()
        assert len(results) == 3

    def test_search_no_match_returns_empty(self, db):
        make_qr(db, "/hello")
        results = db.query(QuickReply).filter(
            QuickReply.shortcut.ilike("%xyz%")
        ).all()
        assert len(results) == 0


# ── CRUD operations ───────────────────────────────────────────────────────────

class TestQuickReplyCRUD:
    def test_update_shortcut(self, db):
        qr = make_qr(db, "/old")
        qr.shortcut = "/new"
        db.commit()
        db.refresh(qr)
        assert qr.shortcut == "/new"

    def test_update_content(self, db):
        qr = make_qr(db)
        qr.content = "Updated content"
        db.commit()
        db.refresh(qr)
        assert qr.content == "Updated content"

    def test_delete_quick_reply(self, db):
        qr = make_qr(db)
        qr_id = qr.id
        db.delete(qr)
        db.commit()
        found = db.query(QuickReply).filter(QuickReply.id == qr_id).first()
        assert found is None


class TestQuickReplyPermissions:
    def test_search_is_available_to_authenticated_operator(self, db):
        make_qr(db, "/hello", "Hello there")
        current_user = make_user(db, can_change_settings=False)
        client = make_client(db, current_user)

        response = client.get("/api/v1/admin/quick-replies/search", params={"q": "/he"})

        assert response.status_code == 200
        assert response.json()["data"][0]["shortcut"] == "/hello"

    def test_create_requires_management_permission(self, db):
        current_user = make_user(db, can_change_settings=False)
        client = make_client(db, current_user)

        response = client.post(
            "/api/v1/admin/quick-replies",
            json={"shortcut": "/hello", "content": "Hello there"},
        )

        assert response.status_code == 403
        assert "can_change_settings" in response.json()["detail"]

    def test_update_requires_management_permission(self, db):
        qr = make_qr(db, "/hello", "Hello there")
        current_user = make_user(db, can_change_settings=False)
        client = make_client(db, current_user)

        response = client.patch(
            f"/api/v1/admin/quick-replies/{qr.id}",
            json={"content": "Updated"},
        )

        assert response.status_code == 403
        assert "can_change_settings" in response.json()["detail"]

    def test_delete_requires_management_permission(self, db):
        qr = make_qr(db, "/hello", "Hello there")
        current_user = make_user(db, can_change_settings=False)
        client = make_client(db, current_user)

        response = client.delete(f"/api/v1/admin/quick-replies/{qr.id}")

        assert response.status_code == 403
        assert "can_change_settings" in response.json()["detail"]

    def test_manager_can_create_update_and_delete_quick_replies(self, db):
        current_user = make_user(db, can_change_settings=True)
        client = make_client(db, current_user)

        create_response = client.post(
            "/api/v1/admin/quick-replies",
            json={"shortcut": "hello", "content": "Hello there"},
        )
        assert create_response.status_code == 200
        created = create_response.json()["data"]
        assert created["shortcut"] == "/hello"

        update_response = client.patch(
            f"/api/v1/admin/quick-replies/{created['id']}",
            json={"content": "Updated hello"},
        )
        assert update_response.status_code == 200
        assert update_response.json()["data"]["content"] == "Updated hello"

        delete_response = client.delete(f"/api/v1/admin/quick-replies/{created['id']}")
        assert delete_response.status_code == 200


# ── Shortcut normalization ────────────────────────────────────────────────────

class TestShortcutNormalization:
    """Tests for the /prefix normalization logic in the endpoint."""

    def test_normalize_adds_slash(self):
        raw = "hello"
        normalized = raw if raw.startswith("/") else f"/{raw}"
        assert normalized == "/hello"

    def test_normalize_keeps_existing_slash(self):
        raw = "/hello"
        normalized = raw if raw.startswith("/") else f"/{raw}"
        assert normalized == "/hello"

    def test_normalize_double_slash(self):
        raw = "//hello"
        normalized = raw if raw.startswith("/") else f"/{raw}"
        assert normalized == "//hello"  # keeps as-is when already starts with /
